// Source probe (RFC §1B.8.3): classify a locator as rss / web / hn_api / email / search, or
// unsupported / unreachable / blocked / login_required, with recent titles and a deterministic config draft.
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { all, one } from '../db'
import { STARTER_PACK_OVERRIDE } from '../env'
import { AppError } from '../errors'
import { httpGet, robotsAllowed } from './http'
import { parsePage } from '../ingest/parser'
import { normalizeLocator, hostOf, registrableDomain, isHttpUrl, cleanUrl } from '../ingest/url'
import { looksLikeFeed, parseFeed, articleLinks, commonPrefix } from './feeds'
import { DEFAULT_WALL_PHRASES } from '../ingest/parse-html'

export type Freq = 'realtime' | 'hourly' | 'daily' | 'weekly'
export interface ProbeResult {
  status: 'found' | 'login_required' | 'unsupported' | 'unreachable' | 'blocked' | 'article'
  kind?: 'rss' | 'web' | 'hn_api' | 'email' | 'search'
  name: string; typeLabel: string; siteDomain?: string | null; canonicalLocator: string; trust: 'primary' | 'editorial' | 'community'
  recent: { title: string; url?: string; publishedAt?: number }[]
  suggestedMode: 'all' | 'relevant' | 'custom'; suggestedFreq: Freq; relatedThesisIds: string[]
  auth?: { required: boolean; strategy: 'app_browser_session'; loginUrl?: string; reason: string; profile: AuthProfile }
  configDraft: any; message?: string
}
export interface AuthProfile { domain: string; partition: string; loginUrl: string; checkCandidates: string[]; checkUrl?: string; wall: { phrases: string[]; loggedOutChars: number }; pass: { minChars: number } }

const UNSUPPORTED_HOSTS = ['producthunt.com', 'youtube.com', 'youtu.be', 'open.spotify.com', 'podcasts.apple.com']
export const RESTRICTED_SOCIAL = ['x.com', 'twitter.com', 'linkedin.com', 'x.test', 'linkedin.test']
const ON_DEMAND_COPY = 'X and LinkedIn can’t be watched automatically. Send individual posts with Read once or the bookmarklet.'
const UNSUPPORTED_COPY = 'Research Workspace can’t monitor this kind of source yet. Paste a link with Read once instead.'
const NO_LIST_COPY = 'I couldn’t find a list of posts on this page. Try the blog or news page.'
const PUBLICATIONS = ['techcrunch.com', 'crunchbase.com', 'sifted.eu', 'bloomberg.com', 'reuters.com', 'theverge.com', 'axios.com', 'fortune.com', 'wsj.com', 'ft.com', 'businessinsider.com', 'forbes.com', 'theinformation.com', 'vln.test', 'signalwire.test', 'ledger.test']

type Extra = (locator: string, once: boolean) => Promise<ProbeResult | null>
const extras: Extra[] = []
/** Later phases add email (PH-06) and saved-search (PH-07b) recognizers. */
export function addProbeHandler(h: Extra): void { extras.push(h) }

export function baseResult(locator: string, o: Partial<ProbeResult> = {}): ProbeResult {
  const r: ProbeResult = { status: 'unsupported', name: locator, typeLabel: '', canonicalLocator: locator, trust: 'editorial', recent: [], suggestedMode: 'relevant', suggestedFreq: 'daily', relatedThesisIds: [], configDraft: null, ...o }
  // "relevant to my theses" with no theses hides everything: keep all until the user has a thesis to compare against
  if (r.suggestedMode === 'relevant' && !one('SELECT 1 FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL')) r.suggestedMode = 'all'
  return r
}

export function relatedTheses(titles: string[]): string[] {
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3))
  const tw = words(titles.join(' '))
  return all<{ id: string; title: string }>('SELECT id, title FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL')
    .filter(t => [...words(t.title)].some(w => tw.has(w))).map(t => t.id)
}

function isSocialProfile(u: URL): boolean {
  const h = u.hostname.replace(/^www\./, '')
  return RESTRICTED_SOCIAL.some(d => h === d || h.endsWith('.' + d))
}

