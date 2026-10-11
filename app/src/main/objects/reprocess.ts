// Re-process (DEC-099): the user forces the agent to redo its work on one object, with what they now say about it.
//   company / firm / person — the lookup again (search, site, news watch) and a re-read of the articles linked to it or
//                             naming it (SAME_ENTITY now sees their description and notes);
//   thesis                  — a fresh match against the facts already stored;
//   source                  — a fresh fetch and a re-read of its last 30 days (the mode/instruction gate runs again);
//   document                — a re-read.
// A snapshot taken first lets the page say what changed once the work is done ("+4 articles · 2 links removed"), and
// links the re-read removed can be kept (Undo).
import { queueMatch } from '../theses/match'
import { all, one, run } from '../db'
import { now } from '../clock'
import { emit } from '../events'
import { enqueue, cancelJobs } from '../jobs'
import { AppError } from '../errors'
import { getSetting, setSetting } from '../settings'
import { enqueueProcess } from '../ingest/pipeline'
import { startHydrate } from './hydrate'

type T = 'company' | 'firm' | 'person' | 'thesis' | 'source' | 'document'
const TABLE = { company: 'companies', firm: 'firms', person: 'people' } as const
const MAX_REREAD = 60
const DAY = 86_400_000
const key = (t: T, id: string) => `reprocess.${t}.${id}`

function nameOf(t: T, id: string): string {
  if (t === 'thesis') return one<{ title: string }>('SELECT title FROM theses WHERE id = ?', id)?.title || 'this thesis'
  if (t === 'source') return one<{ name: string }>('SELECT name FROM sources WHERE id = ?', id)?.name || 'this source'
  if (t === 'document') return one<{ title: string }>('SELECT title FROM documents WHERE id = ?', id)?.title || 'this article'
  return one<{ name: string }>(`SELECT name FROM ${TABLE[t]} WHERE id = ?`, id)?.name || 'it'
}

const linkedRels = (t: 'company' | 'firm' | 'person', id: string) => all<{ id: string; from_id: string }>(
  "SELECT id, from_id FROM relationships WHERE from_type = 'document' AND to_type = ? AND to_id = ? AND status IN ('accepted','suggested')", t, id)

/** Articles to re-read for an entity: linked to it, then naming it (full-text), newest first, at most MAX_REREAD. */
function docsFor(t: 'company' | 'firm' | 'person', id: string): string[] {
  const out = new Set(linkedRels(t, id).map(r => r.from_id))
  const names = [nameOf(t, id), ...all<{ alias: string }>('SELECT alias FROM aliases WHERE entity_type = ? AND entity_id = ?', t, id).map(a => a.alias)]
  const q = [...new Set(names)].filter(n => n.trim().length >= 2).map(n => `"${n.replace(/"/g, '')}"`).join(' OR ')
  if (q) for (const d of all<{ id: string }>(`SELECT d.id FROM fts_documents JOIN documents d ON d.rowid = fts_documents.rowid WHERE fts_documents MATCH ? AND d.deleted_at IS NULL
      AND d.status IN ('processed','triaged_out') ORDER BY COALESCE(d.published_at, d.first_fetched_at) DESC LIMIT ${MAX_REREAD}`, q)) out.add(d.id)
  return [...out].filter(d => one("SELECT 1 FROM documents WHERE id = ? AND deleted_at IS NULL AND status IN ('processed','triaged_out')", d)).slice(0, MAX_REREAD)
}
const sourceDocs = (id: string) => all<{ id: string }>(`SELECT d.id FROM document_sources ds JOIN documents d ON d.id = ds.document_id WHERE ds.source_id = ? AND d.deleted_at IS NULL
  AND d.status IN ('processed','triaged_out') AND COALESCE(d.published_at, d.first_fetched_at) >= ? ORDER BY d.first_fetched_at DESC LIMIT ${MAX_REREAD}`, id, now() - 30 * DAY).map(r => r.id)

export interface ReprocessPlan { type: T; id: string; name: string; rereads: number; text: string }

/** What Re-process will do, for the confirm ("re-reads 38 articles"). */
export function reprocessPlan(t: T, id: string): ReprocessPlan {
  const name = nameOf(t, id)
  if (t === 'company' || t === 'firm' || t === 'person') {
    const n = docsFor(t, id).length
    return { type: t, id, name, rereads: n, text: `Look ${name} up again and re-read ${n} article${n === 1 ? '' : 's'} about it with what you've said about it.` }
  }
  if (t === 'thesis') {
    const n = one<{ n: number }>("SELECT COUNT(*) n FROM evidence WHERE status = 'active'")!.n
    return { type: t, id, name, rereads: 0, text: `Match “${name}” again against the ${n} facts in your library (nothing is re-read).` }
  }
  if (t === 'source') {
    const n = sourceDocs(id).length
    return { type: t, id, name, rereads: n, text: `Fetch ${name} again and re-read its last 30 days (${n} article${n === 1 ? '' : 's'}) with its current settings.` }
  }
  return { type: t, id, name, rereads: 1, text: `Read “${name}” again.` }
}

