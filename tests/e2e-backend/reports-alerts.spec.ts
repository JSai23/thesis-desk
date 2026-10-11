// RFC §3A reports and alerts: E2E-REP-01…05, E2E-AL-01…05.
import { test, expect } from '@playwright/test'
import { launch, installEmail, until, tempDir, type RW } from '../harness/app'
import { fixtures } from '../harness/fixtures'
import { imapHasSubject } from '../harness/imap'
import { U, MIN, H, corpusTheses, addSource, docByUrl, firm } from './common'

const report = async (rw: RW, id: string) => (await rw.invoke('report.list', {})).find((r: any) => r.id === id)
const template = async (rw: RW, key: string) => (await rw.invoke('report.list', {})).find((r: any) => r.templateKey === key)

test('E2E-REP-01 report generation (Daily Brief)', async () => {
  await fixtures.reset()
  const rw = await launch()
  await corpusTheses(rw)
  await addSource(rw, U.swFeed)
  for (const u of [U.D7, U.D6, U.D13]) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(600_000)
  const brief = await template(rw, 'daily_brief')
  await rw.invoke('report.setEnabled', { id: brief.id, enabled: true })
  await rw.invoke('report.runNow', { id: brief.id })
  await rw.drain(300_000)
  const runs = await rw.invoke('report.runs', { id: brief.id })
  expect(runs[0].status).toBe('succeeded')
  const run = await rw.invoke('report.run', { runId: runs[0].id })
  expect(run.content.sections.length).toBe(4)
  const rows = run.content.sections.flatMap((s: any) => s.rows)
  expect(rows.length).toBeGreaterThan(0)
  for (const r of rows) { expect(r.citations.length, r.text).toBeGreaterThanOrEqual(1); expect(r.quote).toBeTruthy(); expect(r.source).toBeTruthy() }
  expect(run.markdown.length).toBeGreaterThan(100); expect(run.html).toContain('<html>')
  await rw.close()
})

test('E2E-REP-02 scheduled report fires on time in the app; only its briefing emails (DEC-100)', async () => {
  await fixtures.reset()
  const rw = await launch({ testNow: '2026-10-05T07:29:00' })
  await installEmail(rw)
  // DEC-090: a run with no rows is not emailed, so the brief needs something from the last 24 h
  await rw.invoke('ingress.addUrl', { url: U.D7 })
  await rw.drain(300_000)
  await rw.invoke('test.clock.set', { iso: '2026-10-05T07:29:00' })
  const brief = await template(rw, 'daily_brief')
  expect(brief.definition.delivery.email, 'templates never email on their own').toBe(false)
  await rw.invoke('report.setEnabled', { id: brief.id, enabled: true })
  await rw.invoke('test.clock.advance', { ms: 2 * MIN })
  await rw.invoke('test.scheduler.tick')
  await rw.drain(300_000)
  const runs = await rw.invoke('report.runs', { id: brief.id })
  expect(runs.length).toBe(1)
  expect(runs[0]).toMatchObject({ trigger: 'schedule', late: false, status: 'succeeded', deliveredEmailAt: null })
  expect((await rw.inspect('jobs', { type: 'SEND_EMAIL' })).length, 'a report run sends nothing').toBe(0)
  // the briefing that includes it is what emails, on its own schedule
  const t0 = new Date()
  const b = await rw.invoke('briefing.create', { name: 'Morning', reportIds: [brief.id], schedule: { kind: 'weekdays', at: '07:35' } })
  await rw.invoke('test.clock.advance', { ms: 5 * MIN })
  await rw.invoke('test.scheduler.tick')
  await rw.drain(300_000)
  await until(async () => (await rw.invoke('briefing.list', {})).find((x: any) => x.id === b.id)?.lastRun?.emailedAt || null, 120_000)
  await until(async () => (await imapHasSubject('Research Workspace · Morning', t0)) || null, 120_000, 5000)
  await rw.close()
})

