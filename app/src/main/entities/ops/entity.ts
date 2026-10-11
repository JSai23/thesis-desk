// Entity operations (companies, firms, people): create, rename, merge, split, change type, delete, restore (DEC-094).
import { z } from 'zod'
import { all, one, run } from '../../db'
import { now } from '../../clock'
import { AppError } from '../../errors'
import { getSetting, setSetting } from '../../settings'
import { enqueueProcess } from '../../ingest/pipeline'
import { splitNames, startHydrate } from '../../objects/hydrate'
import { getDetails, writeDetails, siteOf } from '../../objects/details'
import { setEnabled as setSourceEnabled } from '../../sources'
import { TABLE, addAlias, aliasKey, createEntity, jaroWinkler, normalizeName, resolveDeterministic, type EntityType } from '../resolve'
import { defineOp } from './types'
import {
  audit, dropRel, liveRow, moveAliases, moveEnds, moveFieldValues, moveNotes, nameOf, replaceInList, retargetSuggestions,
  restorePayloads, retypeEvidencePayloads, rewriteEvidencePayloadIds, sameNamed, LABEL, NODE_TABLE, type ChangeSet, type NodeType, type RelRow
} from './primitives'

const id = z.string().min(1)
const entityType = z.enum(['company', 'firm', 'person'])
const orgType = z.enum(['company', 'firm'])
const pinsGet = () => getSetting<string[]>('pins.companies') || []
const pinsSet = (v: string[]) => setSetting('pins.companies', v)
const other = (t: 'company' | 'firm'): 'company' | 'firm' => (t === 'company' ? 'firm' : 'company')
const notFound = (type: string) => new AppError('NOT_FOUND', `${type[0].toUpperCase() + type.slice(1)} not found`)
const entityOf = (typeOf: (id: string | null) => NodeType | null, x: string | null, ...allowed: NodeType[]) => {
  const t = typeOf(x)
  if (!x || !t || (allowed.length && !allowed.includes(t))) throw `objectId must be a listed ${allowed.join(' or ') || 'company, firm or person'}`
  return t as EntityType
}

// ---------------------------------------------------------------- entity.create
/** Add a company/firm by name ("A / B" or "A (B)" gives aliases). If the sources already surfaced it, that entity is
 *  reused (no duplicate); either way HYDRATE_OBJECT gathers its coverage and follows it (DEC-088). */
