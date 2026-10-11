// Test harness (RFC §3.0): launches the built app with a fresh RW_DATA_DIR in test mode, exposes the public IPC
// boundary (invoke), drain, restart and kill. Live AI through the real Codex sign-in. LLM cache off, except that
// fixture tests under test:quick / test:area (RW_AI_REPLAY=1) replay recorded answers from tests/ai-cache (DEC-098);
// real-data and live tests always ask live.
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureFixtures, FIXTURE_PORT } from './fixtures'

export const ROOT = path.resolve(__dirname, '../..')
/** The app always runs in this time zone under test; format expected dates with it, not the host's (MEM-046). */
export const APP_TZ = 'America/Los_Angeles'
export const MAIN = path.join(ROOT, 'app/out/main/index.js')

export interface LaunchOpts {
  dataDir?: string
  testNow?: string | null
  codexHome?: string
  faults?: string
  env?: Record<string, string>
  executablePath?: string
  args?: string[]
  /** Always ask the AI live, even under RW_AI_REPLAY: for a test that relies on the model answering differently when it
   *  re-reads (a replayed answer never changes). */
  liveAi?: boolean
}

/** Recorded AI answers shared by fixture tests (keyed by the exact request; git-ignored). */
export const AI_CACHE_DIR = path.join(ROOT, 'tests/ai-cache')
function currentTestFile(): string { try { return require('@playwright/test').test.info().file as string } catch { return '' } }

/** Reload the app's window and wait for its bridge. Waits for the DOM, not "load" (a hidden test window has stalled on
 *  "load" until the test's 20-min timeout, UI-VIEW-01), with a time limit and one fallback navigation. */
export async function reloadApp(page: Page): Promise<void> {
  try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }) } catch { await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 60_000 }) }
  await page.waitForFunction(() => !!(window as any).rw, null, { timeout: 60_000 })
}

export function tempDir(prefix = 'rw-test-'): string { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)) }

export class RW {
  constructor(public app: ElectronApplication, public page: Page, public dataDir: string, public opts: LaunchOpts) {}

  /** One command over the app's bridge — time-limited: page.evaluate has no limit of its own, and a call that never
   *  answers used to hang a test until its 20-min timeout with no clue which call it was (iteration 2). */
  private call(command: string, payload: Record<string, unknown>): Promise<any> {
    // above the app's own limit for one AI call (6 min stream cap, MEM-052) plus a retry, so only a real hang trips it
    const limit = Math.max(600_000, Number(payload.timeoutMs || 0) + 60_000)
    let timer: NodeJS.Timeout | undefined
    const answer = this.page.evaluate(([c, p]) => (window as any).rw.invoke(c, p), [command, payload] as const)
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`IPC ${command} got no answer in ${Math.round(limit / 1000)} s`)), limit) })
    return Promise.race([answer, late]).finally(() => clearTimeout(timer))
  }

  /** Call a public command; throws with the error code on failure. */
  async invoke<T = any>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
    const r: any = await this.call(command, payload)
    if (!r.ok) { const e: any = new Error(`${command} → ${r.code}: ${r.message}`); e.code = r.code; throw e }
    return r.data as T
  }

  /** Call a command and return the raw result envelope. */
  async raw(command: string, payload: Record<string, unknown> = {}): Promise<any> {
    return this.call(command, payload)
  }

  /** Wait until these documents are read (no queued/running PROCESS_DOCUMENT for them, none mid-pipeline) — not the
   *  whole queue: background lookups elsewhere in the library keep going (TestPlan.md: wait for what you check). */
  async settle(documentIds: string[], timeoutMs = 600_000): Promise<void> {
    const want = new Set(documentIds)
    await until(async () => {
      const busy = (await this.inspect('jobs')).some((j: any) => j.type === 'PROCESS_DOCUMENT' && ['queued', 'running'].includes(j.status) && want.has(JSON.parse(j.payload_json || '{}').documentId))
      if (busy) return null
      return (await this.inspect('documents')).some((d: any) => want.has(d.id) && ['fetched', 'processing'].includes(d.status)) ? null : true
    }, timeoutMs, 3000)
  }
  /** Documents a source has fetched so far, after its pending fetches finish. */
  async sourceDocs(sourceId: string, timeoutMs = 600_000): Promise<string[]> {
    await until(async () => (await this.inspect('jobs')).some((j: any) => j.type === 'FETCH_SOURCE' && ['queued', 'running'].includes(j.status) && JSON.parse(j.payload_json || '{}').sourceId === sourceId) ? null : true, timeoutMs, 3000)
    return (await this.inspect('document_sources', { source_id: sourceId })).map((x: any) => x.document_id)
  }

  async drain(timeoutMs = 300_000): Promise<{ drained: boolean; pending: number }> {
    return this.invoke('test.jobs.drain', { timeoutMs })
  }

  async inspect<T = any>(table: string, where: Record<string, unknown> = {}): Promise<T[]> { return this.invoke('test.inspect', { table, where }) }

  /** Quit the app gracefully; one that hasn't quit in 60 s is sampled (evidence in the run's results dir) and killed.
   *  app.close() has no limit of its own: UI-FEED-02 passed its checks and then waited out its 20-min budget on a quit
   *  that never finished (acc-2026-10-07T08-39-29, MEM-075). */
  async close(): Promise<void> {
    let pid: number | undefined
    try { pid = this.app.process().pid } catch { return /* already closed: close() is safe to call twice */ }
    if (pid) closing.add(pid)
    let timer: NodeJS.Timeout | undefined
    const late = new Promise<'late'>(r => { timer = setTimeout(() => r('late'), 60_000) })
    const r = await Promise.race([this.app.close().then(() => 'ok' as const, () => 'ok' as const), late]).finally(() => clearTimeout(timer))
    if (r === 'ok' || !pid) return
    const file = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev', `slow-close-${pid}.txt`)
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); require('node:child_process').execFileSync('/usr/bin/sample', [String(pid), '3', '-file', file], { timeout: 30_000, stdio: 'ignore' }) } catch { /* best effort */ }
    console.warn(`[harness] app ${pid} did not quit within 60 s (${currentTestFile()}); sampled to ${file} and killed`)
    try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
  }

  /** Hard kill (simulated crash). */
  async kill(): Promise<void> {
    let pid: number | undefined
    try { pid = this.app.process().pid } catch { return /* already closed: close() is safe to call twice */ }
    if (pid) closing.add(pid)
    if (pid) try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
    await new Promise(r => setTimeout(r, 800))
  }

  async restart(extra: Partial<LaunchOpts> = {}): Promise<RW> {
    await this.close()
    return launch({ ...this.opts, ...extra, dataDir: this.dataDir })
  }
}

