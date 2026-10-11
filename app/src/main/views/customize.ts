// FLOW-E (RFC §1B.15, P-VIEW-001..004, P-FEED-009): natural-language layout changes. CUSTOMIZE_VIEW returns a JSON
// patch that must apply cleanly and produce a valid ViewDefinition; otherwise nothing is persisted. New tracked
// attributes become custom field_defs + BACKFILL_FIELD jobs (EXTRACT_FIELD). Undo restores the exact previous JSON.
import { all, one, run, tx, json } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { writeHistory } from '../history'
import { setSetting } from '../settings'
import { enqueue, registerJob } from '../jobs'
import { runTask } from '../ai/runtime'
import { readAuth } from '../ai/codex-auth'
import { CUSTOMIZE, CATALOG, EXTRACT_FIELD, type CustomizeValue } from '../ai/tasks/views'
import { ViewDefinition, FieldKey, COMPONENT_PARAMS } from '../../shared/schemas/view-def'
import { getView, type ViewObjectType } from './index'
import { activeFieldDefs, writeSourceValue, normalizeValue, fieldDef } from '../entities/fields'
import { locateQuote } from '../ingest/quotes'

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

// ---------------------------------------------------------------- minimal RFC 6902 (add/remove/replace/move)
function parsePath(p: string): string[] {
  if (p === '' ) return []
  if (!p.startsWith('/')) throw new Error(`bad path ${p}`)
  return p.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
}
function parentOf(doc: any, segs: string[]): { parent: any; key: string } {
  let cur = doc
  for (const s of segs.slice(0, -1)) {
    if (cur == null || typeof cur !== 'object') throw new Error('path does not exist')
    if (Array.isArray(cur)) { const i = Number(s); if (!Number.isInteger(i) || i < 0 || i >= cur.length) throw new Error('index out of range'); cur = cur[i] }
    else { if (!(s in cur)) cur[s] = {}; cur = cur[s] }
  }
  return { parent: cur, key: segs[segs.length - 1] }
}
function getAt(doc: any, segs: string[]): any { let cur = doc; for (const s of segs) { if (cur == null) throw new Error('path does not exist'); cur = Array.isArray(cur) ? cur[Number(s)] : cur[s] } if (cur === undefined) throw new Error('path does not exist'); return cur }
function removeAt(doc: any, segs: string[]): any {
  const { parent, key } = parentOf(doc, segs)
  if (Array.isArray(parent)) { const i = Number(key); if (!Number.isInteger(i) || i < 0 || i >= parent.length) throw new Error('index out of range'); return parent.splice(i, 1)[0] }
  if (!(key in parent)) throw new Error('path does not exist')
  const v = parent[key]; delete parent[key]; return v
}
function addAt(doc: any, segs: string[], value: any): void {
  const { parent, key } = parentOf(doc, segs)
  if (Array.isArray(parent)) { const i = key === '-' ? parent.length : Number(key); if (!Number.isInteger(i) || i < 0 || i > parent.length) throw new Error('index out of range'); parent.splice(i, 0, value) }
  else parent[key] = value
}
export function applyPatch(def: any, ops: CustomizeValue['patch']): any {
  const d = clone(def)
  for (const o of ops) {
    const segs = parsePath(o.path)
    const value = o.valueJson == null ? undefined : JSON.parse(o.valueJson)
    if (o.op === 'add') addAt(d, segs, value)
    else if (o.op === 'remove') removeAt(d, segs)
    else if (o.op === 'replace') { removeAt(d, segs); addAt(d, segs, value) }
    else if (o.op === 'move') { if (!o.from) throw new Error('move needs from'); const v = removeAt(d, parsePath(o.from)); addAt(d, segs, v) }
  }
  return d
}

function fieldCatalog(objectType: string): string {
  if (objectType === 'feed' || objectType === 'thesis') return objectType === 'thesis' ? '(none)' : '(not applicable)'
  return activeFieldDefs(objectType).map(f => `${f.key} (${f.label}, ${f.value_type}${f.builtin ? ', built-in' : ', custom'})`).join(', ')
}

/** Models sometimes put new custom fields into the patch (`add /createFields/-`); hoist them into createFields. */
function hoistCreateFields(v: CustomizeValue): void {
  const keep: CustomizeValue['patch'] = []
  for (const op of v.patch) {
    if (!/^\/createFields(\/|$)/.test(op.path)) { keep.push(op); continue }
    try { const val = JSON.parse(op.valueJson || 'null'); for (const f of Array.isArray(val) ? val : [val]) if (f && typeof f === 'object' && f.key) v.createFields.push({ enumValues: null, extractionInstruction: f.label || f.key, valueType: 'text', label: f.key, ...f }) } catch { /* dropped */ }
  }
  v.patch = keep
}

