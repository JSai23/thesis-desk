// HTML → normalized article text and page metadata (runs inside the parser utilityProcess).
// Text is built from Readability's `content` HTML with a paragraph break after each block (MEM-016).
// When a wall is detected, everything at or after the first wall element/phrase is discarded (DEC-050).
import { JSDOM, VirtualConsole } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { leadImage } from './lead-image'

export const DEFAULT_WALL_PHRASES = ['sign in to continue', 'log in to continue', 'register to continue', 'create a free account', 'subscribe to continue', 'to keep reading', 'this article is for subscribers', 'already a subscriber', 'sign in to read', 'upgrade to']

export interface ParseResult {
  title: string; byline: string | null; siteName: string | null; publishedAt: number | null; lang: string | null
  text: string; canonical: string | null; feedLinks: { href: string; type: string; title: string }[]
  links: { href: string; text: string }[]; isArticle: boolean; wall: { found: boolean; phrase: string | null; via: 'element' | 'phrase' | null }
  loginHref: string | null; rawTextChars: number; mentionsPortfolio: boolean; ogType: string | null
  /** lead image (og:image / twitter:image / first large article <img>), absolute https (See DEC-093) */
  image: string | null
}

const vc = new VirtualConsole()
const BLOCK_END = /<\/(p|h[1-6]|li|div|blockquote|pre|section|article|tr|figure|figcaption)>/gi
const DATE_ONLY = /^(by\s+[^·|]{1,60}\s*[·|-]\s*)?(\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]{2,8} \d{4})(\s*[·|-].{0,40})?$/i

export function paragraphsOf(html: string): string[] {
  const d = new JSDOM(`<body>${html.replace(BLOCK_END, m => m + '\n\n').replace(/<br\s*\/?>/gi, '\n')}</body>`, { virtualConsole: vc }).window.document
  return (d.body.textContent || '').split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

function wallElement(doc: Document, phrases: string[]): Element | null {
  // paywall/regwall classes are walls by name; subscribe/gate boxes count only when they carry a wall phrase
  // (newsletter sign-up widgets in the middle of free articles must not truncate them)
  const cands = [...doc.querySelectorAll('[class],[id]')].filter(el => {
    const k = `${el.getAttribute('class') || ''} ${el.getAttribute('id') || ''}`
    if (el.closest('nav,header,footer')) return false
    if (/paywall|regwall/i.test(k)) return true
    if (/(^|[-_\s])(subscribe|gate)([-_\s]|$)/i.test(k)) { const t = (el.textContent || '').toLowerCase(); return phrases.some(p => t.includes(p)) }
    return false
  })
  return cands.find(el => (el.textContent || '').trim().length > 0) || null
}

/** Remove `el` and everything after it in document order. */
function truncateFrom(el: Element): void {
  let node: Element | null = el
  while (node && node.tagName !== 'BODY') {
    let sib = node.nextSibling
    while (sib) { const next = sib.nextSibling; sib.parentNode?.removeChild(sib); sib = next }
    const parent: Element | null = node.parentElement
    if (node === el) node.parentNode?.removeChild(node)
    node = parent
  }
}

export function parseHtml(html: string, url: string, opts: { wallPhrases?: string[]; checkWall?: boolean } = {}): ParseResult {
  const image = leadImage(html, url)
  const dom = new JSDOM(html, { url, virtualConsole: vc })
  const doc = dom.window.document
  const q = (sel: string, attr: string) => doc.querySelector(sel)?.getAttribute(attr) || null
  const canonical = q('link[rel="canonical"]', 'href')
  const feedLinks = [...doc.querySelectorAll('link[rel="alternate"]')].filter(l => /application\/(rss|atom)\+xml/i.test(l.getAttribute('type') || '')).map(l => ({ href: new URL(l.getAttribute('href') || '', url).toString(), type: l.getAttribute('type') || '', title: l.getAttribute('title') || '' }))
  const links = [...doc.querySelectorAll('a[href]')].map(a => { try { return { href: new URL(a.getAttribute('href')!, url).toString(), text: (a.textContent || '').trim() } } catch { return null } }).filter(Boolean) as { href: string; text: string }[]
  const loginHref = links.find(l => /sign in|log in|login/i.test(l.text))?.href || null
  const navText = [...doc.querySelectorAll('nav a, header a')].map(a => (a.textContent || '').toLowerCase()).join(' ')
  const mentionsPortfolio = /portfolio/.test(navText) && /investments?/.test(navText)
  const pub = q('meta[property="article:published_time"]', 'content') || q('meta[name="date"]', 'content') || q('meta[itemprop="datePublished"]', 'content') || ldDate(doc) || doc.querySelector('time[datetime]')?.getAttribute('datetime') || null
  const publishedAt = pub && Number.isFinite(Date.parse(pub)) ? Date.parse(pub.length === 10 ? pub + 'T12:00:00' : pub) : null
  const ogType = q('meta[property="og:type"]', 'content')
  const lang = doc.documentElement.getAttribute('lang')
  const phrases = [...DEFAULT_WALL_PHRASES, ...(opts.wallPhrases || [])].map(p => p.toLowerCase())
  let wall: ParseResult['wall'] = { found: false, phrase: null, via: null }
  if (opts.checkWall !== false) {
    const el = wallElement(doc, phrases)
    if (el) { wall = { found: true, phrase: (el.textContent || '').trim().slice(0, 80), via: 'element' }; truncateFrom(el) }
  }
  const rawTextChars = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim().length
  stripDisclaimers(doc)
  const article = new Readability(doc.cloneNode(true) as Document).parse()
  let paras = article?.content ? paragraphsOf(article.content) : paragraphsOf(doc.body?.innerHTML || '')
  // drop a leading date / byline-only line (page chrome, not article text)
  while (paras.length > 1 && paras[0].length <= 90 && DATE_ONLY.test(paras[0])) paras = paras.slice(1)
  let text = paras.join('\n\n')
  if (opts.checkWall !== false) {
    const lower = text.toLowerCase()
    const tailStart = Math.floor(lower.length * 0.6)
    for (const p of phrases) {
      const i = lower.indexOf(p, tailStart)
      if (i >= 0) {
        wall = { found: true, phrase: p, via: wall.via || 'phrase' }
        const cut = lower.lastIndexOf('\n\n', i)
        text = text.slice(0, cut > 0 ? cut : i).trim()
        break
      }
    }
  }
  let title = (article?.title || doc.title || '').trim() || (paras[0] || '').slice(0, 120)
  // some sites ship a <title> that lost its leading characters (AFR: "itanium Ventures leads…" while og:title and
  // the h1 read "Titanium Ventures leads…"): a headline that ends with the parsed title and is longer restores it
  const full = [q('meta[property="og:title"]', 'content'), doc.querySelector('h1')?.textContent].map(t => (t || '').replace(/\s+/g, ' ').trim())
    .find(t => title.length >= 12 && t.length > title.length && t.length - title.length <= 3 && t.toLowerCase().endsWith(title.toLowerCase()))
  if (full) title = full
  const pCount = paras.filter(p => p.length > 80).length
  const isArticle = ogType === 'article' || !!doc.querySelector('article') && pCount >= 3 || pCount >= 6
  return { title, byline: cleanByline(article?.byline) || bylineOf(doc), siteName: article?.siteName || q('meta[property="og:site_name"]', 'content'), publishedAt, lang, text, canonical, feedLinks, links, isArticle, wall, loginHref, rawTextChars, mentionsPortfolio, ogType, image }
}

/** schema.org `datePublished` from JSON-LD — the only date many sites (a16z) publish in markup. */
function ldDate(doc: Document): string | null {
  for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const m = (el.textContent || '').match(/"datePublished"\s*:\s*"([^"]+)"/)
    if (m && Number.isFinite(Date.parse(m[1]))) return m[1]
  }
  return null
}

