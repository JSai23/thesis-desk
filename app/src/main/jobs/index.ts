// Durable jobs: one worker loop in main with lanes, leases, retry/backoff, idempotency (RFC §1B.10, B-JOBS-001..003).
import { all, one, run, tx, json } from '../db'
import { now } from '../clock'
import { newId } from '../ids'
import { emit } from '../events'
import { log } from '../log'
import { AppError, ParkJob } from '../errors'

export type JobType = 'FETCH_SOURCE' | 'PROCESS_DOCUMENT' | 'CONFIGURE_SOURCE' | 'ORGANIZE_NOTE' | 'REFRESH_OBJECT' | 'BACKFILL_FIELD'
  | 'SUGGEST_THESES' | 'MATCH_THESIS' | 'SUMMARIZE_OBJECT' | 'HYDRATE_OBJECT' | 'RUN_BRIEFING' | 'COMPILE_REPORT' | 'COMPILE_ALERT' | 'RUN_REPORT' | 'EVALUATE_ALERTS' | 'SEND_EMAIL' | 'MAINTENANCE'

export interface JobRow {
  id: string; type: JobType; payload_json: string; status: string; priority: number; attempts: number; max_attempts: number
  run_after: number; lease_expires_at: number | null; idempotency_key: string | null; error_code: string | null
  error_message: string | null; result_json: string | null; parent_job_id: string | null; created_at: number
}
export interface Job<P = any> { id: string; type: JobType; payload: P; attempts: number; maxAttempts: number }
type Handler = (job: Job) => Promise<unknown> | unknown

const LANES: Record<string, { types: JobType[]; limit: number }> = {
  fetch: { types: ['FETCH_SOURCE', 'HYDRATE_OBJECT'], limit: 3 },
  ai: { types: ['PROCESS_DOCUMENT', 'CONFIGURE_SOURCE', 'ORGANIZE_NOTE', 'BACKFILL_FIELD', 'SUGGEST_THESES', 'MATCH_THESIS', 'SUMMARIZE_OBJECT', 'COMPILE_REPORT', 'COMPILE_ALERT'], limit: 2 },
  misc: { types: ['RUN_REPORT', 'RUN_BRIEFING', 'SEND_EMAIL', 'EVALUATE_ALERTS', 'MAINTENANCE', 'REFRESH_OBJECT'], limit: 2 }
}
const MAX_ATTEMPTS: Partial<Record<JobType, number>> = { FETCH_SOURCE: 3, PROCESS_DOCUMENT: 3, SEND_EMAIL: 5, RUN_REPORT: 2 }
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 2 * 3600_000]
const NON_RETRYABLE = new Set(['AUTH_EXPIRED', 'ROBOTS_BLOCKED', 'VALIDATION', 'AI_INVALID', 'AUTH_REQUIRED'])
const LEASE_MS = 10 * 60_000

const handlers = new Map<JobType, Handler>()
const running = new Map<string, { job: Job; lane: string; startedAt: number }>()
let timer: NodeJS.Timeout | null = null
let leaseTimer: NodeJS.Timeout | null = null
let stopped = true
let kickPending = false

export function registerJob(type: JobType, fn: Handler): void { handlers.set(type, fn) }

export interface EnqueueOpts { priority?: number; runAfter?: number; idempotencyKey?: string; maxAttempts?: number; parentJobId?: string }

/** Insert a queued job. With an idempotency key, an existing queued/running job with that key is returned instead. */
export function enqueue(type: JobType, payload: Record<string, unknown> = {}, o: EnqueueOpts = {}): string {
  const id = newId('job')
  const t = now()
  if (o.idempotencyKey) {
    const ex = one<{ id: string }>("SELECT id FROM jobs WHERE idempotency_key = ? AND status IN ('queued','running')", o.idempotencyKey)
    if (ex) return ex.id
  }
  run(`INSERT INTO jobs(id, type, payload_json, status, priority, attempts, max_attempts, run_after, idempotency_key, parent_job_id, created_at)
       VALUES (?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?, ?)`,
    id, type, JSON.stringify(payload), o.priority ?? 5, o.maxAttempts ?? MAX_ATTEMPTS[type] ?? 2, o.runAfter ?? t, o.idempotencyKey ?? null, o.parentJobId ?? null, t)
  kick()
  return id
}

