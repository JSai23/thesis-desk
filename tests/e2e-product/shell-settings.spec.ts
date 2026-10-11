// RFC §3B: UI-SHELL-01, UI-SET-01, UI-SET-02, UI-EMPTY-01, UI-KEYS-01 — driven only through visible UI.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { launch, installEmail, tempDir, until, type RW } from '../harness/app'
import { fixtures } from '../harness/fixtures'

const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' })
const nav = (page: Page, label: string) => page.locator('aside').getByText(label, { exact: true }).first().click()
const toast = (page: Page, re: RegExp | string) => page.getByText(re).first()
const PRIVACY = 'Your library is stored on this Mac, in a folder you can open and back up. Research Workspace has no server of its own. Sources are fetched directly from this Mac. To summarize, organize and answer questions, article text, your notes, theses and questions are sent from this Mac to OpenAI using the ChatGPT sign-in you already have in Codex, and count toward your ChatGPT plan’s usage. Newsletters are read from, and reports and alerts are sent through, your Gmail account. When you send a link from a site like X or LinkedIn, Research Workspace opens just that page using your Chrome sign-in for that site; it never stores your passwords.'
const LAW14 = 'Research Workspace checks your sources only while it’s running. When you close the window it keeps running in the background.'
const SW = 'http://signalwire.test:4700/feed.xml'

async function openSettings(page: Page, cat: string) {
  if (!(await settings(page).count())) await page.keyboard.press('Meta+,')
  await settings(page).getByText(cat, { exact: true }).first().click()
}
const sw = (page: Page, name: string) => settings(page).getByRole('switch', { name, exact: true })

test('UI-SHELL-01 shell parity and navigation', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page
  // every sidebar destination renders its empty state copy (RFC §1A.3 V-* "Empty" column)
  await expect(page.getByText('You’re caught up')).toBeVisible()
  await nav(page, 'Saved'); await expect(page.getByText('Nothing saved yet')).toBeVisible()
  await nav(page, 'Theses'); await expect(page.getByText('No theses yet. Create one or save a thought.')).toBeVisible()
  // V-ENTITIES empty copy — currently not rendered by the app (reported bug); soft so the rest of the scenario still runs
  await nav(page, 'Companies'); await expect.soft(page.getByText('Follow a company from ⌘K or any article.')).toBeVisible({ timeout: 3000 })
  await nav(page, 'Venture Firms'); await expect.soft(page.getByText('Follow a venture firm from ⌘K or any article.')).toBeVisible({ timeout: 3000 })
  await nav(page, 'People'); await expect.soft(page.getByText('Follow a person from any company or firm page.')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('main').getByText('Founders, executives and investors', { exact: false })).toBeVisible()
  // V-SOURCES: first run shows the starter pack under Suggested
  await nav(page, 'Sources'); await expect(page.getByText('Subscribed 0', { exact: true })).toBeVisible(); await expect(page.getByText('Suggested 8', { exact: true })).toBeVisible()
  await nav(page, 'Reports'); await expect(page.getByText('Your reports')).toBeVisible()
  // back / forward restore screens
  await page.getByRole('button', { name: '‹' }).click(); await expect(page.getByText('Suggested 8', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '‹' }).click(); await expect(page.locator('main').getByText('Founders, executives and investors', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '›' }).click(); await expect(page.getByText('Suggested 8', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '›' }).click(); await expect(page.getByText('Your reports')).toBeVisible()
  // ⌘, opens Settings
  await page.keyboard.press('Meta+,'); await expect(settings(page)).toBeVisible(); await expect(settings(page).getByText('Keyboard Shortcuts')).toBeVisible()
  await page.keyboard.press('Escape'); await expect(settings(page)).toHaveCount(0)
  // resize the sidebar by dragging its edge
  const side = page.locator('aside').first()
  const w0 = (await side.boundingBox())!.width
  await page.mouse.move(w0 - 1, 400); await page.mouse.down(); await page.mouse.move(w0 + 60, 400, { steps: 6 }); await page.mouse.up()
  expect((await side.boundingBox())!.width).toBeGreaterThan(w0 + 30)
  await rw.close()
})

