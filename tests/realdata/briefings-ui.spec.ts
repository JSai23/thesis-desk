// Briefings UI (DEC-091) through the real Reports screen, on the real RD-BR library (TechCrunch, Crunchbase News,
// a Google News funding search) and the user's real Gmail: create two reports, make a briefing in the sheet, Send now
// from its row → exactly one email with both reports; tag/untag from a report's "Briefings ▸" menu; edit the schedule;
// pause/resume; delete + Undo; Send now without email shows the setup error. Reuses the cached library:
//   RW_RUN_ID=briefs-20261001 npx playwright test -c tests/playwright.config.ts --project=realdata briefings-ui
// Results: tests/results/<run>/realdata-briefings-ui.json
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { preparedLibrary, installEmail, until, ROOT, type RW, reloadApp } from '../harness/app'
import { imapFindMessages, type FoundMessage } from '../harness/imap'

const MIN = 60_000
const LAUNCH = { testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } }
const OUT = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev', 'realdata-briefings-ui.json')
const out: Record<string, any> = { started: new Date().toISOString() }
const save = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 2)) }
const norm = (s: string) => (s || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
const nav = (page: Page, label: string) => page.locator('aside').getByText(label, { exact: true }).first().click()

import { buildBriefsLibrary } from './briefs-library'
const build = async (rw: RW) => { await buildBriefsLibrary(rw) }

test.describe.serial('RD-BRF-UI briefings on the Reports screen', () => {
  let rw: RW
  let page: Page
  const NAME = `Morning brief ${Date.now().toString(36)}`
  const PROMPTS = ['Startup funding rounds this week with lead investors', 'New AI product launches and partnerships this week']
  let reports: any[] = []
  const row = () => page.locator(`[data-briefing="${NAME}"]`)

  test.beforeAll(async () => {
    test.setTimeout(150 * MIN) // may build the shared real library (~25 min) when it runs first
    rw = await preparedLibrary('realdata-briefs', build, LAUNCH)
    await installEmail(rw)
    page = rw.page
    await reloadApp(page)
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('create two reports and a briefing in the sheet; Send now → exactly one email with both reports', async () => {
    test.setTimeout(45 * MIN)
    await nav(page, 'Reports')
    const before = new Set((await rw.invoke('report.list', {})).map((r: any) => r.id))
    for (const p of PROMPTS) {
      await page.getByPlaceholder(/^Describe a report/).fill(p)
      await page.getByRole('button', { name: 'Create report' }).click()
      await expect(page.getByPlaceholder(/^Describe a report/)).toHaveValue('')
    }
    await rw.drain(15 * MIN)
    reports = (await rw.invoke('report.list', {})).filter((r: any) => !before.has(r.id))
    out.reports = reports.map(r => ({ id: r.id, name: r.name, status: r.status })); save()
    expect(reports.map(r => r.status)).toEqual(['active', 'active'])

    // + New briefing → sheet
    await page.getByRole('button', { name: 'New briefing' }).click()
    const sheet = page.getByRole('dialog', { name: 'Briefing' })
    await expect(sheet).toBeVisible()
    await sheet.getByLabel('Briefing name').fill(NAME)
    for (const r of reports) { const cb = sheet.getByRole('checkbox', { name: r.name, exact: true }); if (!(await cb.isChecked())) await cb.check() }
    await sheet.getByRole('radio', { name: 'Weekdays' }).click()
    await sheet.getByLabel('Time').fill('07:30')
    await sheet.getByRole('button', { name: 'Create briefing' }).click()
    await expect(sheet).toHaveCount(0)
    await expect(row()).toContainText('Weekdays 7:30')
    for (const r of reports) await expect(row()).toContainText(r.name)
    await expect(row().getByTestId('briefing-last')).toHaveText('Not sent yet')

    // Send now from the row
    const t0 = new Date(Date.now() - 60_000)
    await row().getByRole('button', { name: 'Send now' }).click()
    await expect(page.getByText(new RegExp(`^(Building ${NAME} on this Mac…|${NAME} is on its way to your inbox|${NAME}: nothing new, so no email)$`)).first()).toBeVisible() // the send can finish before the first toast is read
    await rw.drain(20 * MIN)
    await expect(row().getByTestId('briefing-last')).toHaveText(/^Sent \w{3} \d{1,2}:\d{2} [AP]M$|^Nothing new · no email sent$/, { timeout: 5 * MIN })
    const last = await row().getByTestId('briefing-last').textContent()
    out.lastSend = last; save()
    expect(last, 'the real library has rows this week, so the email was sent').toMatch(/^Sent /)
    const b = (await rw.invoke('briefing.list', {})).find((x: any) => x.name === NAME)
    const runs = await rw.invoke('briefing.runs', { id: b.id })
    const reportRuns = await Promise.all(runs[0].reportRunIds.map((id: string) => rw.invoke('report.run', { runId: id })))
    const msgs = await until(async () => { const m = await imapFindMessages(`Research Workspace · ${NAME} ·`, t0); return m.length ? m : null }, 6 * MIN, 5000) as FoundMessage[]
    out.email = { count: msgs.length, subject: msgs[0].subject, reportsInRun: reportRuns.map((r: any) => r.content.name) }; save()
    expect(msgs.length, 'exactly one email per send').toBe(1)
    const html = norm(msgs[0].html)
    for (const r of reports) expect(html, `email has a part for "${r.name}"`).toContain(norm(r.name))
    for (const rr of reportRuns as any[]) for (const s of rr.content.sections) for (const x of s.rows.slice(0, 3)) {
      // story layout (DEC-093): a row is a card linking to its article
      if (x.url) expect(html, `row "${x.text.slice(0, 50)}" links to its article`).toContain(norm(x.url)); else expect(html).toContain(norm(x.text).slice(0, 40))
    }
  })

  test('report row "Briefings ▸" tags a report out and back in', async () => {
    const r2 = reports[1]
    const repRow = page.locator('main').getByText(r2.name, { exact: true }).first()
    await repRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Briefings ▸/ }).click()
    await page.getByRole('menuitem', { name: new RegExp(NAME) }).click()
    await expect(page.getByText(`Removed from ${NAME}`)).toBeVisible()
    await expect(row()).not.toContainText(r2.name)
    await repRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Briefings ▸/ }).click()
    await expect(page.getByRole('menuitem', { name: 'New briefing with this report…' })).toBeVisible()
    await page.getByRole('menuitem', { name: new RegExp(NAME) }).click()
    await expect(page.getByText(`Added to ${NAME}`)).toBeVisible()
    await expect(row()).toContainText(r2.name)
  })

  test('Edit changes the schedule; Pause/Resume; Delete with Undo', async () => {
    await row().getByRole('button', { name: 'Edit' }).click()
    const sheet = page.getByRole('dialog', { name: 'Briefing' })
    await expect(sheet.getByLabel('Briefing name')).toHaveValue(NAME)
    await sheet.getByRole('radio', { name: 'Weekly' }).click()
    await sheet.getByRole('radio', { name: 'Fri' }).click()
    await sheet.getByLabel('Time').fill('08:15')
    await sheet.getByRole('button', { name: 'Save' }).click()
    await expect(row()).toContainText('Fridays 8:15')
    const sched = (await rw.inspect('schedules')).find((s: any) => s.kind === 'briefing')
    out.schedule = sched; save()

    await row().getByRole('button', { name: `More for ${NAME}` }).click()
    await page.getByRole('menuitem', { name: 'Pause' }).click()
    await expect(row()).toContainText('Fridays 8:15 · Paused')
    await row().getByRole('button', { name: `More for ${NAME}` }).click()
    await page.getByRole('menuitem', { name: 'Resume' }).click()
    await expect(row()).not.toContainText('Paused')

    await row().getByRole('button', { name: `More for ${NAME}` }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(row()).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(row()).toContainText('Fridays 8:15')
    for (const r of reports) await expect(row()).toContainText(r.name)
  })

  test('Send now without email set up shows "Set up email in Settings first"', async () => {
    await rw.invoke('email.remove', {})
    await row().getByRole('button', { name: 'Send now' }).click()
    await expect(page.getByText('Set up email in Settings first')).toBeVisible()
    await installEmail(rw) // leave the profile as it was
  })
})
