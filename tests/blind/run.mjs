// Blind evaluations (RFC §3C, DEC-048, DEC-065).
//   node tests/blind/run.mjs knowledge|ux [--only ID[,ID]] [--attempt N] [--reuse <runDir>] [--dry-run]
//
// 1. Setup: tests/blind/setup.spec.ts (Playwright + tests/harness) builds the pre-state profiles into <run>/setup/
//    (BK-SETUP; for ux also the UX-08/UX-09 variants). --reuse <runDir> reuses another run's setup/ instead.
// 2. Each question/goal: a copy of the right profile, the app opened through the ui-driver daemon, and a fresh
//    `claude -p --model opus` in an empty temp dir whose only tool is `Bash(ui:*)`. Fallback: `codex exec` when claude
//    fails to start. UX sessions are killed once the ui action counter passes 60.
// 3. A fresh judge (`claude -p --model opus`, no tools) grades rubric + state dump + transcript → strict JSON.
// 4. summary.json / summary.md in <run>/; exit 0 only when the §3C thresholds are met.
// --attempt N = maximum independent attempts per item (ux default 2, knowledge default 1); a later attempt runs only
// when the earlier one failed. --dry-run proves the plumbing on a clean profile with one tiny agent + judge call.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BK, UX, UX_PREAMBLE, UX_PRESTATE, agentGoal } from './specs.mjs'

const BLIND = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(BLIND, '../..')
const UI_BIN = path.join(ROOT, 'tests/harness/ui-driver/bin')
const UI_CLIENT = path.join(ROOT, 'tests/harness/ui-driver/client.mjs')
const DUMP = path.join(BLIND, 'dump-state.ts')
const UX_MAX_ACTIONS = 60
const MODEL = 'opus'
const CODEX = ['exec', '-m', 'gpt-6-luna', '-s', 'read-only', '--skip-git-repo-check', '--json']

// ---------- args ----------
const argv = process.argv.slice(2)
const mode = argv[0]
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const DRY = argv.includes('--dry-run')
if (!['knowledge', 'ux'].includes(mode) && !DRY) { console.error('usage: node tests/blind/run.mjs knowledge|ux [--only ID] [--attempt N] [--reuse <runDir>] [--dry-run]'); process.exit(2) }
const ONLY = (flag('--only') || '').split(',').map(s => s.trim()).filter(Boolean)
const ATTEMPTS = Number(flag('--attempt') || (mode === 'ux' ? 2 : 1))
const REUSE = flag('--reuse')
const KNOWN = new Set([...BK, ...UX].map(x => x.id))
const unknown = ONLY.filter(id => !KNOWN.has(id))
if (unknown.length) { console.error(`unknown --only id(s): ${unknown.join(', ')}`); process.exit(2) }

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const RUN = path.join(BLIND, 'runs', `${stamp}${DRY ? '-dry' : '-' + mode}`)
fs.mkdirSync(RUN, { recursive: true })
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(path.join(RUN, 'run.log'), s + '\n') }
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2))
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + `… [${s.length - n} chars truncated]` : s || '')

// Nested Claude Code sessions: drop the parent's session markers so `claude -p` starts as a fresh top-level process.
const BASE_ENV = { ...process.env }
for (const k of Object.keys(BASE_ENV)) if (/^CLAUDECODE$|^CLAUDE_CODE_(ENTRYPOINT|SSE_PORT|SESSION)/.test(k)) delete BASE_ENV[k]

// ---------- helpers ----------
function run(cmd, args, o = {}) {
  return new Promise(resolve => {
    const out = o.out ? fs.openSync(o.out, 'w') : 'ignore'
    const err = o.err ? fs.openSync(o.err, 'w') : 'ignore'
    let child
    try { child = spawn(cmd, args, { cwd: o.cwd || ROOT, env: o.env || BASE_ENV, stdio: ['pipe', out, err], detached: true }) } catch (e) { return resolve({ code: -1, startError: String(e) }) }
    let startError = null, killedFor = null
    child.on('error', e => { startError = String(e) })
    if (o.input !== undefined) child.stdin.end(o.input); else child.stdin.end()
    const kill = why => { if (killedFor) return; killedFor = why; try { process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ } setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } }, 5000) }
    const timer = setTimeout(() => kill('timeout'), o.timeoutMs || 30 * 60_000)
    const watch = o.watch ? setInterval(() => { const why = o.watch(); if (why) kill(why) }, 1000) : null
    child.on('close', code => { clearTimeout(timer); if (watch) clearInterval(watch); resolve({ code, startError, killedFor }) })
  })
}

