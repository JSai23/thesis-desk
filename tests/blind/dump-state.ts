// Read-only state dump for blind-evaluation judges (RFC §3C). Usage:
//   node tests/blind/dump-state.ts <dataDir> [--with-text] [--out file.json]
// Opens <dataDir>/research.sqlite read-only (better-sqlite3, else node:sqlite). If neither can open it, falls back to
// asking a running ui-driver daemon (RW_UI_STATE_DIR) via test.inspect. Only erasable TypeScript syntax is used so
// Node ≥ 23.6 runs this file directly.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
type Row = Record<string, any>
type Reader = (table: string) => Promise<Row[]>

const TABLES = ['sources', 'documents', 'evidence', 'relationships', 'field_values', 'field_defs', 'notes', 'theses', 'companies', 'firms',
  'people', 'reports', 'alert_rules', 'view_definitions', 'feed_items', 'settings', 'history', 'schedules', 'document_sources', 'agent_runs']
const SECRET_KEY = /secret|password|pass\b|token|cookie|api.?key|credential|app_?password/i
const DOC_COLS = ['id', 'kind', 'url', 'canonical_url', 'title', 'status', 'access', 'duplicate_of_id', 'current_version', 'ai_generation', 'published_at', 'deleted_at', 'author', 'site_name']
const EV_COLS = ['id', 'document_id', 'document_version', 'kind', 'assertion', 'claim', 'quote', 'attributed_to', 'status', 'kept', 'origin', 'payload_json', 'created_at']
const FEED_DROP = ['summary', 'why_it_matters']

function parseJsonCols(r: Row): Row {
  const o: Row = {}
  for (const [k, v] of Object.entries(r)) {
    if (k === '_rowid') continue
    if (k.endsWith('_json') && typeof v === 'string') { try { o[k.replace(/_json$/, '')] = JSON.parse(v); continue } catch { /* keep raw */ } }
    o[k] = v
  }
  return o
}
const pick = (r: Row, cols: string[]): Row => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]]))

function sqliteReader(dbFile: string): Reader | null {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbFile, { readonly: true, fileMustExist: true })
    db.prepare('SELECT 1').get()
    return async t => { try { return db.prepare(`SELECT rowid AS _rowid, * FROM ${t} ORDER BY rowid`).all() } catch { return [] } }
  } catch { /* try node:sqlite */ }
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbFile, { readOnly: true })
    return async t => { try { return db.prepare(`SELECT rowid AS _rowid, * FROM ${t} ORDER BY rowid`).all() } catch { return [] } }
  } catch { return null }
}

function daemonReader(stateDir: string): Reader | null {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf8'))
    const token = fs.readFileSync(path.join(stateDir, 'runner.token'), 'utf8').trim()
    return t => new Promise((resolve, reject) => {
      const body = JSON.stringify({ verb: 'invoke', args: { command: 'test.inspect', payload: { table: t, where: {} }, token } })
      const req = http.request({ host: '127.0.0.1', port: st.port, method: 'POST', path: '/', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
        let b = ''
        res.on('data', c => (b += c))
        res.on('end', () => {
          try {
            const r = JSON.parse(b); if (!r.ok) return reject(new Error(r.error))
            const env = JSON.parse(r.result); resolve(env.ok ? env.data : [])
          } catch (e) { reject(e) }
        })
      })
      req.on('error', reject)
      req.end(body)
    })
  } catch { return null }
}

export async function dumpState(dataDir: string, o: { withText?: boolean; stateDir?: string } = {}): Promise<Row> {
  const dbFile = path.join(dataDir, 'research.sqlite')
  const read = (fs.existsSync(dbFile) && sqliteReader(dbFile)) || (o.stateDir && daemonReader(o.stateDir))
  if (!read) throw new Error(`cannot read state: no readable ${dbFile} and no running ui-driver daemon`)
  const out: Row = { dataDir, dumpedAt: new Date().toISOString() }
  for (const t of TABLES) {
    let rows = (await read(t)).map(parseJsonCols)
    if (t === 'documents') {
      if (o.withText) out.document_texts = Object.fromEntries(rows.filter(r => r.status !== 'duplicate' && !r.deleted_at).map(r => [r.id, (r.author ? `[Byline: ${r.author}]\n` : '') + r.text]))
      rows = rows.map(r => pick(r, DOC_COLS))
    } else if (t === 'evidence') rows = rows.map(r => pick({ ...r, payload_json: r.payload }, EV_COLS))
    else if (t === 'feed_items') rows = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !FEED_DROP.includes(k))))
    else if (t === 'settings') rows = rows.filter(r => !SECRET_KEY.test(r.key)).map(r => ({ key: r.key, value: r.value }))
    else if (t === 'sources') rows = rows.map(({ auth_profile, ...r }) => ({ ...r, auth_profile: auth_profile ? '(present)' : null }))
    else if (t === 'history') rows = rows.slice(-200)
    else if (t === 'agent_runs') { out.ask_runs = rows.filter(r => r.task === 'ANSWER_QUERY').map(r => pick(r, ['id', 'status', 'output', 'error', 'created_at'])); continue }
    out[t] = rows
  }
  return out
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (isMain) {
  const args = process.argv.slice(2)
  const dataDir = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out')
  if (!dataDir) { console.error('usage: node tests/blind/dump-state.ts <dataDir> [--with-text] [--out file.json]'); process.exit(2) }
  const outIdx = args.indexOf('--out')
  const state = await dumpState(path.resolve(dataDir), { withText: args.includes('--with-text'), stateDir: process.env.RW_UI_STATE_DIR })
  const json = JSON.stringify(state, null, 1)
  if (outIdx >= 0) fs.writeFileSync(args[outIdx + 1], json)
  else process.stdout.write(json + '\n')
}
