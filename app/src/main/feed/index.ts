// Feed (RFC §1B.14): gate, deterministic reasons, grouping/score, list/counts, reader data, item actions.
import { all, one, run, tx, json } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { emit } from '../events'
import { getSetting, setSetting } from '../settings'
import { AppError } from '../errors'
import { descendants } from '../theses'
import { hostOf } from '../ingest/url'
import type { FeedItemDTO, FeedCountsDTO, ReaderDTO, GroupKey } from '../../shared/dto'
import type { FeedViewSpec } from '../../shared/ipc'
import { tierOf, tierWeight, connectedVia } from '../objects/tiers'

const DAY = 86400_000
const STALE_MS = 14 * DAY
const PRIORITY: Record<string, number> = { low: 0.8, normal: 1.0, high: 1.2 }
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

interface DocRow { id: string; title: string; url: string | null; site_name: string | null; status: string; summary: string | null; metadata_json: string; access: string; published_at: number | null; text_chars: number; ai_generation: number; duplicate_of_id: string | null; first_fetched_at: number }
interface SourceLite { id: string; name: string; kind: string; mode: string; trust: string; priority: string; instruction: string; muted_until: number | null; type_label: string; created_at: number }
export interface FeedRow {
  id: string; document_id: string; primary_source_id: string; headline: string; summary: string; why_it_matters: string; reasons_json: string; group_key: GroupKey
  score: number; importance: number; novelty: number; primary_thesis_id: string | null; primary_stance: string | null; needs_review: number; hidden_reason: string | null
  surfaced_at: number; read_at: number | null; saved_at: number | null; dismissed_at: number | null; dismiss_reason: string | null; feedback: string | null; alert_rule_ids_json: string; created_at: number; updated_at: number
}

// ---------------------------------------------------------------- data helpers
export function liveSourcesOf(documentId: string): SourceLite[] {
  return all<SourceLite>(`SELECT s.id, s.name, s.kind, s.mode, s.trust, s.priority, s.instruction, s.muted_until, s.type_label, s.created_at FROM document_sources ds JOIN sources s ON s.id = ds.source_id
    WHERE ds.document_id = ? AND s.deleted_at IS NULL ORDER BY CASE WHEN s.kind IN ('hn_api','search') THEN 1 ELSE 0 END, ds.first_seen_at`, documentId) // publisher before aggregators
}

/** Thesis links of a document (document- and evidence-level), excluding rejected pairs. */
export function thesisLinks(documentId: string): { thesisId: string; relId: string; stance: string; confidence: number; status: string; origin: string; docLevel: boolean }[] {
  const rejected = new Set(all<{ to_id: string }>("SELECT to_id FROM relationships WHERE from_type = 'document' AND from_id = ? AND to_type = 'thesis' AND status = 'rejected'", documentId).map(r => r.to_id))
  const rows = all<{ id: string; to_id: string; stance: string | null; confidence: number | null; status: string; origin: string; from_type: string }>(
    `SELECT r.id, r.to_id, r.stance, r.confidence, r.status, r.origin, r.from_type FROM relationships r
     WHERE r.to_type = 'thesis' AND r.status IN ('accepted','suggested') AND r.rel = 'relates_to'
       AND ((r.from_type = 'document' AND r.from_id = ?) OR (r.from_type = 'evidence' AND r.from_id IN (SELECT id FROM evidence WHERE document_id = ? AND status IN ('active','orphaned'))))`, documentId, documentId)
  const live = new Set(all<{ id: string }>('SELECT id FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL').map(r => r.id))
  const best = new Map<string, any>()
  for (const r of rows) {
    if (rejected.has(r.to_id) || !live.has(r.to_id)) continue
    const conf = r.status === 'accepted' ? Math.max(r.confidence ?? 1, 1) : r.confidence ?? 0
    const cur = best.get(r.to_id)
    const cand = { thesisId: r.to_id, relId: r.id, stance: r.stance || 'support', confidence: conf, status: r.status, origin: r.origin, docLevel: r.from_type === 'document' }
    // prefer accepted, then the document-level row (that is what Confirm / Not related act on), then confidence
    if (!cur || (cand.status === 'accepted' && cur.status !== 'accepted') || (cand.status === cur.status && cand.docLevel && !cur.docLevel) || (cand.status === cur.status && cand.docLevel === cur.docLevel && cand.confidence > cur.confidence)) best.set(r.to_id, cand)
  }
  return [...best.values()].sort((a, b) => (a.status === 'accepted' ? 0 : 1) - (b.status === 'accepted' ? 0 : 1) || b.confidence - a.confidence)
}

