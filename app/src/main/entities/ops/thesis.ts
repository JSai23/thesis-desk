// Thesis operations: create, update (rename/description/view/conviction), move, archive, merge (DEC-094).
// The row-level work stays in theses/index.ts (user-owned text, LAW-04); merge lives here on the shared primitives.
import { z } from 'zod'
import { all, one, run } from '../../db'
import { now } from '../../clock'
import { AppError } from '../../errors'
import { getSetting, setSetting } from '../../settings'
import { queueMatch } from '../../theses/match'
import { TEST_MODE } from '../../env'
import { archiveThesis, createThesis, descendants, getThesis, moveThesis, updateThesis } from '../../theses'
import { defineOp, type HistoryRow } from './types'
import { audit, moveEnds, moveNotes, nameOf, replaceInList } from './primitives'

const id = z.string().min(1)
/** Queue MATCH_THESIS (a match already queued picks up the latest words when it runs). */
// a short delay so typing in the title/description settles first (the page saves as you type)
const matchSoon = (tid: string) => queueMatch(tid, TEST_MODE ? 0 : 15_000)
const title = (tid: string | null | undefined) => (tid ? `“${nameOf('thesis', tid)}”` : 'the top level')
const liveThesis = (tid: string) => one<{ id: string }>('SELECT id FROM theses WHERE id = ? AND merged_into_id IS NULL', tid)
const thesisId = (typeOf: (x: string | null) => string | null, x: string | null, slot = 'objectId') => {
  if (!x || typeOf(x) !== 'thesis') throw `${slot} must be a listed thesis id`
  return x
}

export const create = defineOp({
  name: 'thesis.create',
  input: z.object({ parentId: z.string().nullish(), title: z.string().optional(), description: z.string().optional() }),
  validate: i => (i.parentId && !liveThesis(i.parentId) ? [new AppError('NOT_FOUND', 'Parent thesis not found')] : []),
  describe: i => `Create thesis “${(i.title || '').trim() || 'Untitled thesis'}”${i.parentId ? ` under ${title(i.parentId)}` : ''}?`,
  apply: (i, cs) => {
    const th = createThesis(i.parentId ?? null, i.title, 'user', i.description || '')
    cs.touch('thesis', th.id)
    // a named thesis is matched against the facts already stored (DEC-099); "Untitled thesis" waits for a title
    if ((i.title || '').trim()) matchSoon(th.id)
    return th
  },
  chat: {
    action: 'create_thesis',
    line: 'the user states a new thesis to track: value = its title as the user wrote it, parentId = a listed thesis it belongs under, or null.',
    toInput: (s, typeOf) => {
      if (!s.value?.trim()) throw 'create_thesis needs value (the title)'
      return { title: s.value.trim(), parentId: s.parentId ? thesisId(typeOf, s.parentId, 'parentId') : null }
    }
  }
})

const patch = z.object({ title: z.string().optional(), description: z.string().optional(), currentView: z.string().optional(), conviction: z.number().int().min(1).max(5).optional(), watching: z.boolean().optional() })
/** Undo of one thesis.update history row, refused when the field changed again since. */
const revertField = (field: 'title' | 'description' | 'currentView' | 'conviction', col: string) => (h: HistoryRow) => {
  const cur = getThesis(h.entity_id) as any
  if (!cur) return 'The thesis no longer exists'
  if (cur[col] !== h.after[field]) return 'It was changed again since'
  return { op: 'thesis.update', input: { id: h.entity_id, patch: { [field]: h.before[field] } } }
}
export const update = defineOp({
  name: 'thesis.update',
  input: z.object({ id, patch }),
  validate: i => {
    if (!getThesis(i.id)) return [new AppError('NOT_FOUND', 'Thesis not found')]
    if (i.patch.title !== undefined && !i.patch.title.trim()) return ['Give the thesis a title']
    return []
  },
  describe: i => (i.patch.title !== undefined && Object.keys(i.patch).length === 1 ? `Rename thesis ${title(i.id)} to “${i.patch.title.trim()}”?` : `Update thesis ${title(i.id)}?`),
  apply: (i, cs) => {
    cs.touch('thesis', i.id)
    const before = getThesis(i.id)!
    const th = updateThesis(i.id, i.patch.title !== undefined ? { ...i.patch, title: i.patch.title.trim() } : i.patch)
    // new words, new matches against the facts already stored (DEC-099)
    if (th.title !== before.title || th.description !== before.description) matchSoon(i.id)
    return th
  },
  undo: {
    'thesis.renamed': revertField('title', 'title'),
    'thesis.description': revertField('description', 'description'),
    'thesis.view_revised': revertField('currentView', 'current_view'),
    'thesis.conviction': revertField('conviction', 'conviction')
  },
  chat: {
    action: 'rename_thesis',
    line: 'rename a listed thesis: objectId = the thesis, value = the new title as the user wrote it.',
    toInput: (s, typeOf) => {
      if (!s.value?.trim()) throw 'rename_thesis needs value (the new title)'
      return { id: thesisId(typeOf, s.objectId), patch: { title: s.value.trim() } }
    }
  }
})