export const create = defineOp({
  name: 'entity.create',
  // website / about: the optional hints the Add sheet offers (DEC-099) — the user's layer, used by the lookup
  input: z.object({ type: entityType, name: z.string().min(1), website: z.string().max(300).optional(), about: z.string().max(2000).optional() }),
  validate: i => (splitNames(i.name).name ? [] : ['Enter a name']),
  describe: i => `Add ${splitNames(i.name).name} as a ${LABEL[i.type]}?`,
  apply: (i, cs) => {
    const { name: nm, aliases } = splitNames(i.name)
    const near = (n: string) => {
      const k = normalizeName(n)
      return all<{ id: string; normalized_name: string }>(`SELECT id, normalized_name FROM ${TABLE[i.type]} WHERE merged_into_id IS NULL AND deleted_at IS NULL`)
        .map(c => ({ id: c.id, s: jaroWinkler(k, c.normalized_name) })).filter(x => x.s >= 0.96).sort((a, b) => b.s - a.s)[0]?.id || null
    }
    const found = [nm, ...aliases].map(n => resolveDeterministic(i.type, n) || near(n)).find(Boolean) || null
    const eid = found || createEntity(i.type, nm, { origin: 'user' })
    for (const a of [nm, ...aliases]) addAlias(i.type, eid, a, 'user')
    // what the user typed is theirs even if coverage already used that spelling (site checks trust only user names)
    for (const a of [nm, ...aliases]) run("UPDATE aliases SET origin = 'user' WHERE entity_type = ? AND entity_id = ? AND alias_normalized = ?", i.type, eid, aliasKey(a))
    // reusing "Sequoia" when the user typed "Sequoia Capital": the fuller name they typed becomes the display name
    if (found) {
      const cur = nameOf(i.type, eid)
      if (cur && normalizeName(cur) === normalizeName(nm) && nm.length > cur.length && nm.toLowerCase().startsWith(cur.toLowerCase())) {
        run(`UPDATE ${TABLE[i.type]} SET name = ?, updated_at = ? WHERE id = ?`, nm, now(), eid)
        addAlias(i.type, eid, cur, 'source_fact')
      }
    }
    if (i.website?.trim() || i.about?.trim()) {
      const d = getDetails(i.type, eid)
      writeDetails(i.type, eid, { ...d, website: i.type === 'person' ? d.website : siteOf(i.website) || d.website, about: i.about?.trim() || d.about })
      const site = i.type === 'person' ? null : siteOf(i.website)
      if (site) run(`UPDATE ${TABLE[i.type]} SET domain = ?, updated_at = ? WHERE id = ?`, site, now(), eid)
    }
    const hydrateJobId = startHydrate(i.type, eid)
    const name = found ? nameOf(i.type, eid) : nm
    audit(i.type, eid, 'entity.created', null, { name, input: i.name, existing: !!found })
    cs.touch(i.type, eid).names = true
    return { id: eid, name, existing: !!found, hydrateJobId }
  },
  chat: {
    action: 'create_entity',
    line: 'the user wants to start tracking / add a company or firm (usually not among the candidates): objectType = "company" or "firm" (a VC, fund or investor is a firm), value = its name exactly as the user wrote it.',
    toInput: s => {
      if (s.objectType !== 'company' && s.objectType !== 'firm') throw 'create_entity needs objectType company or firm'
      if (!s.value?.trim()) throw 'create_entity needs value (the name)'
      return { type: s.objectType as 'company' | 'firm', name: s.value.trim() }
    }
  }
})

// ---------------------------------------------------------------- entity.rename
export const rename = defineOp({
  name: 'entity.rename',
  input: z.object({ type: entityType, id, name: z.string(), dropAliases: z.array(z.string()).optional() }),
  validate: i => {
    const row = liveRow<{ name: string }>(i.type, i.id)
    const nm = i.name.trim()
    if (!row) return [notFound(i.type)]
    if (!nm) return ['Enter a name']
    if (nm === row.name) return [`It is already called ${nm}`]
    const dup = sameNamed(i.type, normalizeName(nm), i.id)
    if (dup) return [`${dup.name} is already a ${LABEL[i.type]} — merge them instead`]
    const owner = one<{ entity_id: string }>('SELECT entity_id FROM aliases WHERE entity_type = ? AND alias_normalized = ?', i.type, aliasKey(nm))
    if (owner && owner.entity_id !== i.id) return [`“${nm}” is another ${LABEL[i.type]}'s name (${nameOf(i.type, owner.entity_id)}) — merge them instead`]
    return []
  },
  describe: i => `Rename ${nameOf(i.type, i.id)} to ${i.name.trim()}?`,
  apply: (i, cs) => {
    const row = liveRow<{ name: string }>(i.type, i.id)!
    const nm = i.name.trim()
    const hadAlias = !!one('SELECT 1 FROM aliases WHERE entity_type = ? AND alias_normalized = ?', i.type, aliasKey(nm))
    run(`UPDATE ${TABLE[i.type]} SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ?`, nm, normalizeName(nm), now(), i.id)
    addAlias(i.type, i.id, row.name, 'user')   // the old name stays findable (sources keep using it)
    addAlias(i.type, i.id, nm, 'user')
    for (const a of i.dropAliases || []) if (aliasKey(a) !== aliasKey(nm)) run('DELETE FROM aliases WHERE entity_type = ? AND entity_id = ? AND alias_normalized = ?', i.type, i.id, aliasKey(a))
    audit(i.type, i.id, 'entity.renamed', { name: row.name }, { name: nm, aliasAdded: hadAlias ? null : nm })
    cs.touch(i.type, i.id).docsOf(i.type, i.id).names = true
    return { id: i.id, name: nm }
  },
  undo: {
    'entity.renamed': h => {
      const cur = liveRow<{ name: string }>(h.entity_type as EntityType, h.entity_id)
      if (!cur) return 'It no longer exists'
      if (cur.name !== h.after.name) return `It was renamed again since (now ${cur.name})`
      return { op: 'entity.rename', input: { type: h.entity_type, id: h.entity_id, name: h.before.name, dropAliases: h.after.aliasAdded ? [h.after.aliasAdded] : [] } }
    }
  },
  chat: {
    action: 'rename_entity',
    line: 'a listed company/firm/person should be called something else (a rebrand, a misspelling): objectId, value = the new name exactly as the user wrote it.',
    toInput: (s, typeOf) => {
      if (!s.value?.trim()) throw 'rename_entity needs value (the new name)'
      return { type: entityOf(typeOf, s.objectId, 'company', 'firm', 'person'), id: s.objectId!, name: s.value.trim() }
    }
  }
})

