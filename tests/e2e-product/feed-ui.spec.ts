// RFC §3B: UI-FEED-01…04, UI-CAP-01…03 — Today feed, review, views, capture through the UI.
import { test, expect, type Page } from '@playwright/test'
import { launch, until, type RW, reloadApp } from '../harness/app'
import { fixtures } from '../harness/fixtures'

const nav = (page: Page, label: string) => page.locator('aside').getByText(label, { exact: true }).first().click()
const toast = (page: Page, re: RegExp | string) => page.getByText(re).first()
const SW = 'http://signalwire.test:4700/feed.xml'
const LEGAL = 'Legal AI', SUPPORT = 'AI replacing outsourced support labor'
// thesis links must name the part of the thesis they bear on (interpret-4): a one-line description, as a user writes it
const SUPPORT_DESC = 'AI agents take over outsourced support and back-office work such as customer service and insurance claims intake.'
const CALLHAVEN = 'Contact-center buyers hit an automation ceiling, Callhaven says'
const reload = async (rw: RW) => { await reloadApp(rw.page) }

/** Two theses, the Signal Wire feed (all posts) and two Read-once links: 5 items in Today. */
async function seeded(): Promise<RW> {
  await fixtures.reset()
  const rw = await launch()
  await rw.invoke('thesis.create', { title: LEGAL })
  { const t = await rw.invoke('thesis.create', { title: SUPPORT }); await rw.invoke('thesis.update', { id: t.id, patch: { description: SUPPORT_DESC } }) }
  // a new thesis is matched against stored facts (DEC-099): let that finish on the empty library first, so it doesn't
  // race the reading below and move an item between Today's sections from run to run
  await rw.drain(120_000)
  const p = await rw.invoke('source.probe', { locator: SW })
  await rw.invoke('source.create', { locator: SW, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  await rw.invoke('ingress.addUrl', { url: 'http://misc.test:4700/claimwise-interview.html' })
  // Today holds Following, Your theses and Headlines (DEC-096); links the user sends always lead Headlines, so a
  // second one keeps five items in Today now that a below-the-bar feed post lives in All
  await rw.invoke('ingress.addUrl', { url: 'http://misc.test:4700/sourdough.html' })
  await rw.drain(500_000)
  await reload(rw)
  await nav(rw.page, 'Today')
  await expect(rw.page.locator('main [data-item]')).toHaveCount(5)
  return rw
}
const rows = (page: Page) => page.locator('main [data-item]')
const row = (page: Page, title: string | RegExp) => rows(page).filter({ hasText: title }).first()
const heading = (page: Page) => page.locator('article h1').first()
const count = async (page: Page, seg: string) => Number((await page.getByRole('button', { name: new RegExp(`^${seg} \\d+$`) }).textContent())!.replace(/\D/g, ''))
const remaining = async (page: Page) => { const t = await page.locator('main').getByText(/^(\d+ remaining|All caught up)$/).textContent(); return t === 'All caught up' ? 0 : Number(t!.replace(/\D/g, '')) }

test('UI-FEED-01 process the feed', async () => {
  let rw = await seeded()
  const page = rw.page
  const progress = async () => Number((await page.getByRole('progressbar', { name: 'Today progress' }).getAttribute('aria-valuetext'))!.replace('%', ''))
  const r0 = await remaining(page), p0 = await progress()
  expect(r0).toBe(5)
  await rows(page).first().click() // opening an item reads it: remaining ↓, progress ↑
  await expect.poll(() => remaining(page)).toBe(r0 - 1)
  await expect.poll(progress).toBeGreaterThan(p0)
  // J / K
  const t0 = (await heading(page).textContent())!
  await page.keyboard.press('j'); await expect(heading(page)).not.toHaveText(t0)
  const t1 = (await heading(page).textContent())!
  await page.keyboard.press('j'); await page.keyboard.press('k'); await expect(heading(page)).toHaveText(t1)
  // S
  await page.keyboard.press('s')
  await expect(toast(page, 'Saved to your library')).toBeVisible()
  await expect.poll(() => count(page, 'Saved')).toBe(1)
  // E + Undo
  const today0 = await count(page, 'Today')
  await page.keyboard.press('e')
  await expect(toast(page, /^Dismissed “/)).toBeVisible()
  await expect(rows(page)).toHaveCount(4)
  await expect.poll(() => count(page, 'Today')).toBe(today0 - 1)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(rows(page)).toHaveCount(5)
  await expect(row(page, t1)).toBeVisible()
  await expect.poll(() => count(page, 'Today')).toBe(today0)
  // U
  await row(page, t1).click()
  const u0 = await count(page, 'Unread')
  await page.keyboard.press('u'); await expect.poll(() => count(page, 'Unread')).toBe(u0 + 1)
  // I, ↵
  await page.keyboard.press('i'); await expect(page.getByText('Why this matters')).toHaveCount(0)
  await page.keyboard.press('i'); await expect(page.getByText('Why this matters')).toBeVisible()
  await page.keyboard.press('Enter'); await expect(rows(page).first()).toBeHidden()
  await page.keyboard.press('Enter'); await expect(rows(page).first()).toBeVisible()
  // multi-select (⌘-click) → bulk Dismiss
  await rows(page).nth(3).click(); await rows(page).nth(4).click({ modifiers: ['Meta'] })
  await expect(page.locator('main').getByText('2 selected')).toBeVisible()
  await page.locator('main button').filter({ hasText: /^Dismiss$/ }).click()
  await expect(toast(page, '2 items dismissed')).toBeVisible()
  await expect(rows(page)).toHaveCount(3)
  // hover actions: ☆ save, ✎ thought, ✕ dismiss
  const hov = rows(page).filter({ has: page.getByRole('button', { name: '☆', exact: true }) }).first()
  const hovId = await hov.getAttribute('data-item')
  const saved0 = await count(page, 'Saved')
  await hov.hover(); await hov.getByRole('button', { name: '☆', exact: true }).click()
  await expect.poll(() => count(page, 'Saved')).toBe(saved0 + 1)
  await page.mouse.move(5, 5); await rows(page).first().hover(); await rows(page).first().getByRole('button', { name: '✎' }).click()
  await expect(page.getByRole('dialog', { name: 'Add thought' })).toBeVisible(); await page.keyboard.press('Escape')
  // ⋯ menu entries
  const saved = rows(page).and(page.locator(`[data-item="${hovId}"]`))
  await page.mouse.move(5, 5); await saved.hover(); await saved.getByRole('button', { name: '⋯' }).click()
  const menu = page.getByRole('menu')
  for (const l of ['Open', 'Unsave', 'Add thought…', 'Attach to thesis…', 'More like this', 'Less like this', 'Why am I seeing this?', 'Notify me when…', 'Not relevant'])
    await expect(menu.getByRole('menuitem', { name: l, exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^Mark as (un)?read$/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.move(5, 5); await saved.hover(); await saved.getByRole('button', { name: '✕' }).click()
  await expect(rows(page)).toHaveCount(2)
  await expect.poll(() => count(page, 'Today')).toBe(2)
  const snap = { saved: await count(page, 'Saved'), unread: await count(page, 'Unread'), rem: await remaining(page), today: await count(page, 'Today'), progress: await progress(), titles: await rows(page).evaluateAll(els => els.map(e => e.getAttribute('data-item'))) }
  expect(snap.today).toBe(2); expect(snap.progress).toBeGreaterThanOrEqual(60)
  // restart persists
  rw = await rw.restart()
  await nav(rw.page, 'Today')
  await expect(rows(rw.page)).toHaveCount(2)
  expect(await rows(rw.page).evaluateAll(els => els.map(e => e.getAttribute('data-item')))).toEqual(snap.titles)
  expect(await count(rw.page, 'Saved')).toBe(snap.saved)
  expect(await count(rw.page, 'Unread')).toBe(snap.unread)
  expect(await remaining(rw.page)).toBe(snap.rem)
  expect(await count(rw.page, 'Today')).toBe(snap.today)
  expect(Number((await rw.page.getByRole('progressbar', { name: 'Today progress' }).getAttribute('aria-valuetext'))!.replace('%', ''))).toBe(snap.progress)
  await rw.close()
})

test('UI-FEED-02 why and feedback', async () => {
  const rw = await seeded()
  const page = rw.page
  // Why modal lists reasons
  const callhaven = row(page, CALLHAVEN)
  await callhaven.hover(); await callhaven.getByRole('button', { name: '⋯' }).click()
  await page.getByRole('menuitem', { name: 'Why am I seeing this?' }).click()
  const why = page.getByRole('dialog', { name: 'Why you’re seeing this' })
  await expect(why).toContainText(CALLHAVEN)
  await expect(why.getByText(/^✓/)).not.toHaveCount(0)
  await expect(why).toContainText(/subscribed source/)
  await expect(why).toContainText(SUPPORT)
  // More like this
  await page.keyboard.press('Escape')
  await callhaven.hover(); await callhaven.getByRole('button', { name: '⋯' }).click()
  await page.getByRole('menuitem', { name: 'More like this' }).click()
  await expect(toast(page, /^Got it\. More like this from signalwire/)).toBeVisible()
  // Mute this topic (source × thesis) from the Why modal
  await callhaven.hover(); await callhaven.getByRole('button', { name: '⋯' }).click()
  await page.getByRole('menuitem', { name: 'Why am I seeing this?' }).click()
  await why.getByRole('button', { name: 'Mute this topic' }).click()
  await expect(toast(page, `Muted “${SUPPORT}” for items from signalwire`)).toBeVisible()
  // D18's primary thesis is the model's choice between the two theses: mute Signal Wire × Legal AI too (from a Lumen item)
  const lumen = row(page, /Lumen Legal raises/)
  await lumen.hover(); await lumen.getByRole('button', { name: '⋯' }).click()
  await page.getByRole('menuitem', { name: 'Why am I seeing this?' }).click()
  await why.getByRole('button', { name: 'Mute this topic' }).click()
  await expect(toast(page, `Muted “${LEGAL}” for items from signalwire`)).toBeVisible()
  // next ingest (epoch 2 adds D18 "Claimwise partners with Meridian Mutual" to Signal Wire) — Sync now from the UI
  await fixtures.epoch(2)
  await nav(page, 'Sources')
  await page.locator('main').getByText('signalwire', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Sync now' }).click()
  await rw.drain(400_000)
  const d18 = await until(async () => (await rw.inspect('documents')).find((d: any) => /claimwise-meridian/.test(d.url || d.canonical_url || '')) || null, 10_000, 500)
  const fi = (await rw.inspect('feed_items', { document_id: d18.id }))[0]
  const mutedIds = (await rw.inspect('theses')).filter((t: any) => t.title === SUPPORT || t.title === LEGAL).map((t: any) => t.id)
  expect(mutedIds, 'D18 must link to a muted topic for this check to be meaningful').toContain(fi?.primary_thesis_id)
  expect(fi.hidden_reason).toBe('topic_muted')
  await nav(page, 'Today')
  await page.getByRole('button', { name: /^All \d+$/ }).click()
  await expect(rows(page).first()).toBeVisible()
  await expect(page.locator('main').getByText('Claimwise partners with Meridian Mutual')).toHaveCount(0)
  await rw.close()
})

/** Theses only loosely related to the documents, so INTERPRET_DOCUMENT yields mid-confidence (0.5–0.75) primary links
 * — the review queue. Confidence is model output: re-roll the non-review documents (document.retry with a fresh AI
 * generation) until ≥2 review items exist, one of them with a Supporting suggestion. */
async function reviewSetup(): Promise<{ rw: RW; items: any[] }> {
  await fixtures.reset()
  // re-rolls need the model to answer afresh: a replayed answer is the same every time (TestPlan.md)
  const rw = await launch({ liveAi: true })
  for (const t of ['CFO hires signal an upcoming IPO', 'AI coding agents will replace junior developers', 'Insurance claims automation']) await rw.invoke('thesis.create', { title: t })
  // five articles that bear on these theses (claims intake for the insurance one): enough that a live model leaves at
  // least two suggestions for review
  const urls = ['http://signalwire.test:4700/brightdesk-cfo', 'http://stackforge.test:4700/blog/introducing-forge-agents', 'http://signalwire.test:4700/lumen-legal-series-a', 'http://northwind.test:4700/blog/services-are-the-new-software', 'http://misc.test:4700/claimwise-interview.html']
  for (const u of urls) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(600_000)
  // the model's own mid-confidence suggestions first (two re-rolls); a live model that is surer than that leaves the
  // queue short — eight re-rolls still left 1 item in acc-2026-10-08T06-23-27 — so the gap is filled through the test
  // seam (a suggestion at 0.6 on a real read article). What is under test here is the queue's UI, not the model.
  const listReview = async () => { const all = (await rw.invoke('feed.list', { viewSpec: { segment: 'all' } })).items; return { all, review: all.filter((i: any) => i.review && i.suggest) } }
  const enough = (r: any[]) => r.length >= 2 && r.some((i: any) => i.suggest.stance === 'support')
  for (let round = 0; round < 2; round++) {
    const { all, review } = await listReview()
    if (enough(review)) { test.info().annotations.push({ type: 'review', description: `from the model after ${round} re-roll(s)` }); return { rw, items: review } }
    for (const i of all.filter((i: any) => !i.review)) await rw.invoke('document.retry', { id: i.documentId, resetGeneration: true })
    await rw.drain(600_000)
  }
  let { all, review } = await listReview()
  const theses = (await rw.inspect('theses')).map((t: any) => t.id)
  let seeded = 0
  for (const i of all.filter((i: any) => !i.review && i.documentId)) {
    if (enough(review)) break
    const stance = review.some((r: any) => r.suggest.stance === 'support') ? 'contra' : 'support'
    await rw.invoke('test.feed.review', { documentId: i.documentId, thesisId: i.thesis || theses[0], stance })
    seeded++
    review = (await listReview()).review
  }
  test.info().annotations.push({ type: 'review', description: `${review.length - seeded} from the model, ${seeded} seeded` })
  if (!enough(review)) { await rw.close(); throw new Error(`review queue setup: only ${review.length} review item(s)`) }
  return { rw, items: review }
}

test('UI-FEED-03 review queue', async () => {
  test.setTimeout(45 * 60_000)
  const { rw, items } = await reviewSetup()
  const page = rw.page
  await reload(rw)
  await nav(page, 'Today')
  const confirmIt = items.find((i: any) => i.suggest.stance === 'support')
  const rejectIt = items.find((i: any) => i.id !== confirmIt.id)
  const thTitle = async (id: string) => (await rw.inspect('theses', { id }))[0].title
  const confirmTh = await thTitle(confirmIt.suggest.thesis), rejectTh = await thTitle(rejectIt.suggest.thesis)
  await page.getByRole('button', { name: /^Review \d+$/ }).click()
  await expect(rows(page)).toHaveCount(items.length)
  // Confirm
  await row(page, confirmIt.title).click()
  await expect(page.getByText('Suggested connection')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(toast(page, `Attached to ${confirmTh}`)).toBeVisible()
  await expect(row(page, confirmIt.title)).toHaveCount(0)
  // another → Not related
  await row(page, rejectIt.title).click()
  await expect(page.getByText('Suggested connection')).toBeVisible()
  await page.locator('main').getByRole('button', { name: 'Not related', exact: true }).first().click()
  await expect(toast(page, 'Okay. I won’t connect these.')).toBeVisible()
  await expect(row(page, rejectIt.title)).toHaveCount(0)
  expect(await count(page, 'Review')).toBe(items.length - 2)
  // the confirmed thesis' Supporting column gains evidence from the confirmed document
  await nav(page, 'Theses')
  await page.locator('main').getByText(confirmTh, { exact: true }).first().click()
  const ev = (await rw.inspect('relationships', { to_id: confirmIt.suggest.thesis, from_type: 'evidence', status: 'accepted' }))
  expect(ev.length).toBeGreaterThan(0)
  expect(ev.every((r: any) => r.stance === 'support')).toBe(true)
  const claim = (await rw.inspect('evidence', { id: ev[0].from_id }))[0]
  await expect(page.locator('main').getByText(claim.claim.slice(0, 40), { exact: false }).first()).toBeVisible()
  expect(rejectTh).toBeTruthy()
  await rw.close()
})

test('UI-FEED-04 filter, save view, group, customize', async () => {
  let rw = await seeded()
  const page = rw.page
  // Filter ▾ thesis → Save as view → sidebar Views row
  await page.getByRole('button', { name: 'Filter ▾' }).click()
  await page.getByRole('menuitem', { name: LEGAL, exact: true }).click()
  await expect(page.locator('main').getByText(`◆ ${LEGAL}`)).toBeVisible()
  await page.getByRole('button', { name: 'Save as view' }).click()
  await expect(toast(page, `Saved view “${LEGAL}” to the sidebar`)).toBeVisible()
  const views = page.locator('aside').getByText('Views', { exact: true })
  await expect(views).toBeVisible()
  await expect(page.locator('aside').getByText(LEGAL, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filter' }).click()
  // Group ▾ Thesis → headers by thesis
  await page.getByRole('button', { name: /^Group: / }).click()
  await page.getByRole('menuitem', { name: 'Thesis', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Group: Thesis/ })).toBeVisible()
  const headers = () => page.locator('main').getByRole('heading', { level: 3 })
  await expect(headers().first()).toBeVisible()
  expect((await headers().allTextContents()).map(h => h.replace(/[▾▸]|\d+$/g, '').trim()).every(h => [LEGAL, SUPPORT, 'No thesis'].includes(h))).toBe(true)
  // Customize… "Put Legal AI first"
  await page.getByRole('button', { name: /^Group: / }).click()
  await page.getByRole('menuitem', { name: 'Customize…' }).click()
  const cu = page.getByRole('dialog', { name: 'Customize' })
  await cu.getByText('Put Legal AI first', { exact: true }).click()
  await expect(cu.getByLabel('Describe the layout')).toHaveValue('Put Legal AI first')
  await cu.getByRole('button', { name: 'Apply' }).click()
  await expect(toast(page, /^Updated Today/)).toBeVisible({ timeout: 180_000 })
  await expect(headers().first()).toHaveAccessibleName(LEGAL)
  const order = await headers().evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
  expect(order.length).toBeGreaterThanOrEqual(2)
  // order persists across restart
  rw = await rw.restart()
  await nav(rw.page, 'Today')
  await expect(rw.page.getByRole('button', { name: /^Group: Thesis/ })).toBeVisible()
  const h2 = rw.page.locator('main').getByRole('heading', { level: 3 })
  await expect(h2.first()).toHaveAccessibleName(LEGAL)
  expect(await h2.evaluateAll(els => els.map(e => e.getAttribute('aria-label')))).toEqual(order)
  await expect(rw.page.locator('aside').getByText(LEGAL, { exact: true })).toBeVisible()
  await rw.close()
})

const QUILL_TEXT = 'Quillmate charges law firms an annual platform fee, according to two buyers who asked not to be named. The company also said it will open a London office next year to serve UK firms, and that it now counts eleven of the AmLaw 100 as customers.'

test('UI-CAP-01 read once: link and pasted text', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page
  const readOnce = async (q: string) => {
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByRole('menuitem', { name: 'Add link to read' }).click()
    await page.getByLabel('Source or link').fill(q)
    await expect(page.getByRole('button', { name: 'Read now' })).toBeEnabled({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Read now' }).click()
    await expect(toast(page, 'Added to Today as a one-time read')).toBeVisible({ timeout: 60_000 })
  }
  await readOnce('http://signalwire.test:4700/brightdesk-cfo')
  await readOnce(QUILL_TEXT)
  await rw.drain(400_000)
  await nav(page, 'Saved'); await nav(page, 'Today')
  await expect(rows(page)).toHaveCount(2)
  await expect(row(page, 'Brightdesk hires Tomas Berg as CFO')).toContainText('Added by you')
  await expect(rows(page).filter({ hasText: /Quillmate/ }).first()).toContainText('Added by you')
  await nav(page, 'Sources')
  await page.locator('main').getByText('On-demand history', { exact: true }).click()
  await expect(page.locator('main').getByText('Brightdesk hires Tomas Berg as CFO').first()).toBeVisible()
  await expect(page.locator('main').getByText(/Quillmate/).first()).toBeVisible()
  await rw.close()
})

test('UI-CAP-02 thought sheet', async () => {
  await fixtures.reset()
  const rw = await launch()
  await rw.invoke('thesis.create', { title: LEGAL })
  { const t = await rw.invoke('thesis.create', { title: SUPPORT }); await rw.invoke('thesis.update', { id: t.id, patch: { description: SUPPORT_DESC } }) }
  const page = rw.page
  await reload(rw)
  const TEXT = 'Legal buyers seem to run two contract-review vendors side by side before choosing one.'
  await page.keyboard.press('n')
  const sheet = page.getByRole('dialog', { name: 'Add thought' })
  await sheet.getByPlaceholder('What are you thinking?').fill(TEXT)
  // suggestion block: thesis, type, companies
  await expect(sheet.getByText('Suggested from what you wrote. Change anything, or just save.')).toBeVisible()
  const thesisChip = sheet.getByRole('button', { name: /^Thesis: / })
  await expect(thesisChip).toHaveAccessibleName(`Thesis: ${LEGAL}`, { timeout: 60_000 })
  await expect(sheet.getByRole('button', { name: 'Personal observation' })).toBeVisible()
  // change thesis → the support-labor thesis
  await thesisChip.click()
  await page.getByRole('menuitem', { name: SUPPORT, exact: true }).click()
  await expect(thesisChip).toHaveAccessibleName(`Thesis: ${SUPPORT}`)
  await page.keyboard.press('Meta+Enter')
  await expect(sheet).toHaveCount(0)
  await expect(toast(page, `Thought added to ${SUPPORT}`)).toBeVisible()
  await page.getByRole('button', { name: 'Open thesis' }).click()
  await expect(page.locator('main').getByText('Your thoughts', { exact: true })).toBeVisible()
  await expect(page.locator('main').getByText(TEXT, { exact: true })).toBeVisible()
  await rw.drain(120_000)
  await rw.close()
})

test('UI-CAP-03 highlight → evidence, attach to company', async () => {
  await fixtures.reset()
  const rw = await launch()
  await rw.invoke('ingress.addUrl', { url: 'http://signalwire.test:4700/lumen-legal-series-a' })
  await rw.drain(300_000)
  const page = rw.page
  await reload(rw)
  await nav(page, 'Today')
  await row(page, 'Lumen Legal raises $18M Series A led by Northwind Ventures').click()
  const article = page.locator('article')
  // select a paragraph (triple-click) → ★ Save as evidence → highlighted in the reader
  const p1 = article.locator('p').filter({ hasText: 'Beacon Hill Partners also participated in the round.' })
  await p1.click({ clickCount: 3 })
  await page.getByRole('button', { name: '★ Save as evidence' }).click()
  await expect(toast(page, /^Saved as evidence/)).toBeVisible()
  await expect(p1.locator('span').filter({ hasText: 'Beacon Hill Partners also participated in the round.' })).toHaveCSS('background-color', 'rgba(255, 205, 90, 0.2)')
  // select another passage → Attach to company… → Lumen Legal
  const P2 = 'Lumen Legal chief executive Dana Okafor said the company will use the funding to expand into insurance contracts.'
  const p2 = article.locator('p').filter({ hasText: P2 })
  await p2.click({ clickCount: 3 })
  await page.getByRole('button', { name: 'Attach to company…' }).click()
  await page.getByRole('menuitem', { name: 'Lumen Legal', exact: true }).click()
  await expect(toast(page, 'Saved as evidence on Lumen Legal')).toBeVisible()
  await expect(p2.locator('span').filter({ hasText: P2 })).toHaveCSS('background-color', 'rgba(255, 205, 90, 0.2)')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.locator('main').getByText(/^Evidence \d+$/).click()
  await expect(page.locator('main').getByText(P2).first()).toBeVisible()
  await rw.close()
})