/** Let background work the agent started finish (first syncs, AI jobs) before the state is judged — a user would wait. */
function settle(stateDir, dataDir) {
  const tokenFile = path.join(stateDir, 'runner.token')
  if (!fs.existsSync(tokenFile)) return
  spawnSync(process.execPath, [UI_CLIENT, 'invoke', 'test.jobs.drain', JSON.stringify({ timeoutMs: 300_000 })], {
    env: { ...BASE_ENV, RW_UI_STATE_DIR: stateDir, RW_UI_DATA_DIR: dataDir, RW_UI_UNCOUNTED: '1', RW_UI_RUNNER_TOKEN: fs.readFileSync(tokenFile, 'utf8').trim() }, encoding: 'utf8', timeout: 330_000 })
}

function ui(stateDir, dataDir, ...args) {
  const r = spawnSync(process.execPath, [UI_CLIENT, ...args], { env: { ...BASE_ENV, RW_UI_STATE_DIR: stateDir, RW_UI_DATA_DIR: dataDir, RW_UI_UNCOUNTED: '1' }, encoding: 'utf8', timeout: 180_000 })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

function dumpState(dataDir, out, withText = false) {
  const r = spawnSync(process.execPath, ['--no-warnings', DUMP, dataDir, '--out', out, ...(withText ? ['--with-text'] : [])], { encoding: 'utf8', cwd: ROOT })
  if (r.status !== 0) throw new Error('dump-state failed: ' + r.stderr)
  return JSON.parse(fs.readFileSync(out, 'utf8'))
}

function copyProfile(from, to) {
  fs.rmSync(to, { recursive: true, force: true })
  if (!from) { fs.mkdirSync(to, { recursive: true }); return }
  fs.cpSync(from, to, { recursive: true, filter: src => !/Singleton(Lock|Cookie|Socket)$/.test(src) })
}

function fixtureEpoch(n) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ n })
    const req = http.request({ host: '127.0.0.1', port: 4700, method: 'POST', path: '/__control/epoch', headers: { Host: 'control.test:4700', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { res.resume(); res.on('end', resolve) })
    req.on('error', reject)
    req.end(body)
  })
}

/** Condense a stream-json (or codex --json) transcript into readable text for the judge. */
function condense(file) {
  const lines = readJsonl(file)
  const out = []
  let final = '', cost = null, turns = null
  for (const o of lines) {
    if (o.type === 'assistant' && o.message?.content) {
      for (const c of o.message.content) {
        if (c.type === 'text' && c.text.trim()) out.push(`AGENT: ${c.text.trim()}`)
        else if (c.type === 'tool_use') out.push(`$ ${c.input?.command ?? JSON.stringify(c.input)}`)
      }
    } else if (o.type === 'user' && Array.isArray(o.message?.content)) {
      for (const c of o.message.content) if (c.type === 'tool_result') {
        const t = typeof c.content === 'string' ? c.content : (c.content || []).map(x => x.text || '').join('\n')
        out.push(`→ ${trunc(t, 2500)}`)
      }
    } else if (o.type === 'result') { final = o.result || ''; cost = o.total_cost_usd ?? null; turns = o.num_turns ?? null }
    else if (o.type === 'item.completed' || o.msg) out.push(trunc(JSON.stringify(o), 1500)) // codex --json events
  }
  if (!final) { const last = [...out].reverse().find(l => l.startsWith('AGENT: ')); final = last ? last.slice(7) : '' }
  return { text: out.join('\n'), final, cost, turns, started: lines.some(o => o.type === 'system' || o.type === 'assistant' || o.type === 'thread.started') }
}

const UI_USAGE = fs.readFileSync(UI_CLIENT, 'utf8').match(/const USAGE = `([\s\S]*?)`/)[1]
const DRIVER_NOTES = `You operate the app only through the \`ui\` command in Bash, one command per call. The app is already open.
Start with \`ui snapshot\` to see the screen; take a new snapshot after actions that change it.

${UI_USAGE}`