/** A field the user asked to track is shown: created keys the patch never references go into the header fields. */
function showCreatedFields(v: CustomizeValue): void {
  const used = v.patch.map(op => `${op.path} ${op.valueJson || ''}`).join(' ')
  for (const f of v.createFields) if (!used.includes(f.key)) v.patch.push({ op: 'add', path: '/headerFields/-', from: null, valueJson: JSON.stringify(f.key) })
}

/** Issue path with the section's component named, so the retry knows which section it touched. */
function describeIssue(def: any, i: { path: PropertyKey[]; message: string }): string {
  const [area, idx] = i.path
  const sec = (area === 'main' || area === 'rail') && typeof idx === 'number' ? def?.[area]?.[idx] : null
  const where = i.path.map(String).join('.')
  if (!sec) return `${where}: ${i.message}`
  const allowed = Object.keys((COMPONENT_PARAMS[sec.component as keyof typeof COMPONENT_PARAMS] as any)?.shape || {})
  return `${where} (section "${sec.id}", component ${sec.component}${allowed.length ? `, params allowed: ${allowed.join(', ')}` : ', takes no params'}): ${i.message}`
}

/** Validate a candidate: the patch applies and the result is a valid definition of the right type. */
function check(objectType: ViewObjectType, current: any, v: CustomizeValue): { problems: string[]; next?: any } {
  const problems: string[] = []
  hoistCreateFields(v)
  showCreatedFields(v)
  if (objectType === 'feed' && v.scope !== 'type') problems.push('Today customizations use scope "type"')
  for (const f of v.createFields) {
    if (!FieldKey.safeParse(f.key).success) problems.push(`field key ${f.key} must match ^[a-z][a-z0-9_]{1,30}$`)
    if (objectType === 'feed' || objectType === 'thesis') problems.push('custom fields apply only to companies and firms')
  }
  let next: any
  try { next = applyPatch(current, v.patch) } catch (e) { problems.push(`patch does not apply: ${(e as Error).message}`); return { problems } }
  const r = ViewDefinition.safeParse(next)
  if (!r.success) problems.push(...r.error.issues.slice(0, 8).map(i => describeIssue(next, i)))
  else if (r.data.objectType !== objectType) problems.push('objectType must not change')
  if (r.success && r.data.objectType !== 'feed') {
    const keys = new Set([...activeFieldDefs(objectType).map(f => f.key), ...v.createFields.map(f => f.key)])
    const used = [...r.data.headerFields, ...[...r.data.main, ...r.data.rail].flatMap(s => (s.component === 'field_table' ? (s.params?.fields as string[]) || [] : []))]
    for (const k of used) if (!keys.has(k)) problems.push(`unknown field ${k}; add it to createFields`)
  }
  if (!v.patch.length && !v.createFields.length) problems.push('no change')
  // a page keeps a body: moving its only main section away left Lumen Legal's page empty while the summary said
  // "moved funding history to the top" (SMK-09 in acc-2026-10-07T17-11-52)
  if (r.success && r.data.objectType !== 'feed' && (current?.main || []).length && !r.data.main.length) problems.push('main must keep at least one section; add sections instead of moving the only one away')
  return { problems, next: r.success ? r.data : undefined }
}

/** What the instruction names must be on the page afterwards ("funding history" is funding_table, CATALOG). */
function namedComponents(instruction: string, next: any): string[] {
  if (!next || next.objectType === 'feed' || !/\bfunding (history|rounds?)\b|\brounds\b/i.test(instruction) || /\b(hide|remove|drop)\b[^.]*\bfunding\b/i.test(instruction)) return []
  return [...(next.main || []), ...(next.rail || [])].some((s: any) => s.component === 'funding_table') ? [] : ['the instruction asks for funding history: add a funding_table section (it is not on the page yet)']
}