function reread(ids: string[], o: { sourceId?: string; skipTriage?: boolean } = {}): void {
  for (const d of ids) {
    cancelJobs({ type: 'PROCESS_DOCUMENT', documentId: d })
    run('UPDATE documents SET ai_generation = ai_generation + 1, updated_at = ? WHERE id = ?', now(), d)
    enqueueProcess(d, { ...o, priority: 3 })
  }
}

export function reprocess(t: T, id: string): ReprocessPlan & { jobIds: string[] } {
  const plan = reprocessPlan(t, id)
  const jobIds: string[] = []
  if (t === 'company' || t === 'firm' || t === 'person') {
    const ids = docsFor(t, id)
    const followed = one<{ followed: number }>(`SELECT followed FROM ${TABLE[t]} WHERE id = ?`, id)?.followed === 1
    setSetting(key(t, id), { at: now(), rels: linkedRels(t, id).map(r => r.id), docs: linkedRels(t, id).map(r => r.from_id), reread: ids,
      domain: t === 'person' ? null : one<{ domain: string | null }>(`SELECT domain FROM ${TABLE[t]} WHERE id = ?`, id)?.domain || null })
    jobIds.push(startHydrate(t, id, { once: !followed }))
    reread(ids, { skipTriage: true })
  } else if (t === 'thesis') {
    if (!one('SELECT 1 FROM theses WHERE id = ? AND merged_into_id IS NULL', id)) throw new AppError('NOT_FOUND', 'Thesis not found')
    jobIds.push(queueMatch(id))
  } else if (t === 'source') {
    if (!one('SELECT 1 FROM sources WHERE id = ? AND deleted_at IS NULL', id)) throw new AppError('NOT_FOUND', 'Source not found')
    const ids = sourceDocs(id)
    setSetting(key(t, id), { at: now(), reread: ids })
    jobIds.push(enqueue('FETCH_SOURCE', { sourceId: id, trigger: 'manual' }, { idempotencyKey: `fetch:${id}`, priority: 1 }))
    reread(ids, { sourceId: id })
  } else {
    if (!one("SELECT 1 FROM documents WHERE id = ? AND deleted_at IS NULL AND status <> 'pending_capture'", id)) throw new AppError('NOT_FOUND', 'Article not found')
    reread([id], { skipTriage: true })
  }
  emit('object.updated', { type: t, id })
  return { ...plan, jobIds }
}

/** What the last Re-process changed, once its re-reads are done (null when none ran). */
export function reprocessChanges(t: 'company' | 'firm' | 'person' | 'source', id: string): { pending: number; added: number; removed: { relId: string; documentId: string; title: string }[]; website: string | null; at: number } | null {
  const snap = getSetting<any>(key(t, id))
  if (!snap) return null
  const ids: string[] = snap.reread || []
  const pending = ids.length ? one<{ n: number }>(`SELECT COUNT(*) n FROM jobs WHERE type = 'PROCESS_DOCUMENT' AND status IN ('queued','running') AND json_extract(payload_json, '$.documentId') IN (${ids.map(() => '?').join(',')})`, ...ids)!.n : 0
  if (t === 'source') return { pending, added: 0, removed: [], website: null, at: snap.at }
  const nowRels = linkedRels(t, id)
  const before = new Set<string>(snap.docs || [])
  const added = nowRels.filter(r => !before.has(r.from_id)).length
  const removed = (snap.rels as string[] || []).map(rid => one<{ id: string; from_id: string; status: string }>('SELECT id, from_id, status FROM relationships WHERE id = ?', rid))
    .filter((r): r is { id: string; from_id: string; status: string } => !!r && !['accepted', 'suggested'].includes(r.status))
    .map(r => ({ relId: r.id, documentId: r.from_id, title: one<{ title: string }>('SELECT title FROM documents WHERE id = ?', r.from_id)?.title || '' }))
  const domain = t === 'person' ? null : one<{ domain: string | null }>(`SELECT domain FROM ${TABLE[t]} WHERE id = ?`, id)?.domain || null
  return { pending, added, removed, website: domain !== snap.domain ? domain : null, at: snap.at }
}

/** Undo for removals: keep the links the re-read dropped (as the user's own links, so a later re-read won't drop them). */
export function keepRemoved(t: 'company' | 'firm' | 'person', id: string): { kept: number } {
  const ch = reprocessChanges(t, id)
  if (!ch) return { kept: 0 }
  for (const r of ch.removed) run("UPDATE relationships SET status = 'accepted', origin = 'user', updated_at = ? WHERE id = ?", now(), r.relId)
  const snap = getSetting<any>(key(t, id))
  setSetting(key(t, id), { ...snap, rels: (snap.rels || []).filter((x: string) => !ch.removed.some(r => r.relId === x)) })
  emit('object.updated', { type: t, id })
  return { kept: ch.removed.length }
}
