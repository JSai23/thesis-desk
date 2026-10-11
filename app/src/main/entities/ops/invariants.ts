// Ontology invariants (DEC-094): what must hold after every operation. Pure reads; used by the test-only IPC
// `test.ontology.invariants` and the real-data ontology suite after every step.
import { all } from '../../db'
import { getSetting } from '../../settings'
import { ENTITY_TYPES, NODE_TABLE, type NodeType } from './primitives'

export interface Violation { rule: string; detail: string }
export interface InvariantReport { ok: boolean; violations: Violation[]; info: Record<string, number> }

const PAYLOAD_KEYS: [string, NodeType][] = [['companyId', 'company'], ['firmId', 'firm'], ['personId', 'person']]
const PAYLOAD_LISTS: [string, NodeType][] = [['leadInvestorIds', 'firm'], ['participantIds', 'firm']]

export function checkInvariants(): InvariantReport {
  const v: Violation[] = []
  const info: Record<string, number> = {}
  const add = (rule: string, detail: string) => { if (v.length < 500) v.push({ rule, detail }) }
  // state of every node id: live | deleted | merged (absent = nonexistent)
  const state = new Map<string, 'live' | 'deleted' | 'merged'>()
  const typeOf = new Map<string, NodeType>()
  for (const t of [...ENTITY_TYPES, 'thesis'] as NodeType[])
    for (const r of all<{ id: string; merged_into_id: string | null; deleted_at?: number | null }>(`SELECT id, merged_into_id${t === 'thesis' ? '' : ', deleted_at'} FROM ${NODE_TABLE[t]}`)) {
      state.set(r.id, r.merged_into_id ? 'merged' : r.deleted_at ? 'deleted' : 'live'); typeOf.set(r.id, t)
    }
  const nodeOk = (type: string, id: string) => typeOf.get(id) === type && state.get(id) === 'live'
  const why = (type: string, id: string) => (typeOf.get(id) !== type ? (typeOf.has(id) ? `is a ${typeOf.get(id)}` : 'does not exist') : state.get(id))
  const exists = (table: string) => new Set(all<{ id: string }>(`SELECT id FROM ${table}`).map(r => r.id))
  const docs = exists('documents'), evidence = exists('evidence'), notes = exists('notes'), sources = exists('sources')

  // 1. relationship ends
  for (const r of all<{ id: string; from_type: string; from_id: string; to_type: string; to_id: string; rel: string }>('SELECT id, from_type, from_id, rel, to_type, to_id FROM relationships')) {
    for (const [t, x, side] of [[r.from_type, r.from_id, 'from'], [r.to_type, r.to_id, 'to']] as const) {
      const ok = t === 'document' ? docs.has(x) : t === 'evidence' ? evidence.has(x) : t === 'note' ? notes.has(x) : t === 'source' ? sources.has(x) : nodeOk(t, x)
      if (!ok) add('relationship-end-live', `${r.id} ${r.from_type}:${r.from_id} -${r.rel}-> ${r.to_type}:${r.to_id}: ${side} ${['document', 'evidence', 'note', 'source'].includes(t) ? 'does not exist' : why(t, x)}`)
    }
  }
  // 2. aliases belong to live entities
  for (const a of all<{ entity_type: string; entity_id: string; alias: string }>('SELECT entity_type, entity_id, alias FROM aliases'))
    if (!nodeOk(a.entity_type, a.entity_id)) add('alias-owner-live', `alias “${a.alias}” → ${a.entity_type}:${a.entity_id} ${why(a.entity_type, a.entity_id)}`)
  // 3. one live entity per (type, normalized name)
  for (const t of ENTITY_TYPES)
    for (const d of all<{ normalized_name: string; n: number; ids: string }>(`SELECT normalized_name, COUNT(*) n, GROUP_CONCAT(id) ids FROM ${NODE_TABLE[t]} WHERE merged_into_id IS NULL AND deleted_at IS NULL GROUP BY normalized_name HAVING n > 1`))
      add('unique-live-name', `${t} “${d.normalized_name}” × ${d.n}: ${d.ids}`)
  // 4. field values: ≤ 1 current per (object, key); no current value on a merged object
  for (const d of all<{ object_type: string; object_id: string; field_key: string; n: number }>("SELECT object_type, object_id, field_key, COUNT(*) n FROM field_values WHERE status = 'current' GROUP BY object_type, object_id, field_key HAVING n > 1"))
    add('one-current-field', `${d.object_type}:${d.object_id}.${d.field_key} has ${d.n} current values`)
  for (const f of all<{ object_type: string; object_id: string; field_key: string }>("SELECT DISTINCT object_type, object_id, field_key FROM field_values WHERE status IN ('current','proposed')"))
    if (!typeOf.has(f.object_id) || state.get(f.object_id) === 'merged') add('field-owner', `${f.object_type}:${f.object_id}.${f.field_key} ${why(f.object_type, f.object_id)}`)
  // 5. note anchors
  for (const n of all<{ id: string; anchor_type: string; anchor_id: string | null }>("SELECT id, anchor_type, anchor_id FROM notes WHERE deleted_at IS NULL AND anchor_type <> 'none'"))
    if (!n.anchor_id || !nodeOk(n.anchor_type, n.anchor_id)) add('note-anchor-live', `note ${n.id} → ${n.anchor_type}:${n.anchor_id} ${n.anchor_id ? why(n.anchor_type, n.anchor_id) : 'missing id'}`)
  // 6. evidence payload ids: exist and not merged (merges/retypes rewrite them). A soft-deleted entity is allowed —
  //    the evidence records what the article said and Restore needs the id; readers skip deleted entities.
  info.payloadRefsToDeleted = 0
  for (const e of all<{ id: string; payload_json: string }>("SELECT id, payload_json FROM evidence WHERE payload_json LIKE '%Id%'")) {
    let p: any
    try { p = JSON.parse(e.payload_json) } catch { add('evidence-payload-json', `${e.id} payload is not JSON`); continue }
    const refs: [string, NodeType][] = []
    if (p.subjectId && p.subjectType && p.subjectType in NODE_TABLE) refs.push([p.subjectId, p.subjectType])
    for (const [k, t] of PAYLOAD_KEYS) if (typeof p[k] === 'string') refs.push([p[k], t])
    for (const [k, t] of PAYLOAD_LISTS) if (Array.isArray(p[k])) for (const x of p[k]) if (typeof x === 'string') refs.push([x, t])
    for (const [x, t] of refs) {
      const s = typeOf.get(x) === t ? state.get(x) : undefined
      if (s === 'deleted') info.payloadRefsToDeleted++
      else if (s !== 'live') add('evidence-payload-live', `${e.id} payload ${t}:${x} ${why(t, x)}`)
    }
  }
  // 7. feed items reference live documents and a live primary thesis
  for (const f of all<{ id: string; document_id: string; primary_thesis_id: string | null; deleted_at: number | null }>('SELECT f.id, f.document_id, f.primary_thesis_id, d.deleted_at FROM feed_items f LEFT JOIN documents d ON d.id = f.document_id')) {
    if (!docs.has(f.document_id)) add('feed-doc-live', `feed item ${f.id} → missing document ${f.document_id}`)
    if (f.primary_thesis_id && !nodeOk('thesis', f.primary_thesis_id)) add('feed-thesis-live', `feed item ${f.id} → thesis ${f.primary_thesis_id} ${why('thesis', f.primary_thesis_id)}`)
  }
  // 8. thesis tree and pins
  for (const t of all<{ id: string; parent_id: string }>('SELECT id, parent_id FROM theses WHERE merged_into_id IS NULL AND parent_id IS NOT NULL'))
    if (!nodeOk('thesis', t.parent_id)) add('thesis-parent-live', `thesis ${t.id} → parent ${t.parent_id} ${why('thesis', t.parent_id)}`)
  for (const [key, t] of [['pins.companies', 'company'], ['pins.theses', 'thesis']] as const)
    for (const x of getSetting<string[]>(key) || []) if (!nodeOk(t, x)) add('pin-live', `${key} ${x} ${why(t, x)}`)
  info.violations = v.length
  return { ok: v.length === 0, violations: v, info }
}