export async function customize(objectType: ViewObjectType, objectId: string | null, instruction: string): Promise<{ viewId: string; scope: 'object' | 'type'; summary: string; definition: unknown }> {
  if (readAuth().status !== 'ok') throw new AppError('AI_UNAVAILABLE', 'Sign in to ChatGPT with Codex to customize pages.')
  const cur = getView(objectType, objectId)
  const current = cur.definition
  const name = objectId ? (objectType === 'thesis' ? one<any>('SELECT title FROM theses WHERE id = ?', objectId)?.title : one<any>(`SELECT name FROM ${objectType === 'company' ? 'companies' : 'firms'} WHERE id = ?`, objectId)?.name) ?? null : null
  const theses = objectType === 'feed' ? all<{ id: string; title: string }>('SELECT id, title FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL').map(t => `${t.title} (id=${t.id})`).join(', ') : ''
  let next: any
  const r = await runTask(CUSTOMIZE, {
    instruction, objectType, objectName: name, current, catalog: CATALOG, fields: fieldCatalog(objectType), theses,
    validate: v => { const c = check(objectType, current, v); next = c.next; return [...c.problems, ...namedComponents(instruction, c.next)] }
  })
  const v = r.value
  hoistCreateFields(v)
  showCreatedFields(v)
  // all pages of a kind only when the instruction says so ("every", "all", "each", "company pages"); otherwise this page
  const saysType = /\b(every|all|each|any)\b|\b(company|firm|thesis|theses|companies|firms)\s+pages\b|\bpages\b/i.test(instruction)
  const scope: 'object' | 'type' = objectType === 'feed' || !objectId ? 'type' : saysType ? v.scope : 'object'
  // a type-scope change computed from an object-scope layout applies to the type default as well
  if (scope !== cur.scope && cur.scope !== 'default') {
    const base = scope === 'type' ? getView(objectType, null).definition : current
    try { next = ViewDefinition.parse(applyPatch(base, v.patch)) } catch { /* keep next computed against current */ }
  }
  const t = now()
  let viewId = ''
  tx(() => {
    const row = scope === 'object'
      ? one<any>("SELECT * FROM view_definitions WHERE scope = 'object' AND object_type = ? AND object_id = ?", objectType, objectId)
      : one<any>("SELECT * FROM view_definitions WHERE scope = 'type' AND object_type = ? AND object_id IS NULL", objectType)
    const before = row ? row.definition_json : null
    const after = JSON.stringify(next)
    if (row) { run('UPDATE view_definitions SET definition_json = ?, instruction = ?, version = version + 1, updated_at = ? WHERE id = ?', after, instruction, t, row.id); viewId = row.id }
    else { viewId = newId('vd'); run('INSERT INTO view_definitions(id, scope, object_type, object_id, definition_json, instruction, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)', viewId, scope, objectType, scope === 'object' ? objectId : null, after, instruction, t, t) }
    writeHistory('view', viewId, 'view.changed', { definition_json: before, instruction: row?.instruction ?? null, version: row?.version ?? 0, existed: !!row }, { definition_json: after, instruction, scope, objectType, objectId }, 'user')
    for (const f of v.createFields) {
      if (fieldDef(objectType, f.key)) continue
      const fdId = newId('fd')
      run('INSERT INTO field_defs(id, object_type, key, label, value_type, enum_values_json, builtin, extraction_instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)', fdId, objectType, f.key, f.label, f.valueType, f.enumValues ? JSON.stringify(f.enumValues) : null, f.extractionInstruction, t)
      writeHistory('field_def', fdId, 'field.created', null, { objectType, key: f.key, label: f.label })
    }
    if (objectType === 'feed' && next?.spec?.groupBy) setSetting('appearance.group_today_by', next.spec.groupBy)
  })
  for (const f of v.createFields) if (objectType === 'company' || objectType === 'firm') enqueue('BACKFILL_FIELD', { objectType, key: f.key, objectId }, { idempotencyKey: `backfill:${objectType}:${f.key}`, priority: 2 })
  emit('view.updated', { objectType, objectId, viewId })
  emit('object.updated', {})
  if (objectType === 'feed') emit('feed.updated', {})
  return { viewId, scope, summary: v.summary, definition: next }
}

