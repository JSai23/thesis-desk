// Render-mode fetch: an offscreen BrowserWindow (show:false) in the source's partition, JS enabled, no preload,
// no permissions, closed after each fetch (RFC §1B.8.2, §1B.22). Hidden elements are removed before the HTML is
// read so stored text is what a reader sees (DEC-050).
import { BrowserWindow } from 'electron'
import { fetchSession } from './http'
import { AppError } from '../errors'

export interface RenderResult { url: string; html: string; title: string }

/** A page step that must finish within `ms`: a page whose script hangs (or opens a dialog) never answers
 *  executeJavaScript, and one stuck render held a hydrate for 20 min (acc-2026-10-07T08-39-29, MEM-075). */
export function pageStep<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new AppError('FETCH_FAILED', 'The site took too long to respond.')), ms) })]).finally(() => clearTimeout(t))
}

const VISIBLE_ONLY = `(() => {
  const all = Array.from(document.body ? document.body.querySelectorAll('*') : []);
  for (const el of all) { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || el.getAttribute('aria-hidden') === 'true') el.setAttribute('data-rw-hidden', '1'); }
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('[data-rw-hidden], script, style, noscript, template').forEach(n => n.remove());
  return { html: '<!doctype html>' + clone.outerHTML, title: document.title, url: location.href };
})()`

export async function renderPage(url: string, o: { partition?: string; timeoutMs?: number; quietMs?: number; until?: (url: string) => boolean } = {}): Promise<RenderResult> {
  const ses = fetchSession(o.partition)
  const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, images: false } })
  w.webContents.setAudioMuted(true)
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const timeout = o.timeoutMs ?? 25_000
  try {
    let lastActivity = Date.now()
    const bump = () => { lastActivity = Date.now() }
    w.webContents.on('did-start-navigation', bump)
    w.webContents.on('did-frame-finish-load', bump)
    const loaded = new Promise<void>((resolve, reject) => {
      w.webContents.once('did-finish-load', () => resolve())
      w.webContents.once('did-fail-load', (_e, code, desc, _u, isMain) => { if (isMain && code !== -3) reject(new AppError('FETCH_FAILED', `Couldn’t load the page (${desc}).`)) })
    })
    const start = Date.now()
    w.loadURL(url).catch(() => { /* surfaced by did-fail-load */ })
    await Promise.race([loaded, new Promise((_, rej) => setTimeout(() => rej(new AppError('FETCH_FAILED', 'The site took too long to respond.')), timeout))])
    const quiet = o.quietMs ?? 1500
    while (Date.now() - start < timeout) {
      const cur = w.webContents.getURL()
      if (o.until && o.until(cur) && Date.now() - lastActivity >= quiet) break
      if (!o.until && Date.now() - lastActivity >= quiet) break
      await new Promise(r => setTimeout(r, 200))
    }
    if (o.until && !o.until(w.webContents.getURL())) throw new AppError('FETCH_FAILED', 'The link didn’t lead to a readable page.')
    return await pageStep(w.webContents.executeJavaScript(VISIBLE_ONLY, true) as Promise<RenderResult>, 15_000)
  } finally {
    if (!w.isDestroyed()) w.destroy()
  }
}
