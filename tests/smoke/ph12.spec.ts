// SMK-12 (RFC PH-12): Notify me on a firm → compiled rule + backtest; epoch-2 match delivers exactly one notification
// (others cooldown-suppressed) and places the item in Important; non-match → none; re-ingest → no duplicate; cooldown.
import { test, expect } from '@playwright/test'
import { launch } from '../harness/app'
import { fixtures } from '../harness/fixtures'

const H = 3600_000
const D1 = 'http://signalwire.test:4700/lumen-legal-series-a'
const D7 = 'http://northwind.test:4700/blog/our-investment-in-lumen-legal'
const D10 = 'http://stackforge.test:4700/blog/series-b'
const D18 = 'http://signalwire.test:4700/claimwise-meridian'

test('SMK-12 PH-12 alerts and notifications', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page
  for (const u of [D1, D7]) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(400_000)
  const northwind = (await rw.inspect('firms')).find((f: any) => /^Northwind/.test(f.name) && !f.merged_into_id)
  expect(northwind).toBeTruthy()

  // (a) Notify me… on the firm page → compiled filters + backtest line → Create alert
  await page.keyboard.press('Meta+k')
  await page.getByLabel('Search').fill(northwind.name)
  await page.getByRole('option', { name: new RegExp(northwind.name) }).first().click()
  await page.getByRole('button', { name: 'Notify me…' }).click()
  const box = page.getByLabel('Alert condition')
  await box.fill('Tell me when Northwind leads a round')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByTestId('backtest')).toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId('backtest')).toHaveText(/Would have matched [1-9]\d* times? in the last 30 days/)
  await page.getByRole('button', { name: 'Create alert' }).click()
  const rule = (await rw.invoke('alert.list', {})).find((a: any) => a.text === 'Tell me when Northwind leads a round')
  expect(rule.status).toBe('active')
  expect(rule.backtestCount).toBeGreaterThanOrEqual(1)
  const def = JSON.parse((await rw.inspect('alert_rules', { id: rule.id }))[0].rule_json)
  expect(def.filters.investorFirms).toEqual([northwind.id])
  expect(def.filters.investorRole).toBe('lead')
  expect([...def.filters.kinds].sort()).toEqual(['funding', 'investment'])
  expect(rule.anchorType).toBe('firm')

  // (b) epoch 2: D10 (Stackforge Series B led by Northwind) + D7 v2 → exactly one delivered notification
  await fixtures.epoch(2)
  for (const u of [D10, D7]) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(400_000)
  const notes = () => rw.inspect('notifications', { alert_rule_id: rule.id })
  let ns = await notes()
  const delivered = ns.filter((n: any) => !n.suppressed_reason)
  expect(delivered.length).toBe(1)
  expect(ns.filter((n: any) => n.suppressed_reason).every((n: any) => n.suppressed_reason === 'cooldown')).toBe(true)
  const item = (await rw.inspect('feed_items', { document_id: delivered[0].document_id }))[0]
  expect(item.group_key).toBe('important')
  expect(JSON.parse(item.reasons_json).some((r: any) => /^Matched your alert/.test(r.label))).toBe(true)

  // (c) epoch-2 Claimwise partnership → no notification for the rule
  const before = ns.length
  await rw.invoke('ingress.addUrl', { url: D18 })
  await rw.drain(400_000)
  const claimwise = (await rw.inspect('documents')).find((d: any) => /claimwise-meridian/.test(d.url))
  expect((await notes()).filter((n: any) => n.document_id === claimwise.id).length).toBe(0)

  // (d) re-ingest the same evidence → no duplicate notification
  await rw.invoke('ingress.addUrl', { url: D10 })
  await rw.drain(400_000)
  ns = await notes()
  expect(ns.length).toBe(before)

  // (e) cooldown: past the 6 h window burst-1 delivers, burst-2 within 6 h is suppressed
  await rw.invoke('test.clock.advance', { ms: 7 * H })
  await rw.invoke('ingress.addUrl', { url: 'http://alerts.test:4700/burst-1' })
  await rw.drain(400_000)
  await rw.invoke('ingress.addUrl', { url: 'http://alerts.test:4700/burst-2' })
  await rw.drain(400_000)
  const docs = await rw.inspect('documents')
  const docOf = (n: number) => docs.find((d: any) => d.url.endsWith('/burst-' + n)).id
  ns = await notes()
  const b1 = ns.filter((n: any) => n.document_id === docOf(1))
  const b2 = ns.filter((n: any) => n.document_id === docOf(2))
  expect(b1.length).toBeGreaterThanOrEqual(1)
  expect(b1.some((n: any) => !n.suppressed_reason)).toBe(true)
  expect(b2.length).toBeGreaterThanOrEqual(1)
  expect(b2.every((n: any) => n.suppressed_reason === 'cooldown')).toBe(true)
  await rw.close()
})
