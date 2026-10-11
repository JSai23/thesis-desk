// Real briefings (DEC-091): emails are built from reports. On a real library (the RD-BR one: TechCrunch, Crunchbase
// News + 7 days, a Google News funding search), the user creates reports, tags several into one briefing, sends it
// and schedules it; exactly one email per send reaches the user's real Gmail with a part per report whose rows match
// the report runs. Results: tests/results/<run>/realdata-briefings.json.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { preparedLibrary, installEmail, until, ROOT, type RW } from '../harness/app'
import { imapFindMessages, type FoundMessage } from '../harness/imap'

const MIN = 60_000, H = 60 * MIN
const LAUNCH = { testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } }
const SOURCES = ['https://techcrunch.com/category/startups/feed/', 'https://news.crunchbase.com/feed/',
  'https://news.google.com/rss/search?q=%28%22seed+round%22+OR+%22Series+A%22%29+raises+when:7d&hl=en-US&gl=US&ceid=US:en']
const OUT = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev', 'realdata-briefings.json')
const out: Record<string, any> = { started: new Date().toISOString() }
const save = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 2)) }
const norm = (s: string) => (s || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()

// same library as briefs.spec.ts (shared cache name), built by whichever suite runs first
import { buildBriefsLibrary } from './briefs-library'
const build = async (rw: RW) => { await buildBriefsLibrary(rw) }

async function report(rw: RW, text: string, mustCompile = true): Promise<any> {
  const { reportId } = await rw.invoke('report.createFromPrompt', { text })
  await rw.drain(10 * MIN)
  const r = (await rw.invoke('report.list', {})).find((x: any) => x.id === reportId)
  if (mustCompile) expect(r?.status, `report "${text}" compiled`).toBe('active')
  return r
}

test.describe.serial('RD-BRF briefings: one email built from tagged reports', () => {
  let rw: RW
  let reports: any[] = []
  test.beforeAll(async () => {
    test.setTimeout(150 * 60_000)
    rw = await preparedLibrary('realdata-briefs', build, LAUNCH)
    await installEmail(rw)
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('RD-BRF-01 two reports tagged into one briefing → Send now → exactly one email with both reports', async () => {
    test.setTimeout(40 * MIN)
    reports = [await report(rw, 'Startup funding rounds this week with lead investors'), await report(rw, 'New AI product launches and partnerships this week')]
    const b = await rw.invoke('briefing.create', { name: `Morning brief ${Date.now().toString(36)}`, reportIds: reports.map(r => r.id), schedule: { kind: 'weekdays', at: '07:30' } })
    out.briefing = b; save()
    expect(b.reports.map((r: any) => r.id)).toEqual(reports.map(r => r.id))
    expect(b.scheduleText).toBe('Weekdays 7:30')
    const t0 = new Date(Date.now() - 60_000)
    await rw.invoke('briefing.sendNow', { id: b.id })
    await rw.drain(15 * MIN)
    const runs = await rw.invoke('briefing.runs', { id: b.id })
    expect(runs[0].status).toBe('succeeded')
    const reportRuns = await Promise.all(runs[0].reportRunIds.map((id: string) => rw.invoke('report.run', { runId: id })))
    out.reportRuns = reportRuns.map((r: any) => ({ name: r.content.name, rows: r.content.sections.reduce((n: number, s: any) => n + s.rows.length, 0) })); save()
    expect(reportRuns.length).toBe(2)
    // tagged reports don't also email themselves
    for (const rr of reportRuns) expect(rr.deliveredEmailAt || null).toBeNull()
    const msgs = await until(async () => { const m = await imapFindMessages(`Research Workspace · ${b.name} ·`, t0); return m.length ? m : null }, 6 * MIN, 5000) as FoundMessage[]
    out.email = { count: msgs.length, subject: msgs[0].subject }; save()
    expect(msgs.length, 'exactly one email per send').toBe(1)
    const html = norm(msgs[0].html)
    for (const rr of reportRuns) {
      expect(html, `email has a part for "${rr.content.name}"`).toContain(norm(rr.content.name))
      // story layout (DEC-093): each row is a hero/card/"Also" entry linking to its article, headlined by its title
      for (const s of rr.content.sections) for (const row of s.rows.slice(0, 5)) {
        if (row.url) expect(html, `row "${row.text.slice(0, 60)}" links to its article in the email`).toContain(norm(row.url))
        else expect(html, `row "${row.text.slice(0, 60)}" is in the email`).toContain(norm(row.text).slice(0, 40))
      }
    }
    expect((await rw.invoke('briefing.runs', { id: b.id }))[0].emailedAt).toBeTruthy()
  })

  test('RD-BRF-02 the schedule fires once at its time; the report row can be tagged out', async () => {
    test.setTimeout(30 * MIN)
    const b = (await rw.invoke('briefing.list', {})).find((x: any) => x.name.startsWith('Morning brief'))
    // move the fake clock just past the briefing's next weekday 07:30 (the app's own schedule row, app time zone) and tick twice
    const sc = (await rw.inspect('schedules', { kind: 'briefing', target_id: b.id }))[0]
    expect(sc, 'briefing has a schedule').toBeTruthy()
    const at = new Date(sc.next_run_at)
    out.nextRun = at.toISOString(); save()
    await rw.invoke('test.clock.set', { iso: new Date(sc.next_run_at + 30_000).toISOString() })
    await rw.invoke('test.scheduler.tick', {}); await rw.invoke('test.scheduler.tick', {})
    await rw.drain(15 * MIN)
    const runs = (await rw.invoke('briefing.runs', { id: b.id })).filter((r: any) => r.trigger === 'schedule')
    out.scheduled = runs; save()
    expect(runs.length, 'one scheduled send').toBe(1)
    expect(runs[0].status).toBe('succeeded')
    const b2 = await rw.invoke('briefing.setReport', { id: b.id, reportId: reports[1].id, on: false })
    expect(b2.reports.map((r: any) => r.id)).toEqual([reports[0].id])
    await expect(rw.invoke('briefing.setReport', { id: b.id, reportId: reports[0].id, on: false })).rejects.toThrow(/at least one report/)
  })

  test('RD-BRF-03 a briefing whose reports have nothing new sends no email', async () => {
    test.setTimeout(20 * MIN)
    // a thesis nothing in the library covers yet: the report compiles, its sections are empty
    await rw.invoke('thesis.create', { title: 'Antarctic research station logistics' })
    const r = await report(rw, 'Weekly brief on my Antarctic research station logistics thesis: new evidence for and against')
    const b = await rw.invoke('briefing.create', { name: `Empty brief ${Date.now().toString(36)}`, reportIds: [r.id], schedule: { kind: 'none' } })
    const t0 = new Date(Date.now() - 60_000)
    await rw.invoke('briefing.sendNow', { id: b.id }); await rw.drain(10 * MIN)
    const run = (await rw.invoke('briefing.runs', { id: b.id }))[0]
    out.empty = run; save()
    expect(run.deliveryError).toMatch(/nothing new/i)
    await new Promise(r => setTimeout(r, 60_000))
    expect((await imapFindMessages(`Research Workspace · ${b.name} ·`, t0)).length).toBe(0)
  })
})
