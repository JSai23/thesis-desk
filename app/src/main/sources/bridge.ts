// Chrome session bridge (RFC §1B.8.9, DEC-067, MEM-013): with the user's Keychain consent, decrypt the chosen Chrome
// profile's cookies (and Local Storage) for the target site only, in memory, inject them into a temporary headless
// Chrome context, load exactly one page, extract the post. Nothing decrypted is ever written to disk, SQLite, logs or
// model inputs; temp copies are deleted immediately. This is the only module that touches Chrome's secrets.
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getSetting, setSetting } from '../settings'
import { AppError } from '../errors'
import { registrableDomain } from '../ingest/url'
import { BRIDGE_PROFILE_DIR, BRIDGE_MOCK_KEYCHAIN, TEST_MODE, FIXTURE_HOST_RULE } from '../env'
import { chromeUserAgent } from './http'
import { log } from '../log'

const CHROME_ROOT = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
const CHROME_APP = '/Applications/Google Chrome.app'
let key: Buffer | null = null
let keyProfile: string | null = null

export interface Profile { dir: string; name: string; account: string | null }

export function chromeInstalled(): boolean { return fs.existsSync(CHROME_APP) || fs.existsSync(path.join(os.homedir(), 'Applications', 'Google Chrome.app')) }

export function listProfiles(): Profile[] {
  if (TEST_MODE && BRIDGE_PROFILE_DIR) return [{ dir: BRIDGE_PROFILE_DIR, name: 'Test profile', account: null }]
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(CHROME_ROOT, 'Local State'), 'utf8'))
    return Object.entries<any>(ls.profile?.info_cache || {}).map(([dir, v]) => ({ dir, name: v.name || dir, account: v.user_name || null }))
  } catch { return [] }
}

/** A profile name under Chrome's root, or an absolute dir: a profile dir itself or a user-data dir (→ its Default profile). */
function profilePath(dir: string): string {
  if (!path.isAbsolute(dir)) return path.join(CHROME_ROOT, dir)
  return fs.existsSync(path.join(dir, 'Local State')) && fs.existsSync(path.join(dir, 'Default')) ? path.join(dir, 'Default') : dir
}

function safeStoragePassword(): Promise<string> {
  if (BRIDGE_MOCK_KEYCHAIN) return Promise.resolve('mock_password')
  return new Promise((resolve, reject) => execFile('security', ['find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome'], { timeout: 120_000 }, (err, out) => {
    if (err) reject(new AppError('AUTH_REQUIRED', 'Chrome access wasn’t allowed. Press Allow access and click Allow in the macOS prompt.'))
    else resolve(out.toString().trim())
  }))
}

/** Allow access: the macOS Keychain prompt for "Chrome Safe Storage"; the derived key lives in memory only. */
export async function allow(profile: string): Promise<{ ok: boolean; message: string }> {
  const p = profile || listProfiles()[0]?.dir
  if (!p) throw new AppError('VALIDATION', 'No Chrome profile found')
  setSetting('bridge.profile', p)
  const pass = await safeStoragePassword()
  key = crypto.pbkdf2Sync(pass, 'saltysalt', 1003, 16, 'sha1')
  keyProfile = p
  return { ok: true, message: 'Chrome sign-ins available for links you send' }
}

export const isAllowed = () => !!key && keyProfile === (getSetting<string | null>('bridge.profile') || keyProfile)

function cookieDbPath(dir: string): string | null {
  for (const rel of ['Network/Cookies', 'Cookies']) { const p = path.join(profilePath(dir), rel); if (fs.existsSync(p)) return p }
  return null
}

interface PwCookie { name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean; expires: number; sameSite: 'None' | 'Lax' | 'Strict' }

function decryptCookies(dir: string, domain: string): PwCookie[] {
  const db = cookieDbPath(dir)
  if (!db || !key) return []
  const tmp = path.join(os.tmpdir(), `rwc-${process.pid}-${crypto.randomBytes(4).toString('hex')}.db`)
  fs.copyFileSync(db, tmp)
  try {
    const d = new Database(tmp, { readonly: true })
    const rows = d.prepare("SELECT host_key, name, path, is_secure, is_httponly, expires_utc, samesite, encrypted_value, value FROM cookies WHERE host_key = ? OR host_key = ? OR host_key LIKE ?").all(domain, '.' + domain, '%.' + domain) as any[]
    d.close()
    const out: PwCookie[] = []
    for (const r of rows) {
      let v: string = r.value || ''
      const buf: Buffer = r.encrypted_value
      if (buf && buf.length > 3 && buf.subarray(0, 3).toString() === 'v10') {
        try {
          const dc = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
          let plain = Buffer.concat([dc.update(buf.subarray(3)), dc.final()])
          if (plain.length > 32) {
            const hostHash = crypto.createHash('sha256').update(r.host_key).digest()
            if (plain.subarray(0, 32).equals(hostHash)) plain = plain.subarray(32)
          }
          v = plain.toString('utf8')
        } catch { continue }
      }
      out.push({ name: r.name, value: v, domain: r.host_key, path: r.path || '/', secure: !!r.is_secure, httpOnly: !!r.is_httponly, expires: r.expires_utc > 0 ? Math.floor(r.expires_utc / 1e6 - 11644473600) : -1, sameSite: (['None', 'Lax', 'Strict'][r.samesite] || 'Lax') as any })
    }
    return out
  } finally { fs.rmSync(tmp, { force: true }) }
}

