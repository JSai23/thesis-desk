// RFC §3B, DEC-096: Follow on firms and people wherever companies have it, the tier line and Pull latest on pages and
// the People list, and Today's three sections (Following · Your theses · Headlines) with headline-only rows and the
// keyboard flow — through the UI, on the fixture corpus.
import { test, expect, type Page } from '@playwright/test'
import { launch, type RW, reloadApp } from '../harness/app'
import { fixtures } from '../harness/fixtures'

const nav = (page: Page, label: string) => page.locator('aside').getByText(label, { exact: true }).first().click()
const SW = 'http://signalwire.test:4700/feed.xml'
const SUPPORT = 'AI replacing outsourced support labor'
const SUPPORT_DESC = 'AI agents take over outsourced support and back-office work such as customer service and insurance claims intake.'
const reload = async (rw: RW) => { await reloadApp(rw.page) }
const rows = (page: Page) => page.locator('main [data-item]')
/** The entity row in the reader's inspector: the innermost block holding the name and a Follow button. */
const inspectorRow = (page: Page, name: string) => page.locator('div').filter({ has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole('button', { name: /^(Follow|Following)$/ }) }).last()
/** Today as the list shows it: section label → item titles, in order. */
const sections = (page: Page) => page.evaluate(() => {
  const out: { label: string; items: string[] }[] = []
  const list = document.querySelector('main [data-item]')?.parentElement
  for (const el of Array.from(list?.querySelectorAll('[role="heading"], [data-item]') || [])) {
    if (el.getAttribute('role') === 'heading') out.push({ label: el.getAttribute('aria-label') || '', items: [] })
    else out.at(-1)?.items.push((el.querySelector('div:nth-child(2)')?.textContent || '').trim())
  }
  return out
})

