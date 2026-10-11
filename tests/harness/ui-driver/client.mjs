// `ui` — the only interface a blind agent has to the app (RFC §3C). Each verb is one short request to the daemon.
// Env (set by the runner, never by the agent): RW_UI_STATE_DIR, RW_UI_DATA_DIR, RW_UI_TEST_NOW, RW_UI_CODEX_HOME,
// RW_UI_EXTRA_ENV (JSON), RW_UI_MAX_ACTIONS. Every invocation is appended to <state>/actions.jsonl and counted in
// <state>/actions.count (errors included); the runner reads both.
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const STATE_DIR = process.env.RW_UI_STATE_DIR || path.join(os.tmpdir(), 'rw-ui-default')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const COUNT_FILE = path.join(STATE_DIR, 'actions.count')
const MAX = Number(process.env.RW_UI_MAX_ACTIONS || 0)

const USAGE = `ui — operate the Research Workspace app
  ui start                     open the app (no-op if it is already open)
  ui snapshot                  print what is on screen (accessibility tree + visible text)
  ui screenshot <path>         save a PNG of the window
  ui click <role> <name>       click the first visible element with that role and (partial) name,
                               e.g. ui click button "Add source"; roles: button, link, textbox, tab, menuitem,
                               checkbox, option, combobox, heading, row, ... or "text" to click visible text
  ui click-xy <x> <y>          click at window coordinates
  ui type <text>               type into the focused field
  ui key <combo>               press a key, e.g. Enter, Escape, Tab, Meta+k, j, ArrowDown
  ui select-text <substring>   select that text on screen (e.g. in an article) as if dragged with the mouse
  ui wait <ms>                 wait (max 60000)
  ui window [n]                list open windows, or switch to window n
  ui stop                      close the app`

const sleep = ms => new Promise(r => setTimeout(r, ms))
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }

function request(port, body, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let b = ''
      res.on('data', c => (b += c))
      res.on('end', () => { try { resolve(JSON.parse(b)) } catch { reject(new Error('bad response from app driver')) } })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('the app did not respond in time')))
    req.end(data)
  })
}

async function running() {
  const st = readJson(STATE_FILE)
  if (!st || !alive(st.pid)) return null
  try { const r = await request(st.port, { verb: 'ping' }, 5000); return r.ok ? st : null } catch { return null }
}

async function start() {
  if (await running()) return 'ok: app already running'
  fs.mkdirSync(STATE_DIR, { recursive: true })
  for (const f of [STATE_FILE, path.join(STATE_DIR, 'daemon.error')]) try { fs.rmSync(f) } catch { /* none */ }
  const log = fs.openSync(path.join(STATE_DIR, 'daemon.log'), 'a')
  const child = spawn(process.execPath, [path.join(HERE, 'daemon.mjs')], { detached: true, stdio: ['ignore', log, log], cwd: ROOT, env: process.env })
  child.unref()
  for (let i = 0; i < 600; i++) {
    await sleep(200)
    const err = path.join(STATE_DIR, 'daemon.error')
    if (fs.existsSync(err)) throw new Error('the app failed to start: ' + fs.readFileSync(err, 'utf8').split('\n')[0])
    if (fs.existsSync(STATE_FILE)) return 'ok: app started'
    if (!alive(child.pid)) throw new Error('the app failed to start (see driver log)')
  }
  throw new Error('the app did not start within 120 s')
}

async function stop() {
  const st = readJson(STATE_FILE)
  if (!st || !alive(st.pid)) return 'ok: app was not running'
  try { await request(st.port, { verb: 'stop' }, 15_000) } catch { /* fall through to kill */ }
  for (let i = 0; i < 75 && alive(st.pid); i++) await sleep(200)
  for (const pid of [st.pid, st.electronPid]) if (pid && alive(pid)) try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
  try { fs.rmSync(STATE_FILE) } catch { /* gone */ }
  return 'ok: app closed'
}

function parse(argv) {
  const [verb, ...rest] = argv
  switch (verb) {
    case 'click': return { verb, args: { role: rest[0], name: rest.slice(1).join(' ') || undefined } }
    case 'click-xy': return { verb, args: { x: Number(rest[0]), y: Number(rest[1]) } }
    case 'type': return { verb, args: { text: rest.join(' ') } }
    case 'key': return { verb, args: { combo: rest[0] } }
    case 'select-text': return { verb, args: { text: rest.join(' ') } }
    case 'wait': return { verb, args: { ms: Number(rest[0]) } }
    case 'window': return { verb, args: { n: rest[0] } }
    case 'screenshot': return { verb, args: { path: rest[0] ? path.resolve(process.cwd(), rest[0]) : undefined } }
    case 'invoke': return { verb, args: { command: rest[0], payload: rest[1] ? JSON.parse(rest[1]) : {}, token: process.env.RW_UI_RUNNER_TOKEN } }
    default: return { verb, args: {} }
  }
}

function record(entry) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.appendFileSync(path.join(STATE_DIR, 'actions.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
}

async function main() {
  const argv = process.argv.slice(2)
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0])) { console.log(USAGE); return 0 }
  const { verb, args } = parse(argv)
  // the runner's own start/stop/invoke calls are not the agent's actions
  const runnerCall = verb === 'invoke' || process.env.RW_UI_UNCOUNTED === '1'
  let n = 0
  if (!runnerCall) {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    n = Number(fs.existsSync(COUNT_FILE) ? fs.readFileSync(COUNT_FILE, 'utf8') : 0) + 1
    fs.writeFileSync(COUNT_FILE, String(n))
    if (MAX && n > MAX) {
      const msg = `error: action limit reached (${MAX}). Stop now.`
      record({ n, verb, args, ok: false, error: 'action limit reached' })
      console.log(msg); return 3
    }
  }
  const t0 = Date.now()
  let ok = true, out
  try {
    if (verb === 'start') out = await start()
    else if (verb === 'stop') out = await stop()
    else {
      const st = await running()
      if (!st) throw new Error('the app is not running; run `ui start`')
      const r = await request(st.port, { verb, args }, verb === 'invoke' ? 330_000 : undefined)
      if (!r.ok) throw new Error(r.error)
      out = r.result
    }
  } catch (e) {
    ok = false
    out = 'error: ' + String(e?.message || e)
  }
  if (!runnerCall) {
    const { token, ...shown } = args
    record({ n, verb, args: verb === 'snapshot' ? {} : shown, ok, ms: Date.now() - t0, result: out.slice(0, 400) })
  }
  console.log(out)
  return ok ? 0 : 1
}

process.exitCode = await main()
