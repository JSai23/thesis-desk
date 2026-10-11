// SMK-07 (RFC PH-07): authenticated browser source — sign-in window, persisted session, expiry, sign in again.
import { test, expect } from '@playwright/test'
import { launch, until } from '../harness/app'
import { signInLedger, F_LEDGER_2 } from '../harness/ledger'
import { fixtures } from '../harness/fixtures'

test('SMK-07 PH-07 authenticated browser source', async () => {
  await fixtures.reset()
  let rw = await launch()
  const p = await rw.invoke('source.probe', { locator: 'http://ledger.test:4700/' })
  expect(p.status).toBe('login_required')
  const src = await rw.invoke('source.create', { locator: 'http://ledger.test:4700/', mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  expect(src.authState).toBe('login_required')
  await signInLedger(rw, src.id)
  await until(async () => (await rw.invoke('source.get', { id: src.id })).authState === 'authenticated', 60_000)
  await rw.drain(400_000)
  const docs = await rw.inspect('documents')
  const d14 = docs.find((d: any) => d.text.includes(F_LEDGER_2))
  expect(d14, 'D14 ingested with logged-in text').toBeTruthy()

  // restart → Sync now works without signing in
  rw = await rw.restart()
  await rw.invoke('source.syncNow', { id: src.id })
  await rw.drain(300_000)
  expect((await rw.invoke('source.get', { id: src.id })).authState).toBe('authenticated')
  const fetches = (await rw.inspect('jobs', { type: 'FETCH_SOURCE' })).filter((j: any) => JSON.parse(j.payload_json).sourceId === src.id)
  expect(fetches[fetches.length - 1].status).toBe('succeeded')

  // expiry → Sync now → expired, AUTH_EXPIRED, nothing walled stored, banner
  await fixtures.expireLedger()
  await rw.invoke('source.syncNow', { id: src.id })
  await rw.drain(300_000)
  expect((await rw.invoke('source.get', { id: src.id })).authState).toBe('expired')
  const jobs = (await rw.inspect('jobs', { type: 'FETCH_SOURCE' })).filter((j: any) => JSON.parse(j.payload_json).sourceId === src.id)
  const last = jobs[jobs.length - 1]
  expect(last.status).toBe('failed'); expect(last.error_code).toBe('AUTH_EXPIRED'); expect(last.attempts).toBe(1)
  for (const v of await rw.inspect('document_versions')) expect(v.text).not.toContain('Sign in to keep reading')
  expect((await rw.invoke('app.status')).banners.some((b: any) => b.kind === 'auth_expired')).toBe(true)
  await rw.page.getByText('Today', { exact: true }).first().click()
  await expect(rw.page.getByText(/needs you to sign in again/)).toBeVisible()

  // Sign in again → authenticated
  await signInLedger(rw, src.id)
  await until(async () => (await rw.invoke('source.get', { id: src.id })).authState === 'authenticated', 60_000)
  await rw.drain(300_000)
  await rw.close()
})
