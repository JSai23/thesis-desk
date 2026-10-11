// RSS/Atom parsing and web-listing link detection shared by probe and adapters.
import { XMLParser } from 'fast-xml-parser'
import { hostOf } from '../ingest/url'

export interface FeedItem { guid: string; title: string; link: string; publishedAt: number | null; content: string; summary: string }
export interface ParsedFeed { title: string; link: string | null; items: FeedItem[] }

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true, htmlEntities: true })
const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x])
const txt = (x: any): string => (x == null ? '' : typeof x === 'string' ? x : typeof x === 'number' ? String(x) : x['#text'] != null ? String(x['#text']) : '')
const date = (s: string) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null }

export function looksLikeFeed(contentType: string, body: string): boolean {
  if (/(rss|atom)\+xml|application\/xml|text\/xml/i.test(contentType)) return /<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 2000))
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 2000))
}

export function parseFeed(body: string, baseUrl: string): ParsedFeed {
  const j = xml.parse(body)
  if (j.rss || j['rdf:RDF']) {
    const ch = j.rss ? j.rss.channel : j['rdf:RDF'].channel
    const items = arr(j.rss ? ch?.item : j['rdf:RDF'].item)
    return {
      title: txt(ch?.title).trim(), link: txt(ch?.link) || null,
      items: items.map((i: any) => {
        const link = abs(txt(i.link) || txt(i.guid), baseUrl)
        return { guid: txt(i.guid) || link || txt(i.title), title: txt(i.title).trim(), link, publishedAt: date(txt(i.pubDate) || txt(i['dc:date'])), content: txt(i['content:encoded']), summary: txt(i.description) }
      })
    }
  }
  if (j.feed) {
    const f = j.feed
    const linkOf = (l: any) => { const ls = arr(l); const alt = ls.find((x: any) => !x['@_rel'] || x['@_rel'] === 'alternate') || ls[0]; return alt ? alt['@_href'] || txt(alt) : '' }
    return {
      title: txt(f.title).trim(), link: linkOf(f.link) || null,
      items: arr(f.entry).map((e: any) => {
        const link = abs(linkOf(e.link), baseUrl)
        return { guid: txt(e.id) || link, title: txt(e.title).trim(), link, publishedAt: date(txt(e.published) || txt(e.updated)), content: txt(e.content), summary: txt(e.summary) }
      })
    }
  }
  throw new Error('Not a feed')
}

function abs(u: string, base: string): string { try { return new URL(u.trim(), base).toString() } catch { return u.trim() } }

const DATE_SEG = /^(19|20)\d{2}$|^\d{1,2}$/

/** Same-host links that look like articles (≥2 path segments or date segments), in document order, deduped. */
export function articleLinks(links: { href: string; text: string }[], pageUrl: string): string[] {
  const host = hostOf(pageUrl)
  const page = new URL(pageUrl)
  const out: string[] = []
  for (const l of links) {
    let u: URL
    try { u = new URL(l.href) } catch { continue }
    if (hostOf(u.toString()) !== host || !/^https?:$/.test(u.protocol)) continue
    u.hash = ''
    const segs = u.pathname.split('/').filter(Boolean)
    // top-level document pages (e.g. paulgraham.com/greatwork.html) count when the link text reads like a title
    const titledPage = segs.length === 1 && /\.(s?html?|php|aspx?)$/i.test(segs[0]) && !/^(index|default|home)\./i.test(segs[0]) && l.text.trim().split(/\s+/).length >= 2
    if (segs.length < 2 && !segs.some(s => DATE_SEG.test(s)) && !titledPage) continue
    if (/\.(png|jpe?g|gif|svg|pdf|xml|rss|zip|css|js)$/i.test(u.pathname)) continue
    if (/^\/(tag|tags|category|categories|author|authors|page|search|login|signin|sign-in|feed)\//i.test(u.pathname)) continue
    if (u.pathname.replace(/\/$/, '') === page.pathname.replace(/\/$/, '')) continue
    const s = u.toString()
    if (!out.includes(s)) out.push(s)
  }
  return out
}

/** Longest common path prefix of article links, cut before the first date-like segment. */
export function commonPrefix(urls: string[]): string {
  if (!urls.length) return '/'
  const paths = urls.map(u => new URL(u).pathname.split('/').filter(Boolean))
  const first = paths[0]
  const pre: string[] = []
  for (let i = 0; i < first.length - 1; i++) {
    if (DATE_SEG.test(first[i])) break
    if (paths.every(p => p[i] === first[i] && p.length > i + 1)) pre.push(first[i]); else break
  }
  return '/' + pre.map(s => s + '/').join('')
}

export function matchesPattern(u: string, pattern: string): boolean {
  try { return new URL(u).pathname.startsWith(pattern) } catch { return false }
}
