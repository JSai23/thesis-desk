// RFC §3B: UI-REP-01/02, UI-AL-01, UI-VIEW-02 — reports, alerts and firm/thesis customization through the UI.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, installEmail, until, type RW, reloadApp } from '../harness/app'
import { fixtures } from '../harness/fixtures'
import { imapHasSubject } from '../harness/imap'

const nav = (page: Page, label: string) => page.locator('aside').getByText(label, { exact: true }).first().click()
const toast = (page: Page, re: RegExp | string) => page.getByText(re).first()
const reload = async (rw: RW) => { await reloadApp(rw.page) }
const LEGAL = 'Legal AI', SUPPORT = 'AI replacing outsourced support labor'

async function base(): Promise<RW> {
  await fixtures.reset()
  const rw = await launch()
  await rw.invoke('thesis.create', { title: LEGAL })
  await rw.invoke('thesis.create', { title: SUPPORT })
  for (const u of ['http://signalwire.test:4700/lumen-legal-series-a', 'http://northwind.test:4700/blog/our-investment-in-lumen-legal', 'http://signalwire.test:4700/callhaven-ceiling', 'http://signalwire.test:4700/brightdesk-cfo'])
    await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(500_000)
  await reload(rw)
  return rw
}
/** Section titles of the report preview card (the uppercase headers above "Nothing new." / rows). */
const reportRow = (page: Page, name: string) => page.locator('main').getByText(name, { exact: true }).first()

