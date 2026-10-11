// Handlers: notes, chat corrections, suggestions, Check for updates. Merges and other ontology changes: ipc/ontology.ts.
import { handle } from './registry'
import * as notes from '../notes'
import * as corr from '../entities/corrections'
import { refreshObject } from '../objects/refresh'
import { customize, undo } from '../views/customize'
import * as query from '../query'

export function registerThinkHandlers(): void {
  handle('note.create', n => notes.createNote(n))
  handle('note.suggest', ({ text, context }) => notes.suggest(text, context))
  handle('note.update', ({ id, patch }) => { notes.updateNote(id, patch); return { ok: true } })
  handle('note.delete', ({ id }) => { notes.deleteNote(id); return { ok: true } })
  handle('note.retry', ({ id }) => { notes.retryNote(id); return { ok: true } })
  handle('correct.parse', ({ text }) => corr.parseCorrection(text))
  handle('correct.apply', ({ proposal }) => corr.applyCorrection(proposal as any))
  handle('suggestion.resolve', ({ id, accept }) => corr.resolveSuggestion(id, accept))
  handle('view.customize', ({ objectType, objectId, instruction }) => customize(objectType, objectId ?? null, instruction))
  handle('view.undo', ({ viewId }) => undo(viewId))
  handle('search.query', ({ text, scope }) => query.search(text, scope))
  handle('query.ask', async ({ question, conversationId }) => ({ ...(await query.ask(question, conversationId)), backlog: query.processingBacklog() }))
  handle('query.recent', () => query.recentQueries())
  handle('object.refresh', ({ type, id }) => refreshObject(type, id))
}
