// Main → renderer events. Payloads carry ids only; the renderer re-fetches (RFC §1B.3, B-JOBS-005).
import { BrowserWindow } from 'electron'

export type EventName = 'job.started' | 'job.completed' | 'job.failed' | 'source.updated' | 'source.syncCompleted' | 'document.ingested'
  | 'feed.updated' | 'object.updated' | 'suggestion.created' | 'view.updated' | 'report.ready' | 'notification.triggered'
  | 'query.progress' | 'banner.updated' | 'settings.updated' | 'alert.needsConfirmation' | 'app.deeplink'

type Listener = (event: EventName, payload: unknown) => void
const listeners: Listener[] = []

/** In-process subscribers (tests and modules that react to events). */
export function onEvent(l: Listener): void { listeners.push(l) }

export function emit(event: EventName, payload: unknown = {}): void {
  for (const l of listeners) {
    try { l(event, payload) } catch { /* ignore */ }
  }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents && (w as any).__rwMain) w.webContents.send('rw:event', event, payload)
  }
}
