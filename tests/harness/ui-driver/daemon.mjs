// ui-driver daemon (RFC §3.0.1, §3C): launches the built app exactly like tests/harness/app.ts launch() and holds the
// ElectronApplication. Listens on 127.0.0.1:<random>; the port is written to <state>/state.json once the app is ready.
// Spawned detached by `ui start` (client.mjs); every other verb is one HTTP request to this process.
import { _electron as electron } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const MAIN = path.join(ROOT, 'app/out/main/index.js')
const STATE_DIR = process.env.RW_UI_STATE_DIR || path.join(os.tmpdir(), 'rw-ui-default')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const IDLE_MS = Number(process.env.RW_UI_IDLE_MS || 45 * 60_000)
const SNAPSHOT_LIMIT = 25_000

fs.mkdirSync(STATE_DIR, { recursive: true })
const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(f + '.tmp', f) }
const appendJsonl = (name, v) => fs.appendFileSync(path.join(STATE_DIR, name), JSON.stringify({ ts: new Date().toISOString(), ...v }) + '\n')
const sleep = ms => new Promise(r => setTimeout(r, ms))

let app, mainPage, stopping = false, pinned = null, lastRequest = Date.now()
// invoke is for the runner only (dump-state fallback): it needs this token, which only the runner reads from the state dir
const RUNNER_TOKEN = crypto.randomBytes(16).toString('hex')

async function launchApp() {
  const dataDir = process.env.RW_UI_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'rw-ui-data-'))
  const env = {
    ...process.env,
    RW_DATA_DIR: dataDir, RW_TEST_MODE: '1', RW_NO_JITTER: '1', RW_LLM_CACHE: 'off', TZ: 'America/Los_Angeles',
    ...(process.env.RW_HEADED === '1' ? {} : { RW_HEADLESS: '1' }),
    RW_TEST_NOW: process.env.RW_UI_TEST_NOW || '2026-09-29T09:00:00',
    ...(process.env.RW_UI_CODEX_HOME ? { RW_CODEX_HOME: process.env.RW_UI_CODEX_HOME } : {}),
    ...(process.env.RW_UI_EXTRA_ENV ? JSON.parse(process.env.RW_UI_EXTRA_ENV) : {})
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  if (process.env.RW_LLM_CACHE_DEV === 'rw') env.RW_LLM_CACHE = 'rw'
  app = await electron.launch({ args: [MAIN], env, cwd: ROOT })
  const isMain = p => /renderer\/index\.html/.test(p.url())
  for (let i = 0; i < 100 && !mainPage; i++) { mainPage = app.windows().find(isMain); if (!mainPage) await sleep(200) }
  mainPage = mainPage || await app.firstWindow()
  await mainPage.waitForLoadState('domcontentloaded')
  await mainPage.waitForFunction(() => !!window.rw, null, { timeout: 30_000 })
  await sleep(800)
  app.on('close', () => {
    if (stopping) return
    appendJsonl('crashes.jsonl', { event: 'app_closed_unexpectedly' })
    process.exit(3)
  })
  app.on('window', p => {
    p.on('pageerror', e => appendJsonl('page-errors.jsonl', { url: hostOf(p), message: String(e?.message || e) }))
  })
  mainPage.on('pageerror', e => appendJsonl('page-errors.jsonl', { url: 'main', message: String(e?.message || e) }))
  return { dataDir, electronPid: app.process().pid }
}

function hostOf(p) {
  try { const u = new URL(p.url()); return u.protocol === 'file:' ? '' : u.host + u.pathname } catch { return '' }
}

/** Visible windows in open order; the main window first. In headless runs nothing is on screen, so a window the user
 *  would see (the app tags sign-in windows rwUserFacing) counts as visible — matched by the URLs of its views. */
async function visibleWindows() {
  const out = []
  const facing = new Set(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().filter(w => !w.isDestroyed() && (w.isVisible() || w.rwUserFacing))
    .flatMap(w => [w.webContents, ...((w.contentView && w.contentView.children) || []).map(v => v.webContents)]).filter(Boolean).map(wc => wc.getURL())).catch(() => []))
  for (const p of app.windows()) {
    if (p.isClosed()) continue
    let visible = p === mainPage || facing.has(p.url())
    if (!visible) { try { visible = await (await app.browserWindow(p)).evaluate(w => w.isVisible() && !w.isDestroyed()) } catch { visible = false } }
    if (visible) out.push(p)
  }
  if (!out.includes(mainPage) && !mainPage.isClosed()) out.unshift(mainPage)
  return out
}

/** The page verbs act on: an explicitly chosen window while it is open, else the most recently opened visible one. */
async function current() {
  const wins = await visibleWindows()
  if (pinned && wins.includes(pinned)) return { page: pinned, wins }
  pinned = null
  return { page: wins[wins.length - 1] || mainPage, wins }
}

