// INGEST_ITEM (RFC §1B.9 steps 1–6): store raw → canonical URL → dedupe (url / message-id / hash / near-dup) →
// insert document + version + document_sources → enqueue PROCESS_DOCUMENT. All adapters feed this one function.
import { one, run, tx } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { writeRaw } from '../files'
import { canonicalUrl } from './url'
import { contentHash, findNearDuplicate } from './dedupe'
import { enqueue } from '../jobs'
import { log } from '../log'
import { leadImage } from './lead-image'

export interface IngestItem {
  sourceId: string
  itemKey?: string | null
  url?: string | null
  canonicalTag?: string | null
  kind: 'web' | 'email' | 'text'
  title: string
  text: string
  author?: string | null
  siteName?: string | null
  publishedAt?: number | null
  access: 'full' | 'partial'
  raw: { ext: string; body: Buffer | string }
  emailMessageId?: string | null
  metadata?: Record<string, unknown>
  skipTriage?: boolean
  priority?: number
}
export type IngestOutcome = 'new' | 'updated' | 'unchanged' | 'duplicate'
export interface IngestResult { documentId: string; outcome: IngestOutcome; version: number; duplicateOf?: string }

interface DocRow { id: string; current_version: number; content_hash: string; access: string; status: string; ai_generation: number; duplicate_of_id: string | null }

type RegateHook = (documentId: string, sourceId: string) => void
let regateHook: RegateHook = () => {}
/** The feed/process module installs the §1B.14.1 re-gate for new (document, source) pairs. */
export function setRegateHook(h: RegateHook): void { regateHook = h }

export function enqueueProcess(documentId: string, o: { sourceId?: string; skipTriage?: boolean; priority?: number; runAfter?: number } = {}): string {
  const d = one<{ current_version: number; ai_generation: number }>('SELECT current_version, ai_generation FROM documents WHERE id = ?', documentId)!
  return enqueue('PROCESS_DOCUMENT', { documentId, version: d.current_version, generation: d.ai_generation, sourceId: o.sourceId, skipTriage: !!o.skipTriage },
    { idempotencyKey: `process:${documentId}:${d.current_version}:${d.ai_generation}`, priority: o.priority ?? 5, runAfter: o.runAfter })
}

/** Link (document, source); returns true when the pair is new. */
export function addDocumentSource(documentId: string, sourceId: string, itemKey?: string | null): boolean {
  const t = now()
  const ex = one('SELECT 1 FROM document_sources WHERE document_id = ? AND source_id = ?', documentId, sourceId)
  if (ex) { run('UPDATE document_sources SET last_seen_at = ?, item_key = COALESCE(?, item_key) WHERE document_id = ? AND source_id = ?', t, itemKey ?? null, documentId, sourceId); return false }
  run('INSERT INTO document_sources(document_id, source_id, item_key, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', documentId, sourceId, itemKey ?? null, t, t)
  return true
}

/** The item's lead image (See DEC-093): captured from the raw HTML whatever adapter fetched it; null when none. */
function imageOf(item: IngestItem): string | null {
  if (typeof item.metadata?.image === 'string') return item.metadata.image
  if (item.kind !== 'web' || item.raw.ext !== 'html') return null
  try { return leadImage(String(item.raw.body), item.url) } catch { return null }
}

