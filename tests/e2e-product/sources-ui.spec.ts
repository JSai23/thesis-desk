// RFC §3B: UI-SRC-01…04, UI-AUTH-01 — sources through the Add-source sheet and the Sources screen.
import { test, expect, type Page } from '@playwright/test'
import { launch, until, type RW, reloadApp } from '../harness/app'
import { fixtures } from '../harness/fixtures'
import { reader } from '../harness/ledger'

const nav = (page: Page, label: string) => page.locator('aside').getByText(label, { exact: true }).first().click()
const toast = (page: Page, re: RegExp | string) => page.getByText(re).first()
const SW = 'http://signalwire.test:4700/feed.xml'
const SW_TITLES = ['Brightdesk hires Tomas Berg as CFO', 'Contact-center buyers hit an automation ceiling, Callhaven says', 'Quillmate signs three AmLaw 50 firms already using Lumen Legal', 'Lumen Legal raises $18M Series A led by Northwind Ventures']

async function openAdd(page: Page, q: string) {
  await page.locator('aside').getByText('Add source', { exact: true }).first().click()
  await page.getByLabel('Source or link').fill(q)
}
async function openRow(page: Page, name: string) {
  await nav(page, 'Sources')
  await page.locator('main').getByText(name, { exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
}
const reload = async (rw: RW) => { await reloadApp(rw.page) }

test('UI-SRC-01 add and configure a source', async () => {
  await fixtures.reset()
  let rw = await launch()
  await rw.invoke('thesis.create', { title: 'Legal AI' })
  const page = rw.page
  await reload(rw)
  await openAdd(page, SW)
  await expect(page.getByRole('button', { name: 'Start watching' })).toBeEnabled({ timeout: 60_000 })
  await page.getByText('Custom instruction', { exact: true }).click()
  await page.getByPlaceholder(/Only show me posts about/).fill('Legal AI and customer-support automation news')
  await page.getByRole('button', { name: 'Hourly' }).click()
  // connect Legal AI (the probe may already have suggested it)
  if (!(await page.getByText('◆ Legal AI', { exact: true }).count())) await page.getByText('+ Legal AI', { exact: true }).first().click()
  await expect(page.getByText('◆ Legal AI', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Start watching' }).click()
  await expect(toast(page, /^Watching .* · first check running on this Mac$/)).toBeVisible()
  await rw.drain(500_000)
  const src = (await rw.invoke('source.list', {})).find((s: any) => s.locator.includes('signalwire'))
  // expanded row: instruction, Hourly, thesis chip, recently captured
  await reload(rw)
  const check = async (p: Page) => {
    await openRow(p, src.name)
    const main = p.locator('main')
    await expect(main.getByText(/Hourly · Normal/)).toBeVisible()
    await expect(main.getByRole('textbox').first()).toHaveValue('Legal AI and customer-support automation news')
    await expect(main.getByText('◆ Legal AI', { exact: true })).toBeVisible()
    await expect(main.getByText('Recently captured', { exact: true })).toBeVisible()
  }
  await check(page)
  // RFC: "Recently captured lists 4 titles" (the Signal Wire feed has 4 posts). The expanded row caps the list at 3
  // (prototype slice(0, 3)) — reported as a spec/UI mismatch; soft so persistence below is still checked.
  for (const t of SW_TITLES) await expect.soft(page.locator('main').getByText(new RegExp(`^${t.replace(/[$.]/g, '\\$&')} · `))).toBeVisible({ timeout: 3000 })
  rw = await rw.restart()
  await check(rw.page)
  expect(await rw.invoke('source.get', { id: src.id })).toMatchObject({ mode: 'custom', freq: 'hourly', instruction: 'Legal AI and customer-support automation news' })
  await rw.close()
})

async function swSource(rw: RW) {
  const p = await rw.invoke('source.probe', { locator: SW })
  const s = await rw.invoke('source.create', { locator: SW, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  await rw.drain(400_000)
  await reload(rw)
  return s
}

test('UI-SRC-02 source lifecycle', async () => {
  await fixtures.reset()
  let rw = await launch()
  const src = await swSource(rw)
  const page = rw.page
  const main = page.locator('main')
  await openRow(page, src.name)
  // Sync now → toast
  await page.getByRole('button', { name: 'Sync now' }).click()
  // "Checking …" at once, then the result replaces it (a local sync can finish within milliseconds)
  await expect(toast(page, new RegExp(`^(?:Checking ${src.name} on this Mac…|${src.name} is up to date|${src.name}: \\d+ new · \\d+ updated)$`))).toBeVisible()
  await rw.drain(120_000)
  // toggle pause → "Paused" label; toggle back
  const toggle = main.getByRole('switch', { name: `Enabled ${src.name}` })
  await toggle.click()
  await expect(toast(page, `Paused ${src.name}`)).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(main.getByText('Paused', { exact: true })).toBeVisible()
  await toggle.click()
  await expect(toast(page, `Resumed ${src.name}`)).toBeVisible()
  await expect(main.getByText('Paused', { exact: true })).toHaveCount(0)
  // Mute → "Muted" label
  await page.getByRole('button', { name: 'Mute for a week' }).click()
  await expect(toast(page, `Muted ${src.name}`)).toBeVisible()
  await expect(main.getByText('Muted', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unmute' })).toBeVisible()
  // Reset… confirm sheet copy (M10)
  await page.getByRole('button', { name: 'Reset…' }).click()
  const sheet = page.getByRole('dialog', { name: 'Reset source' })
  await expect(sheet.getByText(`Reset and re-ingest ${src.name}?`)).toBeVisible()
  await expect(sheet.getByText('Use this if the source looks wrong. Nothing you created is lost.')).toBeVisible()
  for (const t of ['Kept', 'Rebuilt', '✓ Your notes and highlights', '✓ Saved, read and dismissed items', '✓ Evidence you kept and links you accepted or rejected', '✓ Your corrections to company and firm details', '↻ Summaries, extracted evidence and suggested links for every item from this source', '↻ Its check history, so older posts (up to 30 days) are fetched again'])
    await expect(sheet.getByText(t, { exact: true })).toBeVisible()
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  await expect(sheet).toHaveCount(0)
  // Remove + Undo
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(toast(page, `Removed ${src.name}`)).toBeVisible()
  await expect(main.getByText(src.name, { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(main.getByText(src.name, { exact: true }).first()).toBeVisible()
  // state survives restart (read back in the UI)
  rw = await rw.restart()
  await nav(rw.page, 'Sources')
  await expect(rw.page.locator('main').getByText(src.name, { exact: true }).first()).toBeVisible()
  await expect(rw.page.locator('main').getByText('Muted', { exact: true })).toBeVisible()
  await expect(rw.page.locator('main').getByRole('switch', { name: `Enabled ${src.name}` })).toHaveAttribute('aria-checked', 'true')
  const s = await rw.invoke('source.get', { id: src.id })
  expect(s.muted).toBe(true); expect(s.enabled).toBe(true); expect(s.deletedAt).toBeNull()
  await rw.close()
})

test('UI-SRC-03 failure and recovery', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page
  await fixtures.fail('broken/feed.xml', 200)
  const p = await rw.invoke('source.probe', { locator: 'http://broken.test:4700/feed.xml' })
  await fixtures.fail('broken/feed.xml', 'off')
  const src = await rw.invoke('source.create', { locator: 'http://broken.test:4700/feed.xml', mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  await rw.drain(60_000)
  for (const m of [2, 6]) { await rw.invoke('test.clock.advance', { ms: m * 60_000 }); await rw.drain(60_000) }
  await reload(rw)
  await nav(page, 'Today')
  const banner = page.getByRole('status', { name: 'Notice' })
  await expect(banner).toContainText(/1 source needs attention/)
  await nav(page, 'Sources')
  const main = page.locator('main')
  await expect(main.getByText('Failing', { exact: true })).toBeVisible()
  await expect(main.getByRole('alert').first()).toContainText(/500/)
  await main.getByText(src.name, { exact: true }).first().click()
  await fixtures.fail('broken/feed.xml', 200)
  await page.getByRole('button', { name: 'Retry' }).first().click()
  await expect(toast(page, `Retrying ${src.name}…`)).toBeVisible()
  await rw.drain(120_000)
  await expect(main.getByText('Failing', { exact: true })).toHaveCount(0)
  await nav(page, 'Today')
  await expect(page.getByText(/needs attention/)).toHaveCount(0)
  await fixtures.fail('broken/feed.xml', 'off')
  await rw.close()
})

test('UI-SRC-04 unsupported and unreachable', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page
  await openAdd(page, 'producthunt.com/posts/a')
  await expect(page.getByText('Can’t watch this')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Start watching' })).toBeDisabled()
  await page.getByLabel('Source or link').fill('http://gone.test:4700/')
  await expect(page.getByText('Couldn’t reach this')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start watching' })).toBeDisabled()
  await rw.close()
})

const loginWin = (rw: RW) => rw.app.windows().find(p => /ledger\.test:4700\/login/.test(p.url())) || null
async function typeCreds(login: Page) {
  await login.fill('input[name=email]', reader.email); await login.fill('input[name=password]', reader.password)
  await login.click('button[type=submit]')
}

test('UI-AUTH-01 sign-in flow', async () => {
  await fixtures.reset()
  let rw = await launch()
  const page = rw.page
  await openAdd(page, 'http://ledger.test:4700/')
  await expect(page.getByText('Sign-in needed')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Sign in' }).click()
  // no theses in this profile: in the expanded row, capture everything so the article reaches the library
  await page.locator('main').getByRole('button', { name: 'Everything' }).click()
  const name = (await rw.invoke('source.list', {})).find((s: any) => /ledger/.test(s.locator)).name
  // the card's Sign in created the source and opened the app-owned auth window → type credentials → it closes itself
  const login = await until(async () => loginWin(rw), 30_000)
  await typeCreds(login)
  await expect(toast(page, /^Signed in to /)).toBeVisible({ timeout: 60_000 })
  await until(async () => !loginWin(rw) || null, 30_000)
  await rw.drain(400_000)
  // nothing followed and no theses: the article is below Today's sections, in All (DEC-096)
  await nav(page, 'Today')
  await page.getByRole('button', { name: /^All \d+$/ }).click()
  await expect(page.locator('main').getByText(/Inside Brightdesk/).first()).toBeVisible()
  // after restart, Sync works
  rw = await rw.restart()
  const src = (await rw.invoke('source.list', {})).find((s: any) => /ledger/.test(s.locator))
  await openRow(rw.page, name)
  await rw.page.getByRole('button', { name: 'Sync now' }).click()
  await expect(toast(rw.page, `Checking ${name} on this Mac…`)).toBeVisible()
  await rw.drain(300_000)
  expect((await rw.invoke('source.get', { id: src.id })).authState).toBe('authenticated')
  await expect(rw.page.locator('main').getByText(/Sign-in needed|Session expired/)).toHaveCount(0)
  // after expiry → "Session expired" label + Today banner → Sign in again works
  await fixtures.expireLedger()
  await rw.page.getByRole('button', { name: 'Sync now' }).click()
  await rw.drain(300_000)
  await reload(rw)
  await nav(rw.page, 'Sources')
  await expect(rw.page.locator('main').getByText('Session expired', { exact: true })).toBeVisible()
  await nav(rw.page, 'Today')
  await expect(rw.page.getByRole('status', { name: 'Notice' })).toContainText(/needs you to sign in again/)
  await openRow(rw.page, name)
  await rw.page.getByRole('button', { name: 'Sign in again' }).click()
  const login2 = await until(async () => loginWin(rw), 30_000)
  await typeCreds(login2)
  await expect(toast(rw.page, /^Signed in to /)).toBeVisible({ timeout: 60_000 })
  await rw.drain(300_000)
  await expect(rw.page.locator('main').getByText('Session expired', { exact: true })).toHaveCount(0)
  expect((await rw.invoke('source.get', { id: src.id })).authState).toBe('authenticated')
  await rw.close()
})

test('UI-SRC-05 load older posts from a source (DEC-085)', async () => {
  await fixtures.reset()
  const rw = await launch()
  const p = await rw.invoke('source.probe', { locator: 'http://archive.test:4700/feed.xml' })
  await rw.invoke('source.create', { locator: 'http://archive.test:4700/feed.xml', mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  await rw.drain(500_000)
  const page = rw.page
  await page.locator('aside').getByText('Sources', { exact: true }).first().click()
  await page.locator('main').getByText('archive', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Load older posts' }).click()
  await page.getByText('Last 30 days', { exact: true }).click()
  await expect(page.getByText(/Loading archive’s posts from the last 30 days/)).toBeVisible()
  // the toast appears when the fetch finishes (before AI processing) and stays ~4.5 s
  await expect(page.getByText(/archive: 5 older posts added from the last 30 days/)).toBeVisible({ timeout: 120_000 })
  await rw.drain(500_000)
  expect((await rw.inspect('documents')).filter((d: any) => /archive\.test/.test(d.url || '')).length).toBe(10)
  await rw.close()
})
