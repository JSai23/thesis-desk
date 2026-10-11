// entity.repairAliases (MEM-060): take back what an unstated source alias attached. Hydration once stored AMD, NVIDIA,
// NVDA, H100s … as Makora's aliases, so every NVIDIA article was "about Makora". A source_fact alias is kept only when
// it is the name in another legal form or a document linked to the entity states it ("X, formerly Y", "X (Y)" —
// entities/aliases.ts); it is wrong when another live entity carries that name. Removing a wrong alias:
//   - documents linked to the entity that no longer name it (by its name or a kept alias) lose that link,
//   - relationships whose only support comes from those documents' evidence are rejected,
//   - field values those documents set are rejected (the next-best value becomes current),
//   - the documents are re-read, so the article links to the entities it really names (NVIDIA, AMD).
// Undo puts back the aliases, link statuses and field values; the re-read documents keep their new links.
import { invalidateTiers } from '../../objects/tiers'
import { z } from 'zod'
import { all, one, run } from '../../db'
import { now } from '../../clock'
import { AppError } from '../../errors'
import { enqueueProcess } from '../../ingest/pipeline'
import { aliasKey, normalizeName, TABLE, type EntityType } from '../resolve'
import { resolveCurrent } from '../fields'
import { sameNameShape, statedAlias } from '../aliases'
import { defineOp } from './types'
import { audit, liveRow, nameOf, sameNamed, LABEL } from './primitives'

const entityType = z.enum(['company', 'firm', 'person'])
const ACTIVE = "('accepted','suggested')"

type AliasRow = { alias: string; origin: 'source_fact' | 'user' | 'merge' }
const textOf = (d: { title: string | null; text: string }) => `${d.title || ''}\n${d.text}`
const names = (text: string, ns: string[]) => ns.some(n => new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(text.replace(/[’‘]/g, "'")))

export interface RepairPlan {
  type: EntityType; id: string; name: string
  bad: AliasRow[]
  documents: string[]
  relationships: { id: string; status: string }[]
  fields: { id: string; status: string; key: string }[]
}

/** What repairing this entity's aliases would change (read-only). `only` restricts to these alias spellings. */
export function aliasRepairPlan(type: EntityType, id: string, only?: string[]): RepairPlan {
  const row = liveRow<{ name: string }>(type, id)
  if (!row) throw new AppError('NOT_FOUND', `${LABEL[type]} not found`)
  const aliases = all<AliasRow>('SELECT alias, origin FROM aliases WHERE entity_type = ? AND entity_id = ?', type, id)
  const docs = all<{ id: string; title: string | null; text: string }>(`SELECT DISTINCT d.id, d.title, d.text FROM relationships r JOIN documents d ON d.id = r.from_id
    WHERE r.from_type = 'document' AND r.to_type = ? AND r.to_id = ? AND r.status IN ${ACTIVE} AND d.deleted_at IS NULL`, type, id)
  const wanted = only?.length ? new Set(only.map(aliasKey)) : null
  const bad = aliases.filter(a => {
    if (wanted) return wanted.has(aliasKey(a.alias)) && normalizeName(a.alias) !== normalizeName(row.name)
    if (a.origin !== 'source_fact' || normalizeName(a.alias) === normalizeName(row.name)) return false
    if (sameNamed(type, normalizeName(a.alias), id)) return true // another live entity carries this name
    if (sameNameShape(row.name, a.alias, type)) return false
    return !docs.some(d => statedAlias(row.name, a.alias, textOf(d)))
  })
  const badKeys = new Set(bad.map(a => aliasKey(a.alias)))
  const keep = [row.name, ...aliases.filter(a => !badKeys.has(aliasKey(a.alias))).map(a => a.alias)]
  const documents = bad.length ? docs.filter(d => !names(textOf(d), keep)).map(d => d.id) : []
  if (!documents.length) return { type, id, name: row.name, bad, documents, relationships: [], fields: [] }
  const ph = documents.map(() => '?').join(',')
  const evidence = new Set(all<{ id: string }>(`SELECT id FROM evidence WHERE document_id IN (${ph})`, ...documents).map(e => e.id))
  const rels = new Map<string, string>()
  for (const r of all<{ id: string; status: string }>(`SELECT id, status FROM relationships WHERE from_type = 'document' AND from_id IN (${ph}) AND to_type = ? AND to_id = ? AND status IN ${ACTIVE}`, ...documents, type, id)) rels.set(r.id, r.status)
  for (const r of all<{ id: string; status: string; from_type: string; from_id: string }>(`SELECT id, status, from_type, from_id FROM relationships
      WHERE ((to_type = ? AND to_id = ?) OR (from_type = ? AND from_id = ?)) AND status IN ${ACTIVE} AND origin <> 'user'`, type, id, type, id)) {
    if (r.from_type === 'evidence') { if (evidence.has(r.from_id)) rels.set(r.id, r.status); continue }
    if (r.from_type === 'document') continue
    const support = all<{ evidence_id: string }>("SELECT evidence_id FROM relationship_evidence WHERE relationship_id = ? AND status = 'active'", r.id).map(x => x.evidence_id)
    if (support.length && support.every(e => evidence.has(e))) rels.set(r.id, r.status)
  }
  const fields = all<{ id: string; status: string; field_key: string; evidence_id: string | null }>(`SELECT id, status, field_key, evidence_id FROM field_values
      WHERE object_type = ? AND object_id = ? AND origin <> 'user' AND status IN ('current','superseded')`, type, id)
    .filter(f => f.evidence_id && evidence.has(f.evidence_id)).map(f => ({ id: f.id, status: f.status, key: f.field_key }))
  return { type, id, name: row.name, bad, documents, relationships: [...rels].map(([id, status]) => ({ id, status })), fields }
}

