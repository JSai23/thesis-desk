// Handlers: app, settings, ai, theses, test-only commands.
import { readToday, releaseCapParked } from '../ingest/process'
import { app, shell, nativeTheme } from 'electron'
import { groundingCheck } from '../ai/grounding'
import * as library from '../library'
import { handle } from './registry'
import { all, one, schemaVersion } from '../db'
import { allSettings, setSetting, USER_WRITABLE, getSetting } from '../settings'
import { emit } from '../events'
import { AppError } from '../errors'
import { DATA_DIR, TEST_MODE } from '../env'
import { readAuth } from '../ai/codex-auth'
import { testCall } from '../ai/provider'
import { computeBanners } from '../banners'
import { advanceClock, now, setClock } from '../clock'
import { tick } from '../scheduler'
import { drain, releaseParked } from '../jobs'
import { setFaults } from '../faults'
import { secrets } from '../secrets'
import * as theses from '../theses'
import { setFeedGroupBy } from '../views'
import { seedDemo } from '../demo'

const INSPECTABLE = new Set(['settings', 'object_details', 'sources', 'documents', 'document_versions', 'document_sources', 'evidence', 'companies', 'firms', 'people', 'theses', 'aliases', 'notes',
  'relationships', 'relationship_evidence', 'suggestions', 'field_defs', 'field_values', 'feed_items', 'view_definitions', 'reports', 'report_runs', 'alert_rules',
  'notifications', 'schedules', 'briefings', 'briefing_runs', 'jobs', 'agent_runs', 'history', 'schema_migrations'])

/** Native vibrancy follows the app theme (DEC-032 sidebar glass). */
export function applyTheme(): void {
  const t = String(getSetting('appearance.theme') || 'dark')
  nativeTheme.themeSource = t === 'light' ? 'light' : t === 'auto' ? 'system' : 'dark'
}

export function aiStatus() {
  const st = readAuth()
  const usage = getSetting<any>('ai.usage')
  if (st.status !== 'ok') return { status: st.status, message: st.reason, usage }
  return { status: 'ok', email: st.auth.email ?? null, plan: st.auth.plan ?? null, usedPercent: usage?.primaryUsedPercent ?? null, usage }
}

export function registerCoreHandlers(): void {
  handle('processing.readRest', () => ({ released: releaseCapParked(true) }))
  handle('processing.setLimit', ({ limit }) => { const old = Number(getSetting('processing.daily_cap') ?? 0); setSetting('processing.daily_cap', limit); return { released: limit === 0 || limit > old ? releaseCapParked(false) : 0 } })
  handle('app.status', () => {
    const count = (sql: string) => (one<{ n: number }>(sql)!.n)
    return {
      versions: { app: app.getVersion(), electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
      dataDir: DATA_DIR, schemaVersion: schemaVersion(), testMode: TEST_MODE, now: now(),
      counts: {
        documents: count('SELECT COUNT(*) n FROM documents WHERE deleted_at IS NULL'),
        evidence: count("SELECT COUNT(*) n FROM evidence WHERE status = 'active'"),
        sources: count("SELECT COUNT(*) n FROM sources WHERE deleted_at IS NULL AND kind <> 'manual'"),
        theses: count('SELECT COUNT(*) n FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL')
      },
      aiConfigured: readAuth().status === 'ok',
      emailConfigured: !!getSetting('email.account') && !!secrets.get('email.password'),
      pausedPolling: !!getSetting('pause_polling'),
      librarySize: library.librarySize(), lastIndexedAt: library.lastIndexedAt(),
      banners: computeBanners(),
      // the daily reading limit (Settings, DEC-101): articles read today and the limit (0 = none)
      processing: { readToday: readToday(), limit: Number(getSetting('processing.daily_cap') ?? 0) }
    }
  })

  handle('settings.get', () => allSettings())
  handle('settings.update', ({ patch }: { patch: Record<string, unknown> }) => {
    for (const k of Object.keys(patch)) if (!USER_WRITABLE.has(k)) throw new AppError('VALIDATION', `Setting ${k} can't be changed here`)
    for (const [k, v] of Object.entries(patch)) setSetting(k, v)
    if ('appearance.theme' in patch) applyTheme()
    if ('appearance.group_today_by' in patch) setFeedGroupBy(patch['appearance.group_today_by'] as any)
    if ('open_at_login' in patch && !TEST_MODE) app.setLoginItemSettings({ openAtLogin: !!patch.open_at_login, openAsHidden: true } as any)
    emit('settings.updated', { keys: Object.keys(patch) })
    if ('pause_polling' in patch || 'open_at_login' in patch || 'banners.dismissed' in patch) emit('banner.updated', {})
    return allSettings()
  })

  handle('ai.status', () => aiStatus())
  handle('ai.test', async () => {
    const r = await testCall()
    releaseParked(['PROCESS_DOCUMENT', 'CONFIGURE_SOURCE', 'ORGANIZE_NOTE', 'BACKFILL_FIELD', 'SUGGEST_THESES', 'MATCH_THESIS', 'SUMMARIZE_OBJECT', 'COMPILE_REPORT', 'COMPILE_ALERT'], 'AI_UNAVAILABLE')
    emit('banner.updated', {})
    return { ...r, status: aiStatus() }
  })

  handle('library.reindex', () => library.reindex())
  handle('library.export', ({ dir }) => library.exportLibrary(dir))
  handle('library.reveal', () => { shell.openPath(DATA_DIR); return { path: DATA_DIR } })

  // theses
  handle('thesis.tree', ({ includeArchived }) => theses.thesisTree(!!includeArchived))
  handle('thesis.evolution', ({ id }) => theses.thesisEvolution(id))
  handle('thesis.addCompany', ({ id, companyId }) => { theses.addCompanyToThesis(id, companyId); return { ok: true } })

  // test-only
  handle('test.groundingCheck', ({ text, supports, allowedNames }) => groundingCheck(text, supports, { allowedNames }))
  handle('test.clock.set', ({ iso }) => { setClock(Date.parse(iso)); setSetting('test.clock_last', now()); return { now: now() } })
  handle('test.clock.advance', ({ ms }) => { advanceClock(ms); setSetting('test.clock_last', now()); return { now: now() } })
  handle('test.scheduler.tick', () => ({ fired: tick() }))
  handle('test.jobs.drain', ({ timeoutMs }) => drain(timeoutMs ?? 300_000))
  handle('test.inspect', ({ table, where }) => {
    if (!INSPECTABLE.has(table)) throw new AppError('VALIDATION', `Unknown table ${table}`)
    const keys = Object.keys(where || {})
    for (const k of keys) if (!/^[a-z_]+$/.test(k)) throw new AppError('VALIDATION', `Bad column ${k}`)
    const cond = keys.map(k => ((where as any)[k] === null ? `${k} IS NULL` : `${k} = ?`)).join(' AND ')
    const params = keys.filter(k => (where as any)[k] !== null).map(k => (where as any)[k])
    return all(`SELECT rowid AS _rowid, * FROM ${table}${cond ? ' WHERE ' + cond : ''} ORDER BY rowid`, ...params)
  })
  handle('test.faults.set', ({ spec }) => { setFaults(spec); return { ok: true } })
  handle('test.secrets.set', ({ name, value }) => { secrets.set(name, value); return { ok: true } })
  handle('test.seedDemo', () => seedDemo())
}