// P-REPORT-010 / DEC-100, the one-time migration: a library from before briefings-only has a report that emails on a
// schedule; on first start of the new build it moves into its own briefing (which takes the schedule) and stops
// emailing by itself — once (the marker is set), and with the report still enabled. The user's own library had no
// emailing report left to migrate (iteration 2 install), so this is where the migration is shown.
test('E2E-REP-06 an emailing report from an older library moves into its own briefing on first start', async () => {
  await fixtures.reset()
  let rw = await launch()
  const rep = (await rw.inspect('reports')).find((r: any) => r.definition_json && !r.deleted_at)
  expect(rep, 'a report with a definition (seeded templates)').toBeTruthy()
  const def = JSON.parse(rep.definition_json)
  const old = { ...def, delivery: { ...def.delivery, email: true }, schedule: { kind: 'daily', at: '08:00' } }
  const dataDir = rw.dataDir
  await rw.close()
  // make it an older library: the report emails by itself and the migration has not run
  const sql = `UPDATE reports SET definition_json = '${JSON.stringify(old).replace(/'/g, "''")}', enabled = 1 WHERE id = '${rep.id}'; DELETE FROM settings WHERE key = 'reports.briefings_only';`
  require('node:child_process').execFileSync('/usr/bin/sqlite3', [require('node:path').join(dataDir, 'research.sqlite'), sql])
  rw = await launch({ dataDir })
  const after = (await rw.inspect('reports', { id: rep.id }))[0]
  const d2 = JSON.parse(after.definition_json)
  expect(d2.delivery.email, 'the report no longer emails by itself').toBe(false)
  expect(d2.schedule.kind, 'its schedule moved to the briefing').toBe('none')
  expect(after.enabled).toBe(1)
  const bs = (await rw.inspect('briefings')).filter((b: any) => !b.deleted_at && JSON.parse(b.report_ids_json).includes(rep.id))
  expect(bs.length, 'one briefing holds it').toBe(1)
  expect(JSON.parse(bs[0].schedule_json)).toMatchObject({ kind: 'daily', at: '08:00' })
  expect(bs[0].enabled).toBe(1)
  expect((await rw.inspect('settings')).find((x: any) => x.key === 'reports.briefings_only')?.value_json).toBe('1')
  // once: a restart does not make a second briefing
  rw = await rw.restart()
  expect((await rw.inspect('briefings')).filter((b: any) => !b.deleted_at && JSON.parse(b.report_ids_json).includes(rep.id)).length).toBe(1)
  await rw.close()
})

test('E2E-REP-03 catch-up after sleep', async () => {
  const dataDir = tempDir()
  let rw = await launch({ dataDir, testNow: '2026-10-05T07:29:00' })
  const brief = await template(rw, 'daily_brief')
  await rw.invoke('report.setEnabled', { id: brief.id, enabled: true })
  await rw.close()
  rw = await launch({ dataDir, testNow: '2026-10-05T09:00:00' })
  await rw.drain(120_000)
  let runs = await rw.invoke('report.runs', { id: brief.id })
  expect(runs.length).toBe(1); expect(runs[0]).toMatchObject({ trigger: 'catchup', late: true })
  await rw.close()
  // more than 24 h later: only the most recent occurrence (≤24 h) runs
  rw = await launch({ dataDir, testNow: '2026-10-07T07:00:00' })
  await rw.drain(120_000)
  runs = await rw.invoke('report.runs', { id: brief.id })
  expect(runs.length).toBe(2)
  const latest = runs[0]
  expect(latest).toMatchObject({ trigger: 'catchup', late: true })
  const rr = (await rw.inspect('report_runs', { id: latest.id }))[0]
  expect(new Date(rr.scheduled_for).toISOString()).toBe(new Date('2026-10-06T07:30:00-07:00').toISOString())
  await rw.close()
})