// ---------------------------------------------------------------- entity.merge (irreversible, §1B.13.4)
export const merge = defineOp({
  name: 'entity.merge',
  input: z.object({ type: entityType, fromId: id, intoId: id }),
  validate: i => {
    if (i.fromId === i.intoId) return ['Pick two different entries']
    if (!liveRow(i.type, i.fromId) || !liveRow(i.type, i.intoId)) return [new AppError('NOT_FOUND', 'Entity not found')]
    return []
  },
  describe: i => `Merge ${nameOf(i.type, i.fromId)} into ${nameOf(i.type, i.intoId)}?`,
  apply: (i, cs) => mergeInto(i.type, i.fromId, i.intoId, cs),
  chat: {
    action: 'merge_entities',
    line: 'two listed candidates of the same type are the same entity: fromId merges into intoId.',
    toInput: (s, typeOf) => {
      const a = typeOf(s.fromId), b = typeOf(s.intoId)
      if (!s.fromId || !s.intoId || s.fromId === s.intoId) throw 'merge needs two different ids'
      if (!a || a === 'thesis' || a !== b) throw 'merge_entities needs two candidates of the same type; to move a company to firms (or back) use change_type'
      return { type: a, fromId: s.fromId, intoId: s.intoId }
    }
  }
})

function mergeInto(type: EntityType, fromId: string, intoId: string, cs: ChangeSet): { ok: true; id: string } {
  const table = TABLE[type]
  const from = liveRow<any>(type, fromId)!, into = liveRow<any>(type, intoId)!
  const t = now()
  cs.docsOf(type, fromId).docsOf(type, intoId)
  moveEnds(type, fromId, type, intoId)
  moveFieldValues(type, fromId, type, intoId)
  moveAliases(type, fromId, type, intoId)
  addAlias(type, intoId, from.name, 'merge')
  moveNotes(type, fromId, type, intoId)
  if (type !== 'person' && from.domain && !into.domain) { run(`UPDATE ${table} SET domain = NULL WHERE id = ?`, fromId); run(`UPDATE ${table} SET domain = ? WHERE id = ?`, from.domain, intoId) }
  if (from.followed && !into.followed) run(`UPDATE ${table} SET followed = 1, followed_at = ? WHERE id = ?`, from.followed_at || t, intoId)
  if (type === 'company') replaceInList(pinsGet, pinsSet, fromId, intoId)
  rewriteEvidencePayloadIds(fromId, intoId)
  run(`UPDATE ${table} SET merged_into_id = ?, updated_at = ? WHERE id = ?`, intoId, t, fromId)
  run(`UPDATE ${table} SET updated_at = ? WHERE id = ?`, t, intoId)
  retargetSuggestions(fromId, intoId)
  audit(type, intoId, 'merge', { mergedId: fromId, name: from.name }, { into: intoId, name: into.name })
  cs.touch(type, intoId).touch(type, fromId).names = true
  return { ok: true, id: intoId }
}