async function seeded(o: { theses?: boolean } = {}): Promise<RW> {
  await fixtures.reset()
  const rw = await launch()
  if (o.theses !== false) { const t = await rw.invoke('thesis.create', { title: SUPPORT }); await rw.invoke('thesis.update', { id: t.id, patch: { description: SUPPORT_DESC } }) }
  await rw.drain(120_000) // the new thesis's match (DEC-099) runs before the reading, not alongside it
  const p = await rw.invoke('source.probe', { locator: SW })
  await rw.invoke('source.create', { locator: SW, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  await rw.invoke('ingress.addUrl', { url: 'http://misc.test:4700/claimwise-interview.html' })
  await rw.invoke('ingress.addUrl', { url: 'http://misc.test:4700/sourdough.html' }) // a sent link that fits no section: a Headline
  await rw.drain(500_000)
  await reload(rw)
  return rw
}

test('UI-TIER-01 Follow on firms and people in the inspector, lists and pages; tier line and Pull latest', async () => {
  const rw = await seeded()
  const page = rw.page
  await nav(page, 'Today')
  await page.getByRole('button', { name: /^All \d+$/ }).click()
  // a firm in the inspector: Lumen Legal's round led by Northwind Ventures
  await rows(page).filter({ hasText: /Lumen Legal raises/ }).first().click()
  const firmRow = inspectorRow(page, 'Northwind Ventures')
  await expect(firmRow.getByRole('button', { name: 'Follow' })).toBeVisible()
  await firmRow.getByRole('button', { name: 'Follow' }).click()
  await expect(firmRow.getByRole('button', { name: 'Following' })).toBeVisible()
  const firms = await rw.inspect('firms')
  expect(firms.find((f: any) => f.name === 'Northwind Ventures')?.followed).toBe(1)
  // a person in the inspector: Brightdesk's new CFO
  await rows(page).filter({ hasText: /Tomas Berg/ }).first().click()
  const personRow = inspectorRow(page, 'Tomas Berg')
  await personRow.getByRole('button', { name: 'Follow' }).click()
  await expect(personRow.getByRole('button', { name: 'Following' })).toBeVisible()
  expect((await rw.inspect('people')).find((p: any) => p.name === 'Tomas Berg')?.followed).toBe(1)
  // lists: Venture Firms and People show Following
  await nav(page, 'Venture Firms')
  await expect(page.locator('main').getByText('Northwind Ventures', { exact: true }).first()).toBeVisible()
  await nav(page, 'People')
  await expect(page.locator('main').getByText('Tomas Berg', { exact: true }).first()).toBeVisible()
  // a person not followed has Pull latest on their row (people have no page of their own)
  await page.getByRole('button', { name: 'All tracked' }).click()
  const other = (await rw.inspect('people')).find((p: any) => !p.followed && !p.merged_into_id)
  expect(other, 'a person not followed').toBeTruthy()
  const prow = page.locator('main').locator('div').filter({ has: page.getByText(other.name, { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Pull latest' }) }).last()
  await expect(prow.getByRole('button', { name: 'Pull latest' })).toBeVisible()
  await prow.getByRole('button', { name: 'Pull latest' }).click()
  await expect(page.getByText(`Looking for the latest on ${other.name}… Follow to keep it current.`).first()).toBeVisible()
  expect((await rw.inspect('people', { id: other.id }))[0].followed).toBe(0)
  // a company page not followed: tier line and Pull latest instead of Check for updates
  const quill = (await rw.inspect('companies')).find((c: any) => c.name === 'Quillmate')
  await nav(page, 'Companies')
  await page.getByRole('button', { name: 'All tracked' }).click()
  await page.locator('main').getByText('Quillmate', { exact: true }).first().click()
  await expect(page.getByTestId('tier-line')).toHaveText(/^(Not followed · updated from your sources|Connected via .+ · news checked daily)$/)
  await expect(page.getByRole('button', { name: 'Pull latest' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check for updates' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Pull latest' }).click()
  await expect(page.getByText(/Follow to keep it current\.$/).first()).toBeVisible()
  // following it swaps the line and the button
  await page.getByRole('button', { name: 'Follow', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeVisible()
  await expect(page.getByTestId('tier-line')).toHaveCount(0)
  // the firm page of the followed firm: no tier line; unfollow brings it back with Pull latest
  await nav(page, 'Venture Firms')
  await page.locator('main').getByText('Northwind Ventures', { exact: true }).first().click()
  await expect(page.getByTestId('tier-line')).toHaveCount(0)
  await page.getByRole('button', { name: /Following$/ }).first().click()
  await expect(page.getByTestId('tier-line')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pull latest' })).toBeVisible()
  await rw.close()
})

test('UI-TIER-02 Today in three sections: Following, Your theses, Headlines (headline-only); keyboard across sections', async () => {
  const rw = await seeded()
  const page = rw.page
  const lumen = (await rw.inspect('companies')).find((c: any) => c.name === 'Lumen Legal')
  await rw.invoke('object.follow', { type: 'company', id: lumen.id, follow: true })
  await rw.drain(300_000)
  await reload(rw)
  await nav(page, 'Today')
  const secs = await sections(page)
  const labels = secs.map(s => s.label)
  expect(labels.every(l => /^(Following|Your theses · .+|Headlines)$/.test(l)), `only the three sections: ${labels.join(' | ')}`).toBe(true)
  expect(labels.indexOf('Following')).toBe(0)
  const items = (await rw.invoke('feed.list', {})).items
  // Following: every item is about something followed or connected
  for (const t of secs.find(s => s.label === 'Following')?.items || []) {
    const it = items.find((i: any) => i.title === t)
    expect(it?.reasons.some((r: any) => /^followed_/.test(r.type) || r.type === 'connected'), `${t} in Following`).toBe(true)
  }
  // Headlines: a sent link that fits no other section is there, as a headline-only row (no summary, no reason line)
  const hl = secs.find(s => s.label === 'Headlines')
  expect(hl?.items.some(t => /sourdough/i.test(t)), 'the off-topic sent link is a Headline').toBe(true)
  const sent = items.find((i: any) => /sourdough/i.test(i.title))
  const sentRow = rows(page).filter({ hasText: sent.title }).first()
  await expect(sentRow).not.toContainText(sent.summary.slice(0, 40))
  await expect(sentRow).not.toContainText('You added this link')
  // a sent link about a thesis is a full card under Your theses, with its stance
  const cw = items.find((i: any) => /Claimwise/i.test(i.title))
  if (cw.theses.length) await expect(rows(page).filter({ hasText: cw.title }).first()).toContainText(/Supports|Challenges|Related/)
  // a Following card keeps its summary
  const fol = items.find((i: any) => i.title === secs[0].items[0])
  await expect(rows(page).filter({ hasText: fol.title }).first()).toContainText(fol.summary.slice(0, 30))
  // below-the-bar items are in All, not Today
  const today = items.filter((i: any) => i.group !== 'sources').length
  await expect(rows(page)).toHaveCount(today)
  // keyboard: J moves through every section in order, S saves, E dismisses
  const order = secs.flatMap(s => s.items)
  await rows(page).first().click()
  for (let k = 1; k < Math.min(order.length, 6); k++) {
    await page.keyboard.press('j')
    await expect(page.locator('article h1').first()).toHaveText(order[k])
  }
  await page.keyboard.press('k')
  await expect(page.locator('article h1').first()).toHaveText(order[Math.min(order.length, 6) - 2])
  const cur = order[Math.min(order.length, 6) - 2]
  await page.keyboard.press('s')
  await expect(page.getByText('Saved to your library').first()).toBeVisible()
  await page.keyboard.press('e')
  await expect(rows(page).filter({ hasText: cur })).toHaveCount(0)
  await rw.close()
})

test('UI-TIER-03 with no theses, Your theses invites the first one', async () => {
  const rw = await seeded({ theses: false })
  const page = rw.page
  await nav(page, 'Today')
  const head = page.getByRole('heading', { name: 'Your theses' })
  await expect(head).toBeVisible()
  await expect(page.getByText('Add your first thesis to see evidence for and against it here.')).toBeVisible()
  await page.getByRole('button', { name: 'Add a thesis' }).click()
  await expect(page.locator('main').getByText(/Theses/).first()).toBeVisible()
  await rw.close()
})
