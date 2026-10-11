// URL helpers: registrable domain and canonical URL (RFC §1B.9 step 3).

const MULTI_PART_TLDS = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'com.cn', 'co.in', 'co.kr', 'com.sg', 'com.hk', 'co.za', 'com.mx', 'co.il'])

export function hostOf(u: string): string {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

/** eTLD+1 using a small multi-part TLD list (fixture hosts *.test keep one label + tld). */
export function registrableDomain(hostOrUrl: string): string {
  let h = hostOrUrl.includes('/') || hostOrUrl.includes(':') ? hostOf(hostOrUrl) : hostOrUrl.toLowerCase()
  h = h.replace(/^www\./, '').replace(/\.$/, '')
  const parts = h.split('.')
  if (parts.length <= 2) return h
  const last2 = parts.slice(-2).join('.')
  if (MULTI_PART_TLDS.has(last2)) return parts.slice(-3).join('.')
  return last2
}

const STRIP_PARAMS = /^(utm_.*|fbclid|gclid|ref|mc_.*|mkt_tok|igshid|_hsenc|_hsmi)$/i

/** Lowercase host, strip fragment, tracking params and trailing slash. */
export function cleanUrl(u: string): string {
  try {
    const x = new URL(u)
    x.hash = ''
    x.hostname = x.hostname.toLowerCase()
    for (const k of [...x.searchParams.keys()]) if (STRIP_PARAMS.test(k)) x.searchParams.delete(k)
    let s = x.toString()
    if (!x.search && s.endsWith('/') && x.pathname !== '/') s = s.slice(0, -1)
    if (!x.search && x.pathname === '/' && s.endsWith('/')) s = s.slice(0, -1)
    return s
  } catch { return u.trim() }
}

/** <link rel=canonical> if same registrable domain, else the final URL (cleaned). */
export function canonicalUrl(finalUrl: string, canonicalTag?: string | null): string {
  if (canonicalTag) {
    try {
      const abs = new URL(canonicalTag, finalUrl).toString()
      if (registrableDomain(abs) === registrableDomain(finalUrl)) return cleanUrl(abs)
    } catch { /* ignore */ }
  }
  return cleanUrl(finalUrl)
}

/** Normalize a user-typed locator: trim; add https:// when it has a dot and no scheme. */
export function normalizeLocator(raw: string): string {
  const t = raw.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return t
  if (/^[^\s]+\.[a-z]{2,}(\/|$|:)/i.test(t)) return 'https://' + t
  return t
}

export const isHttpUrl = (s: string) => /^https?:\/\//i.test(s)