// ---------- agent + judge ----------
async function runAgent({ dir, prompt, dataDir, maxActions, timeoutMs, extraFiles = {} }) {
  const stateDir = path.join(dir, 'ui-state')
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-blind-agent-'))
  for (const [f, c] of Object.entries(extraFiles)) fs.writeFileSync(path.join(cwd, f), c)
  fs.writeFileSync(path.join(dir, 'prompt.txt'), prompt)
  const st = ui(stateDir, dataDir, 'start')
  if (st.code !== 0) throw new Error('ui start failed: ' + st.out)
  const env = { ...BASE_ENV, PATH: `${UI_BIN}:${BASE_ENV.PATH}`, RW_UI_STATE_DIR: stateDir, RW_UI_DATA_DIR: dataDir, RW_UI_NODE: process.execPath, ...(maxActions ? { RW_UI_MAX_ACTIONS: String(maxActions) } : {}) }
  const count = () => Number(fs.existsSync(path.join(stateDir, 'actions.count')) ? fs.readFileSync(path.join(stateDir, 'actions.count'), 'utf8') : 0)
  const watch = maxActions ? () => (count() > maxActions ? 'action limit' : null) : undefined
  const transcript = path.join(dir, 'transcript.jsonl')
  const args = ['-p', '--model', MODEL, '--output-format', 'stream-json', '--verbose', '--tools', 'Bash', '--allowedTools', 'Bash(ui:*)',
    '--permission-mode', 'dontAsk', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']
  let agent = 'claude'
  let r = await run('claude', args, { cwd, env, input: prompt, out: transcript, err: path.join(dir, 'agent.stderr.log'), timeoutMs, watch })
  let c = condense(transcript)
  if (r.startError || (!c.started && r.code !== 0 && !r.killedFor)) {
    log(`  claude -p failed to start (${r.startError || 'exit ' + r.code}); falling back to codex exec`)
    agent = 'codex'
    r = await run('codex', [...CODEX, '-C', cwd, prompt], { cwd, env, out: transcript, err: path.join(dir, 'agent.stderr.log'), timeoutMs, watch })
    c = condense(transcript)
  }
  settle(stateDir, dataDir)
  ui(stateDir, dataDir, 'stop')
  fs.rmSync(cwd, { recursive: true, force: true })
  const actions = readJsonl(path.join(stateDir, 'actions.jsonl'))
  const crashes = readJsonl(path.join(stateDir, 'crashes.jsonl'))
  const pageErrors = readJsonl(path.join(stateDir, 'page-errors.jsonl'))
  fs.writeFileSync(path.join(dir, 'transcript.txt'), c.text + `\n\nFINAL: ${c.final}\n`)
  return { agent, exitCode: r.code, killedFor: r.killedFor, final: c.final, transcript: c.text, cost: c.cost, turns: c.turns,
    actions: actions.length, uiErrors: actions.filter(a => !a.ok).length, crashes: crashes.length, pageErrors }
}

const JUDGE_OUTPUT = `Output ONLY one JSON object, no prose, no code fence:
{"pass": boolean, "forbiddenClaims": [string], "deadEnds": number, "errors": number, "notes": string}
- forbiddenClaims: every statement in the answer/outcome that the rubric forbids or that the evidence does not support (empty if none).
- deadEnds: agent actions that led to an error or an unrelated screen and were then backtracked.
- errors: unexpected errors seen in the transcript (error toasts, crashes, "error:" results caused by the app rather than by a typo in a ui command).
- notes: two to five sentences explaining the verdict, citing table rows or transcript lines.`

function parseVerdict(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s < 0 || e < s) throw new Error('no JSON object in judge output')
  const v = JSON.parse(text.slice(s, e + 1))
  if (typeof v.pass !== 'boolean' || !Array.isArray(v.forbiddenClaims) || typeof v.deadEnds !== 'number' || typeof v.errors !== 'number' || typeof v.notes !== 'string')
    throw new Error('judge JSON does not match the schema')
  return v
}

