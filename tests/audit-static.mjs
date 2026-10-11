// Static code audit (RFC §3D "Code audit gate"): scans app/src/** only; prereq/ and tests/ are exempt.
// Exits non-zero and lists every violation.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SRC = path.join(ROOT, 'app/src')
const ALLOWED_RW = new Set(['RW_DATA_DIR', 'RW_TEST_MODE', 'RW_TEST_NOW', 'RW_NO_JITTER', 'RW_LLM_CACHE', 'RW_FAULTS', 'RW_CODEX_HOME', 'RW_FIXTURE_BASE',
  'RW_STARTER_PACK_OVERRIDE', 'RW_BRIDGE_PROFILE_DIR', 'RW_BRIDGE_MOCK_KEYCHAIN', 'RW_REAL_SEARCH', 'RW_FIXTURE_PORT', 'RW_HEADLESS', 'RW_LLM_CACHE_DIR'])

const files = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(ts|tsx|js|mjs|cjs|html|sql|json)$/.test(e.name)) files.push(p)
  }
})(SRC)

const problems = []
const rel = p => path.relative(path.join(ROOT, 'app'), p)
const flag = (f, msg, line) => problems.push(`${rel(f)}${line ? ':' + line : ''}: ${msg}`)
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length
function each(text, re, fn) { for (const m of text.matchAll(re)) fn(m, lineOf(text, m.index)) }

for (const f of files) {
  const t = fs.readFileSync(f, 'utf8')
  const r = rel(f)
  // 1. no .env / dotenv / RW_EMAIL_ / unlisted RW_ env reads (DEC-076)
  each(t, /\bdotenv\b|\.env\.local|['"`]\.env['"`]|RW_EMAIL_/g, (m, l) => flag(f, `forbidden reference "${m[0]}"`, l))
  each(t, /process\.env\.(RW_[A-Z_]+)/g, (m, l) => { if (!ALLOWED_RW.has(m[1])) flag(f, `unlisted env switch ${m[1]}`, l) })
  // 2. Codex endpoint/auth only in provider.ts / codex-auth.ts
  if (!['src/main/ai/provider.ts', 'src/main/ai/codex-auth.ts'].includes(r))
    each(t, /chatgpt\.com\/backend-api|\.codex\b|auth\.json/g, (m, l) => flag(f, `"${m[0]}" outside provider.ts/codex-auth.ts`, l))
  // 3. Chrome cookie store only in bridge.ts
  if (r !== 'src/main/sources/bridge.ts')
    each(t, /Chrome Safe Storage|Google\/Chrome\/[^'"`]*Cookies/g, (m, l) => flag(f, `"${m[0]}" outside sources/bridge.ts`, l))
  // 4. no better-sqlite3 in renderer/preload
  if (/^src\/(renderer|preload)\//.test(r)) each(t, /better-sqlite3/g, (m, l) => flag(f, 'better-sqlite3 imported in renderer/preload', l))
  // 5. AI modules: no child_process / fs writes / eval / new Function; SQL never built from model output
  if (r.startsWith('src/main/ai/') && r !== 'src/main/ai/codex-auth.ts') {
    each(t, /child_process|\bfs\.write|writeFileSync|\beval\s*\(|new Function\b/g, (m, l) => flag(f, `"${m[0]}" in AI module`, l))
    each(t, /\.prepare\(\s*`[^`]*\$\{/g, (m, l) => flag(f, 'SQL template built inside AI module', l))
  }
  if (r === 'src/main/ai/codex-auth.ts') each(t, /child_process|\beval\s*\(|new Function\b/g, (m, l) => flag(f, `"${m[0]}" in codex-auth.ts`, l))
  // 6b. headless test runs (DEC-097): every window is created hidden in test mode — none may appear on the user's screen
  each(t, /new (?:BaseWindow|BrowserWindow)\(/g, (m, l) => {
    let depth = 0, i = m.index + m[0].length - 1
    do { if (t[i] === '(') depth++; else if (t[i] === ')') depth--; i++ } while (depth > 0 && i < t.length)
    if (!/\bshow:\s*(false|!HEADLESS)/.test(t.slice(m.index, i))) flag(f, 'window created without show: false / !HEADLESS', l)
  })
  if (r !== 'src/main/window.ts') each(t, /shell\.openExternal\(/g, (m, l) => flag(f, 'shell.openExternal outside window.ts (use openExternal, which is silent in headless runs)', l))
  // 6. renderer isolation
  each(t, /nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false/g, (m, l) => flag(f, `"${m[0]}"`, l))
  // 7. no paywall-circumvention services
  each(t, /webcache|archive\.org|archive\.ph|12ft|removePaywall/gi, (m, l) => flag(f, `paywall-circumvention string "${m[0]}"`, l))
}

// SQL from model output: db helpers only accept parameters, so template SQL anywhere may interpolate only identifiers
// chosen from code. Flag interpolations of variables whose names suggest model output.
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8')
  each(t, /\b(?:one|all|run|prepare)\s*(?:<[^>]*>)?\(\s*`([^`]*)`/g, (m, l) => {
    for (const v of m[1].matchAll(/\$\{([^}]+)\}/g)) if (/\b(out|output|value|model|answer|result|ai)\b\./.test(v[1])) flag(f, `SQL interpolates model output \${${v[1]}}`, l)
  })
}

// Test suite rules (TestPlan.md): every spec file has area tags; nothing a test starts shows on the screen.
{
  const { SPECS, allSpecFiles } = await import('./areas.mjs')
  for (const f of allSpecFiles()) if (!SPECS[f]) problems.push(`tests/${f}: no area tags in tests/areas.mjs`)
  for (const f of Object.keys(SPECS)) if (!fs.existsSync(path.join(ROOT, 'tests', f))) problems.push(`tests/areas.mjs lists missing ${f}`)
  const testFiles = []
  ;(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/^(results|runs|ai-cache|node_modules|scratch)$/.test(e.name)) walk(p) }
      else if (/\.(ts|mjs)$/.test(e.name)) testFiles.push(p)
    }
  })(path.join(ROOT, 'tests'))
  const LAUNCHERS = new Set(['tests/harness/app.ts', 'tests/harness/ui-driver/daemon.mjs'])
  for (const f of testFiles) {
    const r = path.relative(ROOT, f), t = fs.readFileSync(f, 'utf8')
    if (r === 'tests/audit-static.mjs') continue
    // the app is launched only by the harness and the ui-driver daemon, which set RW_HEADLESS unless RW_HEADED=1
    if (!LAUNCHERS.has(r)) each(t, /_electron\b|electron\.launch\(/g, (m, l) => problems.push(`${r}:${l}: launches the app outside the harness`))
    else if (!/RW_HEADED === '1' \? \{\} : \{ RW_HEADLESS: '1' \}/.test(t)) problems.push(`${r}: app launch without RW_HEADLESS`)
    // other browsers: headless only
    each(t, /(?:chromium|firefox|webkit)\.launch(?:PersistentContext)?\(([^)]*)\)/g, (m, l) => { if (!/headless:\s*true/.test(m[1])) problems.push(`${r}:${l}: browser launched without headless: true`) })
  }
  console.log(`audit:static checked ${testFiles.length} test files (area tags, headless launches)`)
}

console.log(`audit:static scanned ${files.length} files under app/src`)
if (problems.length) { console.error(problems.map(p => '  ✘ ' + p).join('\n')); console.error(`${problems.length} violation(s)`); process.exit(1) }
console.log('  ✓ no violations')
