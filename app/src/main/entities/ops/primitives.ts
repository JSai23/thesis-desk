// Shared plumbing for ontology operations (DEC-094). Every op that moves things between objects uses these instead of
// hand-rolled SQL loops, so "what moves with an entity" is defined once. All functions run inside the caller's
// transaction and return what they moved, so the op can record it in `history` for undo.
import { all, one, run } from '../../db'
import { now } from '../../clock'
import { emit } from '../../events'
import { writeHistory } from '../../history'
import { invalidateNameCache } from '../../ai/grounding'
import { upsertFeedItem } from '../../feed'
import { addAlias, TABLE, type EntityType } from '../resolve'
import { resolveCurrent } from '../fields'

export type NodeType = EntityType | 'thesis'
export const NODE_TABLE: Record<NodeType, string> = { ...TABLE, thesis: 'theses' }
export const ENTITY_TYPES: EntityType[] = ['company', 'firm', 'person']
export const LABEL: Record<NodeType, string> = { company: 'company', firm: 'firm', person: 'person', thesis: 'thesis' }

export interface RelRow { id: string; from_type: string; from_id: string; rel: string; to_type: string; to_id: string; origin: string; status: string; stance: string | null; [k: string]: unknown }

// ---------------------------------------------------------------- change tracking → events after commit
/** What an op touched; `afterChange` turns it into cache invalidation, feed refresh and events once, after commit. */
export class ChangeSet {
  objects = new Map<string, { type: string; id: string }>()
  docs = new Set<string>()
  names = false
  feed = false
  touch(type: string, id: string): this { this.objects.set(`${type}:${id}`, { type, id }); return this }
  doc(...ids: string[]): this { for (const d of ids) this.docs.add(d); return this }
  /** Documents whose feed item reasons/chips mention this object (document links and evidence subjects). */
  docsOf(type: NodeType, id: string): this { return this.doc(...docsLinkedTo(type, id)) }
}

export function afterChange(cs: ChangeSet): void {
  if (cs.names) invalidateNameCache()
  for (const d of cs.docs) upsertFeedItem(d)
  if (cs.objects.size) for (const o of cs.objects.values()) emit('object.updated', o)
  else emit('object.updated', {})
  if (cs.docs.size || cs.feed) emit('feed.updated', {})
}

export function docsLinkedTo(type: NodeType, id: string): string[] {
  return all<{ d: string }>(`SELECT from_id d FROM relationships WHERE from_type = 'document' AND to_type = ? AND to_id = ?
    UNION SELECT e.document_id d FROM relationships r JOIN evidence e ON e.id = r.from_id WHERE r.from_type = 'evidence' AND r.to_type = ? AND r.to_id = ?`, type, id, type, id).map(r => r.d)
}

// ---------------------------------------------------------------- lookups
export function liveRow<T = any>(type: NodeType, id: string): T | undefined {
  return type === 'thesis'
    ? one<T>('SELECT * FROM theses WHERE id = ? AND merged_into_id IS NULL', id)
    : one<T>(`SELECT * FROM ${TABLE[type]} WHERE id = ? AND merged_into_id IS NULL AND deleted_at IS NULL`, id)
}

/** The type of an id across companies/firms/people/theses (ids are prefixed, but the tables are the truth). */
export function typeOfId(id: string | null | undefined): NodeType | null {
  if (!id) return null
  for (const t of [...ENTITY_TYPES, 'thesis'] as NodeType[]) if (one(`SELECT 1 FROM ${NODE_TABLE[t]} WHERE id = ?`, id)) return t
  return null
}

export function nameOf(type: NodeType, id: string): string {
  return type === 'thesis' ? one<{ title: string }>('SELECT title FROM theses WHERE id = ?', id)?.title || id : one<{ name: string }>(`SELECT name FROM ${TABLE[type]} WHERE id = ?`, id)?.name || id
}