/** Entities whose source aliases fail the check — the read-only audit behind the repair (IPC ontology.aliasAudit). */
export function aliasAudit(): { type: EntityType; id: string; name: string; bad: string[]; documents: number }[] {
  const out: ReturnType<typeof aliasAudit> = []
  for (const type of ['company', 'firm', 'person'] as EntityType[]) {
    const ids = all<{ id: string }>(`SELECT DISTINCT a.entity_id id FROM aliases a JOIN ${TABLE[type]} e ON e.id = a.entity_id
      WHERE a.entity_type = ? AND a.origin = 'source_fact' AND e.merged_into_id IS NULL AND e.deleted_at IS NULL`, type)
    for (const { id } of ids) {
      const p = aliasRepairPlan(type, id)
      if (p.bad.length) out.push({ type, id, name: p.name, bad: p.bad.map(a => a.alias), documents: p.documents.length })
    }
  }
  return out
}

export const repairAliases = defineOp({
  name: 'entity.repairAliases',
  input: z.object({ type: entityType, id: z.string().min(1), aliases: z.array(z.string()).optional(), reread: z.boolean().optional() }),
  validate: i => {
    if (!liveRow(i.type, i.id)) return [new AppError('NOT_FOUND', `${LABEL[i.type]} not found`)]
    return aliasRepairPlan(i.type, i.id, i.aliases).bad.length ? [] : [`${nameOf(i.type, i.id)} has no names to remove`]
  },
  describe: i => {
    const p = aliasRepairPlan(i.type, i.id, i.aliases)
    return `Remove ${p.bad.map(a => a.alias).slice(0, 6).join(', ')}${p.bad.length > 6 ? '…' : ''} from ${p.name} and unlink ${p.documents.length} article${p.documents.length === 1 ? '' : 's'} that never name it?`
  },
  apply: (i, cs) => {
    const p = aliasRepairPlan(i.type, i.id, i.aliases)
    const t = now()
    for (const a of p.bad) run('DELETE FROM aliases WHERE entity_type = ? AND entity_id = ? AND alias_normalized = ?', i.type, i.id, aliasKey(a.alias))
    // rejected, not inactive: pages still show inactive source facts, and a rejected document–entity pair also keeps a
    // re-read from attaching the article again
    for (const r of p.relationships) run("UPDATE relationships SET status = 'rejected', updated_at = ? WHERE id = ?", t, r.id)
    for (const f of p.fields) run("UPDATE field_values SET status = 'rejected' WHERE id = ?", f.id)
    for (const k of new Set(p.fields.map(f => f.key))) resolveCurrent(i.type, i.id, k)
    if (i.reread !== false) for (const d of p.documents) { run('UPDATE documents SET ai_generation = ai_generation + 1, updated_at = ? WHERE id = ?', t, d); enqueueProcess(d, { skipTriage: true, priority: 3 }) }
    audit(i.type, i.id, 'aliases.repaired', { aliases: p.bad }, { relationships: p.relationships, fields: p.fields, documents: p.documents })
    cs.touch(i.type, i.id).doc(...p.documents).names = true
    // a rejected link between two entities (Blackstone —invested_in→ Makora) also changes the tiers and the "X is
    // connected to Y" reasons Today shows for the other end's articles: re-score those too (Backlog, 2026-10-06)
    for (const pr of p.relationships) {
      const r = one<{ from_type: string; from_id: string; to_type: string; to_id: string }>('SELECT from_type, from_id, to_type, to_id FROM relationships WHERE id = ?', pr.id)
      if (!r) continue
      const other = r.from_type === i.type && r.from_id === i.id ? { t: r.to_type, id: r.to_id } : { t: r.from_type, id: r.from_id }
      if (['company', 'firm', 'person'].includes(other.t) && ['company', 'firm', 'person'].includes(r.from_type) && ['company', 'firm', 'person'].includes(r.to_type)) cs.docsOf(other.t as 'company' | 'firm' | 'person', other.id)
    }
    invalidateTiers()
    return { removed: p.bad.map(a => a.alias), unlinked: p.documents.length, relationships: p.relationships.length, fields: p.fields.length, reread: i.reread !== false ? p.documents.length : 0 }
  },
  undo: {
    'aliases.repaired': h => ({ op: 'entity.restoreAliases', input: { type: h.entity_type, id: h.entity_id, aliases: h.before.aliases, relationships: h.after.relationships, fields: h.after.fields } })
  },
  chat: {
    action: 'remove_alias',
    line: 'the user says a name the library treats as another name of a candidate is NOT that entity (a partner, customer, product, chip, ticker or different company appearing near it) and articles about that name should not count for the candidate: objectId = the candidate, value = that name exactly as the user wrote it.',
    toInput: (s, typeOf) => {
      const t = typeOf(s.objectId)
      if (!s.objectId || !t || t === 'thesis') throw 'remove_alias needs objectId (a company, firm or person) and value (the name to remove)'
      if (!s.value?.trim()) throw 'remove_alias needs value: the name to remove'
      return { type: t as EntityType, id: s.objectId, aliases: [s.value.trim()] }
    }
  }
})

