// User link actions (RFC §1B.13.2, M16, P-CAPTURE-004, P-FEED-007, P-CORRECT-002). User actions set
// origin 'user' + status 'accepted' (Confirm, Keep, Attach, highlight→thesis) or 'rejected' (Not related,
// Not about). Rejections are keyed on the (document, target) pair (DEC-053).
import { all, one, run, tx } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { emit } from '../events'
import { writeHistory } from '../history'
import { AppError } from '../errors'
import { upsertFeedItem } from '../feed'
import { getRel, type RelRow } from './relationships'

type Stance = 'support' | 'contra' | 'neutral'

function userAccept(fromType: string, fromId: string, rel: string, toType: string, toId: string, stance: Stance | null): string {
  const t = now()
  const ex = getRel(fromType, fromId, rel, toType, toId)
  if (ex) {
    run("UPDATE relationships SET origin = 'user', status = 'accepted', stance = COALESCE(?, stance, 'support'), confidence = 1, updated_at = ? WHERE id = ?", stance, t, ex.id)
    return ex.id
  }
  const id = newId('rel')
  run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, stance, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'user', 'accepted', ?, 1, ?, ?)`, id, fromType, fromId, rel, toType, toId, toType === 'thesis' ? stance || 'support' : stance, t, t)
  return id
}

function userReject(fromType: string, fromId: string, rel: string, toType: string, toId: string): void {
  const t = now()
  const ex = getRel(fromType, fromId, rel, toType, toId)
  if (ex) run("UPDATE relationships SET origin = 'user', status = 'rejected', updated_at = ? WHERE id = ?", t, ex.id)
  else run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'user', 'rejected', ?, ?)`, newId('rel'), fromType, fromId, rel, toType, toId, t, t)
}

/** The AI-suggested stance for (document, thesis), else Supports (M16). */
function suggestedStance(documentId: string, thesisId: string): Stance {
  const r = one<{ stance: string | null }>("SELECT stance FROM relationships WHERE from_type = 'document' AND from_id = ? AND to_type = 'thesis' AND to_id = ? AND stance IS NOT NULL", documentId, thesisId)
  return (r?.stance as Stance) || 'support'
}

function claimOf(evidenceId: string): string { return one<{ claim: string }>('SELECT claim FROM evidence WHERE id = ?', evidenceId)?.claim || '' }

function touch(documentId: string, thesisId?: string | null): void {
  upsertFeedItem(documentId)
  emit('feed.updated', { documentId })
  emit('object.updated', thesisId ? { type: 'thesis', id: thesisId } : {})
}

/** Link an evidence row to a thesis as the user (keeps it). */
function linkEvidence(evidenceId: string, thesisId: string, stance: Stance): void {
  run('UPDATE evidence SET kept = 1, updated_at = ? WHERE id = ?', now(), evidenceId)
  const before = getRel('evidence', evidenceId, 'relates_to', 'thesis', thesisId)
  userAccept('evidence', evidenceId, 'relates_to', 'thesis', thesisId, stance)
  if (!before || before.status !== 'accepted') writeHistory('thesis', thesisId, 'evidence.accepted', null, { evidenceId, stance, text: claimOf(evidenceId) })
}

/** Attach a document to a thesis (Attach ▾, Confirm): link the document and keep + link its best fact evidence. */
export function attachDocument(documentId: string, thesisId: string, stance?: Stance): { evidenceId: string | null } {
  if (!one('SELECT 1 FROM theses WHERE id = ?', thesisId)) throw new AppError('NOT_FOUND', 'Thesis not found')
  const st = stance || suggestedStance(documentId, thesisId)
  let evidenceId: string | null = null
  tx(() => {
    userAccept('document', documentId, 'relates_to', 'thesis', thesisId, st)
    const suggested = one<{ id: string }>(`SELECT e.id FROM relationships r JOIN evidence e ON e.id = r.from_id WHERE r.from_type = 'evidence' AND r.to_type = 'thesis' AND r.to_id = ?
       AND e.document_id = ? AND e.status = 'active' AND r.status IN ('suggested','accepted') ORDER BY r.confidence DESC, e.confidence DESC LIMIT 1`, thesisId, documentId)
    const best = suggested || one<{ id: string }>("SELECT id FROM evidence WHERE document_id = ? AND status = 'active' AND assertion = 'fact' ORDER BY confidence DESC, quote_start LIMIT 1", documentId)
      || one<{ id: string }>("SELECT id FROM evidence WHERE document_id = ? AND status = 'active' ORDER BY confidence DESC, quote_start LIMIT 1", documentId)
    if (best) { linkEvidence(best.id, thesisId, st); evidenceId = best.id }
  })
  touch(documentId, thesisId)
  return { evidenceId }
}