async function windowLine(page, wins) {
  const label = async p => { const t = await p.title().catch(() => ''); const h = hostOf(p); return `"${t || 'Untitled'}"${h ? ' (' + h + ')' : ''}` }
  const parts = []
  for (let i = 0; i < wins.length; i++) parts.push(`${i + 1}: ${await label(wins[i])}${wins[i] === page ? ' [current]' : ''}`)
  return wins.length > 1 ? `Windows — ${parts.join('; ')}. Use \`ui window <n>\` to switch.` : `Window: ${await label(page)}`
}

async function firstVisible(loc) {
  const n = Math.min(await loc.count(), 60)
  for (let i = 0; i < n; i++) { const l = loc.nth(i); if (await l.isVisible().catch(() => false)) return l }
  return null
}

async function visibleNames(page, role) {
  try {
    const loc = page.getByRole(role)
    const n = Math.min(await loc.count(), 80), names = []
    for (let i = 0; i < n && names.length < 20; i++) {
      const l = loc.nth(i)
      if (!(await l.isVisible().catch(() => false))) continue
      const nm = ((await l.getAttribute('aria-label').catch(() => null)) || (await l.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 60)
      if (nm && !names.includes(nm)) names.push(nm)
    }
    return names
  } catch { return [] }
}

async function settle(page, ms = 500) { await page.waitForTimeout(ms).catch(() => {}) }

async function newWindowNote(before) {
  const { page, wins } = await current()
  return wins.length > before ? ` (a new window opened: "${await page.title().catch(() => '')}"${hostOf(page) ? ' ' + hostOf(page) : ''})` : ''
}

const verbs = {
  async ping() { return 'ok' },

  async snapshot() {
    const { page, wins } = await current()
    const head = await windowLine(page, wins)
    let aria = ''
    try { aria = await page.locator('body').ariaSnapshot({ timeout: 10_000 }) } catch (e) { aria = `(accessibility tree unavailable: ${e.message.split('\n')[0]})` }
    const text = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')
    // join runs of short fragments (icons, counts, labels) onto one line so the text stays readable and small
    const lines = []
    for (const s of text.split('\n').map(x => x.trim()).filter(Boolean)) {
      if (lines.length && s.length < 30 && lines[lines.length - 1].length < 160) lines[lines.length - 1] += ' · ' + s
      else lines.push(s)
    }
    const compactText = lines.join('\n')
    const ariaBudget = Math.max(8000, SNAPSHOT_LIMIT - 2000 - Math.min(compactText.length, 8000))
    const a = aria.length > ariaBudget ? aria.slice(0, ariaBudget) + '\n… (accessibility tree truncated)' : aria
    const rest = Math.max(1000, SNAPSHOT_LIMIT - a.length - head.length - 100)
    const t = compactText.length > rest ? compactText.slice(0, rest) + '\n… (text truncated)' : compactText
    return `${head}\n--- accessibility tree ---\n${a}\n--- visible text ---\n${t}`
  },

  async screenshot({ path: p }) {
    if (!p) throw new Error('usage: ui screenshot <path>')
    const { page } = await current()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    await page.screenshot({ path: p })
    return `ok: saved screenshot to ${p}`
  },

  async click({ role, name }) {
    if (!role || name === undefined) throw new Error('usage: ui click <role> <name>   (role "text" clicks visible text)')
    const { page, wins } = await current()
    let loc
    if (role === 'text') loc = await firstVisible(page.getByText(name))
    else {
      try { loc = await firstVisible(page.getByRole(role, { name, exact: false })) } catch (e) { throw new Error(`bad role "${role}": ${e.message.split('\n')[0]}`) }
    }
    if (!loc) {
      const names = role === 'text' ? [] : await visibleNames(page, role)
      throw new Error(`no visible ${role} named "${name}"` + (names.length ? `. Visible ${role}s: ${names.map(n => `"${n}"`).join(', ')}` : ''))
    }
    await loc.click({ timeout: 5000 })
    await settle(page)
    return `ok: clicked ${role} "${name}"${await newWindowNote(wins.length)}`
  },

  async 'click-xy'({ x, y }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('usage: ui click-xy <x> <y>')
    const { page, wins } = await current()
    await page.mouse.click(x, y)
    await settle(page)
    return `ok: clicked at ${x},${y}${await newWindowNote(wins.length)}`
  },

  async type({ text }) {
    if (text === undefined || text === '') throw new Error('usage: ui type <text>')
    const { page } = await current()
    const focused = await page.evaluate(() => { const a = document.activeElement; return !!a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) }).catch(() => false)
    await page.keyboard.type(text, { delay: 8 })
    await settle(page, 300)
    return `ok: typed ${JSON.stringify(text)}` + (focused ? '' : ' (note: no text field was focused)')
  },

  async key({ combo }) {
    if (!combo) throw new Error('usage: ui key <combo>   e.g. Enter, Escape, Meta+k, j')
    const { page, wins } = await current()
    await page.keyboard.press(combo)
    await settle(page)
    return `ok: pressed ${combo}${await newWindowNote(wins.length)}`
  },

  async 'select-text'({ text }) {
    if (!text) throw new Error('usage: ui select-text <substring>')
    const { page } = await current()
    const r = await page.evaluate(needle => {
      const norm = s => s.replace(/\s+/g, ' ')
      const visible = el => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false } return true }
      // prefer selectable text areas (the reader), then anywhere
      const roots = [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).userSelect === 'text' && visible(e) && e.getClientRects().length)
      const tryRoot = (root, ci) => {
        const nodes = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue && visible(n.parentElement)) nodes.push(n)
        // concatenated text with a whitespace-normalized index map
        let flat = '', map = []
        for (const n of nodes) for (let i = 0; i < n.nodeValue.length; i++) {
          const ch = /\s/.test(n.nodeValue[i]) ? ' ' : n.nodeValue[i]
          if (ch === ' ' && flat.endsWith(' ')) continue
          flat += ch; map.push([n, i])
        }
        const hay = ci ? flat.toLowerCase() : flat, nd = ci ? norm(needle).toLowerCase() : norm(needle)
        const at = hay.indexOf(nd)
        if (at < 0) return null
        const [sn, so] = map[at], [en, eo] = map[at + nd.length - 1]
        const range = document.createRange(); range.setStart(sn, so); range.setEnd(en, eo + 1)
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range)
        range.startContainer.parentElement.scrollIntoView({ block: 'center' })
        const target = range.endContainer.parentElement
        const rc = range.getBoundingClientRect()
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: rc.right, clientY: rc.bottom, view: window }))
        return { ok: true, selected: sel.toString().slice(0, 200) }
      }
      for (const ci of [false, true]) {
        for (const root of roots) { const r = tryRoot(root, ci); if (r) return r }
        const r = tryRoot(document.body, ci); if (r) return r
      }
      return { ok: false }
    }, text)
    if (!r.ok) throw new Error(`text not found on screen: "${text}"`)
    if (!r.selected.trim()) throw new Error(`"${text}" is on screen but that text can't be selected`)
    await settle(page)
    return `ok: selected "${r.selected}"`
  },

  async wait({ ms }) {
    const n = Math.max(0, Math.min(Number(ms) || 0, 60_000))
    await sleep(n)
    return `ok: waited ${n} ms`
  },

  async window({ n }) {
    const { page, wins } = await current()
    if (n === undefined || n === null || n === '') return await windowLine(page, wins)
    const i = Number(n) - 1
    if (!wins[i]) throw new Error(`no window ${n}; there are ${wins.length}`)
    pinned = wins[i]
    await pinned.bringToFront().catch(() => {})
    return `ok: switched to window ${n} — ${await windowLine(pinned, wins)}`
  },

  /** Runner-only: call a public command through the preload boundary (used by dump-state when the DB can't be opened). */
  async invoke({ command, payload, token }) {
    if (token !== RUNNER_TOKEN) throw new Error('unknown verb "invoke"')
    const r = await mainPage.evaluate(([c, p]) => window.rw.invoke(c, p), [command, payload || {}])
    return JSON.stringify(r)
  },

  async stop() {
    stopping = true
    setTimeout(async () => { try { await app.close() } catch { /* gone */ } try { fs.rmSync(STATE_FILE) } catch { /* gone */ } process.exit(0) }, 50)
    return 'ok: app closed'
  }
}

