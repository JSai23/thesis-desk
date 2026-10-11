// Real-data reports, custom briefs, alerts and notifications (DEC-087 style: no fixtures). A clean profile subscribes
// to real funding sources (TechCrunch startups, Crunchbase News, a Google News search for seed/Series A raises) and
// processes what they publish today. A VC associate then writes reports and alerts in plain English (tidy and sloppy),
// edits them, lets the schedule fire, triggers an alert with a real article read once, and throws adversarial requests
// at the app. Assertions check structure, grounding (verbatim quotes in library documents) and consistency — never
// specific facts. Email delivery checks live in their own tests (RD-BR-E*) so they can move to briefings later.
// Results: tests/results/<run>/realdata-briefs.json.
import { test, expect } from '@playwright/test'
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { preparedLibrary, installEmail, until, sleep, ROOT, type RW } from '../harness/app'
import { imapFindMessages, type FoundMessage } from '../harness/imap'
import { buildBriefsLibrary } from './briefs-library'

const MIN = 60_000, H = 60 * MIN, DAY = 24 * H
const TEST_NOW = new Date().toISOString() // fake clock starts at the real time so schedules can be driven forward
const LAUNCH = { testNow: TEST_NOW, env: { RW_REAL_SEARCH: '1' } }
const THESES = ['AI infrastructure', 'AI applications', 'Fintech']
const SOURCES = [
  'https://techcrunch.com/category/startups/feed/',
  'https://news.crunchbase.com/feed/',
  'https://news.google.com/rss/search?q=%28%22seed+round%22+OR+%22Series+A%22%29+raises+when:7d&hl=en-US&gl=US&ceid=US:en'
]
const OUT = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev', 'realdata-briefs.json')
const out: Record<string, any> = { started: new Date().toISOString(), findings: [] as string[] }
// Playwright restarts the worker after a failed test (fresh module state), so results merge into the file on disk.
const save = () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  let prev: Record<string, any> = {}
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch { /* first write */ }
  const merged = { ...prev, ...out, started: prev.started || out.started, findings: [...new Set([...(prev.findings || []), ...out.findings])] }
  fs.writeFileSync(OUT, JSON.stringify(merged, null, 2))
}
const finding = (s: string) => { out.findings.push(s); save() }

// the shared real library (also used by briefings*.spec.ts), built by whichever suite runs first
async function build(rw: RW): Promise<void> {
  const r = await buildBriefsLibrary(rw)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT.replace(/\.json$/, '.sources.json'), JSON.stringify(r, null, 2))
}

// ---------------------------------------------------------------- helpers
const norm = (s: string) => (s || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const reportOf = async (rw: RW, id: string) => (await rw.invoke('report.list', {})).find((r: any) => r.id === id)
const alertOf = async (rw: RW, id: string) => (await rw.invoke('alert.list', {})).find((a: any) => a.id === id)
const thesisId = async (rw: RW, title: string) => (await rw.inspect('theses')).find((t: any) => t.title === title)?.id as string
const jobsDone = (rw: RW, type: string, pred: (p: any) => boolean = () => true) => until(async () => {
  const js = (await rw.inspect('jobs', { type })).filter((j: any) => pred(JSON.parse(j.payload_json || '{}')))
  return js.length && js.every((j: any) => ['succeeded', 'failed', 'cancelled'].includes(j.status)) ? js : null
}, 15 * MIN, 1500) as Promise<any[]>

async function compileReport(rw: RW, text: string): Promise<any> {
  const { reportId } = await rw.invoke('report.createFromPrompt', { text })
  await jobsDone(rw, 'COMPILE_REPORT', p => p.reportId === reportId)
  const r = await reportOf(rw, reportId)
  if (r) return r
  // routed to an alert: the draft report is gone and an alert draft took its text
  const al = (await rw.invoke('alert.list', {})).find((a: any) => a.text === text.trim())
  return { routedToAlert: true, alert: al, id: reportId }
}

async function runReport(rw: RW, id: string): Promise<any> {
  const before = new Set((await rw.invoke('report.runs', { id })).map((x: any) => x.id))
  const { jobId } = await rw.invoke('report.runNow', { id })
  await until(async () => ['succeeded', 'failed'].includes((await rw.inspect('jobs', { id: jobId }))[0]?.status) || null, 10 * MIN, 1500)
  const runs = (await rw.invoke('report.runs', { id })).filter((x: any) => !before.has(x.id))
  expect(runs.length, 'one manual run recorded').toBe(1)
  return rw.invoke('report.run', { runId: runs[0].id })
}

/** Every row cites real evidence whose quote is verbatim in the document version it came from, with the document's URL. */
async function checkGrounding(rw: RW, run: any, label: string): Promise<{ rows: number; withEvidence: number; problems: string[] }> {
  const problems: string[] = []
  let rows = 0, withEvidence = 0
  for (const s of run.content.sections) {
    // a real reader sees one row per deal and never the same sentence twice in a section
    const quotes = s.rows.map((r: any) => norm(r.quote))
    const dq = quotes.filter((q: string, i: number) => quotes.indexOf(q) !== i)
    if (dq.length) finding(`${label}/${s.title}: one source sentence backs several rows (multi-subject sentence): "${dq[0].slice(0, 80)}"`)
    const deals: string[] = []
    for (const row of s.rows) {
      const e = row.evidenceId ? (await rw.inspect('evidence', { id: row.evidenceId }))[0] : null
      if (!e || !['funding', 'investment'].includes(e.kind)) continue
      const pl = payload(e), co = pl.companyId || (pl.subjectType === 'company' ? pl.subjectId : null)
      if (co) deals.push(`${co}|${String(pl.round || '').trim().toLowerCase()}`)
    }
    const dd = deals.filter((d, i) => deals.indexOf(d) !== i)
    if (dd.length) problems.push(`${label}/${s.title}: the same deal is listed twice (${dd[0]})`)
  }
  for (const s of run.content.sections) for (const row of s.rows) {
    rows++
    if (!row.quote) problems.push(`${label}/${s.title}: row without quote: ${row.text}`)
    if (!row.url) problems.push(`${label}/${s.title}: row without source URL: ${row.text}`)
    const doc = row.documentId ? (await rw.inspect('documents', { id: row.documentId }))[0] : null
    if (!doc) { problems.push(`${label}/${s.title}: row's document is not in the library: ${row.text}`); continue }
    if (row.url && row.url !== doc.url && row.url !== doc.canonical_url) problems.push(`${label}/${s.title}: row URL ${row.url} ≠ document URL ${doc.url}`)
    if (!row.evidenceId) { problems.push(`${label}/${s.title}: row has no evidence behind it (quote is not a source quote): ${row.text}`); continue }
    withEvidence++
    const ev = (await rw.inspect('evidence', { id: row.evidenceId }))[0]
    if (!ev || ev.document_id !== row.documentId) { problems.push(`${label}/${s.title}: evidence ${row.evidenceId} missing or from another document`); continue }
    const v = (await rw.inspect('document_versions', { document_id: ev.document_id, version: ev.document_version }))[0]
    if (v.text.slice(ev.quote_start, ev.quote_end) !== ev.quote) problems.push(`${label}: evidence ${ev.id} offsets don't match its quote`)
    if (!norm(doc.text).includes(norm(row.quote))) problems.push(`${label}/${s.title}: quote not verbatim in ${doc.url}: "${row.quote.slice(0, 80)}"`)
  }
  return { rows, withEvidence, problems }
}

const snapshot = (run: any) => run.content.sections.map((s: any) => ({ title: s.title, rows: s.rows.map((r: any) => ({ text: r.text, quote: r.quote, url: r.url, source: r.source })) }))
const evOf = async (rw: RW, id: string) => (await rw.inspect('evidence', { id }))[0]
const payload = (e: any) => JSON.parse(e?.payload_json || '{}')

/** Local (America/Los_Angeles, the app's TZ) weekday/hour/minute of a timestamp. */
function laParts(t: number) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t))
  const g = (k: string) => f.find(p => p.type === k)!.value
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')), hh: Number(g('hour')), mm: Number(g('minute')) }
}
const appNow = async (rw: RW) => (await rw.invoke('test.clock.advance', { ms: 0 })).now as number

