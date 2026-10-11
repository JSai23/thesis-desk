// User-sent pages from restricted sites (RFC §1B.8.8, DEC-063/070/072/073): never polled; each send costs at most one
// headless page load (Chrome session bridge, else the app's own signed-in partition). Only the extracted post text
// (or a verified LOCATE_POST slice) is stored — never page HTML. Login/challenge pages leave a pending capture.
import { TEST_MODE, FIXTURE_BASE } from '../env'
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { all, one, run, tx } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { ingestItem, addDocumentSource } from '../ingest/pipeline'
import { finishAdd, recordOnDemand, setRestrictedHandler, setSelectionHandler, type AddResult } from '../ingest/ingress'
import { canonicalUrl, hostOf, registrableDomain } from '../ingest/url'
import { contentHash } from '../ingest/dedupe'
import { setDeepLinkHandler } from '../deeplink'
import { fetchSession } from './http'
import { pageStep } from './browser'
import * as bridge from './bridge'
import { runTask } from '../ai/runtime'
import { LOCATE } from '../ai/tasks/locate'
import { readAuth } from '../ai/codex-auth'
import { log } from '../log'

const DEFAULT_SEL: bridge.Selectors = { post: 'article[data-testid="tweet"], article', author: '[data-testid="User-Name"]', text: '[data-testid="tweetText"]', time: 'time[datetime]', permalink: 'a[href*="/status/"]:has(time)' }

function resource(rel: string): string | null {
  for (const base of [app.getAppPath(), process.cwd()]) { const p = path.join(base, 'app/resources', rel); if (fs.existsSync(p)) return p }
  return null
}
function restrictedDomains(): string[] {
  const f = resource('restricted-domains.json')
  const extra: string[] = f ? JSON.parse(fs.readFileSync(f, 'utf8')) : []
  return ['x.com', 'twitter.com', 'linkedin.com', 'x.test', 'linkedin.test', ...extra]
}
function platformOf(url: string): 'x' | 'linkedin' | 'other' {
  const d = registrableDomain(url)
  return d === 'x.com' || d === 'twitter.com' || d === 'x.test' ? 'x' : d === 'linkedin.com' || d === 'linkedin.test' ? 'linkedin' : 'other'
}
function selectorsFor(platform: string): bridge.Selectors {
  const f = resource(`platforms/${platform}.json`)
  if (!f) return DEFAULT_SEL
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  return { post: j.post || DEFAULT_SEL.post, author: j.author || DEFAULT_SEL.author, text: j.text || DEFAULT_SEL.text, time: j.time || DEFAULT_SEL.time, permalink: j.permalink || DEFAULT_SEL.permalink }
}
const siteName = (p: string) => (p === 'x' ? 'X' : p === 'linkedin' ? 'LinkedIn' : 'this site')

export const isRestricted = (url: string): boolean => { const d = registrableDomain(url); return restrictedDomains().some(x => d === x || hostOf(url).endsWith('.' + x)) }