/** Entities a document is about/mentions (not rejected), followed first. */
export function documentEntities(documentId: string, type: 'company' | 'firm' | 'person'): { id: string; name: string; followed: number; followed_at: number | null }[] {
  const table = type === 'company' ? 'companies' : type === 'firm' ? 'firms' : 'people'
  const rejected = new Set(all<{ to_id: string }>("SELECT to_id FROM relationships WHERE from_type = 'document' AND from_id = ? AND to_type = ? AND status = 'rejected'", documentId, type).map(r => r.to_id))
  const rows = all<{ id: string; name: string; followed: number; followed_at: number | null; rank: number }>(
    `SELECT e.id, e.name, e.followed, e.followed_at, MIN(CASE r.rel WHEN 'about' THEN 0 ELSE 1 END) rank FROM relationships r JOIN ${table} e ON e.id = r.to_id
     WHERE r.from_type = 'document' AND r.from_id = ? AND r.to_type = ? AND r.rel IN ('mentions','about') AND r.status = 'accepted' AND e.merged_into_id IS NULL AND e.deleted_at IS NULL
     GROUP BY e.id ORDER BY e.followed DESC, rank, r.created_at`, documentId, type)
  return rows.filter(r => !rejected.has(r.id))
}

export function isUserAdded(documentId: string): boolean {
  return !!one("SELECT 1 FROM document_sources WHERE document_id = ? AND source_id = 'src_manual'", documentId)
}

function weights(): { source: Record<string, number>; thesis: Record<string, number> } {
  const w = getSetting<any>('feedback_weights') || {}
  return { source: w.source || {}, thesis: w.thesis || {} }
}

const sinceLabel = (t: number | null) => (t ? ' (since ' + new Date(t).toLocaleString('en-US', { month: 'long', year: 'numeric' }) + ')' : '')

// ---------------------------------------------------------------- gate / upsert
export interface UpsertOpts { resurface?: boolean; generationOnly?: boolean; alertRuleId?: string; alertName?: string }

/**
 * Create or update the feed item for a processed document per the §1B.14.1 gate. Returns the item id or null.
 * User state (read/saved/dismissed/feedback) is never reset except `read_at` on a novel new version (resurface).
 */
/** The Headlines bar (DEC-096): a reported deal or event of at least this importance, or anything this important. */
export const HEADLINE_DEAL = 0.7
export const HEADLINE_ANY = 0.9

