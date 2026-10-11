// Briefings (DEC-091): the email is built from reports. A briefing names one or more reports and a schedule; each send
// runs those reports (in-app runs, no per-report email) and mails one message with a part per report. Nothing new in
// any of them → no email (an empty brief is noise), recorded on the run.
import { all, one, run, json } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { writeHistory } from '../history'
import { enqueue, registerJob, onJobFailure } from '../jobs'
import { upsertSchedule, deleteSchedule, onSchedule, type Spec } from '../scheduler'
import { account, send } from '../mail'
import { runReport } from './index'
import { renderMarkdown, reportBlock, documentHtml, FOOTER, type RunContent } from './render'

export interface BriefingSchedule { kind: 'none' | 'daily' | 'weekdays' | 'weekly'; at?: string; weekday?: number }
interface Row { id: string; name: string; report_ids_json: string; schedule_json: string; enabled: number; last_sent_at: number | null; created_at: number; deleted_at: number | null }

const specOf = (s: BriefingSchedule): Spec | null =>
  s.kind === 'none' || !s.at ? null : { at: s.at, days: s.kind === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : s.kind === 'weekdays' ? [1, 2, 3, 4, 5] : [s.weekday ?? 1] }
const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
export function scheduleText(s: BriefingSchedule): string {
  if (s.kind === 'none' || !s.at) return 'Send on demand'
  const [h, m] = s.at.split(':').map(Number)
  const tm = `${h}:${String(m).padStart(2, '0')}`
  return s.kind === 'daily' ? `Daily ${tm}` : s.kind === 'weekdays' ? `Weekdays ${tm}` : `${DAYS[s.weekday ?? 1]} ${tm}`
}

function validate(name: string, reportIds: string[], schedule: BriefingSchedule): void {
  if (!name.trim()) throw new AppError('VALIDATION', 'Name the briefing')
  if (!reportIds.length) throw new AppError('VALIDATION', 'Pick at least one report')
  for (const id of reportIds) if (!one("SELECT 1 FROM reports WHERE id = ? AND deleted_at IS NULL", id)) throw new AppError('VALIDATION', 'One of those reports no longer exists')
  if (schedule.kind !== 'none' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.at || '')) throw new AppError('VALIDATION', 'Pick a time')
  if (schedule.kind === 'weekly' && (schedule.weekday == null || schedule.weekday < 0 || schedule.weekday > 6)) throw new AppError('VALIDATION', 'Pick a day')
}
function syncSchedule(r: Row): void {
  const sp = specOf(json<BriefingSchedule>(r.schedule_json, { kind: 'none' }))
  if (!sp || r.deleted_at) deleteSchedule('briefing', r.id)
  else upsertSchedule('briefing', r.id, sp, undefined, !!r.enabled)
}
const getRow = (id: string) => one<Row>('SELECT * FROM briefings WHERE id = ?', id)

export function toDTO(r: Row) {
  const ids = json<string[]>(r.report_ids_json, [])
  const names = new Map(all<{ id: string; name: string }>(`SELECT id, name FROM reports WHERE id IN (${ids.map(() => '?').join(',') || "''"}) AND deleted_at IS NULL`, ...ids).map(x => [x.id, x.name]))
  const sched = json<BriefingSchedule>(r.schedule_json, { kind: 'none' })
  const last = one<any>('SELECT id, status, started_at, delivered_email_at, delivery_error FROM briefing_runs WHERE briefing_id = ? ORDER BY started_at DESC LIMIT 1', r.id)
  return { id: r.id, name: r.name, reports: ids.filter(i => names.has(i)).map(i => ({ id: i, name: names.get(i)! })), schedule: sched, scheduleText: scheduleText(sched), enabled: !!r.enabled,
    lastSentAt: r.last_sent_at, lastRun: last ? { id: last.id, status: last.status, at: last.started_at, emailedAt: last.delivered_email_at, deliveryError: last.delivery_error } : null }
}
export const listBriefings = () => all<Row>('SELECT * FROM briefings WHERE deleted_at IS NULL ORDER BY created_at').map(toDTO)

