// Area tags and the changed-files → tests map (TestPlan.md). Every spec file carries its areas here; the static audit
// fails a spec file that isn't listed. `test:quick` / `test:area` (tests/dev.mjs) pick tests from the files changed.
//   node tests/areas.mjs [--since <rev>]   prints the changed files, their areas and the spec files they select
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ALL = '*'

/** Spec file → areas. Fixture suites: smoke, e2e-backend, e2e-product. Real data: realdata. Live: accept only. */
export const SPECS = {
  'smoke/ph01.spec.ts': ['shell'],
  'smoke/ph02.spec.ts': ['ingest'],
  'smoke/ph03.spec.ts': ['ingest', 'ai', 'extraction'],
  'smoke/ph04.spec.ts': ['feed'],
  'smoke/ph05.spec.ts': ['sources'],
  'smoke/ph06.spec.ts': ['sources', 'mail'],
  'smoke/ph07.spec.ts': ['sources', 'auth'],
  'smoke/ph07b.spec.ts': ['sources', 'auth'],
  'smoke/ph08.spec.ts': ['theses', 'objects', 'ontology'],
  'smoke/ph09.spec.ts': ['views'],
  'smoke/ph10.spec.ts': ['query'],
  'smoke/ph11.spec.ts': ['reports'],
  'smoke/ph12.spec.ts': ['alerts'],
  'smoke/ph13.spec.ts': ['install'],
  'e2e-backend/ai.spec.ts': ['ai', 'extraction', 'ontology', 'ingest'],
  'e2e-backend/auth.spec.ts': ['auth', 'sources'],
  'e2e-backend/ingest.spec.ts': ['ingest'],
  'e2e-backend/reports-alerts.spec.ts': ['reports', 'alerts', 'mail'],
  'e2e-backend/sources.spec.ts': ['sources'],
  'e2e-backend/views-query.spec.ts': ['views', 'query', 'feed'],
  'e2e-backend/zz-security.spec.ts': ['security'],
  'e2e-product/describe-ui.spec.ts': ['objects', 'hydrate', 'theses', 'ui'],
  'e2e-product/limit-ui.spec.ts': ['settings', 'ingest', 'ui'],
  'e2e-product/feed-ui.spec.ts': ['feed', 'ingest', 'ui'],
  'e2e-product/objects-ui.spec.ts': ['objects', 'ontology', 'views', 'query', 'theses', 'hydrate', 'ui'],
  'e2e-product/reports-ui.spec.ts': ['reports', 'alerts', 'views', 'ui'],
  'e2e-product/shell-settings.spec.ts': ['shell', 'settings', 'ui'],
  'e2e-product/sources-ui.spec.ts': ['sources', 'auth', 'ui'],
  'e2e-product/tiers-ui.spec.ts': ['tiers', 'feed', 'objects', 'ui'],
  'e2e-product/vis.spec.ts': ['vis', 'ui'],
  'realdata/briefings-ui.spec.ts': ['briefs', 'reports', 'mail', 'ui'],
  'realdata/briefings.spec.ts': ['briefs', 'reports', 'mail'],
  'realdata/briefs.spec.ts': ['reports', 'alerts', 'briefs', 'mail'],
  'realdata/extraction.spec.ts': ['extraction', 'ai'],
  'realdata/hydrate-firms.spec.ts': ['hydrate', 'ontology'],
  'realdata/hydrate.spec.ts': ['hydrate', 'objects'],
  'realdata/ontology.spec.ts': ['ontology', 'theses'],
  'realdata/sources.spec.ts': ['sources', 'ingest'],
  'realdata/story-reports.spec.ts': ['reports', 'mail'],
  'realdata/tiers.spec.ts': ['tiers', 'hydrate', 'feed', 'ontology'],
  'realdata/describe.spec.ts': ['hydrate', 'objects', 'theses', 'ingest', 'ontology'],
  'realdata/lookup.spec.ts': ['hydrate', 'objects', 'theses'],
  'realdata/ui-fixes.spec.ts': ['objects', 'query', 'ontology', 'feed', 'ui'],
  // run on request only (`npm run realdata:quality`), not part of a gate
  'realdata/quality.spec.ts': ['quality'],
  'live/live-e2e.spec.ts': ['live'],
  'live/live.spec.ts': ['live'],
  'live/strictlyvc.spec.ts': ['live'],
  'blind/setup.spec.ts': ['blind']
}

