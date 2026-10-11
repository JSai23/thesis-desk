// Real hydration (DEC-088), firms: large, homonym-prone, site-not-named-after-the-firm and small real firms added by name
// only — website, investments with evidence, news watch — then chat corrections (split / merge) on a hydrated firm.
// Results: tests/results/<run>/realdata-hydrate-firms.json.
import { test, expect } from '@playwright/test'
import { launch, type RW } from '../harness/app'
import { DIR, results, hydrated, recorder } from './hydrate-lib'

const { out, save } = results('realdata-hydrate-firms.json')
const record = recorder(out, save)
const FIRMS: { input: string; site: RegExp }[] = [
  { input: 'Sequoia Capital', site: /sequoiacap\.com/ },
  { input: 'Andreessen Horowitz', site: /a16z\.com/ },
  { input: 'Benchmark', site: /benchmark\.com/ },
  { input: 'Founders Fund', site: /foundersfund\.com/ },
  { input: 'Precursor Ventures', site: /precursorvc\.com/ },
  { input: 'Titanium Ventures', site: /^(?:ti\.vc|titaniumventures\.com)$/ } // the user's own example (formerly Telstra Ventures)
]
/** Small, real companies the user tried by hand (2026-10-01). */

test.describe.serial('RD-HYD firms added by name, hydrated from real coverage', () => {
  let rw: RW
  test.beforeAll(async () => {
    test.setTimeout(10 * 60_000)
    rw = await launch({ testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } })
    await rw.invoke('settings.update', { patch: { 'processing.daily_cap': 1000 } })
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  for (const f of FIRMS) {
    test(`RD-HYD-02 firm ${f.input}: site, investments with evidence, news watch`, async () => {
      test.setTimeout(90 * 60_000)
      const c = await rw.invoke('object.create', { type: 'firm', name: f.input })
      const h = await hydrated(rw, 'firm', c.id)
      record(`firm:${f.input}`, c, h)
      expect(h.job.status).toBe('succeeded')
      expect(h.docLinks, 'coverage linked to the firm').toBeGreaterThanOrEqual(2)
      expect(h.row.domain || '', 'its own website').toMatch(f.site)
      expect(h.investments, 'portfolio investments with evidence').toBeGreaterThanOrEqual(1)
      expect(h.crossTypeDupes, 'not also created as a company').toBe(0)
      expect(h.sources.some((s: any) => s.kind === 'search' && s.name.includes(c.name)), 'a news watch keeps it current').toBe(true)
    })
  }

  test('RD-HYD-05 chat corrections on hydrated entities: split a wrongly combined name, merge a duplicate', async () => {
    test.setTimeout(30 * 60_000)
    const tv = (await rw.inspect('firms')).find((x: any) => /titanium ventures/i.test(x.name) && !x.merged_into_id)
    test.skip(!tv, 'Titanium Ventures not hydrated')
    // split: the user says the former name is a different firm (exercise the action; then merge back)
    const p1 = await rw.invoke('correct.parse', { text: 'Telstra Ventures is a different firm from Titanium Ventures, split them' })
    out.correctionSplit = p1; save()
    expect(p1.action).toBe('split_entity')
    await rw.invoke('correct.apply', { proposal: p1 })
    const telstra = (await rw.inspect('firms')).find((x: any) => /telstra ventures/i.test(x.name) && !x.merged_into_id)
    expect(telstra, 'Telstra Ventures exists separately').toBeTruthy()
    const p2 = await rw.invoke('correct.parse', { text: 'Actually Telstra Ventures is the same firm as Titanium Ventures (it rebranded), merge them' })
    out.correctionMerge = p2; save()
    expect(p2.action).toBe('merge_entities')
    await rw.invoke('correct.apply', { proposal: p2 })
    const live = (await rw.inspect('firms')).filter((x: any) => /telstra ventures|titanium ventures/i.test(x.name) && !x.merged_into_id)
    expect(live.length).toBe(1)
  })
})
