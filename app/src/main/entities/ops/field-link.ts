// Field and link operations (DEC-094): thin registry entries over entities/fields.ts (precedence, LAW-06) and
// entities/links.ts (user link decisions, DEC-053), so chat, IPC and undo reach them through one path.
import { z } from 'zod'
import { all, one, run } from '../../db'
import { now } from '../../clock'
import { AppError } from '../../errors'
import { currentValue, fieldDef, revertValue, setUserValue } from '../fields'
import { attach as attachLink, rejectEntity, rejectLink } from '../links'
import { defineOp } from './types'
import { audit, liveRow, nameOf, type NodeType } from './primitives'

const id = z.string().min(1)
const pageType = z.enum(['company', 'firm', 'thesis'])
const label = (t: string, key: string) => fieldDef(t, key)?.label.toLowerCase() || key
const live = (t: NodeType, x: string) => !!liveRow(t, x)
const objectOf = (typeOf: (x: string | null) => NodeType | null, s: { objectId: string | null }) => {
  const t = typeOf(s.objectId)
  if (!s.objectId || !t || t === 'person') throw 'objectId must be a listed company, firm or thesis'
  return { objectType: t as 'company' | 'firm' | 'thesis', objectId: s.objectId }
}
const keyOf = (k: string | null) => (k || '').replace(/^(company|firm|thesis|person)\./, '')   // "company.stage" → "stage"

export const set = defineOp({
  name: 'field.set',
  input: z.object({ objectType: pageType, objectId: id, key: z.string(), value: z.string() }),
  validate: i => {
    if (!live(i.objectType, i.objectId)) return [new AppError('NOT_FOUND', 'Not found')]
    if (!fieldDef(i.objectType, i.key)) return [new AppError('NOT_FOUND', `Unknown field ${i.key}`)]
    return []
  },
  describe: i => `Set ${nameOf(i.objectType, i.objectId)} ${label(i.objectType, i.key)} to ${i.value}?`,
  apply: (i, cs) => { setUserValue(i.objectType, i.objectId, i.key, i.value); cs.touch(i.objectType, i.objectId).docsOf(i.objectType, i.objectId); return { ok: true } },
  undo: {
    'field.corrected': h => {
      const cur = currentValue(h.entity_type, h.entity_id, h.after.key)
      if (!cur || cur.origin !== 'user' || cur.display !== h.after.value) return 'The value was changed again since'
      return h.before?.origin === 'user' && h.before.value != null
        ? { op: 'field.set', input: { objectType: h.entity_type, objectId: h.entity_id, key: h.after.key, value: h.before.value } }
        : { op: 'field.revert', input: { objectType: h.entity_type, objectId: h.entity_id, key: h.after.key } }
    }
  },
  chat: {
    action: 'set_field',
    line: 'objectType/objectId (from candidates or theses), key (from the field catalog for that type), value (valid for the field; enum values exactly as listed).',
    toInput: (s, typeOf) => {
      if (!s.key || s.value == null || !String(s.value).trim()) throw 'set_field needs objectId, key and value'
      return { ...objectOf(typeOf, s), key: keyOf(s.key), value: String(s.value).trim() }
    }
  }
})

export const revert = defineOp({
  name: 'field.revert',
  input: z.object({ objectType: pageType, objectId: id, key: z.string() }),
  validate: i => (live(i.objectType, i.objectId) ? [] : [new AppError('NOT_FOUND', 'Not found')]),
  describe: i => `Use what the sources say for ${nameOf(i.objectType, i.objectId)} ${label(i.objectType, i.key)} again?`,
  apply: (i, cs) => { revertValue(i.objectType, i.objectId, i.key); cs.touch(i.objectType, i.objectId).docsOf(i.objectType, i.objectId); return { ok: true } },
  undo: {
    'field.reverted': h => (h.before?.origin === 'user' && h.before.value != null
      ? { op: 'field.set', input: { objectType: h.entity_type, objectId: h.entity_id, key: h.before.key, value: h.before.value } }
      : 'There was no value of yours to put back')
  },
  chat: {
    action: 'revert_field',
    line: 'the user wants a field back to what the sources say (drop their own value): objectType/objectId, key.',
    toInput: (s, typeOf) => {
      if (!s.key) throw 'revert_field needs objectId and key'
      return { ...objectOf(typeOf, s), key: keyOf(s.key) }
    }
  }
})