export function confirmLink(relId: string): void {
  const r = one<RelRow>('SELECT * FROM relationships WHERE id = ?', relId)
  if (!r) throw new AppError('NOT_FOUND', 'Link not found')
  if (r.to_type !== 'thesis') throw new AppError('VALIDATION', 'Only thesis links can be confirmed')
  if (r.from_type === 'document') { attachDocument(r.from_id, r.to_id, (r.stance as Stance) || undefined); return }
  if (r.from_type === 'evidence') {
    const doc = one<{ document_id: string }>('SELECT document_id FROM evidence WHERE id = ?', r.from_id)!
    tx(() => { linkEvidence(r.from_id, r.to_id, (r.stance as Stance) || 'support'); userAccept('document', doc.document_id, 'relates_to', 'thesis', r.to_id, (r.stance as Stance) || 'support') })
    touch(doc.document_id, r.to_id)
    return
  }
  tx(() => userAccept(r.from_type, r.from_id, r.rel, r.to_type, r.to_id, (r.stance as Stance) || null))
  emit('object.updated', { type: 'thesis', id: r.to_id })
}

/** Change… : a different thesis (the suggestion was wrong → reject it, attach elsewhere) or a different stance. */
export function changeLink(relId: string, thesisId: string, stance: Stance): void {
  const r = one<RelRow>('SELECT * FROM relationships WHERE id = ?', relId)
  if (!r) throw new AppError('NOT_FOUND', 'Link not found')
  const documentId = r.from_type === 'document' ? r.from_id : r.from_type === 'evidence' ? one<{ document_id: string }>('SELECT document_id FROM evidence WHERE id = ?', r.from_id)?.document_id : null
  if (r.to_id === thesisId) {
    tx(() => {
      if (r.from_type === 'evidence') linkEvidence(r.from_id, thesisId, stance)
      userAccept(r.from_type, r.from_id, r.rel, 'thesis', thesisId, stance)
      run("UPDATE relationships SET stance = ? WHERE id = ?", stance, r.id)
      writeHistory('thesis', thesisId, 'evidence.stance_changed', { stance: r.stance }, { stance, relId })
    })
    if (documentId) touch(documentId, thesisId)
    return
  }
  if (!documentId) throw new AppError('VALIDATION', 'This link can’t be moved')
  tx(() => rejectDocPair(documentId, r.to_id))
  attachDocument(documentId, thesisId, stance)
}

function rejectDocPair(documentId: string, thesisId: string): void {
  userReject('document', documentId, 'relates_to', 'thesis', thesisId)
  for (const e of all<{ id: string }>("SELECT r.id FROM relationships r JOIN evidence e ON e.id = r.from_id WHERE r.from_type = 'evidence' AND e.document_id = ? AND r.to_type = 'thesis' AND r.to_id = ?", documentId, thesisId))
    run("UPDATE relationships SET origin = 'user', status = 'rejected', updated_at = ? WHERE id = ?", now(), e.id)
}

/** Not related / Remove from thesis. */
export function rejectLink(relId: string): void {
  const r = one<RelRow>('SELECT * FROM relationships WHERE id = ?', relId)
  if (!r) throw new AppError('NOT_FOUND', 'Link not found')
  if (r.from_type === 'document' || r.from_type === 'evidence') {
    const documentId = r.from_type === 'document' ? r.from_id : one<{ document_id: string }>('SELECT document_id FROM evidence WHERE id = ?', r.from_id)!.document_id
    tx(() => { rejectDocPair(documentId, r.to_id); writeHistory(r.to_type, r.to_id, 'link.rejected', { relId }, { documentId }) })
    touch(documentId, r.to_type === 'thesis' ? r.to_id : null)
    return
  }
  tx(() => userReject(r.from_type, r.from_id, r.rel, r.to_type, r.to_id))
  emit('object.updated', { type: r.to_type, id: r.to_id })
}

