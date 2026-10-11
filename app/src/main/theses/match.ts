// MATCH_THESIS (DEC-099): a thesis created or reworded is matched against the facts already stored — no article is
// re-read. Candidates come from full-text search over fact claims and quotes with the thesis' own words; the model
// keeps only facts that support or contradict it (the INTERPRET rules), saved as suggested links like any other.
import { all, one } from '../db'
import { registerJob, enqueue } from '../jobs'
import { now } from '../clock'
import { emit } from '../events'
import { runTask } from '../ai/runtime'
import { MATCH_THESIS, bearsOnThesis, SELF_DENIAL } from '../ai/tasks/document'
import { upsertSuggestion, docPairRejected } from '../entities/relationships'
import { upsertFeedItem } from '../feed'
import { getDetails } from '../objects/details'
import { Handles } from '../ai/handles'

const BATCH = 40
const MAX_CANDIDATES = 120
const STOP = new Set('the and for with that this will from into over their they them than then what when where which while who whom why how are was were been being have has had not but all any can our its it is of to in on at by as be or an a vs via more most less least very just also'.split(' '))

/** FTS query from the thesis' words: "AI Infra" → ai OR infra*; long words match as prefixes (infra → infrastructure). */
export function thesisQuery(text: string): string | null {
  const words = [...new Set((text.match(/[A-Za-z][A-Za-z0-9-]*/g) || []).map(w => w.toLowerCase()).filter(w => !STOP.has(w) && (w.length >= 3 || /^[a-z]{2}$/.test(w))))]
  if (!words.length) return null
  return words.slice(0, 24).map(w => w.length >= 4 ? `"${w.replace(/-/g, ' ')}"*` : `"${w}"`).join(' OR ')
}

interface Cand { id: string; kind: string; claim: string; document_id: string; payload_json: string; event_date: string | null }

export async function matchThesis(thesisId: string, jobId: string): Promise<{ candidates: number; facts: number; documents: number; companies: number; skipped?: string }> {
  const t = one<{ id: string; title: string; description: string }>('SELECT id, title, description FROM theses WHERE id = ? AND merged_into_id IS NULL AND archived_at IS NULL', thesisId)
  if (!t) return { candidates: 0, facts: 0, documents: 0, companies: 0, skipped: 'thesis gone' }
  const proof = getDetails('thesis', thesisId).fields.proof || ''
  const q = thesisQuery(`${t.title} ${t.description} ${proof}`)
  if (!q) return { candidates: 0, facts: 0, documents: 0, companies: 0, skipped: 'no words to match' }
  const cands = all<Cand>(`SELECT e.id, e.kind, e.claim, e.document_id, e.payload_json, e.event_date FROM fts_evidence JOIN evidence e ON e.rowid = fts_evidence.rowid
    JOIN documents d ON d.id = e.document_id WHERE fts_evidence MATCH ? AND e.status = 'active' AND d.deleted_at IS NULL ORDER BY bm25(fts_evidence) LIMIT ${MAX_CANDIDATES}`, q)
  const thesis = { title: t.title, description: t.description }
  const linked: { evId: string; docId: string; stance: string; confidence: number; rationale: string }[] = []
  for (let i = 0; i < cands.length; i += BATCH) {
    const batch = cands.slice(i, i + BATCH)
    const h = new Handles()
    const facts = h.label('E', batch.map(c => {
      const p = JSON.parse(c.payload_json || '{}')
      return { id: c.id, kind: c.kind, claim: c.claim, subject: p.subject || '', date: c.event_date || '' }
    }))
    const r = await runTask(MATCH_THESIS, { thesis: { ...thesis, proof }, facts }, { jobId })
    for (const l of r.value.links) {
      if (SELF_DENIAL.test(l.rationale) || !bearsOnThesis(l.bearsOn, thesis)) continue
      const c = batch.find(x => x.id === h.back(l.factId))
      if (c) linked.push({ evId: c.id, docId: c.document_id, stance: l.stance, confidence: l.confidence, rationale: l.rationale })
    }
  }
  const docs = new Map<string, typeof linked[number]>()
  for (const l of linked) {
    if (docPairRejected(l.docId, 'thesis', thesisId)) continue
    upsertSuggestion('evidence', l.evId, 'thesis', thesisId, { stance: l.stance, confidence: l.confidence, explanation: l.rationale, generation: 0 })
    const best = docs.get(l.docId)
    if (!best || l.confidence > best.confidence) docs.set(l.docId, l)
  }
  for (const [docId, l] of docs) { upsertSuggestion('document', docId, 'thesis', thesisId, { stance: l.stance, confidence: l.confidence, explanation: l.rationale, generation: 0 }); upsertFeedItem(docId) }
  const companies = new Set(linked.map(l => { const p = JSON.parse(cands.find(c => c.id === l.evId)!.payload_json || '{}'); return p.subjectType === 'company' ? p.subjectId : null }).filter(Boolean))
  emit('object.updated', { type: 'thesis', id: thesisId })
  emit('feed.updated', { thesisId })
  return { candidates: cands.length, facts: linked.length, documents: docs.size, companies: companies.size }
}

/** Queue a match for a thesis. One already waiting picks up the latest words when it runs; one already *running* read
 *  the old words, so a new one is queued after it (an edit made while it ran must not be lost). */
export function queueMatch(thesisId: string, delayMs = 0): string {
  const key = `match_thesis:${thesisId}`
  const running = one("SELECT 1 FROM jobs WHERE type = 'MATCH_THESIS' AND idempotency_key LIKE ? AND status = 'running'", key + '%')
  const waiting = one<{ id: string }>("SELECT id FROM jobs WHERE type = 'MATCH_THESIS' AND idempotency_key LIKE ? AND status = 'queued'", key + '%')
  if (waiting) return waiting.id
  return enqueue('MATCH_THESIS', { thesisId }, { idempotencyKey: running ? `${key}:after:${now()}` : key, priority: 2, runAfter: now() + delayMs })
}

/** The last match result for a thesis page: running, or what it found. */
export function matchStatus(thesisId: string): { state: 'running' | 'done' | 'none'; result?: any } {
  const j = one<{ status: string; result_json: string | null }>("SELECT status, result_json FROM jobs WHERE type = 'MATCH_THESIS' AND (idempotency_key = ? OR idempotency_key LIKE ?) ORDER BY created_at DESC, rowid DESC LIMIT 1", `match_thesis:${thesisId}`, `match_thesis:${thesisId}:%`)
  if (!j) return { state: 'none' }
  if (j.status === 'queued' || j.status === 'running') return { state: 'running' }
  return { state: 'done', result: j.result_json ? JSON.parse(j.result_json) : null }
}

export function registerThesisMatch(): void {
  registerJob('MATCH_THESIS', job => matchThesis(job.payload.thesisId, job.id))
}