test('UI-SET-01 settings categories, copy and actions', async () => {
  await fixtures.reset()
  let rw = await launch()
  await installEmail(rw)
  const page = rw.page
  // first-run banner offer appears once, after the first source is added (setup via IPC)
  const p = await rw.invoke('source.probe', { locator: SW })
  await rw.invoke('source.create', { locator: SW, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  await rw.drain(400_000)
  await nav(page, 'Saved'); await nav(page, 'Today')
  const banner = page.getByRole('status', { name: 'Notice' })
  await expect(banner).toContainText('Research Workspace checks your sources only while it’s running')
  await banner.getByRole('button', { name: 'Open at login' }).click()
  await expect(banner.getByText('Research Workspace checks your sources only while it’s running')).toHaveCount(0)
  // every category opens
  await page.keyboard.press('Meta+,')
  const CATS: [string, string][] = [['Appearance', 'Glass and transparency'], ['Notifications', 'Highlight new activity'], ['Sources', 'Pause all polling'], ['AI Behavior', 'Summarize long articles'], ['Accounts', 'Signed-in sites'], ['Local Data', 'Library location'], ['Keyboard Shortcuts', 'Toggle inspector']]
  for (const [cat, row] of CATS) {
    await settings(page).getByText(cat, { exact: true }).first().click()
    await expect(settings(page).getByText(row, { exact: true })).toBeVisible()
  }
  // Sources: LAW-14 copy on Open at login (turned on by the banner offer); Pause all polling
  await openSettings(page, 'Sources')
  await expect(settings(page).getByText(LAW14, { exact: true })).toBeVisible()
  await expect(sw(page, 'Open at login')).toHaveAttribute('aria-checked', 'true')
  await sw(page, 'Pause all polling').click()
  await expect(sw(page, 'Pause all polling')).toHaveAttribute('aria-checked', 'true')
  await until(async () => (await rw.invoke('settings.get')).pause_polling === true || null, 5000, 200)
  await sw(page, 'Pause all polling').click()
  await expect(sw(page, 'Pause all polling')).toHaveAttribute('aria-checked', 'false')
  // Appearance: theme, density, font — effects visible in the window
  await openSettings(page, 'Appearance')
  await settings(page).getByRole('button', { name: 'Light' }).click()
  await settings(page).getByRole('button', { name: 'Comfortable' }).click()
  await settings(page).getByRole('button', { name: 'Sans' }).click()
  await expect(page.locator('[data-theme]').first()).toHaveAttribute('data-theme', 'light')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-item]').first()).toHaveCSS('padding-top', '15px')
  expect(await page.locator('article h1').first().evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/^-apple-system/)
  // Accounts: ChatGPT Test, Gmail Test
  await openSettings(page, 'Accounts')
  await expect(settings(page).getByTestId('ai-status')).toContainText('Signed in as', { timeout: 30_000 })
  await settings(page).getByRole('button', { name: 'Test' }).first().click()
  await expect(toast(page, /^ChatGPT sign-in works · \d+ ms$/)).toBeVisible({ timeout: 120_000 })
  await settings(page).getByRole('button', { name: 'Test' }).nth(1).click()
  await expect(settings(page).getByRole('status')).not.toHaveText(/Testing…/, { timeout: 60_000 })
  await expect(settings(page).getByRole('status')).not.toHaveText(/fail/i)
  await expect(settings(page).getByText(/^Connected as /)).toBeVisible()
  // Local Data: privacy copy exact (DEC-019), Reindex, Export, Keep dismissed
  await openSettings(page, 'Local Data')
  await expect(settings(page).getByText(PRIVACY, { exact: true })).toBeVisible()
  await settings(page).getByRole('button', { name: 'Reindex' }).click()
  await expect(toast(page, 'Library reindexed on this Mac')).toBeVisible()
  await settings(page).getByRole('button', { name: 'Export…' }).click()
  await expect(toast(page, /^Exported to /)).toBeVisible({ timeout: 60_000 })
  const dir = (await toast(page, /^Exported to /).textContent())!.replace('Exported to ', '').replace(/^~/, process.env.HOME!)
  expect(fs.existsSync(`${dir}/manifest.json`)).toBe(true)
  fs.rmSync(dir, { recursive: true, force: true })
  await sw(page, 'Keep dismissed items').click()
  await expect(sw(page, 'Keep dismissed items')).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Escape')
  // persistence across restart, read back through the UI
  rw = await rw.restart()
  await expect(rw.page.locator('[data-theme]').first()).toHaveAttribute('data-theme', 'light')
  await openSettings(rw.page, 'Local Data')
  await expect(sw(rw.page, 'Keep dismissed items')).toHaveAttribute('aria-checked', 'false')
  await openSettings(rw.page, 'Sources')
  await expect(sw(rw.page, 'Open at login')).toHaveAttribute('aria-checked', 'true')
  await expect(sw(rw.page, 'Pause all polling')).toHaveAttribute('aria-checked', 'false')
  const s = await rw.invoke('settings.get')
  expect(s).toMatchObject({ 'appearance.theme': 'light', 'appearance.density': 'comfortable', 'appearance.reader_font': 'sans', keep_dismissed: false, open_at_login: true, pause_polling: false })
  await rw.close()
})

test('UI-SET-02 pause all polling', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page
  const p = await rw.invoke('source.probe', { locator: SW })
  const src = await rw.invoke('source.create', { locator: SW, mode: 'all', instruction: '', freq: 'hourly', thesisIds: [], probe: p })
  await rw.drain(400_000)
  const fetches = async () => (await rw.inspect('jobs', { type: 'FETCH_SOURCE' })).filter((j: any) => JSON.parse(j.payload_json).sourceId === src.id).length
  await openSettings(page, 'Sources')
  await sw(page, 'Pause all polling').click()
  await expect(sw(page, 'Pause all polling')).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await until(async () => (await rw.invoke('settings.get')).pause_polling === true || null, 5000, 200)
  const n0 = await fetches()
  await rw.invoke('test.clock.advance', { ms: 2 * 3600_000 }); await rw.invoke('test.scheduler.tick')
  expect(await fetches()).toBe(n0) // no scheduled FETCH_SOURCE while paused
  // Sync now still works
  await nav(page, 'Sources')
  await page.locator('main').getByText(src.name, { exact: true }).first().click()
  await page.getByRole('button', { name: 'Sync now' }).first().click()
  // "Checking …" at once, then the result replaces it (a local sync can finish within milliseconds)
  await expect(toast(page, new RegExp(`^(?:Checking ${src.name} on this Mac…|${src.name} is up to date|${src.name}: \\d+ new · \\d+ updated)$`))).toBeVisible()
  await until(async () => (await fetches()) === n0 + 1 || null, 10_000, 200)
  await rw.drain(300_000)
  // off → the next tick schedules
  await openSettings(page, 'Sources')
  await sw(page, 'Pause all polling').click()
  await expect(sw(page, 'Pause all polling')).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Escape')
  await until(async () => (await rw.invoke('settings.get')).pause_polling === false || null, 5000, 200)
  await rw.invoke('test.clock.advance', { ms: 2 * 3600_000 }); await rw.invoke('test.scheduler.tick')
  expect(await fetches()).toBe(n0 + 2)
  await rw.drain(300_000)
  await rw.close()
})