export function ingestItem(item: IngestItem): IngestResult {
  const t = now()
  const meta = { ...(item.metadata || {}), image: imageOf(item) }
  const canon = item.url ? canonicalUrl(item.url, item.canonicalTag) : null
  const hash = contentHash(item.text)
  const ext = item.raw.ext

  // 4a: same canonical URL
  if (canon) {
    const d = one<DocRow>('SELECT id, current_version, content_hash, access, status, ai_generation, duplicate_of_id FROM documents WHERE canonical_url = ? AND deleted_at IS NULL', canon)
    if (d) {
      const walledOverFull = item.access === 'partial' && d.access === 'full'
      if (walledOverFull || d.content_hash === hash) {
        let newPair = false
        tx(() => {
          run('UPDATE documents SET last_fetched_at = ? WHERE id = ?', t, d.id)
          newPair = addDocumentSource(d.id, item.sourceId, item.itemKey)
        })
        if (newPair) regateHook(d.id, item.sourceId)
        return { documentId: d.id, outcome: 'unchanged', version: d.current_version }
      }
      if (d.status === 'pending_capture') {
        // a pending user-sent capture finally has content: fill version 1 in place
        tx(() => {
          const rawPath = writeRaw(d.id, 1, ext, item.raw.body)
          run(`UPDATE documents SET title = ?, author = ?, site_name = ?, published_at = COALESCE(?, published_at), last_fetched_at = ?, content_hash = ?, text = ?, text_chars = ?,
               access = ?, status = 'fetched', processing_error = NULL, metadata_json = ?, url = COALESCE(?, url), updated_at = ? WHERE id = ?`,
            item.title, item.author ?? null, item.siteName ?? null, item.publishedAt ?? null, t, hash, item.text, item.text.length, item.access, JSON.stringify(meta), item.url ?? null, t, d.id)
          run('INSERT OR REPLACE INTO document_versions(document_id, version, content_hash, text, raw_path, fetched_at) VALUES (?, 1, ?, ?, ?, ?)', d.id, hash, item.text, rawPath, t)
          addDocumentSource(d.id, item.sourceId, item.itemKey)
        })
        enqueueProcess(d.id, { sourceId: item.sourceId, skipTriage: item.skipTriage, priority: item.priority })
        return { documentId: d.id, outcome: 'new', version: 1 }
      }
      // different hash → new version (B-INGEST-004)
      const version = d.current_version + 1
      tx(() => {
        const rawPath = writeRaw(d.id, version, ext, item.raw.body)
        run('INSERT INTO document_versions(document_id, version, content_hash, text, raw_path, fetched_at) VALUES (?, ?, ?, ?, ?, ?)', d.id, version, hash, item.text, rawPath, t)
        run(`UPDATE documents SET current_version = ?, content_hash = ?, text = ?, text_chars = ?, title = COALESCE(NULLIF(?, ''), title), last_fetched_at = ?, access = ?, status = 'processing', updated_at = ? WHERE id = ?`,
          version, hash, item.text, item.text.length, item.title || '', t, item.access, t, d.id)
        if (meta.image) run("UPDATE documents SET metadata_json = json_set(metadata_json, '$.image', ?) WHERE id = ?", meta.image, d.id)
        addDocumentSource(d.id, item.sourceId, item.itemKey)
      })
      log.info('ingest', 'new version', { documentId: d.id, version })
      enqueueProcess(d.id, { sourceId: item.sourceId, skipTriage: true, priority: item.priority })
      return { documentId: d.id, outcome: 'updated', version }
    }
  }
  // 4b: email Message-ID
  if (item.emailMessageId) {
    const d = one<{ id: string; current_version: number }>('SELECT id, current_version FROM documents WHERE email_message_id = ? AND deleted_at IS NULL', item.emailMessageId)
    if (d) {
      const newPair = tx(() => addDocumentSource(d.id, item.sourceId, item.itemKey))
      if (newPair) regateHook(d.id, item.sourceId)
      return { documentId: d.id, outcome: 'unchanged', version: d.current_version }
    }
  }
  // 4c exact content hash / 4d near-duplicate → store a 'duplicate' row pointing at the original
  const exact = one<{ id: string }>("SELECT id FROM documents WHERE content_hash = ? AND deleted_at IS NULL AND status NOT IN ('duplicate','pending_capture') ORDER BY first_fetched_at LIMIT 1", hash)
  const near = exact ? null : findNearDuplicate(item.title, item.text, item.publishedAt ?? t)
  const originalId = exact?.id || near?.id || null

  const id = newId('doc')
  tx(() => {
    const rawPath = writeRaw(id, 1, ext, item.raw.body)
    run(`INSERT INTO documents(id, kind, canonical_url, url, email_message_id, title, author, site_name, published_at, first_fetched_at, last_fetched_at, current_version,
           content_hash, text, text_chars, access, status, duplicate_of_id, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, item.kind, canon, item.url ?? null, item.emailMessageId ?? null, item.title || '(untitled)', item.author ?? null, item.siteName ?? null, item.publishedAt ?? null, t, t,
      hash, item.text, item.text.length, item.access, originalId ? 'duplicate' : 'fetched', originalId, JSON.stringify({ ...meta, ...(near ? { nearDuplicateScore: near.score } : {}) }), t, t)
    run('INSERT INTO document_versions(document_id, version, content_hash, text, raw_path, fetched_at) VALUES (?, 1, ?, ?, ?, ?)', id, hash, item.text, rawPath, t)
    addDocumentSource(id, item.sourceId, item.itemKey)
    if (originalId) addDocumentSource(originalId, item.sourceId, item.itemKey)
  })
  if (originalId) {
    log.info('ingest', 'duplicate', { documentId: id, of: originalId, near: !!near })
    regateHook(originalId, item.sourceId)
    return { documentId: id, outcome: 'duplicate', version: 1, duplicateOf: originalId }
  }
  enqueueProcess(id, { sourceId: item.sourceId, skipTriage: item.skipTriage, priority: item.priority })
  return { documentId: id, outcome: 'new', version: 1 }
}