test('E2E-REP-04 refine three times, undo restores', async () => {
  await fixtures.reset()
  const rw = await launch()
  await corpusTheses(rw)
  const { reportId } = await rw.invoke('report.createFromPrompt', { text: 'Every weekday at 7:30, show me new seed and Series A deals in vertical AI, and the evidence against my theses' })
  await rw.drain(300_000)
  const d0 = (await report(rw, reportId)).definition
  expect(d0).toBeTruthy()
  const refine = async (text: string) => { await rw.invoke('report.refine', { id: reportId, text }); await rw.drain(300_000); const r = await report(rw, reportId); expect(r.pendingRefinement).toBeNull(); return r.definition }
  const d1 = await refine('Make it weekly on Mondays at 8:00')
  expect(d1.schedule).toMatchObject({ kind: 'weekly', weekday: 1, at: '08:00' })
  expect(d1.sections.length).toBe(d0.sections.length)
  const drop = d1.sections[d1.sections.length - 1]
  const d2 = await refine(`Remove the "${drop.title}" section`)
  expect(d2.sections.length).toBe(d1.sections.length - 1)
  expect(d2.sections.some((s: any) => s.id === drop.id)).toBe(false)
  const d3 = await refine('Exclude companies above Series C')
  expect(d3.sections.some((s: any) => s.query.excludeStagesAbove === 'Series C')).toBe(true)
  for (const expected of [d2, d1, d0]) {
    await rw.invoke('report.undo', { id: reportId })
    expect((await report(rw, reportId)).definition).toEqual(expected)
  }
  await rw.close()
})

test('E2E-REP-05 report request survives AI failure', async () => {
  await fixtures.reset()
  let rw = await launch({ faults: 'provider_error:CREATE_REPORT' })
  // a report about "my theses" needs theses: with none, the model rightly asks to add one first (acc-2026-10-08T06-23-27)
  await corpusTheses(rw)
  const text = 'Every Friday at 5pm send me how my theses changed this week'
  const { reportId } = await rw.invoke('report.createFromPrompt', { text })
  await rw.drain(120_000)
  await rw.invoke('test.clock.advance', { ms: 3 * MIN }); await rw.drain(120_000)
  rw = await rw.restart()
  let r = await report(rw, reportId)
  expect(r.status).toBe('failed'); expect(r.promptText).toBe(text)
  await rw.close()
  rw = await launch({ dataDir: rw.dataDir })
  await rw.invoke('report.retry', { id: reportId })
  await rw.drain(300_000)
  r = await report(rw, reportId)
  expect(r.status).toBe('active'); expect(r.definition.sections.length).toBeGreaterThan(0)
  await rw.close()
})

async function northwindRule(rw: RW, channels: string[] = ['in_app']) {
  const nw = await firm(rw, /^Northwind/)
  const a = await rw.invoke('alert.compile', { text: 'Tell me when Northwind leads a round', anchor: { type: 'firm', id: nw.id } })
  await rw.drain(300_000)
  const dto = await rw.invoke('alert.activate', { id: a.alertId, channels })
  expect(dto.status).toBe('active')
  return dto
}

test('E2E-AL-01/02 alert match and non-match', async () => {
  await fixtures.reset()
  const rw = await launch()
  for (const u of [U.D1, U.D7]) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(400_000)
  const rule = await northwindRule(rw)
  await fixtures.epoch(2)
  for (const u of [U.D10, U.D7]) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(400_000)
  const ns = await rw.inspect('notifications', { alert_rule_id: rule.id })
  expect(ns.filter((n: any) => !n.suppressed_reason).length).toBe(1)
  for (const n of ns.filter((n: any) => n.suppressed_reason)) expect(n.suppressed_reason).toBe('cooldown')
  const fi = (await rw.inspect('feed_items', { document_id: ns.find((n: any) => !n.suppressed_reason).document_id }))[0]
  expect(fi.group_key).toBe('important')
  expect(JSON.parse(fi.reasons_json).some((x: any) => x.type === 'alert')).toBe(true)
  // AL-02: Claimwise partnership → none for this rule
  await rw.invoke('ingress.addUrl', { url: U.D18 }); await rw.drain(300_000)
  const d18 = await docByUrl(rw, U.D18)
  expect((await rw.inspect('notifications', { alert_rule_id: rule.id })).filter((n: any) => n.document_id === d18.id)).toEqual([])
  await rw.close()
})

