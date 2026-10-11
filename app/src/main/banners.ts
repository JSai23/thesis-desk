// Today banner slot (M1, M14): computed from state on every app.status call (RFC §1B.3 app.status.banners).
import { all, one } from './db'
import { getSetting } from './settings'
import { readAuth } from './ai/codex-auth'
import { usagePauseUntil } from './ai/provider'
import { now } from './clock'

export interface Banner { kind: 'source_attention' | 'auth_expired' | 'daily_cap' | 'no_ai_key' | 'open_at_login' | 'ai_usage' | 'email_auth'; sourceIds?: string[]; text: string; action?: string; action2?: string }

export function computeBanners(): Banner[] {
  const out: Banner[] = []
  const ai = readAuth()
  if (ai.status === 'not_found') out.push({ kind: 'no_ai_key', text: 'Sign in to ChatGPT with Codex to organize what comes in', action: 'How' })
  else if (ai.status === 'signed_out') out.push({ kind: 'no_ai_key', text: 'Your ChatGPT sign-in expired. Run `codex login`.', action: 'How' })
  const expired = all<{ id: string; name: string }>("SELECT id, name FROM sources WHERE deleted_at IS NULL AND auth_state = 'expired'")
  for (const s of expired) out.push({ kind: 'auth_expired', sourceIds: [s.id], text: `${s.name} needs you to sign in again`, action: 'Sign in' })
  const attention = all<{ id: string }>("SELECT id FROM sources WHERE deleted_at IS NULL AND kind <> 'manual' AND (health IN ('failing','blocked') OR auth_state IN ('expired','blocked'))")
  if (attention.length) out.push({ kind: 'source_attention', sourceIds: attention.map(a => a.id), text: `${attention.length} source${attention.length === 1 ? ' needs' : 's need'} attention`, action: 'Review' })
  const capParked = one<{ n: number }>("SELECT COUNT(*) n FROM jobs WHERE status = 'queued' AND type = 'PROCESS_DOCUMENT' AND error_code = 'PARKED' AND error_message = 'daily_cap' AND run_after > ?", now())!.n
  if (capParked) out.push({ kind: 'daily_cap', text: `Reading paused for today — your daily limit of ${getSetting('processing.daily_cap')} articles is reached (${capParked} waiting)`, action: 'Read the rest now', action2: 'Change limit' })
  const until = usagePauseUntil()
  if (until) out.push({ kind: 'ai_usage', text: `Pausing AI work to leave room in your ChatGPT plan until ${new Date(until).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` })
  if (getSetting('email.auth_failed')) out.push({ kind: 'email_auth', text: 'Gmail rejected the app password. Create a new one in Settings ▸ Accounts.', action: 'Open' })
  const dismissed = getSetting<string[]>('banners.dismissed') || []
  const userSources = one<{ n: number }>("SELECT COUNT(*) n FROM sources WHERE origin <> 'system' AND kind <> 'manual'")!.n
  if (userSources >= 1 && !getSetting('open_at_login') && !dismissed.includes('open_at_login'))
    out.push({ kind: 'open_at_login', text: 'Research Workspace checks your sources only while it’s running', action: 'Open at login' })
  return out
}