// ---------------------------------------------------------------- tests
test.describe('RD-BR real reports, briefs and alerts', () => {
  let rw: RW
  test.beforeEach(async () => { test.setTimeout(150 * 60_000); rw = await preparedLibrary('realdata-briefs', build, LAUNCH) })
  test.afterEach(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('RD-BR-00 a real funding library was built', async () => {
    const docs = await rw.inspect('documents')
    const ev = (await rw.inspect('evidence')).filter((e: any) => e.status === 'active')
    const byStatus: Record<string, number> = {}
    for (const d of docs) byStatus[d.status] = (byStatus[d.status] || 0) + 1
    const byKind: Record<string, number> = {}
    for (const e of ev) byKind[e.kind] = (byKind[e.kind] || 0) + 1
    const firms = (await rw.inspect('firms')).filter((f: any) => !f.merged_into_id)
    out.library = { byStatus, evidence: ev.length, byKind, companies: (await rw.inspect('companies')).length, firms: firms.length,
      firmNames: firms.map((f: any) => f.name).slice(0, 80), sources: { subscribed: (await rw.inspect('sources')).filter((x: any) => x.kind !== 'manual' && !x.deleted_at).map((x: any) => x.locator) } }
    save()
    expect(out.library.sources.subscribed.length).toBeGreaterThanOrEqual(2)
    expect(byStatus.processed || 0).toBeGreaterThanOrEqual(20)
    expect(byKind.funding || 0, 'real funding evidence to report on').toBeGreaterThanOrEqual(5)
  })

  test('RD-BR-01 custom reports from plain English compile to the ask and run grounded', async () => {
    const infra = await thesisId(rw, 'AI infrastructure'), fintech = await thesisId(rw, 'Fintech')
    const firms = (await rw.inspect('firms')).filter((f: any) => !f.merged_into_id)
    const a16z = firms.filter((f: any) => /andreessen|a16z/i.test(f.name)).map((f: any) => f.id)
    const sequoia = firms.filter((f: any) => /sequoia/i.test(f.name)).map((f: any) => f.id)
    out.reports = {}

    // 1. tidy, scheduled, emailed deal brief
    const r1 = await compileReport(rw, 'Every Monday 8am email me a brief of seed and Series A rounds in AI infra with lead investors')
    out.reports.aiInfra = { def: r1.definition, status: r1.status, label: r1.scheduleLabel }
    expect(r1.status).toBe('active')
    // DEC-100: "email me" → its own briefing takes the Monday 8:00 schedule; the report is read in the app
    expect(r1.definition.delivery.email).toBe(false)
    expect(r1.briefings.length).toBe(1)
    const b1 = (await rw.invoke('briefing.list', {})).find((b: any) => b.id === r1.briefings[0].id)
    expect(b1.schedule).toMatchObject({ kind: 'weekly', at: '08:00', weekday: 1 })
    expect(b1.scheduleText).toBe('Mondays 8:00')
    const deal = r1.definition.sections.filter((s: any) => ['evidence', 'firm_investments'].includes(s.query.source) && (s.query.source === 'firm_investments' || (s.query.kinds || []).some((k: string) => ['funding', 'investment'].includes(k))))
    expect(deal.length, 'a deals section').toBeGreaterThan(0)
    for (const s of deal) {
      expect(s.query.stages || [], `${s.title}: limited to Seed/Series A`).toEqual(expect.arrayContaining(['Seed', 'Series A']))
      expect((s.query.stages || []).filter((x: string) => !['Pre-seed', 'Seed', 'Series A'].includes(x)), `${s.title}: no later stages`).toEqual([])
      expect(['7d', 'last_run'], `${s.title}: weekly window`).toContain(s.query.since)
      if (s.query.theses) expect(s.query.theses, `${s.title}: AI infra thesis`).toEqual([infra])
    }
    if (!deal.some((s: any) => s.query.theses?.includes(infra))) finding(`AI-infra brief: no section is scoped to the "AI infrastructure" thesis — "in AI infra" was not applied as a filter (${JSON.stringify(deal.map((s: any) => s.query))})`)
    const run1 = await runReport(rw, r1.id)
    expect(run1.status).toBe('succeeded')
    const g1 = await checkGrounding(rw, run1, 'aiInfra')
    out.reports.aiInfra.run = snapshot(run1); out.reports.aiInfra.grounding = g1
    // rows of stage-filtered sections really are Seed/Series A funding facts
    for (const s of run1.content.sections) for (const row of s.rows) {
      const sec = r1.definition.sections.find((x: any) => x.id === s.id)
      if (!sec?.query.stages || !row.evidenceId) continue
      const e = await evOf(rw, row.evidenceId)
      if (sec.query.kinds) expect(sec.query.kinds, `row kind ${e.kind}`).toContain(e.kind)
      const round = String(payload(e).round || '')
      if (round && !/unknown/i.test(round)) expect(sec.query.stages.map((x: string) => x.toLowerCase()), `row round "${round}": ${row.text}`).toContain(round.toLowerCase())
    }
    expect(g1.problems.filter(p => !/no evidence behind it/.test(p)), 'AI-infra brief grounding').toEqual([])
    save()

    // 2. firm-focused question, on demand
    const r2 = await compileReport(rw, 'what did a16z and Sequoia invest in this week')
    out.reports.firms = { def: r2.definition, status: r2.status, lastError: r2.lastError, a16zInLibrary: a16z.length, sequoiaInLibrary: sequoia.length }
    save()
    if (!a16z.length && !sequoia.length) {
      // neither firm is in the library: the honest answer is "no coverage yet", not a generic investments report
      expect(r2.status, 'no coverage of a16z/Sequoia → the app says so').toBe('failed')
      expect(r2.lastError).toMatch(/a16z|andreessen|sequoia/i)
    }
    if (r2.status === 'failed') { expect(a16z.length && sequoia.length, `"${r2.lastError}" although both firms are in the library`).toBeFalsy(); if (a16z.length || sequoia.length) finding(`firm brief refused although one firm is covered: ${r2.lastError}`) }
  if (r2.status === 'active') {
    expect(r2.definition.schedule.kind, 'no schedule asked').toBe('none')
    expect(r2.definition.delivery.email, 'no email asked').toBe(false)
    const want = [...a16z, ...sequoia]
    const usedFirms = r2.definition.sections.flatMap((s: any) => s.query.firms || [])
    if (want.length) expect(usedFirms.length, 'firm filter applied').toBeGreaterThan(0)
    for (const f of usedFirms) expect(want, 'only the asked firms').toContain(f)
    const run2 = await runReport(rw, r2.id)
    expect(run2.status).toBe('succeeded')
    const g2 = await checkGrounding(rw, run2, 'firms')
    out.reports.firms.run = snapshot(run2); out.reports.firms.grounding = g2
    // every row must be about a16z or Sequoia — rows about other investors would answer a question the user didn't ask
    const offTopic: string[] = []
    for (const s of run2.content.sections) for (const row of s.rows) {
      const e = row.evidenceId ? await evOf(rw, row.evidenceId) : null
      const about = /a16z|andreessen|sequoia/i.test(`${row.text} ${row.quote}`) || want.some(id => (e?.payload_json || '').includes(id))
      if (!about) offTopic.push(`${s.title}: ${row.text}`)
    }
    out.reports.firms.offTopic = offTopic
    save()
    expect(offTopic, 'firm brief rows are about a16z/Sequoia').toEqual([])
    expect(g2.problems.filter(p => !/no evidence behind it/.test(p))).toEqual([])
  }

    // 3. sloppy thesis brief
    const r3 = await compileReport(rw, 'weekly thing on my fintech thesis pls, fridays — whats new + anything arguing against it. send to my email')
    out.reports.thesis = { def: r3.definition, status: r3.status, label: r3.scheduleLabel }
    expect(r3.status).toBe('active')
    // "send to my email" → its briefing takes the Friday schedule (DEC-100)
    expect(r3.definition.delivery.email).toBe(false)
    expect(r3.briefings.length).toBe(1)
    const b3 = (await rw.invoke('briefing.list', {})).find((b: any) => b.id === r3.briefings[0].id)
    expect(b3.schedule.kind).toBe('weekly')
    expect(b3.schedule.weekday).toBe(5)
    for (const s of r3.definition.sections) if (s.query.theses) expect(s.query.theses, `${s.title}: fintech only`).toEqual([fintech])
    expect(r3.definition.sections.some((s: any) => s.query.theses?.includes(fintech)), 'scoped to the fintech thesis').toBe(true)
    expect(r3.definition.sections.some((s: any) => s.query.source === 'thesis_contra'), 'an "against" section').toBe(true)
    const run3 = await runReport(rw, r3.id)
    expect(run3.status).toBe('succeeded')
    const g3 = await checkGrounding(rw, run3, 'thesis')
    out.reports.thesis.run = snapshot(run3); out.reports.thesis.grounding = g3
    // thesis-scoped rows: the evidence really is linked to the fintech thesis (and contra rows challenge it)
    for (const s of run3.content.sections) {
      const sec = r3.definition.sections.find((x: any) => x.id === s.id)
      if (!sec?.query.theses) continue
      for (const row of s.rows) {
        const links = (await rw.inspect('relationships', { from_type: 'evidence', from_id: row.evidenceId, to_type: 'thesis' })).filter((l: any) => ['accepted', 'suggested'].includes(l.status))
        expect(links.some((l: any) => l.to_id === fintech), `${s.title}: "${row.text}" is linked to Fintech`).toBe(true)
        if (sec.query.source === 'thesis_contra') expect(links.some((l: any) => l.to_id === fintech && l.stance === 'contra'), `${row.text} challenges Fintech`).toBe(true)
      }
    }
    expect(g3.problems.filter(p => !/no evidence behind it/.test(p))).toEqual([])
    for (const g of [g1, g3]) for (const p of g.problems.filter(p => /no evidence behind it/.test(p))) finding(p)
    save()
  })

  test('RD-BR-02 editing a report (rename, schedule, add and remove sections) shows in the next run', async () => {
    const r = await compileReport(rw, 'Daily at 7am: top funding rounds from my sources')
    expect(r.status).toBe('active')
    const d0 = r.definition
    out.edit = { d0 }
    await rw.invoke('report.rename', { id: r.id, name: 'Morning deal sheet' })
    let cur = await reportOf(rw, r.id)
    expect(cur.name).toBe('Morning deal sheet'); expect(cur.definition.name).toBe('Morning deal sheet')

    const refine = async (text: string) => {
      await rw.invoke('report.refine', { id: r.id, text })
      await jobsDone(rw, 'COMPILE_REPORT', p => p.reportId === r.id && p.mode === 'refine')
      await until(async () => (await reportOf(rw, r.id)).pendingRefinement === null || null, 5 * MIN, 1000)
      const x = await reportOf(rw, r.id)
      expect(x.lastError, `refine "${text}"`).toBeNull()
      return x
    }
    cur = await refine('actually make it thursdays 9am instead, not daily')
    out.edit.d1 = cur.definition
    expect(cur.definition.schedule).toEqual({ kind: 'weekly', at: '09:00', weekday: 4 })
    expect(cur.name, 'a schedule change keeps the name I gave it').toBe('Morning deal sheet')
    const sc = (await rw.inspect('schedules', { kind: 'report', target_id: r.id }))[0]
    expect(laParts(sc.next_run_at)).toEqual({ weekday: 4, hh: 9, mm: 0 })

    const n1 = cur.definition.sections.length
    cur = await refine('also add a section for new AI product launches')
    out.edit.d2 = cur.definition
    expect(cur.definition.sections.length).toBe(n1 + 1)
    const launches = cur.definition.sections.find((s: any) => (s.query.kinds || []).includes('product_launch'))
    expect(launches, 'a product-launch section').toBeTruthy()
    expect(cur.definition.sections.filter((s: any) => d0.sections.some((o: any) => o.id === s.id)).length, 'existing sections kept').toBe(n1)

    const victim = cur.definition.sections.find((s: any) => s.id !== launches.id)
    cur = await refine(`drop the "${victim.title}" part`)
    out.edit.d3 = cur.definition
    expect(cur.definition.sections.some((s: any) => s.id === victim.id)).toBe(false)
    expect(cur.definition.sections.some((s: any) => s.id === launches.id), 'the new section survives').toBe(true)
    expect(cur.name).toBe('Morning deal sheet')

    const run = await runReport(rw, r.id)
    out.edit.run = snapshot(run)
    expect(run.status).toBe('succeeded')
    expect(run.content.name).toBe('Morning deal sheet')
    expect(run.content.sections.map((s: any) => s.title)).toEqual(cur.definition.sections.map((s: any) => s.title))
    expect(run.markdown).toContain('# Morning deal sheet')
    expect(run.markdown).not.toContain(`## ${victim.title}\n`)
    for (const s of run.content.sections) {
      const sec = cur.definition.sections.find((x: any) => x.id === s.id)
      for (const row of s.rows) if (sec.query.kinds && row.evidenceId) expect(sec.query.kinds, `${s.title}: ${row.text}`).toContain((await evOf(rw, row.evidenceId)).kind)
    }
    const g = await checkGrounding(rw, run, 'edit')
    expect(g.problems.filter(p => !/no evidence behind it/.test(p))).toEqual([])
    // undo steps back through the refinements
    await rw.invoke('report.undo', { id: r.id })
    expect((await reportOf(rw, r.id)).definition.sections.some((s: any) => s.id === victim.id), 'undo restores the removed section').toBe(true)
    save()
  })

  test('RD-BR-03 the schedule fires once at the scheduled time (no double run, no catch-up repeat)', async () => {
    await rw.invoke('settings.update', { patch: { pause_polling: true } }) // keep the 4-day jump from re-syncing every source
    const r = await compileReport(rw, 'every monday at 8am give me the week’s seed and series A deals')
    expect(r.status).toBe('active')
    expect(r.definition.schedule).toEqual({ kind: 'weekly', at: '08:00', weekday: 1 })
    const sc = (await rw.inspect('schedules', { kind: 'report', target_id: r.id }))[0]
    expect(sc.enabled).toBe(1)
    expect(laParts(sc.next_run_at)).toEqual({ weekday: 1, hh: 8, mm: 0 })
    const t = await appNow(rw)
    expect(sc.next_run_at - t).toBeLessThanOrEqual(7 * DAY)
    // just before: nothing
    await rw.invoke('test.clock.advance', { ms: sc.next_run_at - t - 2 * MIN })
    await rw.invoke('test.scheduler.tick', {})
    expect((await rw.inspect('jobs', { type: 'RUN_REPORT' })).filter((j: any) => JSON.parse(j.payload_json).reportId === r.id && JSON.parse(j.payload_json).trigger !== 'preview')).toEqual([])
    // on time (+1 min): exactly one scheduled run, even with repeated ticks and the 30 s timer
    await rw.invoke('test.clock.advance', { ms: 3 * MIN })
    await rw.invoke('test.scheduler.tick', {}); await rw.invoke('test.scheduler.tick', {})
    await sleep(35_000)
    const jobs = await jobsDone(rw, 'RUN_REPORT', p => p.reportId === r.id && p.trigger !== 'preview')
    out.schedule = { jobs: jobs.map((j: any) => ({ status: j.status, payload: JSON.parse(j.payload_json) })) }
    expect(jobs.length, 'RUN_REPORT enqueued once').toBe(1)
    expect(JSON.parse(jobs[0].payload_json)).toMatchObject({ trigger: 'schedule', late: false, scheduledFor: sc.next_run_at })
    let runs = await rw.invoke('report.runs', { id: r.id })
    expect(runs.length).toBe(1)
    expect(runs[0]).toMatchObject({ trigger: 'schedule', late: false, status: 'succeeded' })
    const next = (await rw.inspect('schedules', { kind: 'report', target_id: r.id }))[0].next_run_at
    expect(next - sc.next_run_at, 'next occurrence is a week later').toBe(7 * DAY)
    // restart right after: the occurrence already ran, so catch-up must not run it again
    rw = await rw.restart()
    await sleep(5000)
    await rw.drain(5 * MIN)
    runs = await rw.invoke('report.runs', { id: r.id })
    out.schedule.afterRestart = runs.map((x: any) => x.trigger)
    expect(runs.length, 'no catch-up duplicate after restart').toBe(1)
    const g = await checkGrounding(rw, await rw.invoke('report.run', { runId: runs[0].id }), 'scheduled')
    expect(g.problems.filter(p => !/no evidence behind it/.test(p))).toEqual([])
    save()
  })

  test('RD-BR-04 alerts compile to what was asked and backtests agree with the library', async () => {
    const ev = (await rw.inspect('evidence')).filter((e: any) => e.status === 'active')
    const docs = new Map((await rw.inspect('documents')).map((d: any) => [d.id, d]))
    const t = await appNow(rw)
    const recent = ev.filter((e: any) => (docs.get(e.document_id)?.published_at ?? e.created_at) >= t - 30 * DAY)
    const distinct = (xs: any[]) => new Set(xs.map((e: any) => e.fingerprint || e.id)).size
    const firms = (await rw.inspect('firms')).filter((f: any) => !f.merged_into_id)
    const a16z = firms.filter((f: any) => /andreessen|a16z/i.test(f.name)).map((f: any) => f.id)
    out.alerts = {}
    const compile = async (text: string) => {
      const { alertId } = await rw.invoke('alert.compile', { text })
      await jobsDone(rw, 'COMPILE_ALERT', p => p.alertId === alertId)
      const a = await alertOf(rw, alertId)
      const rule = JSON.parse((await rw.inspect('alert_rules', { id: alertId }))[0].rule_json || 'null')
      out.alerts[text] = { status: a.status, name: a.name, summary: a.summary, backtest: a.backtestCount, rule, lastError: a.lastError }
      save()
      return { a, rule }
    }
    // kinds-only rule: the backtest must equal the library count exactly
    const acq = await compile('let me know whenever a startup gets acquired')
    expect(acq.a.status).toBe('compiled')
    expect(acq.rule.filters.kinds).toEqual(['acquisition'])
    const acqOnlyKinds = Object.keys(acq.rule.filters).filter(k => !['kinds', 'novelOnly'].includes(k)).length === 0 && !acq.rule.semanticCondition
    const acqExpected = distinct(recent.filter((e: any) => e.kind === 'acquisition' && (!acq.rule.filters.novelOnly || e.is_novel)))
    if (acqOnlyKinds) expect(acq.a.backtestCount, 'acquisition backtest = acquisition facts in the last 30 days').toBe(acqExpected)
    else expect(acq.a.backtestCount).toBeLessThanOrEqual(acqExpected)
    expect(acq.a.summary).toMatch(/acquisition/i)

    const big = await compile('tell me when any AI startup raises a Series A or bigger')
    expect(big.a.status).toBe('compiled')
    expect(big.rule.filters.kinds).toEqual(expect.arrayContaining(['funding']))
    expect(big.rule.filters.stages || [], 'Series A and later').toEqual(expect.arrayContaining(['Series A', 'Series B', 'Series C']))
    expect((big.rule.filters.stages || []).filter((s: string) => ['Pre-seed', 'Seed'].includes(s)), 'not seed').toEqual([])
    const fundingRecent = recent.filter((e: any) => big.rule.filters.kinds.includes(e.kind) && (!big.rule.filters.novelOnly || e.is_novel))
    expect(big.a.backtestCount).toBeLessThanOrEqual(distinct(fundingRecent))
    // independent lower-bound: funding facts whose own round says Series A+ (and no entity/thesis filter) must all be counted
    if (!big.rule.filters.theses && !big.rule.filters.companies && !big.rule.filters.scope) {
      const stated = fundingRecent.filter((e: any) => big.rule.filters.stages.map((s: string) => s.toLowerCase()).includes(String(payload(e).round || '').toLowerCase()))
      expect(big.a.backtestCount, 'every stated Series A+ round is counted').toBeGreaterThanOrEqual(distinct(stated))
      out.alerts.bigStatedRounds = distinct(stated)
    }
    if (big.rule.semanticCondition) finding(`"${'tell me when any AI startup raises a Series A or bigger'}": backtest says ${big.a.backtestCount} matches in 30 days, but that count ignores the AI check ("${big.rule.semanticCondition}") — the confirm sheet overstates how often it will fire`)
    if (!big.rule.semanticCondition && !big.rule.filters.theses) finding(`"any AI startup raises a Series A or bigger": compiled without any AI constraint (${big.a.summary}) — non-AI rounds will notify`)

    const lead = await compile('alert me when a16z leads a round')
    if (a16z.length) {
      expect(lead.a.status).toBe('compiled')
      expect(lead.rule.filters.investorFirms, 'a16z as investor').toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(a16z.join('|')))]))
      expect(lead.rule.filters.investorRole).toBe('lead')
      const pool = recent.filter((e: any) => ['funding', 'investment'].includes(e.kind) && a16z.some((id: string) => e.payload_json.includes(id)))
      expect(lead.a.backtestCount).toBeLessThanOrEqual(distinct(pool))
    } else {
      // a16z isn't in the library yet: say so, or keep the a16z constraint — never "any round"
      if (lead.a.status === 'failed') expect(lead.a.lastError).toMatch(/a16z|andreessen/i)
      else expect(/a16z|andreessen/i.test(`${lead.rule.semanticCondition || ''} ${lead.a.summary}`), `compiled to "${lead.a.summary}" — would fire on every round`).toBe(true)
    }

    const vague = await compile('ping me about interesting stuff')
    out.alerts.vagueNote = 'vague request'
    const unconstrained = vague.rule && Object.keys(vague.rule.filters).filter(k => k !== 'novelOnly').length === 0 && !vague.rule.semanticCondition
    if (vague.a.status === 'failed') expect(vague.a.lastError, 'the user is told why').toBeTruthy()
    else {
      expect(unconstrained, 'a vague alert is not compiled to "every new fact"').toBe(false)
      if (vague.a.backtestCount > 20) finding(`vague alert "ping me about interesting stuff" compiled to "${vague.a.summary}" and would have fired ${vague.a.backtestCount} times in 30 days`)
    }

    // a notify-style request typed into the report box is routed to an alert
    const alertsBefore = new Set((await rw.invoke('alert.list', {})).map((a: any) => a.id))
    const routed = await compileReport(rw, 'notify me whenever a fintech company announces an acquisition')
    if (routed.routedToAlert) routed.alert = (await rw.invoke('alert.list', {})).find((a: any) => !alertsBefore.has(a.id))
    out.alerts.routed = { routedToAlert: !!routed.routedToAlert, alertStatus: routed.alert?.status }
    expect(routed.routedToAlert, 'a "notify me when" report request becomes an alert').toBe(true)
    await jobsDone(rw, 'COMPILE_ALERT', p => p.alertId === routed.alert.id)
    const ra = await alertOf(rw, routed.alert.id)
    expect(ra.status).toBe('compiled')
    out.alerts.routed.summary = ra.summary
    save()
  })

  test('RD-BR-05 a real new funding article read once triggers one notification; cooldown and dedupe hold', async () => {
    test.setTimeout(150 * 60_000)
    const { alertId } = await rw.invoke('alert.compile', { text: 'tell me when a startup raises a round' })
    await jobsDone(rw, 'COMPILE_ALERT', p => p.alertId === alertId)
    const rule = await rw.invoke('alert.activate', { id: alertId, channels: ['in_app'] })
    expect(rule.status).toBe('active')
    const ruleJson = JSON.parse((await rw.inspect('alert_rules', { id: alertId }))[0].rule_json)
    expect(ruleJson.filters.kinds).toEqual(expect.arrayContaining(['funding']))
    expect(Object.keys(ruleJson.filters).filter(k => !['kinds', 'novelOnly'].includes(k)), 'a plain "raises a round" rule has no other filters').toEqual([])
    expect(ruleJson.semanticCondition ?? null).toBeNull()
    const osBefore = Number(JSON.parse((await rw.inspect('settings', { key: 'test.os_notifications' }))[0]?.value_json || '0'))
    const candidates = await freshFundingArticles(rw, 6)
    out.trigger = { candidates: candidates.map(c => c.url), tried: [] as any[] }
    save()
    expect(candidates.length, 'real recent funding articles not yet in the library').toBeGreaterThan(0)
    let fired: any = null, second: any = null
    for (const c of candidates) {
      const res = await rw.raw('ingress.addUrl', { url: c.url })
      if (!res.ok) { out.trigger.tried.push({ url: c.url, error: res.code }); continue }
      const docId = res.data.documentId
      const doc = await until(async () => { const d = (await rw.inspect('documents', { id: docId }))[0]; return ['processed', 'duplicate', 'triaged_out', 'failed'].includes(d?.status) ? d : null }, 15 * MIN, 2000)
      if (doc.status === 'processed') await jobsDone(rw, 'EVALUATE_ALERTS', p => p.documentId === docId)
      const evs = (await rw.inspect('evidence', { document_id: docId })).filter((e: any) => e.status === 'active')
      const ns = await rw.inspect('notifications', { alert_rule_id: alertId, document_id: docId })
      const funding = evs.filter((e: any) => ruleJson.filters.kinds.includes(e.kind))
      const novelFunding = funding.filter((e: any) => !ruleJson.filters.novelOnly || e.is_novel)
      out.trigger.tried.push({ url: c.url, title: doc.title, status: doc.status, evidence: evs.length, funding: funding.length, novelFunding: novelFunding.length, notifications: ns.map((n: any) => ({ title: n.title, body: n.body, suppressed: n.suppressed_reason })) })
      save()
      // consistency: novel funding evidence ⇔ a notification for this rule (one per evidence)
      if (!fired) {
        expect(ns.length, `${c.url}: one notification per novel matching fact`).toBe(novelFunding.length)
        if (ns.length) {
          fired = { docId, ns }
          expect(ns.filter((n: any) => !n.suppressed_reason).length, 'exactly one delivered; the rest are within cooldown').toBe(1)
          for (const n of ns.filter((n: any) => n.suppressed_reason)) expect(n.suppressed_reason).toBe('cooldown')
        }
      } else {
        expect(ns.length).toBe(novelFunding.length)
        if (ns.length) { second = { docId, ns }; for (const n of ns) expect(n.suppressed_reason, 'second article within 6 h is suppressed by cooldown').toBe('cooldown'); break }
      }
    }
    expect(fired, 'a real funding article fired the alert').toBeTruthy()
    const delivered = fired.ns.find((n: any) => !n.suppressed_reason)
    expect(delivered.delivered_in_app_at).toBeTruthy()
    expect(delivered.title).toBe(rule.name)
    expect(delivered.body.length).toBeGreaterThan(10)
    const fi = (await rw.inspect('feed_items', { document_id: fired.docId }))[0]
    expect(fi.group_key, 'the item moved to Today ▸ Important').toBe('important')
    expect(JSON.parse(fi.reasons_json).some((x: any) => x.type === 'alert')).toBe(true)
    const osAfter = Number(JSON.parse((await rw.inspect('settings', { key: 'test.os_notifications' }))[0]?.value_json || '0'))
    expect(osAfter - osBefore, 'one macOS notification (cooldown-suppressed ones are silent)').toBe(1)
    // reading the same article again creates nothing new
    const total = (await rw.inspect('notifications', { alert_rule_id: alertId })).length
    const url = (await rw.inspect('documents', { id: fired.docId }))[0].url
    await rw.raw('ingress.addUrl', { url }); await sleep(5000); await rw.drain(5 * MIN)
    expect((await rw.inspect('notifications', { alert_rule_id: alertId })).length, 'same URL again → no duplicate notification').toBe(total)
    out.trigger.second = second ? 'cooldown verified on a second real article' : 'no second matching article among candidates'
    save()
  })

  test('RD-BR-06 adversarial requests are answered honestly: no crash, no invented rows, no empty email', async () => {
    out.adversarial = {}
    // empty / whitespace
    for (const text of ['', '   ', '\n\t']) {
      const res = await rw.raw('report.createFromPrompt', { text })
      out.adversarial[`report:${JSON.stringify(text)}`] = res.ok ? res.data : { code: res.code }
      expect(res.ok, `report.createFromPrompt(${JSON.stringify(text)}) is refused`).toBe(false)
      expect(res.code).toBe('VALIDATION')
      const ares = await rw.raw('alert.compile', { text })
      expect(ares.ok, `alert.compile(${JSON.stringify(text)}) is refused`).toBe(false)
    }
    expect((await rw.invoke('report.list', {})).filter((r: any) => !r.templateKey && !(r.promptText || '').trim()), 'no blank report rows').toEqual([])

    const honest = async (key: string, text: string) => {
      const r = await compileReport(rw, text)
      const rec: any = { status: r.status, lastError: r.lastError, def: r.definition, routedToAlert: !!r.routedToAlert }
      out.adversarial[key] = rec; save()
      return r
    }
    // garbage
    const garbage = await honest('garbage', 'asdkjh qwe zzz ???')
    expect(garbage.status, 'garbage → the app says it couldn’t understand instead of building a report').toBe('failed')
    expect(garbage.lastError, 'the user is told why').toBeTruthy()

    // contradictory schedule
    const contra = await honest('contradictory', 'daily every Friday at 9am send me deals')
    expect(['active', 'failed']).toContain(contra.status)
    if (contra.status === 'active') {
      // "send me" → its briefing carries the schedule (DEC-100); otherwise the report does
      const sched = contra.briefings.length ? (await rw.invoke('briefing.list', {})).find((b: any) => b.id === contra.briefings[0].id).schedule : contra.definition.schedule
      expect(['daily', 'weekly']).toContain(sched.kind)
      if (sched.kind === 'weekly') expect(sched.weekday).toBe(5)
      expect(sched.at).toBe('09:00')
      finding(`"daily every Friday" was silently resolved to ${contra.scheduleLabel} without asking`)
    }

    // unsupported channel
    const sms = await honest('sms', 'text me the top deals every morning at 7')
    if (sms.status === 'active') {
      expect(sms.definition.delivery.email, 'SMS is not silently turned into email').toBe(false)
      finding(`"text me …" created an active in-app report (${sms.scheduleLabel}, ${sms.channels.join('+')}) with no word that texting isn't supported`)
    }
    expect(sms.status === 'failed' ? !!sms.lastError : true).toBe(true)

    // a company with no coverage in the library
    const ghost = await honest('noCoverage', 'weekly brief on Zyqoria Robotics — funding, hires, launches. email it to me mondays')
    if (ghost.status === 'active') {
      const run = await runReport(rw, ghost.id)
      const rows = run.content.sections.flatMap((s: any) => s.rows)
      out.adversarial.noCoverage.run = snapshot(run)
      save()
      expect(rows.filter((x: any) => !/zyqoria/i.test(`${x.text} ${x.quote}`)).map((x: any) => x.text), 'a brief about a company with no coverage lists no rows about other companies').toEqual([])
    } else expect(ghost.lastError, 'the user is told there is no coverage').toBeTruthy()

    // a topic no thesis covers: the filters can't express it, so the app must say so rather than list everything
    const topic = await honest('unexpressibleTopic', 'email me every day at 6am any acquisitions of quantum computing startups in Antarctica')
    if (topic.status === 'active') {
      const run = await runReport(rw, topic.id)
      out.adversarial.unexpressibleTopic.run = snapshot(run); save()
      expect(run.content.sections.flatMap((x: any) => x.rows).filter((x: any) => !/quantum/i.test(`${x.text} ${x.quote}`)).map((x: any) => x.text), 'rows ignore the asked topic').toEqual([])
    } else expect(topic.lastError).toBeTruthy()

    // a run with nothing to say must not send an email
    await rw.invoke('thesis.create', { title: 'Quantum computing' })
    const empty = await honest('emptyEmail', 'email me every day at 6am the evidence against my quantum computing thesis')
    expect(empty.status).toBe('active')
    expect(empty.definition.delivery.email, 'reports never email on their own (DEC-100)').toBe(false)
    expect(empty.briefings.length, 'it is emailed through its briefing').toBe(1)
    if (empty.status === 'active') {
      // the briefing sends it: with nothing new in its report, no email goes out
      const bid = empty.briefings[0].id
      await rw.invoke('briefing.sendNow', { id: bid })
      const br = await until(async () => { const x = (await rw.invoke('briefing.runs', { id: bid }))[0]; return x && x.status !== 'running' ? x : null }, 10 * MIN, 2000)
      const run = await rw.invoke('report.run', { runId: br.reportRunIds[0] })
      const rows = run.content.sections.flatMap((s: any) => s.rows)
      out.adversarial.emptyEmail.rows = rows.length
      expect(rows.length, 'a brand-new thesis has no contradicting evidence').toBe(0)
      if (rows.length === 0) {
        await sleep(3000)
        out.adversarial.emptyEmail.briefingRun = br
        save()
        expect(br.emailedAt, 'no email for a send with nothing new').toBeFalsy()
        expect(br.deliveryError).toBe('Nothing new · no email sent')
      }
    }
    // alerts: garbage and impossible requests
    for (const text of ['asdkjh qwe zzz', 'alert me by SMS when anything happens']) {
      const { alertId } = await rw.invoke('alert.compile', { text })
      await jobsDone(rw, 'COMPILE_ALERT', p => p.alertId === alertId)
      const a = await alertOf(rw, alertId)
      const rule = JSON.parse((await rw.inspect('alert_rules', { id: alertId }))[0].rule_json || 'null')
      out.adversarial[`alert:${text}`] = { status: a.status, summary: a.summary, backtest: a.backtestCount, lastError: a.lastError, rule }
      save()
      expect(['compiled', 'failed']).toContain(a.status)
      if (a.status === 'failed') expect(a.lastError, `"${text}": the user is told why`).toBeTruthy()
      if (a.status === 'compiled') {
        const unconstrained = Object.keys(rule.filters).filter(k => k !== 'novelOnly').length === 0 && !rule.semanticCondition
        expect(unconstrained, `"${text}" is not compiled to "notify on every new fact"`).toBe(false)
      }
    }
    // nothing crashed
    expect((await rw.raw('app.status', {})).ok).toBe(true)
  })

  // ---------------------------------------------------------------- email delivery (per-report today; briefings later)
  test('RD-BR-E1 "email me…" puts the report in its own briefing; the briefing\'s email matches the run rows (DEC-100)', async () => {
    const r = await compileReport(rw, 'email me the latest startup funding rounds and who led them')
    expect(r.status).toBe('active')
    expect(r.definition.delivery.email, 'a report never emails on its own').toBe(false)
    expect(r.briefings.length, 'it is in one briefing').toBe(1)
    const b = r.briefings[0]
    const t0 = new Date()
    await rw.invoke('briefing.sendNow', { id: b.id })
    const br = await until(async () => { const x = (await rw.invoke('briefing.runs', { id: b.id }))[0]; return x && x.status !== 'running' && (x.emailedAt || x.deliveryError) ? x : null }, 15 * MIN, 3000)
    expect(br.deliveryError, 'the briefing emailed').toBeFalsy()
    const run = await rw.invoke('report.run', { runId: br.reportRunIds[0] })
    const rows = run.content.sections.flatMap((s: any) => s.rows)
    expect(rows.length, 'the brief has content').toBeGreaterThan(0)
    const msgs = await until(async () => { const m = await imapFindMessages(`Research Workspace · ${b.name} ·`, t0); return m.length ? m : null }, 5 * MIN, 5000) as FoundMessage[]
    out.email1 = { subject: msgs.map(m => m.subject), count: msgs.length, rows: rows.length }
    save()
    expect(msgs.length, 'exactly one email for one send').toBe(1)
    const m = msgs[0]
    for (const s of run.content.sections) {
      expect(m.html).toContain(esc(s.title))
      for (const row of s.rows) {
        if (!row.url) expect(m.html, `email HTML has row "${row.text}"`).toContain(esc(row.text).slice(0, 40))
        expect(m.text.includes(row.text) || (!!row.url && m.text.includes(row.url)), `text part has row "${row.text.slice(0, 60)}"`).toBe(true)
        if (row.url) expect(m.html).toContain(esc(row.url))
      }
    }
    // no extra rows: every article the email links to is a row of this run (story cards, lede citations, chart labels, deep-dive background)
    const rowUrls = new Set([...rows, ...run.content.sections.flatMap((s: any) => s.background || [])].map((r: any) => r.url).filter(Boolean).map((u: string) => esc(u)))
    const hrefs = [...new Set([...m.html.matchAll(/href="(https?:[^"]+)"/g)].map(x => x[1]))]
    expect(hrefs.filter(h => !rowUrls.has(h)), 'no extra rows in the email').toEqual([])
  })

  test('RD-BR-E2 "every weekday at 7:30 email me…": the briefing takes the schedule and sends exactly one email; the report sends none', async () => {
    await rw.invoke('settings.update', { patch: { pause_polling: true } })
    const r = await compileReport(rw, 'Every weekday at 7:30am email me new seed rounds')
    expect(r.status).toBe('active')
    expect(r.definition.delivery.email).toBe(false)
    expect(r.briefings.length).toBe(1)
    const b = (await rw.invoke('briefing.list', {})).find((x: any) => x.id === r.briefings[0].id)
    expect(b.schedule).toMatchObject({ kind: 'weekdays', at: '07:30' })
    const sc = (await rw.inspect('schedules', { kind: 'briefing', target_id: b.id }))[0]
    const t0 = new Date()
    await rw.invoke('test.clock.advance', { ms: sc.next_run_at - (await appNow(rw)) + MIN })
    await rw.invoke('test.scheduler.tick', {}); await rw.invoke('test.scheduler.tick', {})
    const br = await until(async () => { const x = (await rw.invoke('briefing.runs', { id: b.id }))[0]; return x && x.status !== 'running' && (x.emailedAt || x.deliveryError) ? x : null }, 15 * MIN, 3000)
    out.email2 = { briefingRun: br }
    const reportSends = (await rw.inspect('jobs', { type: 'SEND_EMAIL' })).filter((j: any) => JSON.parse(j.payload_json).kind === 'run')
    expect(reportSends.length, 'no report-run email').toBe(0)
    if (br.deliveryError === 'Nothing new · no email sent') { save(); return }
    expect(br.emailedAt).toBeTruthy()
    const msgs = await until(async () => { const m = await imapFindMessages(`Research Workspace · ${b.name} ·`, t0); return m.length ? m : null }, 5 * MIN, 5000) as FoundMessage[]
    await sleep(20_000)
    const again = await imapFindMessages(`Research Workspace · ${b.name} ·`, t0)
    out.email2.subjects = again.map(m => m.subject)
    save()
    expect(again.length, 'exactly one email arrived').toBe(1)
    expect(msgs[0].subject).not.toMatch(/Delayed/)
  })

  test('RD-BR-E3 an alert with email delivery emails the match once', async () => {
    test.setTimeout(150 * 60_000)
    const { alertId } = await rw.invoke('alert.compile', { text: 'email me when a startup raises money' })
    await jobsDone(rw, 'COMPILE_ALERT', p => p.alertId === alertId)
    const rule = await rw.invoke('alert.activate', { id: alertId, channels: ['in_app', 'email'] })
    const t0 = new Date()
    const candidates = await freshFundingArticles(rw, 6, 1)
    // recorded up front: a run that finds no fresh article must say so, not fail as "no alert" (acc-2026-10-07T17-11-52)
    out.email3 = { candidates: candidates.map(c => c.url), tried: [] as any[] }; save()
    expect(candidates.length, 'fresh funding articles found on Google News / TechCrunch / Crunchbase').toBeGreaterThan(0)
    let n: any = null
    for (const c of candidates) {
      const res = await rw.raw('ingress.addUrl', { url: c.url })
      if (!res.ok) continue
      const docId = res.data.documentId
      const doc = await until(async () => { const d = (await rw.inspect('documents', { id: docId }))[0]; return ['processed', 'duplicate', 'triaged_out', 'failed'].includes(d?.status) ? d : null }, 15 * MIN, 2000)
      if (doc.status === 'processed') await jobsDone(rw, 'EVALUATE_ALERTS', p => p.documentId === docId)
      const ns = await rw.inspect('notifications', { alert_rule_id: alertId, document_id: docId })
      out.email3.tried.push({ url: c.url, status: doc.status, notifications: ns.length }); save()
      n = ns.find((x: any) => !x.suppressed_reason)
      if (n) break
    }
    expect(n, 'a real article fired the email alert').toBeTruthy()
    expect(JSON.parse(n.channels_json)).toContain('email')
    await until(async () => (await rw.inspect('notifications', { id: n.id }))[0].delivered_email_at || null, 5 * MIN, 2000)
    const msgs = await until(async () => { const m = await imapFindMessages(`Alert · ${rule.name}`, t0, 'Alert'); return m.length ? m : null }, 5 * MIN, 5000) as FoundMessage[]
    await sleep(15_000)
    const all = await imapFindMessages(`Alert · ${rule.name}`, t0, 'Alert')
    out.email3.subjects = all.map(m => m.subject)
    save()
    expect(all.length, 'one alert email (cooldown suppresses the rest)').toBe(1)
    expect(msgs[0].text).toContain(n.body.slice(0, 40))
  })
})

