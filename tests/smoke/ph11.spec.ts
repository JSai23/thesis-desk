// SMK-11 (RFC PH-11): NL report creation, refine + undo, Run now with Runs ▾ and email delivery, scheduled catch-up.
import { test, expect } from '@playwright/test'
import { D12 } from '../../fixtures/corpus/corpus.mjs'
import { launch, installEmail, until, tempDir } from '../harness/app'
import { fixtures } from '../harness/fixtures'
import { imapHasSubject } from '../harness/imap'

const PROMPT = 'Every weekday at 7:30 email me new seed deals in my theses and evidence against Legal AI'

test('SMK-11 PH-11 reports', async () => {
  await fixtures.reset()
  const rw = await launch()
  const legal = await rw.invoke('thesis.create', { title: 'Legal AI' })
  const vertical = await rw.invoke('thesis.create', { title: 'Vertical AI for regulated industries' })
  await rw.invoke('ingress.addUrl', { url: 'http://signalwire.test:4700/lumen-legal-series-a' })
  // a seed deal in one of the theses (Appendix A D12 text, pasted), so the report has rows to email — an empty run is
  // never emailed (DEC-090)
  const seedDoc = await rw.invoke('ingress.addText', { text: D12.paras.slice(0, 2).join('\n\n') })
  await rw.drain(300_000)
  for (const e of (await rw.inspect('evidence', { document_id: seedDoc.documentId })).filter((e: any) => e.kind === 'funding' && e.status === 'active'))
    await rw.invoke('link.attach', { fromType: 'evidence', fromId: e.id, thesisId: vertical.id, stance: 'support' })
  await installEmail(rw)

  // templates inserted disabled on first run
  const initial = await rw.invoke('report.list', {})
  expect(initial.filter((r: any) => r.templateKey).map((r: any) => r.name).sort()).toEqual(['Daily Brief', 'Evidence against my theses', 'How my theses changed', 'Seed and Series A deals in vertical AI'])
  expect(initial.every((r: any) => !r.enabled)).toBe(true)

  // (a) create from prompt: draft first, then a validated definition
  const { reportId } = await rw.invoke('report.createFromPrompt', { text: PROMPT })
  const draft = (await rw.invoke('report.list', {})).find((r: any) => r.id === reportId)
  expect(draft.status).toBe('draft')
  expect(draft.promptText).toBe(PROMPT)
  await rw.drain(300_000)
  const rep = (await rw.invoke('report.list', {})).find((r: any) => r.id === reportId)
  expect(rep.status).toBe('active')
  const d = rep.definition
  // DEC-100: "email me" puts the report in its own briefing, which takes the schedule; the report never emails itself
  expect(d.delivery.email).toBe(false)
  expect(rep.briefings.length).toBe(1)
  const briefing = (await rw.invoke('briefing.list', {})).find((b: any) => b.id === rep.briefings[0].id)
  expect(briefing.schedule).toMatchObject({ kind: 'weekdays', at: '07:30' })
  const seed = d.sections.find((s: any) => s.query.kinds?.includes('funding') && s.query.stages?.includes('Seed'))
  expect(seed).toBeTruthy()
  const contra = d.sections.find((s: any) => s.query.source === 'thesis_contra' && (!s.query.theses || s.query.theses.includes(legal.id)))
  expect(contra).toBeTruthy()

  // (b) refine, then undo
  await rw.invoke('report.refine', { id: reportId, text: 'Make it weekly on Mondays and drop the seed section' })
  await rw.drain(300_000)
  const refined = (await rw.invoke('report.list', {})).find((r: any) => r.id === reportId)
  expect(refined.pendingRefinement).toBeNull()
  expect(refined.definition.schedule).toMatchObject({ kind: 'weekly', weekday: 1 })
  expect(refined.definition.sections.some((s: any) => s.query.stages?.includes('Seed'))).toBe(false)
  expect(refined.definition.sections.length).toBe(d.sections.length - 1)
  await rw.invoke('report.undo', { id: reportId })
  const undone = (await rw.invoke('report.list', {})).find((r: any) => r.id === reportId)
  expect(undone.definition).toEqual(d)

  // (c) Run now → stored run listed in Runs ▾ (no email from the report); the briefing's Send now emails it
  const t0 = new Date()
  await rw.invoke('report.runNow', { id: reportId })
  await rw.drain(300_000)
  const runs = await rw.invoke('report.runs', { id: reportId })
  expect(runs.filter((r: any) => r.trigger === 'manual' && r.status === 'succeeded').length).toBe(1)
  const full = await rw.invoke('report.run', { runId: runs[0].id })
  expect(full.markdown).toContain('Built on this Mac from your sources, theses and notes.')
  expect(full.html).toContain('<html>')
  const page = rw.page
  await page.getByText('Reports', { exact: true }).first().click()
  await page.getByText(undone.name, { exact: true }).first().click()
  await page.getByRole('button', { name: 'Runs' }).click()
  await expect(page.getByText('Past runs')).toBeVisible()
  await expect(page.getByText('No runs yet')).toHaveCount(0)
  expect(full.content.sections.reduce((n: number, x: any) => n + x.rows.length, 0), 'the run has rows to email').toBeGreaterThan(0)
  expect((await rw.invoke('report.runs', { id: reportId }))[0].deliveredEmailAt, 'the report run itself is not emailed').toBeNull()
  await rw.invoke('briefing.sendNow', { id: briefing.id })
  await rw.drain(300_000)
  await until(async () => (await rw.invoke('briefing.runs', { id: briefing.id }))[0]?.emailedAt || null, 120_000)
  await until(async () => (await imapHasSubject(briefing.name, t0)) || null, 120_000, 5000)
  await rw.close()
})

test('SMK-11 PH-11 scheduled catch-up', async () => {
  const dataDir = tempDir()
  // Monday 07:29: enable the Daily Brief template (weekdays 07:30), then quit before it fires
  let rw = await launch({ dataDir, testNow: '2026-10-05T07:29:00' })
  const brief = (await rw.invoke('report.list', {})).find((r: any) => r.templateKey === 'daily_brief')
  await rw.invoke('report.setEnabled', { id: brief.id, enabled: true })
  await rw.close()

  // relaunch at 09:00 → exactly one catch-up run, late
  rw = await launch({ dataDir, testNow: '2026-10-05T09:00:00' })
  await rw.drain(120_000)
  let runs = await rw.invoke('report.runs', { id: brief.id })
  expect(runs.length).toBe(1)
  expect(runs[0]).toMatchObject({ trigger: 'catchup', late: true, status: 'succeeded' })
  await rw.close()

  // relaunch Tuesday 09:40 → only the 10-06 07:30 occurrence catches up; 10-05 does not run twice
  rw = await launch({ dataDir, testNow: '2026-10-06T09:40:00' })
  await rw.drain(120_000)
  runs = await rw.invoke('report.runs', { id: brief.id })
  expect(runs.length).toBe(2)
  expect(runs.every((r: any) => r.trigger === 'catchup' && r.late)).toBe(true)
  const sched = (await rw.inspect('report_runs')).filter((r: any) => r.report_id === brief.id && r.trigger !== 'preview').map((r: any) => new Date(r.scheduled_for).toISOString())
  expect(new Set(sched).size).toBe(2)
  await rw.close()
})
