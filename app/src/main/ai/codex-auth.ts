// Reads the ChatGPT sign-in that the Codex CLI keeps in $CODEX_HOME/auth.json and refreshes it the way Codex does
// (RFC §1B.12.1, DEC-061, MEM-012, MEM-018). The only module (with provider.ts) that touches auth.json.
// Writes are atomic (temp + rename, mode preserved) and serialized by a cross-process lock file.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { log } from '../log'

const CODEX_HOME = process.env.RW_CODEX_HOME || path.join(os.homedir(), '.codex')

const AUTH_FILE = () => path.join(CODEX_HOME, 'auth.json')
const LOCK_FILE = () => path.join(CODEX_HOME, 'auth.json.rw-lock')
const REFRESH_URL = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

export interface CodexAuth { accessToken: string; accountId: string; refreshToken: string; email?: string; plan?: string; accessExp?: number }
export type AuthState = { status: 'ok'; auth: CodexAuth } | { status: 'not_found' | 'signed_out'; reason: string }

let lastSeenAccess: string | null = null
let signedOut = false

function decode(jwt: string | undefined): Record<string, any> {
  if (!jwt) return {}
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) } catch { return {} }
}

function readFileAuth(): { raw: any; auth: CodexAuth } | null {
  let raw: any
  try { raw = JSON.parse(fs.readFileSync(AUTH_FILE(), 'utf8')) } catch { return null }
  const t = raw?.tokens
  if (String(raw?.auth_mode || '').toLowerCase() !== 'chatgpt' || !t?.access_token || !t?.refresh_token || !t?.account_id) return null
  const id = decode(t.id_token)
  const access = decode(t.access_token)
  return {
    raw,
    auth: {
      accessToken: t.access_token, refreshToken: t.refresh_token, accountId: t.account_id,
      email: id.email, plan: id['https://api.openai.com/auth']?.chatgpt_plan_type, accessExp: access.exp ? access.exp * 1000 : undefined
    }
  }
}

export function readAuth(): AuthState {
  const r = readFileAuth()
  if (!r) return { status: 'not_found', reason: 'No ChatGPT sign-in found for Codex on this Mac' }
  if (signedOut && r.auth.accessToken === lastSeenAccess) return { status: 'signed_out', reason: 'Your ChatGPT sign-in expired. Run `codex login`.' }
  signedOut = false
  return { status: 'ok', auth: r.auth }
}

function takeLock(): number | null {
  const lock = LOCK_FILE()
  for (let i = 0; i < 2; i++) {
    try { return fs.openSync(lock, 'wx') } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 60_000) { fs.rmSync(lock, { force: true }); continue }
      } catch { continue }
      return null
    }
  }
  return null
}

/**
 * Refresh the access token once. If another process (Codex or another app instance) already refreshed it,
 * the new tokens on disk are used and no refresh request is made.
 */
export async function refreshAuth(staleAccess: string): Promise<AuthState> {
  let fd: number | null = null
  for (let i = 0; i < 50 && fd === null; i++) {
    fd = takeLock()
    if (fd === null) await new Promise(r => setTimeout(r, 200))
  }
  if (fd === null) return readAuth()
  try {
    const cur = readFileAuth()
    if (!cur) return { status: 'not_found', reason: 'No ChatGPT sign-in found for Codex on this Mac' }
    if (cur.auth.accessToken !== staleAccess) return { status: 'ok', auth: cur.auth }
    const res = await fetch(REFRESH_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: cur.auth.refreshToken, scope: 'openid profile email' })
    })
    if (!res.ok) {
      log.warn('codex-auth', `token refresh failed HTTP ${res.status}`)
      signedOut = true
      lastSeenAccess = cur.auth.accessToken
      return { status: 'signed_out', reason: 'Your ChatGPT sign-in expired. Run `codex login`.' }
    }
    const j = await res.json() as { id_token?: string; access_token?: string; refresh_token?: string }
    const file = AUTH_FILE()
    const mode = fs.statSync(file).mode & 0o777
    const next = { ...cur.raw, tokens: { ...cur.raw.tokens, id_token: j.id_token ?? cur.raw.tokens.id_token, access_token: j.access_token ?? cur.raw.tokens.access_token, refresh_token: j.refresh_token ?? cur.raw.tokens.refresh_token }, last_refresh: new Date().toISOString() }
    const tmp = `${file}.rw-tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode })
    fs.renameSync(tmp, file)
    log.info('codex-auth', 'token refreshed')
    return readAuth()
  } finally {
    fs.closeSync(fd)
    fs.rmSync(LOCK_FILE(), { force: true })
  }
}
