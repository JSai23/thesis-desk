// Saved searches (RFC §1B.8.2 `search`, P-SOURCE-016, DEC-064): a plain-language query runs on a schedule against
// free search feeds (Google News RSS, HN Algolia); results are resolved to publisher pages and ingested normally.
// Unresolvable results become headline + snippet documents with access 'partial'.
import { httpGet } from './http'
import { renderPage } from './browser'
import { fetchArticle } from './article'
import { parseFeed } from './feeds'
import { addProbeHandler, baseResult, relatedTheses, type ProbeResult } from './probe'
import { addAdapter } from './index'
import { hostOf } from '../ingest/url'
import { TEST_MODE, FIXTURE_BASE, REAL_SEARCH } from '../env'
import { inWindow, type SourceRow, type FetchResult, type Item, type FetchCtx } from './adapters'
import { log } from '../log'
import { now } from '../clock'

const GOOGLE = 'https://news.google.com/rss/search'
const ALGOLIA = 'https://hn.algolia.com/api/v1/search_by_date'
/** In test mode Google News is served by the fixture site news-search.test (Appendix A). */
const googleBase = () => (TEST_MODE && !REAL_SEARCH ? FIXTURE_BASE.replace('127.0.0.1', 'news-search.test') + '/rss' : GOOGLE)

/** Google News RSS search; `whenDays` null = all time (entity lookup), otherwise the recent window. */
export function googleSearchUrl(query: string, whenDays: number | null): string { return `${googleBase()}?q=${encodeURIComponent(query + (whenDays ? ` when:${whenDays}d` : ''))}&hl=en-US&gl=US&ceid=US:en` }
export function googleUrl(query: string): string { return `${googleBase()}?q=${encodeURIComponent(query + ' when:7d')}&hl=en-US&gl=US&ceid=US:en` }
export function algoliaUrl(query: string, tag?: string): string { return `${ALGOLIA}?${query ? 'query=' + encodeURIComponent(query) + '&' : ''}tags=${tag || 'story'}&hitsPerPage=20` }

function searchUrlInfo(locator: string): { provider: 'google_news' | 'hn'; query: string; url: string } | null {
  let u: URL
  try { u = new URL(locator) } catch { return null }
  if ((u.hostname === 'news.google.com' && u.pathname.startsWith('/rss/search')) || (TEST_MODE && u.hostname === 'news-search.test' && u.pathname === '/rss'))
    return { provider: 'google_news', query: (u.searchParams.get('q') || '').replace(/\s*when:\d+d\s*/, '').trim(), url: locator }
  if (u.hostname === 'hn.algolia.com' && u.pathname.startsWith('/api/v1/search')) return { provider: 'hn', query: u.searchParams.get('query') || (u.searchParams.get('tags') || '').replace(/,?story/, ''), url: locator }
  return null
}

export async function results(provider: string, url: string): Promise<{ id: string; title: string; link: string | null; snippet: string; publishedAt: number | null; publisher: string | null }[]> {
  if (provider === 'hn') {
    const j = JSON.parse((await httpGet(url, { accept: 'application/json' })).body.toString('utf8'))
    return (j.hits || []).map((h: any) => ({ id: 'hn:' + h.objectID, title: h.title || h.story_title || '', link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, snippet: (h.story_text || '').replace(/<[^>]+>/g, ' ').slice(0, 400), publishedAt: h.created_at_i ? h.created_at_i * 1000 : null, publisher: h.url ? hostOf(h.url) : 'Hacker News' }))
  }
  const res = await httpGet(url, { accept: 'application/rss+xml, application/xml' })
  const f = parseFeed(res.body.toString('utf8'), res.url || url)
  return f.items.map(i => {
    const m = i.title.match(/^(.*)\s[-–—]\s([^-–—]+)$/)
    return { id: i.guid || i.link, title: (m ? m[1] : i.title).trim(), link: i.link || null, snippet: (i.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), publishedAt: i.publishedAt, publisher: m ? m[2].trim() : null }
  })
}

/** Resolve a Google News article link to the publisher URL (HTTP redirects first, then a browser load). */
export async function resolveLink(link: string): Promise<string | null> {
  try {
    const r = await httpGet(link, { timeoutMs: 15_000 })
    if (hostOf(r.url) !== 'news.google.com') return r.url
  } catch { /* fall through */ }
  if (hostOf(link) !== 'news.google.com') return null
  try {
    const r = await renderPage(link, { until: u => !!u && hostOf(u) !== 'news.google.com' && !u.startsWith('about:'), timeoutMs: 25_000, quietMs: 500 })
    return r.url
  } catch { return null }
}

