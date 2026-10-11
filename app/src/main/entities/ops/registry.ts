// The ontology operation registry and its single dispatch path: runOp (IPC ontology.apply, the legacy command
// aliases, chat corrections) and undoHistory (IPC ontology.undo). See ./index.ts for how to add an operation.
import { all, one, tx } from '../../db'
import { AppError } from '../../errors'
import { writeHistory } from '../../history'
import { ENTITY_OPS } from './entity'
import { THESIS_OPS } from './thesis'
import { FIELD_LINK_OPS } from './field-link'
import { REPAIR_OPS } from './repair'
import { DETAIL_OPS } from './details'
import { ChangeSet, afterChange, typeOfId } from './primitives'
import type { HistoryRow, Inverse, OpDef, Slots } from './types'

export const OPS: Record<string, OpDef> = Object.fromEntries([...ENTITY_OPS, ...REPAIR_OPS, ...THESIS_OPS, ...FIELD_LINK_OPS, ...DETAIL_OPS].map(o => [o.name, o as OpDef]))
/** Chat action name (CORRECT_OBJECT) → op. */
export const CHAT: Record<string, OpDef> = Object.fromEntries(Object.values(OPS).filter(o => o.chat).map(o => [o.chat!.action, o]))
/** history action → the op that knows how to reverse it. */
const UNDO: Record<string, OpDef> = Object.fromEntries(Object.values(OPS).flatMap(o => Object.keys(o.undo || {}).map(a => [a, o])))

export interface OpResult<R = unknown> { op: string; result: R; message: string; historyIds: string[]; undo: { historyIds: string[] } | null }

function getOp(name: string): OpDef {
  const op = OPS[name]
  if (!op) throw new AppError('VALIDATION', `Unknown operation ${name}`)
  return op
}

/** Parse + validate; throws the first problem (AppErrors keep their code, strings are VALIDATION). */
export function checkOp(name: string, raw: unknown): { op: OpDef; input: any } {
  const op = getOp(name)
  const parsed = op.input.safeParse(raw ?? {})
  if (!parsed.success) throw new AppError('VALIDATION', parsed.error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; '))
  const problems = op.validate?.(parsed.data) || []
  if (problems.length) throw typeof problems[0] === 'string' ? new AppError('VALIDATION', problems[0]) : problems[0]
  return { op, input: parsed.data }
}

const historyMark = () => one<{ m: number | null }>('SELECT MAX(rowid) m FROM history')?.m ?? 0

/** Apply one operation: validate, run in one transaction, then invalidate caches / refresh feed items / emit events. */
export function runOp<R = unknown>(name: string, raw: unknown): OpResult<R> {
  const { op, input } = checkOp(name, raw)
  const message = op.describe(input).replace(/\?$/, '')
  const cs = new ChangeSet()
  const mark = historyMark()
  const result = tx(() => op.apply(input, cs)) as R
  afterChange(cs)
  const rows = all<{ id: string; action: string }>('SELECT id, action FROM history WHERE rowid > ? ORDER BY rowid', mark)
  const undoable = rows.filter(r => UNDO[r.action] && typeof inverseOf(r.id) !== 'string').map(r => r.id)
  return { op: name, result, message, historyIds: rows.map(r => r.id), undo: undoable.length ? { historyIds: undoable } : null }
}

const isUndone = (historyId: string) => !!one("SELECT 1 FROM history WHERE action = 'undo' AND json_extract(after_json, '$.undoOf') = ?", historyId)

function historyRow(id: string): HistoryRow {
  const r = one<any>('SELECT * FROM history WHERE id = ?', id)
  if (!r) throw new AppError('NOT_FOUND', 'Nothing to undo')
  return { ...r, before: r.before_json ? JSON.parse(r.before_json) : null, after: r.after_json ? JSON.parse(r.after_json) : null }
}

/** The inverse operation of a history row, or the reason it can't be undone. */
export function inverseOf(historyId: string): Inverse | string {
  const h = historyRow(historyId)
  const op = UNDO[h.action]
  if (!op) return h.action === 'merge' ? 'Merges can’t be undone' : 'This change can’t be undone'
  if (isUndone(historyId)) return 'Already undone'
  return op.undo![h.action](h)
}

/** Undo history rows (newest first) through their inverse ops, all in one transaction; each undo is audited. */
export function undoHistory(historyIds: string[]): { ok: true; message: string; results: OpResult[] } {
  const results = tx(() => [...historyIds].reverse().map(hid => {
    const inv = inverseOf(hid)
    if (typeof inv === 'string') throw new AppError('CONFLICT', inv)
    const r = runOp(inv.op, inv.input)
    const h = historyRow(hid)
    writeHistory(h.entity_type, h.entity_id, 'undo', { action: h.action }, { undoOf: hid, op: inv.op, historyIds: r.historyIds })
    return r
  }))
  return { ok: true, message: 'Undone', results }
}

export function listOps(): { name: string; chatAction: string | null; undoes: string[] }[] {
  return Object.values(OPS).filter(o => !o.internal).map(o => ({ name: o.name, chatAction: o.chat?.action ?? null, undoes: Object.keys(o.undo || {}) }))
}

// ---------------------------------------------------------------- chat (CORRECT_OBJECT) ↔ registry
export const chatLines = (): { action: string; line: string }[] => Object.values(CHAT).map(o => ({ action: o.chat!.action, line: o.chat!.line }))

/** Model slots → { op, input }; throws a string problem (fed back to the model) when the slots don't fit the op. */
export function chatToOp(s: Slots): { op: string; input: unknown } {
  const op = CHAT[s.action]
  if (!op) throw `unknown action ${s.action}`
  const input = op.chat!.toInput(s, typeOfId)
  const parsed = op.input.safeParse(input)
  if (!parsed.success) throw `${s.action}: ${parsed.error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; ')}`
  return { op: op.name, input: parsed.data }
}
