// Authenticated sources through an app-owned browser session (RFC FLOW-K, §1B.8.5, DEC-043/055/059).
// The sign-in window has no preload and no script injection; the user types into the site directly. Cookies live
// only in the persistent partition `persist:auth:<domain>` under the data dir; no cookie or password is ever read.
import { BaseWindow, WebContentsView, session } from 'electron'
import { all, run, json } from '../db'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { enqueue } from '../jobs'
import { renderPage } from './browser'
import { fetchSession } from './http'
import { parsePage } from '../ingest/parser'
import { setAuthHooks, getSourceRow } from './index'
import { setPartitionResolver } from '../ingest/ingress'
import type { AuthProfile } from './probe'
import type { SourceRow } from './adapters'
import { log } from '../log'
import { HEADLESS } from '../env'

const BLOCKED_COPY = 'You’re signed in, but this site still hides full articles. Your account may not include them.'
const STILL_WALLED = 'I still can’t see full articles. Finish signing in, or close this window.'
const open = new Map<string, { win: BaseWindow; donePresses: number; checking: boolean }>()

const profileOf = (s: SourceRow): AuthProfile | null => json<AuthProfile | null>(s.auth_profile_json, null)
function setState(id: string, state: string, extra: Partial<{ profile: AuthProfile; error: string | null }> = {}): void {
  run('UPDATE sources SET auth_state = ?, auth_profile_json = COALESCE(?, auth_profile_json), last_error_message = COALESCE(?, last_error_message), updated_at = ? WHERE id = ?',
    state, extra.profile ? JSON.stringify(extra.profile) : null, extra.error ?? null, now(), id)
  emit('source.updated', { sourceId: id })
  emit('banner.updated', {})
}

/** Pass iff the article text is long enough and no wall phrase/element is present (checked in the partition). */
async function checkUrl(profile: AuthProfile, url: string): Promise<boolean> {
  try {
    const r = await renderPage(url, { partition: profile.partition, timeoutMs: 25_000 })
    const p = await parsePage(r.html, r.url, { wallPhrases: profile.wall.phrases })
    return !p.wall.found && p.text.length >= profile.pass.minChars
  } catch (e) { log.warn('auth', 'check failed to load', { err: String((e as Error).message) }); return false }
}

/** authCheck(profile): pinned checkUrl, or each candidate until one passes (that one gets pinned). */
export async function authCheck(profile: AuthProfile): Promise<{ ok: boolean; url?: string }> {
  const urls = profile.checkUrl ? [profile.checkUrl] : profile.checkCandidates
  for (const u of urls) if (await checkUrl(profile, u)) return { ok: true, url: u }
  return { ok: false }
}

