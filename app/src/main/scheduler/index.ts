// Single scheduler: one 30 s timer, catch-up on start/resume (RFC §1B.11, B-JOBS-004).
import { all, one, run, json } from '../db'
import { now } from '../clock'
import { newId } from '../ids'
import { enqueue, type JobType } from '../jobs'
import { getSetting, setSetting } from '../settings'
import { NO_JITTER, TEST_MODE } from '../env'
import { log } from '../log'

export type ScheduleKind = 'source_poll' | 'report' | 'maintenance' | 'briefing'
export type Spec = { everyMinutes: number } | { at: string; days: number[] }
interface ScheduleRow { id: string; kind: ScheduleKind; target_id: string; spec_json: string; next_run_at: number; last_run_at: number | null; enabled: number }

export const FREQ_MINUTES: Record<string, number> = { realtime: 15, hourly: 60, daily: 1440, weekly: 10080 }
const ON_TIME_MS = 5 * 60_000
const CATCHUP_WINDOW_MS = 24 * 3600_000

const MAINTENANCE: { task: string; spec: Spec }[] = [
  { task: 'unmute', spec: { everyMinutes: 60 } },
  { task: 'purge_removed_sources', spec: { at: '03:30', days: [0, 1, 2, 3, 4, 5, 6] } },
  { task: 'jobs_cleanup', spec: { at: '03:40', days: [0, 1, 2, 3, 4, 5, 6] } },
  { task: 'summaries_refresh', spec: { at: '04:00', days: [0, 1, 2, 3, 4, 5, 6] } },
  { task: 'sync_tiers', spec: { at: '04:30', days: [0, 1, 2, 3, 4, 5, 6] } },
  { task: 'suggest_theses', spec: { at: '05:00', days: [1] } }
]

let timer: NodeJS.Timeout | null = null
let clockTimer: NodeJS.Timeout | null = null
const priorityRank: Record<string, number> = { high: 0, normal: 1, low: 2 }

