// On-demand ingress: Read once of a URL or pasted text (RFC FLOW-C, P-CAPTURE-001/002, P-SOURCE-012).
// The user's request is recorded in On-demand history whatever the outcome; failures never lose the request.
import { all, one, run, tx, json } from '../db'
import { now } from '../clock'
import { newId } from '../ids'
import { writeHistory } from '../history'
import { emit } from '../events'
import { AppError } from '../errors'
import { fetchArticle } from '../sources/article'
import { ingestItem } from './pipeline'
import { normalizeLocator, isHttpUrl, hostOf, registrableDomain } from './url'
import { upsertFeedItem } from '../feed'
import { contentHash } from './dedupe'
import type { HistoryRowDTO } from '../../shared/dto'

export interface AddResult { documentId: string; itemId: string | null; outcome: string; pending?: boolean; message?: string }

type RestrictedHandler = (url: string, o: { thesisIds?: string[]; text?: string }) => Promise<AddResult>
let restrictedHandler: RestrictedHandler | null = null
let restrictedTest: (url: string) => boolean = () => false
/** PH-07b installs the Tier-4 (Chrome session bridge) path for X/LinkedIn and restricted domains. */
export function setRestrictedHandler(test: (url: string) => boolean, h: RestrictedHandler): void { restrictedTest = test; restrictedHandler = h }

type SelectionHandler = (url: string, text: string, thesisIds: string[]) => AddResult
let selectionHandler: SelectionHandler | null = null
/** Bookmarklet/selection captures (PH-07b): the selected text is the document; the page is not fetched. */
export function setSelectionHandler(h: SelectionHandler): void { selectionHandler = h }

type PartitionFor = (domain: string) => string | undefined
let partitionFor: PartitionFor = () => undefined
/** Read once uses the app-owned signed-in partition when the domain has one (§1C Manual URL). */
export function setPartitionResolver(f: PartitionFor): void { partitionFor = f }

export function recordOnDemand(entry: { url: string | null; title: string; type: string; outcome: string; documentId: string | null; retryable?: boolean; signInDomain?: string | null }): void {
  writeHistory('ingress', entry.documentId || 'none', 'ingress.read_once', null, entry, 'user')
}

