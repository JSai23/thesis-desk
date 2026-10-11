/**
 * Ontology operations (DEC-094) — every user change to companies, firms, people, theses, their fields and links goes
 * through this layer. One dispatch path:
 *
 *   IPC ontology.apply {op, input} ─┐
 *   legacy IPC (merge.entities,     ├─► runOp(name, input): zod input → validate() → apply() in ONE transaction
 *     object.create, field.set …) ──┤        → history row(s) → afterChange (name cache, feed items, events)
 *   chat: correct.parse → CORRECT_OBJECT (prompt lines from the registry) → {op, input, confirmText = describe()}
 *         correct.apply ────────────┘
 *   IPC ontology.undo {historyIds} ─► undoHistory: history row → the op's undo[action](row) → runOp(inverse) + 'undo' row
 *
 * Files
 *   primitives.ts  shared plumbing: moveEnds, moveAliases, moveFieldValues, moveNotes, rewriteEvidencePayloadIds,
 *                  retargetSuggestions, replaceInList (pins), audit, ChangeSet/afterChange
 *   entity.ts      entity.create · rename · merge · split · changeType · delete · restore
 *   repair.ts      entity.repairAliases (+ its undo, entity.restoreAliases) · aliasAudit — unstated source aliases (MEM-060)
 *   thesis.ts      thesis.create · update (rename …) · move · archive · merge
 *   field-link.ts  field.set · field.revert · link.reject · link.attach (delegate to fields.ts / links.ts)
 *   registry.ts    OPS / CHAT / UNDO maps, runOp, undoHistory, chatToOp
 *   invariants.ts  checkInvariants() — what must hold after every op (test.ontology.invariants)
 *
 * Adding an operation = ONE registry entry (+ one prompt line):
 *   1. `export const myOp = defineOp({ name: 'entity.foo', input: z.object(…), validate, describe, apply, undo?, chat? })`
 *      in the file for its object kind, and add it to that file's *_OPS array. `apply` runs inside the transaction,
 *      uses the primitives for anything that moves between objects, writes its history row with `audit(…)` holding
 *      what the inverse needs, and records touched objects/documents on the ChangeSet.
 *   2. `undo: { '<history action>': row => ({ op, input }) | 'why not' }` if it can be reversed.
 *   3. `chat: { action: 'foo_entity', line: '<one line for CORRECT_OBJECT>', toInput: slots → input }` to make it
 *      reachable from chat. The prompt's action list and output enum are built from the registry; only a new slot
 *      (beyond objectType/objectId/key/value/fromId/intoId/parentId/relatedType/relatedId) needs a schema change in
 *      ai/tasks/think.ts. Bump CORRECT_PROMPT_VERSION there when lines change.
 *   It is then callable as ontology.apply {op:'entity.foo'}, undoable through ontology.undo, and covered by the
 *   invariants checker. Add it to tests/realdata/ontology.spec.ts.
 */
export { OPS, runOp, undoHistory, inverseOf, listOps, chatLines, chatToOp, checkOp, type OpResult } from './registry'
export { checkInvariants, type InvariantReport } from './invariants'
export { typeOfId } from './primitives'
export { aliasAudit, aliasRepairPlan } from './repair'