export const move = defineOp({
  name: 'thesis.move',
  input: z.object({ id, parentId: z.string().nullable() }),
  validate: i => {
    if (!getThesis(i.id)) return [new AppError('NOT_FOUND', 'Thesis not found')]
    if (i.parentId && !getThesis(i.parentId)) return [new AppError('NOT_FOUND', 'Parent thesis not found')]
    if (i.parentId && descendants(i.id).includes(i.parentId)) return [new AppError('CONFLICT', 'A thesis can’t be moved under itself or one of its children')]
    return []
  },
  describe: i => `Move ${title(i.id)} ${i.parentId ? `under ${title(i.parentId)}` : 'to the top level'}?`,
  apply: (i, cs) => { cs.touch('thesis', i.id); return moveThesis(i.id, i.parentId) },
  undo: {
    'thesis.moved': h => {
      const cur = getThesis(h.entity_id)
      if (!cur) return 'The thesis no longer exists'
      if ((cur.parent_id ?? null) !== (h.after.parentId ?? null)) return 'It was moved again since'
      return { op: 'thesis.move', input: { id: h.entity_id, parentId: h.before.parentId ?? null } }
    }
  },
  chat: {
    action: 'move_thesis',
    line: 'objectId thesis moves under parentId thesis (null = top level).',
    toInput: (s, typeOf) => ({ id: thesisId(typeOf, s.objectId), parentId: s.parentId ? thesisId(typeOf, s.parentId, 'parentId') : null })
  }
})

export const archive = defineOp({
  name: 'thesis.archive',
  input: z.object({ id, archived: z.boolean() }),
  validate: i => (getThesis(i.id) ? [] : [new AppError('NOT_FOUND', 'Thesis not found')]),
  describe: i => `${i.archived ? 'Archive' : 'Unarchive'} thesis ${title(i.id)}?`,
  apply: (i, cs) => { archiveThesis(i.id, i.archived); cs.touch('thesis', i.id); return { ok: true } },
  undo: {
    'thesis.archived': h => ({ op: 'thesis.archive', input: { id: h.entity_id, archived: false } }),
    'thesis.unarchived': h => ({ op: 'thesis.archive', input: { id: h.entity_id, archived: true } })
  },
  chat: {
    action: 'archive_thesis',
    line: "archive a listed thesis the user is done with: objectId; value = 'unarchive' when they want an archived one back.",
    toInput: (s, typeOf) => ({ id: thesisId(typeOf, s.objectId), archived: !/^un/i.test(s.value || '') })
  }
})

/** Merge (irreversible, §1B.13.4): children reparented, links/notes/feed primary thesis moved, `from` archived as merged;
 *  its current view is kept as a "Merged view" event on `into`, never appended to its text (LAW-04). */
export const merge = defineOp({
  name: 'thesis.merge',
  input: z.object({ fromId: id, intoId: id }),
  validate: i => {
    if (i.fromId === i.intoId) return ['Pick two different theses']
    const into = liveThesis(i.intoId)
    if (!liveThesis(i.fromId) || !into) return [new AppError('NOT_FOUND', 'Thesis not found')]
    let p = getThesis(i.intoId)!.parent_id
    while (p) { if (p === i.fromId) return [new AppError('CONFLICT', 'A thesis can’t be merged into one of its own children')]; p = getThesis(p)?.parent_id ?? null }
    return []
  },
  describe: i => `Merge thesis ${title(i.fromId)} into ${title(i.intoId)}?`,
  apply: (i, cs) => {
    const from = getThesis(i.fromId)!
    const t = now()
    cs.doc(...all<{ document_id: string }>('SELECT document_id FROM feed_items WHERE primary_thesis_id = ?', i.fromId).map(r => r.document_id))
    run('UPDATE theses SET parent_id = ?, updated_at = ? WHERE parent_id = ?', i.intoId, t, i.fromId)
    moveEnds('thesis', i.fromId, 'thesis', i.intoId)
    moveNotes('thesis', i.fromId, 'thesis', i.intoId)
    run('UPDATE feed_items SET primary_thesis_id = ? WHERE primary_thesis_id = ?', i.intoId, i.fromId)
    run('UPDATE theses SET merged_into_id = ?, archived_at = ?, updated_at = ? WHERE id = ?', i.intoId, t, t, i.fromId)
    replaceInList(() => getSetting<string[]>('pins.theses') || [], v => setSetting('pins.theses', v), i.fromId, i.intoId)
    audit('thesis', i.intoId, 'thesis.merged_view', null, { fromId: i.fromId, fromTitle: from.title, fromView: from.current_view })
    audit('thesis', i.fromId, 'merge', { title: from.title }, { into: i.intoId })
    cs.touch('thesis', i.intoId).touch('thesis', i.fromId).feed = true
    return { ok: true, id: i.intoId }
  },
  chat: {
    action: 'merge_theses',
    line: 'fromId thesis merges into intoId thesis (both listed theses).',
    toInput: (s, typeOf) => {
      if (!s.fromId || !s.intoId || s.fromId === s.intoId) throw 'merge needs two different ids'
      return { fromId: thesisId(typeOf, s.fromId, 'fromId'), intoId: thesisId(typeOf, s.intoId, 'intoId') }
    }
  }
})

export const THESIS_OPS = [create, update, move, archive, merge]
