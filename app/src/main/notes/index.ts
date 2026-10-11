// Notes (RFC FLOW-C, P-CAPTURE-003, LAW-07): the note is committed before any model call; ORGANIZE_NOTE later adds
// suggestions without altering the text. The user's own choices at save time are stored as user-origin links.
import { all, one, run, tx } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { writeHistory } from '../history'
import { getSetting } from '../settings'
import { enqueue, registerJob } from '../jobs'
import { registerMaintenance } from '../maintenance'
import { runTask } from '../ai/runtime'
import { readAuth } from '../ai/codex-auth'
import { ORGANIZE, SUGGEST_THESES, type OrganizeValue } from '../ai/tasks/think'
import { log } from '../log'
import { Handles } from '../ai/handles'

type Kind = 'observation' | 'question' | 'counterpoint' | 'correction'
export interface CreateNote { text: string; kind?: Kind; kindDecided?: boolean; anchor?: { type: 'thesis' | 'company' | 'firm' | 'none'; id?: string | null }; documentId?: string; quote?: string; thesisId?: string | null; companyIds?: string[]; firmIds?: string[] }

function userLink(noteId: string, toType: 'thesis' | 'company' | 'firm', toId: string): void {
  const t = now()
  run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, created_at, updated_at) VALUES (?, 'note', ?, 'relates_to', ?, ?, 'user', 'accepted', ?, ?)
       ON CONFLICT(from_type, from_id, rel, to_type, to_id) DO UPDATE SET origin = 'user', status = 'accepted', updated_at = excluded.updated_at`, newId('rel'), noteId, toType, toId, t, t)
}

export function createNote(n: CreateNote): { id: string; elapsedMs: number; aiState: string } {
  const t0 = performance.now()
  const text = n.text.trim()
  if (!text) throw new AppError('VALIDATION', 'Write something first')
  const id = newId('nt')
  const t = now()
  let anchorType = n.anchor?.type || 'none', anchorId = n.anchor?.id || null
  if (anchorType === 'none' && n.thesisId) { anchorType = 'thesis'; anchorId = n.thesisId }
  const organize = getSetting('ai.organize') !== false
  const kind: Kind = n.kind || (/\?\s*$/.test(text) ? 'question' : 'observation')
  tx(() => {
    if (anchorType !== 'none' && anchorId) {
      const table = anchorType === 'thesis' ? 'theses' : anchorType === 'company' ? 'companies' : 'firms'
      if (!one(`SELECT 1 FROM ${table} WHERE id = ?`, anchorId)) throw new AppError('NOT_FOUND', `${anchorType} not found`)
    }
    run(`INSERT INTO notes(id, kind, text, anchor_type, anchor_id, document_id, quote, kind_origin, ai_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, kind, text, anchorType, anchorId, n.documentId ?? null, n.quote ?? null, n.kindDecided || (n.kind && !organize) ? 'user' : 'ai', organize ? 'pending' : 'skipped', t, t)
    if (n.thesisId) userLink(id, 'thesis', n.thesisId)
    for (const c of n.companyIds || []) userLink(id, 'company', c)
    for (const f of n.firmIds || []) userLink(id, 'firm', f)
    if (anchorType === 'thesis' && anchorId) {
      run('UPDATE theses SET updated_at = ? WHERE id = ?', t, anchorId)
      if (kind === 'counterpoint') writeHistory('thesis', anchorId, 'note.counterpoint', null, { noteId: id, text })
    }
  })
  const elapsedMs = Math.round(performance.now() - t0)
  if (organize) enqueue('ORGANIZE_NOTE', { noteId: id }, { idempotencyKey: `organize:${id}`, priority: 3 })
  emit('object.updated', anchorId ? { type: anchorType, id: anchorId } : {})
  maybeSuggestTheses()
  return { id, elapsedMs, aiState: organize ? 'pending' : 'skipped' }
}