/**
 * Real, recent funding articles that aren't in the library yet: Google News results (resolved to the publisher the way
 * a user clicking the result would land), falling back to older items of the TechCrunch / Crunchbase feeds.
 */
async function freshFundingArticles(rw: RW, max: number, skip = 0): Promise<{ url: string; title: string }[]> {
  const docs = await rw.inspect('documents')
  const key = (u: string) => u.replace(/[?#].*$/, '').replace(/\/$/, '').replace(/^https?:\/\/(www\.)?/, '')
  const have = new Set(docs.flatMap((d: any) => [d.url, d.canonical_url].filter(Boolean).map(key)))
  const found: { url: string; title: string }[] = []
  const rss = async (u: string) => { try { const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' } }); return r.ok ? await r.text() : '' } catch { return '' } }
  const items = (xml: string) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({ title: (m[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '', link: ((m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim() }))
  // the last 2 days first; a library that already read those (or a quiet news day) widens to 7 days
  // (acc-2026-10-07T19-22-20 found none in 2 days)
  const gnFor = async (days: number) => items(await rss(`https://news.google.com/rss/search?q=startup+raises+%22Series+A%22+OR+%22Series+B%22+OR+%22seed%22+when:${days}d&hl=en-US&gl=US&ceid=US:en`))
    .filter(it => it.link && !have.has(key(it.link)))
  let gn = (await gnFor(2)).slice(skip * 8, skip * 8 + 12)
  if (gn.length < 4) gn = (await gnFor(7)).slice(skip * 8, skip * 8 + 20)
  if (gn.length) {
    const b = await chromium.launch({ channel: 'chrome', headless: true })
    try {
      const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' })
      for (const it of gn) {
        if (found.length >= max) break
        const p = await ctx.newPage()
        try {
          await p.goto(it.link, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          await p.waitForURL(u => !/(^|\.)google\.com$/.test(u.hostname), { timeout: 25_000 })
          const u = p.url()
          if (!have.has(key(u))) found.push({ url: u, title: it.title })
        } catch { /* consent page or slow redirect: skip */ } finally { await p.close() }
      }
    } finally { await b.close() }
  }
  if (found.length < max) for (const feed of ['https://techcrunch.com/category/startups/feed/', 'https://news.crunchbase.com/feed/']) {
    for (const it of items(await rss(feed))) {
      if (found.length >= max) break
      if (/raises|funding|series [a-e]|seed/i.test(it.title) && it.link && !have.has(key(it.link)) && !found.some(f => key(f.url) === key(it.link))) found.push({ url: it.link, title: it.title })
    }
  }
  return found
}