/** One page load in the app's own partition for the domain (fallback when the bridge isn't set up). */
async function loadInPartition(url: string, sel: bridge.Selectors): Promise<bridge.PageResult> {
  const ses = fetchSession('persist:auth:' + registrableDomain(url))
  const w = new BrowserWindow({ show: false, width: 1300, height: 900, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    await pageStep(w.loadURL(url), 30_000)
    const start = Date.now()
    let res: bridge.PageResult | null = null
    while (Date.now() - start < 12_000) {
      res = await pageStep(w.webContents.executeJavaScript(`(() => {
        const s = ${JSON.stringify(sel)}; const q = (r, x) => { try { return r.querySelector(x) } catch { return null } }
        const art = q(document, s.post) || document; const t = q(art, s.text); const body = (document.body ? document.body.innerText : '').toLowerCase()
        if (t && t.textContent.trim()) { const tm = q(art, s.time); const a = q(art, s.permalink); return { status: 'ok', post: { author: (q(art, s.author) || { textContent: '' }).textContent.trim().replace(/\\s+/g, ' '), text: t.innerText.trim(), time: tm ? tm.getAttribute('datetime') : null, permalink: a ? a.href : null }, finalUrl: location.href } }
        if (/verify it.s you|are you a robot|captcha|unusual activity/.test(body)) return { status: 'challenge', finalUrl: location.href }
        if (/log in to|sign in to see|sign in to (x|linkedin)|join linkedin/.test(body)) return { status: 'login', finalUrl: location.href }
        const m = q(document, 'main') || q(document, '[role=main]') || q(document, 'article'); return { status: 'no_post', mainText: m ? m.innerText : '', finalUrl: location.href } })()`, true), 10_000)
      if (res && res.status !== 'no_post') break
      await new Promise(r => setTimeout(r, 500))
    }
    return res || { status: 'no_post', mainText: '' }
  } finally { if (!w.isDestroyed()) w.destroy() }
}

/** A user-sent URL waiting for sign-in/retry is a document with status 'pending_capture' (DEC-073). */
function pendingCapture(url: string, message: string, type: string, text?: string, signInDomain: string | null = null): AddResult {
  const canon = canonicalUrl(url)
  let doc = one<{ id: string }>('SELECT id FROM documents WHERE canonical_url = ? AND deleted_at IS NULL', canon)
  const t = now()
  tx(() => {
    if (!doc) {
      const id = newId('doc')
      run(`INSERT INTO documents(id, kind, canonical_url, url, title, first_fetched_at, last_fetched_at, current_version, content_hash, text, text_chars, access, status, processing_error, metadata_json, created_at, updated_at)
           VALUES (?, 'web', ?, ?, ?, ?, ?, 1, ?, ?, ?, 'partial', 'pending_capture', ?, ?, ?, ?)`, id, canon, url, url.replace(/^https?:\/\//, ''), t, t, contentHash(text || ''), text || '', (text || '').length, message, JSON.stringify({ pendingSince: t, platform: platformOf(url) }), t, t)
      addDocumentSource(id, 'src_manual', url)
      doc = { id }
    } else run("UPDATE documents SET processing_error = ?, updated_at = ? WHERE id = ? AND status = 'pending_capture'", message, t, doc.id)
  })
  recordOnDemand({ url, title: url.replace(/^https?:\/\//, ''), type, outcome: message, documentId: doc!.id, retryable: true, signInDomain })
  emit('source.updated', {})
  return { documentId: doc!.id, itemId: null, outcome: 'pending', pending: true, message }
}

function ingestPost(sentUrl: string, platform: string, post: { author: string; text: string; time: string | null; permalink: string | null }, thesisIds: string[], extraMeta: Record<string, unknown> = {}): AddResult {
  const permalink = post.permalink || sentUrl
  const author = post.author.replace(/\s*·.*$/, '').trim() || siteName(platform)
  const title = `${author.split('@')[0].trim() || author}: ${post.text.replace(/\s+/g, ' ').slice(0, 80)}`
  const res = ingestItem({ sourceId: 'src_manual', itemKey: sentUrl, url: permalink, kind: 'web', title, text: post.text.trim(), author, siteName: siteName(platform), publishedAt: post.time ? Date.parse(post.time) || null : null, access: 'full', raw: { ext: 'txt', body: post.text.trim() }, metadata: { platform, tier: 4, ...extraMeta }, skipTriage: true, priority: 1 })
  const docId = res.duplicateOf || res.documentId
  const pending = one<{ id: string }>("SELECT id FROM documents WHERE canonical_url = ? AND status = 'pending_capture' AND id <> ?", canonicalUrl(sentUrl), docId)
  if (pending) run("UPDATE documents SET status = 'duplicate', duplicate_of_id = ?, updated_at = ? WHERE id = ?", docId, now(), pending.id)
  return finishAdd(docId, res.outcome, thesisIds, { url: sentUrl, title, type: platform === 'other' ? 'URL' : siteName(platform) + ' post' })
}

async function handleRestricted(url: string, o: { thesisIds?: string[]; text?: string }): Promise<AddResult> {
  const platform = platformOf(url)
  const type = platform === 'other' ? 'URL' : siteName(platform) + ' post'
  const sel = selectorsFor(platform)
  let r: bridge.PageResult
  let viaBridge = true
  try {
    r = await bridge.loadPost(url, sel)
    if (r.status === 'unavailable') { viaBridge = false; r = await loadInPartition(url, sel) }
  } catch (e) {
    log.warn('restricted', 'page load failed', { host: hostOf(url), err: String((e as Error).message) })
    return pendingCapture(url, 'Couldn’t open this page · Retry', type)
  }
  if (r.status === 'ok' && r.post) return ingestPost(url, platform, r.post, o.thesisIds || [])
  if (r.status === 'login') return pendingCapture(url, viaBridge ? `Sign in to ${siteName(platform)} in Chrome, then Retry` : `Sign in to ${siteName(platform)}, then Retry`, type, undefined, viaBridge ? null : registrableDomain(url))
  if (r.status === 'challenge') return pendingCapture(url, `${siteName(platform)} asked to verify it’s you in Chrome. Open ${siteName(platform)} in Chrome, then Retry.`, type)
  // selectors found no post: LOCATE_POST on the main landmark's visible text; store only the verified slice
  const visible = (r.mainText || '').slice(0, 30000)
  if (visible.trim().length >= 20 && readAuth().status === 'ok') {
    try {
      const loc = await runTask(LOCATE, { visibleText: visible, url })
      const slice = visible.slice(loc.value.textStart, loc.value.textEnd).trim()
      if (slice.length >= 20) return ingestPost(url, platform, { author: loc.value.author || siteName(platform), text: slice, time: loc.value.postedAt, permalink: null }, o.thesisIds || [], { locatedByModel: true, layoutChanged: true })
    } catch (e) { log.warn('restricted', 'LOCATE_POST failed', { err: String((e as Error).message) }) }
  }
  return pendingCapture(url, 'Couldn’t find the post · Retry', type)
}

/** Bookmarklet / selection capture: the user's selected text is the document; the page is not fetched. */
export function captureSelection(url: string, text: string, thesisIds: string[] = []): AddResult {
  const platform = platformOf(url)
  const body = text.replace(/\r\n/g, '\n').trim()
  if (!body) throw new AppError('VALIDATION', 'Nothing was selected')
  const norm = body.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n')
  const title = (platform === 'other' ? '' : siteName(platform) + ': ') + norm.replace(/\s+/g, ' ').slice(0, 80)
  const res = ingestItem({ sourceId: 'src_manual', itemKey: url, url, kind: 'web', title, text: norm, siteName: platform === 'other' ? hostOf(url) : siteName(platform), access: 'full', raw: { ext: 'txt', body: norm }, metadata: { capturedBy: 'user_selection', platform }, skipTriage: true, priority: 1 })
  const docId = res.duplicateOf || res.documentId
  return finishAdd(docId, res.outcome, thesisIds, { url, title, type: platform === 'other' ? 'Selection' : siteName(platform) + ' post' })
}

/** Retry every pending capture of a domain (after the user signed in); one page load per capture. */
export async function retryPending(domain: string): Promise<number> {
  const { addUrl } = await import('../ingest/ingress')
  const pend = all<{ url: string }>("SELECT url FROM documents WHERE status = 'pending_capture' AND deleted_at IS NULL")
    .filter(d => d.url && registrableDomain(d.url) === domain)
  for (const d of pend) { try { await addUrl(d.url) } catch (e) { log.warn('restricted', 'retry failed', { err: String((e as Error).message) }) } }
  emit('feed.updated', {})
  return pend.length
}

export function pendingOrigin(domain: string): string {
  const d = all<{ url: string }>("SELECT url FROM documents WHERE status = 'pending_capture' AND deleted_at IS NULL").find(x => x.url && registrableDomain(x.url) === domain)
  if (d) return new URL(d.url).origin
  if (TEST_MODE && domain.endsWith('.test')) { const b = new URL(FIXTURE_BASE); return `${b.protocol}//${domain}:${b.port}` } // fixture hosts
  return domain === 'x.com' ? 'https://x.com' : domain === 'linkedin.com' ? 'https://www.linkedin.com' : 'https://' + domain
}

export function registerRestricted(): void {
  setRestrictedHandler(isRestricted, handleRestricted)
  setSelectionHandler(captureSelection)
  setDeepLinkHandler(async ({ url, text }) => {
    try {
      if (!url) return
      const { addUrl } = await import('../ingest/ingress')
      const r = await addUrl(url, [], text)
      emit('app.deeplink', { documentId: r.documentId, toast: r.pending ? r.message : 'Added to Today' })
    } catch (e) { emit('app.deeplink', { toast: (e as Error).message || 'Couldn’t add that page' }) }
  })
}
