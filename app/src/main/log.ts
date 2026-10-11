// JSON-lines logger with secret redaction and 5 × 5 MB rotation (RFC §1B.6, §1B.20).
import fs from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 5 * 1024 * 1024
const KEEP = 5
const SECRET_KEYS = /^(password|authorization|cookie|access_token|refresh_token|id_token|apppassword|app_password)$/i

let file: string | null = null

export function initLog(dataDir: string): void {
  const dir = path.join(dataDir, 'logs')
  fs.mkdirSync(dir, { recursive: true })
  file = path.join(dir, 'app.log')
}

export function redact(s: string): string {
  return s
    .replace(/eyJ[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+){0,2}/g, '[redacted-jwt]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
}

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 5) return '[deep]'
  if (typeof v === 'string') return redact(v)
  if (Array.isArray(v)) return v.map(x => scrub(x, depth + 1))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : scrub(x, depth + 1)
    return out
  }
  return v
}

function rotate(): void {
  if (!file) return
  try {
    if (fs.statSync(file).size < MAX_BYTES) return
  } catch { return }
  for (let i = KEEP - 1; i >= 1; i--) {
    const from = `${file}.${i}`
    if (fs.existsSync(from)) fs.renameSync(from, `${file}.${i + 1}`)
  }
  fs.renameSync(file, `${file}.1`)
  const extra = `${file}.${KEEP}`
  if (fs.existsSync(extra)) fs.rmSync(extra)
}

function write(level: string, module: string, msg: string, ids?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, module, msg: redact(msg), ...(ids ? { ids: scrub(ids) } : {}) })
  if (!file) return
  try {
    rotate()
    fs.appendFileSync(file, line + '\n')
  } catch { /* logging must never throw */ }
}

export const log = {
  info: (module: string, msg: string, ids?: Record<string, unknown>) => write('info', module, msg, ids),
  warn: (module: string, msg: string, ids?: Record<string, unknown>) => write('warn', module, msg, ids),
  error: (module: string, msg: string, ids?: Record<string, unknown>) => write('error', module, msg, ids)
}
