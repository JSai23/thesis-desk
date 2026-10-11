// ModelProvider: the only code that talks to the model endpoint (RFC §1B.12.1, B-AGENT-005, DEC-061).
// GPT-6 Luna via the ChatGPT Codex backend using the local Codex sign-in; strict json_schema output; SSE consumed internally.
import { z, type ZodType } from 'zod'
import { readAuth, refreshAuth, type AuthState } from './codex-auth'
import { MODEL } from './models'
import { AppError } from '../errors'
import { fault, faultArg } from '../faults'
import { getSetting, setSetting } from '../settings'
import { initLlmCache, cacheKey, cacheGet, cachePut } from '../llm-cache'
import { now } from '../clock'
import { log } from '../log'

const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
const TIMEOUT_MS = 120_000
const STALL_MS = 90_000
const STREAM_MAX_MS = 6 * 60_000
const RETRY_DELAYS = [1000, 4000]

export interface Usage { inputTokens: number; outputTokens: number; cachedTokens: number }
export interface UsageInfo { primaryUsedPercent: number | null; secondaryUsedPercent: number | null; primaryResetAt: number | null; secondaryResetAt: number | null; plan?: string; at: number }

export function initProvider(dataDir: string): void { initLlmCache(dataDir) }

export function aiState(): AuthState { return readAuth() }

/** Convert a zod schema to an OpenAI strict JSON Schema: every property required, optional → nullable, no unsupported keywords. */
export function strictJsonSchema(schema: ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, any>
  const DROP = new Set(['$schema', 'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'default', 'title'])
  const walk = (n: any): any => {
    if (Array.isArray(n)) return n.map(walk)
    if (!n || typeof n !== 'object') return n
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(n)) {
      if (DROP.has(k)) continue
      // `properties` maps user field names (which may be called "title", "format"…): never filter its keys
      out[k] = k === 'properties' && v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, walk(pv)])) : walk(v)
    }
    if (out.type === 'object' || out.properties) {
      out.type = 'object'
      const props = out.properties || {}
      const req = new Set<string>(out.required || [])
      for (const key of Object.keys(props)) {
        if (!req.has(key)) props[key] = { anyOf: [props[key], { type: 'null' }] }
      }
      out.properties = props
      out.required = Object.keys(props)
      out.additionalProperties = false
    }
    return out
  }
  return walk(js)
}

/** Replace JSON nulls with undefined so zod `.optional()` fields accept them. */
export function nullsToUndefined(v: any): any {
  if (v === null) return undefined
  if (Array.isArray(v)) return v.map(nullsToUndefined)
  if (v && typeof v === 'object') {
    const o: Record<string, any> = {}
    for (const [k, x] of Object.entries(v)) { const y = nullsToUndefined(x); if (y !== undefined) o[k] = y }
    return o
  }
  return v
}

function recordUsage(h: Headers, plan?: string): UsageInfo {
  const n = (k: string) => { const v = h.get(k); return v == null || v === '' ? null : Number(v) }
  const resetAt = (k: string) => { const v = h.get(k); if (!v) return null; const x = Number(v); return Number.isFinite(x) ? (x < 1e12 ? x * 1000 : x) : Date.parse(v) || null }
  const forced = faultArg('usage')
  const u: UsageInfo = {
    primaryUsedPercent: forced ? Number(forced) : n('x-codex-primary-used-percent'),
    secondaryUsedPercent: forced ? Number(forced) : n('x-codex-secondary-used-percent'),
    primaryResetAt: resetAt('x-codex-primary-reset-at') ?? (n('x-codex-primary-reset-after-seconds') != null ? now() + n('x-codex-primary-reset-after-seconds')! * 1000 : null),
    secondaryResetAt: resetAt('x-codex-secondary-reset-at') ?? (n('x-codex-secondary-reset-after-seconds') != null ? now() + n('x-codex-secondary-reset-after-seconds')! * 1000 : null),
    plan: h.get('x-codex-plan-type') || plan, at: now()
  }
  setSetting('ai.usage', u)
  return u
}

/** One request, body included. The stream is read under two limits — no bytes for STALL_MS, or STREAM_MAX_MS in all —
 *  so a stream that stalls after its headers is aborted and retried instead of hanging the task (MEM-052). */
async function postOnce(accessToken: string, accountId: string, body: unknown): Promise<{ res: Response; text: string }> {
  const ac = new AbortController()
  let idle = setTimeout(() => ac.abort(), TIMEOUT_MS) // time to headers
  const cap = setTimeout(() => ac.abort(), STREAM_MAX_MS)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST', signal: ac.signal,
      headers: { Authorization: `Bearer ${accessToken}`, 'chatgpt-account-id': accountId, originator: 'codex_cli_rs', 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body)
    })
    if (!res.body) return { res, text: '' }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let text = ''
    for (;;) {
      clearTimeout(idle); idle = setTimeout(() => ac.abort(), STALL_MS)
      const { done, value } = await reader.read()
      if (done) break
      text += dec.decode(value, { stream: true })
    }
    return { res, text: text + dec.decode() }
  } finally { clearTimeout(idle); clearTimeout(cap) }
}