test('UI-REP-01 create, refine, run, export, email', async () => {
  const rw = await base()
  await installEmail(rw)
  const page = rw.page
  await nav(page, 'Reports')
  await page.getByPlaceholder(/Describe a report/).fill('Every weekday at 7:30 email me new deals in legal AI and evidence against my support-labor thesis')
  await page.getByRole('button', { name: 'Create report' }).click()
  await expect(toast(page, /^Report created/)).toBeVisible({ timeout: 240_000 })
  const rep = await until(async () => (await rw.invoke('report.list', {})).find((r: any) => !r.templateKey && r.status === 'active') || null, 60_000, 500)
  // the new report is selected; its preview card shows its name and schedule
  const meta = page.locator('main').getByText(/ · last run /)
  await expect(page.locator('main').getByText(rep.name, { exact: true }).nth(1)).toBeVisible()
  // DEC-100: "email me" puts it in a briefing that takes the schedule; the report itself is read in the app
  await expect(meta).toContainText(/Emailed in “/)
  await expect(page.getByTestId('briefings')).toContainText(/Weekdays 7:30/)
  const refine = page.getByLabel('Refine this report')
  // refine 1: schedule
  await expect(refine).toBeEnabled({ timeout: 120_000 })
  await refine.fill('Make it weekly on Mondays'); await refine.press('Enter')
  await expect(toast(page, /^Updated · /)).toBeVisible({ timeout: 240_000 })
  await expect(meta).toContainText(/Mondays/, { timeout: 30_000 })
  // refine 2: new section → preview gains it
  const sectionsBefore = (await rw.invoke('report.list', {})).find((r: any) => r.id === rep.id).definition.sections.length
  await expect(refine).toBeEnabled({ timeout: 120_000 })
  await refine.fill('Also add a section with people moves this week'); await refine.press('Enter')
  await expect(toast(page, /^Updated · /)).toBeVisible({ timeout: 240_000 })
  const def = await until(async () => { const d = (await rw.invoke('report.list', {})).find((r: any) => r.id === rep.id).definition; return d.sections.length > sectionsBefore ? d : null }, 60_000, 500)
  expect(def.schedule).toMatchObject({ kind: 'weekly', weekday: 1 })
  const newTitle = def.sections[def.sections.length - 1].title
  // the preview is the run's rendered HTML in a sandboxed frame (DEC-093)
  await expect(page.frameLocator('[data-testid="report-view"]').getByText(newTitle, { exact: true }).first()).toBeVisible({ timeout: 180_000 }) // the preview waits behind other AI work
  // Run now → Runs ▾ lists the run
  const runName = (await rw.invoke('report.list', {})).find((r: any) => r.id === rep.id).name
  const note = page.getByRole('status', { name: 'Notification' })
  await page.getByRole('button', { name: 'Run now' }).click()
  await expect(note).toHaveText(new RegExp(`^(Running ${runName} on this Mac…|${runName} is ready)`), { timeout: 240_000 })
  await rw.drain(300_000)
  await expect(meta).not.toContainText('last run never', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Runs' }).click()
  const runs = page.getByRole('menu')
  await expect(runs.getByText('Past runs')).toBeVisible()
  await expect(runs.getByRole('menuitem')).not.toHaveCount(0)
  await expect(runs.getByRole('menuitem', { name: 'No runs yet' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  // Export Markdown / PDF → files saved
  const dl = path.join(os.homedir(), 'Downloads')
  for (const fmt of ['Markdown', 'PDF']) {
    await page.getByRole('button', { name: 'Export ▾' }).click()
    await page.getByRole('menuitem', { name: fmt, exact: true }).click()
    const t = toast(page, new RegExp(`^Exported .* as ${fmt} to `))
    await expect(t).toBeVisible({ timeout: 60_000 })
    const f = (await t.textContent())!.replace(/^.* to /, '').replace(/^~/, os.homedir())
    expect(f.startsWith(dl)).toBe(true)
    expect(fs.existsSync(f)).toBe(true); expect(fs.statSync(f).size).toBeGreaterThan(200)
    if (fmt === 'Markdown') expect(fs.readFileSync(f, 'utf8')).toContain(newTitle)
    fs.rmSync(f, { force: true })
  }
  // Send by email → received
  const t0 = new Date()
  const name = (await rw.invoke('report.list', {})).find((r: any) => r.id === rep.id).name
  await page.getByRole('button', { name: 'Export ▾' }).click()
  await page.getByRole('menuitem', { name: 'Send by email', exact: true }).click()
  await expect(toast(page, `Sending ${name} to your email`)).toBeVisible()
  await rw.drain(120_000)
  await until(async () => (await imapHasSubject(name, t0)) || null, 180_000, 5000)
  await rw.close()
})

test('UI-REP-02 templates, toggles, rename, delete + undo', async () => {
  await fixtures.reset()
  let rw = await launch()
  const page = rw.page
  await nav(page, 'Reports')
  const sw = (name: string) => page.locator('main').getByRole('switch', { name: `Enabled ${name}` })
  // enable the Daily Brief template (ships off)
  await expect(sw('Daily Brief')).toHaveAttribute('aria-checked', 'false')
  await sw('Daily Brief').click()
  await expect(toast(page, 'Resumed Daily Brief')).toBeVisible()
  await expect(sw('Daily Brief')).toHaveAttribute('aria-checked', 'true')
  // rename (right-click → Rename…)
  // (M6 report-row context menu is not wired in the UI — reported; soft so the toggle persistence is still checked)
  const ev = 'Evidence against my theses'
  await reportRow(page, 'Daily Brief').click({ button: 'right' })
  const hasMenu = await page.getByRole('menuitem', { name: 'Rename…' }).isVisible({ timeout: 3000 }).catch(() => false)
  expect.soft(hasMenu, 'right-click on a report row opens Rename… / Delete').toBe(true)
  let renamed = 'Daily Brief'
  if (hasMenu) {
    await page.getByRole('menuitem', { name: 'Rename…' }).click()
    const dlg = page.getByRole('dialog', { name: 'Rename report' })
    await dlg.getByLabel('Report name').fill('Morning brief'); await dlg.getByLabel('Report name').press('Enter')
    await expect(dlg).toHaveCount(0)
    await expect(reportRow(page, 'Morning brief')).toBeVisible()
    renamed = 'Morning brief'
    // delete + Undo
    await reportRow(page, ev).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(toast(page, `Deleted ${ev}`)).toBeVisible()
    await expect(page.locator('main').getByText(ev, { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(reportRow(page, ev)).toBeVisible()
  }
  // persisted
  rw = await rw.restart()
  await nav(rw.page, 'Reports')
  await expect.soft(reportRow(rw.page, 'Morning brief')).toBeVisible({ timeout: 5000 })
  await expect(reportRow(rw.page, ev)).toBeVisible()
  await expect(rw.page.locator('main').getByRole('switch', { name: `Enabled ${renamed}` })).toHaveAttribute('aria-checked', 'true')
  await rw.close()
})

test('UI-AL-01 alerts from Reports input and Notify me', async () => {
  const rw = await base()
  const page = rw.page
  const sheet = page.getByRole('dialog', { name: 'Notify me' })
  // Reports input → routed to an alert (Notify sheet in confirm state with the backtest line)
  await nav(page, 'Reports')
  await page.getByPlaceholder(/Describe a report/).fill('Tell me if Northwind leads a round')
  await page.getByRole('button', { name: 'Create report' }).click()
  await expect(sheet.getByTestId('backtest')).toHaveText(/^Would have matched \d+ times? in the last 30 days$/, { timeout: 240_000 })
  await expect(sheet.getByLabel('Alert condition')).toHaveValue('Tell me if Northwind leads a round')
  await sheet.getByRole('button', { name: 'Create alert' }).click()
  await expect(toast(page, /^Alert on · /)).toBeVisible()
  const nwName = (await toast(page, /^Alert on · /).textContent())!.replace('Alert on · ', '')
  await expect(page.locator('main').getByText('Tell me if Northwind leads a round', { exact: true })).toBeVisible()
  expect((await rw.invoke('report.list', {})).some((r: any) => /Northwind/.test(r.promptText || ''))).toBe(false)
  // Notify me… on Brightdesk: "raises a round"
  await nav(page, 'Companies')
  await page.getByRole('button', { name: 'All tracked' }).click()
  await page.locator('main').getByText('Brightdesk', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Notify me…' }).click()
  await expect(sheet.getByText('Notify me about Brightdesk')).toBeVisible()
  await sheet.getByText('Tell me when Brightdesk raises a round', { exact: true }).click()
  await sheet.getByRole('button', { name: 'Continue' }).click()
  await expect(sheet.getByTestId('backtest')).toHaveText(/^Would have matched \d+ times? in the last 30 days$/, { timeout: 240_000 })
  await sheet.getByRole('button', { name: 'Create alert' }).click()
  await expect(toast(page, /^Alert on · /)).toBeVisible()
  await nav(page, 'Reports')
  const BD = 'Tell me when Brightdesk raises a round'
  await expect(page.locator('main').getByText(BD, { exact: true })).toBeVisible()
  // toggle
  const bdSwitch = page.locator('main').getByRole('switch', { name: `Enabled ${BD}` })
  await expect(bdSwitch).toHaveAttribute('aria-checked', 'true')
  await bdSwitch.click(); await expect(bdSwitch).toHaveAttribute('aria-checked', 'false')
  await bdSwitch.click(); await expect(bdSwitch).toHaveAttribute('aria-checked', 'true')
  // Edit… (right-click) opens the sheet with the rule text
  // (M5 alert-row context menu is not wired in the UI — reported; soft so the epoch-2 notification is still checked)
  await page.locator('main').getByText(BD, { exact: true }).click({ button: 'right' })
  const hasMenu = await page.getByRole('menuitem', { name: 'Edit…' }).isVisible({ timeout: 3000 }).catch(() => false)
  expect.soft(hasMenu, 'right-click on an alert row opens Edit… / Delete').toBe(true)
  if (hasMenu) {
    await page.getByRole('menuitem', { name: 'Edit…' }).click()
    await expect(sheet.getByLabel('Alert condition')).toHaveValue(BD)
    await sheet.getByRole('button', { name: 'Cancel' }).click()
    // Delete
    await page.locator('main').getByText(BD, { exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(toast(page, 'Deleted alert')).toBeVisible()
    await expect(page.locator('main').getByText(BD, { exact: true })).toHaveCount(0)
  } else await page.keyboard.press('Escape')
  // epoch 2: Stackforge's Series B led by Northwind → the Northwind alert fires (in-app notification toast)
  await fixtures.epoch(2)
  const note = page.getByRole('status', { name: 'Notification' })
  const notified = expect(note).toHaveText(nwName, { timeout: 400_000 }).then(() => true, () => false)
  await rw.invoke('ingress.addUrl', { url: 'http://stackforge.test:4700/blog/series-b' })
  await rw.drain(400_000)
  const fired = (await rw.inspect('notifications')).filter((n: any) => n.title === nwName)
  expect(fired.length, 'notification rows for the Northwind alert').toBeGreaterThan(0)
  expect(await Promise.race([notified, new Promise(r => setTimeout(() => r(false), 20_000))]), 'in-app notification toast for the alert').toBe(true)
  // the item is in Today and its Why lists the alert
  await nav(page, 'Saved'); await nav(page, 'Today')
  const item = page.locator('main [data-item]').filter({ hasText: /Stackforge raises \$30M Series B/ }).first()
  await page.mouse.move(5, 5); await item.hover(); await item.getByRole('button', { name: '⋯' }).click()
  await page.getByRole('menuitem', { name: 'Why am I seeing this?' }).click()
  await expect(page.getByRole('dialog', { name: 'Why you’re seeing this' })).toContainText(`Matched your alert: ${nwName}`)
  await rw.close()
})

test('UI-VIEW-02 customize firm and all thesis pages', async () => {
  const rw = await base()
  const page = rw.page
  // firm: M4 Customize button → "Show saved evidence first"
  await nav(page, 'Venture Firms')
  await page.getByRole('button', { name: 'All tracked' }).click()
  await page.locator('main').getByText(/^Northwind/).first().click()
  const top = async (label: string) => (await page.locator('main').getByText(label, { exact: true }).first().boundingBox())!.y
  await expect(page.locator('main').getByText('Saved evidence', { exact: true })).toBeVisible()
  const before = await top('Saved evidence'), invest = await top('Recent public investments')
  expect(before).toBeGreaterThan(invest + 20) // default: saved evidence sits below the other rail sections
  await page.getByRole('button', { name: 'Customize' }).click()
  const cu = page.getByRole('dialog', { name: 'Customize' })
  await cu.getByText('Show saved evidence first', { exact: true }).click()
  await cu.getByRole('button', { name: 'Apply' }).click()
  await expect(toast(page, /^Updated /)).toBeVisible({ timeout: 180_000 })
  // the saved-evidence section now leads the page (top row, level with or above the first main section)
  // (firm section order is not bound in the page markup — reported; soft so the thesis half still runs)
  await expect.configure({ soft: true }).poll(async () => (await top('Saved evidence')) <= (await top('Recent public investments')) + 20, { timeout: 10_000 }).toBe(true)
  // thesis: "Show contradicting evidence first" on all thesis pages
  await nav(page, 'Theses')
  await page.locator('main').getByText(LEGAL, { exact: true }).first().click()
  await page.getByRole('button', { name: 'Customize' }).click()
  await cu.getByText('Show contradicting evidence first', { exact: true }).click()
  await cu.getByLabel('Describe the layout').fill('On every thesis page, show contradicting evidence first')
  await cu.getByRole('button', { name: 'Apply' }).click()
  await expect(toast(page, 'Updated all thesis pages')).toBeVisible({ timeout: 180_000 })
  const firstColumn = async () => page.locator('main [data-column]').evaluateAll(els => els.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(e => e.getAttribute('data-column'))[0])
  await expect.poll(firstColumn).toBe('contradicting')
  await nav(page, 'Theses')
  await page.locator('main').getByText(SUPPORT, { exact: true }).first().click()
  await expect.poll(firstColumn).toBe('contradicting')
  await rw.close()
})

test('UI-REP-03 reading first: Refine on top, the settings strip edits the same definition with Undo, Expand opens the reader', async () => {
  const rw = await base()
  const page = rw.page
  await nav(page, 'Reports')
  // the built-in report with the most sections (removing one must leave at least one)
  const rep = (await rw.invoke('report.list', {})).filter((r: any) => r.templateKey && r.definition).sort((a: any, b: any) => b.definition.sections.length - a.definition.sections.length)[0]
  expect(rep.definition.sections.length, 'a report with two or more sections').toBeGreaterThanOrEqual(2)
  await reportRow(page, rep.name).click()
  await rw.drain(300_000)
  const refine = page.getByLabel('Refine this report')
  const view = page.getByTestId('report-view')
  await expect(view).toBeVisible({ timeout: 120_000 })
  // Refine sits above the report: nothing to scroll past to edit it
  expect((await refine.boundingBox())!.y, 'Refine above the report').toBeLessThan((await view.boundingBox())!.y)
  await page.getByRole('button', { name: 'shorter', exact: true }).click()
  await expect(refine).toHaveValue('shorter')
  await refine.fill('')
  // the strip: layout → Digest, then Undo restores Story
  await page.getByTestId('report-strip-summary').getByRole('button', { name: 'Edit settings' }).click()
  const strip = page.getByTestId('report-strip')
  await strip.getByRole('button', { name: 'Digest', exact: true }).click()
  await expect(toast(page, /^Updated · layout: digest/)).toBeVisible()
  await until(async () => (await rw.invoke('report.list', {})).find((r: any) => r.id === rep.id).definition.style === 'digest' || null, 30_000, 300)
  await expect(page.getByTestId('report-last-change')).toContainText('Last change: layout: digest')
  await page.getByTestId('report-last-change').getByRole('button', { name: 'Undo' }).click()
  await until(async () => (await rw.invoke('report.list', {})).find((r: any) => r.id === rep.id).definition.style === 'story' || null, 30_000, 300)
  // schedule: Weekly shows the day picker and saves weekly
  await strip.getByLabel('Schedule').selectOption('weekly')
  await expect(strip.getByLabel('Day')).toBeVisible()
  await until(async () => (await rw.invoke('report.list', {})).find((r: any) => r.id === rep.id).definition.schedule.kind === 'weekly' || null, 30_000, 300)
  // sections: remove one (×) — the definition loses it
  const before = (await rw.invoke('report.list', {})).find((r: any) => r.id === rep.id).definition.sections
  await strip.getByRole('button', { name: `Remove ${before[before.length - 1].title}` }).click()
  await until(async () => (await rw.invoke('report.list', {})).find((r: any) => r.id === rep.id).definition.sections.length === before.length - 1 || null, 30_000, 300)
  // Expand: the full-window reader, closed with Esc
  await page.getByRole('button', { name: 'Expand', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Report reader' })).toBeVisible()
  await expect(page.getByTestId('report-reader')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Report reader' })).toHaveCount(0)
  // double-click in the report opens the same reader; ⌘↩ too
  await page.frameLocator('[data-testid="report-view"]').locator('body').dblclick()
  await expect(page.getByRole('dialog', { name: 'Report reader' })).toBeVisible()
  await page.getByRole('button', { name: 'Close reader' }).click()
  await expect(page.getByRole('dialog', { name: 'Report reader' })).toHaveCount(0)
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.keyboard.press('Meta+Enter')
  await expect(page.getByRole('dialog', { name: 'Report reader' })).toBeVisible()
  await page.keyboard.press('Escape')
  await rw.close()
})
