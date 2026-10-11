// DEC-099, Backlog "Following anything always hydrates it": the Describe sheet when adding, the From you block (edit,
// re-run, Undo), the lookup line and the hint card when nothing was found, and a thesis matched against facts already
// stored (nudge without a description, match line, suggested topic sources) — through the UI, on the fixture corpus.
import { test, expect, type Page } from '@playwright/test'
import { launch, until, type RW, reloadApp } from '../harness/app'
import { fixtures } from '../harness/fixtures'

const nav = (page: Page, label: string) => page.locator('aside').getByText(label, { exact: true }).first().click()
const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const reload = async (rw: RW) => { await reloadApp(rw.page) }
const lookupDone = (rw: RW, id: string) => until(async () => {
  const j = (await rw.inspect('jobs')).filter((x: any) => x.type === 'HYDRATE_OBJECT' && x.idempotency_key === `hydrate:${id}`)
  return j.length && j.every((x: any) => ['succeeded', 'failed'].includes(x.status)) ? j : null
}, 300_000, 1000)

/** The thesis page, from the Theses list (the sidebar lists only pinned theses). */
async function openThesis(page: Page, title: string) {
  await nav(page, 'Theses')
  await page.locator('main').getByText(title, { exact: true }).first().click()
  await expect(page.getByLabel('Thesis description')).toBeVisible()
}

async function startTracking(page: Page, name: string, website = '', about = '') {
  await page.keyboard.press('Meta+k')
  await palette(page).getByRole('option', { name: 'Follow company…' }).click()
  await page.getByLabel('Search').fill(name)
  await palette(page).getByRole('option', { name: `Start tracking “${name}”` }).click()
  const sheet = page.getByRole('dialog', { name: 'Describe it' })
  await expect(sheet).toContainText(`Start tracking ${name}`)
  if (website) await sheet.getByLabel('Website').fill(website)
  if (about) await sheet.getByLabel('What it does').fill(about)
  await sheet.getByRole('button', { name: 'Start tracking' }).click()
  await expect(sheet).toHaveCount(0)
}

test('UI-DESC-01 Describe it when adding; From you shows it; editing re-runs the lookup; Undo restores', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page
  await startTracking(page, 'Stackforge', 'http://stackforge.test:4700/', 'Developer tools for AI agents')
  const co = (await rw.inspect('companies')).find((c: any) => c.name === 'Stackforge')
  expect(co.domain, 'the website given is its domain').toBe('stackforge.test')
  await lookupDone(rw, co.id)
  await nav(page, 'Companies')
  await page.locator('main').getByText('Stackforge', { exact: true }).first().click()
  const fy = page.getByTestId('from-you')
  await expect(fy.getByTestId('from-you-website')).toHaveText('stackforge.test')
  await expect(fy.getByTestId('from-you-about')).toHaveText('Developer tools for AI agents')
  await expect(page.getByTestId('lookup-line')).toContainText(/Watching the news for Stackforge|article/)
  // edit: a new "what it does" re-runs the lookup; Undo puts the old words back
  await fy.getByRole('button', { name: 'Edit' }).click()
  await fy.getByLabel('What it does').fill('Agent infrastructure for software teams')
  await fy.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved — Stackforge is being looked up again with your details').first()).toBeVisible()
  await expect(fy.getByTestId('from-you-about')).toHaveText('Agent infrastructure for software teams')
  expect((await rw.inspect('jobs')).filter((j: any) => j.type === 'HYDRATE_OBJECT' && j.idempotency_key === `hydrate:${co.id}`).length, 'a second lookup').toBeGreaterThanOrEqual(2)
  await page.getByRole('button', { name: 'Undo' }).first().click()
  await expect(fy.getByTestId('from-you-about')).toHaveText('Developer tools for AI agents')
  await rw.close()
})

