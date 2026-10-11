// Handlers: sources lifecycle, probe, suggestions.
import { handle } from './registry'
import * as sources from '../sources'
import { probe } from '../sources/probe'
import { AppError } from '../errors'
import * as auth from '../sources/auth'
import * as bridge from '../sources/bridge'
import * as restricted from '../sources/restricted'
import { session } from 'electron'

export function registerSourceHandlers(): void {
  handle('source.probe', ({ locator, once }) => probe(locator, !!once))
  handle('source.create', draft => sources.createSource(draft))
  handle('source.update', ({ id, patch }) => sources.updateSource(id, patch))
  handle('source.list', ({ filter }) => sources.listSources(!!filter?.includeRemoved).filter(s => !filter?.type || s.typeLabel === filter.type))
  handle('source.get', ({ id }) => { const s = sources.getSourceRow(id); if (!s) throw new AppError('NOT_FOUND', 'Source not found'); return sources.toDTO(s) })
  handle('source.syncNow', ({ id }) => sources.syncNow(id))
  handle('source.backfill', ({ id, days }) => sources.backfill(id, days))
  handle('source.setEnabled', ({ id, enabled }) => { sources.setEnabled(id, enabled); return { ok: true } })
  handle('source.mute', ({ id, muted }) => { sources.mute(id, muted); return { ok: true } })
  handle('source.reset', ({ id }) => sources.reset(id))
  handle('source.remove', ({ id }) => { sources.remove(id); return { ok: true } })
  handle('source.restore', ({ id }) => { sources.restore(id); return { ok: true } })
  handle('source.retry', ({ id }) => sources.retry(id))
  handle('source.suggestions', () => sources.suggestions())
  handle('source.signIn', ({ id }) => {
    if (id.startsWith('site:')) { const domain = id.slice(5); return auth.signInSite(domain, restricted.pendingOrigin(domain), () => { restricted.retryPending(domain) }) }
    return auth.signIn(id)
  })
  handle('source.signOutSite', async ({ domain }) => { await auth.signOutSite(domain); return { ok: true } })
  handle('test.auth.clearPartition', async ({ domain }) => { await session.fromPartition('persist:auth:' + domain).clearStorageData(); return { ok: true } })
  handle('bridge.listProfiles', () => bridge.listProfiles())
  handle('bridge.allow', ({ profile }) => bridge.allow(profile))
  handle('bridge.status', () => bridge.status(auth.signedInSites()))
  handle('source.dismissSuggestion', ({ id }) => { sources.dismissSuggestion(id); return { ok: true } })
}