export function kick(): void {
  if (stopped || kickPending) return
  kickPending = true
  setImmediate(() => { kickPending = false; pump() })
}

/** Release parked jobs (e.g. AI became available) so they run now. */
export function releaseParked(types: JobType[], errorCode: string): void {
  const t = now()
  for (const ty of types) run("UPDATE jobs SET run_after = ? WHERE status = 'queued' AND type = ? AND error_code = ?", t, ty, errorCode)
  kick()
}

export function cancelJobs(where: { type?: JobType; sourceId?: string; documentId?: string }): number {
  let n = 0
  const rows = all<JobRow>("SELECT * FROM jobs WHERE status = 'queued'" + (where.type ? ' AND type = ?' : ''), ...(where.type ? [where.type] : []))
  for (const r of rows) {
    const p = json<Record<string, unknown>>(r.payload_json, {})
    if (where.sourceId && p.sourceId !== where.sourceId) continue
    if (where.documentId && p.documentId !== where.documentId) continue
    run("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'", now(), r.id)
    n++
  }
  return n
}

export const isRunning = (pred: (j: Job) => boolean): boolean => [...running.values()].some(r => pred(r.job))

function laneOf(type: JobType): string {
  for (const [name, l] of Object.entries(LANES)) if (l.types.includes(type)) return name
  return 'misc'
}

function claim(lane: string): Job | null {
  const l = LANES[lane]
  const t = now()
  const placeholders = l.types.map(() => '?').join(',')
  const busyDocs = new Set<string>()
  const busySources = new Set<string>()
  for (const r of running.values()) {
    if (r.job.payload?.documentId) busyDocs.add(String(r.job.payload.documentId))
    if (r.job.type === 'FETCH_SOURCE' && r.job.payload?.sourceId) busySources.add(String(r.job.payload.sourceId))
  }
  return tx(() => {
    const rows = all<JobRow>(`SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? AND type IN (${placeholders}) ORDER BY priority ASC, created_at ASC LIMIT 50`, t, ...l.types)
    for (const r of rows) {
      const payload = json<Record<string, any>>(r.payload_json, {})
      if ((r.type === 'PROCESS_DOCUMENT' || r.type === 'EVALUATE_ALERTS') && payload.documentId && busyDocs.has(String(payload.documentId))) continue
      if (r.type === 'FETCH_SOURCE' && payload.sourceId && busySources.has(String(payload.sourceId))) continue
      const res = run("UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_expires_at = ?, started_at = ? WHERE id = ? AND status = 'queued'", t + LEASE_MS, t, r.id)
      if (res.changes !== 1) continue
      return { id: r.id, type: r.type, payload, attempts: r.attempts + 1, maxAttempts: r.max_attempts }
    }
    return null
  })
}

function pump(): void {
  if (stopped) return
  for (const lane of Object.keys(LANES)) {
    let inLane = [...running.values()].filter(r => r.lane === lane).length
    while (inLane < LANES[lane].limit) {
      const job = claim(lane)
      if (!job) break
      inLane++
      execute(job, lane)
    }
  }
}

async function execute(job: Job, lane: string): Promise<void> {
  running.set(job.id, { job, lane, startedAt: Date.now() })
  emit('job.started', { jobId: job.id, type: job.type })
  log.info('jobs', `start ${job.type}`, { jobId: job.id, attempt: job.attempts })
  const fn = handlers.get(job.type)
  try {
    if (!fn) throw new AppError('INTERNAL', `No handler for ${job.type}`)
    const result = await fn(job)
    if (!running.has(job.id)) return // lease expired and job was failed meanwhile
    run("UPDATE jobs SET status = 'succeeded', finished_at = ?, result_json = ?, lease_expires_at = NULL, error_code = NULL, error_message = NULL WHERE id = ?",
      now(), result === undefined ? null : JSON.stringify(result), job.id)
    log.info('jobs', `done ${job.type}`, { jobId: job.id })
    emit('job.completed', { jobId: job.id, type: job.type, payload: job.payload })
  } catch (e) {
    if (!running.has(job.id)) return
    fail(job, e)
  } finally {
    running.delete(job.id)
    kick()
  }
}

