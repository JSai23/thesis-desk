// npm run smoke [-- PH-03]   → builds the app, then runs the Playwright project (one worker, live AI, no LLM cache).
// Extra args are passed through as a title filter: `npm run smoke -- PH-03` runs only SMK tests tagged PH-03.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [suite, ...rest] = process.argv.slice(2)
if (!suite) { console.error('usage: run-suite.mjs <smoke|e2e-backend|e2e-product|live> [filter]'); process.exit(2) }
if (process.env.RW_LLM_CACHE && process.env.RW_LLM_CACHE !== 'off') { console.error('RW_LLM_CACHE must be off for gate runs'); process.exit(2) }
if (!process.env.SKIP_BUILD) {
  const b = spawnSync('npx', ['electron-vite', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (b.status !== 0) process.exit(b.status ?? 1)
}
const filter = rest.filter(a => !a.startsWith('-'))
const flags = rest.filter(a => a.startsWith('-'))
const args = ['playwright', 'test', '-c', 'tests/playwright.config.ts', '--project', suite, ...flags, ...(filter.length ? ['-g', filter.join('|')] : [])]
const r = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, RW_SUITE: suite } })
process.exit(r.status ?? 1)