export function undo(viewId: string): { ok: true } {
  const h = one<any>("SELECT * FROM history WHERE entity_type = 'view' AND entity_id = ? AND action = 'view.changed' ORDER BY created_at DESC, rowid DESC LIMIT 1", viewId)
  const row = one<any>('SELECT * FROM view_definitions WHERE id = ?', viewId)
  if (!h || !row) throw new AppError('NOT_FOUND', 'Nothing to undo')
  const before = json<any>(h.before_json, {})
  tx(() => {
    if (!before.existed) run('DELETE FROM view_definitions WHERE id = ?', viewId)
    else run('UPDATE view_definitions SET definition_json = ?, instruction = ?, version = version + 1, updated_at = ? WHERE id = ?', before.definition_json, before.instruction, now(), viewId)
    writeHistory('view', viewId, 'view.undone', { definition_json: row.definition_json }, { definition_json: before.definition_json })
    if (row.object_type === 'feed') { const spec = json<any>(before.definition_json, {})?.spec; setSetting('appearance.group_today_by', spec?.groupBy || 'section') }
  })
  emit('view.updated', { viewId })
  emit('object.updated', {})
  emit('feed.updated', {})
  return { ok: true }
}

// ---------------------------------------------------------------- BACKFILL_FIELD / EXTRACT_FIELD
async function backfill(p: { objectType: 'company' | 'firm'; key: string; objectId?: string | null }, jobId: string): Promise<unknown> {
  const def = fieldDef(p.objectType, p.key)
  if (!def || def.builtin) return { skipped: true }
  const table = p.objectType === 'company' ? 'companies' : 'firms'
  const objs = all<{ id: string; name: string }>(`SELECT e.id, e.name FROM ${table} e WHERE e.merged_into_id IS NULL AND e.deleted_at IS NULL
     ORDER BY (e.id = ?) DESC, e.followed DESC, (SELECT MAX(r.created_at) FROM relationships r WHERE r.to_type = ? AND r.to_id = e.id) DESC LIMIT 50`, p.objectId || '', p.objectType)
  let found = 0
  for (const o of objs) {
    if (one("SELECT 1 FROM field_values WHERE object_type = ? AND object_id = ? AND field_key = ? AND status IN ('current','proposed')", p.objectType, o.id, p.key)) continue
    const docs = all<{ id: string; text: string }>(`SELECT DISTINCT d.id, d.text FROM relationships r JOIN documents d ON d.id = r.from_id WHERE r.from_type = 'document' AND r.to_type = ? AND r.to_id = ? AND r.status = 'accepted' AND d.deleted_at IS NULL ORDER BY d.first_fetched_at DESC LIMIT 12`, p.objectType, o.id)
    if (!docs.length) continue
    let budget = 20_000
    const excerpts = docs.map(d => { const t = d.text.slice(0, Math.max(0, Math.min(budget, 6000))); budget -= t.length; return { documentId: d.id, text: t } }).filter(e => e.text)
    try {
      const r = await runTask(EXTRACT_FIELD, { label: def.label, key: def.key, valueType: def.value_type, enumValues: json(def.enum_values_json, null), instruction: def.extraction_instruction || `Find the ${def.label}.`, objectName: o.name, excerpts }, { jobId })
      const v = r.value
      if (!v.value || !v.evidenceQuote || !v.documentId || !normalizeValue(def, v.value)) continue
      const d = one<{ text: string; current_version: number }>('SELECT text, current_version FROM documents WHERE id = ?', v.documentId)!
      const loc = locateQuote(d.text, v.evidenceQuote)
      if (!loc) continue
      tx(() => {
        const evId = newId('ev')
        const t = now()
        const quote = d.text.slice(loc.start, loc.end)
        run(`INSERT INTO evidence(id, document_id, document_version, origin, kind, assertion, claim, quote, quote_start, quote_end, payload_json, is_novel, confidence, kept, status, created_at, updated_at)
             VALUES (?, ?, ?, 'ai_extraction', 'metric', 'fact', ?, ?, ?, ?, ?, 0, 0.7, 0, 'active', ?, ?)`, evId, v.documentId, d.current_version, quote, quote, loc.start, loc.end, JSON.stringify({ subject: o.name, detail: `${def.key}: ${v.value}`, subjectId: o.id, subjectType: p.objectType }), t, t)
        run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, created_at, updated_at) VALUES (?, 'evidence', ?, 'about', ?, ?, 'source_fact', 'accepted', ?, ?) ON CONFLICT DO NOTHING`, newId('rel'), evId, p.objectType, o.id, t, t)
        writeSourceValue(p.objectType, o.id, def.key, v.value!, evId, r.runId)
      })
      found++
    } catch (e) { if (e instanceof AppError && e.code === 'AI_UNAVAILABLE') throw e }
  }
  emit('object.updated', {})
  return { objects: objs.length, found }
}

export function registerCustomize(): void {
  registerJob('BACKFILL_FIELD', job => backfill(job.payload as any, job.id))
}
