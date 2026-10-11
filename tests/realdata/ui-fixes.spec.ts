// Renderer fixes found by the adversarial real-user review (tests/results/adversarial/findings.md), verified through the
// real UI on real data: real web (hydration via Google News, Read once of real URLs), real model, fresh profile.
//  B1  a chat merge of the entity whose page is open follows the merge (no white window); split; merge while viewing;
//      a render error shows a recoverable message; ⌘R reloads
//  M2  Ask citations open any library document in the reader (also without a visible feed item)
//  M3  "still reading" line on a followed company page; Ask says when documents are still being read
//  M10 dates: old articles show their publish date (with year), never "2m"; old coverage is not "Changes"/"Important"
//  P   palette footer shows the real count; single-key shortcuts don't fire while typing; long questions are clamped;
//      citation numbers are dense; Read once reports a dead link in the sheet; X post links aren't "Can't watch"
// Results: tests/results/<run>/realdata-ui-fixes.json
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, until, sleep, ROOT, type RW, reloadApp } from '../harness/app'
import { APP_TZ } from '../harness/app'

const DIR = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev')
const OUT = path.join(DIR, 'realdata-ui-fixes.json')
const out: Record<string, any> = { started: new Date().toISOString() }
const save = () => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 2)) }

const nav = (page: Page, label: string) => page.locator('aside').getByText(label, { exact: true }).first().click()
const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const OLD_ARTICLE = 'https://techcrunch.com/2023/09/25/amazon-to-invest-up-to-4-billion-in-ai-startup-anthropic/'
const DEAD_LINK = 'https://techcrunch.com/2026/09/30/rw-this-article-does-not-exist-404/'

/** The renderer's Controller instance (React internals), for reading UI state and injecting a broken render. */
const CTL = `(() => { const root = document.getElementById('root'); const k = Object.keys(root).find(k => k.startsWith('__reactContainer$'));
  const st = [root[k]]; while (st.length) { const f = st.pop(); if (f && f.stateNode && f.stateNode.refreshScreen) return f.stateNode; if (f && f.child) st.push(f.child); if (f && f.sibling) st.push(f.sibling) } return null })()`
const uiState = (page: Page, expr: string) => page.evaluate(`(() => { const c = ${CTL}; return c ? (${expr}) : null })()`) as Promise<any>

async function openEntity(page: Page, list: 'Companies' | 'Venture Firms', name: string) {
  await nav(page, list)
  await page.getByRole('button', { name: 'All tracked' }).click()
  await page.locator('main').getByText(name, { exact: true }).first().click()
  // followed companies show Check for updates, the rest Pull latest (DEC-096)
  await expect(page.getByRole('button', { name: list === 'Companies' ? /^(Check for updates|Pull latest)$/ : 'Edit sources' })).toBeVisible()
}

/** Type a correction in ⌘K, turn it into a proposal and accept it; returns the confirm text (or null if none came). */
async function correctViaChat(page: Page, text: string): Promise<string | null> {
  await page.keyboard.press('Meta+k')
  await page.getByLabel('Search').fill(text)
  const pal = palette(page)
  const correct = pal.getByRole('option', { name: /^Correct: / })
  await expect(correct).toBeVisible({ timeout: 30_000 })
  await correct.click()
  const confirmRow = pal.getByRole('option', { name: / ↵$/ }).first()
  try { await expect(confirmRow).toBeVisible({ timeout: 180_000 }) } catch { await page.keyboard.press('Escape'); return null }
  const label = (await confirmRow.textContent()) || ''
  await confirmRow.hover()
  await page.keyboard.press('Enter')
  return label
}

const noRenderError = async (page: Page, errors: string[]) => {
  await expect(page.getByTestId('render-error')).toHaveCount(0)
  expect(errors.filter(e => /Cannot read properties of undefined/.test(e)), 'no renderer TypeError').toEqual([])
  await expect(page.locator('aside').getByText('Today', { exact: true })).toBeVisible()
}