/** "Not about <company>": reject the document→entity pair and every evidence→entity row of that document. */
export function rejectEntity(documentId: string, entityType: string, entityId: string): void {
  tx(() => {
    const rows = all<{ id: string }>("SELECT id FROM relationships WHERE from_type = 'document' AND from_id = ? AND to_type = ? AND to_id = ? AND rel IN ('mentions','about')", documentId, entityType, entityId)
    if (rows.length) for (const x of rows) run("UPDATE relationships SET origin = 'user', status = 'rejected', updated_at = ? WHERE id = ?", now(), x.id)
    else userReject('document', documentId, 'mentions', entityType, entityId)
    for (const x of all<{ id: string }>("SELECT r.id FROM relationships r JOIN evidence e ON e.id = r.from_id WHERE r.from_type = 'evidence' AND e.document_id = ? AND r.to_type = ? AND r.to_id = ?", documentId, entityType, entityId))
      run("UPDATE relationships SET origin = 'user', status = 'rejected', updated_at = ? WHERE id = ?", now(), x.id)
    writeHistory(entityType, entityId, 'link.rejected', null, { documentId })
  })
  touch(documentId)
}

export function keepEvidence(evidenceId: string, thesisId?: string, stance?: Stance): void {
  const e = one<{ document_id: string; status: string }>('SELECT document_id, status FROM evidence WHERE id = ?', evidenceId)
  if (!e) throw new AppError('NOT_FOUND', 'Evidence not found')
  tx(() => {
    run('UPDATE evidence SET kept = 1, updated_at = ? WHERE id = ?', now(), evidenceId)
    if (thesisId) {
      const st = stance || (one<{ stance: string }>("SELECT stance FROM relationships WHERE from_type = 'evidence' AND from_id = ? AND to_type = 'thesis' AND to_id = ?", evidenceId, thesisId)?.stance as Stance) || suggestedStance(e.document_id, thesisId)
      linkEvidence(evidenceId, thesisId, st)
      userAccept('document', e.document_id, 'relates_to', 'thesis', thesisId, st)
    }
  })
  touch(e.document_id, thesisId)
}

/** Save a passage as user evidence with exact offsets (P-CAPTURE-004). */
export function highlight(documentId: string, start: number, end: number, o: { thesisId?: string; companyId?: string }): { evidenceId: string } {
  const d = one<{ text: string; current_version: number }>('SELECT text, current_version FROM documents WHERE id = ? AND deleted_at IS NULL', documentId)
  if (!d) throw new AppError('NOT_FOUND', 'Document not found')
  if (start < 0 || end > d.text.length || end - start < 6) throw new AppError('VALIDATION', 'Select at least a few words')
  const quote = d.text.slice(start, end)
  const id = newId('ev')
  const t = now()
  tx(() => {
    run(`INSERT INTO evidence(id, document_id, document_version, origin, kind, assertion, claim, quote, quote_start, quote_end, payload_json, is_novel, confidence, kept, status, created_at, updated_at)
         VALUES (?, ?, ?, 'user_highlight', 'other', 'fact', ?, ?, ?, ?, '{}', 0, 1, 1, 'active', ?, ?)`, id, documentId, d.current_version, quote, quote, start, end, t, t)
    if (o.thesisId) {
      const st = suggestedStance(documentId, o.thesisId)
      linkEvidence(id, o.thesisId, st)
      userAccept('document', documentId, 'relates_to', 'thesis', o.thesisId, st)
    }
    if (o.companyId) {
      userAccept('evidence', id, 'about', 'company', o.companyId, null)
      userAccept('document', documentId, 'mentions', 'company', o.companyId, null)
    }
    run('UPDATE feed_items SET saved_at = COALESCE(saved_at, ?), updated_at = ? WHERE document_id = ?', t, t, documentId)
  })
  touch(documentId, o.thesisId)
  return { evidenceId: id }
}

/** link.attach from any supported origin. */
export function attach(fromType: string, fromId: string, thesisId: string, stance?: Stance): unknown {
  if (fromType === 'feed_item') {
    const f = one<{ document_id: string }>('SELECT document_id FROM feed_items WHERE id = ?', fromId)
    if (!f) throw new AppError('NOT_FOUND', 'Item not found')
    return attachDocument(f.document_id, thesisId, stance)
  }
  if (fromType === 'document') return attachDocument(fromId, thesisId, stance)
  if (fromType === 'evidence') { keepEvidence(fromId, thesisId, stance); return { evidenceId: fromId } }
  if (!one('SELECT 1 FROM theses WHERE id = ?', thesisId)) throw new AppError('NOT_FOUND', 'Thesis not found')
  const id = tx(() => { const rid = userAccept(fromType, fromId, 'relates_to', 'thesis', thesisId, stance || null); writeHistory('thesis', thesisId, 'link.attached', null, { fromType, fromId }); return rid })
  emit('object.updated', { type: 'thesis', id: thesisId })
  return { relId: id }
}