/** Changed path (repo-relative) → areas; first match wins; anything unmatched selects everything (safe default). */
const SOURCES = [
  [/\.md$|^docs\/|^prereq\/|^\.claude\/|^\.gitignore$/, []],
  [/^tests\/(smoke|e2e-backend|e2e-product|realdata|live|blind)\/.*\.spec\.ts$/, 'self'],
  [/^tests\/realdata\/(.*)\.ts$/, 'importers'],
  [/^tests\/(areas|dev|coverage|report)\.mjs$|^tests\/audit-static\.mjs$/, []],
  [/^tests\/(harness|playwright\.config)|^fixtures\/|^package(-lock)?\.json$|^electron[.-]|^tsconfig/, ALL],
  [/^app\/src\/main\/ai\/tasks\/document\.ts$|^app\/src\/main\/ai\/tasks\/locate\.ts$/, ['ingest', 'ai', 'extraction', 'hydrate']],
  [/^app\/src\/main\/ai\/tasks\/reports\.ts$/, ['reports', 'briefs']],
  [/^app\/src\/main\/ai\/tasks\/alerts\.ts$/, ['alerts']],
  [/^app\/src\/main\/ai\/tasks\/(query|think)\.ts$/, ['query']],
  [/^app\/src\/main\/ai\/tasks\/views\.ts$/, ['views']],
  [/^app\/src\/main\/ai\/tasks\/source\.ts$/, ['sources']],
  [/^app\/src\/main\/ai\//, ['ai', 'ingest', 'extraction', 'query', 'reports']],
  [/^app\/src\/main\/alerts\//, ['alerts']],
  [/^app\/src\/main\/mail\//, ['mail', 'briefs', 'reports']],
  [/^app\/src\/main\/reports\//, ['reports', 'briefs']],
  [/^app\/src\/main\/objects\//, ['objects', 'hydrate', 'tiers']],
  [/^app\/src\/main\/ingest\//, ['ingest', 'ai', 'extraction', 'hydrate']],
  [/^app\/src\/main\/sources\//, ['sources', 'auth', 'ingest']],
  [/^app\/src\/main\/entities\//, ['ontology', 'ai', 'objects']],
  [/^app\/src\/main\/feed\//, ['feed', 'tiers']],
  [/^app\/src\/main\/query\//, ['query']],
  [/^app\/src\/main\/views\//, ['views']],
  [/^app\/src\/main\/(theses|notes)\//, ['theses', 'ontology']],
  [/^app\/src\/main\/scheduler\//, ['reports', 'sources', 'alerts']],
  [/^app\/src\/main\/(settings|banners)\.ts$/, ['settings', 'shell']],
  [/^app\/src\/main\/llm-cache\.ts$/, ['ai']],
  [/^app\/src\/renderer\//, ['ui']],
  [/^app\/src\/main\/(db|jobs|ipc)\/|^app\/src\/shared\/|^app\/src\/main\/(env|index|register|window|clock|log|errors|events)\.ts$/, ALL]
]

export const FIXTURE_DIRS = ['smoke', 'e2e-backend', 'e2e-product']
export const suiteOf = f => f.split('/')[0]

/** Spec files the static audit requires to be listed (every *.spec.ts under the suite dirs). */
export function allSpecFiles() {
  return [...FIXTURE_DIRS, 'realdata', 'live', 'blind'].flatMap(d => fs.existsSync(path.join(ROOT, 'tests', d))
    ? fs.readdirSync(path.join(ROOT, 'tests', d)).filter(f => f.endsWith('.spec.ts')).map(f => `${d}/${f}`) : [])
}

export function changedFiles(since) {
  const sh = c => execSync(c, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(l => l.trim())
  const committed = since ? sh(`git diff --name-only ${since} HEAD`).map(l => l.trim()) : []
  // porcelain lines are "XY path" (or "XY old -> new"): the path starts at column 3
  const working = sh('git status --porcelain --untracked-files=all').map(l => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''))
  return [...new Set([...committed, ...working])].filter(f => !f.startsWith('tests/results/') && !f.startsWith('tests/ai-cache'))
}

/** { areas: Set|'*', specs: Set of spec files named directly (changed tests and their helpers' importers) } */
export function areasFor(files) {
  const areas = new Set(); const specs = new Set(); let all = false; const why = []
  for (const f of files) {
    const rule = SOURCES.find(([re]) => re.test(f))
    const v = rule ? rule[1] : ALL
    if (v === ALL) { all = true; why.push([f, 'everything']); continue }
    if (v === 'self') { specs.add(f.replace(/^tests\//, '')); why.push([f, 'itself']); continue }
    if (v === 'importers') {
      const base = path.basename(f, '.ts')
      const imp = allSpecFiles().filter(s => s.startsWith('realdata/') && new RegExp(`from ['"]\\./${base}['"]`).test(fs.readFileSync(path.join(ROOT, 'tests', s), 'utf8')))
      imp.forEach(s => specs.add(s)); why.push([f, imp.join(', ') || 'none']); continue
    }
    v.forEach(a => areas.add(a)); why.push([f, v.join(', ') || 'none'])
  }
  return { areas: all ? ALL : areas, specs, why }
}

const GATE_EXCLUDE = new Set(['install', 'quality', 'live', 'blind'])
/** Spec files to run. quick: tagged with a changed area (fixture + real data); area: every fixture spec + real-data
 *  specs with a changed area. Never live/blind/quality/installer (accept only). Named specs always run. */
export function select(mode, files) {
  const { areas, specs, why } = areasFor(files)
  const hit = f => areas === ALL || SPECS[f].some(a => areas.has(a))
  const gate = f => !SPECS[f].some(a => GATE_EXCLUDE.has(a))
  const out = Object.keys(SPECS).filter(f => gate(f) && (specs.has(f) || (mode === 'area' && FIXTURE_DIRS.includes(suiteOf(f))) || hit(f)))
  for (const s of specs) if (!out.includes(s) && SPECS[s] && !SPECS[s].includes('blind')) out.push(s)
  return { specs: out, areas: areas === ALL ? ['everything'] : [...areas], why }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf('--since')
  const files = changedFiles(i > 0 ? process.argv[i + 1] : null)
  const mode = process.argv.includes('--area') ? 'area' : 'quick'
  const r = select(mode, files)
  for (const [f, w] of r.why) console.log(`${f} → ${w}`)
  console.log(`areas: ${r.areas.join(', ') || 'none'}\nspecs (${mode}): ${r.specs.join(' ') || 'none'}`)
}
