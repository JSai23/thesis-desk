// Polled adapters (RFC §1B.8.2). Fetchers never call models and never write to the DB: they return items with
// raw bodies and parsed text; FETCH_SOURCE hands each item to the single ingestion pipeline.
import { httpGet } from './http'
import { fetchArticle } from './article'
import { parsePage, parseFragment } from '../ingest/parser'
import { parseFeed, articleLinks, matchesPattern } from './feeds'
import { hostOf } from '../ingest/url'
import { log } from '../log'
import { now } from '../clock'
import type { IngestItem } from '../ingest/pipeline'

export interface SourceRow {
  id: string; name: string; kind: string; locator: string; canonical_locator: string; site_domain: string | null; type_label: string; trust: string; mode: string; instruction: string
  config_json: string; freq: string; priority: string; enabled: number; muted_until: number | null; auth_strategy: string; auth_state: string; auth_profile_json: string | null
  cursor_json: string | null; health: string; consecutive_failures: number; last_error_code: string | null; last_error_message: string | null; last_attempt_at: number | null
  last_success_at: number | null; origin: string; created_at: number; updated_at: number; deleted_at: number | null
}
export interface FetchCtx {
  partition?: string; wallPhrases?: string[]; reset?: boolean; robots: boolean; onWalled?: (url: string) => Promise<'expired' | 'entitlement'>
  /** First sync / backfill window (DEC-085): keep items published since `since`, topped up to the `floor` newest; ≤ maxItems. */
  since?: number; floor?: number; maxItems?: number; ignoreSeen?: boolean
}

/** Dated candidates (newest first) → the ones inside the window, topped up with the newest others to `floor`. */
export function inWindow<T>(list: T[], dateOf: (x: T) => number | null | undefined, ctx: FetchCtx): T[] {
  if (!ctx.since) return list
  const sorted = [...list].sort((a, b) => (dateOf(b) || 0) - (dateOf(a) || 0))
  // undated items can't prove they're recent: they only fill the floor
  const keep = sorted.filter(x => (dateOf(x) || 0) >= ctx.since!)
  for (const x of sorted) { if (keep.length >= (ctx.floor || 0)) break; if (!keep.includes(x)) keep.push(x) }
  return keep.slice(0, ctx.maxItems || keep.length)
}
export type Item = Omit<IngestItem, 'sourceId'>
export interface FetchResult { items: Item[]; cursor: any; stats: { seen: number; new: number }; errors: number }

const MAX_SEEN = 2000

async function articleItem(url: string, itemKey: string, ctx: FetchCtx, render: 'http' | 'browser' | 'auto', fallback?: { title?: string; publishedAt?: number | null }): Promise<Item | null> {
  const a = await fetchArticle(url, { render, partition: ctx.partition, robots: ctx.robots, wallPhrases: ctx.wallPhrases })
  let access: 'full' | 'partial' = a.parsed.wall.found ? 'partial' : 'full'
  let meta: Record<string, unknown> = { render: a.render }
  if (a.parsed.wall.found && ctx.onWalled) {
    const verdict = await ctx.onWalled(url)
    if (verdict === 'expired') return null
    meta = { ...meta, entitlementWall: true }
    access = 'partial'
  }
  if (!a.parsed.text.trim()) return null
  return {
    itemKey, url: a.finalUrl, canonicalTag: a.parsed.canonical, kind: 'web', title: a.parsed.title || fallback?.title || url, text: a.parsed.text, author: a.parsed.byline,
    siteName: a.parsed.siteName || hostOf(a.finalUrl), publishedAt: a.parsed.publishedAt ?? fallback?.publishedAt ?? null, access, raw: { ext: 'html', body: a.html }, metadata: meta
  }
}

