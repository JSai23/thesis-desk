// RFC §3E steps 2–9b in one run id: the blocking real-data stage (DEC-087), then the fixture regression suites (smoke,
// backend E2E, product E2E + VIS-01, blind knowledge, blind UX) and live smoke, then the coverage matrix. Step 1 (git clean -xfd …, npm ci, build, audit) runs before this script.
// Results land in tests/results/<RW_RUN_ID>/ (Playwright JSON per suite, blind summaries, live-smoke.jsonl, acceptance.json).
// Flake policy (§3.0): a failed test may be re-run once in the same run; the report lists it as flaky.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUN = process.env.RW_RUN_ID || 'acc-' + new Date().toISOString().replace(/[:.]/g, '-')
const OUT = path.join(ROOT, 'tests/results', RUN)
fs.mkdirSync(OUT, { recursive: true })
const env = { ...process.env, RW_RUN_ID: RUN, RW_RUN_STARTED: String(Date.now()), RW_LLM_CACHE: 'off', SKIP_BUILD: '1' }
// accept always asks the AI live (DEC-015, DEC-098): recorded answers are for test:quick / test:area only
delete env.RW_AI_REPLAY; delete env.RW_LLM_CACHE_DEV
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean)
// DEC-087: the real-data stage (real sites, real model, real Gmail) is the gate and runs first; the fixture suites stay
// as regression checks — run and reported, failures fixed, but not blocking delivery.
// Two lanes run at the same time (suites inside a lane run in order). Inside a suite, RW_WORKERS files run in parallel.
const lanes = [
  // real-data suites never depend on fixture content: files run on 4 workers
  [{ id: 'realdata', cmd: ['node', 'tests/run-suite.mjs', 'realdata'], blocking: true, env: { RW_WORKERS: '4', RW_FIXTURE_PORT_BASE: '4800' } }],
  // fixture suites on 4 workers, each with its own fixture server (TestPlan.md, DEC-098 — the MEM-051 port leak no longer
  // reproduces); blind and live stay on :4700, one at a time
  [{ id: 'smoke', cmd: ['node', 'tests/run-suite.mjs', 'smoke'], blocking: false, env: { RW_WORKERS: '4', RW_FIXTURE_PORT_BASE: '4710' } },
   { id: 'e2e-backend', cmd: ['node', 'tests/run-suite.mjs', 'e2e-backend'], blocking: false, env: { RW_WORKERS: '4', RW_FIXTURE_PORT_BASE: '4710' } },
   { id: 'e2e-product', cmd: ['node', 'tests/run-suite.mjs', 'e2e-product'], blocking: false, env: { RW_WORKERS: '4', RW_FIXTURE_PORT_BASE: '4710' } },
   { id: 'blind-knowledge', cmd: ['node', 'tests/blind/run.mjs', 'knowledge'], blocking: false, env: {} },
   { id: 'blind-ux', cmd: ['node', 'tests/blind/run.mjs', 'ux'], blocking: false, env: {} },
   { id: 'live', cmd: ['node', 'tests/run-suite.mjs', 'live'], blocking: false, env: {} }]
].map(l => l.filter(s => !only.length || only.includes(s.id))).filter(l => l.length)

