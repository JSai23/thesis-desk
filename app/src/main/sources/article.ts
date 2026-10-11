// Shared article fetch for rss/web/hn/manual (RFC §1B.8.2): http first; browser mode when configured or when the
// http HTML yields < 500 chars of article text but the rendered DOM yields ≥ 2× more.
import { httpGet, robotsAllowed } from './http'
import { renderPage } from './browser'
import { parsePage } from '../ingest/parser'
import type { ParseResult } from '../ingest/parse-html'
import { AppError } from '../errors'

export interface ArticleResult { finalUrl: string; html: string; parsed: ParseResult; render: 'http' | 'browser' }

export async function fetchArticle(url: string, o: { render?: 'http' | 'browser' | 'auto'; partition?: string; robots?: boolean; wallPhrases?: string[]; polite?: boolean } = {}): Promise<ArticleResult> {
  if (o.robots && !(await robotsAllowed(url))) throw new AppError('ROBOTS_BLOCKED', 'This site asks automated readers not to fetch this page.')
  const mode = o.render || 'auto'
  if (mode === 'browser') {
    const r = await renderPage(url, { partition: o.partition })
    return { finalUrl: r.url, html: r.html, parsed: guardNotArticle(await parsePage(r.html, r.url, { wallPhrases: o.wallPhrases })), render: 'browser' }
  }
  const res = await httpGet(url, { partition: o.partition, polite: o.polite })
  const ct = res.contentType.toLowerCase()
  if (ct && !/html|xml|text\/plain/.test(ct)) throw new AppError('FETCH_FAILED', 'This link isn’t a web page I can read.')
  const html = res.body.toString('utf8')
  const parsed = await parsePage(html, res.url, { wallPhrases: o.wallPhrases })
  if (mode === 'auto' && (parsed.text.length < 500 || notArticle(parsed.text))) {
    try {
      const r = await renderPage(res.url, { partition: o.partition })
      const p2 = await parsePage(r.html, r.url, { wallPhrases: o.wallPhrases })
      if (p2.text.length >= Math.max(2 * parsed.text.length, 200) && !notArticle(p2.text)) return { finalUrl: r.url, html: r.html, parsed: p2, render: 'browser' }
    } catch { /* keep the http result */ }
  }
  return { finalUrl: res.url, html, parsed: guardNotArticle(parsed), render: 'http' }
}

/**
 * A paywalled or script-only page can parse to the site's menu or its cookie-consent text (The Information): that is
 * not the article. Treat it as walled with no text, so callers fall back to the feed's headline/summary or report
 * "no readable text" instead of storing (and deduping) menus as articles.
 */
export function notArticle(text: string): 'menu' | 'consent' | 'script' | null {
  const t = text.trim()
  if (!t) return null
  if (t.length < 2000 && /we and our (?:third[- ]party )?partners|use cookies|cookie (?:policy|settings|preferences)|manage (?:your )?consent|privacy preferences/i.test(t.slice(0, 600))) return 'consent'
  // a script-only page's no-JS shell ("Please enable JavaScript…" + JSON-LD): Tech in Asia's read as a 1,400-char
  // "article" with no facts, and the rendered page was never tried (RD-BR-E3, acc-2026-10-07T17-11-52)
  if (t.length < 4000 && /enable javascript|javascript (?:is )?(?:disabled|required)|requires javascript|turn on javascript/i.test(t.slice(0, 600))) return 'script'
  const paras = t.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const sorted = paras.map(p => p.length).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 0
  if (paras.length >= 8 && median < 40 && !paras.some(p => p.length > 160)) return 'menu'
  return null
}
function guardNotArticle(p: ParseResult): ParseResult {
  const why = notArticle(p.text)
  return why ? { ...p, text: '', wall: { found: true, phrase: why === 'menu' ? 'only the site menu was readable' : why === 'script' ? 'the page needs JavaScript to show its text' : 'only a cookie notice was readable', via: p.wall.via || 'phrase' } } : p
}