// ---------------------------------------------------------------- entity.split (DEC-089)
/**
 * `newName` is a different entity from `id` (a homonym, a former merge, a product taken for the company). Creates it
 * (or reuses a live one of that name), then moves what came only from documents that name it and not the original:
 * document links, evidence subjects, relationships supported only by that evidence, and field values. Documents naming
 * both are re-read so extraction can tell them apart with both entities known.
 */
export const split = defineOp({
  name: 'entity.split',
  input: z.object({ type: entityType, id, newName: z.string() }),
  validate: i => {
    const old = liveRow<{ name: string; normalized_name: string }>(i.type, i.id)
    if (!old) return [notFound(i.type)]
    if (!i.newName.trim()) return ['Name the other entity']
    if (normalizeName(i.newName) === old.normalized_name) return [`That is ${old.name}'s own name`]
    return []
  },
  describe: i => `Split ${i.newName.trim()} out of ${nameOf(i.type, i.id)} as a separate ${LABEL[i.type]}?`,
  apply: (i, cs) => {
    const table = TABLE[i.type]
    const old = liveRow<any>(i.type, i.id)!
    const nm = i.newName.trim()
    const t = now()
    const oldNames = [old.name, ...all<{ alias: string }>('SELECT alias FROM aliases WHERE entity_type = ? AND entity_id = ?', i.type, i.id).map(a => a.alias)]
      .filter(n => normalizeName(n) !== normalizeName(nm)).map(n => n.toLowerCase())
    const existing = one<{ id: string }>(`SELECT id FROM ${table} WHERE normalized_name = ? AND merged_into_id IS NULL AND deleted_at IS NULL`, normalizeName(nm))?.id
    const newId = existing || createEntity(i.type, nm, { origin: 'user' })
    const movedAliases = moveAliases(i.type, i.id, i.type, newId, a => aliasKey(a) === aliasKey(nm))
    addAlias(i.type, newId, nm, 'user')
    const docs = all<{ id: string; text: string }>(`SELECT DISTINCT d.id, d.text FROM relationships r JOIN documents d ON d.id = r.from_id WHERE r.from_type = 'document' AND r.to_type = ? AND r.to_id = ?`, i.type, i.id)
    const moveDocs: string[] = [], both: string[] = []
    for (const d of docs) {
      const low = d.text.toLowerCase(), newLow = nm.toLowerCase()
      // "Mercury" inside "Mercury Insurance" is not a mention of Mercury: look for the old names outside the new one
      const hasNew = low.includes(newLow), hasOld = oldNames.some(n => low.split(newLow).join(' ').includes(n))
      if (hasNew && !hasOld) moveDocs.push(d.id); else if (hasNew) both.push(d.id)
    }
    const evIds = moveDocs.length ? all<{ id: string }>(`SELECT id FROM evidence WHERE document_id IN (${moveDocs.map(() => '?').join(',')})`, ...moveDocs).map(e => e.id) : []
    const evSet = new Set(evIds), docSet = new Set(moveDocs)
    const support = (relId: string) => all<{ evidence_id: string }>('SELECT evidence_id FROM relationship_evidence WHERE relationship_id = ?', relId).map(x => x.evidence_id)
    const ends = moveEnds(i.type, i.id, i.type, newId, (r: RelRow) => {
      const s = support(r.id)
      return (r.from_type === 'document' && docSet.has(r.from_id)) || (r.from_type === 'evidence' && evSet.has(r.from_id)) || (s.length > 0 && s.every(e => evSet.has(e)))
    })
    const movedFv = moveFieldValues(i.type, i.id, i.type, newId, { evidenceIds: evSet })
    const payloads = rewriteEvidencePayloadIds(i.id, newId, evIds)
    for (const d of both) { run('UPDATE documents SET ai_generation = ai_generation + 1, updated_at = ? WHERE id = ?', t, d); enqueueProcess(d, { skipTriage: true, priority: 2 }) }
    audit(i.type, i.id, 'split', { name: old.name }, { newId, newName: nm, created: !existing, movedDocuments: moveDocs.length, reread: both.length, movedRels: [...ends.moved, ...ends.folded], movedFv, movedAliases, payloads })
    cs.touch(i.type, i.id).touch(i.type, newId).doc(...moveDocs).names = true
    return { id: newId, moved: ends.moved.length + ends.folded.length, reread: both.length }
  },
  undo: {
    split: h => h.after.created
      ? { op: 'entity.merge', input: { type: h.entity_type, fromId: h.after.newId, intoId: h.entity_id } }
      : `${h.after.newName} existed before the split, so undoing it would merge two real entities — merge them yourself if that's right`
  },
  chat: {
    action: 'split_entity',
    line: "the user says a candidate is wrongly combined with a different entity of the same type (a homonym, a different company, a product or former name that is NOT the same): objectId = that candidate, value = the other entity's name exactly as the user wrote it.",
    toInput: (s, typeOf) => {
      if (!s.value?.trim()) throw "split_entity needs objectId and value (the other entity's name)"
      return { type: entityOf(typeOf, s.objectId, 'company', 'firm', 'person'), id: s.objectId!, newName: s.value.trim() }
    }
  }
})

