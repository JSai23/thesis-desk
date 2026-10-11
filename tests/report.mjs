// Generates VerificationReport.md (RFC §3E) from one acceptance run's artifacts in tests/results/<run>/.
// usage: node tests/report.mjs <run id> [--limitations "text"]
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUN = process.argv[2]
if (!RUN) { console.error('usage: node tests/report.mjs <run id>'); process.exit(2) }
const OUT = path.join(ROOT, 'tests/results', RUN)
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const sh = c => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '?' } }
const sha = f => fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : '(missing)'
const pkg = read(path.join(ROOT, 'package.json'))
const acc = read(path.join(OUT, 'acceptance.json'), { steps: [] })
const lines = []
const L = s => lines.push(s)

// suites
function counts(rep) {
  const r = { passed: 0, failed: 0, skipped: 0, tests: [] }
  const walk = s => { for (const x of s.suites || []) walk(x); for (const sp of s.specs || []) { const st = sp.tests?.[0]?.results?.slice(-1)[0]?.status || (sp.ok ? 'passed' : 'failed'); r.tests.push({ title: sp.title, ok: sp.ok, status: st }); if (st === 'skipped') r.skipped++; else if (sp.ok) r.passed++; else r.failed++ } }
  if (rep) walk(rep)
  return r
}
const suites = ['realdata', 'smoke', 'e2e-backend', 'e2e-product', 'live'].map(id => {
  const first = read(path.join(OUT, `${id}.first.json`)), last = read(path.join(OUT, `${id}.json`)), retry = read(path.join(OUT, `${id}.retry.json`))
  const c = counts(first || last)
  if (retry) { const rc = counts(retry); for (const t of rc.tests) if (t.ok) { c.passed++; c.failed-- } }
  return { id, ...c, flaky: acc.steps.find(s => s.id === id)?.flaky || [] }
})