test('UI-EMPTY-01 first run without AI', async () => {
  await fixtures.reset()
  const opts = { codexHome: tempDir('rw-codex-empty-'), env: { RW_STARTER_PACK_OVERRIDE: 'fixtures' } }
  let rw = await launch(opts)
  const page = rw.page
  await expect(page.getByRole('status', { name: 'Notice' })).toContainText('Sign in to ChatGPT with Codex to organize what comes in')
  await nav(page, 'Sources')
  await page.getByText(/^Suggested \d+$/).click()
  await expect(page.getByText('Suggested 8', { exact: true })).toBeVisible()
  const subscribe = page.locator('main').getByRole('button', { name: 'Subscribe' })
  await expect(subscribe).toHaveCount(8)
  const card = (name: string) => page.locator('main div').filter({ hasText: name }).filter({ has: page.getByRole('button', { name: 'Subscribe' }) }).last()
  await card('Hacker News').getByRole('button', { name: 'Subscribe' }).click()
  await expect(toast(page, /^Subscribed to Hacker News/)).toBeVisible()
  await until(async () => (await rw.invoke('source.list', {})).some((s: any) => s.kind === 'hn_api' && /hn\.test:4700\/v0/.test(s.locator)) || null, 30_000)
  await card('Sequoia').getByRole('button', { name: 'Not interested' }).click()
  await expect(page.locator('main').getByText(/Sequoia/)).toHaveCount(0)
  await rw.drain(120_000)
  rw = await rw.restart()
  await nav(rw.page, 'Sources')
  await rw.page.getByText(/^Suggested \d+$/).click()
  await expect(rw.page.locator('main').getByRole('button', { name: 'Subscribe' }).first()).toBeVisible()
  await expect(rw.page.locator('main').getByText(/Sequoia/)).toHaveCount(0)
  expect((await rw.invoke('source.suggestions')).some((c: any) => /Sequoia/.test(c.name))).toBe(false)
  await rw.close()
})

