// SMK-01 (RFC PH-01): foundation — status/schema, thesis persisted across restart via UI, crash-safe jobs, ChatGPT sign-in.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, until } from '../harness/app'

const CODEX_AUTH = path.join(os.homedir(), '.codex', 'auth.json')

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}

test('SMK-01 PH-01 foundation', async () => {
  const authBefore = fs.readFileSync(CODEX_AUTH)

  // (a) launch clean → app.status ok, schema at the latest migration (3: object_details, DEC-099)
  let rw = await launch()
  const st = await rw.invoke('app.status')
  expect(st.schemaVersion).toBe(3)
  expect(st.testMode).toBe(true)

  // (b) UI: "+ New thesis" → Describe it (title alone works), restart → title present in Theses list
  await rw.page.getByText('Theses', { exact: true }).first().click()
  await rw.page.getByRole('button', { name: '+ New thesis' }).click()
  const sheet = rw.page.getByRole('dialog', { name: 'Describe it' })
  await sheet.getByLabel('Title').fill('Smoke thesis')
  await sheet.getByRole('button', { name: 'Create thesis' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(rw.page.getByLabel('Thesis title')).toHaveValue('Smoke thesis')
  rw = await rw.restart()
  await rw.page.getByText('Theses', { exact: true }).first().click()
  await expect(rw.page.getByText('Smoke thesis', { exact: true }).first()).toBeVisible()
  const tree = await rw.invoke('thesis.tree')
  expect(tree.map((t: any) => t.title)).toContain('Smoke thesis')

  // (c) MAINTENANCE job with fault crash_during_job: kill mid-job, relaunch → completes exactly once
  await rw.invoke('test.faults.set', { spec: 'crash_during_job' })
  await rw.invoke('test.clock.advance', { ms: 61 * 60_000 })
  let crashed = false
  const exited = new Promise<void>(res => rw.app.process().on('exit', () => { crashed = true; res() }))
  await rw.raw('test.scheduler.tick').catch(() => {})
  await Promise.race([exited, new Promise(r => setTimeout(r, 15_000))])
  expect(crashed, 'app must crash mid-job').toBe(true)
  rw = await rw.restart()
  await rw.drain(60_000)
  const jobs = await rw.inspect('jobs', { type: 'MAINTENANCE' })
  const unmute = jobs.filter((j: any) => JSON.parse(j.payload_json).task === 'unmute')
  expect(unmute.length).toBe(1)
  expect(unmute[0].status).toBe('succeeded')
  const runs = await rw.inspect('settings', { key: 'test.maintenance_runs.unmute' })
  expect(JSON.parse(runs[0].value_json)).toBe(1)

  // (d) ai.status reports the detected ChatGPT sign-in; ai.test passes; no token in data dir/logs; auth.json untouched
  const ai = await rw.invoke('ai.status')
  expect(ai.status).toBe('ok')
  const t = await rw.invoke('ai.test')
  expect(t.ok).toBe(true)
  await rw.close()
  const auth = JSON.parse(authBefore.toString('utf8'))
  const secrets = [auth.tokens.access_token, auth.tokens.refresh_token, auth.tokens.id_token].map((s: string) => s.slice(20, 60))
  for (const f of walk(rw.dataDir)) {
    const buf = fs.readFileSync(f)
    for (const sct of secrets) expect(buf.includes(Buffer.from(sct)), `${f} contains a token fragment`).toBe(false)
  }
  expect(fs.readFileSync(CODEX_AUTH).equals(authBefore)).toBe(true)
})
