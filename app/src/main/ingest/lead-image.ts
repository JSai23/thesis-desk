// A document's lead image (See DEC-093): og:image, else twitter:image, else the first large <img> inside the article.
// URL only — never downloaded. Only absolute https URLs to raster images are kept (reports render them in the app and
// in Gmail; http would be mixed content and SVG doesn't render in mail). Regex-based so it runs in the main process
// (ingest of any adapter's raw HTML, lazy backfill of older documents) as well as in the parser utilityProcess.

const ENT: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#038': '&', '#38': '&', '#039': "'", '#39': "'" }
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  const k = e.toLowerCase()
  if (ENT[k]) return ENT[k]
  if (k.startsWith('#x')) return String.fromCharCode(parseInt(k.slice(2), 16))
  if (k.startsWith('#')) return String.fromCharCode(Number(k.slice(1)))
  return m
})

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '')
  return out
}

/** An absolute https URL that plausibly points at a raster image, or null. */
export function cleanImageUrl(raw: string | null | undefined, base: string | null | undefined): string | null {
  const s = (raw || '').trim()
  if (!s || /^data:/i.test(s)) return null
  let u: URL
  try { u = base ? new URL(s, base) : new URL(s) } catch { return null }
  if (u.protocol !== 'https:') return null
  if (/\.svg$/i.test(u.pathname)) return null
  const href = u.toString()
  return href.length > 2000 ? null : href
}

const NOT_LEAD = /logo|avatar|icon|gravatar|author|profile|badge|sprite|placeholder|spinner|pixel|1x1|blank\.gif/i

export function leadImage(html: string, url: string | null | undefined): string | null {
  if (!html) return null
  const head = html.slice(0, 400_000)
  const metas = head.match(/<meta\b[^>]*>/gi) || []
  for (const keys of [['og:image:secure_url', 'og:image', 'og:image:url'], ['twitter:image', 'twitter:image:src']]) {
    for (const k of keys) {
      for (const tag of metas) {
        const a = attrs(tag)
        if ((a.property || a.name || '').toLowerCase() !== k) continue
        const img = cleanImageUrl(a.content, url)
        if (img) return img // the publisher's own choice (a company logo on a funding post is still the right picture)
      }
    }
  }
  // first large <img> inside the article (or the page body when there is no <article>)
  const art = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] || html
  for (const tag of (art.match(/<img\b[^>]*>/gi) || []).slice(0, 40)) {
    const a = attrs(tag)
    if (NOT_LEAD.test(`${a.class || ''} ${a.alt || ''} ${a.id || ''}`)) continue
    const w = Number(a.width || 0), h = Number(a.height || 0)
    const set = (a.srcset || a['data-srcset'] || '').split(',').map(x => x.trim().split(/\s+/)).filter(p => p[0])
    const widest = set.map(p => ({ src: p[0], w: Number((p[1] || '').replace(/w$/, '')) || 0 })).sort((x, y) => y.w - x.w)[0]
    const large = w >= 300 || (widest && widest.w >= 300) || (!w && !h && !set.length && /\/(uploads|images?|media|photos?)\//i.test(a.src || a['data-src'] || ''))
    if (!large || (h && h < 150)) continue
    const img = cleanImageUrl(widest && widest.w >= 300 ? widest.src : a.src || a['data-src'], url)
    if (img && !NOT_LEAD.test(img)) return img
  }
  return null
}