export function updateNote(id: string, patch: { text?: string; kind?: Kind }): void {
  const n = one<{ id: string }>('SELECT id FROM notes WHERE id = ? AND deleted_at IS NULL', id)
  if (!n) throw new AppError('NOT_FOUND', 'Note not found')
  tx(() => {
    if (patch.text !== undefined) run('UPDATE notes SET text = ?, updated_at = ? WHERE id = ?', patch.text, now(), id)
    if (patch.kind !== undefined) run("UPDATE notes SET kind = ?, kind_origin = 'user', updated_at = ? WHERE id = ?", patch.kind, now(), id)
  })
  emit('object.updated', {})
}

/** Notes are user-owned: deletion is only by the user and is soft. */
export function deleteNote(id: string): void {
  run('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', now(), now(), id)
  emit('object.updated', {})
}

/** ORGANIZE_NOTE over short handles (T1/C2/F3, never ULIDs — MEM-053); the result comes back with real ids. */
async function organize(text: string, context: string, jobId?: string): Promise<OrganizeValue> {
  const h = new Handles()
  const input = {
    text, context,
    theses: h.label('T', all<{ id: string; title: string; description: string }>('SELECT id, title, description FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL ORDER BY sort_order')),
    companies: h.label('C', all<{ id: string; name: string }>('SELECT id, name FROM companies WHERE merged_into_id IS NULL AND deleted_at IS NULL ORDER BY followed DESC, updated_at DESC LIMIT 200')),
    firms: h.label('F', all<{ id: string; name: string }>('SELECT id, name FROM firms WHERE merged_into_id IS NULL AND deleted_at IS NULL ORDER BY followed DESC, updated_at DESC LIMIT 100'))
  }
  const v = (await runTask(ORGANIZE, input, jobId ? { jobId } : undefined)).value
  return { ...v, thesisId: v.thesisId ? h.back(v.thesisId) : null, companyIds: h.backAll(v.companyIds), firmIds: h.backAll(v.firmIds) }
}

/** Live suggestion while typing (note.suggest). Nothing is persisted. */
export async function suggest(text: string, context?: { documentId?: string; thesisId?: string }): Promise<Partial<OrganizeValue> & { newThesis?: { title: string; description: string } | null }> {
  if (getSetting('ai.organize') === false || readAuth().status !== 'ok' || text.trim().length < 9) return {}
  const ctx = context?.documentId ? one<{ title: string }>('SELECT title FROM documents WHERE id = ?', context.documentId)?.title || '' : ''
  return organize(text, ctx)
}