function parseSse(text: string): { out: string; usage: any; error: string | null } {
  let out = ''; let usage: any = null; let error: string | null = null
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const d = line.slice(5).trim()
    if (!d || d === '[DONE]') continue
    try {
      const e = JSON.parse(d)
      if (e.type === 'response.output_text.delta') out += e.delta
      else if (e.type === 'response.completed') usage = e.response?.usage
      else if (e.type === 'error' || e.type === 'response.failed') error = String(e.error?.message || e.response?.error?.message || e.message || 'model error').slice(0, 300)
    } catch { /* ignore non-JSON lines */ }
  }
  return { out, usage, error }
}

export interface RawResult { text: string; usage: Usage }

/** One model call returning the raw JSON text. Throws AppError(AI_UNAVAILABLE | PROVIDER_ERROR | RATE_LIMITED). */
export async function callModel(task: string, system: string, user: string, schema: ZodType, maxOutputTokens: number): Promise<RawResult> {
  if (fault('provider_error', task)) throw new AppError('PROVIDER_ERROR', `Injected provider error for ${task}`)
  const body = {
    model: MODEL, store: false, stream: true, instructions: system, reasoning: { effort: 'none' },
    input: [{ role: 'user', content: [{ type: 'input_text', text: user }] }],
    text: { format: { type: 'json_schema', name: task.toLowerCase(), strict: true, schema: strictJsonSchema(schema) } }
  }
  void maxOutputTokens // the Codex backend rejects max_output_tokens; task output size is bounded by schemas (see DEC-078)
  const key = cacheKey(body)
  const cached = cacheGet<RawResult>(key)
  if (cached) return cached
  let st = readAuth()
  if (st.status !== 'ok') throw new AppError('AI_UNAVAILABLE', st.reason)
  if (st.auth.accessExp && st.auth.accessExp - Date.now() < 5 * 60_000) {
    st = await refreshAuth(st.auth.accessToken)
    if (st.status !== 'ok') throw new AppError('AI_UNAVAILABLE', st.reason)
  }
  let refreshed = false
  for (let attempt = 0; ; attempt++) {
    let res: Response, text: string
    try {
      ({ res, text } = await postOnce(st.auth.accessToken, st.auth.accountId, body))
    } catch (e) {
      if (attempt < RETRY_DELAYS.length) { await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt])); continue }
      throw new AppError('PROVIDER_ERROR', `Couldn't reach the AI provider (${(e as Error).name})`)
    }
    if (res.status === 401 && !refreshed) {
      refreshed = true
      st = await refreshAuth(st.auth.accessToken)
      if (st.status !== 'ok') throw new AppError('AI_UNAVAILABLE', st.reason)
      continue
    }
    const usageInfo = recordUsage(res.headers, st.auth.plan)
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'))
      const until = Number.isFinite(ra) && ra > 0 ? now() + ra * 1000 : (usageInfo.primaryResetAt ?? now() + 15 * 60_000)
      throw new AppError('RATE_LIMITED', 'The ChatGPT plan limit was reached', { until })
    }
    if (res.status >= 500 || res.status === 408) {
      if (attempt < RETRY_DELAYS.length) { await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt])); continue }
      throw new AppError('PROVIDER_ERROR', `The AI provider returned an error (${res.status})`)
    }
    if (res.status >= 400) throw new AppError('PROVIDER_ERROR', `The AI provider rejected the request (${res.status}): ${text.slice(0, 200)}`)
    const p = parseSse(text)
    if (p.error) {
      if (attempt < RETRY_DELAYS.length) { await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt])); continue }
      throw new AppError('PROVIDER_ERROR', p.error)
    }
    const result: RawResult = { text: p.out, usage: { inputTokens: p.usage?.input_tokens ?? 0, outputTokens: p.usage?.output_tokens ?? 0, cachedTokens: p.usage?.input_tokens_details?.cached_tokens ?? 0 } }
    cachePut(key, result)
    log.info('provider', `call ${task}`, { status: res.status, in: result.usage.inputTokens, out: result.usage.outputTokens })
    return result
  }
}

/** Usage guard (B-AGENT-008): returns the reset time when background AI work must pause, else null. */
export function usagePauseUntil(): number | null {
  const u = getSetting<UsageInfo | null>('ai.usage')
  const ceiling = Number(getSetting('ai.usage_ceiling') ?? 85)
  const forced = faultArg('usage')
  const p = forced ? Number(forced) : u?.primaryUsedPercent ?? 0
  const s = forced ? Number(forced) : u?.secondaryUsedPercent ?? 0
  if (p >= ceiling) return Math.max(u?.primaryResetAt ?? 0, now() + 3600_000)
  if (s >= ceiling) return Math.max(u?.secondaryResetAt ?? 0, now() + 3600_000)
  return null
}

/** One-call check used by Settings ▸ Accounts ▸ ChatGPT ▸ Test. */
export async function testCall(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const t0 = Date.now()
  const r = await callModel('AI_TEST', 'Reply with the JSON object requested.', 'Return {"ok": true}.', z.object({ ok: z.boolean() }), 20)
  const v = JSON.parse(r.text)
  return { ok: v.ok === true, message: v.ok === true ? 'ChatGPT sign-in works' : 'Unexpected reply', latencyMs: Date.now() - t0 }
}
