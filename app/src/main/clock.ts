// Single time source. In test mode the clock is fake: it starts at max(RW_TEST_NOW, last persisted fake time)
// and advances in real time; only test.clock.set may move it backwards (RFC §1B.2).
import { TEST_MODE, TEST_NOW } from './env'

let offset = 0

export function initClock(persistedLast: number | null): void {
  if (!TEST_MODE) return
  const fromEnv = TEST_NOW ? Date.parse(TEST_NOW) : Date.now()
  const start = Math.max(Number.isFinite(fromEnv) ? fromEnv : Date.now(), persistedLast ?? 0)
  offset = start - Date.now()
}

export const now = (): number => Date.now() + offset

export function setClock(ms: number): void { offset = ms - Date.now() }
export function advanceClock(ms: number): void { offset += ms }

/** Local midnight following `t` (TZ from the process environment). */
export function nextLocalMidnight(t = now()): number {
  const d = new Date(t)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

export function localMidnight(t = now()): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Calendar date (YYYY-MM-DD) in the app's local time zone — not UTC, which shifts evening times to the next day. */
export function localDay(t = now()): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