function typeLabel(kind: string, domain: string, html: { mentionsPortfolio: boolean } | null, listingPath: string): { label: string; trust: ProbeResult['trust'] } {
  if (kind === 'hn_api') return { label: 'Hacker News', trust: 'community' }
  if (kind === 'email') return { label: 'Newsletter', trust: 'editorial' }
  const firmDomain = all<{ domain: string }>('SELECT domain FROM firms WHERE domain IS NOT NULL AND merged_into_id IS NULL').some(f => f.domain === domain)
  if (firmDomain || html?.mentionsPortfolio) return { label: 'VC blog', trust: 'primary' }
  const coDomain = all<{ domain: string }>('SELECT domain FROM companies WHERE domain IS NOT NULL AND merged_into_id IS NULL').some(c => c.domain === domain)
  if (coDomain || (/\/(blog|news|changelog|press)/i.test(listingPath) && !PUBLICATIONS.some(p => domain.endsWith(p)))) return { label: 'Company blog', trust: 'primary' }
  if (kind === 'rss') return { label: 'RSS feed', trust: 'editorial' }
  return { label: 'Publication', trust: 'editorial' }
}

function wallIn(text: string, extraPhrases: string[] = []): boolean {
  const l = text.toLowerCase()
  const tail = l.slice(Math.floor(l.length * 0.6))
  return [...DEFAULT_WALL_PHRASES, ...extraPhrases].some(p => tail.includes(p))
}

/** A source typed by name ("crunchbase news", "paul graham") resolves to the known starter-pack entry, not a web search. */
function knownByName(q: string): string | null {
  const k = q.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (k.length < 5 || /[/.:@]/.test(q)) return null
  const f = [path.join(app.getAppPath(), 'app/resources/starter-pack.json'), path.join(process.cwd(), 'app/resources/starter-pack.json')].find(x => fs.existsSync(x))
  const list: { name: string; locator: string; available?: boolean }[] = f ? JSON.parse(fs.readFileSync(f, 'utf8')) : []
  const hit = list.find(x => x.available !== false && x.name.toLowerCase().replace(/[^a-z0-9]/g, '') === k)
    || list.find(x => x.available !== false && x.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(k))
  return hit && !/^[^@\s]+@/.test(hit.locator) ? hit.locator : null
}

