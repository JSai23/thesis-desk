// Sources: lifecycle (RFC §1B.8.4), FETCH_SOURCE / CONFIGURE_SOURCE jobs, scheduling, health, suggestions and the
// starter pack (§1B.8.7), and the 30-day purge of removed sources (DEC-046).
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { all, one, run, tx, json } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { writeHistory } from '../history'
import { getSetting, setSetting } from '../settings'
import { enqueue, registerJob, onJobFailure, cancelJobs, isRunning } from '../jobs'
import { upsertSchedule, setScheduleEnabled, deleteSchedule, onSchedule, FREQ_MINUTES } from '../scheduler'
import { registerMaintenance } from '../maintenance'
import { probe, type ProbeResult } from './probe'
import { fetchRss, fetchWeb, fetchHn, type SourceRow, type FetchCtx, type FetchResult } from './adapters'
import { ingestItem, enqueueProcess } from '../ingest/pipeline'
import { runTask } from '../ai/runtime'
import { CONFIGURE } from '../ai/tasks/source'
import { readAuth } from '../ai/codex-auth'
import { normalizeLocator, registrableDomain, hostOf } from '../ingest/url'
import { removeContent } from '../files'
import { resolveCurrent } from '../entities/fields'
import { recomputeStatus } from '../entities/relationships'
import { upsertFeedItem } from '../feed'
import { STARTER_PACK_OVERRIDE, FIXTURE_BASE } from '../env'
import { log } from '../log'
import type { SourceDTO, SuggestedSourceDTO } from '../../shared/dto'

const DAY = 86400_000
type Adapter = (src: SourceRow, cursor: any, ctx: FetchCtx) => Promise<FetchResult>
const adapters: Record<string, Adapter> = { rss: fetchRss, web: fetchWeb, hn_api: fetchHn }
export function addAdapter(kind: string, a: Adapter): void { adapters[kind] = a }

/** Auth sources (PH-07) install: pre-sync session check, walled-article verdict, and the partition. */
export interface AuthHooks { beforeFetch(src: SourceRow): Promise<void>; onWalled(src: SourceRow, url: string): Promise<'expired' | 'entitlement'> }
let authHooks: AuthHooks | null = null
export function setAuthHooks(h: AuthHooks): void { authHooks = h }

export const getSourceRow = (id: string) => one<SourceRow>('SELECT * FROM sources WHERE id = ?', id)

const GROUP_INSTRUCTIONS: Record<string, string> = {
  news: 'Prioritize funding, company launches, major product changes, executive changes, acquisitions, and meaningful adoption signals involving venture-backed technology companies. De-emphasize event promotion and generic consumer news.',
  blogs: 'Show new essays, investment theses, market frameworks and company references. Treat the author’s conclusions as attributed opinion, not fact.',
  vc: 'Show new essays, investment theses, market frameworks and company references. Treat the author’s conclusions as attributed opinion, not fact.',
  company: 'Show new essays, investment theses, market frameworks and company references. Treat the author’s conclusions as attributed opinion, not fact.',
  search: 'Keep only headlines about startup funding, launches, acquisitions and new funds; drop duplicates of stories I already have.',
  newsletters: 'Prioritize funding, company launches, major product changes, executive changes, acquisitions, and meaningful adoption signals involving venture-backed technology companies. De-emphasize event promotion and generic consumer news.'
}
const HN_INSTRUCTION = 'Surface startup launches, developer tools, AI infrastructure, enterprise software, and discussions that create new evidence for my tracked theses. Avoid generic discussion unless it points to a company, product, technical shift, or market signal.'
const GROUP_LABEL: Record<string, string> = { news: 'News', blogs: 'Startup & VC blogs', vc: 'Startup & VC blogs', company: 'Startup & VC blogs', search: 'Searches', newsletters: 'Newsletters' }

// ---------------------------------------------------------------- DTO
export function label(s: SourceRow): string {
  const t = now()
  if (s.auth_state === 'expired') return 'Session expired'
  if (s.auth_state === 'login_required' || s.auth_state === 'authenticating') return 'Sign-in needed'
  if (s.auth_state === 'blocked' || s.health === 'blocked') return 'Blocked'
  if (s.health === 'failing') return 'Failing'
  if (!s.enabled) return 'Paused'
  if ((s.muted_until ?? 0) > t) return 'Muted'
  return ''
}