async function organizeJob(noteId: string, jobId: string): Promise<unknown> {
  const n = one<{ id: string; text: string; kind_origin: string; document_id: string | null; anchor_type: string; anchor_id: string | null; deleted_at: number | null }>('SELECT * FROM notes WHERE id = ?', noteId)
  if (!n || n.deleted_at) return { skipped: true }
  if (getSetting('ai.organize') === false) { run("UPDATE notes SET ai_state = 'skipped' WHERE id = ?", noteId); return { skipped: true } }
  if (readAuth().status !== 'ok') throw new AppError('AI_UNAVAILABLE', 'No ChatGPT sign-in found')
  const ctx = n.document_id ? one<{ title: string }>('SELECT title FROM documents WHERE id = ?', n.document_id)?.title || '' : n.anchor_type !== 'none' ? `${n.anchor_type} note` : ''
  let v: OrganizeValue
  try { v = await organize(n.text, ctx, jobId) } catch (e) {
    if (e instanceof AppError && e.code === 'AI_UNAVAILABLE') throw e
    run("UPDATE notes SET ai_state = 'failed', updated_at = ? WHERE id = ?", now(), noteId)
    emit('object.updated', {})
    log.warn('notes', 'ORGANIZE_NOTE failed; note kept as "Not organized yet"', { noteId })
    return { failed: true }
  }
  const t = now()
  tx(() => {
    const hasUserThesis = !!one("SELECT 1 FROM relationships WHERE from_type = 'note' AND from_id = ? AND to_type = 'thesis' AND origin = 'user'", noteId)
    const sug = (toType: string, toId: string) => run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, created_at, updated_at) VALUES (?, 'note', ?, 'relates_to', ?, ?, 'ai_inference', 'suggested', ?, ?)
         ON CONFLICT(from_type, from_id, rel, to_type, to_id) DO NOTHING`, newId('rel'), noteId, toType, toId, t, t)
    if (v.thesisId && !hasUserThesis) sug('thesis', v.thesisId)
    for (const c of v.companyIds) sug('company', c)
    for (const f of v.firmIds) sug('firm', f)
    if (n.kind_origin === 'ai') run('UPDATE notes SET kind = ? WHERE id = ?', v.kind, noteId)
    if (v.newThesis && getSetting('ai.organize') !== false) run(`INSERT OR IGNORE INTO suggestions(id, type, target_type, target_id, payload_json, explanation, confidence, status, dedupe_key, created_at) VALUES (?, 'new_thesis', 'note', ?, ?, ?, 0.8, 'open', ?, ?)`,
      newId('sg'), noteId, JSON.stringify({ title: v.newThesis.title, description: v.newThesis.description, noteIds: [noteId] }), v.newThesis.description, 'thesis:' + v.newThesis.title.toLowerCase().trim(), t)
    run("UPDATE notes SET ai_state = 'organized', updated_at = ? WHERE id = ?", t, noteId)
  })
  emit('object.updated', {})
  emit('suggestion.created', {})
  return { organized: true }
}

export function retryNote(id: string): void {
  if (!one('SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NULL', id)) throw new AppError('NOT_FOUND', 'Note not found')
  run("UPDATE notes SET ai_state = 'pending', updated_at = ? WHERE id = ?", now(), id)
  enqueue('ORGANIZE_NOTE', { noteId: id }, { idempotencyKey: `organize:${id}`, priority: 2 })
}

function maybeSuggestTheses(): void {
  if (getSetting('ai.organize') === false) return
  const n = one<{ n: number }>("SELECT COUNT(*) n FROM notes WHERE deleted_at IS NULL AND created_at > COALESCE((SELECT MAX(created_at) FROM jobs WHERE type = 'SUGGEST_THESES'), 0)")!.n
  if (n >= 10) enqueue('SUGGEST_THESES', {}, { idempotencyKey: 'suggest_theses', priority: 6 })
}

async function suggestThesesJob(jobId: string): Promise<unknown> {
  if (getSetting('ai.organize') === false || readAuth().status !== 'ok') return { skipped: true }
  const notes = all<{ id: string; text: string }>(`SELECT id, text FROM notes WHERE deleted_at IS NULL AND anchor_type = 'none'
     AND id NOT IN (SELECT from_id FROM relationships WHERE from_type = 'note' AND to_type = 'thesis' AND status = 'accepted') ORDER BY created_at DESC LIMIT 50`)
  if (notes.length < 2) return { skipped: 'too few notes' }
  const theses = all<{ id: string; title: string }>('SELECT id, title FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL')
  const h = new Handles() // N1/T2, never ULIDs (MEM-053)
  const r = await runTask(SUGGEST_THESES, { notes: h.label('N', notes), theses: h.label('T', theses) }, { jobId })
  const t = now()
  for (const s of r.value.suggestions.map(x => ({ ...x, noteIds: h.backAll(x.noteIds), parentThesisId: x.parentThesisId ? h.back(x.parentThesisId) : x.parentThesisId }))) run(`INSERT OR IGNORE INTO suggestions(id, type, target_type, target_id, payload_json, explanation, confidence, status, dedupe_key, created_at) VALUES (?, 'new_thesis', NULL, NULL, ?, ?, 0.8, 'open', ?, ?)`,
    newId('sg'), JSON.stringify(s), s.description, 'thesis:' + s.title.toLowerCase().trim(), t)
  if (r.value.suggestions.length) emit('suggestion.created', {})
  return { suggestions: r.value.suggestions.length }
}

export function registerNotes(): void {
  registerJob('ORGANIZE_NOTE', job => organizeJob(String(job.payload.noteId), job.id))
  registerJob('SUGGEST_THESES', job => suggestThesesJob(job.id))
  registerMaintenance('suggest_theses', () => { enqueue('SUGGEST_THESES', {}, { idempotencyKey: 'suggest_theses', priority: 6 }); return { enqueued: true } })
}
