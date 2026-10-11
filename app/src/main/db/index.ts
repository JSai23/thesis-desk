// One SQLite database (WAL, FTS5) with forward-only migrations (RFC §1B.4, B-DATA-001).
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import m0001 from './migrations/0001_init.sql?raw'
import m0002 from './migrations/0002_briefings.sql?raw'
import m0003 from './migrations/0003_object_details.sql?raw'

export type DB = Database.Database

const MIGRATIONS: { version: number; sql: string }[] = [{ version: 1, sql: m0001 }, { version: 2, sql: m0002 }, { version: 3, sql: m0003 }]

let db: DB | null = null

export function openDb(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true })
  const d = new Database(path.join(dataDir, 'research.sqlite'))
  d.pragma('journal_mode = WAL')
  d.pragma('foreign_keys = ON')
  d.pragma('busy_timeout = 5000')
  d.pragma('synchronous = NORMAL')
  migrate(d)
  db = d
  return d
}

function migrate(d: DB): void {
  d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const applied = new Set((d.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(r => r.version))
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    d.transaction(() => {
      d.exec(m.sql)
      d.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(m.version, Date.now())
    })()
  }
}

export function getDb(): DB {
  if (!db) throw new Error('DB not open')
  return db
}

export function closeDb(): void {
  stmts.clear()
  db?.close()
  db = null
}

export const schemaVersion = (): number =>
  (getDb().prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number }).v

/** Run fn inside a transaction (re-entrant: nested calls join the outer transaction). */
export function tx<T>(fn: () => T): T {
  const d = getDb()
  if (d.inTransaction) return fn()
  return d.transaction(fn)()
}

const stmts = new Map<string, Database.Statement>()
function stmt(sql: string): Database.Statement {
  let s = stmts.get(sql)
  if (!s) {
    s = getDb().prepare(sql)
    if (stmts.size > 2000) stmts.clear()
    stmts.set(sql, s)
  }
  return s
}

// Repository helpers: SQL text is always a constant in the calling module; values are bound parameters only.
export const one = <T = any>(sql: string, ...params: unknown[]): T | undefined => stmt(sql).get(...params) as T | undefined
export const all = <T = any>(sql: string, ...params: unknown[]): T[] => stmt(sql).all(...params) as T[]
export const run = (sql: string, ...params: unknown[]) => stmt(sql).run(...params)

export const json = <T>(s: string | null | undefined, fallback: T): T => {
  if (s == null) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}