export function linkUserTheses(documentId: string, thesisIds: string[] = []): void {
  const t = now()
  for (const thesisId of thesisIds) {
    if (!one('SELECT 1 FROM theses WHERE id = ?', thesisId)) continue
    const ex = one<{ id: string }>("SELECT id FROM relationships WHERE from_type = 'document' AND from_id = ? AND rel = 'relates_to' AND to_type = 'thesis' AND to_id = ?", documentId, thesisId)
    if (ex) run("UPDATE relationships SET origin = 'user', status = 'accepted', stance = COALESCE(stance, 'support'), updated_at = ? WHERE id = ?", t, ex.id)
    else run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, stance, confidence, created_at, updated_at)
              VALUES (?, 'document', ?, 'relates_to', 'thesis', ?, 'user', 'accepted', 'support', 1, ?, ?)`, newId('rel'), documentId, thesisId, t, t)
  }
}

export async function addUrl(rawUrl: string, thesisIds: string[] = [], text?: string): Promise<AddResult> {
  const url = normalizeLocator(rawUrl)
  if (!isHttpUrl(url)) throw new AppError('VALIDATION', 'That doesn’t look like a link.')
  if (text && text.trim() && selectionHandler) return selectionHandler(url, text, thesisIds)
  if (restrictedTest(url) && restrictedHandler) return restrictedHandler(url, { thesisIds, text })
  let a
  try {
    a = await fetchArticle(url, { render: 'auto', robots: false, polite: true, partition: partitionFor(registrableDomain(url)) })
  } catch (e) {
    recordOnDemand({ url, title: url.replace(/^https?:\/\//, ''), type: 'URL', outcome: 'Couldn’t read this page', documentId: null, retryable: true })
    emit('source.updated', {})
    throw new AppError('FETCH_FAILED', (e as Error).message || 'Couldn’t read this page')
  }
  const p = a.parsed
  if (!p.text.trim()) {
    recordOnDemand({ url, title: p.title || url, type: 'URL', outcome: 'Couldn’t read this page', documentId: null, retryable: true })
    throw new AppError('FETCH_FAILED', 'I couldn’t find readable text on that page.')
  }
  const res = ingestItem({
    sourceId: 'src_manual', itemKey: url, url: a.finalUrl, canonicalTag: p.canonical, kind: 'web', title: p.title, text: p.text, author: p.byline,
    siteName: p.siteName || hostOf(a.finalUrl), publishedAt: p.publishedAt, access: p.wall.found ? 'partial' : 'full', raw: { ext: 'html', body: a.html },
    metadata: { render: a.render, lang: p.lang, addedBy: 'read_once' }, skipTriage: true, priority: 1
  })
  // the page may already be queued by a source at background priority: what the user sent goes first
  run("UPDATE jobs SET priority = 1 WHERE type = 'PROCESS_DOCUMENT' AND status = 'queued' AND priority > 1 AND json_extract(payload_json, '$.documentId') = ?", res.duplicateOf || res.documentId)
  return finishAdd(res.duplicateOf || res.documentId, res.outcome, thesisIds, { url, title: p.title, type: 'URL' })
}

export function finishAdd(docId: string, outcome: string, thesisIds: string[], h: { url: string | null; title: string; type: string }): AddResult {
  let itemId: string | null = null
  tx(() => {
    linkUserTheses(docId, thesisIds)
    itemId = upsertFeedItem(docId)
  })
  const label = outcome === 'duplicate' ? 'Already in your library' : outcome === 'unchanged' ? 'Already in your library' : 'Read once'
  recordOnDemand({ url: h.url, title: h.title, type: h.type, outcome: label, documentId: docId })
  emit('feed.updated', { documentId: docId })
  emit('source.updated', {})
  return { documentId: docId, itemId, outcome }
}

export function addText(text: string, thesisIds: string[] = []): AddResult {
  const body = text.replace(/\r\n/g, '\n').trim()
  if (body.length < 200) throw new AppError('VALIDATION', 'Paste at least a paragraph (200 characters) to read it once.')
  const firstLine = body.split('\n').find(l => l.trim())!.trim()
  const title = firstLine.length > 120 ? firstLine.slice(0, 117) + '…' : firstLine
  const norm = body.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n')
  const res = ingestItem({ sourceId: 'src_manual', itemKey: 'text:' + contentHash(norm).slice(0, 16), url: null, kind: 'text', title, text: norm, access: 'full', raw: { ext: 'txt', body }, metadata: { addedBy: 'read_once_text' }, skipTriage: true, priority: 1 })
  return finishAdd(res.duplicateOf || res.documentId, res.outcome, thesisIds, { url: null, title, type: 'Text' })
}

export function onDemandHistory(): HistoryRowDTO[] {
  return all<{ id: string; after_json: string; created_at: number }>("SELECT id, after_json, created_at FROM history WHERE action = 'ingress.read_once' ORDER BY created_at DESC, rowid DESC LIMIT 200").map(r => {
    const a = json<any>(r.after_json, {})
    const live = a.documentId ? one<{ status: string }>('SELECT status FROM documents WHERE id = ? AND deleted_at IS NULL', a.documentId) : null
    const outcome = live?.status === 'pending_capture' ? a.outcome : live?.status === 'failed' ? 'Couldn’t process · Retry' : a.outcome
    return { id: r.id, title: a.title || a.url || 'Pasted text', type: a.type || 'URL', date: r.created_at, outcome, documentId: a.documentId || null, url: a.url || null, retryable: !!a.retryable && (!live || live.status === 'pending_capture'), signInDomain: live?.status === 'pending_capture' ? a.signInDomain || null : null } as HistoryRowDTO
  })
}