function toolbarHtml(host: string): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font:13px -apple-system,BlinkMacSystemFont,sans-serif;background:#2a2b31;color:#e8e8ec;display:flex;align-items:center;gap:10px;height:44px;padding:0 12px 0 84px;box-sizing:border-box;-webkit-app-region:drag;user-select:none}
    .host{flex:1;color:#a6a6b0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#msg{color:#ffb86b;font-size:12px}
    a{-webkit-app-region:no-drag;height:26px;padding:0 14px;border-radius:6px;background:oklch(0.6 0.15 258);color:#fff;text-decoration:none;display:inline-flex;align-items:center;font-weight:500}
  </style></head><body><span class="host">🔒 ${host}</span><span id="msg"></span><a href="https://rw-auth.invalid/done" role="button">Done</a></body></html>`)
}

const LOGIN_PATH = /\/(login|signin|sign-in|i\/flow\/login|checkpoint|uas\/login|authwall)(\/|$)/i

/**
 * Site sign-in for user-sent pages (X, LinkedIn…) when the Chrome bridge isn't set up (§1B.8.8 fallback). The window
 * opens the site's login page in `persist:auth:<domain>`; it counts as signed in once a navigation leaves the login
 * path (or the user presses Done). Pending captures for that site are then retried, one page load each.
 */
export async function signInSite(domain: string, origin: string, onSignedIn: () => void): Promise<{ opened: boolean }> {
  const key = 'site:' + domain
  const existing = open.get(key)
  if (existing && !existing.win.isDestroyed()) { if (!HEADLESS) existing.win.focus(); return { opened: true } }
  const ses = session.fromPartition('persist:auth:' + domain)
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
  fetchSession('persist:auth:' + domain)
  const win = new BaseWindow({ width: 1000, height: 760, title: `Sign in to ${domain}`, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 }, show: !HEADLESS })
  // headless test runs: hidden, but a window the user would see — the blind ui-driver treats it as on screen
  if (HEADLESS) (win as any).rwUserFacing = true
  const bar = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
  const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  win.contentView.addChildView(bar); win.contentView.addChildView(view)
  const layout = () => { const [w, h] = win.getContentSize(); bar.setBounds({ x: 0, y: 0, width: w, height: 44 }); view.setBounds({ x: 0, y: 44, width: w, height: h - 44 }) }
  layout(); win.on('resize', layout)
  open.set(key, { win, donePresses: 0, checking: false })
  bar.webContents.loadURL(toolbarHtml(domain))
  view.webContents.setWindowOpenHandler(({ url }) => { view.webContents.loadURL(url); return { action: 'deny' } })
  view.webContents.loadURL(origin.replace(/\/$/, '') + '/login')
  let done = false
  const finish = () => { if (done) return; done = true; setTimeout(() => { if (!win.isDestroyed()) win.close(); onSignedIn() }, 1500) }
  view.webContents.on('did-navigate', (_e, url) => { try { if (!LOGIN_PATH.test(new URL(url).pathname)) finish() } catch { /* ignore */ } })
  bar.webContents.on('will-navigate', (e, url) => { if (url.startsWith('https://rw-auth.invalid/done')) { e.preventDefault(); finish() } })
  win.on('closed', () => { open.delete(key); destroyViews(view, bar) })
  return { opened: true }
}

export async function signIn(sourceId: string): Promise<{ opened: boolean; toast?: string }> {
  const s = getSourceRow(sourceId)
  if (!s || s.deleted_at) throw new AppError('NOT_FOUND', 'Source not found')
  const profile = profileOf(s)
  if (!profile) throw new AppError('VALIDATION', 'This source doesn’t need a sign-in')
  const existing = open.get(sourceId)
  if (existing && !existing.win.isDestroyed()) { if (!HEADLESS) existing.win.focus(); return { opened: true } }
  setState(sourceId, 'authenticating')
  const site = profile.domain
  const ses = session.fromPartition(profile.partition)
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
  ses.on('will-download', e => e.preventDefault())
  fetchSession(profile.partition)
  const win = new BaseWindow({ width: 1000, height: 760, title: `Sign in to ${site}`, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 }, show: !HEADLESS })
  // headless test runs: hidden, but a window the user would see — the blind ui-driver treats it as on screen
  if (HEADLESS) (win as any).rwUserFacing = true
  const bar = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
  const site_ = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  win.contentView.addChildView(bar)
  win.contentView.addChildView(site_)
  const layout = () => { const [w, h] = win.getContentSize(); bar.setBounds({ x: 0, y: 0, width: w, height: 44 }); site_.setBounds({ x: 0, y: 44, width: w, height: h - 44 }) }
  layout(); win.on('resize', layout)
  const state = { win, donePresses: 0, checking: false }
  open.set(sourceId, state)
  bar.webContents.loadURL(toolbarHtml(site))
  site_.webContents.setWindowOpenHandler(({ url }) => { site_.webContents.loadURL(url); return { action: 'deny' } })   // OAuth popups stay in the same partition
  site_.webContents.loadURL(profile.loginUrl)
  let passed = false
  const showMsg = (m: string) => bar.webContents.loadURL(toolbarHtml(site).replace(encodeURIComponent('<span id="msg"></span>'), encodeURIComponent(`<span id="msg">${m}</span>`)))
  const finish = (pinned: string) => {
    passed = true
    const cur = profileOf(getSourceRow(sourceId)!) || profile
    setState(sourceId, 'authenticated', { profile: { ...cur, checkUrl: pinned }, error: null })
    run("UPDATE sources SET health = 'ok', consecutive_failures = 0 WHERE id = ?", sourceId)
    enqueue('FETCH_SOURCE', { sourceId, trigger: 'manual' }, { idempotencyKey: `fetch:${sourceId}`, priority: 1 })
    emit('source.syncCompleted', { sourceId, toast: `Signed in to ${site}. Checking for new posts…` })
    if (!win.isDestroyed()) win.close()
  }
  const check = async (fromDone: boolean) => {
    if (state.checking || passed) return
    state.checking = true
    try {
      const r = await authCheck({ ...profile, checkUrl: undefined })
      if (r.ok && r.url) return finish(r.url)
      if (fromDone) {
        state.donePresses++
        if (state.donePresses >= 3) {
          passed = true
          setState(sourceId, 'blocked', { error: BLOCKED_COPY })
          if (!win.isDestroyed()) win.close()
          return
        }
        showMsg(STILL_WALLED)
      }
    } finally { state.checking = false }
  }
  let debounce: NodeJS.Timeout | null = null
  site_.webContents.on('did-navigate', () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(() => check(false), 2000) })
  bar.webContents.on('will-navigate', (e, url) => { if (url.startsWith('https://rw-auth.invalid/done')) { e.preventDefault(); check(true) } })
  win.on('closed', () => {
    destroyViews(site_, bar)
    open.delete(sourceId)
    if (debounce) clearTimeout(debounce)
    if (!passed) { const cur = getSourceRow(sourceId); if (cur && cur.auth_state === 'authenticating') setState(sourceId, 'login_required') }
  })
  return { opened: true }
}

/** Sign out of a site: clear its partition; sources on that domain need sign-in again. */
export async function signOutSite(domain: string): Promise<void> {
  await session.fromPartition('persist:auth:' + domain).clearStorageData()
  for (const s of all<SourceRow>("SELECT * FROM sources WHERE auth_strategy = 'app_browser_session' AND deleted_at IS NULL")) {
    const p = profileOf(s)
    if (p?.domain === domain) setState(s.id, 'login_required')
  }
}

export function signedInSites(): { domain: string; state: string }[] {
  const out = new Map<string, string>()
  for (const s of all<SourceRow>("SELECT * FROM sources WHERE auth_strategy = 'app_browser_session' AND deleted_at IS NULL")) {
    const p = profileOf(s)
    if (p && (s.auth_state === 'authenticated' || s.auth_state === 'expired' || s.auth_state === 'blocked')) out.set(p.domain, s.auth_state)
  }
  return [...out].map(([domain, state]) => ({ domain, state }))
}

export function registerAuth(): void {
  setAuthHooks({
    async beforeFetch(s) {
      const p = profileOf(s)
      if (!p) return
      if (s.auth_state !== 'authenticated') throw new AppError('AUTH_REQUIRED', 'Sign in to this source first.')
      const r = await authCheck(p)
      if (!r.ok) { setState(s.id, 'expired'); throw new AppError('AUTH_EXPIRED', 'Your session for this site expired. Sign in again.') }
    },
    async onWalled(s, url) {
      const p = profileOf(getSourceRow(s.id)!)!
      const r = await authCheck(p)
      if (!r.ok) { setState(s.id, 'expired'); throw new AppError('AUTH_EXPIRED', 'Your session for this site expired. Sign in again.') }
      log.info('auth', 'entitlement wall (session ok)', { sourceId: s.id, url: url.replace(/\?.*$/, '') })
      return 'entitlement'
    }
  })
  setPartitionResolver(domain => {
    const s = all<SourceRow>("SELECT * FROM sources WHERE auth_strategy = 'app_browser_session' AND auth_state = 'authenticated' AND deleted_at IS NULL").find(x => profileOf(x)?.domain === domain)
    return s ? profileOf(s)!.partition : undefined
  })
}

export const isSignInOpen = (sourceId: string) => open.has(sourceId)

/** WebContentsViews outlive their BaseWindow unless closed explicitly (Electron); free the page and toolbar. */
function destroyViews(...views: WebContentsView[]): void {
  for (const v of views) try { if (!v.webContents.isDestroyed()) v.webContents.close() } catch { /* already gone */ }
}