export function upsertFeedItem(documentId: string, o: UpsertOpts = {}): string | null {
  const doc = one<DocRow>('SELECT id, title, url, site_name, status, summary, metadata_json, access, published_at, text_chars, ai_generation, duplicate_of_id, first_fetched_at FROM documents WHERE id = ? AND deleted_at IS NULL', documentId)
  if (!doc || doc.status === 'duplicate') return null
  const meta = json<any>(doc.metadata_json, {})
  const interp = meta.interpret || {}
  const sources = liveSourcesOf(documentId)
  const existing = one<FeedRow>('SELECT * FROM feed_items WHERE document_id = ?', documentId)
  const manual = isUserAdded(documentId)
  const suggestOn = getSetting('ai.suggest') !== false
  const links = suggestOn ? thesisLinks(documentId) : thesisLinks(documentId).filter(l => l.status === 'accepted')
  const cos = documentEntities(documentId, 'company'), firms = documentEntities(documentId, 'firm'), people = documentEntities(documentId, 'person')
  const followedCos = cos.filter(x => x.followed), followedFirms = firms.filter(x => x.followed), followedPeople = people.filter(x => x.followed)
  const anyFollowed = followedCos.length + followedFirms.length + followedPeople.length > 0
  // connected tier (DEC-096): one step from something followed — a followed firm's portfolio, a followed company's founders…
  const connected = [...cos.map(x => ({ ...x, type: 'company' })), ...firms.map(x => ({ ...x, type: 'firm' })), ...people.map(x => ({ ...x, type: 'person' }))]
    .filter(x => !x.followed && tierOf(x.type, x.id) === 'connected')
  const tierBoost = anyFollowed ? tierWeight('followed') : connected.length ? tierWeight('connected') : 0
  const nonManual = sources.filter(s => s.kind !== 'manual')
  const alertIds: string[] = json(existing?.alert_rule_ids_json, [] as string[])
  if (o.alertRuleId && !alertIds.includes(o.alertRuleId)) alertIds.push(o.alertRuleId)

  // gate
  let pass = manual || alertIds.length > 0 || !!existing
  for (const s of nonManual) {
    if (pass) break
    if (s.mode === 'all' || s.trust === 'primary') pass = true
    else if (s.mode === 'relevant') pass = suggestOn ? links.some(l => l.confidence >= 0.5) || anyFollowed : anyFollowed || interp.relevant === true
    else if (s.mode === 'custom') pass = interp.matchesSourceInstruction === true || anyFollowed
  }
  if (!pass) return null

  // reasons (LAW-03)
  const reasons: { type: string; label: string; short: string; ref?: string }[] = []
  if (manual) reasons.push({ type: 'added_by_you', label: 'You added this link', short: 'You added this link' })
  for (const c of followedCos) reasons.push({ type: 'followed_company', label: `You follow ${c.name}${sinceLabel(c.followed_at)}`, short: `you follow ${c.name}`, ref: c.id })
  for (const f of followedFirms) reasons.push({ type: 'followed_firm', label: `You follow ${f.name}${sinceLabel(f.followed_at)}`, short: `you follow ${f.name}`, ref: f.id })
  for (const p of followedPeople) reasons.push({ type: 'followed_person', label: `You follow ${p.name}${sinceLabel(p.followed_at)}`, short: `you follow ${p.name}`, ref: p.id })
  for (const c of connected.slice(0, 2)) {
    const via = connectedVia(c.type, c.id).map(v => v.name).slice(0, 2).join(' and ')
    if (via) reasons.push({ type: 'connected', label: `${c.name} is connected to ${via}, which you follow`, short: `${c.name} is connected to ${via}`, ref: c.id })
  }
  for (const s of nonManual) {
    const instr = s.mode === 'all' ? 'all posts' : s.mode === 'relevant' ? 'items relevant to your theses' : (s.instruction || '').slice(0, 60)
    reasons.push({ type: 'source', label: `${s.name} is a subscribed source · ${instr}`, short: `you subscribe to ${s.name}`, ref: s.id })
  }
  for (const l of links) {
    const t = one<{ title: string }>('SELECT title FROM theses WHERE id = ?', l.thesisId)
    if (t) reasons.push({ type: 'thesis', label: `Matches your ${t.title} thesis${l.status === 'accepted' ? '' : ' (suggested)'}`, short: `your ${t.title} thesis`, ref: l.thesisId })
  }
  const companyIds = cos.map(c => c.id)
  if (companyIds.length) {
    const inv = all<{ id: string; name: string }>(`SELECT DISTINCT f.id, f.name FROM relationships r JOIN firms f ON f.id = r.from_id WHERE r.from_type = 'firm' AND r.rel = 'invested_in' AND r.status = 'accepted'
      AND r.to_type = 'company' AND r.to_id IN (${companyIds.map(() => '?').join(',')}) AND f.followed = 1`, ...companyIds)
    for (const f of inv) if (!followedFirms.some(x => x.id === f.id)) reasons.push({ type: 'investor_followed', label: `${f.name}, a firm you follow, is an investor`, short: `${f.name}, a firm you follow, invested`, ref: f.id })
  }
  for (const aid of alertIds) {
    const a = one<{ name: string }>('SELECT name FROM alert_rules WHERE id = ?', aid)
    if (a) reasons.push({ type: 'alert', label: `Matched your alert: ${a.name}`, short: `it matched your alert “${a.name}”`, ref: aid })
  }
  if (!reasons.length) reasons.push({ type: 'source', label: 'From a source you chose', short: 'you chose this source' })
  if (meta.updatedSinceRead || (existing && o.resurface)) reasons.unshift({ type: 'updated', label: 'Updated since you read it', short: 'Updated since you read it' })

  // score and group (§1B.14.3)
  const w = weights()
  const prio = Math.max(...(nonManual.length ? nonManual.map(s => PRIORITY[s.priority] ?? 1) : [1]))
  const importance = typeof interp.importance === 'number' ? clamp01(interp.importance) : 0.5
  const maxConf = links.reduce((m, l) => Math.max(m, Math.min(1, l.confidence)), 0)
  const novel = !!one("SELECT 1 FROM evidence WHERE document_id = ? AND status = 'active' AND is_novel = 1 AND assertion IN ('fact','attributed_opinion')", documentId)
  const hasEvidence = !!one("SELECT 1 FROM evidence WHERE document_id = ? AND status = 'active'", documentId)
  const N = novel || !hasEvidence ? 1.0 : 0.4
  const primary = links[0] || null
  const srcW = nonManual.length ? (w.source[nonManual[0].id] ?? 1) : 1
  const thW = primary ? (w.thesis[primary.thesisId] ?? 1) : 1
  const score = clamp01(prio * (0.45 * importance + 0.30 * maxConf + 0.25 * tierBoost) * N * srcW * thW)
  // An article published long before we first saw it is background, not a change: never "Important today" or
  // "Changes to companies you follow" (unless the user sent it or an alert matched it).
  const stale = !!doc.published_at && doc.first_fetched_at - doc.published_at > STALE_MS
  // Today's three sections (DEC-096): Following (followed and connected entities, key 'companies'), Your theses
  // ('theses'), Headlines ('important': only real headlines — a deal or event the article reports, or the very
  // important). Everything below the bar ('sources') stays in All and search, not Today.
  const deal = !!one("SELECT 1 FROM evidence WHERE document_id = ? AND status = 'active' AND is_novel = 1 AND kind IN ('funding','acquisition','fund_raise','investment')", documentId)
  const headline = !stale && ((deal && importance >= HEADLINE_DEAL) || importance >= HEADLINE_ANY)
  // what an alert caught always leads Headlines; a link the user sent goes where it belongs — Following, Your theses
  // (full card with its stance) — and is a Headline otherwise; it is always in Today (§1B.14.3)
  let group: GroupKey = 'sources'
  if (alertIds.length) group = 'important'
  else if ((anyFollowed || connected.length) && !stale) group = 'companies'
  else if (links.length) group = 'theses'
  else if (manual || headline) group = 'important'
  const needsReview = primary && primary.status === 'suggested' && primary.confidence >= 0.5 && primary.confidence < 0.75 ? 1 : 0

  // hidden state
  const t = now()
  let hidden: string | null = existing?.hidden_reason ?? null
  const primarySource = existing ? sources.find(s => s.id === existing.primary_source_id) || sources[0] : sources.find(s => s.kind === 'manual') || sources[0]
  if (!existing) {
    if (!manual && nonManual.length && nonManual.every(s => (s.muted_until ?? 0) > t)) hidden = 'muted'
    const muted = (getSetting<{ sourceId: string; thesisId: string }[]>('muted_topics') || [])
    if (!hidden && primary && nonManual.some(s => muted.some(m => m.sourceId === s.id && m.thesisId === primary.thesisId))) hidden = 'topic_muted'
  }
  if (manual && hidden === 'source_removed') hidden = null

  const fallbackSummary = firstSentences(one<{ text: string }>('SELECT text FROM documents WHERE id = ?', documentId)?.text || '', 2)
  const summary = (doc.summary || '').trim() || fallbackSummary
  const why = (interp.whyItMatters || '').trim()
  const reasonsJson = JSON.stringify(reasons.map(r => ({ type: r.type, label: r.label, short: r.short, ref: r.ref ?? null })))
  const comps = JSON.stringify({ prio, importance, maxConf, follow: anyFollowed ? 1 : 0, N, F: srcW * thW, srcW, thW })
  let id = existing?.id
  tx(() => {
    if (!existing) {
      id = newId('fi')
      run(`INSERT INTO feed_items(id, document_id, primary_source_id, headline, summary, why_it_matters, reasons_json, group_key, score, importance, novelty, primary_thesis_id, primary_stance,
            needs_review, hidden_reason, surfaced_at, alert_rule_ids_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, documentId, primarySource?.id || 'src_manual', doc.title, summary, why, reasonsJson, group, score, importance, novel ? 1 : 0, primary?.thesisId ?? null, primary?.stance ?? null,
        needsReview, hidden, t, JSON.stringify(alertIds), t, t)
    } else {
      const resurface = !!o.resurface && !o.generationOnly
      run(`UPDATE feed_items SET headline = ?, summary = ?, why_it_matters = ?, reasons_json = ?, group_key = ?, score = ?, importance = ?, novelty = ?, primary_thesis_id = ?, primary_stance = ?,
            needs_review = ?, hidden_reason = ?, alert_rule_ids_json = ?, surfaced_at = CASE WHEN ? THEN ? ELSE surfaced_at END, read_at = CASE WHEN ? THEN NULL ELSE read_at END, updated_at = ? WHERE id = ?`,
        doc.title, summary, why, reasonsJson, group, score, importance, novel ? 1 : 0, primary?.thesisId ?? null, primary?.stance ?? null, needsReview, hidden, JSON.stringify(alertIds),
        resurface ? 1 : 0, t, resurface ? 1 : 0, t, existing.id)
    }
    run('UPDATE documents SET metadata_json = json_set(metadata_json, \'$.scoreComponents\', json(?)) WHERE id = ?', comps, documentId)
  })
  return id!
}

export function firstSentences(text: string, n: number): string {
  const body = text.replace(/\s+/g, ' ').trim()
  const parts = body.match(/[^.!?]+[.!?]+(\s|$)/g) || [body]
  return parts.slice(0, n).join('').trim().slice(0, 600)
}

/** Re-gate a document for a newly seen (document, source) pair (RFC §1B.9 step 4a). */
export function regate(documentId: string, sourceId: string, enqueueSkipTriage: (docId: string) => void): void {
  const doc = one<{ status: string; duplicate_of_id: string | null }>('SELECT status, duplicate_of_id FROM documents WHERE id = ?', documentId)
  if (!doc) return
  const target = doc.status === 'duplicate' && doc.duplicate_of_id ? doc.duplicate_of_id : documentId
  const tdoc = one<{ status: string }>('SELECT status FROM documents WHERE id = ?', target)
  const src = one<{ kind: string; mode: string; trust: string }>('SELECT kind, mode, trust FROM sources WHERE id = ?', sourceId)
  if (!tdoc || !src) return
  if (tdoc.status === 'triaged_out' && (src.kind === 'manual' || src.mode === 'all' || src.trust === 'primary')) { enqueueSkipTriage(target); return }
  if (tdoc.status === 'processed') { upsertFeedItem(target); emit('feed.updated', { documentId: target }) }
}

// ---------------------------------------------------------------- DTOs
const sourceName = (srcId: string, doc: { url: string | null; site_name: string | null }) => {
  if (srcId === 'src_manual') return doc.site_name || (doc.url ? hostOf(doc.url) : 'Pasted text')
  return one<{ name: string }>('SELECT name FROM sources WHERE id = ?', srcId)?.name || 'Source'
}

export function itemDTO(r: FeedRow): FeedItemDTO {
  const d = one<{ url: string | null; site_name: string | null; status: string; published_at: number | null; text_chars: number; access: string }>('SELECT url, site_name, status, published_at, text_chars, access FROM documents WHERE id = ?', r.document_id)!
  const src = one<{ type_label: string; kind: string }>('SELECT type_label, kind FROM sources WHERE id = ?', r.primary_source_id)
  const reasons = json<{ type: string; label: string; short: string }[]>(r.reasons_json, [])
  const shorts = reasons.filter(x => x.type !== 'updated').map(x => x.short)
  const reasonLine = reasons[0]?.type === 'updated' ? 'Updated since you read it' : reasons[0]?.type === 'added_by_you' ? 'You added this link' : 'Because ' + shorts.slice(0, 2).join(' and ')
  const links = thesisLinks(r.document_id)
  const primary = links.find(l => l.thesisId === r.primary_thesis_id) || links[0]
  const docLevelPrimary = primary && primary.status === 'suggested' ? (one<{ id: string }>("SELECT id FROM relationships WHERE from_type = 'document' AND from_id = ? AND to_type = 'thesis' AND to_id = ? AND status = 'suggested'", r.document_id, primary.thesisId)?.id || primary.relId) : null
  return {
    id: r.id, documentId: r.document_id, group: r.group_key, surfacedAt: r.surfaced_at, publishedAt: d.published_at,
    source: sourceName(r.primary_source_id, d), srcId: r.primary_source_id, srcType: r.primary_source_id === 'src_manual' ? 'Added by you' : src?.type_label || '',
    url: d.url, title: r.headline, summary: r.summary, why: r.why_it_matters, reason: reasonLine, reasons: reasons.map(x => ({ type: x.type, label: x.label })),
    thesis: r.primary_thesis_id, stance: (r.primary_stance as any) || (r.primary_thesis_id ? 'neutral' : null), theses: links.map(l => l.thesisId),
    cos: documentEntities(r.document_id, 'company').map(c => c.id), firms: documentEntities(r.document_id, 'firm').map(f => f.id),
    unread: !r.read_at, saved: !!r.saved_at, dismissed: !!r.dismissed_at, review: !!r.needs_review,
    suggest: r.needs_review && primary && docLevelPrimary ? { relId: docLevelPrimary, thesis: primary.thesisId, stance: primary.stance as any, confidence: primary.confidence } : null,
    novel: !!r.novelty, alert: json<string[]>(r.alert_rule_ids_json, []).length > 0, docStatus: d.status, minutes: Math.max(1, Math.round(d.text_chars / 1200)), access: d.access as any, hidden: r.hidden_reason
  }
}

/** Effective view spec: explicit spec merged over the feed view definition (§1B.14.5). */
function effectiveSpec(spec: Partial<FeedViewSpec> | undefined): FeedViewSpec {
  const def = one<{ definition_json: string }>("SELECT definition_json FROM view_definitions WHERE scope = 'type' AND object_type = 'feed'")
  const d = json<any>(def?.definition_json, {}).spec || {}
  return { segment: 'today', ...d, ...(spec || {}), filters: { ...(d.filters || {}), ...((spec as any)?.filters || {}) } } as FeedViewSpec
}

/** Today (DEC-096): the last day's items in one of its three sections — Following, Your theses, Headlines. Items below
 *  the Headlines bar ('sources') are in All and search, not Today. */
const inToday = (r: FeedRow, t: number) => r.surfaced_at >= t - DAY && r.group_key !== 'sources'

function baseRows(spec: FeedViewSpec, ignoreSegment = false): FeedRow[] {
  const t = now()
  let rows = all<FeedRow>('SELECT * FROM feed_items WHERE hidden_reason IS NULL AND dismissed_at IS NULL')
  if (spec.thesisFilter) {
    const set = new Set(descendants(spec.thesisFilter))
    rows = rows.filter(r => thesisLinks(r.document_id).some(l => set.has(l.thesisId)))
  }
  const f = spec.filters || {}
  if (f.sourceIds?.length) { const ids = new Set(f.sourceIds); rows = rows.filter(r => ids.has(r.primary_source_id) || liveSourcesOf(r.document_id).some(s => ids.has(s.id))) }
  if (f.onlyFollowed) rows = rows.filter(r => json<any[]>(r.reasons_json, []).some(x => /^followed_/.test(x.type)))
  if (f.excludeKinds?.length) { const ex = new Set(f.excludeKinds); rows = rows.filter(r => { const ks = all<{ kind: string }>("SELECT DISTINCT kind FROM evidence WHERE document_id = ? AND status = 'active'", r.document_id).map(k => k.kind); return !ks.length || ks.some(k => !ex.has(k)) }) }
  if (f.stages?.length) { const st = new Set(f.stages.map(s => s.toLowerCase())); rows = rows.filter(r => documentEntities(r.document_id, 'company').some(c => st.has((one<{ display: string }>("SELECT display FROM field_values WHERE object_type = 'company' AND object_id = ? AND field_key = 'stage' AND status = 'current'", c.id)?.display || '').toLowerCase()))) }
  if (ignoreSegment) return rows
  switch (spec.segment) {
    case 'today': return rows.filter(r => inToday(r, t))
    case 'unread': return rows.filter(r => !r.read_at)
    case 'saved': return rows.filter(r => !!r.saved_at)
    case 'review': return rows.filter(r => !!r.needs_review)
    default: return rows
  }
}

export function listFeed(specIn?: Partial<FeedViewSpec>): FeedItemDTO[] {
  const spec = effectiveSpec(specIn)
  const rows = baseRows(spec)
  if (spec.segment === 'saved') rows.sort((a, b) => (b.saved_at || 0) - (a.saved_at || 0))
  else if (spec.sort === 'newest') rows.sort((a, b) => b.surfaced_at - a.surfaced_at)
  else rows.sort((a, b) => b.novelty - a.novelty || b.score - a.score || b.surfaced_at - a.surfaced_at)
  return rows.map(itemDTO)
}

export function feedCounts(specIn?: Partial<FeedViewSpec>): FeedCountsDTO {
  const spec = effectiveSpec(specIn)
  const rows = baseRows(spec, true)
  const t = now()
  const today = rows.filter(r => inToday(r, t))
  const todayAllIncDismissed = all<FeedRow>('SELECT * FROM feed_items WHERE hidden_reason IS NULL AND surfaced_at >= ?', t - DAY).filter(r => inToday(r, t))
  const done = todayAllIncDismissed.filter(r => r.dismissed_at || r.read_at).length
  const sourcesToday = new Set(today.map(r => r.primary_source_id)).size
  return {
    today: today.length, all: rows.length, unread: rows.filter(r => !r.read_at).length, saved: rows.filter(r => !!r.saved_at).length, review: rows.filter(r => !!r.needs_review).length,
    remaining: today.filter(r => !r.read_at).length, done, totalToday: todayAllIncDismissed.length, sourcesToday
  }
}

export function paragraphs(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = []
  const re = /[^\n]+(?:\n(?!\n)[^\n]*)*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) { if (m[0].trim()) out.push({ text: m[0], start: m.index }) }
  return out
}

export function readerDTO(itemId: string | null, documentId?: string): ReaderDTO {
  const r = itemId ? one<FeedRow>('SELECT * FROM feed_items WHERE id = ?', itemId) : one<FeedRow>('SELECT * FROM feed_items WHERE document_id = ?', documentId)
  const docId = r?.document_id || documentId
  if (!docId) throw new AppError('NOT_FOUND', 'Item not found')
  const d = one<any>('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL', docId)
  if (!d) throw new AppError('NOT_FOUND', 'Document not found')
  const versions = one<{ n: number }>('SELECT COUNT(*) n FROM document_versions WHERE document_id = ?', docId)!.n
  const ev = all<any>(`SELECT * FROM evidence WHERE document_id = ? AND status IN ('active','orphaned') ORDER BY status, quote_start`, docId)
  const highlights = ev.filter(e => e.status === 'active' && (e.origin === 'user_highlight' || e.kept) && e.document_version === d.current_version).map(e => ({ evidenceId: e.id, start: e.quote_start, end: e.quote_end }))
  const orphaned = ev.filter(e => e.status === 'orphaned').map(e => ({ evidenceId: e.id, quote: e.quote }))
  const meta = json<any>(d.metadata_json, {})
  const links = thesisLinks(docId)
  const evCount = (thesisId: string) => one<{ n: number }>(`SELECT COUNT(DISTINCT r.from_id) n FROM relationships r JOIN evidence e ON e.id = r.from_id WHERE r.from_type = 'evidence' AND r.to_type = 'thesis' AND r.to_id = ? AND r.status = 'accepted' AND e.status IN ('active','orphaned')`, thesisId)!.n
  const cos = documentEntities(docId, 'company')
  const field = (id: string, key: string) => one<{ display: string }>("SELECT display FROM field_values WHERE object_type = 'company' AND object_id = ? AND field_key = ? AND status = 'current'", id, key)?.display || ''
  return {
    item: r ? itemDTO(r) : null,
    document: {
      id: d.id, title: d.title, url: d.url, siteName: d.site_name, author: d.author, publishedAt: d.published_at, fetchedAt: d.first_fetched_at, access: d.access,
      accessLabel: d.access === 'partial' ? (meta.entitlementWall ? 'Part of this article needs a plan you don’t have' : 'Partial — sign in for full text') : '',
      status: d.status, processingError: d.processing_error, summary: getSetting('ai.summarize') === false ? null : d.summary, text: d.text,
      paragraphs: paragraphs(d.text), highlights, orphaned, minutes: Math.max(1, Math.round(d.text_chars / 1200)), version: d.current_version, versions
    },
    evidence: ev.filter(e => e.status === 'active').map(e => ({ id: e.id, claim: e.claim, quote: e.quote, kind: e.kind, assertion: e.assertion, attributedTo: e.attributed_to, kept: !!e.kept || e.origin === 'user_highlight', origin: e.origin, previous: json<any>(e.payload_json, {}).previousEvidenceId || null })),
    companies: cos.map(c => ({ id: c.id, name: c.name, stage: field(c.id, 'stage'), hq: field(c.id, 'hq'), followed: !!c.followed })),
    firms: documentEntities(docId, 'firm').map(f => ({ id: f.id, name: f.name, followed: !!f.followed })),
    people: documentEntities(docId, 'person').map(p => ({ id: p.id, name: p.name, role: '', followed: !!p.followed })),
    theses: links.map(l => ({ id: l.thesisId, title: one<{ title: string }>('SELECT title FROM theses WHERE id = ?', l.thesisId)?.title || '', stance: l.stance as any, relId: l.docLevel ? l.relId : (one<{ id: string }>("SELECT id FROM relationships WHERE from_type = 'document' AND from_id = ? AND to_type = 'thesis' AND to_id = ?", docId, l.thesisId)?.id || l.relId), status: l.status, confidence: l.confidence, evidenceCount: evCount(l.thesisId) })),
    notes: all<any>('SELECT id, text, kind, anchor_type, anchor_id, ai_state FROM notes WHERE document_id = ? AND deleted_at IS NULL ORDER BY created_at', docId).map(n => ({ id: n.id, text: n.text, kind: n.kind, thesisId: n.anchor_type === 'thesis' ? n.anchor_id : null, aiState: n.ai_state }))
  }
}

// ---------------------------------------------------------------- actions
function ensureItems(ids: string[]): void {
  for (const id of ids) if (!one('SELECT 1 FROM feed_items WHERE id = ?', id)) throw new AppError('NOT_FOUND', 'Item not found')
}

export function markRead(ids: string[], read: boolean): void {
  ensureItems(ids)
  const t = now()
  tx(() => { for (const id of ids) run('UPDATE feed_items SET read_at = ?, updated_at = ? WHERE id = ?', read ? t : null, t, id) })
  emit('feed.updated', { ids })
}

export function save(ids: string[], saved: boolean): void {
  ensureItems(ids)
  const t = now()
  tx(() => { for (const id of ids) run('UPDATE feed_items SET saved_at = ?, updated_at = ? WHERE id = ?', saved ? t : null, t, id) })
  emit('feed.updated', { ids })
}

export function dismiss(ids: string[], reason?: string): void {
  ensureItems(ids)
  const t = now()
  tx(() => { for (const id of ids) run('UPDATE feed_items SET dismissed_at = ?, dismiss_reason = ?, read_at = COALESCE(read_at, ?), updated_at = ? WHERE id = ?', t, reason ?? null, t, t, id) })
  emit('feed.updated', { ids })
}

export function undismiss(ids: string[]): void {
  ensureItems(ids)
  const t = now()
  tx(() => { for (const id of ids) run('UPDATE feed_items SET dismissed_at = NULL, dismiss_reason = NULL, updated_at = ? WHERE id = ?', t, id) })
  emit('feed.updated', { ids })
}

/** More/Less like this (§1B.14.4): ±0.1 on source and primary-thesis weights, clamped to [0.5, 1.5]; rescore last 24 h. */
export function feedback(id: string, value: 'more' | 'less'): { source: number | null; thesis: number | null } {
  const r = one<FeedRow>('SELECT * FROM feed_items WHERE id = ?', id)
  if (!r) throw new AppError('NOT_FOUND', 'Item not found')
  const w = weights()
  const d = value === 'more' ? 0.1 : -0.1
  const cl = (x: number) => Math.round(Math.max(0.5, Math.min(1.5, x)) * 100) / 100
  const srcs = liveSourcesOf(r.document_id).filter(s => s.kind !== 'manual')
  const srcId = srcs[0]?.id || (r.primary_source_id !== 'src_manual' ? r.primary_source_id : null)
  if (srcId) w.source[srcId] = cl((w.source[srcId] ?? 1) + d)
  if (r.primary_thesis_id) w.thesis[r.primary_thesis_id] = cl((w.thesis[r.primary_thesis_id] ?? 1) + d)
  setSetting('feedback_weights', w)
  run('UPDATE feed_items SET feedback = ?, updated_at = ? WHERE id = ?', value, now(), id)
  rescoreRecent()
  emit('feed.updated', { ids: [id] })
  return { source: srcId ? w.source[srcId] : null, thesis: r.primary_thesis_id ? w.thesis[r.primary_thesis_id] : null }
}

export function rescoreRecent(): void {
  for (const r of all<{ document_id: string }>('SELECT document_id FROM feed_items WHERE surfaced_at >= ?', now() - DAY)) upsertFeedItem(r.document_id)
}

/** Mute the topic the user saw on the item (thesisId from the Why sheet): the stored primary thesis can change while
 *  the item is re-scored, and muting another thesis than the one named in the toast — or failing because the
 *  primary was being recomputed — lost the mute (UI-FEED-02, acc-2026-10-08T02-42-50). */
export function muteTopic(id: string, thesisId?: string | null): void {
  const r = one<FeedRow>('SELECT * FROM feed_items WHERE id = ?', id)
  if (!r) throw new AppError('NOT_FOUND', 'Item not found')
  const th = thesisId && one('SELECT 1 FROM theses WHERE id = ? AND merged_into_id IS NULL', thesisId) ? thesisId : r.primary_thesis_id
  if (!th) throw new AppError('VALIDATION', 'This item isn’t connected to a thesis')
  const srcs = liveSourcesOf(r.document_id).filter(s => s.kind !== 'manual')
  const list = getSetting<{ sourceId: string; thesisId: string }[]>('muted_topics') || []
  for (const s of srcs) if (!list.some(m => m.sourceId === s.id && m.thesisId === th)) list.push({ sourceId: s.id, thesisId: th })
  setSetting('muted_topics', list)
  emit('feed.updated', { ids: [id] })
}

export function why(id: string): { reasons: { type: string; label: string }[]; title: string } {
  const r = one<FeedRow>('SELECT * FROM feed_items WHERE id = ?', id)
  if (!r) throw new AppError('NOT_FOUND', 'Item not found')
  return { title: r.headline, reasons: json<{ type: string; label: string }[]>(r.reasons_json, []).map(x => ({ type: x.type, label: x.label })) }
}