function atOn(day: Date, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(day)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/** First occurrence strictly after t. */
export function nextOccurrence(spec: Spec, t: number, last?: number | null): number {
  if ('everyMinutes' in spec) {
    const interval = spec.everyMinutes * 60_000
    const jitter = NO_JITTER ? 0 : Math.min(Math.random() * 0.1 * interval, 5 * 60_000)
    return Math.max(t, (last ?? t) + interval + jitter)
  }
  for (let i = 0; i <= 8; i++) {
    const day = new Date(t)
    day.setDate(day.getDate() + i)
    const occ = atOn(day, spec.at)
    if (occ > t && spec.days.includes(new Date(occ).getDay())) return occ
  }
  return t + 86400_000
}

/** Most recent occurrence at or before t (clock specs only). */
export function lastOccurrence(spec: { at: string; days: number[] }, t: number): number | null {
  for (let i = 0; i <= 8; i++) {
    const day = new Date(t)
    day.setDate(day.getDate() - i)
    const occ = atOn(day, spec.at)
    if (occ <= t && spec.days.includes(new Date(occ).getDay())) return occ
  }
  return null
}

export function upsertSchedule(kind: ScheduleKind, targetId: string, spec: Spec, nextRunAt?: number, enabled = true): void {
  const t = now()
  const next = nextRunAt ?? nextOccurrence(spec, t)
  run(`INSERT INTO schedules(id, kind, target_id, spec_json, next_run_at, enabled) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, target_id) DO UPDATE SET spec_json = excluded.spec_json, next_run_at = excluded.next_run_at, enabled = excluded.enabled`,
    newId('sc'), kind, targetId, JSON.stringify(spec), next, enabled ? 1 : 0)
}

export function setScheduleEnabled(kind: ScheduleKind, targetId: string, enabled: boolean, nextRunAt?: number): void {
  if (nextRunAt != null) run('UPDATE schedules SET enabled = ?, next_run_at = ? WHERE kind = ? AND target_id = ?', enabled ? 1 : 0, nextRunAt, kind, targetId)
  else run('UPDATE schedules SET enabled = ? WHERE kind = ? AND target_id = ?', enabled ? 1 : 0, kind, targetId)
}

export function deleteSchedule(kind: ScheduleKind, targetId: string): void {
  run('DELETE FROM schedules WHERE kind = ? AND target_id = ?', kind, targetId)
}

export function seedMaintenance(): void {
  for (const m of MAINTENANCE) {
    if (!one('SELECT id FROM schedules WHERE kind = ? AND target_id = ?', 'maintenance', m.task)) upsertSchedule('maintenance', m.task, m.spec)
  }
}

type Enqueuer = (s: ScheduleRow, info: { scheduledFor: number; trigger: 'schedule' | 'catchup'; late: boolean; staggerMs: number }) => void
const enqueuers: Partial<Record<ScheduleKind, Enqueuer>> = {
  maintenance: (s) => { enqueue('MAINTENANCE' as JobType, { task: s.target_id }, { idempotencyKey: `maint:${s.target_id}` }) }
}
export function onSchedule(kind: ScheduleKind, fn: Enqueuer): void { enqueuers[kind] = fn }

/** One scheduler pass. `catchup` marks start/resume passes (source polls staggered by priority). */
export function tick(opts: { catchup?: boolean } = {}): number {
  const t = now()
  if (TEST_MODE) setSetting('test.clock_last', t)
  const paused = !!getSetting('pause_polling')
  const due = all<ScheduleRow>('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at', t)
  let fired = 0
  const polls = due.filter(s => s.kind === 'source_poll')
  const pollPrio = new Map<string, number>()
  if (polls.length) {
    for (const r of all<{ id: string; priority: string }>(`SELECT id, priority FROM sources WHERE id IN (${polls.map(() => '?').join(',')})`, ...polls.map(p => p.target_id)))
      pollPrio.set(r.id, priorityRank[r.priority] ?? 1)
  }
  polls.sort((a, b) => (pollPrio.get(a.target_id) ?? 1) - (pollPrio.get(b.target_id) ?? 1))
  let stagger = 0
  for (const s of [...due.filter(d => d.kind !== 'source_poll'), ...polls]) {
    const spec = json<Spec>(s.spec_json, { everyMinutes: 1440 })
    try {
      if (s.kind === 'source_poll') {
        if (paused) continue
        enqueuers.source_poll?.(s, { scheduledFor: s.next_run_at, trigger: opts.catchup ? 'catchup' : 'schedule', late: false, staggerMs: opts.catchup ? stagger : 0 })
        if (opts.catchup) stagger += 5000
        run('UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?', t, nextOccurrence(spec, t, t), s.id)
      } else if ((s.kind === 'report' || s.kind === 'briefing') && 'at' in spec) {
        const occ = lastOccurrence(spec, t) ?? s.next_run_at
        const age = t - occ
        if (age <= ON_TIME_MS) enqueuers[s.kind]?.(s, { scheduledFor: occ, trigger: 'schedule', late: false, staggerMs: 0 })
        else if (age <= CATCHUP_WINDOW_MS) enqueuers[s.kind]?.(s, { scheduledFor: occ, trigger: 'catchup', late: true, staggerMs: 0 })
        else log.info('scheduler', 'missed report occurrence older than 24 h not run', { reportId: s.target_id, occurrence: occ })
        run('UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?', t, nextOccurrence(spec, t), s.id)
      } else {
        enqueuers[s.kind]?.(s, { scheduledFor: s.next_run_at, trigger: opts.catchup ? 'catchup' : 'schedule', late: false, staggerMs: 0 })
        run('UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?', t, nextOccurrence(spec, t, t), s.id)
      }
      fired++
    } catch (e) {
      log.error('scheduler', 'schedule failed', { scheduleId: s.id, err: String(e) })
    }
  }
  return fired
}

export function startScheduler(): void {
  tick({ catchup: true })
  timer = setInterval(() => tick(), 30_000)
  // test mode: persist the fake clock every second so a crash/kill can't rewind it below queued run_after values
  if (TEST_MODE) clockTimer = setInterval(() => setSetting('test.clock_last', now()), 1000)
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  if (clockTimer) clearInterval(clockTimer)
  timer = clockTimer = null
  if (TEST_MODE) setSetting('test.clock_last', now())
}
