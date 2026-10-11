// Handlers: object pages and lists, view definitions (read/reset/saved feed views), field history/proposals.
// object.create and field.set/revert are ontology operations: ipc/ontology.ts.
import { handle } from './registry'
import * as pages from '../objects/pages'
import { setWatchQuery } from '../objects/hydrate'
import { reprocess, reprocessPlan, keepRemoved } from '../objects/reprocess'
import * as views from '../views'
import { fieldHistory, resolveProposal } from '../entities/fields'

export function registerObjectHandlers(): void {
  handle('object.get', ({ type, id }) => pages.getObject(type, id))
  handle('object.list', ({ type, mode }) => pages.listObjects(type, mode))
  handle('object.follow', ({ type, id, follow }) => pages.follow(type, id, follow))
  handle('object.pullLatest', ({ type, id }) => pages.pullLatest(type, id))
  handle('object.reprocessPlan', ({ type, id }) => reprocessPlan(type, id))
  handle('object.reprocess', ({ type, id }) => reprocess(type, id))
  handle('object.reprocessKeep', ({ type, id }) => keepRemoved(type, id))
  handle('object.details', ({ type, id }) => pages.fromYou(type, id))
  handle('object.watch', ({ type, id, query }) => setWatchQuery(type, id, query))
  handle('object.pin', ({ type, id, pin }) => ({ pins: pages.pin(type, id, pin) }))
  handle('object.reorderPins', ({ type, ids }) => ({ pins: pages.reorderPins(type, ids) }))
  handle('object.markViewed', ({ type, id }) => pages.markViewed(type, id))

  handle('view.get', ({ objectType, objectId }) => views.getView(objectType, objectId))
  handle('view.reset', ({ objectType, objectId }) => views.resetView(objectType, objectId))
  handle('view.saveFeedView', ({ name, spec }) => views.saveFeedView(name, spec))
  handle('view.deleteFeedView', ({ id }) => views.deleteFeedView(id))
  handle('view.listFeedViews', () => views.listFeedViews())

  handle('field.history', ({ objectType, objectId, key }) => fieldHistory(objectType, objectId, key))
  handle('field.resolveProposal', ({ fvId, choice }) => { resolveProposal(fvId, choice); return { ok: true } })
}
