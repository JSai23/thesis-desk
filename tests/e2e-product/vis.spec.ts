// VIS-01 (RFC §3B): design parity. Renders the approved prototype (vendored React/ReactDOM/Babel served for unpkg) and
// the app after test.seedDemo() at 1440×900, dark theme, for 10 states; a fresh `claude -p --model opus` judge (Read
// tool only, temp dir with only the screenshot pairs and the rubric) scores each pair 1–5 per criterion; all ≥4.
import { test, expect, chromium, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, ROOT, reloadApp } from '../harness/app'

const DESIGN = path.join(ROOT, 'design')
const VENDOR: Record<string, string> = { 'babel.min.js': 'prototype-vendor/babel.min.js', 'react-dom.production.min.js': 'prototype-vendor/react-dom.production.min.js', 'react.production.min.js': 'prototype-vendor/react.production.min.js' }
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' }
const W = 1440, H = 900
const STATES = ['01-today-reader-inspector', '02-today-review', '03-theses-list', '04-thesis-overview', '05-thesis-evolution', '06-company-overview', '07-firm', '08-sources-expanded', '09-reports', '10-palette-open'] as const

/** The same 10 user-visible steps on both renderings. */
async function walk(page: Page, shot: (name: string) => Promise<void>, nav: (label: string) => Promise<void>) {
  await nav('Today'); await page.getByText('Harvey expands into Germany', { exact: true }).first().click(); await shot(STATES[0])
  await page.getByText(/^Review/).first().click(); await shot(STATES[1])
  await nav('Theses'); await shot(STATES[2])
  await page.getByText('AI replacing outsourced services labor', { exact: true }).first().click(); await shot(STATES[3])
  await page.getByText('Evolution', { exact: true }).first().click(); await shot(STATES[4])
  await nav('Companies'); await page.getByText('Harvey', { exact: true }).first().click(); await shot(STATES[5])
  await nav('Venture Firms'); await page.getByText('Benchmark', { exact: true }).first().click(); await shot(STATES[6])
  await nav('Sources'); await page.getByText('Stratechery', { exact: true }).first().click(); await shot(STATES[7])
  await nav('Reports'); await shot(STATES[8])
  await page.keyboard.press('Meta+k'); await shot(STATES[9])
}

const RUBRIC = `You compare screenshots of an approved design prototype ("proto-*.png") with the built app ("app-*.png") for the same 10 states.
Score each pair 1–5 on: layout structure, component placement, typography scale, color tokens, density (5 = indistinguishable in design terms, 4 = same design with minor differences, 3 = noticeable deviations, ≤2 = different design).
Content differences caused by demo data (exact counts, relative times, wording of AI-generated text) are NOT design differences. Also allowed and not to be penalized:
- DEC-032/DEC-079 chrome: the prototype draws a fake macOS window frame with traffic lights and rounded corners inside the page; the app is a real window (no drawn frame, opaque sidebar, inset title bar).
- RFC §1A.7 minimal additions (M-additions): extra small controls such as "Runs ▾", a "Refine this report…" input, status/banners slots, "Notify me…", "Check for updates", Customize, an empty-state line, toasts.
- User-requested additions recorded in RFC §1A.7 M18–M21: a "Load older posts ▾" control and "Reading N articles…" lines; a Briefings group on the Reports screen (rows with report chips, Send now, Edit, "+ New briefing"); the report preview drawn as an illustrated story (lede, images, charts) in a white paper card instead of the prototype's bullet sections; Today's list sections named "Following", "Your theses · <thesis>" and "Headlines" instead of the prototype's section names, Headlines rows drawn as one line (source · time · title, no summary, chips or reason) and therefore a shorter Today list, an "Add a thesis" invitation in Your theses; the reader inspector listing firms and people with Follow/Following buttons; a quiet tier line under company/firm titles and a "Pull latest" button on pages of things not followed.
- User-requested additions recorded in RFC §1A.7 M22–M23: a "From you" card in the right rail of company, firm and thesis pages (the user's own description, with Describe it / Edit and Re-process buttons; when filled, label/value rows); one quiet status line under a company/firm header ("N articles · site x · News search: … Edit search"), a dashed hint card when nothing was found (Website / What it does / Look again) and a "Re-processed …" line; on a thesis page a small nudge to add a description, a "Found N related facts…" line and a dashed "Suggested sources" card; on the Reports screen one line saying reports are read here and briefings are emailed, an Email switch on briefing rows, the open report's Refine box at the top with small example chips and a "Last change · Undo" line, a one-line settings summary ("Weekdays 7:30 · Story · 3 sections · Edit settings") that expands into a schedule/layout/sections editor, an Expand button, and "Deep dive · <company>" blocks inside the story; Settings ▸ AI Behavior "Daily reading limit"; the daily-limit banner with "Read the rest now" and "Change limit".
- The review queue's suggestion cards (RFC §1A.7, existing): in the reader inspector a dashed "Suggested connection" card (Confirm / Change… / Not related) and dashed suggested-thesis rows when an item has unconfirmed thesis links. Judge these states on everything else: the three-pane grid, card styling, typography, color and spacing.
Read every image with the Read tool. Output ONLY a JSON object: {"pairs":[{"state":"<name>","layout":n,"placement":n,"typography":n,"color":n,"density":n,"notes":"<short>"}...]} covering all 10 states.`