let queue = Promise.resolve()
function handle(req, res) {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    queue = queue.then(async () => {
      lastRequest = Date.now()
      let out
      try {
        const { verb, args } = JSON.parse(body || '{}')
        const fn = verbs[verb]
        if (!fn) throw new Error(`unknown verb "${verb}"`)
        out = { ok: true, result: await fn(args || {}) }
      } catch (e) {
        out = { ok: false, error: String(e?.message || e).split('\n')[0].slice(0, 2000) }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(out))
    })
  })
}

try {
  const info = await launchApp()
  fs.writeFileSync(path.join(STATE_DIR, 'runner.token'), RUNNER_TOKEN, { mode: 0o600 })
  const server = http.createServer(handle)
  server.listen(0, '127.0.0.1', () => {
    writeJson(STATE_FILE, { port: server.address().port, pid: process.pid, ...info, startedAt: new Date().toISOString() })
  })
  setInterval(async () => {
    if (Date.now() - lastRequest > IDLE_MS) { appendJsonl('daemon-events.jsonl', { event: 'idle_shutdown' }); await verbs.stop() }
  }, 30_000).unref()
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => verbs.stop())
} catch (e) {
  fs.writeFileSync(path.join(STATE_DIR, 'daemon.error'), String(e?.stack || e))
  try { await app?.close() } catch { /* gone */ }
  process.exit(1)
}
