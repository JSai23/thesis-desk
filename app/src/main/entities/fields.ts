// Field values and correction precedence (RFC §1B.13.3, LAW-06, DEC-054/058). One resolveCurrent rule is used on
// insert, version supersession, revert and purge. User-origin values are never overwritten by automation.
import { all, one, run, tx, json } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { writeHistory } from '../history'
import { AppError } from '../errors'
import { STAGES } from '../db/seed'
import { emit } from '../events'

export interface FieldDef { id: string; object_type: string; key: string; label: string; value_type: string; enum_values_json: string | null; builtin: number; extraction_instruction: string | null }
interface FV { id: string; object_type: string; object_id: string; field_key: string; value_json: string; display: string; origin: string; evidence_id: string | null; status: string; created_at: number }

export const fieldDef = (objectType: string, key: string) => one<FieldDef>('SELECT * FROM field_defs WHERE object_type = ? AND key = ? AND deleted_at IS NULL', objectType, key)
export const activeFieldDefs = (objectType?: string) => objectType
  ? all<FieldDef>('SELECT * FROM field_defs WHERE object_type = ? AND deleted_at IS NULL ORDER BY builtin DESC, created_at', objectType)
  : all<FieldDef>('SELECT * FROM field_defs WHERE deleted_at IS NULL ORDER BY object_type, builtin DESC, created_at')

/** Normalize a raw value for a field type; null when it can't be represented. */
export function normalizeValue(def: FieldDef, raw: string): { value: unknown; display: string } | null {
  const v = raw.trim()
  if (!v) return null
  switch (def.value_type) {
    case 'enum': {
      const opts: string[] = json(def.enum_values_json, def.key === 'stage' ? STAGES : [])
      const l = v.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').replace(/\bround\b/, '').trim()
      const hit = opts.find(o => o.toLowerCase().replace(/[-_]/g, ' ') === l) || opts.find(o => l.startsWith(o.toLowerCase().replace(/[-_]/g, ' ') + ' ')) || (l === 'preseed' ? 'Pre-seed' : null)
      return hit ? { value: hit, display: hit } : null
    }
    case 'number': {
      const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
      if (!m) return null
      const n = Number(m[0])
      return { value: n, display: n.toLocaleString('en-US') }
    }
    case 'money': {
      const m = v.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k|thousand|m|million|b|billion)?/i)
      if (!m) return null
      const mult = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 } as Record<string, number>
      const n = Number(m[1]) * (m[2] ? mult[m[2].toLowerCase()] : 1)
      return { value: n, display: v }
    }
    case 'url': return { value: /^https?:/i.test(v) ? v : 'https://' + v.replace(/^\/+/, ''), display: v.replace(/^https?:\/\//i, '').replace(/\/$/, '') }
    case 'date': return { value: v, display: v }
    default: return { value: v, display: v.length > 200 ? v.slice(0, 197) + '…' : v }
  }
}

function evidenceTime(evidenceId: string | null): number {
  if (!evidenceId) return 0
  const r = one<{ event_date: string | null; published_at: number | null; first_fetched_at: number; created_at: number }>(
    'SELECT e.event_date, d.published_at, d.first_fetched_at, e.created_at FROM evidence e JOIN documents d ON d.id = e.document_id WHERE e.id = ?', evidenceId)
  if (!r) return 0
  const ev = r.event_date ? Date.parse(r.event_date) : NaN
  return Number.isFinite(ev) ? ev : r.published_at || r.first_fetched_at || r.created_at
}

