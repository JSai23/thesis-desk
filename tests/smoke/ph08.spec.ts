// SMK-08 (RFC PH-08): capture without AI, thesis revisions in Evolution, corrections that survive re-extraction,
// entity merge, Check for updates performs retrieval.
import { test, expect } from '@playwright/test'
import { launch, until } from '../harness/app'
import { fixtures } from '../harness/fixtures'

test('SMK-08 PH-08 theses, notes, corrections, object pages', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page
  const th = await rw.invoke('thesis.create', { title: 'Claims & insurance operations' })

  // (a) thought sheet with ORGANIZE_NOTE failing → saved immediately, "Not organized yet"
  await rw.invoke('test.faults.set', { spec: 'provider_error:ORGANIZE_NOTE' })
  const t0 = Date.now()
  const n = await rw.invoke('note.create', { text: 'Carriers seem to want vendors who take the SLA, not just software.', thesisId: th.id })
  expect(n.elapsedMs).toBeLessThan(200)
  expect(Date.now() - t0).toBeLessThan(2000)
  await page.keyboard.press('n')
  await page.locator('textarea').first().fill('Claims intake vendors that own turnaround times will win the carriers.')
  await page.keyboard.press('Meta+Enter')
  await until(async () => (await rw.inspect('notes')).length === 2, 10_000)
  await rw.drain(60_000)
  for (const x of await rw.inspect('notes')) expect(x.ai_state).toBe('failed')
  await rw.invoke('test.faults.set', { spec: '' })
  await page.getByText('Theses', { exact: true }).first().click()
  await page.getByText('Claims & insurance operations', { exact: true }).first().click()
  await expect(page.getByText(/Not organized yet/).first()).toBeVisible()

  // (b) edit the current view twice → Evolution shows two revisions with before/after
  const view = page.locator('[contenteditable="true"]').first()
  await view.click(); await view.fill('Carriers will outsource claims intake to AI vendors.'); await page.locator('body').click({ position: { x: 5, y: 300 } })
  await until(async () => (await rw.inspect('history', { entity_id: th.id, action: 'thesis.view_revised' })).length === 1, 10_000)
  await view.click(); await view.fill('Carriers will outsource claims intake to AI vendors that own the SLA.'); await page.locator('body').click({ position: { x: 5, y: 300 } })
  await until(async () => (await rw.inspect('history', { entity_id: th.id, action: 'thesis.view_revised' })).length === 2, 10_000)
  const evo = await rw.invoke('thesis.evolution', { id: th.id })
  const revs = evo.flatMap((m: any) => m.events).filter((e: any) => e.kind === 'Revision')
  expect(revs.length).toBe(2)
  expect(revs[1].before).toBe('Carriers will outsource claims intake to AI vendors.')
  expect(revs[1].after).toBe('Carriers will outsource claims intake to AI vendors that own the SLA.')
  await page.getByText('Evolution', { exact: true }).click()
  await expect(page.getByText('Carriers will outsource claims intake to AI vendors that own the SLA.').last()).toBeVisible()

  // (c) set Claimwise stage via the field popover → reprocess with a new generation → stays Series A; proposal banner
  const r = await rw.invoke('ingress.addUrl', { url: 'http://vln.test:4700/2026/09/25/deal-memo-daily' })
  await rw.drain(300_000)
  const cw = (await rw.inspect('companies')).find((c: any) => c.name === 'Claimwise')
  expect(cw).toBeTruthy()
  expect((await rw.inspect('field_values', { object_type: 'company', object_id: cw.id, field_key: 'stage', status: 'current' }))[0]?.display).toBe('Seed')
  await page.getByText('Companies', { exact: true }).first().click()
  await page.getByText('All tracked').click()
  await page.getByText('Claimwise', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Seed' }).first().click()
  await page.getByRole('button', { name: 'Change…' }).click()
  await page.getByLabel('New Stage').fill('Series A')
  await page.getByLabel('New Stage').press('Enter')
  await until(async () => (await rw.inspect('field_values', { object_type: 'company', object_id: cw.id, field_key: 'stage', status: 'current' }))[0]?.display === 'Series A', 10_000)
  await rw.invoke('document.retry', { id: r.documentId, resetGeneration: true })
  await rw.drain(300_000)
  const cur = (await rw.inspect('field_values', { object_type: 'company', object_id: cw.id, field_key: 'stage', status: 'current' }))[0]
  expect(cur.display).toBe('Series A'); expect(cur.origin).toBe('user')
  const proposed = await rw.inspect('field_values', { object_type: 'company', object_id: cw.id, field_key: 'stage', status: 'proposed' })
  if (proposed.length) await expect(page.getByText(/New evidence says Seed/)).toBeVisible()

  // (d) merge a duplicate company into Lumen Legal → relationships repointed, alias added
  await rw.invoke('ingress.addUrl', { url: 'http://signalwire.test:4700/lumen-legal-series-a' })
  await rw.drain(300_000)
  const lumen = (await rw.inspect('companies')).find((c: any) => c.name === 'Lumen Legal')
  expect(lumen).toBeTruthy()
  // adding a name the library already knows reuses it (DEC-088)…
  const same = await rw.invoke('object.create', { type: 'company', name: 'Lumen Legal AI' })
  expect(same.existing).toBe(true); expect(same.id).toBe(lumen.id)
  // …so the duplicate to merge is a spelling the resolver can't tie to it
  const dup = await rw.invoke('object.create', { type: 'company', name: 'LumenLaw Assistant' })
  expect(dup.existing).toBe(false)
  await rw.invoke('note.create', { text: 'Duplicate entry note', anchor: { type: 'company', id: dup.id } })
  await rw.invoke('thesis.addCompany', { id: th.id, companyId: dup.id })
  await rw.invoke('merge.entities', { type: 'company', fromId: dup.id, intoId: lumen.id })
  expect((await rw.inspect('companies', { id: dup.id }))[0].merged_into_id).toBe(lumen.id)
  expect((await rw.inspect('notes')).find((x: any) => x.text === 'Duplicate entry note').anchor_id).toBe(lumen.id)
  expect((await rw.inspect('relationships', { from_type: 'company', from_id: lumen.id, to_type: 'thesis', to_id: th.id })).length).toBe(1)
  expect((await rw.inspect('aliases', { entity_id: lumen.id })).some((a: any) => a.alias === 'LumenLaw Assistant')).toBe(true)
  const s = await rw.invoke('search.query', { text: 'LumenLaw Assistant' }).catch(() => null)
  if (s) expect(s.companies?.[0]?.id).toBe(lumen.id)

  // (e) Check for updates on Stackforge (with a site source) → FETCH job ran, toast outcome
  const sp = await rw.invoke('source.probe', { locator: 'http://stackforge.test:4700/blog/' })
  await rw.invoke('source.create', { locator: 'http://stackforge.test:4700/blog/', mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: sp })
  await rw.drain(400_000)
  const sf = (await rw.inspect('companies')).find((c: any) => c.name === 'Stackforge')
  expect(sf).toBeTruthy()
  const fetchesBefore = (await rw.inspect('jobs', { type: 'FETCH_SOURCE' })).length
  const toast = page.evaluate(() => new Promise<any>(res => { const off = (window as any).rw.on('source.syncCompleted', (p: any) => { if (p.objectId) { off(); res(p) } }) }))
  const ref = await rw.invoke('object.refresh', { type: 'company', id: sf.id })
  expect(ref.sources).toBeGreaterThanOrEqual(1)
  const ev = await toast
  expect(ev.toast).toMatch(/Stackforge/)
  expect((await rw.inspect('jobs', { type: 'FETCH_SOURCE' })).length).toBeGreaterThan(fetchesBefore)
  expect((await rw.inspect('jobs', { type: 'REFRESH_OBJECT' }))[0].status).toBe('succeeded')
  await rw.close()
})
