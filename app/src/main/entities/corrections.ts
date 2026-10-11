// Chat corrections and suggestion resolution (RFC FLOW-I, §1B.13.4, P-CORRECT-001..004). The changes themselves are
// ontology operations (entities/ops, DEC-094): `correct.parse` asks CORRECT_OBJECT for one registry action and returns
// {op, input, confirmText}; `correct.apply` runs it through the same runOp as every other caller. Nothing is applied
// without the user's ↵ on the confirm row.
import { all, one, run, json } from '../db'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { TABLE, type EntityType } from './resolve'
import { resolveProposal, activeFieldDefs } from './fields'
import { createThesis } from '../theses'
import { runTask } from '../ai/runtime'
import { correctTask, type CorrectValue } from '../ai/tasks/think'
import { OPS, runOp, chatLines, chatToOp, checkOp, type OpResult } from './ops'

// ---------------------------------------------------------------- thin wrappers (older call sites)
export const mergeEntities = (type: EntityType, fromId: string, intoId: string): void => { runOp('entity.merge', { type, fromId, intoId }) }
export const mergeTheses = (fromId: string, intoId: string): void => { runOp('thesis.merge', { fromId, intoId }) }
export const splitEntity = (type: EntityType, id: string, newName: string) => runOp<{ id: string; moved: number; reread: number }>('entity.split', { type, id, newName }).result
export const retypeEntity = (fromType: 'company' | 'firm', id: string) => runOp<{ type: 'company' | 'firm'; id: string }>('entity.changeType', { type: fromType, id }).result

// ---------------------------------------------------------------- NL corrections
export type Proposal = CorrectValue & { op: string | null; input: unknown }
let task: ReturnType<typeof correctTask> | null = null
const correct = () => (task ??= correctTask(chatLines(), o => { try { chatToOp(o); return [] } catch (e) { if (typeof e === 'string') return [e]; throw e } }))

export async function parseCorrection(text: string): Promise<Proposal> {
  const words = text.toLowerCase()
  // a name counts only as whole words ("A" or "Ai" must not match inside every sentence)
  const named = (n: string) => { const k = n.toLowerCase().trim(); return k.length >= 2 && new RegExp(`(^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(words) }
  const candidates: { type: string; id: string; name: string; deleted?: boolean; m?: number }[] = []
  for (const type of ['company', 'firm', 'person'] as EntityType[]) {
    for (const e of all<{ id: string; name: string; normalized_name: string; deleted_at: number | null }>(`SELECT id, name, normalized_name, deleted_at FROM ${TABLE[type]} WHERE merged_into_id IS NULL`))
      if (e.normalized_name && (named(e.name) || named(e.normalized_name)))
        candidates.push({ type, id: e.id, name: e.name, m: named(e.name) ? e.name.length : e.normalized_name.length, ...(e.deleted_at ? { deleted: true } : {}) })
    for (const a of all<{ entity_id: string; alias: string }>('SELECT entity_id, alias FROM aliases WHERE entity_type = ?', type))
      if (named(a.alias)) {
        const have = candidates.find(c => c.id === a.entity_id)
        if (have) { have.m = Math.max(have.m || 0, a.alias.length); continue }
        const e = one<any>(`SELECT id, name FROM ${TABLE[type]} WHERE id = ? AND merged_into_id IS NULL AND deleted_at IS NULL`, a.entity_id)
        if (e) candidates.push({ type, id: e.id, name: e.name, m: a.alias.length })
      }
  }
  // live candidates first (a deleted one only matters for "restore"), then the most specific match: in a large library
  // short incidental matches must not push the entity the user named past the cut ("Titanium Ventures" vs "Telstra")
  candidates.sort((a, b) => Number(!!a.deleted) - Number(!!b.deleted) || (b.m || 0) - (a.m || 0))
  const theses = all<{ id: string; title: string }>('SELECT id, title FROM theses WHERE merged_into_id IS NULL')
  const fields = activeFieldDefs().map(f => ({ objectType: f.object_type, key: f.key, label: f.label, valueType: f.value_type, enumValues: json<string[] | null>(f.enum_values_json, null) }))
  const r = await runTask(correct(), { text, candidates: candidates.slice(0, 20).map(({ m, ...c }) => c), fields, theses })
  if (r.value.action === 'none') return { ...r.value, op: null, input: null }
  let op: string, input: unknown
  try { ({ op, input } = chatToOp(r.value)) } catch (e) { throw typeof e === 'string' ? new AppError('VALIDATION', 'I couldn’t tell what to correct.') : e }
  checkOp(op, input)   // a correction that can't apply (name taken, not deleted…) is answered now, not after ↵
  return { ...r.value, op, input, confirmText: OPS[op].describe(input) }
}

/** Apply a confirmed proposal: `{op, input}` from correct.parse, or a bare CORRECT_OBJECT value (older callers). */
export function applyCorrection(p: Partial<Proposal>): { ok: true; message: string; op: string; undo: OpResult['undo']; result: unknown } {
  let op = p.op, input = p.input
  if (!op) {
    if (!p.action || p.action === 'none') throw new AppError('VALIDATION', 'I couldn’t tell what to correct.')
    try { ({ op, input } = chatToOp(p as CorrectValue)) } catch (e) { throw typeof e === 'string' ? new AppError('VALIDATION', 'Incomplete correction: ' + e) : e }
  }
  const r = runOp(op, input)
  return { ok: true, message: r.message, op: r.op, undo: r.undo, result: r.result }
}

// ---------------------------------------------------------------- suggestion.resolve
export function resolveSuggestion(id: string, accept: boolean): unknown {
  const s = one<any>("SELECT * FROM suggestions WHERE id = ? AND status = 'open'", id)
  if (!s) throw new AppError('NOT_FOUND', 'Suggestion not found')
  const pl = json<any>(s.payload_json, {})
  const t = now()
  let result: unknown = { ok: true }
  if (!accept) {
    run("UPDATE suggestions SET status = 'rejected', resolved_at = ? WHERE id = ?", t, id)   // dedupe_key kept → never re-suggested
    if (s.type === 'field_update' && pl.fvId) run("UPDATE field_values SET status = 'rejected' WHERE id = ? AND status = 'proposed'", pl.fvId)
  } else if (s.type === 'new_thesis') {
    const th = createThesis(pl.parentThesisId ?? null, pl.title, 'accepted_suggestion', pl.description || '')
    for (const nid of pl.noteIds || []) run("UPDATE notes SET anchor_type = 'thesis', anchor_id = ? WHERE id = ? AND anchor_type = 'none'", th.id, nid)
    run("UPDATE suggestions SET status = 'accepted', resolved_at = ? WHERE id = ?", t, id)
    result = { thesisId: th.id }
  } else if (s.type === 'entity_merge') {
    runOp('entity.merge', { type: pl.type, fromId: pl.fromId, intoId: pl.intoId })   // closes this suggestion (retargetSuggestions)
    run("UPDATE suggestions SET status = 'accepted', resolved_at = ? WHERE id = ?", t, id)
  } else if (s.type === 'field_update') {
    resolveProposal(pl.fvId, 'use_new')
  } else run("UPDATE suggestions SET status = 'accepted', resolved_at = ? WHERE id = ?", t, id)
  emit('object.updated', {})
  emit('suggestion.created', {})
  return result
}