/** The single rule choosing the current value of (object, field). */
export function resolveCurrent(objectType: string, objectId: string, key: string): void {
  const rows = all<FV>("SELECT * FROM field_values WHERE object_type = ? AND object_id = ? AND field_key = ? AND status IN ('current','superseded')", objectType, objectId, key)
  if (!rows.length) return
  const user = rows.filter(r => r.origin === 'user').sort((a, b) => b.created_at - a.created_at)
  let chosen: FV | undefined
  // a user row that was superseded by revert stays superseded; only a current user row wins
  const userCurrent = user.find(r => r.status === 'current')
  if (userCurrent) chosen = userCurrent
  else {
    const activeSrc = rows.filter(r => r.origin !== 'user' && r.evidence_id && one("SELECT 1 FROM evidence WHERE id = ? AND status = 'active'", r.evidence_id))
    if (activeSrc.length) chosen = activeSrc.sort((a, b) => evidenceTime(b.evidence_id) - evidenceTime(a.evidence_id) || b.created_at - a.created_at)[0]
    else chosen = rows.filter(r => r.origin !== 'user').sort((a, b) => b.created_at - a.created_at)[0] || undefined
  }
  run("UPDATE field_values SET status = 'superseded' WHERE object_type = ? AND object_id = ? AND field_key = ? AND status = 'current'", objectType, objectId, key)
  if (chosen) run("UPDATE field_values SET status = 'current' WHERE id = ?", chosen.id)
}

export function currentValue(objectType: string, objectId: string, key: string): FV | undefined {
  return one<FV>("SELECT * FROM field_values WHERE object_type = ? AND object_id = ? AND field_key = ? AND status = 'current'", objectType, objectId, key)
}

