// Development test commands (TestPlan.md). Full acceptance stays `npm run accept` (tests/acceptance.mjs).
//   npm run test:quick [-- --since <rev>] [-- --specs a,b]   static audit + tests for the changed areas
//   npm run test:area  [-- --since <rev>]                    static audit + every fixture test + changed real-data areas
// Changed = commits since --since (default: the last commit a passing run of this command tested) + the working tree.
// Fixture tests replay recorded AI answers (RW_AI_REPLAY, DEC-098) on RW_WORKERS workers, each with its own fixture
// server; real-data tests ask live, on their own workers, at the same time. Everything headless.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { changedFiles, select, suiteOf, FIXTURE_DIRS } from './areas.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] === 'area' ? 'area' : 'quick'
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const STATE = path.join(ROOT, 'tests/results', `.last-${mode}`)
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
const since = arg('--since') || (fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8').trim() : 'HEAD~1')
const RUN = `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`
const OUT = path.join(ROOT, 'tests/results', RUN)
fs.mkdirSync(OUT, { recursive: true })
const t0 = Date.now()
const mins = t => Math.round((Date.now() - t) / 6000) / 10

const named = (arg('--specs') || '').split(',').filter(Boolean)
const files = changedFiles(since)
const sel = named.length ? { specs: named, areas: ['(named)'], why: [] } : select(mode, files)
console.log(`test:${mode} — changes since ${since.slice(0, 10)}: ${files.length} file(s); areas: ${sel.areas.join(', ') || 'none'}`)
for (const [f, w] of sel.why) console.log(`  ${f} → ${w}`)

// 0 · static audit
const audit = spawnSync('node', ['tests/audit-static.mjs'], { cwd: ROOT, encoding: 'utf8' })
fs.writeFileSync(path.join(OUT, 'audit.txt'), audit.stdout + audit.stderr)
if (audit.status !== 0) { console.error(audit.stdout + audit.stderr); console.error('static audit failed'); process.exit(1) }
console.log('  ✓ static audit')
if (!sel.specs.length) { finish([], true); process.exit(0) }

// build (incremental: no clean, no reinstall — accept does those)
if (!process.argv.includes('--no-build')) {
  const b = spawnSync('npx', ['electron-vite', 'build'], { cwd: ROOT, encoding: 'utf8' })
  if (b.status !== 0) { console.error(b.stdout + b.stderr); process.exit(1) }
  console.log('  ✓ build')
}

const fixture = sel.specs.filter(f => FIXTURE_DIRS.includes(suiteOf(f)))
const real = sel.specs.filter(f => suiteOf(f) === 'realdata')
const workers = (n, k) => String(Math.max(1, Math.min(n, k)))
const lanes = [
  fixture.length && { id: 'fixture', specs: fixture, projects: FIXTURE_DIRS, env: { RW_AI_REPLAY: '1', RW_WORKERS: workers(fixture.length, Number(process.env.RW_FIXTURE_WORKERS || 4)), RW_FIXTURE_PORT_BASE: '4710' } },
  real.length && { id: 'realdata', specs: real, projects: ['realdata'], env: { RW_WORKERS: workers(real.length, 4), RW_FIXTURE_PORT_BASE: '4800', RW_LIBRARY_REUSE: '1' } }
].filter(Boolean)

const runLane = l => new Promise(resolve => {
  const t = Date.now()
  const args = ['playwright', 'test', '-c', 'tests/playwright.config.ts', ...l.specs.map(f => `tests/${f}`), ...l.projects.map(p => `--project=${p}`)]
  const log = fs.openSync(path.join(OUT, `${l.id}.log`), 'w')
  const env = { ...process.env, ...l.env, RW_RUN_ID: RUN, RW_SUITE: l.id, SKIP_BUILD: '1' }
  delete env.RW_LLM_CACHE
  console.log(`  … ${l.id}: ${l.specs.length} file(s) on ${l.env.RW_WORKERS} worker(s)${l.env.RW_AI_REPLAY ? ', AI replayed' : ', live AI'} — log tests/results/${RUN}/${l.id}.log`)
  const c = spawn('npx', args, { cwd: ROOT, env, stdio: ['ignore', log, log] })
  c.on('exit', code => resolve({ id: l.id, code: code ?? 1, minutes: mins(t) }))
})

const results = await Promise.all(lanes.map(runLane))
finish(results, results.every(r => r.code === 0))
process.exit(results.every(r => r.code === 0) ? 0 : 1)

function finish(results, ok) {
  const summary = { run: RUN, mode, head, since, changed: files, areas: sel.areas, specs: sel.specs, lanes: [], ok, minutes: mins(t0) }
  for (const r of results) {
    const rep = path.join(OUT, `${r.id}.json`)
    const tests = []
    if (fs.existsSync(rep)) {
      const walk = s => { for (const sp of s.specs || []) for (const t of sp.tests) tests.push({ file: sp.file, title: sp.title, status: t.status, seconds: Math.round(t.results.reduce((a, x) => a + x.duration, 0) / 1000) }); (s.suites || []).forEach(walk) }
      walk(JSON.parse(fs.readFileSync(rep, 'utf8')))
    }
    const failed = tests.filter(t => t.status !== 'expected' && t.status !== 'skipped')
    summary.lanes.push({ id: r.id, exit: r.code, minutes: r.minutes, tests: tests.length, failed: failed.map(t => `${t.file} › ${t.title}`) })
    console.log(`  ${r.code === 0 ? '✓' : '✘'} ${r.id}: ${tests.length - failed.length}/${tests.length} passed in ${r.minutes} min`)
    for (const t of failed) console.log(`      ✘ ${t.file} › ${t.title}`)
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
  // the next run tests what changed after this commit — only once everything passed
  if (ok && !named.length) fs.writeFileSync(STATE, head)
  console.log(`test:${mode} ${ok ? 'passed' : 'FAILED'} in ${summary.minutes} min → tests/results/${RUN}/summary.json`)
}
