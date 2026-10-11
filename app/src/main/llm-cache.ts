// LLM response cache (RW_LLM_CACHE=rw), keyed by the exact request (model, instructions, input): a changed prompt or
// input misses and asks live. Used by fixture tests in test:quick / test:area with a shared dir (RW_LLM_CACHE_DIR,
// DEC-098) and for dev iteration; never in `accept` or real-data tests, which assert it is off. Lives outside ai/ so AI
// modules perform no file writes (static audit, B-AGENT-003).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { LLM_CACHE, LLM_CACHE_DIR } from './env'

let dir: string | null = null
export function initLlmCache(dataDir: string): void { dir = LLM_CACHE === 'rw' ? LLM_CACHE_DIR || path.join(dataDir, 'cache', 'llm') : null }
export const cacheKey = (body: unknown): string | null => (dir ? crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') : null)
export function cacheGet<T>(key: string | null): T | null {
  if (!key || !dir) return null
  const f = path.join(dir, key + '.json')
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as T) : null
}
export function cachePut(key: string | null, value: unknown): void {
  if (!key || !dir) return
  fs.mkdirSync(dir, { recursive: true })
  // parallel test apps share the dir: write then rename, so a reader never sees half a file
  const tmp = path.join(dir, `${key}.${process.pid}.tmp`)
  fs.writeFileSync(tmp, JSON.stringify(value))
  fs.renameSync(tmp, path.join(dir, key + '.json'))
}