// ---------------------------------------------------------------- entity.changeType (DEC-089)
/**
 * A company that is really an investment firm, or the reverse. The entity is recreated under the other type — or
 * folded into a live one of that name — with its aliases, links, evidence subjects, notes and the fields that type
 * has; the old row is retired (deleted_at). `into` (used by undo) names the target row, reviving it if retired.
 */
export const changeType = defineOp({
  name: 'entity.changeType',
  input: z.object({ type: orgType, id, into: z.string().optional(), revertOf: z.string().optional() }),
  validate: i => {
    const row = liveRow<{ normalized_name: string }>(i.type, i.id)
    if (!row) return [notFound(i.type)]
    if (i.into) {
      const t = one<{ merged_into_id: string | null; deleted_at: number | null; normalized_name: string }>(`SELECT merged_into_id, deleted_at, normalized_name FROM ${TABLE[other(i.type)]} WHERE id = ?`, i.into)
      if (!t || t.merged_into_id) return [notFound(other(i.type))]
      if (t.deleted_at && sameNamed(other(i.type), t.normalized_name, i.into)) return [`A live ${LABEL[other(i.type)]} named ${nameOf(i.type, i.id)} exists now — merge instead`]
    }
    return []
  },
  describe: i => `List ${nameOf(i.type, i.id)} as ${i.type === 'company' ? 'an investment firm' : 'a company'} instead of ${i.type === 'company' ? 'a company' : 'a firm'}?`,
  apply: (i, cs) => {
    const fromType = i.type, toType = other(i.type)
    const old = liveRow<any>(fromType, i.id)!
    const t = now()
    let nid: string, created = false
    if (i.into) {
      nid = i.into
      const target = one<{ deleted_at: number | null; domain: string | null }>(`SELECT deleted_at, domain FROM ${TABLE[toType]} WHERE id = ?`, nid)!
      if (target.deleted_at) {
        const domainTaken = target.domain && one(`SELECT 1 FROM ${TABLE[toType]} WHERE domain = ? AND id <> ? AND merged_into_id IS NULL AND deleted_at IS NULL`, target.domain, nid)
        run(`UPDATE ${TABLE[toType]} SET deleted_at = NULL, domain = ?, updated_at = ? WHERE id = ?`, domainTaken ? null : target.domain, t, nid)
      }
    } else {
      const existing = sameNamed(toType, old.normalized_name)?.id
      nid = existing || createEntity(toType, old.name, { origin: old.created_origin === 'user' ? 'user' : 'source_fact', domain: old.domain })
      created = !existing
    }
    cs.docsOf(fromType, i.id)
    if (old.followed) run(`UPDATE ${TABLE[toType]} SET followed = 1, followed_at = COALESCE(followed_at, ?) WHERE id = ?`, old.followed_at || t, nid)
    if (!created && old.domain && !one(`SELECT 1 FROM ${TABLE[toType]} WHERE domain = ? AND merged_into_id IS NULL AND deleted_at IS NULL`, old.domain))
      run(`UPDATE ${TABLE[toType]} SET domain = COALESCE(domain, ?) WHERE id = ?`, old.domain, nid)
    const aliases = moveAliases(fromType, i.id, toType, nid)
    const ends = moveEnds(fromType, i.id, toType, nid)
    const keys = new Set(all<{ key: string }>('SELECT key FROM field_defs WHERE object_type = ? AND deleted_at IS NULL', toType).map(f => f.key))
    const fvs = moveFieldValues(fromType, i.id, toType, nid, { keys })
    const notes = moveNotes(fromType, i.id, toType, nid)
    // undo: first put back exactly the payloads the original retype rewrote, then retype any later references
    const revert = i.revertOf ? one<{ after_json: string }>("SELECT after_json FROM history WHERE id = ? AND action = 'retype'", i.revertOf) : undefined
    const restored = revert ? restorePayloads(JSON.parse(revert.after_json).payloads || []) : 0
    const payloads = retypeEvidencePayloads(i.id, nid, toType)
    const pinned = fromType === 'company' && replaceInList(pinsGet, pinsSet, i.id, null)
    retargetSuggestions(i.id, null)
    run(`UPDATE ${TABLE[fromType]} SET deleted_at = ?, updated_at = ? WHERE id = ?`, t, t, i.id)
    audit(toType, nid, 'retype', { type: fromType, id: i.id, name: old.name, pinned }, { type: toType, id: nid, created, aliases, movedRels: ends.moved.length + ends.folded.length, fieldValues: fvs.length, notes: notes.length, payloads, restoredPayloads: restored })
    cs.touch(toType, nid).touch(fromType, i.id).docsOf(toType, nid).names = true
    return { type: toType, id: nid }
  },
  undo: {
    retype: h => h.after.created
      ? { op: 'entity.changeType', input: { type: h.after.type, id: h.entity_id, into: h.before.id, revertOf: h.id } }
      : `It was combined with an existing ${LABEL[h.after.type as NodeType]} of the same name, so it can't be separated automatically`
  },
  chat: {
    action: 'change_type',
    line: 'the user says a listed company is really an investment firm (VC, fund, investor) or a listed firm is really a company: objectId = that candidate (only this action — never merge across types).',
    toInput: (s, typeOf) => ({ type: entityOf(typeOf, s.objectId, 'company', 'firm') as 'company' | 'firm', id: s.objectId! })
  }
})

