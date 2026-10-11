// Real hydration (DEC-088), companies: the Seed → Series E ladder (ground truth picked by an independent judge from this
// month's real funding headlines before the app sees anything), the user's own small company, and reuse of an entity
// the sources already surfaced. Firms are in hydrate-firms.spec.ts (split so the two run in parallel).
// Results: tests/results/<run>/realdata-hydrate.json (+ judge inputs/outputs alongside).
import { test, expect } from '@playwright/test'
import { launch, type RW } from '../harness/app'
import { judge, newsHeadlines } from './judge'
import { DIR, results, hydrated, recorder } from './hydrate-lib'

const { out, save } = results('realdata-hydrate.json')
const record = recorder(out, save)
const STAGES = ['Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Series E']
/** Real firms: large, homonym-prone (Benchmark), site not named after the firm (a16z.com), and small ones. */
// a small company typed in lower case with a second name after a slash (its maker's name)
const USER_COMPANIES = [{ input: 'firecrawl / Mendable', name: /firecrawl/i, press: /^Firecrawl/, alias: /mendable/i, site: /firecrawl\.dev|mendable\.ai/ }]

test.describe.serial('RD-HYD hydrate user-added companies and firms from real coverage', () => {
  let rw: RW
  let ladder: { stage: string; company: string; amount: string; headline: string }[] = []
  test.beforeAll(async () => {
    test.setTimeout(30 * 60_000)
    // ground truth first, independent of the app: one real company per stage from this month's headlines
    const heads: Record<string, any[]> = {}
    for (const st of STAGES) heads[st] = (await newsHeadlines(`raises "${st}" startup when:30d`)).slice(0, 40)
    const pick = judge(DIR, 'hyd-ladder', `For each funding stage below, pick ONE startup whose headline states clearly that it raised that exact round (the round named in the headline, with the startup's name unambiguous). Prefer distinctive names (not common words), real startups (not funds), and headlines that give an amount. Copy the company name exactly as written in the headline.
Output ONLY JSON: {"picks":[{"stage":"Seed","company":"…","amount":"$12M or empty","headline":"…exact headline…"}]}

${STAGES.map(st => `## ${st}\n${heads[st].map(h => `- ${h.title} (${h.publisher}, ${h.date})`).join('\n')}`).join('\n\n')}`)
    ladder = pick.picks.filter((p: any) => STAGES.includes(p.stage) && heads[p.stage].some(h => h.title === p.headline || h.title.includes(p.company)))
    out.ladder = ladder
    save()
    rw = await launch({ testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } })
    await rw.invoke('settings.update', { patch: { 'processing.daily_cap': 1000 } })
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('RD-HYD-01 companies Seed → Series E, added by name only, reach the stage their real news states', async () => {
    test.setTimeout(240 * 60_000)
    expect(ladder.length, 'the judge found a real company for most stages').toBeGreaterThanOrEqual(5)
    const failures: string[] = []
    // one library per company, three at a time: one app reads the six companies' coverage one job after another
    // (27 min in run acc-2026-10-05); separate apps read side by side. The first company stays in the shared library,
    // which RD-HYD-04 needs to have surfaced other companies.
    const one = async (l: typeof ladder[number], i: number) => {
      const app = i === 0 ? rw : await launch({ testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } })
      try {
        if (i) await app.invoke('settings.update', { patch: { 'processing.daily_cap': 1000 } })
        const c = await app.invoke('object.create', { type: 'company', name: l.company })
        const h = await hydrated(app, 'company', c.id)
        const stage = h.fields.find(f => f.key === 'stage')?.display || ''
        const funding = h.ev.filter((e: any) => e.kind === 'funding')
        record(`company:${l.company}`, c, h, { truth: l, stage })
        if (h.job.status !== 'succeeded') failures.push(`${l.company}: hydrate ${h.job.status} ${h.job.error || ''}`)
        if (h.docLinks < 1) failures.push(`${l.company}: no coverage linked`)
        if (!funding.length) failures.push(`${l.company}: no funding evidence`)
        if (stage.toLowerCase() !== l.stage.toLowerCase()) failures.push(`${l.company}: stage "${stage}" ≠ "${l.stage}" (${l.headline})`)
        if (h.crossTypeDupes) failures.push(`${l.company}: also created as a firm`)
      } finally { if (i) await app.close() }
    }
    let next = 0
    await Promise.all([0, 1, 2].map(async () => { while (next < ladder.length) { const i = next++; await one(ladder[i], i) } }))
    out.ladderFailures = failures; save()
    // real news can be ambiguous (a later round reported the same month); allow one miss in six
    expect(failures.filter(f => /stage|no funding|no coverage|hydrate/.test(f)).length, failures.join('\n')).toBeLessThanOrEqual(1)
    expect(failures.filter(f => /also created/.test(f))).toEqual([])
  })

  for (const u of USER_COMPANIES) {
    test(`RD-HYD-03 small company the user added: ${u.input}`, async () => {
      test.setTimeout(90 * 60_000)
      const c = await rw.invoke('object.create', { type: 'company', name: u.input })
      const h = await hydrated(rw, 'company', c.id)
      record(`company:${u.input}`, c, h)
      expect(h.job.status).toBe('succeeded')
      expect(c.name).toMatch(u.name)
      expect(h.row.name, 'a name typed in lower case takes the press spelling').toMatch(u.press)
      expect(h.aliases.join(' | '), 'the slash part is kept as an alias').toMatch(u.alias)
      expect(h.docLinks).toBeGreaterThanOrEqual(2)
      expect(h.ev.length).toBeGreaterThan(0)
      expect(h.row.domain || '').toMatch(u.site)
    })
  }

  test('RD-HYD-04 adding an entity your sources already surfaced reuses it instead of duplicating', async () => {
    test.setTimeout(10 * 60_000)
    const known = (await rw.inspect('companies')).find((x: any) => !x.merged_into_id && x.created_origin === 'source_fact')
    test.skip(!known, 'no auto-created company yet')
    const c = await rw.invoke('object.create', { type: 'company', name: known.name.toUpperCase() })
    expect(c.existing).toBe(true)
    expect(c.id).toBe(known.id)
  })

})