export async function fetchRss(src: SourceRow, cursor: any, ctx: FetchCtx): Promise<FetchResult> {
  const cfg = JSON.parse(src.config_json)
  const feedUrl = cfg.fetch.feedUrl || src.locator
  const res = await httpGet(feedUrl, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', partition: ctx.partition })
  const feed = parseFeed(res.body.toString('utf8'), res.url || feedUrl)
  const seen: string[] = cursor?.seenGuids || []
  const window = now() - (cfg.fetch.historyWindowDays || 30) * 86400_000
  const max = ctx.maxItems || cfg.fetch.maxItemsPerSync || 30
  const items: Item[] = []
  let errors = 0, fresh = 0
  // first sync / backfill: the dated window; regular syncs: only items never seen (older ones wait for a backfill)
  const candidates = ctx.since ? inWindow(feed.items, i => i.publishedAt, { ...ctx, maxItems: max })
    : ctx.reset ? feed.items.slice(0, max) : feed.items.filter(i => !seen.includes(i.guid)).slice(0, max)
  for (const fi of candidates) {
    const isNew = ctx.ignoreSeen || !seen.includes(fi.guid)
    if (isNew && ctx.reset && fi.publishedAt && fi.publishedAt < window) continue
    if (isNew) fresh++
    try {
      const inline = fi.content || ''
      const inlineParas = inline ? await parseFragment(inline) : []
      if (inlineParas.join(' ').length >= 1500) {
        items.push({ itemKey: fi.guid, url: fi.link, kind: 'web', title: fi.title, text: inlineParas.join('\n\n'), siteName: src.name, publishedAt: fi.publishedAt, access: 'full', raw: { ext: 'html', body: inline }, metadata: { fromFeed: true } })
      } else if (fi.link) {
        const it = await articleItem(fi.link, fi.guid, ctx, cfg.fetch.render === 'browser' ? 'browser' : 'auto', { title: fi.title, publishedAt: fi.publishedAt })
        if (it) items.push({ ...it, title: it.title || fi.title, publishedAt: it.publishedAt ?? fi.publishedAt })
        else {
          // no readable article (paywall, menu-only page): keep the feed's own headline and summary, marked partial
          const sum = (await parseFragment(fi.summary || fi.content || '')).join('\n\n').trim()
          const text = [fi.title, sum].filter(Boolean).join('\n\n')
          if (fi.title) items.push({ itemKey: fi.guid, url: fi.link, kind: 'web', title: fi.title, text, siteName: src.name, publishedAt: fi.publishedAt, access: 'partial', raw: { ext: 'txt', body: text }, metadata: { fromFeed: true, headlineOnly: !sum } })
        }
      }
    } catch (e) { if ((e as any)?.code === 'AUTH_EXPIRED') throw e; errors++; log.warn('rss', 'item fetch failed', { sourceId: src.id, host: hostOf(fi.link), err: String((e as Error).message) }) }
  }
  const allSeen = [...new Set([...feed.items.map(i => i.guid), ...seen])].slice(0, MAX_SEEN)
  const lastPublishedAt = Math.max(cursor?.lastPublishedAt || 0, ...feed.items.map(i => i.publishedAt || 0))
  return { items, cursor: { seenGuids: allSeen, lastPublishedAt }, stats: { seen: feed.items.length, new: fresh }, errors }
}

export async function fetchWeb(src: SourceRow, cursor: any, ctx: FetchCtx): Promise<FetchResult> {
  const cfg = JSON.parse(src.config_json)
  const listingUrl = cfg.fetch.listingUrl || src.locator
  const render: 'http' | 'browser' = cfg.fetch.render === 'browser' ? 'browser' : 'http'
  let html: string, finalUrl: string
  if (render === 'browser') {
    const { renderPage } = await import('./browser')
    const r = await renderPage(listingUrl, { partition: ctx.partition })
    html = r.html; finalUrl = r.url
  } else {
    const res = await httpGet(listingUrl, { partition: ctx.partition })
    html = res.body.toString('utf8'); finalUrl = res.url || listingUrl
  }
  const page = await parsePage(html, finalUrl, { checkWall: false })
  const pattern = cfg.fetch.articleUrlPattern || '/'
  const links = articleLinks(page.links, finalUrl).filter(l => matchesPattern(l, pattern)).slice(0, ctx.maxItems || cfg.fetch.maxItemsPerSync || 30)
  const seen: string[] = cursor?.seenUrls || []
  // posts left out by the first-sync window stay out of regular syncs until a backfill asks for them (DEC-085)
  let skipped: string[] = ctx.ignoreSeen ? [] : cursor?.skippedUrls || []
  // a regular sync takes an unseen post only if it is newer than what the source already gave (less a day for late
  // dating) — a listing that starts showing older posts (a16z's page surfaced 15 past podcast episodes) is not news;
  // those wait for a backfill like posts outside the first-sync window. Seen posts are still re-read (updates).
  const DAY = 86_400_000
  const lastPub: number | null = cursor?.lastPublishedAt ?? null
  const regularFloor = ctx.since || ctx.ignoreSeen || ctx.reset ? 0 : lastPub ? lastPub - DAY : src.last_success_at ? src.last_success_at - 7 * DAY : 0
  const items: Item[] = []
  let errors = 0, fresh = 0
  for (const [k, url] of links.entries()) {
    if (!ctx.since && !ctx.reset && skipped.includes(url)) continue
    if (!seen.includes(url)) fresh++
    try {
      const it = await articleItem(url, url, ctx, render === 'browser' ? 'browser' : 'auto')
      if (it && regularFloor && !seen.includes(url) && it.publishedAt && it.publishedAt < regularFloor) { skipped = [...new Set([...skipped, url])]; continue }
      // listings run newest first: once past the window (or undated) with the floor reached, older posts wait for a backfill
      if (it && ctx.since && (!it.publishedAt || it.publishedAt < ctx.since) && items.length >= (ctx.floor || 0)) { if (!ctx.ignoreSeen) skipped = [...new Set([...skipped, ...links.slice(k).filter(l => !seen.includes(l))])]; break }
      if (it) items.push(it)
    } catch (e) { if ((e as any)?.code === 'AUTH_EXPIRED') throw e; errors++; log.warn('web', 'article fetch failed', { sourceId: src.id, host: hostOf(url), err: String((e as Error).message) }) }
  }
  const fetched = items.map(i => i.itemKey)
  const newest = Math.max(lastPub || 0, ...items.map(i => i.publishedAt || 0))
  return { items, cursor: { seenUrls: [...new Set([...links.filter(l => !skipped.includes(l)), ...seen])].slice(0, MAX_SEEN), skippedUrls: skipped.filter(l => !fetched.includes(l)).slice(0, MAX_SEEN), ...(newest ? { lastPublishedAt: newest } : {}) }, stats: { seen: links.length, new: fresh }, errors }
}

export async function fetchHn(src: SourceRow, cursor: any, ctx: FetchCtx): Promise<FetchResult> {
  const cfg = JSON.parse(src.config_json)
  const hn = cfg.fetch.hn || { apiBase: src.locator, maxPerSync: 30, minScore: 0 }
  const top: number[] = JSON.parse((await httpGet(`${hn.apiBase}/${hn.list || 'topstories'}.json`, { accept: 'application/json' })).body.toString('utf8'))
  const seen: number[] = cursor?.seenIds || []
  // only the current top of the list is "new"; walking further down on every sync would ingest ever-older stories.
  // A backfill reads deeper (the list itself is ranked, not dated).
  const ids = (ctx.ignoreSeen ? top.slice(0, 200) : top.slice(0, 60).filter(id => !seen.includes(id)))
  const items: Item[] = []
  let errors = 0
  const done: number[] = []
  for (const id of ids) {
    if (items.length >= (ctx.maxItems || hn.maxPerSync || 30)) break
    try {
      const it = JSON.parse((await httpGet(`${hn.apiBase}/item/${id}.json`, { accept: 'application/json' })).body.toString('utf8'))
      done.push(id)
      if (!it || it.type !== 'story' || (it.score ?? 0) < (hn.minScore || 0)) continue
      if (ctx.since && it.time && it.time * 1000 < ctx.since && items.length >= (ctx.floor || 0)) continue
      const meta = { hn: { id: it.id, score: it.score, comments: it.descendants ?? 0, by: it.by } }
      if (it.url) {
        const a = await articleItem(it.url, String(id), ctx, 'auto', { title: it.title, publishedAt: it.time ? it.time * 1000 : null })
        // the page's own title unless it is generic (shares no word with the HN title, a repo/X page title, overlong);
        // a page date in the future (an event page) is not a publish date: the HN post time is used instead
        const words = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])
        const poor = !a?.title || a.title.length > 150 || /^GitHub - | on X$/.test(a.title) || ![...words(a.title)].some(w => words(it.title || '').has(w))
        if (a) items.push({ ...a, title: poor && it.title ? it.title : a.title, publishedAt: a.publishedAt != null && a.publishedAt <= now() ? a.publishedAt : Math.min(it.time ? it.time * 1000 : now(), now()), metadata: { ...(a.metadata || {}), ...meta } })
      } else if (it.text) {
        const paras = await parseFragment(it.text)
        items.push({ itemKey: String(id), url: `https://news.ycombinator.com/item?id=${id}`, kind: 'web', title: it.title, text: paras.join('\n\n'), siteName: 'Hacker News', publishedAt: it.time ? it.time * 1000 : null, access: 'full', raw: { ext: 'json', body: JSON.stringify(it) }, metadata: meta })
      }
    } catch (e) { if ((e as any)?.code === 'AUTH_EXPIRED') throw e; errors++; log.warn('hn', 'item failed', { id, err: String((e as Error).message) }) }
  }
  // everything on the front page we looked at counts as seen, ingested or not (the per-sync cap is "what you get"):
  // the next sync takes only stories that newly reached the top, not ranks 31–60 of this one (backfill reads deeper)
  const considered = ctx.ignoreSeen ? done : ids
  return { items, cursor: { seenIds: [...new Set([...considered, ...done, ...seen])].slice(0, MAX_SEEN) }, stats: { seen: top.length, new: done.length }, errors }
}
