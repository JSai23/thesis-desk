// Local Data (RFC §1B.21, P-SET-003, B-DATA-002): rebuild FTS, size, and a plain Markdown + JSON export readable
// without the app.
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { all, one, getDb } from './db'
import { DATA_DIR } from './env'
import { now } from './clock'
import { getSetting, setSetting } from './settings'
import { thesisDoc } from './reports/delivery'

export function reindex(): { lastIndexedAt: number } {
  const d = getDb()
  for (const t of ['fts_documents', 'fts_evidence', 'fts_notes']) d.exec(`INSERT INTO ${t}(${t}) VALUES ('rebuild')`)
  const t = now()
  setSetting('library.last_indexed', t)
  return { lastIndexedAt: t }
}

export const lastIndexedAt = (): number | null => getSetting<number | null>('library.last_indexed') ?? null

function dirSize(p: string): number {
  if (!fs.existsSync(p)) return 0
  const st = fs.statSync(p)
  if (!st.isDirectory()) return st.size
  return fs.readdirSync(p).reduce((n, e) => n + dirSize(path.join(p, e)), 0)
}
/** DB (+ WAL) and stored raw content bytes. */
export function librarySize(): number {
  return ['research.sqlite', 'research.sqlite-wal'].reduce((n, f) => n + dirSize(path.join(DATA_DIR, f)), 0) + dirSize(path.join(DATA_DIR, 'content'))
}

const fileName = (s: string) => s.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled'
const day = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : '')

function entityMd(type: 'company' | 'firm', id: string, name: string): string {
  const fields = all<{ field_key: string; display: string }>("SELECT field_key, display FROM field_values WHERE object_type = ? AND object_id = ? AND status = 'current' ORDER BY field_key", type, id)
  const ev = all<{ claim: string; quote: string; title: string; url: string | null; published_at: number | null }>(
    `SELECT e.claim, e.quote, d.title, d.url, d.published_at FROM relationships r JOIN evidence e ON e.id = r.from_id JOIN documents d ON d.id = e.document_id
     WHERE r.from_type = 'evidence' AND r.to_type = ? AND r.to_id = ? AND r.status <> 'rejected' AND e.status = 'active' AND d.deleted_at IS NULL ORDER BY COALESCE(d.published_at, e.created_at) DESC`, type, id)
  const notes = all<{ text: string }>("SELECT text FROM notes WHERE anchor_type = ? AND anchor_id = ? AND deleted_at IS NULL ORDER BY created_at", type, id)
  return [`# ${name}`, '', ...(fields.length ? ['## Fields', ...fields.map(f => `- ${f.field_key}: ${f.display}`), ''] : []),
    '## Evidence', ...(ev.length ? ev.map(e => `- ${e.claim} — “${e.quote}” (${e.title}${e.published_at ? ', ' + day(e.published_at) : ''}${e.url ? ', ' + e.url : ''})`) : ['Nothing yet.']), '',
    ...(notes.length ? ['## Notes', ...notes.map(n => `- ${n.text}`), ''] : [])].join('\n')
}

export function exportLibrary(dir?: string): { dir: string; files: number } {
  const out = dir || path.join(app.getPath('downloads'), `Research Workspace Export ${new Date(now()).toISOString().slice(0, 16).replace(/[:T]/g, '-')}`)
  let files = 0
  const write = (rel: string, body: string) => { const p = path.join(out, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); files++ }
  const theses = all<{ id: string; title: string }>('SELECT id, title FROM theses WHERE merged_into_id IS NULL')
  for (const t of theses) write(`theses/${fileName(t.title)}.md`, thesisDoc(t.id).markdown)
  for (const type of ['company', 'firm'] as const) {
    const rows = all<{ id: string; name: string }>(`SELECT id, name FROM ${type === 'company' ? 'companies' : 'firms'} WHERE merged_into_id IS NULL AND deleted_at IS NULL ORDER BY name`)
    for (const r of rows) write(`${type === 'company' ? 'companies' : 'firms'}/${fileName(r.name)}.md`, entityMd(type, r.id, r.name))
  }
  const notes = all<{ text: string; kind: string; anchor_type: string; anchor_id: string | null; created_at: number }>('SELECT text, kind, anchor_type, anchor_id, created_at FROM notes WHERE deleted_at IS NULL ORDER BY created_at')
  write('notes.md', ['# Notes', '', ...notes.map(n => `- ${day(n.created_at)} · ${n.kind}${n.anchor_id ? ` · ${n.anchor_type}` : ''}: ${n.text}`)].join('\n'))
  const ev = all<any>("SELECT id, document_id, kind, assertion, claim, quote, attributed_to, event_date, payload_json, created_at FROM evidence WHERE status = 'active' ORDER BY created_at")
  write('evidence.jsonl', ev.map(e => JSON.stringify({ ...e, payload: JSON.parse(e.payload_json || '{}'), payload_json: undefined })).join('\n') + (ev.length ? '\n' : ''))
  const docs = all<any>('SELECT id, kind, url, canonical_url, title, author, site_name, published_at, first_fetched_at, status, text FROM documents WHERE deleted_at IS NULL ORDER BY first_fetched_at')
  write('documents.jsonl', docs.map(d => JSON.stringify(d)).join('\n') + (docs.length ? '\n' : ''))
  write('manifest.json', JSON.stringify({ app: 'Research Workspace', version: app.getVersion(), exportedAt: new Date(now()).toISOString(), counts: { theses: theses.length, documents: docs.length, evidence: ev.length, notes: notes.length }, schemaVersion: one<{ v: number }>('SELECT MAX(version) v FROM schema_migrations')!.v }, null, 2))
  return { dir: out, files: files + 1 }
}
