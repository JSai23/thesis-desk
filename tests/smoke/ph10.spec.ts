// SMK-10 (RFC PH-10): palette lexical search (≤150 ms in main) and grounded Ask, insufficient answers, provider fallback.
import { test, expect } from '@playwright/test'
import { launch } from '../harness/app'
import { fixtures } from '../harness/fixtures'

const URLS = ['http://signalwire.test:4700/lumen-legal-series-a', 'http://northwind.test:4700/blog/our-investment-in-lumen-legal', 'http://vln.test:4700/2026/09/25/deal-memo-daily', 'http://misc.test:4700/claimwise-interview.html']

test('SMK-10 PH-10 query and search', async () => {
  await fixtures.reset()
  const rw = await launch()
  await rw.invoke('thesis.create', { title: 'Legal AI' })
  for (const u of URLS) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(400_000)

  // (a) lexical search
  const s = await rw.invoke('search.query', { text: 'Lumen' })
  expect(s.companies[0].name).toBe('Lumen Legal')
  expect(s.elapsedMs).toBeLessThanOrEqual(150)

  // (b) grounded Ask through the palette UI
  const page = rw.page
  await page.keyboard.press('Meta+k')
  await page.getByLabel('Search').fill('Who led Lumen Legal\'s Series A?')
  await page.getByRole('option', { name: /^Ask: / }).click()
  const answer = page.getByTestId('answer')
  await expect(answer.getByText('From your sources')).toBeVisible({ timeout: 120_000 })
  const a = await rw.invoke('query.ask', { question: 'Who led Lumen Legal\'s Series A?' })
  const facts = a.items.filter((i: any) => i.type === 'fact')
  expect(facts.some((f: any) => /Northwind/.test(f.text))).toBe(true)
  const lumenDocs = new Set((await rw.inspect('documents')).filter((d: any) => /Lumen/.test(d.text)).map((d: any) => d.id))
  const cited = facts.find((f: any) => /Northwind/.test(f.text))
  expect(cited.citations.length).toBeGreaterThanOrEqual(1)
  expect(cited.citations.every((n: number) => lumenDocs.has(a.citations.find((c: any) => c.n === n).documentId))).toBe(true)

  // (c) insufficient evidence → insufficient=true and no currency amount stated as fact
  const r = await rw.invoke('query.ask', { question: 'What is Claimwise\'s annual revenue?' })
  expect(r.insufficient).toBe(true)
  for (const f of r.items.filter((i: any) => i.type === 'fact')) expect(f.text).not.toMatch(/revenue[^.]*\$\d/i)

  // (d) provider error on ANSWER_QUERY → matching evidence shown instead
  await rw.invoke('test.faults.set', { spec: 'provider_error:ANSWER_QUERY' })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+k')
  await page.getByLabel('Search').fill('Who led Lumen Legal\'s Series A?')
  await page.getByRole('option', { name: /^Ask: / }).click()
  await expect(page.getByText('I couldn’t reach the AI provider. Showing matching evidence instead.')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText('Matching evidence', { exact: true })).toBeVisible()
  await rw.close()
})
