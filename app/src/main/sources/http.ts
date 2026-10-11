// HTTP fetch through Electron's network stack (honours host-resolver-rules in test mode), with per-host politeness
// and robots.txt (RFC §1B.8.2 article fetch, §1B.8.6).
import { net, session, type Session } from 'electron'
import robotsParser from 'robots-parser'
import { AppError } from '../errors'
import { log } from '../log'

const TIMEOUT_MS = 20_000
const MAX_BYTES = 5 * 1024 * 1024
const MIN_GAP_MS = 2000
const MAX_CONCURRENT = 2
const ROBOTS_TTL_MS = 24 * 3600_000
export const ROBOTS_UA = 'ResearchWorkspace'

let chromeUA = ''
export function chromeUserAgent(): string {
  if (chromeUA) return chromeUA
  const ua = session.defaultSession.getUserAgent()
  chromeUA = ua.replace(/\s?Electron\/\S+/, '').replace(/\s?research-workspace\/\S+/i, '').replace(/\s?Research Workspace\/\S+/i, '').trim()
  return chromeUA
}

export function fetchSession(partition?: string): Session {
  const s = session.fromPartition(partition || 'persist:fetch')
  if (!(s as any).__rwInit) {
    ;(s as any).__rwInit = true
    s.setUserAgent(chromeUserAgent())
    s.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    s.on('will-download', e => e.preventDefault())
  }
  return s
}

// ---------- politeness ----------
const hosts = new Map<string, { last: number; active: number }>()
async function acquire(hostKey: string): Promise<() => void> {
  let h = hosts.get(hostKey)
  if (!h) { h = { last: 0, active: 0 }; hosts.set(hostKey, h) }
  for (;;) {
    const wait = h.last + MIN_GAP_MS - Date.now()
    if (h.active < MAX_CONCURRENT && wait <= 0) break
    await new Promise(r => setTimeout(r, Math.max(50, Math.min(wait, 500))))
  }
  h.active++
  h.last = Date.now()
  return () => { h!.active-- }
}

export interface HttpResult { status: number; url: string; contentType: string; body: Buffer; headers: Headers }

export interface HttpOpts { partition?: string; polite?: boolean; accept?: string; timeoutMs?: number; method?: string; headers?: Record<string, string> }

export function hostKeyOf(u: string): string { try { return new URL(u).host } catch { return u } }

/** One request through Electron's network stack; follows ≤ 5 redirects and reports the final URL. */
function netGet(url: string, ses: Session, method: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; url: string; headers: Headers; body: Buffer }> {
  return new Promise((resolve, reject) => {
    let finalUrl = url
    let hops = 0
    const req = net.request({ url, method, session: ses, redirect: 'manual', useSessionCookies: true } as any)
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)
    const timer = setTimeout(() => { req.abort(); reject(new AppError('FETCH_FAILED', 'The site took too long to respond.')) }, timeoutMs)
    req.on('redirect', (_status: number, _method: string, redirectUrl: string) => {
      hops++
      if (hops > 5) { clearTimeout(timer); req.abort(); reject(new AppError('FETCH_FAILED', 'Too many redirects.')); return }
      finalUrl = redirectUrl
      req.followRedirect()
    })
    req.on('response', res => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => { size += c.length; if (size <= MAX_BYTES) chunks.push(c) })
      res.on('end', () => {
        clearTimeout(timer)
        const h = new Headers()
        for (const [k, v] of Object.entries(res.headers)) h.set(k, Array.isArray(v) ? v.join(', ') : String(v))
        resolve({ status: res.statusCode, url: finalUrl, headers: h, body: Buffer.concat(chunks) })
      })
      res.on('error', (e: Error) => { clearTimeout(timer); reject(e) })
    })
    req.on('error', e => { clearTimeout(timer); reject(e) })
    req.end()
  })
}

/** GET a URL. Network failures → FETCH_FAILED; HTTP ≥400 → HTTP_<status> with product copy. */
export async function httpGet(url: string, o: HttpOpts = {}): Promise<HttpResult> {
  const release = o.polite === false ? () => {} : await acquire(hostKeyOf(url))
  try {
    const res = await netGet(url, fetchSession(o.partition), o.method || 'GET', { 'User-Agent': chromeUserAgent(), Accept: o.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', ...(o.headers || {}) }, o.timeoutMs ?? TIMEOUT_MS)
    log.info('fetch', 'GET', { host: hostKeyOf(url), status: res.status, bytes: res.body.length })
    if (res.status >= 400) {
      const retryAfter = Number(res.headers.get('retry-after'))
      throw new AppError(`HTTP_${res.status}`, res.status === 404 || res.status === 410 ? 'The page wasn’t found (' + res.status + ').' : `The site returned an error (${res.status}). Try again later.`, { status: res.status, retryAfterMs: Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 3600_000) : undefined })
    }
    return { status: res.status, url: res.url, contentType: res.headers.get('content-type') || '', body: res.body, headers: res.headers }
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError('FETCH_FAILED', `Couldn’t reach ${hostKeyOf(url)}.`)
  } finally {
    release()
  }
}

// ---------- robots.txt ----------
const robotsCache = new Map<string, { at: number; robots: ReturnType<typeof robotsParser> | null }>()
export async function robotsAllowed(url: string): Promise<boolean> {
  let origin: string
  try { origin = new URL(url).origin } catch { return true }
  let c = robotsCache.get(origin)
  if (!c || Date.now() - c.at > ROBOTS_TTL_MS) {
    let robots: ReturnType<typeof robotsParser> | null = null
    try {
      const r = await httpGet(origin + '/robots.txt', { polite: false, accept: 'text/plain', timeoutMs: 8000 })
      robots = robotsParser(origin + '/robots.txt', r.body.toString('utf8'))
    } catch { robots = null }
    c = { at: Date.now(), robots }
    robotsCache.set(origin, c)
  }
  if (!c.robots) return true
  return c.robots.isAllowed(url, ROBOTS_UA) !== false
}