/** Live entity of this type with this normalized name, other than `exceptId`. */
export function sameNamed(type: EntityType, normalized: string, exceptId?: string): { id: string; name: string } | undefined {
  return one(`SELECT id, name FROM ${TABLE[type]} WHERE normalized_name = ? AND id <> ? AND merged_into_id IS NULL AND deleted_at IS NULL`, normalized, exceptId ?? '')
}

// ---------------------------------------------------------------- relationships
const rank = (x: RelRow) => (x.status === 'rejected' ? 4 : x.origin === 'user' ? 3 : x.status === 'accepted' ? 2 : x.status === 'suggested' ? 1 : 0)

/**
 * Repoint relationship ends that reference (type, fromId) to (toType, toId). A row that would duplicate an existing one
 * is folded into it (the user's decision / accepted status wins, supporting evidence is unioned); a row that would
 * become a self-loop is dropped. `filter` limits which rows move (split). Returns the ids of rows that now point at the
 * target (moved or folded-into) and of rows dropped.
 */
export function moveEnds(type: NodeType, fromId: string, toType: NodeType, toId: string, filter?: (r: RelRow) => boolean): { moved: string[]; folded: string[]; dropped: string[] } {
  const t = now()
  const out = { moved: [] as string[], folded: [] as string[], dropped: [] as string[] }
  for (const side of ['from', 'to'] as const) {
    for (const r of all<RelRow>(`SELECT * FROM relationships WHERE ${side}_type = ? AND ${side}_id = ?`, type, fromId)) {
      if (filter && !filter(r)) continue
      const key = side === 'from' ? [toType, toId, r.rel, r.to_type, r.to_id] : [r.from_type, r.from_id, r.rel, toType, toId]
      if (key[0] === key[3] && key[1] === key[4]) { dropRel(r.id); out.dropped.push(r.id); continue }
      const dup = one<RelRow>('SELECT * FROM relationships WHERE from_type = ? AND from_id = ? AND rel = ? AND to_type = ? AND to_id = ?', ...key)
      if (dup) {
        if (rank(r) > rank(dup)) run('UPDATE relationships SET origin = ?, status = ?, stance = COALESCE(?, stance), updated_at = ? WHERE id = ?', r.origin, r.status, r.stance, t, dup.id)
        for (const re of all<any>('SELECT * FROM relationship_evidence WHERE relationship_id = ?', r.id))
          run('INSERT INTO relationship_evidence(relationship_id, evidence_id, status, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(relationship_id, evidence_id) DO NOTHING', dup.id, re.evidence_id, re.status, re.created_at)
        dropRel(r.id)
        out.folded.push(dup.id)
      } else {
        run(`UPDATE relationships SET ${side}_type = ?, ${side}_id = ?, updated_at = ? WHERE id = ?`, toType, toId, t, r.id)
        out.moved.push(r.id)
      }
    }
  }
  return out
}

export function dropRel(id: string): void {
  run('DELETE FROM relationship_evidence WHERE relationship_id = ?', id)
  run('DELETE FROM relationships WHERE id = ?', id)
}

// ---------------------------------------------------------------- aliases
/** Move aliases of (type, fromId) to (toType, toId). Across types an alias key the target type already uses elsewhere is dropped. */
export function moveAliases(type: EntityType, fromId: string, toType: EntityType, toId: string, filter?: (alias: string) => boolean): string[] {
  const moved: string[] = []
  for (const a of all<{ alias: string; alias_normalized: string; origin: 'source_fact' | 'user' | 'merge' }>('SELECT alias, alias_normalized, origin FROM aliases WHERE entity_type = ? AND entity_id = ?', type, fromId)) {
    if (filter && !filter(a.alias)) continue
    if (type === toType) run('UPDATE aliases SET entity_id = ? WHERE entity_type = ? AND alias_normalized = ?', toId, type, a.alias_normalized)
    else { run('DELETE FROM aliases WHERE entity_type = ? AND alias_normalized = ?', type, a.alias_normalized); addAlias(toType, toId, a.alias, a.origin) }
    moved.push(a.alias)
  }
  return moved
}

