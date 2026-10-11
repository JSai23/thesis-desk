// Three tiers decide what syncs and what matters (DEC-096), for companies, firms and people alike:
//   followed   — the user follows it: full hydration (history, own site, news watch); leads Today, alerts, reports.
//   connected  — one step from something followed through an investment, partnership, founding or job (a followed
//                firm's portfolio and partners, a followed company's founders, executives and investors, a followed
//                founder's companies): a daily news search, capped per followed entity; ranked above extracted.
//   extracted  — anything else the app found in an article: kept up to date passively from the user's sources;
//                its page offers Pull latest (one lookup, nothing subscribed).
// Sources created for an entity are recorded as `source —covers→ entity` with a role; when nothing followed or
// connected needs a system source any more it is removed (user-added sources are never touched).
import { all, one, run } from '../db'
import { now } from '../clock'
import { log } from '../log'
import { enqueue } from '../jobs'
import { registerMaintenance } from '../maintenance'
import { remove as removeSource } from '../sources'
import { upsertFeedItem } from '../feed'
import { getSetting, setSetting } from '../settings'
import { newsWatch, newsQuery, recordCovers, startHydrate } from './hydrate'

export type Tier = 'followed' | 'connected' | 'extracted'
type E = 'company' | 'firm' | 'person'
const TABLE: Record<E, string> = { company: 'companies', firm: 'firms', person: 'people' }
const LINK_RELS = "('invested_in','partner_at','founded','works_at')"
/** At most this many connected entities per followed entity get a daily news search (the most active first). */
export const CONNECTED_CAP = 25
/** Connected watches created per sync run (each needs a probe); the rest follow on the next run. */
const CREATE_PER_RUN = 40
const DAY = 86_400_000
const key = (t: string, id: string) => `${t}:${id}`

export interface ConnectedEntry { type: E; id: string; name: string; via: { type: E; id: string; name: string }[] }

let cache: { at: number; followed: Set<string>; connected: Map<string, ConnectedEntry> } | null = null
export const invalidateTiers = (): void => { cache = null }

function followedAll(): { type: E; id: string; name: string }[] {
  return (['company', 'firm', 'person'] as E[]).flatMap(type =>
    all<{ id: string; name: string }>(`SELECT id, name FROM ${TABLE[type]} WHERE followed = 1 AND merged_into_id IS NULL AND deleted_at IS NULL`).map(r => ({ type, ...r })))
}

/** Entities one investment / partnership / founding / job away (accepted relationships, either direction). */
export function neighborsOf(type: E, id: string): { type: E; id: string; name: string; activity: number }[] {
  const rows = all<{ t: E; i: string }>(`SELECT to_type t, to_id i FROM relationships WHERE from_type = ? AND from_id = ? AND rel IN ${LINK_RELS} AND status = 'accepted' AND to_type IN ('company','firm','person')
    UNION SELECT from_type t, from_id i FROM relationships WHERE to_type = ? AND to_id = ? AND rel IN ${LINK_RELS} AND status = 'accepted' AND from_type IN ('company','firm','person')`, type, id, type, id)
  const since = now() - 90 * DAY
  const out: { type: E; id: string; name: string; activity: number }[] = []
  for (const r of rows) {
    const e = one<{ name: string }>(`SELECT name FROM ${TABLE[r.t]} WHERE id = ? AND merged_into_id IS NULL AND deleted_at IS NULL`, r.i)
    if (!e) continue
    const activity = one<{ n: number }>(`SELECT COUNT(DISTINCT d.id) n FROM relationships x JOIN documents d ON d.id = x.from_id
      WHERE x.from_type = 'document' AND x.to_type = ? AND x.to_id = ? AND x.status IN ('accepted','suggested') AND COALESCE(d.published_at, d.first_fetched_at) >= ?`, r.t, r.i, since)!.n
    out.push({ type: r.t, id: r.i, name: e.name, activity })
  }
  return out.sort((a, b) => b.activity - a.activity || a.name.localeCompare(b.name))
}