/** Local Storage for one origin, read from the profile's LevelDB files (keys `_<origin>\0\1<key>`, plaintext values). */
function localStorageFor(dir: string, origin: string): Record<string, string> {
  const ldir = path.join(profilePath(dir), 'Local Storage', 'leveldb')
  const out: Record<string, string> = {}
  if (!fs.existsSync(ldir)) return out
  const prefix = Buffer.from('_' + origin + '\u0000\u0001', 'latin1')
  const files = fs.readdirSync(ldir).filter(f => /\.(log|ldb)$/.test(f)).map(f => path.join(ldir, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)
  for (const f of files) {
    const b = fs.readFileSync(f)
    let i = b.indexOf(prefix)
    while (i >= 0) {
      let j = i + prefix.length
      let k = ''
      while (j < b.length && b[j] >= 0x20 && b[j] < 0x7f && k.length < 256) k += String.fromCharCode(b[j++])
      // value record follows: varint length then 0x01 (latin1) or 0x00 (utf16) marker and the bytes
      const lenAt = j
      const vlen = b[lenAt]
      const mark = b[lenAt + 1]
      if (k && vlen > 1 && (mark === 1 || mark === 0) && lenAt + 1 + vlen <= b.length) {
        const raw = b.subarray(lenAt + 2, lenAt + 1 + vlen)
        out[k] = mark === 1 ? raw.toString('latin1') : raw.toString('utf16le')
      }
      i = b.indexOf(prefix, i + 1)
    }
  }
  return out
}

export interface PageResult { status: 'ok' | 'login' | 'challenge' | 'no_post' | 'unavailable'; post?: { author: string; text: string; time: string | null; permalink: string | null }; mainText?: string; finalUrl?: string }

export interface Selectors { post: string; author: string; text: string; time: string; permalink: string }

/** Exactly one headless page load of `url` with the user's Chrome session for that site. */
export async function loadPost(url: string, sel: Selectors): Promise<PageResult> {
  const profile = getSetting<string | null>('bridge.profile') || (TEST_MODE && BRIDGE_PROFILE_DIR ? BRIDGE_PROFILE_DIR : null)
  if (!profile || !key || keyProfile !== profile) {
    if (TEST_MODE && BRIDGE_PROFILE_DIR && BRIDGE_MOCK_KEYCHAIN) await allow(BRIDGE_PROFILE_DIR)
    else return { status: 'unavailable' }
  }
  const u = new URL(url)
  const domain = registrableDomain(u.hostname)
  const cookies = decryptCookies(profile || BRIDGE_PROFILE_DIR!, domain)
  const storage = localStorageFor(profile || BRIDGE_PROFILE_DIR!, u.origin)
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: TEST_MODE ? [`--host-resolver-rules=${FIXTURE_HOST_RULE}`] : [] })
  try {
    const ctx = await browser.newContext({ userAgent: chromeUserAgent(), viewport: { width: 1300, height: 900 } })
    if (cookies.length) await ctx.addCookies(cookies.map(c => ({ ...c, domain: c.domain })))
    if (Object.keys(storage).length) await ctx.addInitScript(({ origin, entries }) => { if (location.origin === origin) for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v as string) }, { origin: u.origin, entries: storage })
    const page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    try { await page.waitForSelector(sel.text, { timeout: 8000 }) } catch { /* fall back below */ }
    const res = await page.evaluate((s: Selectors) => {
      const q = (root: ParentNode, x: string) => { try { return root.querySelector(x) } catch { return null } }
      const art = q(document, s.post) || document
      const textEl = q(art, s.text)
      const body = (document.body?.innerText || '').toLowerCase()
      if (textEl && (textEl.textContent || '').trim()) {
        const timeEl = q(art, s.time)
        const link = q(art, s.permalink) as HTMLAnchorElement | null
        return { status: 'ok', post: { author: ((q(art, s.author)?.textContent || '').trim()).replace(/\s+/g, ' '), text: (textEl as HTMLElement).innerText.trim(), time: timeEl?.getAttribute('datetime') || null, permalink: link ? link.href : null }, finalUrl: location.href }
      }
      if (/verify it.s you|are you a robot|captcha|unusual activity/.test(body)) return { status: 'challenge', finalUrl: location.href }
      if (/log in to|sign in to see|sign in to (x|linkedin)|join linkedin/.test(body) || /\/login|\/i\/flow\/login|\/authwall/.test(location.pathname)) return { status: 'login', finalUrl: location.href }
      const main = (q(document, 'main') || q(document, '[role=main]') || q(document, 'article')) as HTMLElement | null
      return { status: 'no_post', mainText: main ? main.innerText : '', finalUrl: location.href }
    }, sel)
    return res as PageResult
  } finally {
    await browser.close()
    log.info('bridge', 'one page load', { host: u.host })
  }
}

export function status(partitions: { domain: string; state: string }[]) {
  const profiles = listProfiles()
  const profile = getSetting<string | null>('bridge.profile')
  return {
    chromeInstalled: chromeInstalled() || (TEST_MODE && !!BRIDGE_PROFILE_DIR), profiles, profile, profileName: profiles.find(p => p.dir === profile)?.name || null, allowed: isAllowed(),
    sites: [{ site: 'X', signedIn: isAllowed() }, { site: 'LinkedIn', signedIn: false }], partitions
  }
}