// ---------------------------------------------------------------- entity.delete / entity.restore
/**
 * Soft delete: the row gets deleted_at; its relationships (with their supporting-evidence rows), aliases, note anchors
 * and pin are removed and snapshotted into the history row, so `entity.restore` (or Undo) puts them back. Evidence and
 * documents stay — they are what the sources said; their payloads may still name the deleted id (readers skip deleted
 * entities). Field values stay on the row. The news watch / site sources hydration created for it are paused (resumed on
 * restore). A later mention of the same name creates a new entity.
 */
export const del = defineOp({
  name: 'entity.delete',
  input: z.object({ type: entityType, id }),
  validate: i => (liveRow(i.type, i.id) ? [] : [notFound(i.type)]),
  describe: i => `Delete ${LABEL[i.type]} ${nameOf(i.type, i.id)}?`,
  apply: (i, cs) => {
    const row = liveRow<any>(i.type, i.id)!
    const t = now()
    cs.docsOf(i.type, i.id)
    const rels = all<RelRow>('SELECT * FROM relationships WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)', i.type, i.id, i.type, i.id)
    const relEv = rels.flatMap(r => all<any>('SELECT * FROM relationship_evidence WHERE relationship_id = ?', r.id))
    for (const r of rels) dropRel(r.id)
    const aliases = all<any>('SELECT * FROM aliases WHERE entity_type = ? AND entity_id = ?', i.type, i.id)
    run('DELETE FROM aliases WHERE entity_type = ? AND entity_id = ?', i.type, i.id)
    const notes = moveNotes(i.type, i.id, 'none', null)
    const pinned = i.type === 'company' && replaceInList(pinsGet, pinsSet, i.id, null)
    const suggestions = retargetSuggestions(i.id, null)
    const pausedSources = watchSources(i.id)   // stop watching the news for something the user deleted
    for (const s of pausedSources) setSourceEnabled(s, false)
    run(`UPDATE ${TABLE[i.type]} SET deleted_at = ?, updated_at = ? WHERE id = ?`, t, t, i.id)
    audit(i.type, i.id, 'entity.deleted', { name: row.name, rels, relEv, aliases, notes, pinned, suggestions, pausedSources }, { deletedAt: t })
    cs.touch(i.type, i.id).names = true
    return { ok: true, removedLinks: rels.length }
  },
  undo: { 'entity.deleted': h => ({ op: 'entity.restore', input: { type: h.entity_type, id: h.entity_id } }) },
  chat: {
    action: 'delete_entity',
    line: 'the user wants a listed company/firm/person removed from the library (junk, not a real company, created by mistake): objectId.',
    toInput: (s, typeOf) => ({ type: entityOf(typeOf, s.objectId, 'company', 'firm', 'person'), id: s.objectId! })
  }
})