// ---------------------------------------------------------------- field values
/**
 * Move field values of (type, fromId) to (toType, toId) and re-resolve the current value on both (§1B.13.3).
 * `keys` limits to fields the target type has; `evidenceIds` limits to values from that evidence (split).
 * A user-origin current value moving onto an object that has its own user value becomes `proposed` (merge rule).
 */
export function moveFieldValues(type: NodeType, fromId: string, toType: NodeType, toId: string, o: { keys?: Set<string>; evidenceIds?: Set<string> } = {}): string[] {
  const rows = all<{ id: string; field_key: string; origin: string; status: string; evidence_id: string | null }>('SELECT id, field_key, origin, status, evidence_id FROM field_values WHERE object_type = ? AND object_id = ?', type, fromId)
    .filter(r => (!o.keys || o.keys.has(r.field_key)) && (!o.evidenceIds || (r.evidence_id && o.evidenceIds.has(r.evidence_id))))
  const keys = new Set(rows.map(r => r.field_key))
  for (const key of keys) {
    const fromUser = rows.find(r => r.field_key === key && r.origin === 'user' && r.status === 'current')
    const intoUser = one<{ id: string }>("SELECT id FROM field_values WHERE object_type = ? AND object_id = ? AND field_key = ? AND origin = 'user' AND status = 'current'", toType, toId, key)
    for (const r of rows.filter(x => x.field_key === key))
      run("UPDATE field_values SET object_type = ?, object_id = ?, status = CASE WHEN status = 'current' THEN 'superseded' ELSE status END WHERE id = ?", toType, toId, r.id)
    if (fromUser && intoUser) run("UPDATE field_values SET status = 'proposed' WHERE id = ?", fromUser.id)
    else if (fromUser) { run("UPDATE field_values SET status = 'superseded' WHERE object_type = ? AND object_id = ? AND field_key = ? AND status = 'current'", toType, toId, key); run("UPDATE field_values SET status = 'current' WHERE id = ?", fromUser.id) }
    else resolveCurrent(toType, toId, key)
    resolveCurrent(type, fromId, key)
  }
  return rows.map(r => r.id)
}

// ---------------------------------------------------------------- notes, evidence payloads, settings
export function moveNotes(type: NodeType, fromId: string, toType: NodeType | 'none', toId: string | null): string[] {
  const ids = all<{ id: string }>('SELECT id FROM notes WHERE anchor_type = ? AND anchor_id = ?', type, fromId).map(r => r.id)
  for (const id of ids) run('UPDATE notes SET anchor_type = ?, anchor_id = ?, updated_at = ? WHERE id = ?', toType, toId, now(), id)
  return ids
}

/** Rewrite an entity id inside evidence payloads (subjectId, companyId, firmId, personId, investor id lists). Ids are prefixed and unique, so a textual replace is exact. */
export function rewriteEvidencePayloadIds(fromId: string, toId: string, evidenceIds?: string[]): string[] {
  const rows = evidenceIds
    ? evidenceIds.map(id => one<{ id: string; payload_json: string }>('SELECT id, payload_json FROM evidence WHERE id = ?', id)).filter((r): r is { id: string; payload_json: string } => !!r && r.payload_json.includes(fromId))
    : all<{ id: string; payload_json: string }>('SELECT id, payload_json FROM evidence WHERE payload_json LIKE ?', `%${fromId}%`)
  for (const e of rows) run('UPDATE evidence SET payload_json = ? WHERE id = ?', e.payload_json.split(fromId).join(toId), e.id)
  return rows.map(r => r.id)
}

const TYPED_KEY: Record<string, EntityType> = { companyId: 'company', firmId: 'firm', personId: 'person' }
const KEY_OF: Record<EntityType, string> = { company: 'companyId', firm: 'firmId', person: 'personId' }
const FIRM_LISTS = ['leadInvestorIds', 'participantIds']

