// Presentation helpers ported from the prototype (colors, hues) plus date labels for real timestamps.

/** Deterministic hue (0–359) for an object without a stored color. */
export function hueOf(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return 20 + (h % 320)
}

export function col(h: number, l = 0.76, c = 0.1): string { return h === 0 ? `oklch(${l + 0.08} 0 0)` : `oklch(${l} ${c} ${h})` }
export const convColor = (n: number) => ['var(--g55555e)', 'var(--o7-02-255)', 'var(--o72-05-255)', 'var(--o75-08-255)', 'var(--o78-11-255)', 'var(--o8-13-255)'][n] || 'var(--g55555e)'
export const stanceColor = (s: string) => (s === 'support' ? 'var(--o78-12-155)' : s === 'contra' ? 'var(--o8-12-65)' : 'var(--o8-08-255)')
export const stanceLabel = (s: string) => (s === 'support' ? 'Supports' : s === 'contra' ? 'Challenges' : 'Related')
export const initialOf = (s: string) => (s || '?').replace('@', '').trim()[0]?.toUpperCase() || '?'

const MIN = 60_000, HOUR = 3600_000, DAY = 86400_000

/** "Just now", "12m", "3h", "Yesterday", "Sep 24" relative to `now`. */
export function ago(t: number | null | undefined, now: number): string {
  if (!t) return ''
  const d = now - t
  if (d < MIN) return 'Just now'
  if (d < HOUR) return Math.floor(d / MIN) + 'm'
  if (d < DAY) return Math.floor(d / HOUR) + 'h'
  if (d < 2 * DAY) return 'Yesterday'
  return shortDate(t)
}

/** Timestamps, or calendar dates "YYYY-MM-DD" (read as local dates, not UTC midnight, which would show the day before). */
const toDate = (t: number | string) => (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10))) : new Date(t))
/** "Sep 24", or "Jan 8, 2025" when the date is not in the current year (an old article must not read as recent). */
export const shortDate = (t: number | string | null | undefined) => {
  if (!t) return ''
  const d = toDate(t)
  return d.toLocaleDateString('en-US', d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * When an item is from: relative time ("2m", "3h") only for genuinely recent publication; otherwise the publish date.
 * Undated items fall back to when they were first captured.
 */
export function itemTime(publishedAt: number | null | undefined, capturedAt: number | null | undefined, now: number): string {
  if (publishedAt && publishedAt <= now + HOUR) return now - publishedAt < 2 * DAY ? ago(Math.min(publishedAt, now), now) : shortDate(publishedAt)
  return ago(capturedAt, now)
}
export const longDate = (t: number | string | null | undefined) => (t ? toDate(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
export const monthYear = (t: number) => new Date(t).toLocaleString('en-US', { month: 'long', year: 'numeric' })
export const weekdayLong = (t: number) => new Date(t).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