function compute(): NonNullable<typeof cache> {
  if (cache && Date.now() - cache.at < 5000) return cache
  const fol = followedAll()
  const followed = new Set(fol.map(f => key(f.type, f.id)))
  // sticky: an entity that already has its watch keeps its place; "most active" only fills free places. Ranking by
  // activity alone drifted as articles were read — entities moved in and out between syncs and their watches were
  // created and removed again (RD-TIER-03)
  const watched = new Set(all<{ t: string; i: string }>(`SELECT r.to_type t, r.to_id i FROM relationships r JOIN sources s ON s.id = r.from_id
    WHERE r.from_type = 'source' AND r.rel = 'covers' AND r.status = 'accepted' AND s.deleted_at IS NULL AND json_extract(r.payload_json, '$.role') = 'connected_watch'`).map(r => key(r.t, r.i)))
  const connected = new Map<string, ConnectedEntry>()
  for (const f of fol) {
    const ns = neighborsOf(f.type, f.id).filter(n => !followed.has(key(n.type, n.id)))
      .sort((a, b) => Number(watched.has(key(b.type, b.id))) - Number(watched.has(key(a.type, a.id))) || b.activity - a.activity || a.name.localeCompare(b.name))
    for (const n of ns.slice(0, CONNECTED_CAP)) {
      const k = key(n.type, n.id)
      const c = connected.get(k) || { type: n.type, id: n.id, name: n.name, via: [] }
      c.via.push({ type: f.type, id: f.id, name: f.name })
      connected.set(k, c)
    }
  }
  cache = { at: Date.now(), followed, connected }
  return cache
}

export function tierOf(type: string, id: string): Tier {
  const c = compute()
  return c.followed.has(key(type, id)) ? 'followed' : c.connected.has(key(type, id)) ? 'connected' : 'extracted'
}
/** How much the tier lifts an item in Today and reports: followed 1, connected 0.5, extracted 0. */
export const tierWeight = (t: Tier): number => (t === 'followed' ? 1 : t === 'connected' ? 0.5 : 0)
export const connectedEntities = (): ConnectedEntry[] => [...compute().connected.values()]
export const connectedVia = (type: string, id: string): ConnectedEntry['via'] => compute().connected.get(key(type, id))?.via || []

/** Follow / unfollow changed: recompute tiers now, sync sources in the background. */
export function tiersChanged(type: E, id: string, followed: boolean): void {
  invalidateTiers()
  // following anything runs the full lookup again — library, web search, site, news watch — whatever its tier or
  // history (user rule, Backlog "Following anything always hydrates it"); a lookup already queued or running is reused
  if (followed) startHydrate(type, id)
  // a sync already running read the old follows: queue one after it (a fixed key would join the running one)
  const running = !!one("SELECT 1 FROM jobs WHERE type = 'MAINTENANCE' AND idempotency_key LIKE 'maint:sync_tiers%' AND status = 'running'")
  enqueue('MAINTENANCE', { task: 'sync_tiers' }, { idempotencyKey: running ? `maint:sync_tiers:next:${Date.now()}` : 'maint:sync_tiers', priority: 3 })
}

const covers = () => all<{ rel: string; source: string; type: E; id: string; role: string; origin: string }>(`SELECT r.id rel, r.from_id source, r.to_type type, r.to_id id, json_extract(r.payload_json, '$.role') role, s.origin
  FROM relationships r JOIN sources s ON s.id = r.from_id WHERE r.from_type = 'source' AND r.rel = 'covers' AND r.to_type IN ('company','firm','person') AND r.status = 'accepted' AND s.deleted_at IS NULL`)

/** Sources made for followed entities before ownership was recorded ("News: Makora", the site on its domain). */
function backfillCovers(): number {
  let n = 0
  for (const f of followedAll()) {
    for (const s of all<{ id: string }>("SELECT id FROM sources WHERE origin = 'system' AND kind = 'search' AND name = ? AND deleted_at IS NULL", `News: ${f.name}`)) { recordCovers(s.id, f.type, f.id, 'news_watch'); n++ }
    if (f.type === 'person') continue
    const dom = one<{ domain: string | null }>(`SELECT domain FROM ${TABLE[f.type]} WHERE id = ?`, f.id)?.domain
    if (dom) for (const s of all<{ id: string }>("SELECT id FROM sources WHERE origin = 'system' AND kind <> 'search' AND site_domain = ? AND deleted_at IS NULL", dom)) { recordCovers(s.id, f.type, f.id, 'own_site'); n++ }
  }
  return n
}

/** Bring sources in line with the tiers: news watches for followed people and connected entities; system sources
 *  nothing followed or connected needs are removed. Runs after follow/unfollow and daily. */
