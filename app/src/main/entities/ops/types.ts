// The shape of one ontology operation (DEC-094). See ./index.ts for how to add one.
import type { ZodType } from 'zod'
import type { AppError } from '../../errors'
import type { ChangeSet, NodeType } from './primitives'

export interface HistoryRow { id: string; entity_type: string; entity_id: string; action: string; before: any; after: any; created_at: number }

/** The flat parameter slots CORRECT_OBJECT fills (the model's output); an op's chat mapping reads the ones it needs. */
export interface Slots {
  action: string
  objectType: string | null; objectId: string | null; key: string | null; value: string | null
  fromId: string | null; intoId: string | null; parentId: string | null; relatedType: string | null; relatedId: string | null
  confirmText: string
}

export interface Inverse { op: string; input: unknown }

export interface OpDef<I = any, R = any> {
  /** Registry key, e.g. 'entity.rename'. Also the IPC `ontology.apply` op name. */
  name: string
  /** zod schema of the input (validated before anything else). */
  input: ZodType<I>
  /** Read-only checks against the library; return user-facing problems (strings → VALIDATION) or AppErrors (thrown as-is). */
  validate?: (i: I) => (string | AppError)[]
  /** The change, inside one transaction. Must write its history row(s) (directly via `audit`, or through the module it delegates to) and record touched objects/docs in `cs`. */
  apply: (i: I, cs: ChangeSet) => R
  /** Confirm text shown before applying (chat ↵ row, sheets): a short question. */
  describe: (i: I) => string
  /** history action written by apply → the op that reverses that row, or a sentence saying why it can't be undone. Ops without it are not undoable (merge, by design). */
  undo?: Record<string, (h: HistoryRow) => Inverse | string>
  /** Chat (CORRECT_OBJECT): the model-facing action name, its one prompt line, and the slots → input mapping (throw a string to tell the model what's missing). */
  chat?: { action: string; line: string; toInput: (s: Slots, typeOf: (id: string | null) => NodeType | null) => I }
  /** Reached only as another op's undo (not listed by ontology.ops, no chat line). */
  internal?: boolean
}

export const defineOp = <I, R>(d: OpDef<I, R>): OpDef<I, R> => d
