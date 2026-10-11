// Handlers: ontology operations (DEC-094). `ontology.apply` / `ontology.undo` are the one path for changes to
// companies, firms, people, theses, their fields and links; the older per-action commands are thin aliases kept for
// the renderer and the test suites, each returning the shape it always returned.
import { handle } from './registry'
import { runOp, undoHistory, listOps, checkInvariants, aliasAudit } from '../entities/ops'
import { all, run } from '../db'
import { now } from '../clock'
import { aliasKey } from '../entities/resolve'
import { invalidateNameCache } from '../ai/grounding'
import { connectedEntities, invalidateTiers } from '../objects/tiers'

const ok = () => ({ ok: true })

export function registerOntologyHandlers(): void {
  handle('ontology.apply', ({ op, input }) => runOp(op, input))
  handle('ontology.undo', ({ historyId, historyIds }) => undoHistory(historyIds?.length ? historyIds : [historyId]))
  handle('ontology.ops', () => listOps())
  handle('ontology.aliasAudit', () => aliasAudit())
  handle('test.ontology.invariants', () => checkInvariants())
  // seeds the state an older build left behind (an unstated source alias) without going through today's guards
  handle('test.aliases.add', ({ type, id, alias, origin }) => {
    run('INSERT OR REPLACE INTO aliases(entity_type, entity_id, alias, alias_normalized, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)', type, id, alias, aliasKey(alias), origin, now())
    invalidateNameCache()
    return { ok: true }
  })
  handle('test.tiers', async () => {
    invalidateTiers()
    return {
      connected: connectedEntities(),
      covers: all<any>(`SELECT r.from_id sourceId, s.name sourceName, s.origin, s.deleted_at deletedAt, r.to_type type, r.to_id id, r.status, json_extract(r.payload_json, '$.role') role
        FROM relationships r JOIN sources s ON s.id = r.from_id WHERE r.from_type = 'source' AND r.rel = 'covers' AND r.to_type IN ('company','firm','person')`)
    }
  })
  // aliases
  handle('object.create', ({ type, name, website, about }) => runOp('entity.create', { type, name, ...(website ? { website } : {}), ...(about ? { about } : {}) }).result)
  handle('merge.entities', ({ type, fromId, intoId }) => { runOp('entity.merge', { type, fromId, intoId }); return ok() })
  handle('merge.theses', ({ fromId, intoId }) => { runOp('thesis.merge', { fromId, intoId }); return ok() })
  handle('field.set', i => { runOp('field.set', i); return ok() })
  handle('field.revert', i => { runOp('field.revert', i); return ok() })
  handle('link.reject', ({ relId }) => { runOp('link.reject', { relId }); return ok() })
  handle('link.rejectEntity', i => { runOp('link.reject', i); return ok() })
  handle('link.attach', i => runOp('link.attach', i).result)
  handle('object.describe', ({ type, id, patch, rerun }) => runOp('object.describe', { type, id, patch, ...(rerun === undefined ? {} : { rerun }) }))
  handle('thesis.create', ({ parentId, title }) => runOp('thesis.create', { parentId: parentId ?? null, title }).result)
  handle('thesis.update', ({ id, patch }) => runOp('thesis.update', { id, patch }).result)
  handle('thesis.move', ({ id, parentId }) => runOp('thesis.move', { id, parentId }).result)
  handle('thesis.archive', ({ id, archived }) => { runOp('thesis.archive', { id, archived }); return ok() })
}