async function fetchSearch(src: SourceRow, cursor: any, ctx: FetchCtx): Promise<FetchResult> {
  const cfg = JSON.parse(src.config_json)
  const s = cfg.fetch.search as { provider: string; query: string; url: string }
  // a backfill widens the saved search's own window ("when:7d" → the days asked for)
  const days = ctx.ignoreSeen && ctx.since ? Math.ceil((now() - ctx.since) / 86400_000) : 0
  const url = days > 7 && s.provider === 'google_news' ? s.url.replace(/(%20|\+|\s)when(%3A|:)\d+d/i, `$1when$2${days}d`) : s.url
  const list = await results(s.provider, url)
  const seen: string[] = cursor?.seenIds || []
  const items: Item[] = []
  let errors = 0
  const max = ctx.maxItems || cfg.fetch.maxItemsPerSync || 30
  // first sync / backfill: the dated window (DEC-085); results outside it are marked seen and wait for a backfill
  const unseen = ctx.ignoreSeen ? list : list.filter(r => !seen.includes(r.id))
  // a regular sync takes only what was published since the last one (less a day for late indexing): the engine returns
  // a shifting subset of ≤100 results, so "not seen before" alone would pull week-old articles in as new
  const floor = cursor?.lastPublishedAt ? cursor.lastPublishedAt - 86400_000 : 0
  const fresh = ctx.since ? inWindow(unseen, r => r.publishedAt, { ...ctx, maxItems: max })
    : unseen.filter(r => !floor || (r.publishedAt != null && r.publishedAt >= floor)).slice(0, max)
  for (const r of fresh) {
    try {
      const publisherUrl = r.link ? (s.provider === 'hn' ? r.link : await resolveLink(r.link)) : null
      if (publisherUrl) {
        try {
          const a = await fetchArticle(publisherUrl, { render: 'auto', robots: true })
          if (a.parsed.text.trim()) {
            items.push({ itemKey: r.id, url: a.finalUrl, canonicalTag: a.parsed.canonical, kind: 'web', title: a.parsed.title || r.title, text: a.parsed.text, author: a.parsed.byline, siteName: a.parsed.siteName || r.publisher || hostOf(a.finalUrl), publishedAt: a.parsed.publishedAt ?? r.publishedAt, access: a.parsed.wall.found ? 'partial' : 'full', raw: { ext: 'html', body: a.html }, metadata: { search: { provider: s.provider, query: s.query } } })
            continue
          }
        } catch (e) { log.warn('search', 'publisher fetch failed', { host: hostOf(publisherUrl), err: String((e as Error).message) }) }
      }
      const text = [r.title, r.snippet].filter(Boolean).join('\n\n')
      items.push({ itemKey: r.id, url: r.link, kind: 'web', title: r.title, text, siteName: r.publisher || 'Search result', publishedAt: r.publishedAt, access: 'partial', raw: { ext: 'txt', body: text }, metadata: { search: { provider: s.provider, query: s.query }, headlineOnly: true } })
    } catch (e) { errors++; log.warn('search', 'result failed', { err: String((e as Error).message) }) }
  }
  return { items, cursor: { seenIds: [...new Set([...list.map(r => r.id), ...seen])].slice(0, 5000), lastPublishedAt: Math.max(cursor?.lastPublishedAt || 0, ...list.map(r => r.publishedAt || 0)) }, stats: { seen: list.length, new: fresh.length }, errors }
}

export function registerSearch(): void {
  addProbeHandler(async (locator: string): Promise<ProbeResult | null> => {
    let info = searchUrlInfo(locator)
    if (!info) {
      const raw = locator.trim()
      const isQuery = raw.startsWith('search:') || (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) && !/^[^\s/]+\.[a-z]{2,}(\/|$)/i.test(raw) && /\s|^"/.test(raw.replace(/^search:/, '')))
      if (!isQuery) return null
      const query = raw.replace(/^search:\s*/, '').replace(/^["“]|["”]$/g, '').trim()
      const hn = /\b(hn|hacker news|show hn)\b/i.test(query)
      const tag = /\bshow hn\b/i.test(query) ? 'show_hn' : undefined
      const q = hn ? query.replace(/\b(on |from )?(hn|hacker news|show hn)\b/gi, '').trim() : query
      info = hn ? { provider: 'hn', query: q, url: algoliaUrl(q, tag) } : { provider: 'google_news', query: q, url: googleUrl(q) }
    }
    try {
      const rs = await results(info.provider, info.url)
      const recent = rs.slice(0, 5).map(r => ({ title: r.title, url: r.link || undefined, publishedAt: r.publishedAt ?? undefined }))
      return baseResult(info.url, {
        status: 'found', kind: 'search', name: `Search: ${info.query}`, typeLabel: 'Saved search', canonicalLocator: info.url, trust: 'editorial', recent,
        suggestedMode: 'custom', suggestedFreq: 'daily', relatedThesisIds: relatedTheses([info.query, ...recent.map(r => r.title)]), siteDomain: null,
        configDraft: { version: 1, fetch: { adapter: 'search', search: { provider: info.provider, query: info.query, url: info.url, windowDays: 7 }, render: 'http', maxItemsPerSync: 30, historyWindowDays: 30 }, extract: { customFieldKeys: 'all_active' } }
      })
    } catch (e) {
      return baseResult(info.url, { status: 'unreachable', kind: 'search', name: `Search: ${info.query}`, message: 'The search service didn’t respond. Try again later.' })
    }
  })
  addAdapter('search', fetchSearch)
}