async function judge(dir, input) {
  fs.writeFileSync(path.join(dir, 'judge-input.txt'), input)
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-blind-judge-'))
  const args = ['-p', '--model', MODEL, '--output-format', 'json', '--tools', '', '--permission-mode', 'dontAsk', '--setting-sources', 'project',
    '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']
  let lastErr = null
  try {
    for (let i = 1; i <= 2; i++) {
      const out = path.join(dir, `judge-output-${i}.json`)
      const r = await run('claude', args, { cwd, input, out, err: path.join(dir, `judge-${i}.stderr.log`), timeoutMs: 15 * 60_000 })
      let text = ''
      if (r.startError || r.code !== 0) {
        log(`  judge claude -p failed (${r.startError || 'exit ' + r.code}); falling back to codex exec`)
        const last = path.join(dir, `judge-codex-last-${i}.txt`)
        await run('codex', ['exec', '-m', 'gpt-6-luna', '-s', 'read-only', '--skip-git-repo-check', '-C', cwd, '-o', last, '-'], { cwd, input, out, err: path.join(dir, `judge-codex-${i}.stderr.log`), timeoutMs: 15 * 60_000 })
        text = fs.existsSync(last) ? fs.readFileSync(last, 'utf8') : ''
      } else {
        try { text = JSON.parse(fs.readFileSync(out, 'utf8')).result || '' } catch { text = fs.readFileSync(out, 'utf8') }
      }
      try { const v = parseVerdict(text); writeJson(path.join(dir, 'verdict.json'), v); return v } catch (e) { lastErr = e; log(`  judge output unusable (${e.message}); ${i === 1 ? 'retrying' : 'giving up'}`) }
    }
  } finally { fs.rmSync(cwd, { recursive: true, force: true }) }
  const v = { pass: false, forbiddenClaims: [], deadEnds: 0, errors: 0, notes: `judge failed: ${lastErr?.message}`, judgeFailed: true }
  writeJson(path.join(dir, 'verdict.json'), v)
  return v
}

// ---------- state shaping for judges ----------
const pickRows = (rows, cols) => (rows || []).map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]])))
function capJson(obj, max) {
  let s = JSON.stringify(obj)
  if (s.length <= max) return s
  const o = { ...obj }
  for (const k of ['agent_runs', 'document_sources', 'history', 'field_defs', 'schedules']) { if (s.length <= max) break; if (Array.isArray(o[k]) && o[k].length > 40) o[k] = o[k].slice(-40); s = JSON.stringify(o) }
  if (s.length > max && o.evidence) { o.evidence = pickRows(o.evidence, ['id', 'document_id', 'kind', 'claim', 'status', 'kept', 'origin']); s = JSON.stringify(o) }
  return s.length > max ? s.slice(0, max) + '…(truncated)' : s
}
function preStateExcerpt(d) {
  if (!d) return null
  return {
    sources: pickRows(d.sources, ['id', 'name', 'kind', 'locator', 'mode', 'instruction', 'freq', 'auth_state', 'deleted_at']),
    notes: d.notes, reports: pickRows(d.reports, ['id', 'name', 'status']), alert_rules: pickRows(d.alert_rules, ['id', 'name', 'status', 'enabled']),
    view_definitions: d.view_definitions, saved_feed_items: (d.feed_items || []).filter(f => f.saved_at).map(f => ({ id: f.id, document_id: f.document_id, saved_at: f.saved_at })),
    counts: { documents: d.documents?.length, evidence: d.evidence?.length, history: d.history?.length }
  }
}

function bkJudgeInput(q, res, dump) {
  return `You are a strict, independent grader for a blind knowledge evaluation of a research app (RFC §3C.1).
A blind "asker" agent typed the question into the app's ⌘K palette Ask and reported the app's answer. Grade the APP'S ANSWER.

RUBRIC ROW
${JSON.stringify(q, null, 1)}

How to grade:
- pass = the answer meets "passRubric" using the "referenceFacts"; "allowedInterpretation" is fine; any "forbiddenClaims" item makes it fail.
- Verify every citation: the cited document (match by title/url/id against DOCUMENTS) must contain the cited claim in DOCUMENT_TEXTS (a document's byline, shown as [Byline: …], is part of it and supports attributing first-person views to that author). A citation that does not support its claim fails the item.
- APP_ANSWER_RECORDS are the app's own stored Ask outputs; prefer them over the asker's paraphrase if they differ. If the asker never obtained an answer from the app, fail.

ASKER FINAL REPORT
${trunc(res.final, 20_000)}

APP_ANSWER_RECORDS
${trunc(JSON.stringify(dump.ask_runs || []), 60_000)}

DOCUMENTS
${JSON.stringify(dump.documents)}

DOCUMENT_TEXTS (id → text)
${trunc(JSON.stringify(dump.document_texts || {}), 250_000)}

ENTITIES
${trunc(JSON.stringify({ theses: pickRows(dump.theses, ['id', 'title', 'parent_id']), companies: pickRows(dump.companies, ['id', 'name', 'followed', 'merged_into_id']), firms: pickRows(dump.firms, ['id', 'name', 'merged_into_id']) }), 20_000)}

ASKER TRANSCRIPT (condensed; ui actions: ${res.actions}, ui errors: ${res.uiErrors}, app crashes: ${res.crashes})
${trunc(res.transcript, 60_000)}

${JUDGE_OUTPUT}`
}

