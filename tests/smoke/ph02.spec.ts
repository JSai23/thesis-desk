// SMK-02 (RFC PH-02): Read once of a URL / pasted text through fetch → normalize → dedupe → document; reader; history.
import { test, expect } from '@playwright/test'
import { launch, until } from '../harness/app'
import { fixtures } from '../harness/fixtures'

const F_LUMEN_1 = 'Lumen Legal, a San Francisco startup that uses AI to review commercial contracts, has raised an $18 million Series A led by Northwind Ventures.'
const D2 = 'http://vln.test:4700/2026/09/22/lumen-legal-series-a'
const D1 = 'http://signalwire.test:4700/lumen-legal-series-a'

test('SMK-02 PH-02 manual URL ingestion and reader', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page

  // (a) UI: + New → Add link to read → paste → Read now
  await page.getByRole('button', { name: /New/ }).click()
  await page.getByText('Add link to read', { exact: true }).click()
  await page.locator('input').first().fill(D2)
  await page.getByRole('button', { name: 'Read now' }).click()
  await expect(page.getByText('Lumen Legal raises $18M Series A led by Northwind Ventures').first()).toBeVisible({ timeout: 30_000 })
  // the sheet stays open "Reading…" until the page is saved (its preview already shows the title): wait for the document
  await expect.poll(async () => (await rw.inspect('documents')).length, { timeout: 30_000 }).toBe(1)
  const docs1 = await rw.inspect('documents')
  expect(docs1.length).toBe(1)
  expect(docs1[0].title).toBe('Lumen Legal raises $18M Series A led by Northwind Ventures')
  expect(docs1[0].text).toContain(F_LUMEN_1)
  const items1 = await rw.inspect('feed_items')
  expect(items1.length).toBe(1)
  const feed = await rw.invoke('feed.list', { viewSpec: { segment: 'today' } })
  expect(feed.items[0].reason).toBe('You added this link')
  // reader shows the paragraphs
  await expect(page.getByText(F_LUMEN_1).first()).toBeVisible()

  // (b) same URL again → still 1 document, 0 new feed items
  await rw.invoke('ingress.addUrl', { url: D2 })
  expect((await rw.inspect('documents')).length).toBe(1)
  expect((await rw.inspect('feed_items')).length).toBe(1)

  // (c) identical text at a different URL → status duplicate, no new feed item
  const r3 = await rw.invoke('ingress.addUrl', { url: D1 })
  const dup = (await rw.inspect('documents')).find((d: any) => d.url === D1)
  expect(dup.status).toBe('duplicate')
  expect(dup.duplicate_of_id).toBe(docs1[0].id)
  expect(r3.documentId).toBe(docs1[0].id)
  expect((await rw.inspect('feed_items')).length).toBe(1)

  // (d) 300-char pasted text → text document titled from its first line
  const text = 'Notes from a call with a claims operations lead\n\n' + 'They said intake automation only matters when the vendor takes responsibility for turnaround times and accuracy, and that most pilots stall when the software vendor will not sign a service level agreement for the work itself. '.repeat(2)
  const r4 = await rw.invoke('ingress.addText', { text })
  const tdoc = (await rw.inspect('documents', { id: r4.documentId }))[0]
  expect(tdoc.kind).toBe('text')
  expect(tdoc.title).toBe('Notes from a call with a claims operations lead')

  // (e) /gone/ → FETCH_FAILED and an On-demand history row "Couldn’t read this page"
  const bad = await rw.raw('ingress.addUrl', { url: 'http://gone.test:4700/' })
  expect(bad.ok).toBe(false)
  expect(bad.code).toBe('FETCH_FAILED')
  const hist = await rw.invoke('source.history')
  expect(hist.some((h: any) => h.outcome === 'Couldn’t read this page' && /gone\.test/.test(h.url))).toBe(true)

  // On-demand history tab in the UI
  await page.getByText('Sources', { exact: true }).first().click()
  await page.getByText('On-demand history').click()
  await expect(page.getByText('Couldn’t read this page').first()).toBeVisible()
  await rw.drain(60_000)
  await rw.close()
})