export function toDTO(s: SourceRow): SourceDTO {
  const cfg = json<any>(s.config_json, {})
  const recent = all<{ document_id: string; title: string; first_seen_at: number; item_id: string | null; hidden: string | null }>(
    `SELECT ds.document_id, d.title, ds.first_seen_at, fi.id AS item_id, fi.hidden_reason AS hidden FROM document_sources ds JOIN documents d ON d.id = ds.document_id
     LEFT JOIN feed_items fi ON fi.document_id = COALESCE(d.duplicate_of_id, d.id) WHERE ds.source_id = ? AND d.deleted_at IS NULL AND d.status <> 'pending_capture' ORDER BY COALESCE(d.published_at, ds.first_seen_at) DESC LIMIT 20`, s.id)
  const weekAgo = now() - 7 * DAY
  return {
    id: s.id, name: s.name, kind: s.kind, typeLabel: s.type_label, locator: s.locator, siteDomain: s.site_domain, mode: s.mode as any, instruction: s.instruction,
    freq: s.freq as any, priority: s.priority as any, enabled: !!s.enabled, muted: (s.muted_until ?? 0) > now(), mutedUntil: s.muted_until, health: s.health as any,
    authState: s.auth_state, authStrategy: s.auth_strategy, lastErrorCode: s.last_error_code, lastError: s.last_error_message, lastSuccessAt: s.last_success_at, lastAttemptAt: s.last_attempt_at,
    thesisIds: all<{ to_id: string }>("SELECT to_id FROM relationships WHERE from_type = 'source' AND from_id = ? AND rel = 'covers' AND to_type = 'thesis' AND status = 'accepted'", s.id).map(r => r.to_id),
    count: one<{ n: number }>('SELECT COUNT(*) n FROM document_sources WHERE source_id = ?', s.id)!.n, label: label(s), deletedAt: s.deleted_at,
    recent: recent.filter(r => r.first_seen_at >= weekAgo || true).slice(0, 5).map(r => ({ itemId: r.item_id, documentId: r.document_id, title: r.title, at: r.first_seen_at })),
    ...(cfg ? {} : {})
  }
}

export function listSources(includeRemoved = false): SourceDTO[] {
  return all<SourceRow>(`SELECT * FROM sources WHERE kind <> 'manual' ${includeRemoved ? '' : 'AND deleted_at IS NULL'} ORDER BY created_at DESC`).map(toDTO)
}

// ---------------------------------------------------------------- create / update
export interface Draft { locator: string; name?: string; mode: 'all' | 'relevant' | 'custom'; instruction: string; freq: 'realtime' | 'hourly' | 'daily' | 'weekly'; priority: 'low' | 'normal' | 'high'; thesisIds: string[]; origin: 'user' | 'starter_pack' | 'suggestion' | 'system'; probe?: ProbeResult }

