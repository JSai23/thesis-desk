// Requirement coverage (RFC §3D): every P-/B- requirement maps to ≥1 automated test that exists in the suites, and
// (given Playwright JSON reports and blind summaries of a run) to tests that passed in that run.
// usage: node tests/coverage.mjs [<results run dir> ...] [--blind <summary.json> ...]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rfc = fs.readFileSync(path.join(ROOT, 'docs/RFC.md'), 'utf8')
const matrix = rfc.slice(rfc.indexOf('## 3D.'), rfc.indexOf('## 3E.'))
const rows = matrix.split('\n').filter(l => /^\| [PB]-[A-Z]+-\d{3} /.test(l)).map(l => l.split('|').map(c => c.trim()).slice(1, -1))
const ids = cell => (cell.match(/(E2E|UI|UX|BK|SMK|VIS|RD)-[A-Z0-9]+(?:-\d+)?(?:(?:\/|\.\.)\d+)*/g) || []).flatMap(expandSlash)
// "E2E-REP-02/03" → E2E-REP-02, E2E-REP-03; "SMK-11" stays; "UI-TH-01" stays
function expandSlash(id) {
  // "RD-HYD-01..04" → RD-HYD-01 … RD-HYD-04
  const r = id.match(/^(.*-)(\d+)\.\.(\d+)$/)
  if (r) return Array.from({ length: Number(r[3]) - Number(r[2]) + 1 }, (_, i) => r[1] + String(Number(r[2]) + i).padStart(r[2].length, '0'))
  const m = id.match(/^(.*-)(\d+)((?:\/\d+)+)$/)
  if (!m) return [id]
  return [m[1] + m[2], ...m[3].split('/').filter(Boolean).map(n => m[1] + n.padStart(m[2].length, '0'))]
}

// test titles present in the suites
const titles = []
for (const dir of ['tests/smoke', 'tests/e2e-backend', 'tests/e2e-product', 'tests/realdata']) for (const f of fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.ts')))
  for (const m of fs.readFileSync(path.join(ROOT, dir, f), 'utf8').matchAll(/test(?:\.describe(?:\.serial)?)?\(\s*['`]([^'`]+)['`]/g)) titles.push(m[1])
const specs = fs.readFileSync(path.join(ROOT, 'tests/blind/specs.mjs'), 'utf8')
const expandTitle = t => (t.match(/(E2E|UI|SMK|VIS|RD)-[A-Z0-9]+(?:-\d+)?(?:(?:\/|\.\.)\d+)*/g) || []).flatMap(expandSlash)
const present = new Set(titles.flatMap(expandTitle))
for (const m of specs.matchAll(/\b(BK-Q\d|UX-\d\d)\b/g)) present.add(m[1])
for (const id of [...present]) if (/^BK-Q/.test(id)) present.add('BK-' + id.slice(3))

// passed tests from Playwright JSON reports in the given run dirs
const args = process.argv.slice(2)
const runDirs = args.filter(a => !a.startsWith('--') && !a.endsWith('.json'))
const blind = args.filter(a => a.endsWith('summary.json'))
const passed = new Set()
function walk(suite) {
  for (const s of suite.suites || []) walk(s)
  for (const sp of suite.specs || []) if (sp.ok) for (const id of expandTitle(sp.title)) passed.add(id)
}
for (const d of runDirs) for (const f of fs.readdirSync(d).filter(f => f.endsWith('.json'))) { try { walk(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))) } catch { /* not a report */ } }
for (const b of blind) { const s = JSON.parse(fs.readFileSync(b, 'utf8')); for (const it of s.items || []) if (it.pass || it.verdict?.pass) passed.add(it.id) }

const out = rows.map(([req, phase, be, pe, bl]) => {
  const all = [...ids(be), ...ids(pe), ...ids(bl), ...ids(phase)]
  const tests = [...ids(be), ...ids(pe), ...ids(bl)]
  const missing = tests.filter(t => !present.has(t) && !/^BK-|^UX-/.test(t))
  const structural = /(static|code) audit/i.test(be + pe) // verified by npm run audit:static
  const verified = runDirs.length ? tests.filter(t => passed.has(t)) : []
  return { req, tests, missing, structural, implemented: tests.length > 0 || structural, verified: runDirs.length ? verified.length > 0 || structural : null, all }
})
const noTest = out.filter(r => !r.implemented)
const missing = out.filter(r => r.missing.length)
console.log(`requirements: ${out.length}; with ≥1 mapped test: ${out.length - noTest.length}; referenced tests missing from suites: ${missing.length}`)
for (const r of missing) console.log(`  ✘ ${r.req}: missing ${r.missing.join(', ')}`)
for (const r of noTest) console.log(`  ✘ ${r.req}: no test mapped`)
if (runDirs.length) {
  const unverified = out.filter(r => !r.verified)
  console.log(`verified in run: ${out.length - unverified.length}/${out.length}`)
  for (const r of unverified) console.log(`  ✘ ${r.req}: none of ${r.tests.join(', ')} passed`)
  fs.writeFileSync(path.join(runDirs[0], 'coverage.json'), JSON.stringify(out, null, 2))
  process.exit(unverified.length || missing.length ? 1 : 0)
}
process.exit(missing.length || noTest.length ? 1 : 0)