/** Sources hydration created only for this entity (its news watch, its site) — still enabled, origin system. */
function watchSources(eid: string): string[] {
  const ids = new Set<string>()
  for (const j of all<{ result_json: string | null }>("SELECT result_json FROM jobs WHERE type = 'HYDRATE_OBJECT' AND idempotency_key = ? AND status = 'succeeded'", `hydrate:${eid}`)) {
    const r = j.result_json ? JSON.parse(j.result_json) : {}
    for (const x of [r.watchSourceId, r.siteSource]) if (typeof x === 'string') ids.add(x)
  }
  return [...ids].filter(x => one("SELECT 1 FROM sources WHERE id = ? AND origin = 'system' AND enabled = 1 AND deleted_at IS NULL", x))
}

const lastDeletion = (type: string, eid: string) => one<{ id: string; before_json: string }>(
  "SELECT id, before_json FROM history WHERE entity_type = ? AND entity_id = ? AND action = 'entity.deleted' ORDER BY created_at DESC, rowid DESC LIMIT 1", type, eid)

/** The live id an entity end resolves to now (follows merges), or null when it's gone. */
function liveEnd(type: string, eid: string): string | null {
  if (type === 'document') return one('SELECT 1 FROM documents WHERE id = ?', eid) ? eid : null
  if (type === 'evidence') return one('SELECT 1 FROM evidence WHERE id = ?', eid) ? eid : null
  if (type === 'note') return one('SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NULL', eid) ? eid : null
  if (type === 'source') return one('SELECT 1 FROM sources WHERE id = ?', eid) ? eid : null
  if (!(type in NODE_TABLE)) return null
  let cur: string | null = eid
  for (let k = 0; k < 6 && cur; k++) {
    const r: { merged_into_id: string | null; deleted_at?: number | null } | undefined = one(`SELECT merged_into_id${type === 'thesis' ? '' : ', deleted_at'} FROM ${NODE_TABLE[type as NodeType]} WHERE id = ?`, cur)
    if (!r || r.deleted_at) return null
    if (!r.merged_into_id) return cur
    cur = r.merged_into_id
  }
  return null
}