test('UI-DESC-02 nothing found → the hint card asks for a website or a few words and looks again', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page
  await startTracking(page, 'Qzv')
  const co = (await rw.inspect('companies')).find((c: any) => c.name === 'Qzv')
  await lookupDone(rw, co.id)
  await reload(rw)
  await nav(page, 'Companies')
  await page.locator('main').getByText('Qzv', { exact: true }).first().click()
  const hint = page.getByTestId('hint-card')
  await expect(hint).toContainText('Nothing found for Qzv yet')
  await hint.getByLabel('What it does').fill('Contact-center automation')
  await hint.getByRole('button', { name: 'Look again' }).click()
  await expect(page.getByText('Looking for Qzv again with your hint').first()).toBeVisible()
  await expect(page.getByTestId('from-you').getByTestId('from-you-about')).toHaveText('Contact-center automation')
  const jobs = (await rw.inspect('jobs')).filter((j: any) => j.type === 'HYDRATE_OBJECT' && j.idempotency_key === `hydrate:${co.id}`)
  expect(jobs.length, 'the hint re-ran the lookup').toBeGreaterThanOrEqual(2)
  await rw.close()
})

test('UI-DESC-03 a new thesis is matched against facts already stored; a title alone gets a nudge and topic sources', async () => {
  await fixtures.reset()
  const rw = await launch()
  const SW = 'http://signalwire.test:4700/feed.xml'
  const p = await rw.invoke('source.probe', { locator: SW })
  await rw.invoke('source.create', { locator: SW, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  await rw.invoke('ingress.addUrl', { url: 'http://misc.test:4700/claimwise-interview.html' })
  await rw.drain(500_000)
  const th = await rw.invoke('thesis.create', { title: 'AI replacing outsourced support labor' })
  await reload(rw)
  const page = rw.page
  await openThesis(page, 'AI replacing outsourced support labor')
  await expect(page.getByTestId('thesis-desc-nudge')).toBeVisible()
  await expect(page.getByTestId('thesis-source-suggestions')).toContainText('News search: AI replacing outsourced support labor')
  await expect(page.getByTestId('thesis-source-suggestions')).toContainText('Hacker News: AI replacing outsourced support labor')
  await page.getByLabel('Thesis description').fill('AI agents take over outsourced support and back-office work such as customer service and insurance claims intake.')
  // the page saves as you type (debounced): wait for the stored description, then for the match it queued
  await until(async () => ((await rw.inspect('theses', { id: th.id }))[0].description || '').startsWith('AI agents take over') || null, 30_000, 300)
  await until(async () => { const j = (await rw.inspect('jobs')).filter((x: any) => x.type === 'MATCH_THESIS' && String(x.idempotency_key).startsWith(`match_thesis:${th.id}`)); return j.length && j.every((x: any) => ['succeeded', 'failed'].includes(x.status)) ? j : null }, 300_000, 1000)
  await reload(rw)
  await openThesis(page, 'AI replacing outsourced support labor')
  await expect(page.getByTestId('thesis-desc-nudge')).toHaveCount(0)
  await expect(page.getByTestId('thesis-match')).toHaveText(/^Found [1-9]\d* related facts? in [1-9]\d* articles?/)
  const links = (await rw.inspect('relationships', { to_type: 'thesis', to_id: th.id })).filter((r: any) => r.from_type === 'evidence')
  expect(links.length, 'facts linked without reading anything new').toBeGreaterThan(0)
  await rw.close()
})

test('UI-DESC-04 Re-process: the confirm says what it will do; the page says what changed; Describe… on a person', async () => {
  await fixtures.reset()
  const rw = await launch()
  const SW = 'http://signalwire.test:4700/feed.xml'
  const p = await rw.invoke('source.probe', { locator: SW })
  await rw.invoke('source.create', { locator: SW, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  await rw.drain(500_000)
  const co = (await rw.inspect('companies')).filter((c: any) => !c.merged_into_id).find((c: any) => (c.name as string).length > 3)
  expect(co, 'the corpus gave a company').toBeTruthy()
  await reload(rw)
  const page = rw.page
  await nav(page, 'Companies')
  await page.getByRole('button', { name: 'All tracked' }).click()
  await page.locator('main').getByText(co.name, { exact: true }).first().click()
  await page.getByRole('button', { name: 'Re-process', exact: true }).click()
  await expect(page.getByText(new RegExp(`^Look ${co.name} up again and re-read \\d+ articles? about it`)).first()).toBeVisible()
  await page.getByRole('button', { name: 'Re-process', exact: true }).last().click()
  await expect(page.getByText(`Re-processing ${co.name}…`).first()).toBeVisible()
  await rw.drain(500_000)
  await reload(rw)
  await nav(page, 'Companies')
  await page.getByRole('button', { name: 'All tracked' }).click()
  await page.locator('main').getByText(co.name, { exact: true }).first().click()
  await expect(page.getByTestId('reprocess-line')).toHaveText(new RegExp(`^Re-processed ${co.name}`))
  // a person: Describe… on their row saves into their own layer
  const person = (await rw.inspect('people')).find((x: any) => !x.merged_into_id)
  test.skip(!person, 'no person in the corpus')
  await nav(page, 'People')
  await page.getByRole('button', { name: 'All tracked' }).click()
  const row = page.locator('main div').filter({ has: page.getByText(person.name, { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Describe…' }) }).last()
  await row.getByRole('button', { name: 'Describe…' }).click()
  const sheet = page.getByRole('dialog', { name: 'Describe it' })
  await sheet.getByLabel('Who they are').fill('Met at a portfolio dinner; runs growth')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/^Saved/).first()).toBeVisible()
  const det = await rw.invoke('object.details', { type: 'person', id: person.id })
  expect(det.about).toBe('Met at a portfolio dinner; runs growth')
  await rw.close()
})

test('UI-DESC-05 Add person: Describe it first (role, where, how you know them), followed and looked up', async () => {
  await fixtures.reset()
  const rw = await launch()
  const page = rw.page
  await page.keyboard.press('Meta+k')
  await palette(page).getByRole('option', { name: 'Add person…' }).click()
  const sheet = page.getByRole('dialog', { name: 'Describe it' })
  await sheet.getByLabel('Name').fill('Priya Raman')
  await sheet.getByLabel('Who they are').fill('Partner who leads legal AI deals')
  await sheet.getByLabel('Role').fill('Partner')
  await sheet.getByLabel('Where').fill('Northwind Ventures')
  await sheet.getByLabel('How you know them').fill('Met at a seed demo day')
  await sheet.getByRole('button', { name: 'Add person' }).click()
  await expect(sheet).toHaveCount(0)
  const p = await until(async () => (await rw.inspect('people')).find((x: any) => x.name === 'Priya Raman' && x.followed === 1) || null, 30_000, 300)
  const d = (await rw.inspect('object_details', { object_type: 'person', object_id: p.id }))[0]
  expect(d.about).toBe('Partner who leads legal AI deals')
  expect(JSON.parse(d.fields_json)).toMatchObject({ role: 'Partner', org: 'Northwind Ventures', howKnown: 'Met at a seed demo day' })
  // a person is looked up like any followed entity (the rule: following anything hydrates it)
  expect((await rw.inspect('jobs')).some((j: any) => j.type === 'HYDRATE_OBJECT' && j.idempotency_key === `hydrate:${p.id}`)).toBe(true)
  await rw.close()
})

test('UI-DESC-06 an AI summary on the page: grounded, and a sentence resting on your words is marked as yours', async () => {
  await fixtures.reset()
  // the summary is written by the model from this library — a replayed answer can't show the rule on new words
  const rw = await launch({ liveAi: true })
  for (const u of ['http://signalwire.test:4700/lumen-legal-series-a', 'http://signalwire.test:4700/quillmate-amlaw']) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(400_000)
  const co = (await rw.inspect('companies')).find((c: any) => c.name === 'Lumen Legal')
  const mine = 'my favourite legal AI bet for mid-market firms'
  await rw.invoke('ontology.apply', { op: 'object.describe', input: { type: 'company', id: co.id, patch: { about: `Lumen Legal is ${mine}.` } } })
  await rw.invoke('view.customize', { objectType: 'company', objectId: co.id, instruction: 'Add an AI summary section at the top' })
  const sec = async () => (await rw.invoke('object.get', { type: 'company', id: co.id })).main.find((x: any) => x.component === 'summary')
  expect(await sec(), 'the layout has a summary section').toBeTruthy()
  // opening the page starts the summary; it is written in the background
  const done = await until(async () => { const s = await sec(); return s?.data?.text ? s : null }, 300_000, 3000)
  const text: string = done.data.text
  const yours: string[] = done.data.yours || []
  // the user's words never appear as a plain (unmarked) sentence (a sentence may end inside a closing quote: .”)
  for (const sn of text.split(/(?<=[.!?][”"’]?)\s+/)) if (/favourite legal AI bet|mid-market firms/i.test(sn)) expect(yours, `"${sn}" rests on the user's words and is marked`).toContain(sn)
  expect(done.data.rows[0].value).toContain(yours.length ? '(your words)' : text.split(/(?<=[.!?][”"’]?)\s+/)[0])
  await rw.close()
})

