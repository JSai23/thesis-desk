// RFC §3A authenticated and user-sent sources: E2E-AUTH-01…04, E2E-SRCH-01, E2E-BRIDGE-01, E2E-SENT-01…03.
import { test, expect, chromium, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, tempDir, until, type RW } from '../harness/app'
import { fixtures, FIXTURE_PORT } from '../harness/fixtures'
import { signInLedger, F_LEDGER_2, USERS } from '../harness/ledger'
import { recordSecret } from '../harness/secrets'

const LEDGER = 'http://ledger.test:4700/'
const PASSWORD_MARKERS = USERS.map((u: any) => u.password)

async function ledgerSource(rw: RW) {
  const p = await rw.invoke('source.probe', { locator: LEDGER })
  expect(p.status).toBe('login_required')
  return rw.invoke('source.create', { locator: LEDGER, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
}
const fetchJobs = async (rw: RW, id: string) => (await rw.inspect('jobs', { type: 'FETCH_SOURCE' })).filter((j: any) => JSON.parse(j.payload_json).sourceId === id)

function grepFiles(files: string[], needles: string[]): string[] {
  return files.flatMap(f => { const buf = fs.readFileSync(f); return needles.filter(n => n && buf.includes(n)).map(n => `${f}: ${n.slice(0, 4)}…`) })
}

function grepDir(dir: string, needles: string[]): string[] {
  const hits: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (e.name === 'secrets.bin') continue
      const buf = fs.readFileSync(p)
      for (const n of needles) if (n && buf.includes(n)) hits.push(`${p}: ${n.slice(0, 4)}…`)
    }
  }
  walk(dir)
  return hits
}