export const restore = defineOp({
  name: 'entity.restore',
  input: z.object({ type: entityType, id }),
  validate: i => {
    const row = one<{ name: string; normalized_name: string; deleted_at: number | null; merged_into_id: string | null }>(`SELECT name, normalized_name, deleted_at, merged_into_id FROM ${TABLE[i.type]} WHERE id = ?`, i.id)
    if (!row || row.merged_into_id) return [notFound(i.type)]
    if (!row.deleted_at) return [`${row.name} isn't deleted`]
    if (!lastDeletion(i.type, i.id)) return [`${row.name} was moved to the other list (company ↔ firm), not deleted — undo that instead`]
    const dup = sameNamed(i.type, row.normalized_name, i.id)
    if (dup) return [`${dup.name} exists again as a ${LABEL[i.type]} — merge them instead of restoring`]
    return []
  },
  describe: i => `Restore ${nameOf(i.type, i.id)}?`,
  apply: (i, cs) => {
    const snap = JSON.parse(lastDeletion(i.type, i.id)!.before_json)
    const row = one<{ domain?: string | null }>(`SELECT * FROM ${TABLE[i.type]} WHERE id = ?`, i.id)!
    const t = now()
    const domainTaken = row.domain && one(`SELECT 1 FROM ${TABLE[i.type]} WHERE domain = ? AND id <> ? AND merged_into_id IS NULL AND deleted_at IS NULL`, row.domain, i.id)
    run(`UPDATE ${TABLE[i.type]} SET deleted_at = NULL, ${domainTaken ? 'domain = NULL, ' : ''}updated_at = ? WHERE id = ?`, t, i.id)
    let rels = 0, skipped = 0
    const restored = new Set<string>()
    for (const r of snap.rels as RelRow[]) {
      const self = (x: string, y: string) => x === i.type && y === i.id
      const f = self(r.from_type, r.from_id) ? i.id : liveEnd(r.from_type, r.from_id)
      const to = self(r.to_type, r.to_id) ? i.id : liveEnd(r.to_type, r.to_id)
      if (!f || !to) { skipped++; continue }
      const cols = Object.keys(r)
      const vals = cols.map(c => (c === 'from_id' ? f : c === 'to_id' ? to : r[c]))
      if (run(`INSERT OR IGNORE INTO relationships(${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...vals).changes) { rels++; restored.add(r.id) }
      else skipped++
    }
    for (const re of snap.relEv as any[]) if (restored.has(re.relationship_id) && one('SELECT 1 FROM evidence WHERE id = ?', re.evidence_id))
      run('INSERT OR IGNORE INTO relationship_evidence(relationship_id, evidence_id, status, created_at) VALUES (?, ?, ?, ?)', re.relationship_id, re.evidence_id, re.status, re.created_at)
    for (const a of snap.aliases as any[]) run('INSERT OR IGNORE INTO aliases(entity_type, entity_id, alias, alias_normalized, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)', a.entity_type, a.entity_id, a.alias, a.alias_normalized, a.origin, a.created_at)
    for (const n of snap.notes as string[]) run("UPDATE notes SET anchor_type = ?, anchor_id = ?, updated_at = ? WHERE id = ? AND anchor_type = 'none' AND deleted_at IS NULL", i.type, i.id, t, n)
    if (snap.pinned) pinsSet([...new Set([...pinsGet(), i.id])])
    for (const s of (snap.pausedSources || []) as string[]) if (one('SELECT 1 FROM sources WHERE id = ? AND enabled = 0 AND deleted_at IS NULL', s)) setSourceEnabled(s, true)
    audit(i.type, i.id, 'entity.restored', null, { rels, skipped })
    cs.touch(i.type, i.id).docsOf(i.type, i.id).names = true
    return { ok: true, restoredLinks: rels, skippedLinks: skipped }
  },
  undo: { 'entity.restored': h => ({ op: 'entity.delete', input: { type: h.entity_type, id: h.entity_id } }) },
  chat: {
    action: 'restore_entity',
    line: 'the user wants a deleted candidate (listed as “deleted”) back: objectId.',
    toInput: (s, typeOf) => ({ type: entityOf(typeOf, s.objectId, 'company', 'firm', 'person'), id: s.objectId! })
  }
})

export const ENTITY_OPS = [create, rename, merge, split, changeType, del, restore]
