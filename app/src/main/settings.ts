// Settings key/value store (RFC §1B.4.2 settings keys, §1B.21 semantics).
import { all, run, one } from './db'
import { now } from './clock'

export const DEFAULTS: Record<string, unknown> = {
  display_name: '',
  research_instruction: '',
  'ai.suggest': true,
  'ai.extract': true,
  'ai.organize': true,
  'ai.summarize': true,
  'ai.summary_len': 'Medium',
  'ai.usage_ceiling': 85,
  'ai.usage': null,
  keep_dismissed: true,
  pause_polling: false,
  open_at_login: false,
  'notify.in_app': true,
  'notify.email': true,
  'notify.highlight_new': true,
  'appearance.theme': 'dark',
  'appearance.glass': 60,
  'appearance.density': 'compact',
  'appearance.reader_font': 'serif',
  'appearance.group_today_by': 'section',
  'email.account': null,
  'pins.theses': [],
  'pins.companies': [],
  muted_topics: [],
  feedback_weights: { source: {}, thesis: {} },
  recent_queries: [],
  'processing.daily_cap': 0, // 0 = no limit (DEC-101); the ChatGPT usage stop brakes
  'starter_pack.dismissed': [],
  first_run_done: false,
  'banners.dismissed': [],
  'bridge.profile': null
}

/** Keys the renderer may write through settings.update. */
export const USER_WRITABLE = new Set([
  'display_name', 'research_instruction', 'ai.suggest', 'ai.extract', 'ai.organize', 'ai.summarize', 'ai.summary_len', 'ai.usage_ceiling',
  'keep_dismissed', 'pause_polling', 'open_at_login', 'notify.in_app', 'notify.email', 'notify.highlight_new',
  'appearance.theme', 'appearance.glass', 'appearance.density', 'appearance.reader_font', 'appearance.group_today_by',
  'pins.theses', 'pins.companies', 'processing.daily_cap', 'banners.dismissed'
])

export function getSetting<T = any>(key: string): T {
  const r = one<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', key)
  if (!r) return DEFAULTS[key] as T
  try { return JSON.parse(r.value_json) as T } catch { return DEFAULTS[key] as T }
}

export function setSetting(key: string, value: unknown): void {
  run('INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
    key, JSON.stringify(value ?? null), now())
}

export function allSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = { ...DEFAULTS }
  for (const r of all<{ key: string; value_json: string }>('SELECT key, value_json FROM settings')) {
    if (r.key.startsWith('test.')) continue
    try { out[r.key] = JSON.parse(r.value_json) } catch { /* keep default */ }
  }
  return out
}
