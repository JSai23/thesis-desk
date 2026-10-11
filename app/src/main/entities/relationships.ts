// Relationship rules (RFC §1B.13.2): one relationship, many supporting evidence rows (DEC-039); source_fact rows are
// accepted iff ≥1 active support; ai_inference rows are always suggested; user rows are never touched by automation;
// rejections are keyed at document level (DEC-053).
import { all, one, run } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { enqueue } from '../jobs'
import { TEST_MODE } from '../env'

export type RelType = 'mentions' | 'about' | 'invested_in' | 'works_at' | 'partner_at' | 'founded' | 'relates_to' | 'covers'
export interface RelRow { id: string; from_type: string; from_id: string; rel: string; to_type: string; to_id: string; origin: string; status: string; stance: string | null; confidence: number | null; explanation: string | null; payload_json: string }

export const getRel = (fromType: string, fromId: string, rel: string, toType: string, toId: string) =>
  one<RelRow>('SELECT * FROM relationships WHERE from_type = ? AND from_id = ? AND rel = ? AND to_type = ? AND to_id = ?', fromType, fromId, rel, toType, toId)

/** True when the user rejected the (document, target) pair — blocks every AI/source row for that document. */
export function docPairRejected(documentId: string, toType: string, toId: string): boolean {
  return !!one("SELECT 1 FROM relationships WHERE from_type = 'document' AND from_id = ? AND to_type = ? AND to_id = ? AND status = 'rejected'", documentId, toType, toId)
}

/** Upsert a source_fact relationship and record `evidenceId` as one of its supports. */
export function upsertSourceFact(fromType: string, fromId: string, rel: RelType, toType: string, toId: string, evidenceId: string | null, payload?: Record<string, unknown>): string | null {
  const t = now()
  const ex = getRel(fromType, fromId, rel, toType, toId)
  let id: string
  if (ex) {
    if (ex.status === 'rejected') return null
    id = ex.id
    if (ex.origin === 'source_fact' && ex.status !== 'accepted') run("UPDATE relationships SET status = 'accepted', updated_at = ? WHERE id = ?", t, id)
    if (payload && ex.origin !== 'user') run('UPDATE relationships SET payload_json = ?, updated_at = ? WHERE id = ?', JSON.stringify({ ...JSON.parse(ex.payload_json || '{}'), ...payload }), t, id)
  } else {
    id = newId('rel')
    run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'source_fact', 'accepted', ?, ?, ?)`, id, fromType, fromId, rel, toType, toId, JSON.stringify(payload || {}), t, t)
  }
  if (evidenceId) run(`INSERT INTO relationship_evidence(relationship_id, evidence_id, status, created_at) VALUES (?, ?, 'active', ?)
                       ON CONFLICT(relationship_id, evidence_id) DO UPDATE SET status = 'active'`, id, evidenceId, t)
  if ((!ex || ex.status !== 'accepted') && TIER_RELS.has(rel) && (isFollowed(fromType, fromId) || isFollowed(toType, toId))) queueTierSync()
  return id
}

// DEC-096: a new investment / partnership / founding / job link next to something followed can make a new Connected
// entity — the tier sync (its daily news watch) runs a minute later, once for the whole batch of articles being read.
// (Following M13 ran the sync before its articles were read, so its portfolio got no watches — RD-TIER-03.)
const TIER_RELS = new Set<RelType>(['invested_in', 'partner_at', 'founded', 'works_at'])
const ENTITY_TABLE: Record<string, string> = { company: 'companies', firm: 'firms', person: 'people' }
const isFollowed = (type: string, id: string) => !!ENTITY_TABLE[type] && !!one(`SELECT 1 FROM ${ENTITY_TABLE[type]} WHERE id = ? AND followed = 1`, id)
function queueTierSync(): void {
  // one queued sync is enough; while one is running, queue a follow-up so links made meanwhile are not missed
  if (one("SELECT 1 FROM jobs WHERE idempotency_key LIKE 'maint:sync_tiers%' AND status = 'queued'")) return
  const running = !!one("SELECT 1 FROM jobs WHERE idempotency_key LIKE 'maint:sync_tiers%' AND status = 'running'")
  // the follow-up gets its own key: a fixed ':next' key deduped against a ':next' sync already running, so a link
  // made in the second after it started (M13 → Bird) never got its watch (RD-TIER-03, iteration 2; MEM-072's shape)
  enqueue('MAINTENANCE', { task: 'sync_tiers' }, { idempotencyKey: running ? `maint:sync_tiers:next:${now()}` : 'maint:sync_tiers', priority: 4, runAfter: TEST_MODE ? now() : now() + 60_000 }) // tests drain only due jobs
}

/** Upsert an AI suggestion (origin ai_inference, status suggested). Skips user rows and rejected rows/pairs. */
export function upsertSuggestion(fromType: string, fromId: string, toType: string, toId: string, o: { stance: string; confidence: number; explanation: string; generation: number }): string | null {
  const ex = getRel(fromType, fromId, 'relates_to', toType, toId)
  const t = now()
  if (ex) {
    if (ex.origin === 'user' || ex.status === 'rejected' || ex.status === 'accepted') return ex.status === 'rejected' ? null : ex.id
    run("UPDATE relationships SET origin = 'ai_inference', status = 'suggested', stance = ?, confidence = ?, explanation = ?, ai_generation = ?, updated_at = ? WHERE id = ?",
      o.stance, o.confidence, o.explanation, o.generation, t, ex.id)
    return ex.id
  }
  const id = newId('rel')
  run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, stance, confidence, explanation, ai_generation, created_at, updated_at)
       VALUES (?, ?, ?, 'relates_to', ?, ?, 'ai_inference', 'suggested', ?, ?, ?, ?, ?, ?)`, id, fromType, fromId, toType, toId, o.stance, o.confidence, o.explanation, o.generation, t, t)
  return id
}

/** Recompute status of source_fact relationships from their active supports (accepted ↔ inactive). */
export function recomputeStatus(relIds: string[]): void {
  for (const id of new Set(relIds)) {
    const r = one<RelRow>('SELECT * FROM relationships WHERE id = ?', id)
    if (!r || r.origin !== 'source_fact' || r.status === 'rejected') continue
    const active = one<{ n: number }>("SELECT COUNT(*) n FROM relationship_evidence re JOIN evidence e ON e.id = re.evidence_id WHERE re.relationship_id = ? AND re.status = 'active' AND e.status = 'active'", id)!.n
    const status = active > 0 ? 'accepted' : 'inactive'
    if (status !== r.status) run('UPDATE relationships SET status = ?, updated_at = ? WHERE id = ?', status, now(), id)
  }
}

export function relsSupportedBy(evidenceIds: string[]): string[] {
  if (!evidenceIds.length) return []
  return all<{ relationship_id: string }>(`SELECT DISTINCT relationship_id FROM relationship_evidence WHERE evidence_id IN (${evidenceIds.map(() => '?').join(',')})`, ...evidenceIds).map(r => r.relationship_id)
}
