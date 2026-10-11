// DEC-101, Backlog "Daily reading limit": the limit is visible and settable in Settings (with today's count), the banner
// says why reading stopped and offers Read the rest now / Change limit, and raising the limit reads the waiting
// articles at once — through the UI, on the fixture corpus.
import { test, expect, type Page } from '@playwright/test'
import { launch, until, type RW, reloadApp } from '../harness/app'
import { fixtures } from '../harness/fixtures'

const SW = 'http://signalwire.test:4700/feed.xml'
const reload = async (rw: RW) => { await reloadApp(rw.page) }
const swDocs = async (rw: RW) => (await rw.inspect('documents')).filter((d: any) => /signalwire/.test(d.url || ''))
const parked = async (rw: RW) => (await rw.inspect('jobs', { type: 'PROCESS_DOCUMENT' })).filter((j: any) => j.status === 'queued' && j.error_message === 'daily_cap')

async function capped(): Promise<RW> {
  await fixtures.reset()
  const rw = await launch()
  await rw.invoke('settings.update', { patch: { 'processing.daily_cap': 2 } })
  const p = await rw.invoke('source.probe', { locator: SW })
  await rw.invoke('source.create', { locator: SW, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  await rw.drain(400_000)
  expect((await swDocs(rw)).filter((d: any) => d.status === 'processed').length).toBe(2)
  expect((await parked(rw)).length).toBe(2)
  await reload(rw)
  return rw
}

test('UI-LIMIT-01 the banner says why reading stopped; Read the rest now reads the waiting articles today', async () => {
  const rw = await capped()
  const page = rw.page
  await expect(page.getByText('Reading paused for today — your daily limit of 2 articles is reached (2 waiting)')).toBeVisible()
  await page.getByRole('button', { name: 'Read the rest now' }).click()
  await expect(page.getByText('Reading 2 waiting articles now — the limit is lifted for today').first()).toBeVisible()
  await rw.drain(400_000)
  expect((await swDocs(rw)).filter((d: any) => d.status === 'processed').length, 'all four read').toBe(4)
  expect((await parked(rw)).length).toBe(0)
  await rw.close()
})

test('UI-LIMIT-02 Change limit opens Settings; the limit and today\'s count show; No limit releases the waiting articles', async () => {
  const rw = await capped()
  const page = rw.page
  await page.getByRole('button', { name: 'Change limit' }).click()
  await expect(page.getByText('Daily reading limit', { exact: true })).toBeVisible()
  await expect(page.getByText(/^2 articles read today · stops at 2 a day/)).toBeVisible()
  await page.getByText('No limit', { exact: true }).first().click()
  await expect(page.getByText('No daily reading limit — reading 2 waiting articles').first()).toBeVisible()
  await rw.drain(400_000)
  expect((await swDocs(rw)).filter((d: any) => d.status === 'processed').length).toBe(4)
  expect(await rw.invoke('settings.get', {}).then((s: any) => s['processing.daily_cap']).catch(() => 0)).toBe(0)
  await rw.close()
})