async function keysCorpus(): Promise<RW> {
  await fixtures.reset()
  const rw = await launch()
  await rw.invoke('thesis.create', { title: 'Legal AI' })
  for (const u of ['http://signalwire.test:4700/lumen-legal-series-a', 'http://signalwire.test:4700/brightdesk-cfo', 'http://misc.test:4700/claimwise-interview.html']) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(400_000)
  await nav(rw.page, 'Saved'); await nav(rw.page, 'Today')
  return rw
}

test('UI-KEYS-01 keyboard shortcuts', async () => {
  const rw = await keysCorpus()
  const page = rw.page
  const main = page.locator('main')
  const heading = () => page.locator('article h1').first()
  await page.getByRole('button', { name: /^All \d+$/ }).click()
  await expect(heading()).toBeVisible()
  await expect(main.locator('[data-item]')).toHaveCount(3)
  await main.locator('[data-item]').first().click() // select the first row (also moves focus off the segment button)
  const t0 = (await heading().textContent())!
  // J / K: next / previous item
  await page.keyboard.press('j'); await expect(heading()).not.toHaveText(t0)
  const t1 = (await heading().textContent())!
  await page.keyboard.press('j'); await expect(heading()).not.toHaveText(t1)
  await page.keyboard.press('k'); await expect(heading()).toHaveText(t1)
  // S: save
  await page.keyboard.press('s')
  await expect(page.getByRole('button', { name: '★ Saved' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Saved 1$/ })).toBeVisible()
  // U: mark unread (selecting marked it read)
  const unread = async () => Number((await page.getByRole('button', { name: /^Unread \d+$/ }).textContent())!.replace(/\D/g, ''))
  const u0 = await unread()
  await page.keyboard.press('u'); await expect.poll(unread).toBe(u0 + 1)
  // I: toggle inspector
  await expect(page.getByText('Why this matters')).toBeVisible()
  await page.keyboard.press('i'); await expect(page.getByText('Why this matters')).toHaveCount(0)
  await page.keyboard.press('i'); await expect(page.getByText('Why this matters')).toBeVisible()
  // ↵: focus reading (list hidden), again to restore
  const list = main.locator('[data-item]').first()
  await page.keyboard.press('Enter'); await expect(list).toBeHidden()
  await page.keyboard.press('Enter'); await expect(list).toBeVisible()
  // E: dismiss
  await page.keyboard.press('e')
  await expect(toast(page, /^Dismissed “/)).toBeVisible()
  await expect(main.getByText(t1, { exact: true })).toHaveCount(0)
  // ⌘-click: multi-select
  const rows = main.locator('[data-item]')
  await rows.nth(0).click(); await rows.nth(1).click({ modifiers: ['Meta'] }) // current item + ⌘-clicked item
  await expect(main.getByText('2 selected')).toBeVisible()
  await page.keyboard.press('Escape'); await expect(main.getByText(/\d selected/)).toHaveCount(0)
  // N: thought sheet
  await page.keyboard.press('n'); await expect(page.getByPlaceholder('What are you thinking?')).toBeVisible(); await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('What are you thinking?')).toHaveCount(0)
  // ⌘,: settings
  await page.keyboard.press('Meta+,'); await expect(settings(page)).toBeVisible(); await page.keyboard.press('Escape')
  // [ ]: back / forward
  await nav(page, 'Theses'); await expect(main.getByText('Legal AI', { exact: true })).toBeVisible()
  await page.keyboard.press('['); await expect(heading()).toBeVisible()
  await page.keyboard.press(']'); await expect(main.getByText('Legal AI', { exact: true })).toBeVisible()
  // ⌘K: search; ⌘↵ in search: Ask
  await page.keyboard.press('Meta+k'); await expect(page.getByLabel('Search')).toBeVisible()
  await page.getByLabel('Search').fill('Who led the Lumen Legal Series A?')
  await page.keyboard.press('Meta+Enter')
  const answer = page.getByTestId('answer')
  await expect(answer).toContainText('Who led the Lumen Legal Series A?')
  await expect(answer.getByLabel('Ask a follow-up')).toBeVisible({ timeout: 180_000 })
  // ⌘↵ ran Ask over the library (who led depends on what extraction kept; the round itself is always there — in the
  // answer or in "Closest items")
  await expect(answer).toContainText(/\$18 million/)
  await page.keyboard.press('Escape'); await expect(page.getByLabel('Search')).toHaveCount(0)
  await rw.close()
})