const rejectIn = z.union([
  z.object({ relId: id }),
  z.object({ documentId: id, entityType: z.enum(['company', 'firm', 'person']), entityId: id }),
  z.object({ objectType: z.string().nullish(), objectId: id, relatedType: z.enum(['company', 'firm', 'thesis']), relatedId: id })
])
/** "Not related" — a relationship by id, a document ↔ entity pair ("Not about X"), or any two objects (chat). */
export const reject = defineOp({
  name: 'link.reject',
  input: rejectIn,
  validate: i => ('relId' in i && !one('SELECT 1 FROM relationships WHERE id = ?', i.relId) ? [new AppError('NOT_FOUND', 'Link not found')] : []),
  describe: i => ('relId' in i ? 'Mark this link as not related?'
    : 'documentId' in i ? `This article is not about ${nameOf(i.entityType, i.entityId)}?`
      : `${i.objectType && i.objectType in { company: 1, firm: 1, thesis: 1 } ? nameOf(i.objectType as NodeType, i.objectId) : 'This'} is not related to ${nameOf(i.relatedType, i.relatedId)}?`),
  apply: (i, cs) => {
    if ('relId' in i) {
      const r = one<{ from_type: string; from_id: string; to_type: string; to_id: string }>('SELECT from_type, from_id, to_type, to_id FROM relationships WHERE id = ?', i.relId)!
      rejectLink(i.relId)   // writes history for document/evidence links
      if (r.from_type !== 'document' && r.from_type !== 'evidence') audit(r.to_type, r.to_id, 'link.rejected', { relId: i.relId }, { fromType: r.from_type, fromId: r.from_id })
      cs.touch(r.to_type, r.to_id)
      return { ok: true }
    }
    if ('documentId' in i) { rejectEntity(i.documentId, i.entityType, i.entityId); cs.touch(i.entityType, i.entityId).doc(i.documentId); return { ok: true } }
    const t = now()
    const rows = all<{ id: string; status: string }>('SELECT id, status FROM relationships WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))', i.objectId, i.relatedId, i.relatedId, i.objectId)
    for (const r of rows) run("UPDATE relationships SET origin = 'user', status = 'rejected', updated_at = ? WHERE id = ?", t, r.id)
    if (!rows.length && one('SELECT 1 FROM documents WHERE id = ?', i.objectId)) rejectEntity(i.objectId, i.relatedType, i.relatedId)
    audit(i.objectType || 'object', i.objectId, 'link.rejected', { statuses: rows }, { relatedType: i.relatedType, relatedId: i.relatedId })
    cs.touch(i.relatedType, i.relatedId)
    if (i.objectType) cs.touch(i.objectType, i.objectId)
    return { ok: true }
  },
  chat: {
    action: 'reject_relation',
    line: 'objectId is not related to relatedType/relatedId (e.g. a company is not part of a thesis, a firm did not invest in a company).',
    toInput: (s, typeOf) => {
      if (!s.objectId || !s.relatedId || !s.relatedType) throw 'reject_relation needs objectId, relatedType and relatedId'
      return { objectType: typeOf(s.objectId), objectId: s.objectId, relatedType: s.relatedType as 'company' | 'firm' | 'thesis', relatedId: s.relatedId }
    }
  }
})

const stance = z.enum(['support', 'contra', 'neutral'])
export const attach = defineOp({
  name: 'link.attach',
  input: z.object({ fromType: z.enum(['document', 'evidence', 'feed_item', 'company', 'firm', 'note']), fromId: id, thesisId: id, stance: stance.optional() }),
  validate: i => (one('SELECT 1 FROM theses WHERE id = ? AND merged_into_id IS NULL', i.thesisId) ? [] : [new AppError('NOT_FOUND', 'Thesis not found')]),
  describe: i => `Link ${i.fromType === 'company' || i.fromType === 'firm' ? nameOf(i.fromType, i.fromId) : `this ${i.fromType.replace('_', ' ')}`} to thesis “${nameOf('thesis', i.thesisId)}”?`,
  apply: (i, cs) => { const r = attachLink(i.fromType, i.fromId, i.thesisId, i.stance); cs.touch('thesis', i.thesisId); return r },
  chat: {
    action: 'attach_thesis',
    line: 'a listed company or firm belongs to / is relevant to a listed thesis: objectId = the company or firm, relatedType = "thesis", relatedId = the thesis.',
    toInput: (s, typeOf) => {
      const t = typeOf(s.objectId)
      if (!s.objectId || (t !== 'company' && t !== 'firm')) throw 'attach_thesis needs objectId = a listed company or firm'
      if (!s.relatedId || typeOf(s.relatedId) !== 'thesis') throw 'attach_thesis needs relatedId = a listed thesis'
      return { fromType: t, fromId: s.objectId, thesisId: s.relatedId }
    }
  }
})

export const FIELD_LINK_OPS = [set, revert, reject, attach]