const report = { runId: RUN, started: new Date().toISOString(), steps: [] }
{ // static audit (step 1's last command) — recorded with this run
  const a = spawnSync('npm', ['run', '-s', 'audit:static'], { cwd: ROOT, encoding: 'utf8' })
  fs.writeFileSync(path.join(OUT, 'audit.txt'), (a.stdout || '') + (a.stderr || ''))
  report.steps.push({ id: 'audit:static', blocking: true, status: a.status === 0 ? 'passed' : 'failed' })
}
const run = (cmd, stepEnv) => new Promise(resolve => {
  const c = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, env: { ...env, ...stepEnv }, stdio: 'inherit' })
  c.on('exit', code => resolve(code ?? 1))
})
async function runStep(s) {
  const t0 = Date.now()
  console.log(`\n=== ${s.id} ===`)
  let status = (await run(s.cmd, { ...s.env, RW_SUITE: s.id })) === 0 ? 'passed' : 'failed'
  const rec = { id: s.id, blocking: s.blocking, status, minutes: 0, flaky: [] }
  // one same-run retry of failed Playwright tests (flake policy); the retry's JSON report is kept beside the first
  if (status === 'failed' && s.cmd[1] === 'tests/run-suite.mjs') {
    const rep = path.join(OUT, `${s.id}.json`)
    const failed = fs.existsSync(rep) ? collectFailed(JSON.parse(fs.readFileSync(rep, 'utf8'))) : []
    if (failed.length && failed.length <= 6) {
      fs.copyFileSync(rep, path.join(OUT, `${s.id}.first.json`))
      console.log(`\n=== ${s.id} retry ===`)
      const code = await run(['node', 'tests/run-suite.mjs', s.id, failed.map(t => t.replace(/[|()[\]{}^$*+?.\\/]/g, '.')).join('|')], { ...s.env, RW_SUITE: s.id + '.retry' })
      if (code === 0) { status = 'passed-with-retry'; rec.flaky = failed }
      rec.status = status
    }
  }
  rec.minutes = Math.round((Date.now() - t0) / 6000) / 10
  report.steps.push(rec)
  fs.writeFileSync(path.join(OUT, 'acceptance.json'), JSON.stringify(report, null, 2))
  console.log(`\n=== ${s.id} done: ${rec.status} (${rec.minutes} min) ===`)
}
// Electron 44 downloads its binary on first launch; lanes launching at once would download into the same folder and
// corrupt it (MEM-050). Install it once, here, before anything launches.
{
  const i = spawnSync('npx', ['install-electron', '--no'], { cwd: ROOT, encoding: 'utf8' })
  const p = fs.existsSync(path.join(ROOT, 'node_modules/electron/path.txt')) ? fs.readFileSync(path.join(ROOT, 'node_modules/electron/path.txt'), 'utf8').trim() : ''
  if (i.status !== 0 || p !== 'Electron.app/Contents/MacOS/Electron') { console.error('electron install failed', i.stderr, p); process.exit(1) }
}
await Promise.all(lanes.map(async lane => { for (const s of lane) await runStep(s) }))
const cov = spawnSync('node', ['tests/coverage.mjs', OUT, ...blindSummaries()], { cwd: ROOT, encoding: 'utf8' })
report.coverage = { exit: cov.status, output: cov.stdout.trim() }
report.finished = new Date().toISOString()
report.blockingPassed = report.steps.filter(s => s.blocking).every(s => s.status !== 'failed') && cov.status === 0
fs.writeFileSync(path.join(OUT, 'acceptance.json'), JSON.stringify(report, null, 2))
console.log(`\n${report.coverage.output}\nblocking passed: ${report.blockingPassed} → ${path.relative(ROOT, OUT)}/acceptance.json`)
process.exit(report.blockingPassed ? 0 : 1)

/** Titles to re-run: a failed test's whole describe block (a serial suite skips everything after a failure, and its
 *  later tests depend on the earlier ones), else the test itself. */
function collectFailed(rep) {
  const out = new Set()
  const walk = (s, parent) => {
    for (const x of s.suites || []) walk(x, x.title && !/\.spec\.ts$/.test(x.title) ? x.title : parent)
    for (const sp of s.specs || []) if (!sp.ok) out.add(parent || sp.title)
  }
  walk(rep, null)
  return [...out]
}
function blindSummaries() {
  const dir = path.join(ROOT, 'tests/blind/runs')
  if (!fs.existsSync(dir)) return []
  const since = Date.parse(report.started)
  return fs.readdirSync(dir).map(d => path.join(dir, d, 'summary.json')).filter(f => fs.existsSync(f) && fs.statSync(f).mtimeMs >= since)
}