function uxJudgeInput(g, res, dump, pre) {
  const { document_texts, ask_runs, ...state } = dump
  return `You are a strict, independent grader for a blind UX evaluation of a research app (RFC §3C.2).
A first-time-user agent was given the goal below and operated the app only through a UI driver (max ${UX_MAX_ACTIONS} actions).
Decide success ONLY from the final app state (STATE DUMP) against the judge checks; use the transcript to count dead ends and errors.

GOAL (verbatim from the RFC): ${g.goal}
JUDGE CHECKS (state dump): ${g.judgeChecks}

PRE-STATE EXCERPT (before the agent started)
${trunc(JSON.stringify(pre), 40_000)}

STATE DUMP AFTER THE SESSION (read-only JSON of the app database; *_json columns are parsed)
${capJson(state, 300_000)}

SESSION FACTS: ui actions ${res.actions}${res.killedFor ? ` (session stopped: ${res.killedFor})` : ''}; ui errors ${res.uiErrors}; app crashes ${res.crashes}; renderer page errors ${res.pageErrors.length}${res.pageErrors.length ? ': ' + trunc(JSON.stringify(res.pageErrors.slice(0, 10)), 3000) : ''}

AGENT TRANSCRIPT (condensed)
${trunc(res.transcript, 120_000)}

${JUDGE_OUTPUT}`
}

// ---------- setup ----------
async function prepare(profile) {
  if (REUSE) {
    const dir = path.resolve(REUSE, 'setup')
    if (!fs.existsSync(path.join(dir, 'base'))) throw new Error(`--reuse: ${dir}/base not found`)
    log(`setup: reusing ${dir}`)
    return dir
  }
  const dir = path.join(RUN, 'setup')
  log(`setup (${profile}) → ${dir} … (Playwright, live AI; this takes a while)`)
  const r = await run('npx', ['playwright', 'test', '-c', 'tests/blind/playwright.config.ts'], {
    env: { ...BASE_ENV, BLIND_SETUP_DIR: dir, BLIND_PROFILE: profile }, out: path.join(RUN, 'setup.log'), err: path.join(RUN, 'setup.stderr.log'), timeoutMs: 130 * 60_000
  })
  if (r.code !== 0) throw new Error(`setup failed (exit ${r.code}); see ${path.join(RUN, 'setup.log')}`)
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  for (const w of m.warnings) log(`setup warning: ${w}`)
  return dir
}