/** Legal disclaimer blocks (VC sites put long ones on every post) can outweigh a short article in Readability's scoring. */
const DISCLAIMER = [/not (?:be )?(?:construed as|intended as|constitute) (?:an? )?(?:offer|investment|legal|tax)/i, /investment advi[sc]e/i, /(?:are|is) not the views of/i,
  /registered with the Securities and Exchange Commission|investment adviser registered/i, /for informational purposes only/i, /past performance/i, /solicitation of an offer/i, /no assurances?/i]
const disclaimerHits = (t: string) => DISCLAIMER.filter(r => r.test(t)).length
function stripDisclaimers(doc: Document): void {
  const bodyLen = (doc.body?.textContent || '').length
  const blocks = [...doc.querySelectorAll('div, section, aside, footer')].filter(el => {
    const t = el.textContent || ''
    return t.length < bodyLen * 0.7 && disclaimerHits(t) >= 2
  })
  // the innermost matching blocks: no matching block inside them
  for (const el of blocks) if (!blocks.some(o => o !== el && el.contains(o))) el.remove()
  for (const el of [...doc.querySelectorAll('p')]) if (disclaimerHits(el.textContent || '') >= 2) el.remove()
}

const BY_LINE = /^\s*(?:[Bb]y|[Ww]ritten [Bb]y)\s+([A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,3})/u
const cleanByline = (b: string | null | undefined): string | null => {
  const t = (b || '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.match(BY_LINE)?.[1] || (t.length <= 60 ? t : null)
}
/** Fallback when Readability finds no byline: author meta tags, byline/author elements, or a leading "By Name" line. */
function bylineOf(doc: Document): string | null {
  const meta = doc.querySelector('meta[name="author"], meta[property="article:author"]')?.getAttribute('content')
  if (meta && !/^https?:/.test(meta)) return cleanByline(meta)
  for (const el of Array.from(doc.querySelectorAll('[rel="author"], [itemprop="author"], .byline, .author, .meta, article header p, article > p')).slice(0, 12)) {
    const m = (el.textContent || '').match(BY_LINE)
    if (m) return m[1]
  }
  return null
}