export async function createSource(d: Draft): Promise<SourceDTO> {
  let p = d.probe && d.probe.configDraft ? d.probe as ProbeResult : await probe(d.locator)
  if (p.status !== 'found' && p.status !== 'login_required') throw new AppError('VALIDATION', p.message || 'This source can’t be watched.')
  const dup = one<{ id: string }>('SELECT id FROM sources WHERE canonical_locator = ? AND deleted_at IS NULL', p.canonicalLocator)
  if (dup) throw new AppError('CONFLICT', 'You already watch this source')
  const id = newId('src')
  const t = now()
  const relevance = { mode: d.mode, instruction: d.instruction || '', include: [], exclude: [], entityFocus: 'none' }
  const config = { ...p.configDraft, relevance }
  const auth = p.status === 'login_required' && p.auth
  tx(() => {
    run(`INSERT INTO sources(id, name, kind, locator, canonical_locator, site_domain, type_label, trust, mode, instruction, config_json, freq, priority, enabled, auth_strategy, auth_state, auth_profile_json, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      id, d.name || p.name, p.kind, normalizeLocator(d.locator), p.canonicalLocator, p.siteDomain ?? null, p.typeLabel, p.trust, d.mode, d.instruction || '', JSON.stringify(config), d.freq, d.priority,
      auth ? 'app_browser_session' : p.kind === 'email' ? 'email_ingress' : 'none', auth ? 'login_required' : 'not_required', auth ? JSON.stringify(auth.profile) : null, d.origin, t, t)
    upsertSchedule('source_poll', id, { everyMinutes: FREQ_MINUTES[d.freq] }, t)
    for (const th of d.thesisIds) setCovers(id, th, true)
    writeHistory('source', id, 'source.created', null, { locator: d.locator, mode: d.mode, freq: d.freq })
    setSetting('first_run_done', true)
  })
  enqueue('CONFIGURE_SOURCE', { sourceId: id }, { idempotencyKey: `configure:${id}`, priority: 2 })
  if (!auth) enqueue('FETCH_SOURCE', { sourceId: id, trigger: 'initial' }, { idempotencyKey: `fetch:${id}`, priority: 2 })
  emit('source.updated', { sourceId: id })
  emit('banner.updated', {})
  return toDTO(getSourceRow(id)!)
}

function setCovers(sourceId: string, thesisId: string, on: boolean): void {
  const t = now()
  const ex = one<{ id: string }>("SELECT id FROM relationships WHERE from_type = 'source' AND from_id = ? AND rel = 'covers' AND to_type = 'thesis' AND to_id = ?", sourceId, thesisId)
  if (on && !ex) run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, created_at, updated_at) VALUES (?, 'source', ?, 'covers', 'thesis', ?, 'user', 'accepted', ?, ?)`, newId('rel'), sourceId, thesisId, t, t)
  else if (on && ex) run("UPDATE relationships SET status = 'accepted', updated_at = ? WHERE id = ?", t, ex.id)
  else if (!on && ex) run("UPDATE relationships SET status = 'inactive', updated_at = ? WHERE id = ?", t, ex.id)
}

export function updateSource(id: string, patch: { name?: string; mode?: string; instruction?: string; freq?: string; priority?: string; thesisIds?: string[] }): SourceDTO {
  const s = getSourceRow(id)
  if (!s || s.deleted_at) throw new AppError('NOT_FOUND', 'Source not found')
  const t = now()
  let reconfigure = false
  tx(() => {
    const cfg = json<any>(s.config_json, {})
    if (patch.name !== undefined) run('UPDATE sources SET name = ? WHERE id = ?', patch.name, id)
    if (patch.mode !== undefined || patch.instruction !== undefined) {
      const mode = patch.mode ?? s.mode, instruction = patch.instruction ?? s.instruction
      cfg.relevance = { ...(cfg.relevance || {}), mode, instruction }
      run('UPDATE sources SET mode = ?, instruction = ?, config_json = ? WHERE id = ?', mode, instruction, JSON.stringify(cfg), id)
      reconfigure = true
    }
    if (patch.freq !== undefined && patch.freq !== s.freq) {
      run('UPDATE sources SET freq = ? WHERE id = ?', patch.freq, id)
      upsertSchedule('source_poll', id, { everyMinutes: FREQ_MINUTES[patch.freq] }, (s.last_attempt_at || t) + FREQ_MINUTES[patch.freq] * 60_000, !!s.enabled)
    }
    if (patch.priority !== undefined) run('UPDATE sources SET priority = ? WHERE id = ?', patch.priority, id)
    if (patch.thesisIds) {
      const cur = toDTO(s).thesisIds
      for (const th of patch.thesisIds) if (!cur.includes(th)) setCovers(id, th, true)
      for (const th of cur) if (!patch.thesisIds.includes(th)) setCovers(id, th, false)
    }
    run('UPDATE sources SET updated_at = ? WHERE id = ?', t, id)
    writeHistory('source', id, 'source.config', { mode: s.mode, instruction: s.instruction, freq: s.freq, priority: s.priority }, patch)
  })
  if (reconfigure) enqueue('CONFIGURE_SOURCE', { sourceId: id }, { idempotencyKey: `configure:${id}`, priority: 2 })
  emit('source.updated', { sourceId: id })
  return toDTO(getSourceRow(id)!)
}

// ---------------------------------------------------------------- lifecycle
function live(id: string): SourceRow {
  const s = getSourceRow(id)
  if (!s || s.deleted_at || s.kind === 'manual') throw new AppError('NOT_FOUND', 'Source not found')
  return s
}

export function syncNow(id: string, priority = 1): { jobId: string } {
  live(id)
  const jobId = enqueue('FETCH_SOURCE', { sourceId: id, trigger: 'manual' }, { idempotencyKey: `fetch:${id}`, priority })
  return { jobId }
}

export function setEnabled(id: string, enabled: boolean): void {
  live(id)
  const t = now()
  tx(() => {
    run('UPDATE sources SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, t, id)
    if (enabled) setScheduleEnabled('source_poll', id, true, t)
    else { setScheduleEnabled('source_poll', id, false); cancelJobs({ type: 'FETCH_SOURCE', sourceId: id }) }
    writeHistory('source', id, enabled ? 'source.resumed' : 'source.paused', null, null)
  })
  emit('source.updated', { sourceId: id })
}

/** Load older posts still listed by the source (DEC-085): one FETCH_SOURCE over the last `days`, deduped on ingest. */
export function backfill(id: string, days: number): { jobId: string } {
  const s = live(id)
  return { jobId: enqueue('FETCH_SOURCE', { sourceId: s.id, trigger: 'backfill', days }, { idempotencyKey: `backfill:${s.id}`, priority: 3 }) }
}

export function mute(id: string, muted: boolean): void {
  live(id)
  const t = now()
  tx(() => {
    run('UPDATE sources SET muted_until = ?, updated_at = ? WHERE id = ?', muted ? t + 7 * DAY : null, t, id)
    if (!muted) unhideMuted(id)
    writeHistory('source', id, muted ? 'source.muted' : 'source.unmuted', null, null)
  })
  emit('source.updated', { sourceId: id })
  emit('feed.updated', {})
}

function unhideMuted(sourceId: string): void {
  run(`UPDATE feed_items SET hidden_reason = NULL, updated_at = ? WHERE hidden_reason = 'muted' AND document_id IN (SELECT document_id FROM document_sources WHERE source_id = ?)`, now(), sourceId)
}

/** Remove: soft-delete; hide feed items whose document has no other live source and is not user-referenced. */
export function remove(id: string): void {
  live(id)
  const t = now()
  tx(() => {
    run('UPDATE sources SET deleted_at = ?, updated_at = ? WHERE id = ?', t, t, id)
    deleteSchedule('source_poll', id)
    cancelJobs({ sourceId: id })
    for (const d of all<{ document_id: string }>('SELECT document_id FROM document_sources WHERE source_id = ?', id)) {
      const other = one(`SELECT 1 FROM document_sources ds JOIN sources s ON s.id = ds.source_id WHERE ds.document_id = ? AND s.id <> ? AND s.deleted_at IS NULL`, d.document_id, id)
      if (other || isUserReferenced(d.document_id)) continue
      run("UPDATE feed_items SET hidden_reason = 'source_removed', updated_at = ? WHERE document_id = ? AND hidden_reason IS NULL", t, d.document_id)
    }
    writeHistory('source', id, 'source.removed', null, null)
  })
  emit('source.updated', { sourceId: id })
  emit('feed.updated', {})
  emit('banner.updated', {})
}

export function restore(id: string): void {
  const s = getSourceRow(id)
  if (!s || !s.deleted_at) throw new AppError('NOT_FOUND', 'Nothing to restore')
  if (one('SELECT 1 FROM sources WHERE canonical_locator = ? AND deleted_at IS NULL AND id <> ?', s.canonical_locator, id)) throw new AppError('CONFLICT', 'This source was added again')
  const t = now()
  tx(() => {
    run('UPDATE sources SET deleted_at = NULL, updated_at = ? WHERE id = ?', t, id)
    upsertSchedule('source_poll', id, { everyMinutes: FREQ_MINUTES[s.freq] }, t + FREQ_MINUTES[s.freq] * 60_000, !!s.enabled)
    run("UPDATE feed_items SET hidden_reason = NULL, updated_at = ? WHERE hidden_reason = 'source_removed' AND document_id IN (SELECT document_id FROM document_sources WHERE source_id = ?)", t, id)
    writeHistory('source', id, 'source.restored', null, null)
  })
  emit('source.updated', { sourceId: id })
  emit('feed.updated', {})
}

export function retry(id: string): { jobId: string } {
  live(id)
  run('UPDATE sources SET consecutive_failures = 0, updated_at = ? WHERE id = ?', now(), id)
  run("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE status = 'queued' AND type = 'FETCH_SOURCE' AND json_extract(payload_json, '$.sourceId') = ?", now(), id)
  return syncNow(id, 1)
}

/** Reset & re-ingest (§1B.8.4, DEC-045): nothing deleted; bump generation, reprocess every stored doc, refetch. */
export function reset(id: string): { documents: number } {
  const s = live(id)
  if (isRunning(j => j.type === 'FETCH_SOURCE' && j.payload?.sourceId === id)) throw new AppError('CONFLICT', `Checking ${s.name} right now. Try Reset again in a moment.`)
  cancelJobs({ type: 'FETCH_SOURCE', sourceId: id })
  const docs = all<{ document_id: string }>(`SELECT ds.document_id FROM document_sources ds JOIN documents d ON d.id = ds.document_id WHERE ds.source_id = ? AND d.deleted_at IS NULL AND d.status NOT IN ('duplicate','pending_capture')`, id).map(r => r.document_id)
  for (const d of docs) cancelJobs({ type: 'PROCESS_DOCUMENT', documentId: d })
  tx(() => {
    run('UPDATE sources SET cursor_json = NULL, updated_at = ? WHERE id = ?', now(), id)
    for (const d of docs) run('UPDATE documents SET ai_generation = ai_generation + 1, updated_at = ? WHERE id = ?', now(), d)
    writeHistory('source', id, 'source.reset', null, { documents: docs.length })
  })
  for (const d of docs) enqueueProcess(d, { sourceId: id, skipTriage: one<{ status: string }>('SELECT status FROM documents WHERE id = ?', d)!.status !== 'triaged_out', priority: 4 })
  enqueue('FETCH_SOURCE', { sourceId: id, trigger: 'reset', reset: true }, { idempotencyKey: `fetch:${id}`, priority: 3 })
  emit('source.updated', { sourceId: id })
  return { documents: docs.length }
}

// ---------------------------------------------------------------- user-referenced predicate (DEC-041)
export function isUserReferenced(docId: string): boolean {
  if (one('SELECT 1 FROM feed_items WHERE document_id = ? AND saved_at IS NOT NULL', docId)) return true
  if (one("SELECT 1 FROM evidence WHERE document_id = ? AND (kept = 1 OR origin = 'user_highlight')", docId)) return true
  if (one("SELECT 1 FROM relationships WHERE origin = 'user' AND status = 'accepted' AND from_type = 'document' AND from_id = ?", docId)) return true
  if (one(`SELECT 1 FROM relationships r WHERE r.origin = 'user' AND r.status = 'accepted' AND ((r.from_type = 'evidence' AND r.from_id IN (SELECT id FROM evidence WHERE document_id = ?))
           OR r.id IN (SELECT re.relationship_id FROM relationship_evidence re JOIN evidence e ON e.id = re.evidence_id WHERE e.document_id = ?))`, docId, docId)) return true
  if (one('SELECT 1 FROM notes WHERE document_id = ? AND deleted_at IS NULL', docId)) return true
  if (one("SELECT 1 FROM field_values fv JOIN evidence e ON e.id = fv.evidence_id WHERE fv.origin = 'user' AND e.document_id = ?", docId)) return true
  return false
}

// ---------------------------------------------------------------- purge (DEC-046)
export function purgeRemovedSources(): { purged: number } {
  const cutoff = now() - 30 * DAY
  const docs = all<{ document_id: string }>(`SELECT ds.document_id FROM document_sources ds JOIN sources s ON s.id = ds.source_id GROUP BY ds.document_id
     HAVING SUM(CASE WHEN s.deleted_at IS NULL THEN 1 ELSE 0 END) = 0 AND MAX(s.deleted_at) <= ?`, cutoff).map(r => r.document_id)
  let purged = 0
  for (const docId of docs) {
    if (isUserReferenced(docId)) continue
    tx(() => purgeDocument(docId))
    purged++
  }
  if (purged) emit('feed.updated', {})
  return { purged }
}

function purgeDocument(docId: string): void {
  const ev = all<{ id: string }>('SELECT id FROM evidence WHERE document_id = ?', docId).map(r => r.id)
  const inList = (ids: string[]) => ids.map(() => '?').join(',')
  if (ev.length) {
    // (1) non-user field values citing the doomed evidence → deleted, then resolveCurrent
    const fields = all<{ object_type: string; object_id: string; field_key: string }>(`SELECT DISTINCT object_type, object_id, field_key FROM field_values WHERE origin <> 'user' AND evidence_id IN (${inList(ev)})`, ...ev)
    run(`DELETE FROM field_values WHERE origin <> 'user' AND evidence_id IN (${inList(ev)})`, ...ev)
    for (const f of fields) resolveCurrent(f.object_type, f.object_id, f.field_key)
    // (2) support rows deleted, relationship status recomputed; relationships from the document/evidence deleted except rejected tombstones
    const rels = all<{ relationship_id: string }>(`SELECT DISTINCT relationship_id FROM relationship_evidence WHERE evidence_id IN (${inList(ev)})`, ...ev).map(r => r.relationship_id)
    run(`DELETE FROM relationship_evidence WHERE evidence_id IN (${inList(ev)})`, ...ev)
    recomputeStatus(rels)
    run(`DELETE FROM relationship_evidence WHERE relationship_id IN (SELECT id FROM relationships WHERE status <> 'rejected' AND from_type = 'evidence' AND from_id IN (${inList(ev)}))`, ...ev)
    run(`DELETE FROM relationships WHERE status <> 'rejected' AND from_type = 'evidence' AND from_id IN (${inList(ev)})`, ...ev)
    // (3) notifications keep their snapshot
    run(`UPDATE notifications SET evidence_id = NULL, document_id = NULL WHERE evidence_id IN (${inList(ev)})`, ...ev)
  }
  run('UPDATE notifications SET evidence_id = NULL, document_id = NULL WHERE document_id = ?', docId)
  run("DELETE FROM relationship_evidence WHERE relationship_id IN (SELECT id FROM relationships WHERE status <> 'rejected' AND from_type = 'document' AND from_id = ?)", docId)
  run("DELETE FROM relationships WHERE status <> 'rejected' AND from_type = 'document' AND from_id = ?", docId)
  // (4) evidence, feed item, versions, document_sources, document, content dir
  if (ev.length) run(`DELETE FROM evidence WHERE id IN (${inList(ev)})`, ...ev)
  run('DELETE FROM feed_items WHERE document_id = ?', docId)
  run('DELETE FROM document_versions WHERE document_id = ?', docId)
  run('DELETE FROM document_sources WHERE document_id = ?', docId)
  run('UPDATE documents SET duplicate_of_id = NULL WHERE duplicate_of_id = ?', docId)
  run('DELETE FROM documents WHERE id = ?', docId)
  removeContent(docId)
}

// ---------------------------------------------------------------- suggestions & starter pack
function starterPack(): any[] {
  const candidates = [path.join(app.getAppPath(), 'app/resources/starter-pack.json'), path.join(process.cwd(), 'app/resources/starter-pack.json')]
  const f = candidates.find(p => fs.existsSync(p))
  const list: any[] = f ? JSON.parse(fs.readFileSync(f, 'utf8')) : []
  if (STARTER_PACK_OVERRIDE === 'fixtures') for (const x of list) if (x.kind === 'hn_api') x.locator = FIXTURE_BASE.replace('127.0.0.1', 'hn.test') + '/v0'
  return list
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function suggestions(): (SuggestedSourceDTO & Record<string, unknown>)[] {
  const dismissed = new Set(getSetting<string[]>('starter_pack.dismissed') || [])
  const liveRows = all<{ canonical_locator: string; locator: string; site_domain: string | null }>("SELECT canonical_locator, locator, site_domain FROM sources WHERE deleted_at IS NULL AND kind <> 'manual'")
  const added = new Set(liveRows.flatMap(r => [r.canonical_locator.replace(/\/$/, ''), r.locator.replace(/\/$/, '')]))
  const userCount = liveRows.length
  const out: (SuggestedSourceDTO & Record<string, unknown>)[] = []
  // "You follow X, but no source covers it directly" (DEC-047 covers definition)
  for (const c of all<{ id: string; name: string; domain: string | null; normalized_name: string }>('SELECT id, name, domain, normalized_name FROM companies WHERE followed = 1 AND merged_into_id IS NULL AND deleted_at IS NULL')) {
    const sid = 'follow:' + c.id
    if (dismissed.has(sid)) continue
    const website = one<{ value_json: string }>("SELECT value_json FROM field_values WHERE object_type = 'company' AND object_id = ? AND field_key = 'website' AND status = 'current'", c.id)
    const siteUrl = website ? String(JSON.parse(website.value_json)) : null
    const domains = [c.domain, siteUrl ? registrableDomain(siteUrl) : null].filter(Boolean) as string[]
    if (domains.length && liveRows.some(r => r.site_domain && domains.includes(r.site_domain))) continue
    let locator = siteUrl
    if (!locator) {
      const slugName = c.normalized_name.replace(/\s+/g, '')
      const d = all<{ url: string }>(`SELECT d.url FROM documents d JOIN relationships r ON r.from_type = 'document' AND r.from_id = d.id AND r.to_type = 'company' AND r.to_id = ? AND r.status = 'accepted' WHERE d.url IS NOT NULL`, c.id)
        .map(x => x.url).find(u => { const h = registrableDomain(u); return (c.domain && h === c.domain) || h.split('.')[0] === slugName })
      if (d) { const u = new URL(d); const segs = u.pathname.split('/').filter(Boolean); locator = `${u.origin}/${segs.length > 1 ? segs.slice(0, -1).join('/') + '/' : ''}` }
    }
    if (!locator || added.has(locator.replace(/\/$/, ''))) continue
    out.push({ id: sid, name: c.name, typeLabel: 'Company blog', locator, group: 'For you', reason: `You follow ${c.name}, but no source covers it directly`, kind: 'web', available: true, mode: 'all', instruction: '', freq: 'daily', origin: 'suggestion' })
  }
  const pack = starterPack().filter(x => x.available !== false && !x.defaultHidden)
  const shown = userCount < 3 ? pack.filter(x => x.featured) : pack
  for (const x of shown) {
    const id = 'starter:' + slug(x.name)
    if (dismissed.has(id) || added.has(String(x.locator).replace(/\/$/, ''))) continue
    out.push({
      id, name: x.name, typeLabel: x.kind === 'hn_api' ? 'Hacker News' : x.kind === 'email' ? 'Newsletter' : x.kind === 'search' ? 'Saved search' : x.group === 'vc' ? 'VC blog' : x.kind === 'web' ? 'Website' : 'RSS feed',
      locator: x.locator, group: GROUP_LABEL[x.group] || 'News', reason: x.note || GROUP_LABEL[x.group] || '', kind: x.kind, available: true,
      mode: 'custom', instruction: x.kind === 'hn_api' ? HN_INSTRUCTION : GROUP_INSTRUCTIONS[x.group] || '', freq: x.kind === 'email' ? 'realtime' : x.group === 'news' || x.group === 'search' ? 'hourly' : 'daily', origin: 'starter_pack'
    })
  }
  return out
}

export function dismissSuggestion(id: string): void {
  const list = getSetting<string[]>('starter_pack.dismissed') || []
  if (!list.includes(id)) setSetting('starter_pack.dismissed', [...list, id])
  emit('source.updated', {})
}

// ---------------------------------------------------------------- jobs
function recordFailure(id: string, code: string, message: string): void {
  run('UPDATE sources SET consecutive_failures = consecutive_failures + 1, last_error_code = ?, last_error_message = ?, last_attempt_at = ?, updated_at = ? WHERE id = ?', code, message, now(), now(), id)
}

const INITIAL_WINDOW_MS = 24 * 3600_000, INITIAL_FLOOR = 5, BACKFILL_MAX = 100

async function fetchSource(p: { sourceId: string; trigger?: string; reset?: boolean; days?: number }, jobId: string): Promise<unknown> {
  const s = getSourceRow(p.sourceId)
  if (!s || s.deleted_at) return { skipped: 'removed' }
  if (p.trigger === 'schedule' && !s.enabled) return { skipped: 'paused' }
  const adapter = adapters[s.kind]
  if (!adapter) throw new AppError('VALIDATION', `No fetcher for ${s.kind}`)
  run('UPDATE sources SET last_attempt_at = ? WHERE id = ?', now(), s.id)
  const profile = json<any>(s.auth_profile_json, null)
  const ctx: FetchCtx = { robots: s.kind === 'web' || s.kind === 'rss', reset: !!p.reset, partition: s.auth_strategy === 'app_browser_session' ? profile?.partition : undefined, wallPhrases: profile?.wall?.phrases }
  // DEC-085: a new source starts from today (last 24 h, at least its 5 newest items); older posts only on request
  if (p.trigger === 'initial' && !p.reset) Object.assign(ctx, json<any>(s.config_json, {}).fetch?.forwardOnly
    ? { since: now(), floor: 0 } // a connected entity's watch starts at now (DEC-096)
    : { since: now() - INITIAL_WINDOW_MS, floor: INITIAL_FLOOR })
  if (p.trigger === 'backfill') Object.assign(ctx, { since: now() - Math.max(1, p.days || 7) * DAY, floor: 0, maxItems: BACKFILL_MAX, ignoreSeen: true })
  if (s.auth_strategy === 'app_browser_session' && authHooks) {
    await authHooks.beforeFetch(s)
    ctx.onWalled = url => authHooks!.onWalled(s, url)
  }
  let r: FetchResult
  try {
    r = await adapter(s, p.reset ? null : json(s.cursor_json, null), ctx)
  } catch (e) {
    const code = e instanceof AppError ? String(e.code) : 'FETCH_FAILED'
    recordFailure(s.id, code, (e as Error).message)
    if (code === 'ROBOTS_BLOCKED' || code === 'HTTP_403') run("UPDATE sources SET health = 'blocked' WHERE id = ?", s.id)
    emit('source.updated', { sourceId: s.id })
    throw e
  }
  let created = 0, updated = 0
  for (const item of r.items) {
    try {
      const res = ingestItem({ ...item, sourceId: s.id })
      if (res.outcome === 'new') created++
      else if (res.outcome === 'updated') updated++
    } catch (e) { log.error('fetch', 'ingest failed', { sourceId: s.id, err: String((e as Error)?.stack || e) }) }
  }
  run(`UPDATE sources SET cursor_json = ?, health = 'ok', consecutive_failures = 0, last_error_code = NULL, last_error_message = NULL, last_success_at = ?, updated_at = ? WHERE id = ?`,
    JSON.stringify(r.cursor), now(), now(), s.id)
  const toast = p.trigger === 'backfill'
    ? (created ? `${s.name}: ${created} older post${created === 1 ? '' : 's'} added from the last ${p.days} days` : `${s.name}: no older posts within ${p.days} days`)
    : created || updated ? `${s.name}: ${created} new · ${updated} updated` : `${s.name} is up to date`
  emit('source.syncCompleted', { sourceId: s.id, new: created, updated, trigger: p.trigger, toast: ['manual', 'refresh', 'backfill'].includes(p.trigger || '') ? toast : undefined })
  emit('source.updated', { sourceId: s.id })
  emit('banner.updated', {})
  return { new: created, updated, seen: r.stats.seen, errors: r.errors }
}

async function configureSource(p: { sourceId: string }, jobId: string): Promise<unknown> {
  const s = getSourceRow(p.sourceId)
  if (!s || s.deleted_at) return { skipped: true }
  if (readAuth().status !== 'ok') throw new AppError('AI_UNAVAILABLE', 'No ChatGPT sign-in found')
  const cfg = json<any>(s.config_json, {})
  const recentTitles = all<{ title: string }>('SELECT d.title FROM document_sources ds JOIN documents d ON d.id = ds.document_id WHERE ds.source_id = ? ORDER BY ds.first_seen_at DESC LIMIT 10', s.id).map(r => r.title)
  let rel = { include: [] as string[], exclude: [] as string[], entityFocus: 'none' as 'none' | 'followed_only' }
  try { rel = (await runTask(CONFIGURE, { name: s.name, typeLabel: s.type_label, mode: s.mode, instruction: s.instruction, recentTitles }, { jobId })).value } catch (e) {
    if (e instanceof AppError && e.code === 'AI_UNAVAILABLE') throw e
    log.warn('sources', 'CONFIGURE_SOURCE failed; using empty filters', { sourceId: s.id })
  }
  cfg.relevance = { ...(cfg.relevance || {}), mode: s.mode, instruction: s.instruction, include: rel.include, exclude: rel.exclude, entityFocus: rel.entityFocus }
  run('UPDATE sources SET config_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(cfg), now(), s.id)
  return { configured: true }
}

export function registerSources(): void {
  registerJob('FETCH_SOURCE', job => fetchSource(job.payload as any, job.id))
  registerJob('CONFIGURE_SOURCE', job => configureSource(job.payload as any, job.id))
  onJobFailure((job, code, message, final) => {
    if (job.type !== 'FETCH_SOURCE' || !final) return
    const id = job.payload.sourceId
    const s = getSourceRow(id)
    if (!s) return
    if (code !== 'AUTH_EXPIRED' && s.health !== 'blocked') run("UPDATE sources SET health = 'failing', updated_at = ? WHERE id = ?", now(), id)
    emit('source.updated', { sourceId: id })
    emit('banner.updated', {})
    emit('source.syncCompleted', { sourceId: id, failed: true, toast: job.payload.trigger === 'manual' ? `Couldn’t check ${s.name}: ${message}` : undefined })
  })
  onSchedule('source_poll', (sc, info) => {
    const s = getSourceRow(sc.target_id)
    if (!s || s.deleted_at || !s.enabled || s.health === 'blocked' || ['login_required', 'expired', 'blocked'].includes(s.auth_state)) return
    enqueue('FETCH_SOURCE', { sourceId: s.id, trigger: 'schedule' }, { idempotencyKey: `fetch:${s.id}`, priority: s.priority === 'high' ? 3 : s.priority === 'low' ? 6 : 5, runAfter: now() + info.staggerMs })
  })
  registerMaintenance('unmute', () => {
    const t = now()
    const expired = all<{ id: string }>('SELECT id FROM sources WHERE muted_until IS NOT NULL AND muted_until <= ?', t)
    for (const s of expired) { run('UPDATE sources SET muted_until = NULL WHERE id = ?', s.id); unhideMuted(s.id) }
    if (expired.length) { emit('feed.updated', {}); emit('source.updated', {}) }
    return { unmuted: expired.length }
  })
  registerMaintenance('purge_removed_sources', () => purgeRemovedSources())
}

export { hostOf, upsertFeedItem }