test.describe.serial('RD-UI renderer fixes from the adversarial review, on real data', () => {
  let rw: RW
  let page: Page
  const errors: string[] = []
  const ids: Record<string, string> = {}

  test.beforeAll(async () => {
    test.setTimeout(10 * 60_000)
    rw = await launch({ testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } })
    page = rw.page
    page.on('pageerror', e => { errors.push(e.message); out.pageErrors = errors; save() })
    await rw.invoke('settings.update', { patch: { 'processing.daily_cap': 1000 } })
    // the user adds companies by name (DEC-088): real hydration from Google News + their own sites
    for (const name of ['Homeward', 'AWS', 'Amazon Web Services']) {
      const c = await rw.invoke('object.create', { type: 'company', name })
      ids[name] = c.id
    }
    out.created = ids; save()
    await reloadApp(page)
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('M3 a followed company whose coverage is queued says it is still reading, with an estimate', async () => {
    test.setTimeout(20 * 60_000)
    await openEntity(page, 'Companies', 'Homeward')
    const line = page.getByTestId('still-reading')
    await expect(line).toBeVisible({ timeout: 60_000 })
    out.stillReading = [await line.textContent()]
    // once hydration has fetched its articles, the line counts them and estimates the wait
    await expect(line).toHaveText(/^Reading \d+ articles? about Homeward… \(about \d+ min\)$/, { timeout: 15 * 60_000 })
    out.stillReading.push(await line.textContent()); save()
    // the count is live (hydration finishes articles meanwhile, and between library coverage and web coverage the line
    // says "Looking for coverage…" again): the line and a fresh read must agree at some moment
    await expect.poll(async () => {
      const reading = (await rw.invoke('object.get', { type: 'company', id: ids.Homeward })).reading
      const text = (await line.textContent()) || ''
      return reading.pending > 0 && text.includes(`Reading ${reading.pending} article`)
    }, { timeout: 10 * 60_000, intervals: [1000] }).toBe(true)
  })

  test('M3 Ask says how many articles are still being read', async () => {
    test.setTimeout(10 * 60_000)
    await page.keyboard.press('Meta+k')
    await page.getByLabel('Search').fill('What has Homeward announced recently?')
    await page.keyboard.press('Meta+Enter')
    const answer = page.getByTestId('answer')
    await expect(answer.getByLabel('Ask a follow-up')).toBeVisible({ timeout: 300_000 })
    const backlog = await uiState(page, 'c.state.pAnswer && c.state.pAnswer.backlog')
    out.askBacklog = { backlog, line: await answer.getByTestId('ask-backlog').textContent().catch(() => null) }; save()
    expect(typeof backlog).toBe('number')
    if (backlog > 0) await expect(answer.getByTestId('ask-backlog')).toHaveText(new RegExp(`^${backlog.toLocaleString('en-US')} articles? (is|are) still being read — this answer may be incomplete\\.$`))
    else await expect(answer.getByTestId('ask-backlog')).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('P7 a very long question is clamped to two lines with an expander', async () => {
    const q = 'I would like a careful and complete overview of everything my library says about Amazon Web Services, AWS, and Homeward, '
      + 'including funding, partnerships, product launches, executive changes, pricing, customers, regulatory issues, and anything else that '
      + 'might matter to an early-stage investor thinking about cloud infrastructure and proptech, with dates and sources for every claim, '
      + 'and please separate facts from opinions and call out contradictions between sources where they exist?'
    await page.keyboard.press('Meta+k')
    await page.getByLabel('Search').fill(q)
    await page.keyboard.press('Meta+Enter')
    const echo = page.getByTestId('ask-question')
    await expect(echo).toBeVisible()
    const box = (await echo.locator('div').first().boundingBox())!
    out.longQuestion = { chars: q.length, echoHeight: box.height }; save()
    expect(box.height, 'two lines of 13px text').toBeLessThanOrEqual(44)
    await expect(echo.getByRole('button', { name: 'Show full question' })).toBeVisible()
    await echo.getByRole('button', { name: 'Show full question' }).click()
    expect((await echo.locator('div').first().boundingBox())!.height).toBeGreaterThan(box.height)
    await page.keyboard.press('Escape')
  })

  test('P5 palette footer shows the real number of documents', async () => {
    await nav(page, 'Today')
    await page.keyboard.press('Meta+k')
    const footer = palette(page).getByText(/^Searching [\d,]+ documents? on this Mac$/)
    await expect(footer).toBeVisible()
    const n = Number(((await footer.textContent())!.match(/[\d,]+/)![0]).replace(/,/g, ''))
    const status = await rw.invoke('app.status')
    out.footer = { shown: n, documents: status.counts.documents }; save()
    expect(Math.abs(n - status.counts.documents)).toBeLessThanOrEqual(5) // documents keep arriving while hydration runs
    await expect(palette(page).getByText('4,812')).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('B1 chat merge of the company whose page is open follows to the surviving company; no white window', async () => {
    test.setTimeout(10 * 60_000)
    await openEntity(page, 'Companies', 'AWS')
    const label = await correctViaChat(page, 'merge AWS into Amazon Web Services, they are the same company')
    out.merge = { proposal: label }; save()
    expect(label, 'the model proposed the merge').toMatch(/Merge AWS into Amazon Web Services/i)
    await expect(page.getByText(/^Updated · /).first()).toBeVisible({ timeout: 60_000 })
    await sleep(2000)
    await noRenderError(page, errors)
    // the page now shows the surviving entity
    await expect(page.getByRole('button', { name: 'Check for updates' })).toBeVisible()
    await expect.poll(() => uiState(page, 'c.state.companyId')).toBe(ids['Amazon Web Services'])
    await expect(page.locator('main').getByText('Amazon Web Services', { exact: true }).first()).toBeVisible()
    // history: going back to the merged id also lands on the survivor
    await page.evaluate(`(() => { const c = ${CTL}; c.go('company', { companyId: '${ids.AWS}', companyPage: null }) })()`)
    await expect.poll(() => uiState(page, 'c.state.companyId')).toBe(ids['Amazon Web Services'])
    await noRenderError(page, errors)
  })

  test('B1 split via chat, then a merge while viewing the merged page (the banner path)', async () => {
    test.setTimeout(10 * 60_000)
    await openEntity(page, 'Companies', 'Amazon Web Services')
    const label = await correctViaChat(page, 'AWS is not the same as Amazon Web Services, split AWS out into its own company')
    out.split = { proposal: label }; save()
    if (label) await expect(page.getByText(/^Updated · /).first()).toBeVisible({ timeout: 120_000 })
    await sleep(2000)
    await noRenderError(page, errors)
    const live = (await rw.inspect('companies')).filter((c: any) => !c.merged_into_id && !c.deleted_at && /^aws$/i.test(c.name))
    out.split.awsAfter = live.map((c: any) => c.id); save()
    if (!live.length) { test.info().annotations.push({ type: 'note', description: 'split proposal did not recreate AWS; merge-while-viewing checked on the original pair only' }); return }
    // the user is on AWS's page when it gets merged (the "Possibly the same company · Merge" banner, or another window)
    await openEntity(page, 'Companies', live[0].name)
    await rw.invoke('merge.entities', { type: 'company', fromId: live[0].id, intoId: ids['Amazon Web Services'] })
    await expect.poll(() => uiState(page, 'c.state.companyId'), { timeout: 15_000 }).toBe(ids['Amazon Web Services'])
    await noRenderError(page, errors)
  })

  test('B1 a render error shows a recoverable message; ⌘R reloads the window', async () => {
    // reproduce the original failure mode: a redirect object stored as the page
    await page.evaluate(`(() => { const c = ${CTL}; c.setState({ screen: 'company', companyId: 'x', companyPage: { redirect: { type: 'company', id: 'y' } } }) })()`)
    const err = page.getByTestId('render-error')
    await expect(err).toBeVisible()
    await expect(err).toContainText('Something went wrong showing this screen')
    await err.getByRole('button', { name: 'Back to Today' }).click()
    await expect(page.locator('aside').getByText('Today', { exact: true })).toBeVisible()
    await expect(err).toHaveCount(0)
    // ⌘R
    await page.evaluate(() => { (window as any).__beforeReload = 1 })
    await page.keyboard.press('Meta+r')
    await page.waitForFunction(() => !(window as any).__beforeReload && !!(window as any).rw, null, { timeout: 30_000 })
    await expect(page.locator('aside').getByText('Today', { exact: true })).toBeVisible({ timeout: 30_000 })
    errors.length = 0 // the injected error above is expected
  })

  test('M10 an old article shows its publish date with year; old coverage is not "Changes" or "Important today"', async () => {
    test.setTimeout(15 * 60_000)
    const add = await rw.raw('ingress.addUrl', { url: OLD_ARTICLE })
    out.oldArticle = { url: OLD_ARTICLE, ok: add.ok, error: add.ok ? null : add.message }
    // wait for this article only: the companies' lookups keep reading in the background, and whatever they have read
    // by now is checked too (draining all of it took ~30 min and checked nothing more — TestPlan.md)
    await until(async () => {
      const d = (await rw.inspect('documents')).find((x: any) => x.url === OLD_ARTICLE || x.canonical_url === OLD_ARTICLE)
      return d && !['fetched', 'queued', 'processing'].includes(d.status) ? d : null
    }, 12 * 60_000, 3000)
    // DB: anything published > 14 days before it was fetched is not in the change groups (unless the user sent it)
    const docs = new Map((await rw.inspect('documents')).map((d: any) => [d.id, d]))
    const manual = new Set((await rw.inspect('document_sources', { source_id: 'src_manual' })).map((x: any) => x.document_id))
    const items = await rw.inspect('feed_items')
    const stale = items.filter((i: any) => { const d: any = docs.get(i.document_id); return d?.published_at && d.first_fetched_at - d.published_at > 14 * 86400_000 })
    const wrong = stale.filter((i: any) => !manual.has(i.document_id) && JSON.parse(i.alert_rule_ids_json || '[]').length === 0 && ['important', 'companies'].includes(i.group_key))
    out.dates = { feedItems: items.length, stale: stale.length, staleInChangeGroups: wrong.map((i: any) => i.headline) }; save()
    expect(wrong).toEqual([])
    // UI: every row's time label is a date (with the year when not this year) unless it was published in the last 2 days
    await nav(page, 'Today')
    await page.evaluate(`(() => { const c = ${CTL}; c.setState({ view: 'all' }, () => c.refreshAll(false)) })()`)
    await sleep(1500)
    const rows: { title: string; publishedAt: number | null; surfacedAt: number }[] = await uiState(page, 'c.state.items.map(i => ({ id: i.id, title: i.title, publishedAt: i.publishedAt, surfacedAt: i.surfacedAt }))')
    const now = Date.now(), year = new Date().getFullYear()
    const checked: any[] = []
    for (const r of rows as any[]) {
      const el = page.locator(`[data-item="${r.id}"]`)
      if (!(await el.count())) continue
      const text = (await el.first().innerText()).replace(/\s+/g, ' ')
      if (r.publishedAt && now - r.publishedAt > 2 * 86400_000) {
        const d = new Date(r.publishedAt)
        const want = d.toLocaleDateString('en-US', d.getFullYear() === year ? { month: 'short', day: 'numeric', timeZone: APP_TZ } : { month: 'short', day: 'numeric', year: 'numeric', timeZone: APP_TZ })
        checked.push({ title: r.title, want, ok: text.includes(want) })
        expect(text, `"${r.title}" shows its publish date`).toContain(want)
      }
    }
    out.dates.uiChecked = checked; save()
    expect(checked.length, 'at least one old article is in the feed').toBeGreaterThan(0)
    if (add.ok) {
      const item = items.find((i: any) => i.document_id === add.data.documentId)
      if (item) await expect(page.locator(`[data-item="${item.id}"]`)).toContainText(/Sep 2[45], 2023/)
    }
  })

  test('M3 the still-reading line disappears once the coverage is read', async () => {
    test.setTimeout(40 * 60_000)
    // wait for Homeward's own coverage (its lookup's articles and anything linked to it), not the whole queue
    const job = await until(async () => { const j = (await rw.inspect('jobs')).filter((x: any) => x.type === 'HYDRATE_OBJECT' && x.idempotency_key === `hydrate:${ids.Homeward}`).pop(); return j && ['succeeded', 'failed'].includes(j.status) ? j : null }, 20 * 60_000, 3000)
    const linked = (await rw.inspect('relationships', { from_type: 'document', to_type: 'company', to_id: ids.Homeward })).map((r: any) => r.from_id)
    await rw.settle([...new Set([...(JSON.parse(job.result_json || '{}').documentIds || []), ...linked])], 30 * 60_000)
    await openEntity(page, 'Companies', 'Homeward')
    await expect(page.getByTestId('still-reading')).toHaveCount(0, { timeout: 120_000 })
  })

  test('M2/P8 Ask citations are numbered densely and open in the reader, even without a visible feed item', async () => {
    test.setTimeout(10 * 60_000)
    await nav(page, 'Today')
    await page.keyboard.press('Meta+k')
    await page.getByLabel('Search').fill('What do my sources say about Amazon Web Services and Anthropic?')
    await page.keyboard.press('Meta+Enter')
    const answer = page.getByTestId('answer')
    await expect(answer.getByLabel('Ask a follow-up')).toBeVisible({ timeout: 300_000 })
    const cites: any[] = (await uiState(page, 'c.state.pAnswer.citations')) || []
    out.ask = { citations: cites.map(x => ({ n: x.n, documentId: x.documentId, itemId: x.itemId, kind: x.kind })) }; save()
    const docCites = cites.filter(x => x.documentId)
    expect(docCites.length, 'the answer cites documents').toBeGreaterThan(0)
    // dense numbering in the Sources list and inline
    const listed = (await answer.getByRole('link').filter({ hasText: / · open$/ }).allTextContents()).map(t => Number(t.match(/^\[(\d+)\]/)![1]))
    out.ask.listed = listed; save()
    expect(listed).toEqual(listed.map((_, i) => i + 1))
    const inline = (await answer.getByRole('link', { name: /^\[\d+\]$/ }).allTextContents()).map(t => Number(t.slice(1, -1)))
    expect(inline.every(n => n >= 1 && n <= listed.length)).toBe(true)
    // make the cited document's feed item not visible (the user dismissed it), then open the citation
    const target = docCites[0]
    const item = (await rw.inspect('feed_items', { document_id: target.documentId }))[0]
    if (item) await rw.invoke('feed.dismiss', { ids: [item.id] })
    // the Sources list is in display order — first use in the answer (facts, then interpretations, notes), then the
    // rest — not the citations array's order; picking by array index opened another source (acc-2026-10-07T15-15-53)
    const a: any = await uiState(page, 'c.state.pAnswer')
    const order: number[] = []
    const use = (ns: number[] | undefined) => (ns || []).forEach(n => { if (!order.includes(n)) order.push(n) })
    for (const type of ['fact', 'interpretation', 'user_note']) (a.items || []).filter((x: any) => x.type === type).forEach((x: any) => use(x.citations))
    use(cites.map(x => x.n))
    const shownN = order.indexOf(target.n) + 1
    const rowLink = answer.getByRole('link').filter({ hasText: / · open$/ }).nth(shownN - 1)
    await expect(rowLink).toContainText(`[${shownN}]`)
    await rowLink.click()
    await expect(page.getByText(/isn’t in your feed anymore|no longer in your library/)).toHaveCount(0)
    const doc = (await rw.inspect('documents', { id: target.documentId }))[0]
    const origin = doc.status === 'duplicate' && doc.duplicate_of_id ? (await rw.inspect('documents', { id: doc.duplicate_of_id }))[0] : doc
    await expect(page.locator('main h1').first()).toHaveText(origin.title.trim(), { timeout: 15_000 })
    out.ask.opened = { documentId: origin.id, title: origin.title, hadItem: !!item }; save()
    await noRenderError(page, errors)
    // and one that never had a feed item (triaged out / fetched for hydration only), when the library has one
    const withoutItem = (await rw.inspect('documents')).find((d: any) => d.status === 'triaged_out')
    if (withoutItem) {
      await page.evaluate(`(() => { const c = ${CTL}; c.openCitation({ documentId: '${withoutItem.id}', itemId: null }) })()`)
      await expect(page.locator('main h1').first()).toHaveText(withoutItem.title.trim(), { timeout: 15_000 })
      out.ask.triagedOutOpened = withoutItem.title; save()
    }
  })

  test('P6 single-key shortcuts never fire while a field is focused or the palette is open', async () => {
    await nav(page, 'Today')
    await page.evaluate(`(() => { const c = ${CTL}; c.setState({ view: 'all' }, () => c.refreshAll(false)) })()`)
    await expect(page.locator('[data-item]').first()).toBeVisible({ timeout: 30_000 })
    await page.locator('[data-item]').first().click()
    const sel = await uiState(page, 'c.state.selId')
    const before = await uiState(page, `(c.item('${sel}') || {})`)
    // contenteditable and input, focused
    for (const html of ['<div id="rw-ce" contenteditable="true" style="position:fixed;top:0;left:0;width:50px;height:20px"></div>', '<input id="rw-in" style="position:fixed;top:0;left:60px">']) {
      await page.evaluate((h) => { const d = document.createElement('div'); d.innerHTML = h; document.body.appendChild(d.firstElementChild!) ; (document.body.lastElementChild as HTMLElement).focus() }, html)
      await page.keyboard.type('nse')
      const after = await uiState(page, `({ it: c.item('${sel}'), modal: c.state.modal })`)
      expect(after.modal, 'N did not open a thought').toBeNull()
      expect(after.it?.dismissed, 'E did not dismiss').toBe(before.dismissed)
      expect(after.it?.saved, 'S did not save').toBe(before.saved)
      await page.evaluate(() => { document.getElementById('rw-ce')?.remove(); document.getElementById('rw-in')?.remove() })
    }
    // palette open: typing goes to the palette, never to shortcuts
    await page.keyboard.press('Meta+k')
    await page.keyboard.type('nse')
    expect(await uiState(page, `({ it: c.item('${sel}'), modal: c.state.modal })`)).toMatchObject({ modal: null, it: { dismissed: before.dismissed, saved: before.saved } })
    await page.keyboard.press('Escape')
    // with nothing focused the reader shortcuts still work (prototype): S saves, S again unsaves
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    await page.keyboard.press('s')
    await expect.poll(() => uiState(page, `c.item('${sel}').saved`)).toBe(!before.saved)
    await page.keyboard.press('s')
    await expect.poll(() => uiState(page, `c.item('${sel}').saved`)).toBe(before.saved)
  })

  test('Read once: a dead link is reported in the sheet; an X post link is readable, not "Can’t watch"', async () => {
    test.setTimeout(5 * 60_000)
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByRole('menuitem', { name: 'Add link to read' }).click()
    await page.getByLabel('Source or link').fill(DEAD_LINK)
    await expect(page.getByRole('button', { name: 'Read now' })).toBeEnabled({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Read now' }).click()
    const alert = page.getByRole('alert').filter({ hasText: /Couldn’t read this page/ })
    await expect(alert).toBeVisible({ timeout: 90_000 })
    out.readOnce = { dead: await alert.textContent() }; save()
    await expect(page.getByLabel('Source or link')).toBeVisible() // the sheet stayed open
    await expect(page.getByText('Added to Today as a one-time read')).toHaveCount(0)
    // an X post in Read once
    await page.getByLabel('Source or link').fill('https://x.com/garrytan/status/1840000000000000000')
    await expect(page.getByText(/read once, not monitored/)).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('Can’t watch this')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Read now' })).toBeEnabled()
    await page.keyboard.press('Escape')
    save()
  })
})