export async function probe(rawLocator: string, once = false, nested = false): Promise<ProbeResult> {
  const known = !nested && STARTER_PACK_OVERRIDE !== 'fixtures' ? knownByName(rawLocator.trim()) : null
  if (known) return probe(known, once, true)
  const locator = normalizeLocator(rawLocator)
  for (const h of extras) { const r = await h(locator, once); if (r) return r }
  if (!isHttpUrl(locator)) return baseResult(locator, { status: 'unsupported', message: 'Paste a website, feed, newsletter address, or a search phrase.' })
  let u: URL
  try { u = new URL(locator) } catch { return baseResult(locator, { status: 'unsupported', message: 'That doesn’t look like a web address.' }) }
  const host = u.hostname.replace(/^www\./, '')
  if (isSocialProfile(u)) return baseResult(locator, { status: 'unsupported', name: host, message: ON_DEMAND_COPY })
  if (UNSUPPORTED_HOSTS.some(d => host === d || host.endsWith('.' + d))) return baseResult(locator, { status: 'unsupported', name: host, message: UNSUPPORTED_COPY })

  const work = (async (): Promise<ProbeResult> => {
    // Hacker News API (official) by locator
    if (/(^|\.)news\.ycombinator\.com$|hacker-news\.firebaseio\.com$|^hn\.test$/.test(u.hostname) && !/\/rss$/.test(u.pathname)) {
      const apiBase = u.hostname === 'news.ycombinator.com' ? 'https://hacker-news.firebaseio.com/v0' : locator.replace(/\/(topstories|newstories)\.json$/, '').replace(/\/$/, '')
      const top = await httpGet(apiBase + '/topstories.json', { polite: false, accept: 'application/json' })
      const ids: number[] = JSON.parse(top.body.toString('utf8')).slice(0, 5)
      const recent: ProbeResult['recent'] = []
      for (const id of ids) { try { const it = JSON.parse((await httpGet(`${apiBase}/item/${id}.json`, { polite: false, accept: 'application/json' })).body.toString('utf8')); if (it?.title) recent.push({ title: it.title, url: it.url }) } catch { /* skip */ } }
      return baseResult(apiBase, { status: 'found', kind: 'hn_api', name: 'Hacker News', typeLabel: 'Hacker News', canonicalLocator: apiBase, trust: 'community', recent, suggestedMode: 'relevant', suggestedFreq: 'hourly', siteDomain: registrableDomain(apiBase), relatedThesisIds: relatedTheses(recent.map(r => r.title)),
        configDraft: { version: 1, fetch: { adapter: 'hn_api', render: 'http', hn: { apiBase, list: 'topstories', maxPerSync: 30, minScore: 0 }, maxItemsPerSync: 30, historyWindowDays: 30 }, extract: { customFieldKeys: 'all_active' } } })
    }
    let res
    try { res = await httpGet(locator, { polite: false }) } catch (e) {
      return baseResult(locator, { status: 'unreachable', name: host, message: e instanceof AppError ? e.message : 'The site didn’t respond.' })
    }
    const body = res.body.toString('utf8')
    const finalUrl = res.url || locator
    const domain = registrableDomain(finalUrl)
    if (looksLikeFeed(res.contentType, body)) return feedResult(finalUrl, body, domain, null)
    if (!once && !(await robotsAllowed(finalUrl))) return baseResult(locator, { status: 'blocked', name: host, siteDomain: domain, message: 'This site asks automated readers not to check it, so I won’t watch it. You can still use Read once.' })
    const page = await parsePage(body, finalUrl, { checkWall: false })
    if (page.feedLinks.length) {
      try {
        const f = await httpGet(page.feedLinks[0].href, { polite: false, accept: 'application/rss+xml, application/atom+xml, application/xml' })
        const fb = f.body.toString('utf8')
        if (looksLikeFeed(f.contentType, fb)) return feedResult(f.url || page.feedLinks[0].href, fb, domain, page)
      } catch { /* fall through to web listing */ }
    }
    const links = articleLinks(page.links, finalUrl)
    if (links.length < 3) {
      if (page.isArticle || page.text.length > 1500) return baseResult(finalUrl, { status: 'article', name: page.title || host, siteDomain: domain, canonicalLocator: cleanUrl(finalUrl), message: 'This looks like a single article. Read it once instead?' })
      // a home page without a post list (a16z.com, paulgraham.com): follow its own blog/news/essays link
      if (!nested) {
        const listing = page.links.map(l => l.href).filter(h => { try { const v = new URL(h); return registrableDomain(h) === domain && /^\/(?:blog|news|news-content|newsroom|articles|essays|posts|insights|writing|stories|journal|perspectives)(?:\.html?)?\/?$/i.test(v.pathname) } catch { return false } })
        for (const l of [...new Set(listing)].slice(0, 3)) {
          const r = await probe(l, once, true)
          if (r.status === 'found') return { ...r, message: `Watching ${new URL(l).pathname} — the site’s list of posts.` }
        }
      }
      return baseResult(finalUrl, { status: 'unsupported', name: page.title || host, siteDomain: domain, message: NO_LIST_COPY })
    }
    const pattern = commonPrefix(links)
    const candidates = links.filter(l => new URL(l).pathname.startsWith(pattern))
    const tl = typeLabel('web', domain, page, new URL(finalUrl).pathname + ' ' + pattern)
    const titleOf = (href: string) => page.links.find(l => l.href.replace(/#.*$/, '') === href)?.text || href
    const recent = candidates.slice(0, 5).map(href => ({ title: titleOf(href).replace(/\s+/g, ' ').trim(), url: href }))
    // auth detection: fetch up to 5 recent articles logged out; walled ones become check candidates
    const walled: { url: string; chars: number; phrase: string | null }[] = []
    for (const r of recent.slice(0, 5)) {
      try {
        const a = await httpGet(r.url!, { polite: false })
        const ap = await parsePage(a.body.toString('utf8'), a.url, {})
        if (ap.wall.found || wallIn(ap.text)) walled.push({ url: r.url!, chars: ap.text.length, phrase: ap.wall.phrase })
      } catch { /* ignore */ }
    }
    const name = sourceName((page.siteName || page.title || host).split(/\s[|–—-]\s/)[0].trim(), domain || host)
    const configDraft = { version: 1, fetch: { adapter: 'web', listingUrl: cleanUrl(finalUrl), articleUrlPattern: pattern, render: walled.length ? 'browser' : 'http', maxItemsPerSync: 30, historyWindowDays: 30 }, extract: { customFieldKeys: 'all_active' } }
    const common = { kind: 'web' as const, name, typeLabel: tl.label, siteDomain: domain, canonicalLocator: cleanUrl(finalUrl), trust: tl.trust, recent, suggestedMode: tl.trust === 'primary' ? 'all' as const : 'relevant' as const, suggestedFreq: (tl.label === 'Publication' ? 'hourly' : 'daily') as Freq, relatedThesisIds: relatedTheses(recent.map(r => r.title)), configDraft }
    if (walled.length) {
      const loggedOut = Math.max(...walled.map(w => w.chars))
      const extraPhrases = [...new Set(walled.map(w => (w.phrase || '').toLowerCase().replace(/[.!]+$/, '').trim()).filter(p => p && p.length <= 80))]
      const loginUrl = page.loginHref || new URL('/', finalUrl).toString()
      const profile: AuthProfile = { domain, partition: 'persist:auth:' + domain, loginUrl, checkCandidates: walled.map(w => w.url).slice(0, 5), wall: { phrases: extraPhrases, loggedOutChars: loggedOut }, pass: { minChars: Math.max(1200, Math.round(1.5 * loggedOut)) } }
      return baseResult(finalUrl, { ...common, status: 'login_required', configDraft: { ...configDraft, fetch: { ...configDraft.fetch, render: 'browser' } }, auth: { required: true, strategy: 'app_browser_session', loginUrl, reason: 'Articles are behind a sign-in wall', profile }, message: 'This source needs you to sign in before I can monitor it. Sign in once in the source window; your session stays on this Mac.' })
    }
    return baseResult(finalUrl, { ...common, status: 'found' })
  })()
  const timeout = new Promise<ProbeResult>(resolve => setTimeout(() => resolve(baseResult(locator, { status: 'unreachable', name: host, message: 'The site took too long to respond.' })), nested ? 10_000 : 25_000))
  try { return await Promise.race([work, timeout]) } catch (e) {
    return baseResult(locator, { status: 'unreachable', name: host, message: e instanceof AppError ? e.message : 'The site didn’t respond.' })
  }
}

/** A bare section title ("Essays", "Blog") doesn't say whose it is: prefix the site. */
const GENERIC_NAME = /^(?:the )?(?:blog|news|newsroom|press|press releases|media|articles?|essays?|posts?|stories|insights|writing|latest|home|feed|rss|updates|journal|library|perspectives|ideas|resources?|resource center|resource centre|events|announcements)$/i
export const sourceName = (name: string, site: string): string => (GENERIC_NAME.test(name.trim()) && site ? `${site} · ${name.trim()}` : name)

function feedResult(feedUrl: string, body: string, domain: string, page: { mentionsPortfolio: boolean } | null): ProbeResult {
  const f = parseFeed(body, feedUrl)
  const site = f.link ? registrableDomain(f.link) : domain
  const tl = typeLabel('rss', site, page, f.link ? new URL(f.link, feedUrl).pathname : '')
  const recent = f.items.slice(0, 5).map(i => ({ title: i.title, url: i.link, publishedAt: i.publishedAt ?? undefined }))
  return baseResult(feedUrl, {
    status: 'found', kind: 'rss', name: sourceName(f.title || hostOf(feedUrl), site || hostOf(feedUrl)), typeLabel: tl.label === 'Publication' ? 'RSS feed' : tl.label, siteDomain: site, canonicalLocator: cleanUrl(feedUrl), trust: tl.trust,
    recent, suggestedMode: tl.trust === 'primary' ? 'all' : 'relevant', suggestedFreq: 'hourly', relatedThesisIds: relatedTheses(recent.map(r => r.title)),
    configDraft: { version: 1, fetch: { adapter: 'rss', feedUrl: cleanUrl(feedUrl), render: 'http', maxItemsPerSync: 30, historyWindowDays: 30 }, extract: { customFieldKeys: 'all_active' } }
  })
}