/** Write a value from a source (or AI-inferred) per §1B.13.3. Returns the field_values id or null when skipped. */
export function writeSourceValue(objectType: string, objectId: string, key: string, raw: string, evidenceId: string, runId?: string | null, origin: 'source_fact' | 'ai_inference' = 'source_fact'): string | null {
  const def = fieldDef(objectType, key)
  if (!def) return null
  const nv = normalizeValue(def, raw)
  if (!nv) return null
  const t = now()
  const id = newId('fv')
  const cur = currentValue(objectType, objectId, key)
  const valueJson = JSON.stringify(nv.value)
  if (cur && cur.origin === 'user') {
    if (cur.value_json !== valueJson) {
      run('INSERT INTO field_values(id, object_type, object_id, field_key, value_json, display, origin, evidence_id, status, created_at, created_by_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, objectType, objectId, key, valueJson, nv.display, origin, evidenceId, 'proposed', t, runId ?? null)
      run(`INSERT OR IGNORE INTO suggestions(id, type, target_type, target_id, payload_json, explanation, confidence, status, dedupe_key, created_at)
           VALUES (?, 'field_update', ?, ?, ?, ?, 0.9, 'open', ?, ?)`, newId('sg'), objectType, objectId, JSON.stringify({ fvId: id, key, value: nv.display }),
        `New evidence says ${def.label} is ${nv.display}.`, `field:${objectId}:${key}:${nv.display.toLowerCase()}`, t)
      return id
    }
    run('INSERT INTO field_values(id, object_type, object_id, field_key, value_json, display, origin, evidence_id, status, created_at, created_by_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, objectType, objectId, key, valueJson, nv.display, origin, evidenceId, 'superseded', t, runId ?? null)
    return id
  }
  run('INSERT INTO field_values(id, object_type, object_id, field_key, value_json, display, origin, evidence_id, status, created_at, created_by_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, objectType, objectId, key, valueJson, nv.display, origin, evidenceId, cur ? 'superseded' : 'current', t, runId ?? null)
  if (cur) resolveCurrent(objectType, objectId, key)
  return id
}

export function setUserValue(objectType: string, objectId: string, key: string, raw: string): void {
  const def = fieldDef(objectType, key)
  if (!def) throw new AppError('NOT_FOUND', `Unknown field ${key}`)
  const nv = normalizeValue(def, raw)
  if (!nv) throw new AppError('VALIDATION', def.value_type === 'enum' ? `${def.label} must be one of: ${json<string[]>(def.enum_values_json, []).join(', ')}` : `That isn’t a valid ${def.label.toLowerCase()}`)
  const t = now()
  tx(() => {
    const before = currentValue(objectType, objectId, key)
    run("UPDATE field_values SET status = 'superseded' WHERE object_type = ? AND object_id = ? AND field_key = ? AND status = 'current'", objectType, objectId, key)
    run('INSERT INTO field_values(id, object_type, object_id, field_key, value_json, display, origin, evidence_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)',
      newId('fv'), objectType, objectId, key, JSON.stringify(nv.value), nv.display, 'user', 'current', t)
    // open proposals that equal the user's value are settled
    run("UPDATE field_values SET status = 'rejected' WHERE object_type = ? AND object_id = ? AND field_key = ? AND status = 'proposed' AND value_json = ?", objectType, objectId, key, JSON.stringify(nv.value))
    writeHistory(objectType, objectId, 'field.corrected', { key, value: before?.display ?? null, origin: before?.origin ?? null }, { key, value: nv.display, origin: 'user' })
  })
  emit('object.updated', { type: objectType, id: objectId })
}

export function revertValue(objectType: string, objectId: string, key: string): void {
  tx(() => {
    const before = currentValue(objectType, objectId, key)
    run("UPDATE field_values SET status = 'superseded' WHERE object_type = ? AND object_id = ? AND field_key = ? AND origin = 'user' AND status = 'current'", objectType, objectId, key)
    resolveCurrent(objectType, objectId, key)
    const after = currentValue(objectType, objectId, key)
    writeHistory(objectType, objectId, 'field.reverted', { key, value: before?.display ?? null, origin: before?.origin ?? null }, { key, value: after?.display ?? null })
  })
  emit('object.updated', { type: objectType, id: objectId })
}

export function resolveProposal(fvId: string, choice: 'keep' | 'use_new'): void {
  const p = one<FV>("SELECT * FROM field_values WHERE id = ? AND status = 'proposed'", fvId)
  if (!p) throw new AppError('NOT_FOUND', 'Proposal not found')
  tx(() => {
    if (choice === 'keep') run("UPDATE field_values SET status = 'rejected' WHERE id = ?", fvId)
    else {
      run("UPDATE field_values SET status = 'superseded' WHERE object_type = ? AND object_id = ? AND field_key = ? AND status = 'current'", p.object_type, p.object_id, p.field_key)
      run("UPDATE field_values SET status = 'superseded' WHERE object_type = ? AND object_id = ? AND field_key = ? AND origin = 'user'", p.object_type, p.object_id, p.field_key)
      run("UPDATE field_values SET status = 'current' WHERE id = ?", fvId)
    }
    run("UPDATE suggestions SET status = ?, resolved_at = ? WHERE type = 'field_update' AND json_extract(payload_json, '$.fvId') = ?", choice === 'keep' ? 'rejected' : 'accepted', now(), fvId)
    writeHistory(p.object_type, p.object_id, 'field.proposal_resolved', { fvId }, { choice, key: p.field_key, value: p.display })
  })
  emit('object.updated', { type: p.object_type, id: p.object_id })
}

export function fieldHistory(objectType: string, objectId: string, key: string) {
  return all<any>(`SELECT fv.id, fv.display, fv.origin, fv.status, fv.created_at, fv.evidence_id, d.title AS doc_title, d.published_at, d.first_fetched_at, s.name AS source_name
     FROM field_values fv LEFT JOIN evidence e ON e.id = fv.evidence_id LEFT JOIN documents d ON d.id = e.document_id
     LEFT JOIN sources s ON s.id = (SELECT source_id FROM document_sources ds WHERE ds.document_id = d.id ORDER BY first_seen_at LIMIT 1)
     WHERE fv.object_type = ? AND fv.object_id = ? AND fv.field_key = ? ORDER BY fv.created_at DESC`, objectType, objectId, key)
    .map(r => ({ id: r.id, display: r.display, origin: r.origin, status: r.status, date: r.published_at || r.first_fetched_at || r.created_at, source: r.origin === 'user' ? 'You' : r.source_name === 'Added by you' ? (r.doc_title || 'Added by you') : r.source_name || r.doc_title || null, document: r.doc_title }))
}