export function createBriefing(p: { name: string; reportIds: string[]; schedule: BriefingSchedule }) {
  validate(p.name, p.reportIds, p.schedule)
  const id = newId('br'), t = now()
  run('INSERT INTO briefings(id, name, report_ids_json, schedule_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', id, p.name.trim(), JSON.stringify([...new Set(p.reportIds)]), JSON.stringify(p.schedule), t, t)
  syncSchedule(getRow(id)!)
  writeHistory('briefing', id, 'briefing.created', null, p)
  emit('report.ready', { briefingId: id })
  return toDTO(getRow(id)!)
}

export function updateBriefing(id: string, patch: { name?: string; reportIds?: string[]; schedule?: BriefingSchedule; enabled?: boolean }) {
  const r = getRow(id)
  if (!r || r.deleted_at) throw new AppError('NOT_FOUND', 'Briefing not found')
  const name = patch.name ?? r.name, ids = patch.reportIds ?? json<string[]>(r.report_ids_json, []), sched = patch.schedule ?? json<BriefingSchedule>(r.schedule_json, { kind: 'none' })
  validate(name, ids, sched)
  run('UPDATE briefings SET name = ?, report_ids_json = ?, schedule_json = ?, enabled = ?, updated_at = ? WHERE id = ?', name.trim(), JSON.stringify([...new Set(ids)]), JSON.stringify(sched), patch.enabled === undefined ? r.enabled : patch.enabled ? 1 : 0, now(), id)
  syncSchedule(getRow(id)!)
  writeHistory('briefing', id, 'briefing.updated', null, patch)
  emit('report.ready', { briefingId: id })
  return toDTO(getRow(id)!)
}

/** Tag a report into a briefing (or take it out) — the report row's "Briefings ▸" menu. */
export function setReportInBriefing(briefingId: string, reportId: string, on: boolean) {
  const r = getRow(briefingId)
  if (!r || r.deleted_at) throw new AppError('NOT_FOUND', 'Briefing not found')
  const ids = json<string[]>(r.report_ids_json, []).filter(x => x !== reportId)
  if (on) ids.push(reportId)
  if (!ids.length) throw new AppError('VALIDATION', 'A briefing needs at least one report — remove the briefing instead')
  return updateBriefing(briefingId, { reportIds: ids })
}

export function removeBriefing(id: string): void {
  run('UPDATE briefings SET deleted_at = ?, updated_at = ? WHERE id = ?', now(), now(), id)
  deleteSchedule('briefing', id)
  emit('report.ready', { briefingId: id })
}

export function sendNow(id: string): { jobId: string } {
  const r = getRow(id)
  if (!r || r.deleted_at) throw new AppError('NOT_FOUND', 'Briefing not found')
  if (!account()) throw new AppError('VALIDATION', 'Set up email in Settings first')
  return { jobId: enqueue('RUN_BRIEFING', { briefingId: id, trigger: 'manual' }, { priority: 1 }) }
}

export const briefingRuns = (id: string) => all<any>('SELECT id, trigger, started_at, finished_at, status, late, delivered_email_at, delivery_error, error, report_run_ids_json FROM briefing_runs WHERE briefing_id = ? ORDER BY started_at DESC LIMIT 50', id)
  .map(x => ({ id: x.id, trigger: x.trigger, at: x.started_at, status: x.status, late: !!x.late, emailedAt: x.delivered_email_at, deliveryError: x.delivery_error, error: x.error, reportRunIds: json<string[]>(x.report_run_ids_json, []) }))

