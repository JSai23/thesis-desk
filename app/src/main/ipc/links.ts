// Handlers: evidence keep/highlight and link confirm/change. link.reject/attach/rejectEntity: ipc/ontology.ts.
import { handle } from './registry'
import * as links from '../entities/links'

export function registerLinkHandlers(): void {
  handle('evidence.keep', ({ id, thesisId, stance }) => { links.keepEvidence(id, thesisId, stance); return { ok: true } })
  handle('evidence.highlight', ({ documentId, start, end, thesisId, companyId }) => links.highlight(documentId, start, end, { thesisId, companyId }))
  handle('link.confirm', ({ relId }) => { links.confirmLink(relId); return { ok: true } })
  handle('link.change', ({ relId, thesisId, stance }) => { links.changeLink(relId, thesisId, stance); return { ok: true } })
}