/** Apps this worker launched: a test that fails before its close() would leave one running, and the worker would then
 *  wait on it at the end of the run (iteration 2) — whatever is still running is killed when the worker exits. */
const launchedPids = new Set<number>()
/** Apps the harness itself is closing — their window closing is expected. */
const closing = new Set<number>()
process.on('exit', () => { for (const pid of launchedPids) try { process.kill(pid, 'SIGKILL') } catch { /* gone */ } })

export async function launch(opts: LaunchOpts = {}): Promise<RW> {
  await ensureFixtures()
  const dataDir = opts.dataDir || tempDir()
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    RW_DATA_DIR: dataDir, RW_TEST_MODE: '1', RW_NO_JITTER: '1', RW_LLM_CACHE: 'off', TZ: APP_TZ,
    // test windows stay off the screen unless RW_HEADED=1
    ...(process.env.RW_HEADED === '1' ? {} : { RW_HEADLESS: '1' }),
    ...(FIXTURE_PORT !== 4700 ? { RW_FIXTURE_PORT: String(FIXTURE_PORT) } : {}),
    ...(opts.testNow === null ? {} : { RW_TEST_NOW: opts.testNow || '2026-09-29T09:00:00' }),
    ...(opts.codexHome ? { RW_CODEX_HOME: opts.codexHome } : {}),
    ...(opts.faults ? { RW_FAULTS: opts.faults } : {}),
    ...(opts.env || {})
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  if (process.env.RW_LLM_CACHE_DEV === 'rw') env.RW_LLM_CACHE = 'rw'
  if (process.env.RW_AI_REPLAY === '1' && !opts.liveAi) {
    const file = currentTestFile()
    if (/[\\/]tests[\\/](realdata|live)[\\/]/.test(file)) throw new Error(`RW_AI_REPLAY must not reach real-data or live tests (${path.relative(ROOT, file)})`)
    Object.assign(env, { RW_LLM_CACHE: 'rw', RW_LLM_CACHE_DIR: AI_CACHE_DIR })
  }
  const app = opts.executablePath
    ? await electron.launch({ executablePath: opts.executablePath, env, args: opts.args || [] })
    : await electron.launch({ args: [MAIN, ...(opts.args || [])], env, cwd: ROOT })
  const pid = app.process().pid
  if (pid) { launchedPids.add(pid); app.process().once('exit', () => launchedPids.delete(pid)) }
  const page = await mainWindow(app)
  // a window that goes away mid-test says how (acc-2026-10-07T23-06-43: "Target page … closed" with nothing in the app log)
  const said = (what: string) => console.warn(`[harness] ${new Date().toISOString()} app ${pid}: main window ${what} (${path.relative(ROOT, currentTestFile())})`)
  page.on('crash', () => said('renderer crashed'))
  page.on('close', () => { if (!closing.has(pid!)) said('closed') })
  await page.waitForFunction(() => !!(window as any).rw, null, { timeout: 30_000 })
  const rw = new RW(app, page, dataDir, opts)
  // PRQ-AI-02 / RFC §3.0: abort the suite when the shared ChatGPT plan is above 80% used (value known from the last call)
  const ai = await rw.raw('ai.status', {}).catch(() => null)
  const used = ai?.ok ? Number(ai.data?.usedPercent ?? 0) : 0
  if (used > 80) { await rw.close(); throw new Error(`ChatGPT plan usage ${used}% > 80% — aborting suite (PRQ-AI-02)`) }
  return rw
}