function fail(job: Job, e: unknown): void {
  const t = now()
  if (e instanceof ParkJob) {
    run("UPDATE jobs SET status = 'queued', attempts = MAX(0, attempts - 1), run_after = ?, lease_expires_at = NULL, error_code = ?, error_message = ? WHERE id = ?",
      e.until, 'PARKED', e.reason, job.id)
    log.info('jobs', `parked ${job.type}`, { jobId: job.id, until: e.until, reason: e.reason })
    return
  }
  const code = e instanceof AppError ? String(e.code) : 'INTERNAL'
  const message = (e as Error)?.message || String(e)
  if (code === 'AI_UNAVAILABLE') {
    run("UPDATE jobs SET status = 'queued', attempts = MAX(0, attempts - 1), run_after = ?, lease_expires_at = NULL, error_code = ?, error_message = ? WHERE id = ?",
      t + 3600_000, code, message, job.id)
    return
  }
  const retryable = !NON_RETRYABLE.has(code) && job.attempts < job.maxAttempts
  if (retryable) {
    const delay = BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)]
    run("UPDATE jobs SET status = 'queued', run_after = ?, lease_expires_at = NULL, error_code = ?, error_message = ? WHERE id = ?", t + delay, code, message, job.id)
    log.warn('jobs', `retry ${job.type}`, { jobId: job.id, code, attempt: job.attempts })
  } else {
    run("UPDATE jobs SET status = 'failed', finished_at = ?, lease_expires_at = NULL, error_code = ?, error_message = ? WHERE id = ?", t, code, message, job.id)
    log.warn('jobs', `failed ${job.type}`, { jobId: job.id, code, message })
  }
  for (const f of failureHooks) {
    try { f(job, code, message, !retryable) } catch (err) { log.error('jobs', 'failure hook threw', { err: String(err) }) }
  }
  if (!retryable) emit('job.failed', { jobId: job.id, type: job.type, code, message, payload: job.payload })
}

type FailureHook = (job: Job, code: string, message: string, final: boolean) => void
const failureHooks: FailureHook[] = []
/** Called on every failed attempt (final=true when no retry remains). Owners record visible failure state here. */
export function onJobFailure(h: FailureHook): void { failureHooks.push(h) }

function renewLeases(): void {
  const t = now()
  for (const r of running.values()) {
    if (Date.now() - r.startedAt > 3 * LEASE_MS) {
      running.delete(r.job.id)
      fail(r.job, new AppError('LEASE_EXPIRED', 'Job exceeded its lease'))
      continue
    }
    run('UPDATE jobs SET lease_expires_at = ? WHERE id = ?', t + LEASE_MS, r.job.id)
  }
}

/** Crash recovery: the single-instance lock guarantees one worker, so every 'running' job is requeued. */
export function requeueStale(): number {
  return run("UPDATE jobs SET status = 'queued', lease_expires_at = NULL, attempts = MAX(0, attempts - 1) WHERE status = 'running'").changes
}

export function startWorker(): void {
  stopped = false
  timer = setInterval(pump, 500)
  leaseTimer = setInterval(renewLeases, 60_000)
  kick()
}

export async function stopWorker(graceMs = 5000): Promise<void> {
  stopped = true
  if (timer) clearInterval(timer)
  if (leaseTimer) clearInterval(leaseTimer)
  const until = Date.now() + graceMs
  while (running.size && Date.now() < until) await new Promise(r => setTimeout(r, 100))
}

/** Test helper: wait until no runnable job is queued and none is running. */
export async function drain(timeoutMs = 300_000): Promise<{ drained: boolean; pending: number }> {
  const until = Date.now() + timeoutMs
  for (;;) {
    pump()
    const due = one<{ n: number }>("SELECT COUNT(*) n FROM jobs WHERE status = 'queued' AND run_after <= ?", now())!.n
    if (!due && running.size === 0) {
      await new Promise(r => setTimeout(r, 150))
      const due2 = one<{ n: number }>("SELECT COUNT(*) n FROM jobs WHERE status = 'queued' AND run_after <= ?", now())!.n
      if (!due2 && running.size === 0) return { drained: true, pending: 0 }
    }
    if (Date.now() > until) return { drained: false, pending: due + running.size }
    await new Promise(r => setTimeout(r, 200))
  }
}

export function cleanupJobs(): void {
  const t = now()
  run("DELETE FROM jobs WHERE status IN ('succeeded','cancelled') AND finished_at < ?", t - 7 * 86400_000)
  run("DELETE FROM jobs WHERE status = 'failed' AND finished_at < ?", t - 30 * 86400_000)
}