/**
 * Change type: rewrite an entity id in evidence payloads keeping each key's type right — subjectId/subjectType follow,
 * companyId ↔ firmId move to the key of the new type (dropped when that key already names someone else), and a
 * company can't stay in a firm-only investor list. Returns [evidenceId, before, after] so undo can restore exactly.
 */
export function retypeEvidencePayloads(fromId: string, toId: string, toType: EntityType): [string, string, string][] {
  const out: [string, string, string][] = []
  for (const e of all<{ id: string; payload_json: string }>('SELECT id, payload_json FROM evidence WHERE payload_json LIKE ?', `%${fromId}%`)) {
    const p = JSON.parse(e.payload_json)
    if (p.subjectId === fromId) { p.subjectId = toId; p.subjectType = toType }
    for (const [k, t] of Object.entries(TYPED_KEY)) {
      if (p[k] !== fromId) continue
      if (t === toType) { p[k] = toId; continue }
      delete p[k]
      if (!p[KEY_OF[toType]]) p[KEY_OF[toType]] = toId
    }
    for (const k of FIRM_LISTS) if (Array.isArray(p[k]) && p[k].includes(fromId)) p[k] = toType === 'firm' ? p[k].map((x: string) => (x === fromId ? toId : x)) : p[k].filter((x: string) => x !== fromId)
    let after = JSON.stringify(p)
    if (after.includes(fromId)) after = after.split(fromId).join(toId)   // any other (untyped) mention follows textually
    run('UPDATE evidence SET payload_json = ? WHERE id = ?', after, e.id)
    out.push([e.id, e.payload_json, after])
  }
  return out
}

/** Put back payloads a retype rewrote, where nothing changed them since. Returns how many were restored. */
export function restorePayloads(snapshot: [string, string, string][]): number {
  let n = 0
  for (const [id, before, after] of snapshot) n += run('UPDATE evidence SET payload_json = ? WHERE id = ? AND payload_json = ?', before, id, after).changes
  return n
}

/** Replace/remove an id in a settings id list (pins). Returns whether it was present. */
export function replaceInList(get: () => string[], set: (v: string[]) => void, fromId: string, toId: string | null): boolean {
  const cur = get()
  if (!cur.includes(fromId)) return false
  set([...new Set(cur.flatMap(x => (x === fromId ? (toId ? [toId] : []) : [x])))])
  return true
}

/** Open entity_merge suggestions naming `fromId`: repoint to `toId` (closing ones that become a self-merge), or expire them when `toId` is null. */
export function retargetSuggestions(fromId: string, toId: string | null): string[] {
  const t = now()
  const rows = all<{ id: string; payload_json: string; target_id: string | null }>("SELECT id, payload_json, target_id FROM suggestions WHERE type = 'entity_merge' AND status = 'open' AND (target_id = ? OR payload_json LIKE ?)", fromId, `%${fromId}%`)
  for (const s of rows) {
    if (!toId) { run("UPDATE suggestions SET status = 'expired', resolved_at = ? WHERE id = ?", t, s.id); continue }
    const pl = JSON.parse(s.payload_json.split(fromId).join(toId))
    if (pl.fromId === pl.intoId) run("UPDATE suggestions SET status = 'accepted', resolved_at = ? WHERE id = ?", t, s.id)
    else run('UPDATE suggestions SET payload_json = ?, target_id = ? WHERE id = ?', JSON.stringify(pl), s.target_id === fromId ? toId : s.target_id, s.id)
  }
  return rows.map(r => r.id)
}

// ---------------------------------------------------------------- audit
/** One history row per op (B-DATA-007); `before`/`after` hold what the op's inverse needs. */
export const audit = (type: string, id: string, action: string, before: unknown, after: unknown): string => writeHistory(type, id, action, before, after)