test('VIS-01 design parity', async () => {
  test.setTimeout(45 * 60_000)
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-vis-'))
  // prototype
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const proto = await browser.newPage({ colorScheme: 'dark', viewport: { width: W, height: H } })
  await proto.route('https://unpkg.com/**', r => r.fulfill({ path: path.join(DESIGN, VENDOR[path.basename(new URL(r.request().url()).pathname)]), contentType: 'text/javascript' }))
  await proto.route('http://proto.local/**', r => {
    const p = path.join(DESIGN, 'prototype', decodeURIComponent(new URL(r.request().url()).pathname))
    return fs.existsSync(p) ? r.fulfill({ path: p, contentType: TYPES[path.extname(p)] || 'application/octet-stream' }) : r.fulfill({ status: 404 })
  })
  await proto.goto('http://proto.local/Research%20Workspace.dc.html')
  await proto.waitForTimeout(4000)
  await walk(proto, async n => { await proto.waitForTimeout(800); await proto.screenshot({ path: path.join(out, `proto-${n}.png`) }) }, l => proto.getByText(l, { exact: true }).first().click())
  await browser.close()
  // app
  const rw = await launch()
  await rw.invoke('test.seedDemo')
  await rw.invoke('settings.update', { patch: { 'appearance.theme': 'dark', 'banners.dismissed': ['open_at_login'] } })
  await rw.app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && (x as any).__rwMain) || BrowserWindow.getAllWindows()[0]; win.setContentSize(w, h) }, [W, H])
  await reloadApp(rw.page); await rw.page.waitForTimeout(1500)
  const page = rw.page
  await walk(page, async n => { await page.waitForTimeout(1200); await page.screenshot({ path: path.join(out, `app-${n}.png`) }) }, l => page.locator('aside').getByText(l, { exact: true }).first().click())
  await rw.close()
  for (const s of STATES) for (const k of ['proto', 'app']) expect(fs.existsSync(path.join(out, `${k}-${s}.png`)), `${k}-${s}`).toBe(true)
  // judge: fresh process in a dir that contains only the pairs and the rubric
  fs.writeFileSync(path.join(out, 'RUBRIC.md'), RUBRIC)
  const r = spawnSync('claude', ['-p', '--model', 'opus', '--output-format', 'json', '--tools', 'Read', '--allowedTools', 'Read', '--permission-mode', 'dontAsk', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence'],
    { cwd: out, input: RUBRIC + `\n\nThe files are in ${out}. The pairs are (proto, app):\n` + STATES.map(n => `- ${n}: ${path.join(out, `proto-${n}.png`)} vs ${path.join(out, `app-${n}.png`)}`).join('\n'), encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024 })
  const results = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev', 'vis')
  fs.mkdirSync(results, { recursive: true })
  for (const f of fs.readdirSync(out)) fs.copyFileSync(path.join(out, f), path.join(results, f))
  fs.writeFileSync(path.join(results, 'judge-raw.json'), r.stdout || r.stderr || '')
  const text = JSON.parse(r.stdout).result as string
  // the judge once wrote one key in single quotes ('color':5) — repair keys only; scores are taken as written
  const verdict = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1).replace(/([{,]\s*)'(\w+)'\s*:/g, '$1"$2":'))
  fs.writeFileSync(path.join(results, 'judge.json'), JSON.stringify(verdict, null, 2))
  expect(verdict.pairs.length).toBe(10)
  const low = verdict.pairs.flatMap((p: any) => ['layout', 'placement', 'typography', 'color', 'density'].filter(k => p[k] < 4).map(k => `${p.state}.${k}=${p[k]} (${p.notes})`))
  expect(low).toEqual([])
})