export function syncTiers(): Promise<{ created: number; removed: number; backfilled: number; pending: number }> {
  // one at a time: two syncs side by side each removed the watches the other had just made as "orphans" from its own
  // snapshot (RD-TIER-03, iteration 2) — a follow-up waits for the one running, then reads the latest state
  const next = syncChain.then(syncTiersNow, syncTiersNow)
  syncChain = next.catch(() => undefined)
  return next
}
let syncChain: Promise<unknown> = Promise.resolve()

async function syncTiersNow(): Promise<{ created: number; removed: number; backfilled: number; pending: number }> {
  invalidateTiers()
  const backfilled = backfillCovers()
  const t = compute()
  const have = covers()
  const watched = new Set(have.filter(c => c.role === 'news_watch' || c.role === 'connected_watch').map(c => key(c.type, c.id)))
  const want: { type: E; id: string; name: string; role: 'news_watch' | 'connected_watch' }[] = [
    ...followedAll().filter(f => f.type === 'person').map(f => ({ ...f, role: 'news_watch' as const })),
    ...[...t.connected.values()].map(c => ({ type: c.type, id: c.id, name: c.name, role: 'connected_watch' as const }))
  ].filter(w => !watched.has(key(w.type, w.id)))
  let created = 0
  for (const w of want.slice(0, CREATE_PER_RUN)) {
    try {
      const s = await newsWatch(w.name, w.type, newsQuery([w.name], w.type), { forwardOnly: w.role === 'connected_watch' })
      recordCovers(s.id, w.type, w.id, w.role)
      created++
    } catch (err) { log.warn('tiers', 'news watch failed', { type: w.type, err: String((err as Error).message) }) }
  }
  // orphans: a system source is needed while any entity it covers is followed (own site, news watch) or followed or
  // connected (connected watch); user-added sources are never removed. Judged on the tiers as they are now, and only
  // for sources that existed when this sync began: the snapshot from the start went stale while the watches above
  // were made — Founders Fund was followed mid-sync and its new watch removed as an orphan (RD-HYD-02, iteration 2)
  invalidateTiers()
  const now2 = compute()
  const before = new Set(have.map(c => c.source))
  const needed = new Set<string>()
  for (const c of covers()) {
    const k = key(c.type, c.id)
    if (now2.followed.has(k) || (c.role === 'connected_watch' && now2.connected.has(k))) needed.add(c.source)
  }
  let removed = 0
  for (const src of new Set(covers().filter(c => c.origin !== 'user' && before.has(c.source) && !needed.has(c.source)).map(c => c.source))) {
    try {
      removeSource(src)
      run("UPDATE relationships SET status = 'inactive', updated_at = ? WHERE from_type = 'source' AND from_id = ? AND rel = 'covers'", now(), src)
      removed++
    } catch (err) { log.warn('tiers', 'remove failed', { err: String((err as Error).message) }) }
  }
  // re-score Today for everything tied to a followed or connected entity (the tier lifts their items)
  const docs = new Set<string>()
  for (const k of [...t.followed, ...t.connected.keys()]) {
    const [type, id] = k.split(':')
    for (const d of all<{ d: string }>("SELECT from_id d FROM relationships WHERE from_type = 'document' AND to_type = ? AND to_id = ? AND status IN ('accepted','suggested')", type, id)) docs.add(d.d)
  }
  for (const d of docs) upsertFeedItem(d)
  // more watches than one run creates: continue in a follow-up run (only while runs make progress, so a source that
  // keeps failing its probe can't loop)
  const pending = Math.max(0, want.length - CREATE_PER_RUN)
  if (pending && created) enqueue('MAINTENANCE', { task: 'sync_tiers' }, { idempotencyKey: `maint:sync_tiers:more:${Date.now()}`, priority: 4 })
  return { created, removed, backfilled, pending }
}

/** Feed items written before the three Today sections keep their old group until re-scored: once per library. */
function regroupFeed(): number {
  const ids = all<{ document_id: string }>('SELECT document_id FROM feed_items')
  for (const r of ids) upsertFeedItem(r.document_id)
  setSetting('feed.groups_version', 2)
  return ids.length
}

export function registerTiers(): void {
  registerMaintenance('sync_tiers', () => syncTiers())
  registerMaintenance('feed_regroup', () => regroupFeed())
  if (getSetting('feed.groups_version') !== 2) enqueue('MAINTENANCE', { task: 'feed_regroup' }, { idempotencyKey: 'maint:feed_regroup', priority: 4 })
}
