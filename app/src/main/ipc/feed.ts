// Handlers: ingress, feed, reader.
import { openExternal } from '../window'
import { handle } from './registry'
import { one, run } from '../db'
import { now } from '../clock'
import { cancelJobs } from '../jobs'
import { AppError } from '../errors'
import * as feed from '../feed'
import * as ingress from '../ingest/ingress'
import { enqueueProcess } from '../ingest/pipeline'
import { emit } from '../events'
import { all } from '../db'
import { upsertSuggestion } from '../entities/relationships'

export function registerFeedHandlers(): void {
  handle('ingress.addUrl', ({ url, thesisIds, text }) => ingress.addUrl(url, thesisIds || [], text))
  handle('ingress.addText', ({ text, thesisIds }) => ingress.addText(text, thesisIds || []))
  handle('source.history', () => ingress.onDemandHistory())

  handle('feed.list', ({ viewSpec }) => ({ items: feed.listFeed(viewSpec) }))
  handle('feed.counts', ({ viewSpec }) => feed.feedCounts(viewSpec))
  handle('feed.get', ({ itemId }) => feed.readerDTO(itemId))
  handle('feed.markRead', ({ ids, read }) => { feed.markRead(ids, read); return { ok: true } })
  handle('feed.save', ({ ids, saved }) => { feed.save(ids, saved); return { ok: true } })
  handle('feed.dismiss', ({ ids, reason }) => { feed.dismiss(ids, reason); return { ok: true } })
  handle('feed.undismiss', ({ ids }) => { feed.undismiss(ids); return { ok: true } })
  handle('feed.feedback', ({ id, value }) => feed.feedback(id, value))
  handle('feed.muteTopic', ({ id, thesisId }) => { feed.muteTopic(id, thesisId); return { ok: true } })
  handle('feed.why', ({ id }) => feed.why(id))

  handle('document.get', ({ id }) => feed.readerDTO(null, id).document)
  // Open any library document in the reader (Ask citations, page rows without a feed item): follows duplicate → original
  handle('document.reader', ({ id }) => {
    let cur = id
    for (let i = 0; i < 5; i++) {
      const d = one<{ status: string; duplicate_of_id: string | null }>('SELECT status, duplicate_of_id FROM documents WHERE id = ? AND deleted_at IS NULL', cur)
      if (!d) throw new AppError('NOT_FOUND', 'This document is no longer in your library.')
      if (d.status !== 'duplicate' || !d.duplicate_of_id) break
      cur = d.duplicate_of_id
    }
    return feed.readerDTO(null, cur)
  })
  handle('document.open', ({ id }) => {
    const d = one<{ url: string | null }>('SELECT url FROM documents WHERE id = ?', id)
    if (!d) throw new AppError('NOT_FOUND', 'Document not found')
    if (!d.url || !/^https?:/i.test(d.url)) throw new AppError('VALIDATION', 'This document has no web address')
    openExternal(d.url)
    return { ok: true }
  })
  handle('document.retry', ({ id, resetGeneration }) => retryDocument(id, !!resetGeneration))
  // test seam (RFC §3.0): put a document's link to a thesis in the review band (a suggestion at 0.6) — the review
  // queue's UI is tested on real model output first, and this fills the gap when a live model gave too few (UI-FEED-03)
  handle('test.feed.review', ({ documentId, thesisId, stance }) => {
    run("UPDATE relationships SET status = 'suggested', confidence = 0.6, stance = ?, updated_at = ? WHERE from_type = 'document' AND from_id = ? AND to_type = 'thesis' AND status IN ('suggested','accepted') AND origin <> 'user'", stance, now(), documentId)
    upsertSuggestion('document', documentId, 'thesis', thesisId, { stance, confidence: 0.6, explanation: 'Test: a suggestion for review', generation: 0 })
    run("UPDATE relationships SET confidence = 0.6, status = 'suggested' WHERE from_type = 'document' AND from_id = ? AND to_type = 'thesis' AND to_id = ?", documentId, thesisId)
    for (const e of all<{ id: string }>("SELECT id FROM evidence WHERE document_id = ? AND status = 'active' LIMIT 2", documentId)) upsertSuggestion('evidence', e.id, 'thesis', thesisId, { stance, confidence: 0.6, explanation: 'Test: a suggestion for review', generation: 0 })
    feed.upsertFeedItem(documentId)
    emit('feed.updated', { ids: [] })
    return { ok: true }
  })
}

export function retryDocument(id: string, resetGeneration: boolean): { jobId: string } {
  const d = one<{ status: string }>('SELECT status FROM documents WHERE id = ? AND deleted_at IS NULL', id)
  if (!d) throw new AppError('NOT_FOUND', 'Document not found')
  if (d.status === 'pending_capture') throw new AppError('VALIDATION', 'This capture is waiting for sign-in; retry it from On-demand history')
  if (resetGeneration) {
    // Regenerate AI rows under the same preservation rules as a source reset (§1B.9.7, DEC-045/057)
    cancelJobs({ type: 'PROCESS_DOCUMENT', documentId: id })
    run('UPDATE documents SET ai_generation = ai_generation + 1, updated_at = ? WHERE id = ?', now(), id)
  }
  const jobId = enqueueProcess(id, { skipTriage: true, priority: 1 })
  emit('feed.updated', { documentId: id })
  return { jobId }
}
