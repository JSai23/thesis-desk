// SMK-04 (RFC PH-04): Today on real data — keyboard actions, Undo, highlight → evidence, Why, Not related, saved view.
import { test, expect } from '@playwright/test'
import { launch, reloadApp } from '../harness/app'
import { fixtures } from '../harness/fixtures'

const URLS = ['http://signalwire.test:4700/lumen-legal-series-a', 'http://signalwire.test:4700/quillmate-amlaw', 'http://signalwire.test:4700/callhaven-ceiling',
  'http://signalwire.test:4700/brightdesk-cfo', 'http://vln.test:4700/2026/09/24/brightdesk-pricing']

test('SMK-04 PH-04 Today feed', async () => {
  await fixtures.reset()
  let rw = await launch()
  const legal = await rw.invoke('thesis.create', { title: 'Legal AI' })
  await rw.invoke('thesis.update', { id: legal.id, patch: { description: 'AI products for law firms and legal teams, such as contract review, become the default legal workflow.' } })
  const support = await rw.invoke('thesis.create', { title: 'AI replacing outsourced support labor' })
  await rw.invoke('thesis.update', { id: support.id, patch: { description: 'AI customer-support agents replace outsourced contact-center labor and capture BPO budgets.' } })
  for (const u of URLS) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(300_000)
  const page = rw.page
  await reloadApp(page)
  await expect(page.locator('[data-item]')).toHaveCount(5)

  // J, S → saved count 1
  await page.locator('body').click({ position: { x: 600, y: 900 } }).catch(() => {})
  await page.keyboard.press('j')
  await page.keyboard.press('s')
  await expect.poll(async () => (await rw.invoke('feed.counts', {})).saved).toBe(1)
  // J, E → dismissed card gone; Undo restores
  await page.keyboard.press('j')
  await page.keyboard.press('e')
  await expect(page.locator('[data-item]')).toHaveCount(4)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('[data-item]')).toHaveCount(5)

  // select a sentence in the reader → Save as evidence
  const sentence = 'Brightdesk has hired Tomas Berg as chief financial officer.'
  await page.locator('[data-item]').filter({ hasText: 'Brightdesk hires Tomas Berg as CFO' }).click()
  const para = page.locator('p[data-pstart]').filter({ hasText: sentence }).first()
  await expect(para).toBeVisible()
  await para.evaluate((el, s) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node: Node | null; let acc = ''
    const range = document.createRange()
    while ((node = walker.nextNode())) {
      const t = node.textContent || ''
      const i = (acc + t).indexOf(s)
      if (i >= 0 && i >= acc.length) { range.setStart(node, i - acc.length); range.setEnd(node, i - acc.length + s.length); break }
      acc += t
    }
    const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(range)
  }, sentence)
  await para.dispatchEvent('mouseup')
  await page.getByText('★ Save as evidence').click()
  await expect.poll(async () => (await rw.inspect('evidence', { origin: 'user_highlight' })).length).toBe(1)
  const hl = (await rw.inspect('evidence', { origin: 'user_highlight' }))[0]
  const doc = (await rw.inspect('documents', { id: hl.document_id }))[0]
  expect(doc.text.slice(hl.quote_start, hl.quote_end)).toBe(sentence)
  await expect(page.locator('p[data-pstart] span', { hasText: sentence }).first()).toHaveCSS('background-color', 'rgba(255, 205, 90, 0.2)')

  // Why modal lists ≥1 reason
  await page.getByText('Why am I seeing this?').first().click()
  await expect(page.getByText('You added this link').last()).toBeVisible()
  await page.keyboard.press('Escape')

  // Not related on a suggested thesis link → rejected, chip removed
  const items = (await rw.invoke('feed.list', { viewSpec: { segment: 'all' } })).items
  const withLink = items.find((i: any) => i.thesis && !i.saved)
  expect(withLink, 'an item with a suggested thesis link').toBeTruthy()
  const card = page.locator('[data-item]').filter({ hasText: withLink.title })
  await card.click()
  await expect(card.getByText(/Supports|Challenges|Related/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Not related' }).first().click()
  await expect.poll(async () => (await rw.inspect('relationships', { from_type: 'document', from_id: withLink.documentId, to_type: 'thesis', to_id: withLink.thesis }))[0]?.status).toBe('rejected')
  await expect.poll(async () => (await rw.invoke('feed.list', { viewSpec: { segment: 'all' } })).items.find((i: any) => i.id === withLink.id)?.theses.includes(withLink.thesis)).toBe(false)

  // thesis-filtered view → Save as view → sidebar after restart
  await page.getByRole('button', { name: /Filter/ }).click()
  await page.getByText('Legal AI', { exact: true }).last().click()
  await page.getByText('Save as view').click()
  rw = await rw.restart()
  await expect(rw.page.getByText('Views', { exact: true })).toBeVisible()
  await expect(rw.page.locator('div', { hasText: /^▤Legal AI$/ }).first()).toBeVisible()
  await rw.close()
})