/** The inverse of repairAliases (reached through undo). Writes the alias rows directly: the source-alias guard would
 *  refuse "NVIDIA" once the re-read created an NVIDIA entity, but undo means putting back exactly what was there. */
export const restoreAliases = defineOp({
  name: 'entity.restoreAliases',
  internal: true,
  input: z.object({
    type: entityType, id: z.string().min(1),
    aliases: z.array(z.object({ alias: z.string(), origin: z.enum(['source_fact', 'user', 'merge']) })),
    relationships: z.array(z.object({ id: z.string(), status: z.string() })),
    fields: z.array(z.object({ id: z.string(), status: z.string(), key: z.string() }))
  }),
  validate: i => (liveRow(i.type, i.id) ? [] : [new AppError('NOT_FOUND', `${LABEL[i.type]} not found`)]),
  describe: i => `Put back ${i.aliases.map(a => a.alias).join(', ')} on ${nameOf(i.type, i.id)}?`,
  apply: (i, cs) => {
    const t = now()
    for (const a of i.aliases) run('INSERT OR REPLACE INTO aliases(entity_type, entity_id, alias, alias_normalized, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)', i.type, i.id, a.alias, aliasKey(a.alias), a.origin, t)
    for (const r of i.relationships) run('UPDATE relationships SET status = ?, updated_at = ? WHERE id = ?', r.status, t, r.id)
    for (const f of i.fields) {
      if (f.status === 'current') run("UPDATE field_values SET status = 'superseded' WHERE object_type = ? AND object_id = ? AND field_key = ? AND status = 'current' AND id <> ?", i.type, i.id, f.key, f.id)
      run('UPDATE field_values SET status = ? WHERE id = ?', f.status, f.id)
    }
    audit(i.type, i.id, 'aliases.restored', null, { aliases: i.aliases.map(a => a.alias) })
    const docs = all<{ from_id: string }>(`SELECT from_id FROM relationships WHERE from_type = 'document' AND id IN (${i.relationships.map(() => '?').join(',') || "''"})`, ...i.relationships.map(r => r.id)).map(r => r.from_id)
    cs.touch(i.type, i.id).doc(...docs).names = true
    return { restored: i.aliases.length }
  }
})

export const REPAIR_OPS = [repairAliases, restoreAliases]
