// Electron main process. Startup order (RFC §1B.2): resolve data dir → open DB + migrate → load settings →
// requeue stale jobs → start worker → start scheduler (catch-up) → create window → emit app.ready.
import { app, dialog, powerMonitor, session, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, TEST_MODE, FIXTURE_HOST_RULE, HEADLESS } from './env'
import { initLog, log } from './log'
import { openDb, closeDb } from './db'
import { seed } from './db/seed'
import { initClock } from './clock'
import { getSetting } from './settings'
import { initSecrets } from './secrets'
import { initProvider } from './ai/provider'
import { registerIpc } from './ipc/registry'
import { registerCoreHandlers, applyTheme } from './ipc/core'
import { registerAll } from './register'
import { requeueStale, startWorker, stopWorker } from './jobs'
import { startScheduler, stopScheduler, tick } from './scheduler'
import { createMainWindow, showMainWindow } from './window'
import { handleDeepLink } from './deeplink'

fs.mkdirSync(DATA_DIR, { recursive: true })
app.setPath('userData', path.join(DATA_DIR, 'electron'))
if (TEST_MODE) app.commandLine.appendSwitch('host-resolver-rules', FIXTURE_HOST_RULE)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  if (!TEST_MODE) app.setAsDefaultProtocolClient('researchworkspace')
  const pendingLinks: string[] = []
  let ready = false
  app.on('open-url', (e, url) => { e.preventDefault(); if (ready) handleDeepLink(url); else pendingLinks.push(url) })
  app.on('second-instance', (_e, argv) => {
    const link = argv.find(a => a.startsWith('researchworkspace://'))
    if (link) handleDeepLink(link)
    showMainWindow()
  })

  app.whenReady().then(() => {
    if (HEADLESS && process.platform === 'darwin') app.dock?.hide()
    app.setAboutPanelOptions({
      applicationName: 'Research Workspace', applicationVersion: app.getVersion(),
      credits: 'Your library is stored on this Mac. Article text, notes, theses and questions are sent to OpenAI through your ChatGPT sign-in for AI processing.'
    })
    initLog(DATA_DIR)
    try {
      openDb(DATA_DIR)
    } catch (e) {
      const choice = dialog.showMessageBoxSync({ type: 'error', message: 'Research Workspace couldn’t open its library', detail: `${path.join(DATA_DIR, 'research.sqlite')}\n\n${(e as Error).message}`, buttons: ['Show in Finder', 'Quit'] })
      if (choice === 0) shell.showItemInFolder(path.join(DATA_DIR, 'research.sqlite'))
      app.exit(1)
      return
    }
    initClock(TEST_MODE ? Number(getSetting('test.clock_last') || 0) || null : null)
    initSecrets(DATA_DIR)
    initProvider(DATA_DIR)
    seed()
    registerIpc()
    registerCoreHandlers()
    registerAll()
    applyTheme()
    const requeued = requeueStale()
    log.info('app', 'started', { dataDir: DATA_DIR, requeued, testMode: TEST_MODE })
    startWorker()
    startScheduler()
    createMainWindow()
    ready = true
    for (const l of pendingLinks.splice(0)) handleDeepLink(l)
    const argLink = process.argv.find(a => a.startsWith('researchworkspace://'))
    if (argLink) handleDeepLink(argLink)
    powerMonitor.on('resume', () => tick({ catchup: true }))
    powerMonitor.on('unlock-screen', () => tick({ catchup: true }))
  })

  /** Persist cookies of auth/fetch partitions before exiting (app.exit skips Chromium's normal shutdown flush). */
  async function flushSessions(): Promise<void> {
    const dir = path.join(DATA_DIR, 'electron', 'Partitions')
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).map(n => 'persist:' + decodeURIComponent(n)) : []
    // bounded: a cookie store that never answers must not keep the app from quitting (a test's close() waited 20 min)
    await Promise.race([Promise.all([session.defaultSession, ...names.map(n => session.fromPartition(n))].map(s => s.cookies.flushStore().catch(() => {}))), new Promise(r => setTimeout(r, 3000))])
  }

  app.on('activate', () => showMainWindow())
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

  let shuttingDown = false
  app.on('before-quit', e => {
    if (shuttingDown) return
    shuttingDown = true
    e.preventDefault()
    stopScheduler()
    stopWorker(5000).then(flushSessions).finally(() => {
      try { requeueStale(); closeDb() } catch { /* already closed */ }
      app.exit(0)
    })
  })
}