// ---------- modes ----------
async function knowledge() {
  const qs = BK.filter(q => !ONLY.length || ONLY.includes(q.id))
  const setup = await prepare('knowledge')
  await fixtureEpoch(2)
  const items = []
  for (const q of qs) {
    let best = null
    for (let a = 1; a <= ATTEMPTS && !(best?.verdict.pass); a++) {
      const dir = path.join(RUN, q.id, `attempt-${a}`); fs.mkdirSync(dir, { recursive: true })
      const dataDir = path.join(dir, 'data'); copyProfile(path.join(setup, 'base'), dataDir)
      log(`${q.id} attempt ${a}: asking "${q.question}"`)
      const prompt = `Question: ${q.question}

Use the Research Workspace app (a research app on this Mac) to answer it. Use ONLY the app's ⌘K palette Ask: open the palette with \`ui key Meta+k\`, type the question exactly as written above, submit it as a question, and wait for the app's answer (it can take a minute or two — use \`ui wait 15000\` then \`ui snapshot\` until the answer appears). Do not open other screens, and do not answer from your own knowledge.
When you have it, reply with the app's answer verbatim, including every citation/source it shows, between a line "ANSWER-START" and a line "ANSWER-END". If the app gave no answer, say so.

${DRIVER_NOTES}`
      const res = await runAgent({ dir, prompt, dataDir, maxActions: 0, timeoutMs: 25 * 60_000 })
      const dump = dumpState(dataDir, path.join(dir, 'state.json'), true)
      const verdict = await judge(dir, bkJudgeInput(q, res, dump))
      log(`  ${q.id}: ${verdict.pass ? 'PASS' : 'FAIL'} forbidden=${verdict.forbiddenClaims.length} (${res.agent}, ${res.actions} actions${res.cost != null ? `, $${res.cost.toFixed(2)}` : ''})`)
      const rec = { id: q.id, attempt: a, agent: res.agent, actions: res.actions, uiErrors: res.uiErrors, crashes: res.crashes, answer: res.final, verdict }
      if (!best || verdict.pass) best = rec
      items.push(rec)
    }
  }
  const final = qs.map(q => items.filter(i => i.id === q.id).find(i => i.verdict.pass) || items.filter(i => i.id === q.id).pop())
  const passes = final.filter(i => i.verdict.pass).length
  const forbidden = items.reduce((n, i) => n + i.verdict.forbiddenClaims.length, 0)
  const q6 = final.find(i => i.id === 'BK-Q6')
  const full = qs.length === BK.length
  const met = full ? passes >= 7 && !!q6?.verdict.pass && forbidden === 0 : passes === qs.length && forbidden === 0
  const summary = { mode: 'knowledge', run: RUN, thresholds: full ? '≥7/8 pass, BK-Q6 passes, zero forbidden claims' : 'subset: all selected pass, zero forbidden claims',
    passes, total: qs.length, bkQ6: q6 ? q6.verdict.pass : null, forbiddenClaims: forbidden, met, items }
  return finish(summary, ['ID', 'Pass', 'Forbidden', 'Actions', 'Agent', 'Notes'], final.map(i => [i.id, i.verdict.pass ? 'yes' : 'NO', i.verdict.forbiddenClaims.length, i.actions, i.agent, i.verdict.notes]))
}

async function uxMode() {
  const goals = UX.filter(g => !ONLY.length || ONLY.includes(g.id))
  const needsSetup = goals.some(g => UX_PRESTATE[g.id] !== 'clean')
  const setup = needsSetup ? await prepare('ux') : null
  if (needsSetup) await fixtureEpoch(2)
  const ledgerPw = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/server/ledger-users.json'), 'utf8')).find(u => u.email === 'reader@ledger.test').password
  const preDumps = {}
  const items = []
  for (const g of goals) {
    const pre = UX_PRESTATE[g.id] || 'base'
    const src = pre === 'clean' ? null : path.join(setup, pre)
    if (src && !preDumps[pre]) preDumps[pre] = preStateExcerpt(dumpState(src, path.join(RUN, `prestate-${pre}.json`)))
    for (let a = 1; a <= ATTEMPTS; a++) {
      const dir = path.join(RUN, g.id, `attempt-${a}`); fs.mkdirSync(dir, { recursive: true })
      const dataDir = path.join(dir, 'data'); copyProfile(src, dataDir)
      const goal = agentGoal(g.goal, { password: ledgerPw })
      const extraFiles = g.id === 'UX-08' ? { 'goal.txt': goal + '\n' } : {}
      log(`${g.id} attempt ${a} (${pre}): ${goal}`)
      const prompt = `${UX_PREAMBLE}

Goal: ${goal}

${DRIVER_NOTES}
You have at most ${UX_MAX_ACTIONS} ui actions. When you are done, reply with one short paragraph saying what you did.`
      const res = await runAgent({ dir, prompt, dataDir, maxActions: UX_MAX_ACTIONS, timeoutMs: 40 * 60_000, extraFiles })
      const dump = dumpState(dataDir, path.join(dir, 'state.json'))
      const verdict = await judge(dir, uxJudgeInput(g, res, dump, preDumps[pre] || { note: 'clean profile (empty)' }))
      log(`  ${g.id}: ${verdict.pass ? 'PASS' : 'FAIL'} deadEnds=${verdict.deadEnds} errors=${verdict.errors} actions=${res.actions}${res.killedFor ? ' (' + res.killedFor + ')' : ''} crashes=${res.crashes}`)
      items.push({ id: g.id, attempt: a, agent: res.agent, actions: res.actions, killedFor: res.killedFor, uiErrors: res.uiErrors, crashes: res.crashes, pageErrors: res.pageErrors.length, verdict })
      if (verdict.pass) break
    }
  }
  const final = goals.map(g => items.filter(i => i.id === g.id).find(i => i.verdict.pass) || items.filter(i => i.id === g.id).pop())
  const passes = final.filter(i => i.verdict.pass).length
  const crashes = items.reduce((n, i) => n + i.crashes, 0)
  const meanDeadEnds = items.length ? items.reduce((n, i) => n + i.verdict.deadEnds, 0) / items.length : 0
  const met = passes === goals.length && crashes === 0 && meanDeadEnds <= 2
  const summary = { mode: 'ux', run: RUN, thresholds: `${goals.length}/${goals.length} goals within ${ATTEMPTS} attempts, no crash, mean dead ends ≤ 2`,
    passes, total: goals.length, crashes, meanDeadEnds, met, items }
  return finish(summary, ['ID', 'Pass', 'Attempts', 'Dead ends', 'Errors', 'Actions', 'Notes'],
    final.map(i => [i.id, i.verdict.pass ? 'yes' : 'NO', items.filter(x => x.id === i.id).length, i.verdict.deadEnds, i.verdict.errors, i.actions, i.verdict.notes]))
}

