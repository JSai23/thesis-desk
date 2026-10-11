// Main window: hidden-inset native chrome with sidebar vibrancy (RFC §1A.6 DEC-032, §1B.2, §1B.22).
import { BrowserWindow, shell, app } from 'electron'
import path from 'node:path'
import { HEADLESS } from './env'
import { log } from './log'

let main: BrowserWindow | null = null
let quitting = false
app.on('before-quit', () => { quitting = true })

export const getMainWindow = (): BrowserWindow | null => (main && !main.isDestroyed() ? main : null)

/** Open a web page in the user's browser — except in headless test runs, which must not put anything on the screen
 *  (DEC-097): there the URL is only logged. */
export function openExternal(url: string): void {
  if (HEADLESS) { log.info('window', 'openExternal suppressed (headless)', { host: (() => { try { return new URL(url).host } catch { return '' } })() }); return }
  void shell.openExternal(url)
}

export function createMainWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1000, minHeight: 640,
    title: 'Research Workspace',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#16171c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
      // hidden test windows keep painting and running timers at full speed
      backgroundThrottling: !HEADLESS
    }
  })
  ;(w as any).__rwMain = true
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (url !== w.webContents.getURL()) { e.preventDefault(); if (/^https?:/i.test(url)) openExternal(url) }
  })
  w.on('close', e => {
    if (!quitting && process.platform === 'darwin') { e.preventDefault(); w.hide() }
  })
  // headless test runs: on screen but fully transparent and click-through, never focused, no Dock icon — so nothing
  // shows and nothing takes clicks, yet the window paints frames like a shown one. A never-shown window sometimes painted
  // none, and Playwright's "stable" check before a click then waited forever (SMK-01/02, UI-DESC-01; MEM-073)
  // shown at once, not on ready-to-show: that event waits for a first paint, which a never-shown window may not make
  // under load — UI-DESC-01 stalled again that way in acc-2026-10-07T08-39-29 (MEM-075)
  if (HEADLESS) { w.setOpacity(0); w.setIgnoreMouseEvents(true); w.setFocusable(false); w.showInactive() }
  else w.once('ready-to-show', () => w.show())
  // headless test runs: a hidden window may never finish a CSS animation, and Playwright waits for an element to stop
  // moving before it clicks (SMK-02 / UI-DESC-01 timed out on the palette's pop-in) — animations end at once there
  if (HEADLESS) w.webContents.on('dom-ready', () => { void w.webContents.insertCSS('*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}') })
  if (process.env.ELECTRON_RENDERER_URL) w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else w.loadFile(path.join(__dirname, '../renderer/index.html'))
  main = w
  return w
}

export function showMainWindow(): void {
  const w = getMainWindow()
  if (!w) { createMainWindow(); return }
  if (HEADLESS) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
}