async function runBriefing(p: { briefingId: string; trigger: 'manual' | 'schedule' | 'catchup'; scheduledFor?: number; late?: boolean }, jobId: string): Promise<unknown> {
  const b = getRow(p.briefingId)
  if (!b || b.deleted_at) return { skipped: 'gone' }
  if (p.trigger !== 'manual' && !b.enabled) return { skipped: 'disabled' }
  const runId = newId('bru'), t = now()
  run("INSERT INTO briefing_runs(id, briefing_id, trigger, scheduled_for, started_at, status, late) VALUES (?, ?, ?, ?, ?, 'running', ?)", runId, b.id, p.trigger, p.scheduledFor ?? null, t, p.late ? 1 : 0)
  try {
    const parts: RunContent[] = [], runIds: string[] = []
    for (const rid of json<string[]>(b.report_ids_json, [])) {
      const res = await runReport({ reportId: rid, trigger: p.trigger === 'manual' ? 'manual' : p.trigger, scheduledFor: p.scheduledFor, late: p.late, noEmail: true }, jobId)
      if (!res.runId) continue
      const rr = one<{ content_json: string }>('SELECT content_json FROM report_runs WHERE id = ?', res.runId)
      const c = json<RunContent | null>(rr?.content_json, null)
      if (c) { parts.push(c); runIds.push(res.runId) }
    }
    // one renderer (DEC-093): each report's story under the briefing's masthead
    const md = [`# ${b.name}`, '', ...parts.map(x => renderMarkdown(x, { level: 2, footer: false }))].join('\n') + `\n---\n${FOOTER}`
    const html = documentHtml({ kicker: 'Briefing', title: b.name, at: t }, parts.map(x => reportBlock(x, { title: true })).join(''))
    run("UPDATE briefing_runs SET status = 'succeeded', finished_at = ?, report_run_ids_json = ?, markdown = ?, html = ? WHERE id = ?", now(), JSON.stringify(runIds), md, html, runId)
    const empty = parts.every(x => x.sections.every((s: any) => !s.rows.length))
    if (!parts.length || empty) run('UPDATE briefing_runs SET delivery_error = ? WHERE id = ?', 'Nothing new · no email sent', runId)
    else if (!account()) run('UPDATE briefing_runs SET delivery_error = ? WHERE id = ?', 'Email not set up', runId)
    else enqueue('SEND_EMAIL', { kind: 'briefing', briefingRunId: runId }, { idempotencyKey: `email:${runId}`, priority: 3 })
    emit('report.ready', { briefingId: b.id, toast: p.trigger === 'manual' ? (empty ? `${b.name}: nothing new, so no email` : `${b.name} is on its way to your inbox`) : undefined })
    return { runId, reports: parts.length, empty }
  } catch (e) {
    run("UPDATE briefing_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?", now(), String((e as Error).message), runId)
    throw e
  }
}

/** SEND_EMAIL {kind:'briefing'} — called from delivery.ts. */
export async function sendBriefingEmail(briefingRunId: string): Promise<unknown> {
  const r = one<any>('SELECT br.*, b.name FROM briefing_runs br JOIN briefings b ON b.id = br.briefing_id WHERE br.id = ?', briefingRunId)
  if (!r) return { skipped: 'gone' }
  if (r.delivered_email_at) return { skipped: 'already delivered' }
  const subject = `${r.late ? '(Delayed) ' : ''}Research Workspace · ${r.name} · ${new Date(r.started_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
  const m = await send({ subject, text: r.markdown, html: r.html })
  run('UPDATE briefing_runs SET delivered_email_at = ?, delivery_error = NULL WHERE id = ?', now(), r.id)
  run('UPDATE briefings SET last_sent_at = ? WHERE id = ?', now(), r.briefing_id)
  emit('report.ready', { briefingId: r.briefing_id })
  return { messageId: m.messageId, subject }
}

export function registerBriefings(): void {
  registerJob('RUN_BRIEFING', job => runBriefing(job.payload as any, job.id))
  onSchedule('briefing', (sc, info) => {
    enqueue('RUN_BRIEFING', { briefingId: sc.target_id, trigger: info.trigger, scheduledFor: info.scheduledFor, late: info.late }, { idempotencyKey: `briefing:${sc.target_id}:${info.scheduledFor}`, priority: 2 })
  })
  onJobFailure((job, _code, message) => {
    if (job.type === 'SEND_EMAIL' && (job.payload as any)?.kind === 'briefing') run('UPDATE briefing_runs SET delivery_error = ? WHERE id = ?', message.slice(0, 300), (job.payload as any).briefingRunId)
  })
}