async function dryRun() {
  const dir = path.join(RUN, 'DRY', 'attempt-1'); fs.mkdirSync(dir, { recursive: true })
  const dataDir = path.join(dir, 'data'); copyProfile(null, dataDir)
  const goal = { id: 'DRY', goal: 'Tell me in one sentence what the app\'s main (Today) screen currently says.', judgeChecks: 'feed_items is empty and the agent reports an empty / caught-up Today screen with no sources' }
  log('dry run: one tiny agent session on a clean profile + one judge call')
  const prompt = `${UX_PREAMBLE}

Goal: ${goal.goal}

${DRIVER_NOTES}
You have at most 3 ui actions. Reply with one sentence.`
  const res = await runAgent({ dir, prompt, dataDir, maxActions: 3, timeoutMs: 8 * 60_000 })
  const dump = dumpState(dataDir, path.join(dir, 'state.json'))
  const verdict = await judge(dir, uxJudgeInput(goal, res, dump, { note: 'clean profile (empty)' }))
  const plumbing = { agentStarted: !!res.transcript, agent: res.agent, agentFinal: res.final, actions: res.actions, transcriptSaved: fs.statSync(path.join(dir, 'transcript.jsonl')).size > 0,
    judgeParsed: !verdict.judgeFailed, verdict }
  log(`  agent=${res.agent} actions=${res.actions} final="${trunc(res.final, 200)}"`)
  log(`  judge: ${JSON.stringify(verdict)}`)
  const met = plumbing.agentStarted && plumbing.transcriptSaved && plumbing.judgeParsed && res.actions > 0
  return finish({ mode: 'dry-run', run: RUN, met, plumbing }, ['Check', 'Result'], [['agent ran ui', res.actions > 0], ['transcript saved', plumbing.transcriptSaved], ['judge JSON parsed', plumbing.judgeParsed], ['judge pass', verdict.pass]])
}

function finish(summary, head, rows) {
  writeJson(path.join(RUN, 'summary.json'), summary)
  const esc = v => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const md = [`# Blind evaluation — ${summary.mode}`, '', `Run: \`${path.relative(ROOT, RUN)}\``, '',
    `**Result: ${summary.met ? 'THRESHOLDS MET' : 'THRESHOLDS NOT MET'}**${summary.thresholds ? ` (${summary.thresholds})` : ''}`, '',
    ...('passes' in summary ? [`Passed ${summary.passes}/${summary.total}` + (summary.mode === 'knowledge' ? ` · BK-Q6 ${summary.bkQ6 === null ? 'not run' : summary.bkQ6 ? 'pass' : 'FAIL'} · forbidden claims ${summary.forbiddenClaims}` : ` · crashes ${summary.crashes} · mean dead ends ${summary.meanDeadEnds.toFixed(2)}`), ''] : []),
    `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.map(esc).join(' | ')} |`), ''].join('\n')
  fs.writeFileSync(path.join(RUN, 'summary.md'), md)
  log(md)
  return summary.met ? 0 : 1
}

let code = 1
try { code = DRY ? await dryRun() : mode === 'knowledge' ? await knowledge() : await uxMode() } catch (e) { log('ERROR: ' + (e?.stack || e)); code = 1 }
process.exit(code)