async function mainWindow(app: ElectronApplication): Promise<Page> {
  const isMain = (p: Page) => /renderer\/index\.html/.test(p.url())
  for (let i = 0; i < 100; i++) {
    const w = app.windows().find(isMain)
    if (w) { await w.waitForLoadState('domcontentloaded'); return w }
    await new Promise(r => setTimeout(r, 200))
  }
  return app.firstWindow()
}

/** Read prereq/.env.local (harness only; the app never reads it — DEC-076). */
export function envLocal(): Record<string, string> {
  const f = path.join(ROOT, 'prereq/.env.local')
  const out: Record<string, string> = {}
  if (!fs.existsSync(f)) return out
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}

/** Install the Gmail account into a fresh profile through the test-only secrets command + email.configure. */
export async function installEmail(rw: RW): Promise<{ user: string }> {
  const e = envLocal()
  if (!e.RW_EMAIL_USER || !e.RW_EMAIL_PASS) throw new Error('prereq/.env.local lacks RW_EMAIL_USER/RW_EMAIL_PASS')
  // Gmail sometimes answers slowly when several test workers log in at once: up to three tries (a network condition,
  // not the app's behaviour), and a clear failure if it never connects
  let last = ''
  for (let i = 0; i < 3; i++) {
    const r = await rw.invoke('email.configure', { user: e.RW_EMAIL_USER, appPassword: e.RW_EMAIL_PASS, recipient: e.RW_EMAIL_RECIPIENT || e.RW_EMAIL_USER }).catch((x: Error) => ({ ok: false, message: x.message }))
    if (r?.ok) return { user: e.RW_EMAIL_USER }
    last = r?.message || 'no answer'
    await sleep(5000 * (i + 1))
  }
  throw new Error(`email.configure failed three times: ${last}`)
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Poll fn until it returns truthy or timeout. */
export async function until<T>(fn: () => Promise<T>, timeoutMs = 60_000, every = 500): Promise<T> {
  const end = Date.now() + timeoutMs
  let last: T
  for (;;) {
    last = await fn()
    if (last) return last
    if (Date.now() > end) throw new Error('until(): timed out')
    await sleep(every)
  }
}

/**
 * Build a library once per test run and hand each caller a fresh copy of it (closed app, copied data dir), so a
 * failing test in a describe block doesn't force a slow re-ingest. Keyed by RW_RUN_ID (set by playwright.config.ts).
 */
export async function preparedLibrary(name: string, build: (rw: RW) => Promise<void>, opts: LaunchOpts = {}): Promise<RW> {
  // accept builds each library fresh per run; test:quick / test:area (RW_LIBRARY_REUSE=1) reuse one built the same day
  // by the same builder code and settings, so a dev run doesn't re-read the same real articles (TestPlan.md)
  const reuseKey = () => require('node:crypto').createHash('sha1').update(build.toString() + JSON.stringify({ ...opts, testNow: undefined })).digest('hex').slice(0, 10) // the clock moves every run
  const scope = process.env.RW_LIBRARY_REUSE === '1' ? `dev-${new Date().toISOString().slice(0, 10)}-${reuseKey()}` : process.env.RW_RUN_ID || 'dev'
  const cache = path.join(os.tmpdir(), `rw-corpus-${scope}-${name}`)
  // parallel workers: the first to take the lock builds; the others wait for .ready (a stale lock from a dead run is reclaimed)
  const lock = cache + '.lock'
  for (;;) {
    if (fs.existsSync(path.join(cache, '.ready'))) break
    let mine = false
    try { fs.mkdirSync(lock); mine = true } catch {
      const age = Date.now() - fs.statSync(lock, { throwIfNoEntry: false } as any)?.mtimeMs!
      if (age > 3 * 3600_000) fs.rmSync(lock, { recursive: true, force: true })
      await new Promise(r => setTimeout(r, 5000)); continue
    }
    try {
      if (!fs.existsSync(path.join(cache, '.ready'))) {
        fs.rmSync(cache, { recursive: true, force: true })
        const rw = await launch(opts)
        await build(rw)
        await rw.close()
        fs.cpSync(rw.dataDir, cache, { recursive: true })
        fs.writeFileSync(path.join(cache, '.ready'), '')
      }
    } finally { if (mine) fs.rmSync(lock, { recursive: true, force: true }) }
  }
  const dataDir = tempDir()
  fs.cpSync(cache, dataDir, { recursive: true })
  fs.rmSync(path.join(dataDir, '.ready'), { force: true })
  return launch({ ...opts, dataDir })
}