test('E2E-AL-03 dedupe, cooldown and email cap', async () => {
  await fixtures.reset()
  const rw = await launch()
  await installEmail(rw)
  await rw.invoke('ingress.addUrl', { url: U.D7 }); await rw.drain(300_000)
  const rule = await northwindRule(rw, ['in_app', 'email'])
  for (const n of [1, 2]) { await rw.invoke('ingress.addUrl', { url: `http://alerts.test:4700/burst-${n}` }); await rw.drain(300_000) }
  let ns = await rw.inspect('notifications', { alert_rule_id: rule.id })
  expect(ns.filter((n: any) => !n.suppressed_reason).length).toBe(1)
  expect(ns.filter((n: any) => n.suppressed_reason === 'cooldown').length).toBeGreaterThanOrEqual(1)
  // same evidence again → no duplicate row
  const before = ns.length
  await rw.invoke('ingress.addUrl', { url: 'http://alerts.test:4700/burst-1' }); await rw.drain(300_000)
  expect((await rw.inspect('notifications', { alert_rule_id: rule.id })).length).toBe(before)
  // cooldown 0 → the global email cap (3/day) applies; in-app still delivered
  await rw.invoke('test.alerts.setCooldown', { id: rule.id, minutes: 0 })
  for (const n of [3, 4, 5]) { await rw.invoke('ingress.addUrl', { url: `http://alerts.test:4700/burst-${n}` }); await rw.drain(300_000) }
  ns = await rw.inspect('notifications', { alert_rule_id: rule.id })
  const emailed = ns.filter((n: any) => !n.suppressed_reason && JSON.parse(n.channels_json).includes('email'))
  expect(emailed.length).toBeLessThanOrEqual(3)
  const capped = ns.filter((n: any) => n.suppressed_reason === 'daily_cap')
  expect(emailed.length + capped.length).toBeGreaterThanOrEqual(4)
  expect(capped.length).toBeGreaterThanOrEqual(1)
  for (const c of capped) expect(c.delivered_in_app_at).toBeTruthy()
  await until(async () => (await rw.inspect('notifications', { alert_rule_id: rule.id })).filter((n: any) => n.delivered_email_at).length === emailed.length || null, 120_000, 2000)
  await rw.close()
})

test('E2E-AL-04 semantic condition', async () => {
  await fixtures.reset()
  const rw = await launch()
  await corpusTheses(rw)
  const a = await rw.invoke('alert.compile', { text: 'Tell me when meaningful evidence contradicts my support-labor thesis' })
  await rw.drain(300_000)
  const rule = await rw.invoke('alert.activate', { id: a.alertId, channels: ['in_app'] })
  const def = JSON.parse((await rw.inspect('alert_rules', { id: rule.id }))[0].rule_json)
  expect(def.semanticCondition).toBeTruthy()
  await rw.invoke('ingress.addUrl', { url: U.D4 }); await rw.drain(400_000)
  const d4 = await docByUrl(rw, U.D4)
  expect((await rw.inspect('notifications', { alert_rule_id: rule.id })).some((n: any) => n.document_id === d4.id)).toBe(true)
  expect((await rw.inspect('agent_runs', { task: 'EVALUATE_ALERT' })).length).toBeGreaterThan(0)
  await rw.close()
})

test('E2E-AL-05 alert request survives AI failure', async () => {
  await fixtures.reset()
  let rw = await launch({ faults: 'provider_error:CREATE_ALERT' })
  const text = 'Tell me when a company I follow raises a round'
  const { alertId } = await rw.invoke('alert.compile', { text })
  await rw.drain(120_000)
  await rw.invoke('test.clock.advance', { ms: 3 * MIN }); await rw.drain(120_000)
  await rw.close()
  rw = await launch({ dataDir: rw.dataDir })
  let a = (await rw.invoke('alert.list', {})).find((x: any) => x.id === alertId)
  expect(a.status).toBe('failed'); expect(a.text).toBe(text)
  await rw.invoke('alert.retry', { id: alertId }); await rw.drain(300_000)
  a = (await rw.invoke('alert.list', {})).find((x: any) => x.id === alertId)
  expect(a.status).toBe('compiled')
  expect((await rw.invoke('alert.activate', { id: alertId, channels: ['in_app'] })).status).toBe('active')
  void H
  await rw.close()
})