test('E2E-AUTH-01/02 login, persisted session, expiry', async () => {
  await fixtures.reset()
  let rw = await launch()
  const src = await ledgerSource(rw)
  expect(src.authState).toBe('login_required')
  await rw.invoke('source.signIn', { id: src.id })
  expect((await rw.invoke('source.get', { id: src.id })).authState).toBe('authenticating')
  const login: Page = await until(async () => rw.app.windows().find(p => /ledger\.test:4700\/login/.test(p.url())) || null, 30_000)
  await login.fill('input[name=email]', USERS[0].email); await login.fill('input[name=password]', USERS[0].password)
  await login.click('button[type=submit]')
  await until(async () => (await rw.invoke('source.get', { id: src.id })).authState === 'authenticated', 60_000)
  await rw.drain(400_000)
  const d14 = (await rw.inspect('documents')).find((d: any) => d.text.includes(F_LEDGER_2))
  expect(d14).toBeTruthy()
  rw = await rw.restart()
  await rw.invoke('source.syncNow', { id: src.id }); await rw.drain(300_000)
  const j = await fetchJobs(rw, src.id)
  expect(j[j.length - 1].status).toBe('succeeded')
  // no password or cookie value in settings, logs or DB
  const cookie = (await rw.app.evaluate(async ({ session }) => {
    const s = session.fromPartition('persist:auth:ledger.test')
    return (await s.cookies.get({})).map(c => c.value)
  })).filter((v: string) => v.length >= 12)
  expect(JSON.stringify(await rw.inspect('settings'))).not.toMatch(new RegExp(PASSWORD_MARKERS.map((x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')))
  await rw.close()
  // the session cookie lives only in Chromium's partition store; the app's DB, WAL and logs never hold it
  const appFiles = ['research.sqlite', 'research.sqlite-wal'].map(f => path.join(rw.dataDir, f)).filter(f => fs.existsSync(f))
  const logs = path.join(rw.dataDir, 'logs')
  const hits = [...grepFiles(appFiles, [...PASSWORD_MARKERS, ...cookie]), ...(fs.existsSync(logs) ? grepDir(logs, [...PASSWORD_MARKERS, ...cookie]) : [])]
  expect(hits).toEqual([])

  // AUTH-02 expiry
  rw = await launch({ dataDir: rw.dataDir })
  await fixtures.expireLedger()
  await rw.invoke('source.syncNow', { id: src.id }); await rw.drain(300_000)
  expect((await rw.invoke('source.get', { id: src.id })).authState).toBe('expired')
  const jobs = await fetchJobs(rw, src.id)
  expect(jobs[jobs.length - 1]).toMatchObject({ status: 'failed', error_code: 'AUTH_EXPIRED', attempts: 1 })
  for (const v of await rw.inspect('document_versions')) expect(v.text).not.toContain('Sign in to keep reading')
  for (const d of await rw.inspect('documents')) expect(d.text).not.toContain('Sign in to keep reading')
  expect((await rw.invoke('app.status')).banners.some((b: any) => b.kind === 'auth_expired' && b.sourceIds.includes(src.id))).toBe(true)
  await rw.close()
})

test('E2E-AUTH-04 entitlement wall is not expiry', async () => {
  await fixtures.reset()
  const rw = await launch()
  const src = await ledgerSource(rw)
  await signInLedger(rw, src.id)
  await until(async () => (await rw.invoke('source.get', { id: src.id })).authState === 'authenticated', 60_000)
  await rw.drain(400_000)
  await rw.invoke('source.syncNow', { id: src.id }); await rw.drain(300_000)
  expect((await rw.invoke('source.get', { id: src.id })).authState).toBe('authenticated')
  const docs = await rw.inspect('documents')
  const pro = docs.find((d: any) => /pro-only-analysis/.test(d.url))
  expect(pro.access).toBe('partial')
  expect(docs.find((d: any) => d.text.includes(F_LEDGER_2)).status).toBe('processed')
  expect((await rw.invoke('app.status')).banners.filter((b: any) => b.kind === 'auth_expired' || b.kind === 'source_attention')).toEqual([])
  await rw.close()
})

test('E2E-AUTH-03 no entitlement', async () => {
  await fixtures.reset()
  const rw = await launch()
  const src = await ledgerSource(rw)
  const free = USERS.find((u: any) => /free/.test(u.email))
  expect(free).toBeTruthy()
  await signInLedger(rw, src.id, free)
  // the user presses Done while the site still hides full articles → after 3 checks: blocked
  // Pressing Done = the toolbar link's navigation, which the app intercepts (will-navigate) and cancels. Playwright
  // can't click links whose navigation never completes, so deliver that same event to the toolbar in main.
  await until(async () => rw.app.windows().find(p => p.url().includes('rw-auth.invalid')) || null, 30_000)
  for (let i = 0; i < 6; i++) {
    await rw.app.evaluate(({ webContents }) => {
      const bar = webContents.getAllWebContents().find(w => !w.isDestroyed() && w.getURL().includes('rw-auth.invalid'))
      bar?.emit('will-navigate', { preventDefault() {} }, 'https://rw-auth.invalid/done')
    })
    await new Promise(r => setTimeout(r, 2500))
    if ((await rw.invoke('source.get', { id: src.id })).authState === 'blocked') break
  }
  await until(async () => (await rw.invoke('source.get', { id: src.id })).authState === 'blocked' || null, 60_000, 1000)
  const s = await rw.invoke('source.get', { id: src.id })
  expect(s.lastError).toBe('You’re signed in, but this site still hides full articles. Your account may not include them.')
  await rw.close()
})

test('E2E-SRCH-01 saved search over two epochs', async () => {
  await fixtures.reset()
  const rw = await launch()
  const p = await rw.invoke('source.probe', { locator: 'Lumen Legal funding news' })
  expect(p.kind).toBe('search')
  const src = await rw.invoke('source.create', { locator: 'Lumen Legal funding news', mode: 'all', instruction: '', freq: 'hourly', thesisIds: [], probe: p })
  await rw.drain(400_000)
  const ds1 = await rw.inspect('document_sources', { source_id: src.id })
  const docs = await rw.inspect('documents')
  expect(docs.some((d: any) => d.canonical_url === 'http://vln.test:4700/2026/09/22/lumen-legal-series-a')).toBe(true)
  expect(docs.find((d: any) => d.title.startsWith('Unresolvable story'))?.access).toBe('partial')
  await fixtures.epoch(2)
  await rw.invoke('test.clock.advance', { ms: 61 * 60_000 }); await rw.invoke('test.scheduler.tick')
  await rw.drain(400_000)
  const ds2 = await rw.inspect('document_sources', { source_id: src.id })
  expect(ds2.length).toBeGreaterThanOrEqual(ds1.length)
  const urls = (await rw.inspect('documents')).map((d: any) => d.canonical_url).filter(Boolean)
  expect(new Set(urls).size).toBe(urls.length)
  for (const u of urls) expect(u).not.toMatch(/news-search\.test.*\/articles\/a\d/)
  await rw.close()
})

test('E2E-BRIDGE-01 Chrome session bridge (mock keychain)', async () => {
  await fixtures.reset()
  const profile = tempDir('rw-chrome-profile-')
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, args: ['--use-mock-keychain', `--host-resolver-rules=MAP *.test 127.0.0.1:${FIXTURE_PORT}`] })
  const pg = await ctx.newPage()
  await pg.goto('http://x.test:4700/login')
  await pg.fill('input[name=user]', 'reader@x.test'); await pg.fill('input[name=password]', 'fixture')
  await pg.click('button[type=submit]')
  await pg.waitForURL(/\/home$/)
  await pg.waitForFunction(() => (localStorage.getItem('x_token') || '').startsWith('tk_'))
  for (const c of await ctx.cookies()) if (c.value.length >= 12) recordSecret(c.value)
  recordSecret(await pg.evaluate(() => localStorage.getItem('x_token') || ''))
  await ctx.close()
  const tmpBefore = new Set(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('rwc-')))
  const rw = await launch({ env: { RW_BRIDGE_PROFILE_DIR: profile, RW_BRIDGE_MOCK_KEYCHAIN: '1' } })
  const loads0 = (await fixtures.xState()).postLoads['/dana_okafor_fx/status/102'] || 0
  const r = await rw.invoke('ingress.addUrl', { url: 'http://x.test:4700/dana_okafor_fx/status/102' })
  expect(r.pending ?? false).toBe(false)
  await rw.drain(300_000)
  const doc = (await rw.inspect('documents')).find((d: any) => d.text.includes('Per-resolution pricing is eating the BPO playbook'))
  expect(doc, 'post ingested through the bridge').toBeTruthy()
  const xs = await fixtures.xState()
  expect((xs.postLoads['/dana_okafor_fx/status/102'] || 0) - loads0).toBe(1)
  expect(xs.clicks).toBe(0)
  expect(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('rwc-') && !tmpBefore.has(f))).toEqual([])
  await rw.close()
  fs.rmSync(profile, { recursive: true, force: true })
})

