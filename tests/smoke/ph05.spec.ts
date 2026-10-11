// SMK-05 (RFC PH-05): add/configure sources, scheduled polling, lifecycle, failures + banner, unsupported, suggestions.
import { test, expect } from '@playwright/test'
import { launch } from '../harness/app'
import { fixtures } from '../harness/fixtures'

const MIN = 60_000

test('SMK-05 PH-05 sources and scheduled polling', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page

  // (h, part 1) before any source: Suggested lists the 8 starter-pack cards
  const sug0 = await rw.invoke('source.suggestions')
  expect(sug0.filter((s: any) => s.id.startsWith('starter:')).length).toBe(8)

  // (a) rss source with a custom instruction → initial sync ingests the 4 epoch-1 items
  const p = await rw.invoke('source.probe', { locator: 'http://signalwire.test:4700/feed.xml' })
  expect(p.status).toBe('found'); expect(p.kind).toBe('rss')
  const sw = await rw.invoke('source.create', { locator: 'http://signalwire.test:4700/feed.xml', mode: 'custom', instruction: 'Legal AI and customer-support automation news', freq: 'hourly', thesisIds: [], probe: p })
  await rw.drain(400_000)
  const swDocs = () => rw.inspect('document_sources', { source_id: sw.id })
  expect((await swDocs()).length).toBe(4)
  const s1 = await rw.invoke('source.get', { id: sw.id })
  expect(s1.health).toBe('ok'); expect(s1.lastSuccessAt).toBeTruthy()

  // (b) epoch 2; advance 61 min on the hourly source and tick → new item, cursor advanced
  await fixtures.epoch(2)
  const cursorBefore = (await rw.inspect('sources', { id: sw.id }))[0].cursor_json
  await rw.invoke('test.clock.advance', { ms: 61 * MIN })
  await rw.invoke('test.scheduler.tick')
  await rw.drain(400_000)
  expect((await swDocs()).length).toBe(5)
  expect((await rw.inspect('sources', { id: sw.id }))[0].cursor_json).not.toBe(cursorBefore)

  // (c) Sync now → up to date, 0 new documents
  const docsBefore = (await rw.inspect('documents')).length
  const done = page.evaluate(() => new Promise<any>(r => { const off = (window as any).rw.on('source.syncCompleted', (p: any) => { off(); r(p) }) }))
  await rw.invoke('source.syncNow', { id: sw.id })
  const ev = await done
  expect(ev.new).toBe(0); expect(ev.toast).toMatch(/is up to date/)
  await rw.drain(120_000)
  expect((await rw.inspect('documents')).length).toBe(docsBefore)

  // (d) broken feed → retries → failing + banner; fixture healthy + Retry → ok, banner gone
  const bp = await rw.invoke('source.probe', { locator: 'http://broken.test:4700/feed.xml' })
  expect(bp.status).toBe('unreachable')
  await fixtures.fail('broken/feed.xml', 200)
  const bpOk = await rw.invoke('source.probe', { locator: 'http://broken.test:4700/feed.xml' })
  await fixtures.fail('broken/feed.xml', 'off')
  const br = await rw.invoke('source.create', { locator: 'http://broken.test:4700/feed.xml', mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: bpOk })
  await rw.drain(60_000)
  await rw.invoke('test.clock.advance', { ms: 2 * MIN }); await rw.drain(60_000)
  await rw.invoke('test.clock.advance', { ms: 6 * MIN }); await rw.drain(60_000)
  const bs = (await rw.inspect('sources', { id: br.id }))[0]
  expect(bs.health).toBe('failing'); expect(bs.last_error_code).toBe('HTTP_500')
  const st = await rw.invoke('app.status')
  expect(st.banners.some((b: any) => b.kind === 'source_attention')).toBe(true)
  await page.getByText('Today', { exact: true }).first().click()
  await expect(page.getByText(/need(s)? attention/).first()).toBeVisible()
  await fixtures.fail('broken/feed.xml', 200)
  await rw.invoke('source.retry', { id: br.id }); await rw.drain(120_000)
  expect((await rw.inspect('sources', { id: br.id }))[0].health).toBe('ok')
  expect((await rw.invoke('app.status')).banners.some((b: any) => b.kind === 'source_attention')).toBe(false)

  // (e) Product Hunt → unsupported card in the Add-source sheet
  await page.getByText('Add source', { exact: true }).first().click()
  await page.getByLabel('Source or link').fill('producthunt.com/posts/someone')
  await expect(page.getByText('Can’t watch this')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start watching' })).toBeDisabled()
  await page.keyboard.press('Escape')

  // (f) pause → tick past the interval → no fetch job; resume → job
  await rw.invoke('source.setEnabled', { id: sw.id, enabled: false })
  const fetchJobs = async () => (await rw.inspect('jobs', { type: 'FETCH_SOURCE' })).filter((j: any) => JSON.parse(j.payload_json).sourceId === sw.id).length
  const before = await fetchJobs()
  await rw.invoke('test.clock.advance', { ms: 2 * 60 * MIN }); await rw.invoke('test.scheduler.tick')
  expect(await fetchJobs()).toBe(before)
  await rw.invoke('source.setEnabled', { id: sw.id, enabled: true })
  await rw.invoke('test.scheduler.tick')
  expect(await fetchJobs()).toBe(before + 1)
  await rw.drain(300_000)

  // (g) remove with one saved item → saved stays visible, others hidden; restore → all visible
  const items = (await rw.invoke('feed.list', { viewSpec: { segment: 'all' } })).items.filter((i: any) => i.srcId === sw.id)
  expect(items.length).toBeGreaterThanOrEqual(2)
  await rw.invoke('feed.save', { ids: [items[0].id], saved: true })
  await rw.invoke('source.remove', { id: sw.id })
  const after = (await rw.invoke('feed.list', { viewSpec: { segment: 'all' } })).items.filter((i: any) => i.srcId === sw.id)
  expect(after.map((i: any) => i.id)).toEqual([items[0].id])
  await rw.invoke('source.restore', { id: sw.id })
  expect((await rw.invoke('feed.list', { viewSpec: { segment: 'all' } })).items.filter((i: any) => i.srcId === sw.id).length).toBe(items.length)

  // (h) HN fixture source; follow Stackforge after D9 → "no source covers it" card; Subscribe creates /stackforge/blog/
  await fixtures.epoch(1)
  const hp = await rw.invoke('source.probe', { locator: 'http://hn.test:4700/v0' })
  expect(hp.kind).toBe('hn_api')
  await rw.invoke('source.create', { locator: 'http://hn.test:4700/v0', mode: 'relevant', instruction: '', freq: 'hourly', thesisIds: [], probe: hp })
  await rw.drain(400_000)
  const sf = (await rw.inspect('companies')).find((c: any) => c.name === 'Stackforge')
  expect(sf, 'Stackforge extracted from D9').toBeTruthy()
  await rw.invoke('object.follow', { type: 'company', id: sf.id, follow: true })
  const sug = await rw.invoke('source.suggestions')
  const card = sug.find((s: any) => s.reason === 'You follow Stackforge, but no source covers it directly')
  expect(card, 'Stackforge suggestion').toBeTruthy()
  await page.getByText('Sources', { exact: true }).first().click()
  await page.getByText(/^Suggested/).click()
  await expect(page.getByText('You follow Stackforge, but no source covers it directly')).toBeVisible()
  const sub = await rw.invoke('source.create', { locator: card.locator, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], origin: 'suggestion' })
  expect(sub.kind).toBe('web')
  expect(sub.locator).toMatch(/stackforge\.test:4700\/blog\/?$/)
  await rw.drain(400_000)
  await rw.close()
})