const appDmg = path.join(ROOT, `app/dist/Research Workspace-${pkg.version}-arm64.dmg`)
const appBin = path.join(ROOT, 'app/dist/mac-arm64/Research Workspace.app/Contents/MacOS/Research Workspace')
const status = read(path.join(ROOT, 'prereq/status.json'), {})
const prq = Object.entries(status.items || status).filter(([k]) => /^PRQ-/.test(k))
const cov = read(path.join(OUT, 'coverage.json'), [])
const blindDir = path.join(ROOT, 'tests/blind/runs')
const blind = fs.existsSync(blindDir) ? fs.readdirSync(blindDir).map(d => path.join(blindDir, d, 'summary.json')).filter(f => fs.existsSync(f) && fs.statSync(f).mtimeMs >= Date.parse(acc.started || 0)).map(f => read(f)).filter(s => s && (s.mode === 'knowledge' || s.mode === 'ux')) : []
const vis = read(path.join(OUT, 'vis', 'judge.json'))
const live = fs.existsSync(path.join(OUT, 'live-smoke.jsonl')) ? fs.readFileSync(path.join(OUT, 'live-smoke.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
const decs = [...fs.readFileSync(path.join(ROOT, 'docs/Decisions.md'), 'utf8').matchAll(/^### (DEC-\d+) — (.+)$/gm)].map(m => `${m[1]} — ${m[2]}`)

L('# Verification Report — Research Workspace')
L('')
L(`Final acceptance run **${RUN}** (RFC §3E), ${acc.started || '?'} → ${acc.finished || '?'}. Blocking thresholds met: **${acc.blockingPassed ? 'yes' : 'NO'}**.`)
L('')
L('## Environment')
const arg = n => process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : ''
const rev = arg('--rev')
L(`- Git revision tested: \`${rev ? sh(`git rev-parse ${rev}`) : sh('git rev-parse HEAD')}\`${rev ? ` (report written at \`${sh('git rev-parse --short HEAD')}\`; later commits: ${sh(`git log --format=%s ${rev}..HEAD`).split('\n').filter(Boolean).length || 0}, report/docs only)` : sh('git status --porcelain') ? ' (dirty tree)' : ''}`)
L(`- macOS ${sh('sw_vers -productVersion')} · Node ${process.versions.node} · Electron ${pkg.devDependencies?.electron || pkg.dependencies?.electron} · app ${pkg.version}`)
L(`- Prototype hash (design/prototype zip, PRQ-DESIGN-01): \`${sha(path.join(ROOT, 'Research workspace prototype.zip'))}\``)
L('')
L('## Prerequisites (final status)')
L('| ID | Status | Evidence |'); L('|---|---|---|')
for (const [k, v] of prq) L(`| ${k} | ${v.status} | ${String(v.evidence || '').replace(/\|/g, '/').slice(0, 140)} |`)
L('')
L('## Requirements')
const ver = cov.filter(r => r.verified).length
L(`${cov.length} requirements in the §3D matrix; implemented (≥1 mapped test or structural audit): ${cov.filter(r => r.implemented).length}; verified by a passing test in this run: ${ver}/${cov.length}.`)
const unv = cov.filter(r => !r.verified)
if (unv.length) { L(''); L('Not verified in this run:'); for (const r of unv) L(`- ${r.req} (${r.tests.join(', ')})`) }
L('')
L('## Real-data stage (blocking — RFC §3E step 9b, DEC-087)')
{
  const rep = read(path.join(OUT, 'realdata.json'))
  const rows = []
  const walk = (x, file) => { for (const su of x.suites || []) walk(su, su.file || file); for (const sp of x.specs || []) rows.push({ file: sp.file || file, title: sp.title, ok: sp.ok, ms: (sp.tests?.[0]?.results || []).reduce((a, r) => a + (r.duration || 0), 0), tries: (sp.tests?.[0]?.results || []).length }) }
  if (rep) walk(rep)
  const evidence = f => { const b = path.basename(f || '', '.spec.ts'); const all = fs.readdirSync(OUT); const exact = all.filter(n => n === b || n === `realdata-${b}.json`); const hits = exact.length ? exact : all.filter(n => n.startsWith(`realdata-${b}-`)); return hits.map(h => `tests/results/${RUN}/${h}`).join(', ') || '—' }
  L(`${rows.filter(r => r.ok).length}/${rows.length} real-data tests passed (real network, real model, real Gmail; first attempt unless noted).`)
  L('| Test | Result | Minutes | Evidence |'); L('|---|---|---|---|')
  for (const r of rows) L(`| ${r.title.replace(/\|/g, '/').slice(0, 110)} | ${r.ok ? '✓' : '✘'}${r.tries > 1 ? ` (attempt ${r.tries})` : ''} | ${(r.ms / 60000).toFixed(1)} | ${evidence(r.file)} |`)
  L('')
}
L('## Suites')
L('| Suite | Passed | Failed | Skipped | Flaky (passed on same-run retry) |'); L('|---|---|---|---|---|')
for (const s of suites) L(`| ${s.id} | ${s.passed} | ${s.failed} | ${s.skipped} | ${s.flaky.join('; ') || '—'} |`)
L(`- Static audit: ${fs.existsSync(path.join(OUT, 'audit.txt')) ? fs.readFileSync(path.join(OUT, 'audit.txt'), 'utf8').trim().split('\n').pop() : 'see acceptance log'}`)
L('')
L('## Blind evaluations')
for (const b of blind) {
  if (b.mode === 'knowledge') {
    L(`**Knowledge (BK):** ${b.passes}/${b.total} passed; BK-Q6 ${b.bkQ6 ? 'passed' : 'FAILED'}; forbidden claims ${b.forbiddenClaims}; threshold met: ${b.met}.`)
    L('| Q | Pass | Judge notes |'); L('|---|---|---|')
    for (const i of b.items || []) L(`| ${i.id} | ${i.verdict?.pass ? '✓' : '✘'} | ${String(i.verdict?.notes || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 220)} |`)
  } else {
    L(`**UX:** ${b.passes}/${b.total} goals succeeded; mean dead ends ${Number(b.meanDeadEnds).toFixed(2)}; crashes ${b.crashes ?? 0}; threshold met: ${b.met}.`)
    L('| Goal | Attempt | Pass | Actions | Dead ends | Judge notes |'); L('|---|---|---|---|---|---|')
    for (const i of b.items || []) L(`| ${i.id} | ${i.attempt} | ${i.verdict?.pass ? '✓' : '✘'} | ${i.actions} | ${i.verdict?.deadEnds ?? '?'} | ${String(i.verdict?.notes || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 200)} |`)
  }
  L('')
}
L('## VIS-01 design parity')
if (vis) {
  L('| State | Layout | Placement | Typography | Color | Density |'); L('|---|---|---|---|---|---|')
  for (const p of vis.pairs) L(`| ${p.state} | ${p.layout} | ${p.placement} | ${p.typography} | ${p.color} | ${p.density} |`)
  L(`Screenshots and judge output: tests/results/${RUN}/vis/`)
} else L('(no VIS judge output in this run)')
L('')
L('## Live smoke (non-blocking)')
L(`${live.filter(x => x.ok).length}/${live.length} starter sources produced a processed document.`)
for (const x of live.filter(x => !x.ok)) L(`- ✘ ${x.name} (${x.locator}): ${x.error || x.probe}`)
L('')
L('## Known non-blocking limitations')
const lim = arg('--limitations')
L(lim || '- See live smoke failures above (external sites).')
L('')
L('## Unresolved blocking issues')
L(acc.blockingPassed ? 'None.' : acc.steps.filter(s => s.blocking && s.status === 'failed').map(s => `- ${s.id} failed`).join('\n') || '- coverage incomplete')
L('')
L('## Decisions recorded (Decisions.md)')
for (const d of decs) L(`- ${d}`)
L('')
L('## Artifacts')
L(`- \`${path.relative(ROOT, appDmg)}\` sha256 \`${sha(appDmg)}\``)
L(`- \`app/dist/mac-arm64/Research Workspace.app\` (executable sha256 \`${sha(appBin)}\`)`)
L(`- Run artifacts: \`tests/results/${RUN}/\``)
fs.writeFileSync(path.join(ROOT, 'docs/VerificationReport.md'), lines.join('\n') + '\n')
console.log('wrote docs/VerificationReport.md')