async function signInX(rw: RW) {
  const sessions0 = (await fixtures.xState()).sessions
  await rw.invoke('source.signIn', { id: 'site:x.test' })
  const login: Page = await until(async () => rw.app.windows().find(w => /x\.test:4700\/login/.test(w.url())) || null, 30_000)
  await login.fill('input[name=user]', 'reader@x.test'); await login.fill('input[name=password]', 'fixture')
  await login.click('button[type=submit]')
  // signed in once the fixture has issued a new session; the app then closes the window by itself
  await until(async () => (await fixtures.xState()).sessions > sessions0 || null, 30_000, 300)
  await new Promise(r => setTimeout(r, 2000))
}

test('E2E-SENT-01 user-sent X posts', async () => {
  await fixtures.reset()
  const rw = await launch()
  await signInX(rw)
  const st0 = await fixtures.xState()
  const urls = ['http://x.test:4700/dana_okafor_fx/status/101', 'http://x.test:4700/dana_okafor_fx/status/102', 'http://x.test:4700/dana_okafor_fx/status/103']
  for (const u of [...urls, urls[0]]) { await rw.invoke('ingress.addUrl', { url: u }); await rw.drain(300_000) }
  const xs = await fixtures.xState()
  const loads = urls.reduce((n, u) => n + ((xs.postLoads[new URL(u).pathname] || 0) - (st0.postLoads[new URL(u).pathname] || 0)), 0)
  expect(loads).toBe(4)
  expect(xs.clicks).toBe(st0.clicks)
  const docs = (await rw.inspect('documents')).filter((d: any) => /x\.test/.test(d.url || '') && d.status !== 'duplicate')
  expect(docs.length).toBe(3)
  for (const d of docs) {
    const files = fs.readdirSync(path.join(rw.dataDir, 'content', d.id))
    expect(files).toEqual(['v1.raw.txt'])
    expect(fs.readFileSync(path.join(rw.dataDir, 'content', d.id, 'v1.raw.txt'), 'utf8')).toBe(d.text)
  }
  await rw.close()
})

test('E2E-SENT-02/03 restricted profiles refused; bookmarklet capture', async () => {
  await fixtures.reset()
  const rw = await launch()
  const before = (await fixtures.state()).loads
  for (const loc of ['http://x.test:4700/handle', 'http://linkedin.test:4700/in/x']) {
    const p = await rw.invoke('source.probe', { locator: loc })
    expect(p.status).toBe('unsupported'); expect(p.message).toMatch(/can’t be watched automatically/)
  }
  const after = (await fixtures.state()).loads
  expect(after.x || 0).toBe(before.x || 0); expect(after.linkedin || 0).toBe(before.linkedin || 0)
  const sel = 'Carriers want vendors who take the SLA for claims intake.'
  const xs0 = await fixtures.xState()
  await rw.app.evaluate(({ app }, l) => { app.emit('open-url', { preventDefault() {} }, l) }, `researchworkspace://add?url=${encodeURIComponent('http://x.test:4700/p/1')}&text=${encodeURIComponent(sel)}`)
  await until(async () => (await rw.inspect('documents')).some((d: any) => d.text === sel) || null, 30_000)
  const doc = (await rw.inspect('documents')).find((d: any) => d.text === sel)
  expect(['fetched', 'processing', 'processed', 'pending_capture']).toContain(doc.status)
  expect(JSON.stringify((await fixtures.xState()).postLoads)).toBe(JSON.stringify(xs0.postLoads))
  await rw.drain(300_000)
  await rw.close()
})
