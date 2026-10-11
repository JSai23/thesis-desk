// Object pages and lists (RFC §1B.15 component data rules, §1B.13, §1B.14.5): object.get composes a page from its view
// definition; object.list/follow/pin/reorderPins/markViewed (adding one is the entity.create operation, entities/ops). Facts come from accepted relationships and active
// evidence only; "user places" (thesis evidence columns, company Evidence tab, kept evidence) also show orphaned evidence.
import { queueMatch } from '../theses/match'
import { enqueue } from '../jobs'
import { all, one, run, json } from '../db'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { getSetting, setSetting } from '../settings'
import { upsertFeedItem, liveSourcesOf } from '../feed'
import { thesisTree, getThesis } from '../theses'
import { TABLE, type EntityType } from '../entities/resolve'
import { hydrateStatus, startHydrate } from './hydrate'
import { cachedSummary, maybeSummarize } from './refresh'
import { sentences } from '../ai/grounding'
import { tiersChanged, tierOf, connectedVia } from './tiers'
import { getDetails, FIELD_SETS, type DetailType } from './details'
import { matchStatus } from '../theses/match'
import { reprocessChanges } from './reprocess'
import { fieldDef, currentValue } from '../entities/fields'
import { hostOf } from '../ingest/url'
import { getPageView, DEFAULTS, type ViewResult } from '../views'
import type { PageViewDefinition, Section } from '../../shared/schemas/view-def'
import type {
  CompanyPageDTO, FirmPageDTO, DetailsDTO, LookupDTO, ThesisPageDTO, ThesisDTO, SectionDTO, EvidenceCardDTO, NoteDTO, FieldChipDTO, ProposalDTO,
  MergeSuggestionDTO, CompanyListDTO, FirmListDTO, PersonListDTO, Stance
} from '../../shared/dto'

type PageType = 'company' | 'firm' | 'thesis'
type ObjType = 'company' | 'firm' | 'person' | 'thesis'
type Row = { label: string; value: string }
export type Redirect = { redirect: { type: ObjType; id: string } }

const DAY = 86400_000
const KIND_LABEL: Record<string, string> = {
  funding: 'Funding', investment: 'Funding', fund_raise: 'Funding', product_launch: 'Product', expansion: 'Expansion', partnership: 'Expansion',
  pricing: 'Pricing', customer_adoption: 'Customers', executive_change: 'People', opinion: 'Commentary', metric: 'Milestone', acquisition: 'News', other: 'News'
}
const NOTE_KIND: Record<string, string> = { observation: 'Observation', question: 'Question', counterpoint: 'Counterpoint', correction: 'Correction' }

// ---------------------------------------------------------------- formatting
/** ISO dates ("2026-03-04", "2026-03") become local noon so local formatting never shifts the day. */
function isoTime(s: string | null | undefined): number | null {
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1, 12).getTime()
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}
const evTime = (r: { event_date?: string | null; published_at?: number | null; first_fetched_at?: number | null; created_at?: number }) =>
  isoTime(r.event_date) ?? r.published_at ?? r.first_fetched_at ?? r.created_at ?? null
const monDay = (t: number | null) => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric' }) : '')
const monYear = (t: number | null) => (t ? new Date(t).toLocaleString('en-US', { month: 'short', year: 'numeric' }) : '')

export function formatUsd(n: number): string {
  const f = (x: number) => String(Number(x.toPrecision(3)))
  if (n >= 1e9) return `$${f(n / 1e9)}B`
  if (n >= 1e6) return `$${f(n / 1e6)}M`
  if (n >= 1e3) return `$${f(n / 1e3)}K`
  return `$${Math.round(n)}`
}
const amountOf = (p: any): string => (p.amountText ? String(p.amountText) : typeof p.amountUsd === 'number' && p.amountUsd > 0 ? formatUsd(p.amountUsd) : '')

// ---------------------------------------------------------------- small lookups
const entityTable = (t: EntityType) => TABLE[t]

function nameOf(type: string, id: string): string {
  if (type === 'thesis') return one<{ title: string }>('SELECT title FROM theses WHERE id = ?', id)?.title || ''
  if (type === 'company' || type === 'firm' || type === 'person') return one<{ name: string }>(`SELECT name FROM ${entityTable(type)} WHERE id = ?`, id)?.name || ''
  return ''
}

/** Follows merged_into_id so links to a merged entity show the surviving one. */
function liveEntity(type: EntityType, id: string): { id: string; name: string; followed: number } | undefined {
  let cur = id
  for (let i = 0; i < 6; i++) {
    const r = one<{ id: string; name: string; followed: number; merged_into_id: string | null; deleted_at: number | null }>(`SELECT id, name, followed, merged_into_id, deleted_at FROM ${entityTable(type)} WHERE id = ?`, cur)
    if (!r || r.deleted_at) return undefined
    if (!r.merged_into_id) return r
    cur = r.merged_into_id
  }
  return undefined
}

const fieldDisplay = (type: string, id: string, key: string) =>
  one<{ display: string }>("SELECT display FROM field_values WHERE object_type = ? AND object_id = ? AND field_key = ? AND status = 'current'", type, id, key)?.display || ''

const itemIdOf = (documentId: string) => one<{ id: string }>('SELECT id FROM feed_items WHERE document_id = ?', documentId)?.id ?? null

const liveThesisIds = () => new Set(all<{ id: string }>('SELECT id FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL').map(r => r.id))

/** Provenance name: first live source of the document; Read-once (src_manual) or no source → document title. */
function provenanceName(documentId: string, title: string): string {
  const s = liveSourcesOf(documentId)[0]
  return !s || s.id === 'src_manual' ? title : s.name
}

/** Evidence card source label (feed style): Read-once documents show their site. */
function cardSource(documentId: string, d: { url: string | null; site_name: string | null }): string {
  const s = liveSourcesOf(documentId)[0]
  if (!s || s.id === 'src_manual' || s.kind === 'hn_api' || s.kind === 'search') return d.site_name || (d.url ? hostOf(d.url) : '') || s?.name || 'Pasted text'
  return s.name
}

const rejectedPairSql = (docCol: string, typeExpr: string, idExpr: string) =>
  `NOT EXISTS (SELECT 1 FROM relationships x WHERE x.from_type = 'document' AND x.from_id = ${docCol} AND x.to_type = ${typeExpr} AND x.to_id = ${idExpr} AND x.status = 'rejected')`

// ---------------------------------------------------------------- evidence cards
interface EvRow { id: string; document_id: string; kind: string; assertion: string; claim: string; quote: string; attributed_to: string | null; event_date: string | null; payload_json: string; status: string; kept: number; origin: string; confidence: number; created_at: number; published_at: number | null; first_fetched_at: number; url: string | null; site_name: string | null; doc_title: string }
const EV_SELECT = `SELECT e.id, e.document_id, e.kind, e.assertion, e.claim, e.quote, e.attributed_to, e.event_date, e.payload_json, e.status, e.kept, e.origin, e.confidence, e.created_at,
  d.published_at, d.first_fetched_at, d.url, d.site_name, d.title AS doc_title FROM evidence e JOIN documents d ON d.id = e.document_id`

const SQL_EV_BY_ID = `${EV_SELECT} WHERE e.id = ? AND d.deleted_at IS NULL`
const SQL_EV_COMPANIES = `SELECT DISTINCT r.to_id FROM relationships r JOIN evidence e ON e.id = r.from_id WHERE r.from_type = 'evidence' AND r.from_id = ? AND r.rel = 'about' AND r.to_type = 'company' AND r.status = 'accepted'
  AND ${rejectedPairSql('e.document_id', "'company'", 'r.to_id')}`
const SQL_EV_THESES = `SELECT DISTINCT r.to_id FROM relationships r JOIN evidence e ON e.id = r.from_id WHERE r.from_type = 'evidence' AND r.from_id = ? AND r.to_type = 'thesis' AND r.rel = 'relates_to' AND r.status = 'accepted'
  AND ${rejectedPairSql('e.document_id', "'thesis'", 'r.to_id')}`

interface Card extends EvidenceCardDTO { kept: boolean; time: number | null }

function card(e: EvRow, link?: { stance: string | null; relId: string }): Card {
  const live = liveThesisIds()
  const t = evTime(e)
  return {
    id: e.id, text: e.claim, quote: e.quote, src: cardSource(e.document_id, e), date: t, documentId: e.document_id, itemId: itemIdOf(e.document_id),
    stance: ((link?.stance as Stance) || (link ? 'support' : 'neutral')), kind: e.kind, attributedTo: e.attributed_to, orphaned: e.status === 'orphaned',
    ...(link ? { relId: link.relId } : {}),
    companies: all<{ to_id: string }>(SQL_EV_COMPANIES, e.id).map(r => r.to_id),
    theses: all<{ to_id: string }>(SQL_EV_THESES, e.id).map(r => r.to_id).filter(id => live.has(id)),
    assertion: e.assertion, kept: !!e.kept || e.origin === 'user_highlight', time: t
  }
}
const publicCard = ({ kept: _k, time: _t, ...c }: Card): EvidenceCardDTO => c

const SQL_ENTITY_EVIDENCE = `${EV_SELECT} WHERE e.id IN (
    SELECT r.from_id FROM relationships r WHERE r.from_type = 'evidence' AND r.rel = 'about' AND r.to_type = ? AND r.to_id = ? AND r.status IN ('accepted','inactive'))
  AND e.status IN ('active','orphaned') AND d.deleted_at IS NULL AND ${rejectedPairSql('e.document_id', '?', '?')}`

/** Evidence about a company/firm. Orphaned rows only where the user kept them (a user place). */
function entityEvidence(type: 'company' | 'firm', id: string): Card[] {
  return all<EvRow>(SQL_ENTITY_EVIDENCE, type, id, type, id)
    .filter(e => e.status === 'active' || e.kept || e.origin === 'user_highlight')
    .map(e => card(e)).sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
}

// ---------------------------------------------------------------- notes
const SQL_NOTES = 'SELECT * FROM notes WHERE anchor_type = ? AND anchor_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC'
const SQL_NOTE_SUGG = "SELECT id, to_type, to_id FROM relationships WHERE from_type = 'note' AND from_id = ? AND status = 'suggested' ORDER BY confidence DESC"

function notesFor(anchorType: PageType, anchorId: string): NoteDTO[] {
  return all<any>(SQL_NOTES, anchorType, anchorId).map(n => ({
    id: n.id, text: n.text, kind: n.kind, createdAt: n.created_at, aiState: n.ai_state, anchorType: n.anchor_type, anchorId: n.anchor_id,
    suggestions: all<{ id: string; to_type: string; to_id: string }>(SQL_NOTE_SUGG, n.id).map(r => ({ type: r.to_type, id: r.to_id, name: nameOf(r.to_type, r.to_id), relId: r.id })).filter(s => s.name)
  }))
}

// ---------------------------------------------------------------- activity
interface Activity { documentId: string; itemId: string | null; kind: string; title: string; why: string; date: number | null; src: string; kinds: string[] }

const SQL_DOCS_FOR_ENTITY = `SELECT DISTINCT d.id, d.title, d.url, d.site_name, d.published_at, d.first_fetched_at, fi.id AS item_id, fi.headline, fi.why_it_matters
  FROM relationships r JOIN documents d ON d.id = r.from_id LEFT JOIN feed_items fi ON fi.document_id = d.id
  WHERE r.from_type = 'document' AND r.rel IN ('mentions','about') AND r.to_type = ? AND r.to_id = ? AND r.status = 'accepted'
    AND d.deleted_at IS NULL AND d.status <> 'duplicate' AND ${rejectedPairSql('d.id', '?', '?')}`
const SQL_DOCS_FOR_THESIS = `SELECT DISTINCT d.id, d.title, d.url, d.site_name, d.published_at, d.first_fetched_at, fi.id AS item_id, fi.headline, fi.why_it_matters
  FROM documents d LEFT JOIN feed_items fi ON fi.document_id = d.id
  WHERE d.deleted_at IS NULL AND d.status <> 'duplicate' AND ${rejectedPairSql('d.id', "'thesis'", '?')} AND d.id IN (
    SELECT r.from_id FROM relationships r WHERE r.from_type = 'document' AND r.to_type = 'thesis' AND r.to_id = ? AND r.status = 'accepted'
    UNION SELECT e.document_id FROM relationships r JOIN evidence e ON e.id = r.from_id WHERE r.from_type = 'evidence' AND r.to_type = 'thesis' AND r.to_id = ? AND r.status = 'accepted')`
/** Active evidence of a document, evidence about the object first, then by confidence. */
const SQL_DOC_KINDS = `SELECT e.kind FROM evidence e WHERE e.document_id = ? AND e.status = 'active'
  ORDER BY CASE WHEN EXISTS (SELECT 1 FROM relationships r WHERE r.from_type = 'evidence' AND r.from_id = e.id AND r.to_type = ? AND r.to_id = ? AND r.status = 'accepted') THEN 0 ELSE 1 END,
  e.confidence DESC, e.created_at`

function activityFor(type: PageType, id: string): Activity[] {
  const docs = type === 'thesis' ? all<any>(SQL_DOCS_FOR_THESIS, id, id, id) : all<any>(SQL_DOCS_FOR_ENTITY, type, id, type, id)
  return docs.map(d => {
    const kinds = all<{ kind: string }>(SQL_DOC_KINDS, d.id, type, id).map(k => k.kind)
    return { documentId: d.id, itemId: d.item_id ?? null, kind: kinds.length ? KIND_LABEL[kinds[0]] || 'News' : 'News', title: d.headline || d.title, why: d.why_it_matters || '', date: d.published_at ?? d.first_fetched_at ?? null, src: cardSource(d.id, d), kinds }
  }).sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
}
const publicActivity = ({ kinds: _k, ...a }: Activity) => a

// ---------------------------------------------------------------- funding / investors / people
interface Funding { round: string; amount: string; date: string; lead: string; evidenceIds: string[]; time: number | null }
const SQL_FUNDING = `${EV_SELECT} WHERE e.kind = 'funding' AND e.status = 'active' AND d.deleted_at IS NULL
  AND (json_extract(e.payload_json, '$.companyId') = ? OR e.id IN (SELECT r.from_id FROM relationships r WHERE r.from_type = 'evidence' AND r.rel = 'about' AND r.to_type = 'company' AND r.to_id = ? AND r.status = 'accepted'))
  AND ${rejectedPairSql('e.document_id', "'company'", '?')}`

/** One row per (company, round); the newest event/published date wins (a $20M update replaces an $18M report). */
function fundingFor(companyId: string): Funding[] {
  const groups = new Map<string, EvRow[]>()
  for (const e of all<EvRow>(SQL_FUNDING, companyId, companyId, companyId)) {
    const p = json<any>(e.payload_json, {})
    if (p.companyId && p.companyId !== companyId && liveEntity('company', p.companyId)?.id !== companyId) continue
    const key = String(p.round || '').trim().toLowerCase()
    const g = groups.get(key) || []
    g.push(e)
    groups.set(key, g)
  }
  const rows: Funding[] = []
  for (const g of groups.values()) {
    g.sort((a, b) => (evTime(b) ?? 0) - (evTime(a) ?? 0) || b.created_at - a.created_at)
    const w = g[0]
    const p = json<any>(w.payload_json, {})
    const leadIds: string[] = Array.isArray(p.leadInvestorIds) ? p.leadInvestorIds : []
    const leads = leadIds.map(fid => liveEntity('firm', fid)?.name).filter(Boolean) as string[]
    const leadNames = leads.length ? leads : Array.isArray(p.leadInvestors) ? p.leadInvestors.map(String) : []
    const t = evTime(w)
    rows.push({ round: p.round ? String(p.round) : 'Funding round', amount: amountOf(p), date: monYear(t), lead: leadNames.join(', '), evidenceIds: g.map(x => x.id), time: t })
  }
  return rows.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
}
const publicFunding = ({ time: _t, ...f }: Funding) => f
const fundingRow = (f: Funding): Row => ({ label: f.round, value: [f.amount, f.date, f.lead ? 'led by ' + f.lead : ''].filter(Boolean).join(' · ') || '—' })

const SQL_INVESTORS = `SELECT f.id, f.name, f.followed, r.payload_json FROM relationships r JOIN firms f ON f.id = r.from_id
  WHERE r.from_type = 'firm' AND r.rel = 'invested_in' AND r.to_type = 'company' AND r.to_id = ? AND r.status = 'accepted' AND f.merged_into_id IS NULL AND f.deleted_at IS NULL`
function investorsFor(companyId: string) {
  return all<{ id: string; name: string; followed: number; payload_json: string }>(SQL_INVESTORS, companyId)
    .map(r => ({ id: r.id, name: r.name, followed: !!r.followed, role: String(json<any>(r.payload_json, {}).role || 'unknown') }))
    .sort((a, b) => (a.role === 'lead' ? 0 : 1) - (b.role === 'lead' ? 0 : 1) || a.name.localeCompare(b.name))
}

const SQL_PEOPLE = `SELECT p.id, p.name, r.rel, r.payload_json FROM relationships r JOIN people p ON p.id = r.from_id
  WHERE r.from_type = 'person' AND r.rel IN ('works_at','founded','partner_at') AND r.to_type = ? AND r.to_id = ? AND r.status = 'accepted' AND p.merged_into_id IS NULL AND p.deleted_at IS NULL
  ORDER BY CASE r.rel WHEN 'founded' THEN 0 WHEN 'partner_at' THEN 1 ELSE 2 END, r.created_at`
function peopleFor(orgType: 'company' | 'firm', orgId: string, roles?: string[]): { id: string; name: string; role: string }[] {
  const seen = new Map<string, { id: string; name: string; role: string; founded: boolean }>()
  for (const r of all<{ id: string; name: string; rel: string; payload_json: string }>(SQL_PEOPLE, orgType, orgId)) {
    if (seen.has(r.id)) continue
    const title = String(json<any>(r.payload_json, {}).title || '').trim()
    seen.set(r.id, { id: r.id, name: r.name, role: title || (r.rel === 'founded' ? 'Founder' : r.rel === 'partner_at' ? 'Partner' : ''), founded: r.rel === 'founded' })
  }
  let out = [...seen.values()]
  if (roles?.length) {
    const want = roles.map(x => x.toLowerCase())
    out = out.filter(p => want.some(w => p.role.toLowerCase().includes(w) || (p.founded && w.startsWith('founder'))))
  }
  return out.map(({ founded: _f, ...p }) => p)
}

// ---------------------------------------------------------------- theses linked to an entity
const SQL_ENTITY_THESES_DIRECT = "SELECT r.to_id AS id FROM relationships r WHERE r.from_type = ? AND r.from_id = ? AND r.rel = 'relates_to' AND r.to_type = 'thesis' AND r.status = 'accepted'"
const SQL_ENTITY_THESES_VIA_EV = `SELECT DISTINCT r.to_id AS id FROM relationships r JOIN evidence e ON e.id = r.from_id
  JOIN relationships a ON a.from_type = 'evidence' AND a.from_id = r.from_id AND a.rel = 'about' AND a.to_type = ? AND a.to_id = ? AND a.status = 'accepted'
  WHERE r.from_type = 'evidence' AND r.to_type = 'thesis' AND r.rel = 'relates_to' AND r.status = 'accepted' AND e.status IN ('active','orphaned')
    AND ${rejectedPairSql('e.document_id', "'thesis'", 'r.to_id')}`
function thesesFor(type: 'company' | 'firm', id: string): { id: string; title: string; description: string; conviction: number }[] {
  const ids = new Set([...all<{ id: string }>(SQL_ENTITY_THESES_DIRECT, type, id), ...all<{ id: string }>(SQL_ENTITY_THESES_VIA_EV, type, id)].map(r => r.id))
  const live = liveThesisIds()
  return [...ids].filter(x => live.has(x)).map(x => getThesis(x)!).filter(Boolean)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at)
    .map(t => ({ id: t.id, title: t.title, description: t.description, conviction: t.conviction }))
}

// ---------------------------------------------------------------- header chips, proposals, merges
function provenanceOf(fv: { origin: string; evidence_id: string | null; created_at: number } | undefined): { provenance: string | null; earlier: string | null; source: string; date: number | null } {
  if (!fv) return { provenance: null, earlier: null, source: '', date: null }
  if (fv.origin === 'user') return { provenance: `Set by you · ${monDay(fv.created_at)}`, earlier: null, source: 'You', date: fv.created_at }
  if (!fv.evidence_id) return { provenance: null, earlier: null, source: '', date: fv.created_at }
  const e = one<{ status: string; document_id: string; title: string; published_at: number | null; first_fetched_at: number }>(
    'SELECT e.status, e.document_id, d.title, d.published_at, d.first_fetched_at FROM evidence e JOIN documents d ON d.id = e.document_id WHERE e.id = ?', fv.evidence_id)
  if (!e) return { provenance: null, earlier: null, source: '', date: fv.created_at }
  const name = provenanceName(e.document_id, e.title)
  const t = e.published_at ?? e.first_fetched_at
  return { provenance: `From ${name} · ${monDay(t)}`, earlier: e.status !== 'active' ? `From an earlier version of ${e.title}` : null, source: name, date: t }
}

/** Header chips for the definition's field keys; unknown or deleted field keys are dropped. */
function chips(type: PageType, id: string, keys: string[]): FieldChipDTO[] {
  const out: FieldChipDTO[] = []
  for (const key of keys) {
    const def = fieldDef(type, key)
    if (!def) continue
    const fv = currentValue(type, id, key)
    const p = provenanceOf(fv)
    out.push({ key, label: def.label, value: fv?.display ?? null, origin: fv?.origin ?? null, provenance: p.provenance, earlier: p.earlier, fvId: fv?.id ?? null, custom: !def.builtin })
  }
  return out
}

const SQL_PROPOSALS = `SELECT fv.id, fv.field_key, fv.display, fv.origin, fv.evidence_id, fv.created_at, s.id AS suggestion_id FROM field_values fv
  JOIN suggestions s ON s.type = 'field_update' AND s.status = 'open' AND json_extract(s.payload_json, '$.fvId') = fv.id
  WHERE fv.object_type = ? AND fv.object_id = ? AND fv.status = 'proposed' ORDER BY fv.created_at DESC`
function proposals(type: PageType, id: string): ProposalDTO[] {
  const out: ProposalDTO[] = []
  for (const r of all<any>(SQL_PROPOSALS, type, id)) {
    const def = fieldDef(type, r.field_key)
    if (!def) continue
    const p = provenanceOf(r)
    out.push({ fvId: r.id, key: r.field_key, label: def.label, value: r.display, current: currentValue(type, id, r.field_key)?.display ?? '', source: p.source, date: p.date, suggestionId: r.suggestion_id })
  }
  return out
}

const SQL_MERGES = `SELECT id, payload_json, explanation, target_type FROM suggestions WHERE type = 'entity_merge' AND status = 'open'
  AND (json_extract(payload_json, '$.fromId') = ? OR json_extract(payload_json, '$.intoId') = ?) ORDER BY created_at`
function mergeSuggestions(type: 'company' | 'firm', id: string): MergeSuggestionDTO[] {
  const out: MergeSuggestionDTO[] = []
  for (const s of all<{ id: string; payload_json: string; explanation: string; target_type: string | null }>(SQL_MERGES, id, id)) {
    const p = json<any>(s.payload_json, {})
    if ((p.type || s.target_type) !== type) continue
    const otherId = p.fromId === id ? p.intoId : p.fromId
    const other = otherId ? one<{ name: string; merged_into_id: string | null; deleted_at: number | null }>(`SELECT name, merged_into_id, deleted_at FROM ${entityTable(type)} WHERE id = ?`, otherId) : undefined
    if (!other || other.merged_into_id || other.deleted_at) continue
    out.push({ id: s.id, otherId, otherName: other.name, explanation: s.explanation })
  }
  return out
}

// ---------------------------------------------------------------- firm data
const SQL_FIRM_RELS = `SELECT r.id, r.to_id, r.payload_json, c.name, c.followed FROM relationships r JOIN companies c ON c.id = r.to_id
  WHERE r.from_type = 'firm' AND r.from_id = ? AND r.rel = 'invested_in' AND r.to_type = 'company' AND r.status = 'accepted' AND c.merged_into_id IS NULL AND c.deleted_at IS NULL`
const SQL_REL_SUPPORT = `${EV_SELECT} JOIN relationship_evidence re ON re.evidence_id = e.id
  WHERE re.relationship_id = ? AND re.status = 'active' AND e.status = 'active' AND e.kind IN ('funding','investment') AND d.deleted_at IS NULL`
const SQL_FINGERPRINT = 'SELECT fingerprint FROM evidence WHERE id = ?'

interface Investment { companyId: string; name: string; round: string; date: string; note: string; followed: boolean; role: string; time: number | null }
/** One row per distinct active funding/investment fingerprint supporting the firm's invested_in relationships. */
function investmentsFor(firmId: string): Investment[] {
  const rows: Investment[] = []
  for (const rel of all<{ id: string; to_id: string; payload_json: string; name: string; followed: number }>(SQL_FIRM_RELS, firmId)) {
    const relP = json<any>(rel.payload_json, {})
    const byFp = new Map<string, EvRow>()
    for (const e of all<EvRow>(SQL_REL_SUPPORT, rel.id)) {
      const fp = one<{ fingerprint: string | null }>(SQL_FINGERPRINT, e.id)?.fingerprint || e.id
      const cur = byFp.get(fp)
      if (!cur || (evTime(e) ?? 0) > (evTime(cur) ?? 0)) byFp.set(fp, e)
    }
    const perRound = new Map<string, Investment>()
    const loose: Investment[] = []
    for (const e of byFp.values()) {
      const p = json<any>(e.payload_json, {})
      const role = e.kind === 'funding' ? (Array.isArray(p.leadInvestorIds) && p.leadInvestorIds.includes(firmId) ? 'lead' : 'participant') : String(p.role || relP.role || 'unknown')
      const round = String(p.round || '')
      const t = evTime(e)
      const amount = amountOf(p)
      const inv: Investment = { companyId: rel.to_id, name: rel.name, round, date: monYear(t), note: [role === 'lead' ? 'Led the round' : role === 'participant' ? 'Participated' : '', amount].filter(Boolean).join(' · '), followed: !!rel.followed, role, time: t }
      // a funding report and an investment report of the same round are one investment
      const k = round.toLowerCase()
      if (!k) { loose.push(inv); continue }
      const prev = perRound.get(k)
      if (!prev) perRound.set(k, inv)
      else perRound.set(k, { ...prev, role: prev.role === 'lead' || inv.role === 'lead' ? 'lead' : prev.role, note: prev.note || inv.note, time: Math.max(prev.time ?? 0, inv.time ?? 0) || null, date: (prev.time ?? 0) >= (inv.time ?? 0) ? prev.date : inv.date })
    }
    const found = [...perRound.values(), ...loose]
    if (!found.length) found.push({ companyId: rel.to_id, name: rel.name, round: String(relP.round || ''), date: '', note: relP.role === 'lead' ? 'Led the round' : '', followed: !!rel.followed, role: String(relP.role || 'unknown'), time: null })
    rows.push(...found)
  }
  return rows.sort((a, b) => (b.time ?? 0) - (a.time ?? 0) || a.name.localeCompare(b.name))
}
const publicInvestment = ({ time: _t, ...i }: Investment) => i

const domainPair = (domain: string) => [domain, 'www.' + domain]
const SQL_FIRM_WRITING = `SELECT DISTINCT d.id, d.title, d.summary, d.published_at, d.first_fetched_at, fi.id AS item_id, fi.headline, fi.summary AS feed_summary
  FROM sources s JOIN document_sources ds ON ds.source_id = s.id JOIN documents d ON d.id = ds.document_id LEFT JOIN feed_items fi ON fi.document_id = d.id
  WHERE s.site_domain IN (?, ?) AND s.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status NOT IN ('duplicate','pending_capture','failed')
  ORDER BY COALESCE(d.published_at, d.first_fetched_at) DESC LIMIT 50`
function writingFor(domain: string | null) {
  if (!domain) return []
  return all<any>(SQL_FIRM_WRITING, ...domainPair(domain)).map(d => ({
    documentId: d.id, itemId: d.item_id ?? null, title: d.headline || d.title, date: d.published_at ?? d.first_fetched_at ?? null, summary: d.feed_summary || d.summary || ''
  }))
}

const SQL_SITE_SOURCES = "SELECT id, name, mode, instruction, freq, enabled, muted_until FROM sources WHERE site_domain IN (?, ?) AND deleted_at IS NULL ORDER BY created_at"
function watchingLine(domain: string | null): FirmPageDTO['watching'] {
  const s = domain ? all<{ id: string; name: string; mode: string; instruction: string; freq: string; enabled: number; muted_until: number | null }>(SQL_SITE_SOURCES, ...domainPair(domain))[0] : undefined
  if (!s) return { sourceId: null, enabled: false, label: 'No source set up for this firm yet' }
  const instr = (s.mode === 'custom' && s.instruction.trim() ? s.instruction.trim() : s.mode === 'all' ? 'all posts' : 'posts relevant to your theses').replace(/[.\s]+$/, '')
  const lower = instr.charAt(0).toLowerCase() + instr.slice(1)
  return { sourceId: s.id, enabled: !!s.enabled && !((s.muted_until ?? 0) > now()), label: `Watching ${lower} · ${s.freq}` }
}

/** attributed_opinion evidence attributed to the firm or one of its partners. */
function commentaryFor(firmId: string, firmName: string) {
  const names = [firmName, ...peopleFor('firm', firmId).map(p => p.name)].map(n => n.trim().toLowerCase()).filter(n => n.length >= 2)
  if (!names.length) return []
  // an attribution naming the firm or one of its people — or a short form of the firm's name ("Northwind" for Northwind
  // Ventures: the model credits either, run to run; acc-2026-10-07T11-52-00 UI-OBJ-02)
  const sql = `${EV_SELECT} WHERE e.assertion = 'attributed_opinion' AND e.status = 'active' AND d.deleted_at IS NULL AND e.attributed_to IS NOT NULL
    AND (${names.map(() => 'instr(lower(e.attributed_to), ?) > 0').join(' OR ')} OR (length(trim(e.attributed_to)) >= 4 AND instr(?, lower(trim(e.attributed_to))) = 1))`
  const firm = firmName.trim().toLowerCase()
  return all<EvRow>(sql, ...names, firm)
    .map(e => {
      // credited to the firm itself: the piece's byline names the partner who wrote it
      const author = firm.startsWith(String(e.attributed_to).trim().toLowerCase()) ? one<{ author: string | null }>('SELECT author FROM documents WHERE id = ?', e.document_id)?.author : null
      return { evidenceId: e.id, text: e.claim, quote: e.quote, where: cardSource(e.document_id, e), who: author ? `${author} · ${e.attributed_to}` : e.attributed_to || '', date: evTime(e), documentId: e.document_id }
    })
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).slice(0, 50)
}

// ---------------------------------------------------------------- thesis data
const SQL_THESIS_EVIDENCE = `${EV_SELECT} JOIN relationships r ON r.from_type = 'evidence' AND r.from_id = e.id
  WHERE r.to_type = 'thesis' AND r.to_id = ? AND r.rel = 'relates_to' AND r.status = 'accepted' AND e.status IN ('active','orphaned') AND d.deleted_at IS NULL
    AND ${rejectedPairSql('e.document_id', "'thesis'", 'r.to_id')} ORDER BY r.updated_at DESC`
const SQL_THESIS_EV_LINK = "SELECT id, stance FROM relationships WHERE from_type = 'evidence' AND from_id = ? AND rel = 'relates_to' AND to_type = 'thesis' AND to_id = ?"

function thesisCards(thesisId: string): Card[] {
  return all<EvRow>(SQL_THESIS_EVIDENCE, thesisId).map(e => {
    const l = one<{ id: string; stance: string | null }>(SQL_THESIS_EV_LINK, e.id, thesisId)!
    return card(e, { stance: l.stance || 'support', relId: l.id })
  })
}

const SQL_RECENT = `SELECT r.id AS rel_id, r.stance, r.status, r.created_at AS linked_at, e.id, e.claim, e.document_id, e.event_date, d.published_at, d.first_fetched_at
  FROM relationships r JOIN evidence e ON e.id = r.from_id JOIN documents d ON d.id = e.document_id
  WHERE r.from_type = 'evidence' AND r.rel = 'relates_to' AND r.to_type = 'thesis' AND r.to_id = ? AND r.status IN ('suggested','accepted') AND r.created_at >= ?
    AND e.status = 'active' AND d.deleted_at IS NULL AND ${rejectedPairSql('e.document_id', "'thesis'", 'r.to_id')}
  ORDER BY r.created_at DESC LIMIT 30`
function recentChanges(thesisId: string): ThesisPageDTO['recentChanges'] {
  return all<any>(SQL_RECENT, thesisId, now() - 30 * DAY).map(r => ({
    evidenceId: r.id, text: r.claim, stance: ((r.stance as Stance) || 'support'), date: evTime(r), documentId: r.document_id, itemId: itemIdOf(r.document_id), status: r.status
  }))
}

const SQL_THESIS_COMPANIES = `SELECT c.id, c.name FROM relationships r JOIN companies c ON c.id = r.from_id
  WHERE r.from_type = 'company' AND r.rel = 'relates_to' AND r.to_type = 'thesis' AND r.to_id = ? AND r.status = 'accepted' AND c.merged_into_id IS NULL AND c.deleted_at IS NULL ORDER BY r.updated_at DESC`
function thesisCompanies(thesisId: string): ThesisPageDTO['companies'] {
  return all<{ id: string; name: string }>(SQL_THESIS_COMPANIES, thesisId).map(c => ({ id: c.id, name: c.name, stage: fieldDisplay('company', c.id, 'stage'), lastTitle: activityFor('company', c.id)[0]?.title || '' }))
}

const SQL_THESIS_FIRMS = `SELECT f.id, f.name FROM relationships r JOIN firms f ON f.id = r.from_id
  WHERE r.from_type = 'firm' AND r.rel = 'relates_to' AND r.to_type = 'thesis' AND r.to_id = ? AND r.status = 'accepted' AND f.merged_into_id IS NULL AND f.deleted_at IS NULL`
const SQL_INVESTOR_FIRMS = `SELECT DISTINCT f.id, f.name FROM relationships r JOIN firms f ON f.id = r.from_id
  WHERE r.from_type = 'firm' AND r.rel = 'invested_in' AND r.to_type = 'company' AND r.to_id = ? AND r.status = 'accepted' AND f.merged_into_id IS NULL AND f.deleted_at IS NULL`
function thesisFirms(thesisId: string, companyIds: string[]): { id: string; name: string }[] {
  const out = new Map<string, { id: string; name: string }>()
  for (const f of all<{ id: string; name: string }>(SQL_THESIS_FIRMS, thesisId)) out.set(f.id, f)
  for (const cid of companyIds) for (const f of all<{ id: string; name: string }>(SQL_INVESTOR_FIRMS, cid)) if (!out.has(f.id)) out.set(f.id, f)
  return [...out.values()]
}

// ---------------------------------------------------------------- sections
/** Everything a section may draw from; the convenience arrays are computed once per page. */
interface Bag {
  type: PageType; id: string; name: string
  activity: () => Activity[]; evidence: () => Card[]; notes: () => NoteDTO[]
  theses: () => { id: string; title: string; description: string; conviction: number }[]
  funding: () => Funding[]; investors: () => ReturnType<typeof investorsFor>; people: () => { id: string; name: string; role: string }[]
  investments: () => Investment[]; writing: () => ReturnType<typeof writingFor>; commentary: () => ReturnType<typeof commentaryFor>; portfolio: () => { id: string; name: string; stage: string }[]
  currentView: () => string; thoughts: () => NoteDTO[]; questions: () => NoteDTO[]; children: () => ThesisDTO[]
  recent: () => ThesisPageDTO['recentChanges']; companies: () => { id: string; name: string; stage: string; lastTitle?: string }[]; firms: () => { id: string; name: string }[]
}

function memo<T>(fn: () => T): () => T {
  let done = false, v: T
  return () => { if (!done) { v = fn(); done = true } return v }
}

const sectionKey = (s: Section) => [s.component, s.params?.targetType || '', s.params?.stance || '', s.params?.keptOnly ? 'kept' : ''].join(':')
const noteRow = (n: NoteDTO): Row => ({ label: NOTE_KIND[n.kind] || 'Note', value: n.text })
const cardRow = (c: Card): Row => ({ label: KIND_LABEL[c.kind] || 'Evidence', value: [c.text, c.src, monDay(c.time)].filter(Boolean).join(' · ') })
const lim = <T>(xs: T[], n?: number) => (typeof n === 'number' && n > 0 ? xs.slice(0, n) : xs)

function linkedObjects(b: Bag, p: any): { id: string; type: string; name: string; detail: string }[] {
  const target: string = p.targetType
  if (p.relation) {
    const rows = all<{ from_type: string; from_id: string; to_type: string; to_id: string; payload_json: string }>(
      `SELECT from_type, from_id, to_type, to_id, payload_json FROM relationships WHERE rel = ? AND status = 'accepted'
         AND ((from_type = ? AND from_id = ? AND to_type = ?) OR (to_type = ? AND to_id = ? AND from_type = ?))`, p.relation, b.type, b.id, target, b.type, b.id, target)
    const seen = new Set<string>()
    const out: { id: string; type: string; name: string; detail: string }[] = []
    for (const r of rows) {
      const oid = r.from_type === b.type && r.from_id === b.id ? r.to_id : r.from_id
      if (seen.has(oid)) continue
      seen.add(oid)
      const name = nameOf(target, oid)
      if (name) out.push({ id: oid, type: target, name, detail: String(json<any>(r.payload_json, {}).title || json<any>(r.payload_json, {}).role || '') })
    }
    return out
  }
  const T = (xs: { id: string; title: string; conviction: number }[]) => xs.map(t => ({ id: t.id, type: 'thesis', name: t.title, detail: `Conviction ${t.conviction}/5` }))
  if (b.type === 'thesis') {
    if (target === 'company') return b.companies().map(c => ({ id: c.id, type: 'company', name: c.name, detail: c.stage }))
    if (target === 'firm') return b.firms().map(f => ({ id: f.id, type: 'firm', name: f.name, detail: '' }))
    if (target === 'thesis') return T(b.children())
    return []
  }
  if (target === 'thesis') return T(b.theses())
  if (target === 'person') return b.people().map(x => ({ id: x.id, type: 'person', name: x.name, detail: x.role }))
  if (b.type === 'company') {
    if (target === 'firm') return b.investors().map(f => ({ id: f.id, type: 'firm', name: f.name, detail: f.followed ? 'Following' : '' }))
    if (target === 'company') return relatedCompanies(b).map(c => ({ ...c, type: 'company' }))
    return []
  }
  if (target === 'company') {
    const seen = new Set<string>()
    return b.investments().filter(i => !seen.has(i.companyId) && !!seen.add(i.companyId)).map(i => ({ id: i.companyId, type: 'company', name: i.name, detail: i.round }))
  }
  return []
}

const SQL_COMPANIES_FOR_THESIS = `SELECT DISTINCT c.id, c.name FROM relationships r JOIN companies c ON c.id = r.from_id
  WHERE r.from_type = 'company' AND r.rel = 'relates_to' AND r.to_type = 'thesis' AND r.to_id = ? AND r.status = 'accepted' AND c.merged_into_id IS NULL AND c.deleted_at IS NULL`
/** Companies sharing a thesis with this object ("competitors you track"). */
function relatedCompanies(b: Bag): { id: string; name: string; detail: string }[] {
  const theses = b.type === 'thesis' ? [{ id: b.id, title: b.name }] : b.theses()
  const out = new Map<string, { id: string; name: string; detail: string[] }>()
  for (const t of theses) for (const c of all<{ id: string; name: string }>(SQL_COMPANIES_FOR_THESIS, t.id)) {
    if (b.type === 'company' && c.id === b.id) continue
    const cur = out.get(c.id) || { id: c.id, name: c.name, detail: [] }
    cur.detail.push(t.title)
    out.set(c.id, cur)
  }
  return [...out.values()].map(c => ({ id: c.id, name: c.name, detail: c.detail.join(', ') }))
}

function sectionData(b: Bag, s: Section): any {
  const p: any = s.params || {}
  switch (s.component) {
    case 'activity_timeline': {
      const kinds: string[] | undefined = p.kinds
      const items = lim(b.activity().filter(a => !kinds?.length || a.kinds.some(k => kinds.includes(k))), p.limit ?? 50)
      return { items: items.map(publicActivity), compact: !!p.compact, rows: items.map(a => ({ label: a.kind, value: [a.title, monDay(a.date)].filter(Boolean).join(' · ') })) }
    }
    case 'evidence_list': {
      let xs = b.evidence()
      if (p.stance === 'support') xs = xs.filter(c => c.stance !== 'contra')
      if (p.stance === 'contra') xs = xs.filter(c => c.stance === 'contra')
      if (p.kinds?.length) xs = xs.filter(c => p.kinds.includes(c.kind))
      if (p.keptOnly) xs = xs.filter(c => c.kept)
      xs = lim(xs, p.limit)
      return { items: xs.map(publicCard), rows: xs.map(cardRow) }
    }
    case 'evidence_columns': {
      const all = b.evidence()
      const supporting = all.filter(c => c.stance !== 'contra'), contradicting = all.filter(c => c.stance === 'contra')
      const order = p.order === 'contra_first' ? [...contradicting, ...supporting] : [...supporting, ...contradicting]
      return { order: p.order || 'support_first', supporting: supporting.map(publicCard), contradicting: contradicting.map(publicCard),
        rows: order.map(c => ({ label: c.stance === 'contra' ? 'Challenges' : 'Supports', value: c.text })) }
    }
    case 'current_view': { const text = b.currentView(); return { text, rows: text ? [{ label: 'Current view', value: text }] : [] } }
    case 'thoughts': return { items: b.thoughts(), rows: b.thoughts().map(noteRow) }
    case 'questions': return { items: b.questions(), rows: b.questions().map(noteRow) }
    case 'thesis_children': return { items: b.children(), rows: b.children().map(t => ({ label: t.title, value: `${t.evidenceCount} evidence · conviction ${t.conviction}/5` })) }
    case 'recent_changes': return { items: b.recent(), rows: b.recent().map(r => ({ label: r.stance === 'contra' ? 'Challenges' : 'Supports', value: r.text })) }
    case 'notes': return { items: b.notes(), rows: b.notes().map(noteRow) }
    case 'linked_objects': { const items = lim(linkedObjects(b, p), p.limit); return { targetType: p.targetType, items, rows: items.map(x => ({ label: x.name, value: x.detail || '—' })) } }
    case 'related_companies': { const items = relatedCompanies(b); return { items, rows: items.map(x => ({ label: x.name, value: x.detail ? 'Also in ' + x.detail : '—' })) } }
    case 'funding_table': { const f = b.funding(); return { items: f.map(publicFunding), rows: f.map(fundingRow) } }
    case 'latest_round': { const f = b.funding()[0]; return { item: f ? publicFunding(f) : null, rows: f ? [fundingRow(f)] : [] } }
    case 'investors': { const xs = b.investors(); return { items: xs, rows: xs.map(f => ({ label: f.name, value: [f.role === 'lead' ? 'Lead investor' : f.role === 'participant' ? 'Investor' : '', f.followed ? 'Following' : ''].filter(Boolean).join(' · ') || 'Investor' })) } }
    case 'people': {
      const xs = b.type === 'thesis' ? [] : p.roles?.length ? peopleFor(b.type, b.id, p.roles) : b.people()
      return { items: xs, rows: xs.map(x => ({ label: x.name, value: x.role || '—' })) }
    }
    case 'investments': { const xs = b.investments(); return { items: xs.map(publicInvestment), rows: xs.map(i => ({ label: i.name, value: [i.round, i.date, i.note].filter(Boolean).join(' · ') || '—' })) } }
    case 'writing': { const xs = b.writing(); return { items: xs, rows: xs.map(w => ({ label: monDay(w.date) || 'Post', value: w.title })) } }
    case 'commentary': { const xs = b.commentary(); return { items: xs, rows: xs.map(x => ({ label: x.who, value: x.text })) } }
    case 'portfolio': { const xs = b.portfolio(); return { items: xs, rows: xs.map(x => ({ label: x.name, value: x.stage || '—' })) } }
    case 'field_table': {
      const items = b.type === 'thesis' ? [] : chips(b.type, b.id, (p.fields || []) as string[])
      return { items, rows: items.map(ch => ({ label: ch.label, value: ch.value ?? '—' })) }
    }
    case 'summary': {
      // the cached AI summary (labelled AI); a stale or missing one is written in the background. Sentences resting on
      // the user's own words are marked as theirs (DEC-099)
      maybeSummarize(b.type, b.id)
      const sm = cachedSummary(b.type, b.id)
      if (!sm?.text) return { text: null, rows: [], emptyText: 'Writing a summary from your library…' }
      const yours = new Set(sm.yours || [])
      return { text: sm.text, yours: [...yours], rows: [{ label: 'AI summary', value: sentences(sm.text).map(x => yours.has(x) ? `${x} (your words)` : x).join(' ') }] }
    }
    default: return { rows: [] }
  }
}

function buildSections(b: Bag, view: ViewResult & { definition: PageViewDefinition }): { main: SectionDTO[]; rail: SectionDTO[] } {
  const def = view.definition
  const base = DEFAULTS[b.type]
  const defaultKeys = { main: new Set(base.main.map(sectionKey)), rail: new Set(base.rail.map(sectionKey)) }
  const make = (slot: 'main' | 'rail') => (s: Section): SectionDTO => {
    const custom = !view.isDefault && !defaultKeys[slot].has(sectionKey(s))
    const dto: SectionDTO = { id: s.id, component: s.component, custom, data: sectionData(b, s) }
    if (s.title) dto.title = s.title
    if (s.params) dto.params = s.params
    if (custom && view.instruction) dto.instruction = view.instruction
    return dto
  }
  return { main: def.main.map(make('main')), rail: def.rail.map(make('rail')) }
}

const viewMeta = (v: ViewResult) => ({ id: v.id, version: v.version, scope: v.scope, instruction: v.instruction, isDefault: v.isDefault })

function baseBag(type: PageType, id: string, name: string): Bag {
  const empty = <T>() => () => [] as T[]
  return {
    type, id, name, activity: memo(() => activityFor(type, id)), evidence: empty<Card>(), notes: memo(() => notesFor(type, id)), theses: empty(),
    funding: empty(), investors: empty(), people: empty(), investments: empty(), writing: empty(), commentary: empty(), portfolio: empty(),
    currentView: () => '', thoughts: empty(), questions: empty(), children: empty(), recent: empty(), companies: empty(), firms: empty()
  }
}

// ---------------------------------------------------------------- object.get
interface EntRow { id: string; name: string; domain: string | null; followed: number; merged_into_id: string | null; last_viewed_at: number | null; deleted_at: number | null }

function loadEntity(type: 'company' | 'firm', id: string): EntRow | Redirect {
  const r = one<EntRow>(`SELECT id, name, domain, followed, merged_into_id, last_viewed_at, deleted_at FROM ${entityTable(type)} WHERE id = ?`, id)
  if (!r || r.deleted_at) throw new AppError('NOT_FOUND', `${type === 'company' ? 'Company' : 'Firm'} not found`)
  if (r.merged_into_id) {
    const live = liveEntity(type, r.merged_into_id)
    if (!live) throw new AppError('NOT_FOUND', `${type === 'company' ? 'Company' : 'Firm'} not found`)
    return { redirect: { type, id: live.id } }
  }
  return r
}

// ---------------------------------------------------------------- "still reading" state
const AI_LANES = 2
const AI_TYPES = "('PROCESS_DOCUMENT','CONFIGURE_SOURCE','ORGANIZE_NOTE','BACKFILL_FIELD','SUGGEST_THESES','MATCH_THESIS','SUMMARIZE_OBJECT','COMPILE_REPORT','COMPILE_ALERT')"

/** Average wall time of a recent PROCESS_DOCUMENT job (ms); 30 s before any has finished. */
function avgProcessMs(): number {
  const r = one<{ avg: number | null }>("SELECT AVG(finished_at - started_at) avg FROM (SELECT finished_at, started_at FROM jobs WHERE type = 'PROCESS_DOCUMENT' AND status = 'succeeded' AND started_at IS NOT NULL AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 20)")
  return r?.avg && r.avg > 0 ? r.avg : 30_000
}

/**
 * Documents about this entity that are still being fetched or read: the hydration result's documents plus documents
 * already linked to it, counted while their PROCESS_DOCUMENT job is queued/running or the document is mid-pipeline.
 * etaMin counts every AI job queued ahead of the last of them, across the AI lane's parallel slots.
 */
export function readingState(type: 'company' | 'firm', id: string): { pending: number; etaMin: number; searching: boolean } | null {
  const h = hydrateStatus(type, id)
  const searching = h.state === 'running' && !h.result
  const ids = new Set<string>((h.result?.documentIds as string[] | undefined) || [])
  for (const r of all<{ from_id: string }>("SELECT from_id FROM relationships WHERE from_type = 'document' AND to_type = ? AND to_id = ? AND status IN ('accepted','suggested')", type, id)) ids.add(r.from_id)
  if (!ids.size) return searching ? { pending: 0, etaMin: 0, searching } : null
  const list = [...ids], ph = list.map(() => '?').join(',')
  const jobs = all<{ doc: string; priority: number; created_at: number; status: string }>(`SELECT json_extract(payload_json, '$.documentId') doc, priority, created_at, status FROM jobs
    WHERE type = 'PROCESS_DOCUMENT' AND status IN ('queued','running') AND json_extract(payload_json, '$.documentId') IN (${ph})`, ...list)
  const pendingDocs = new Set(jobs.map(j => j.doc))
  for (const d of all<{ id: string }>(`SELECT id FROM documents WHERE id IN (${ph}) AND deleted_at IS NULL AND status IN ('fetched','processing')`, ...list)) pendingDocs.add(d.id)
  if (!pendingDocs.size) return searching ? { pending: 0, etaMin: 0, searching } : null
  const queued = jobs.filter(j => j.status === 'queued')
  let ahead = jobs.length - queued.length
  if (queued.length) {
    const last = queued.reduce((a, b) => (b.priority > a.priority || (b.priority === a.priority && b.created_at > a.created_at) ? b : a))
    ahead = one<{ n: number }>(`SELECT COUNT(*) n FROM jobs WHERE type IN ${AI_TYPES} AND (status = 'running' OR (status = 'queued' AND (priority < ? OR (priority = ? AND created_at <= ?))))`, last.priority, last.priority, last.created_at)!.n
  } else ahead = Math.max(ahead, pendingDocs.size)
  const etaMin = Math.max(1, Math.ceil(ahead * avgProcessMs() / AI_LANES / 60_000))
  return { pending: pendingDocs.size, etaMin, searching }
}

/** The user's layer for a page (DEC-099). */
export function fromYou(type: DetailType, id: string): DetailsDTO { return { ...getDetails(type, id), fieldSet: FIELD_SETS[type] } }

/** What the last lookup found and what keeps watching (the page says it instead of showing an empty layout). */
export function lookupState(type: 'company' | 'firm' | 'person', id: string): LookupDTO {
  const h = hydrateStatus(type, id)
  const r = h.result || {}
  const watch = one<{ id: string; canonical_locator: string }>(`SELECT s.id, s.canonical_locator FROM relationships rel JOIN sources s ON s.id = rel.from_id WHERE rel.from_type = 'source' AND rel.rel = 'covers'
    AND rel.to_type = ? AND rel.to_id = ? AND rel.status = 'accepted' AND s.deleted_at IS NULL AND s.kind = 'search' ORDER BY s.created_at DESC LIMIT 1`, type, id)
  let watchQuery: string | null = null
  try { if (watch) watchQuery = (new URL(watch.canonical_locator).searchParams.get('q') || '').replace(/\s+when:\d+d$/, '') || null } catch { /* not a search URL */ }
  const domain = type === 'person' ? null : one<{ domain: string | null }>(`SELECT domain FROM ${entityTable(type)} WHERE id = ?`, id)?.domain || null
  const articles = one<{ n: number }>("SELECT COUNT(DISTINCT from_id) n FROM relationships WHERE from_type = 'document' AND to_type = ? AND to_id = ? AND status IN ('accepted','suggested')", type, id)!.n
  return { state: h.state, articles, website: domain, watchQuery, watchSourceId: watch?.id || null, needsHint: h.state === 'done' && !!r.needsHint && !articles && !domain, renamedFrom: r.renamedFrom || null }
}

export function companyPage(id: string): CompanyPageDTO | Redirect {
  const r = loadEntity('company', id)
  if ('redirect' in r) return r
  const view = getPageView('company', id)
  const b = baseBag('company', id, r.name)
  b.evidence = memo(() => entityEvidence('company', id))
  b.theses = memo(() => thesesFor('company', id))
  b.funding = memo(() => fundingFor(id))
  b.investors = memo(() => investorsFor(id))
  b.people = memo(() => peopleFor('company', id))
  const { main, rail } = buildSections(b, view)
  const sources = r.domain ? all<{ id: string; name: string }>("SELECT id, name FROM sources WHERE site_domain IN (?, ?) AND deleted_at IS NULL ORDER BY created_at", ...domainPair(r.domain)) : []
  return {
    id, name: r.name, tagline: fieldDisplay('company', id, 'tagline'), domain: r.domain, followed: !!r.followed, tier: tierOf('company', id), connectedVia: connectedVia('company', id).map(v => v.name),
    pinned: (getSetting<string[]>('pins.companies') || []).includes(id), lastViewedAt: r.last_viewed_at,
    header: chips('company', id, view.definition.headerFields), proposals: proposals('company', id), mergeSuggestions: mergeSuggestions('company', id),
    view: viewMeta(view), main, rail,
    activity: b.activity().map(publicActivity), evidence: b.evidence().map(publicCard), theses: b.theses(),
    investors: b.investors(), founders: b.people(), funding: b.funding().map(publicFunding), notes: b.notes(), sources,
    reading: readingState('company', id), fromYou: fromYou('company', id), lookup: lookupState('company', id), reprocessed: reprocessChanges('company', id)
  }
}

export function firmPage(id: string): FirmPageDTO | Redirect {
  const r = loadEntity('firm', id)
  if ('redirect' in r) return r
  const view = getPageView('firm', id)
  const b = baseBag('firm', id, r.name)
  b.evidence = memo(() => entityEvidence('firm', id))
  b.theses = memo(() => thesesFor('firm', id))
  b.people = memo(() => peopleFor('firm', id))
  b.investments = memo(() => investmentsFor(id))
  b.writing = memo(() => writingFor(r.domain))
  b.commentary = memo(() => commentaryFor(id, r.name))
  b.portfolio = memo(() => {
    const seen = new Set<string>()
    return b.investments().filter(i => i.followed && !seen.has(i.companyId) && !!seen.add(i.companyId)).map(i => ({ id: i.companyId, name: i.name, stage: fieldDisplay('company', i.companyId, 'stage') }))
  })
  const { main, rail } = buildSections(b, view)
  return {
    id, name: r.name, tagline: fieldDisplay('firm', id, 'tagline'), hq: fieldDisplay('firm', id, 'hq'), domain: r.domain, followed: !!r.followed, tier: tierOf('firm', id), connectedVia: connectedVia('firm', id).map(v => v.name),
    header: chips('firm', id, view.definition.headerFields), proposals: proposals('firm', id), mergeSuggestions: mergeSuggestions('firm', id),
    view: viewMeta(view), main, rail, watching: watchingLine(r.domain),
    investments: b.investments().map(publicInvestment), writing: b.writing(), commentary: b.commentary(), portfolio: b.portfolio(), theses: b.theses(),
    evidence: b.evidence().filter(c => c.kept).map(publicCard), notes: b.notes(),
    reading: readingState('firm', id), fromYou: fromYou('firm', id), lookup: lookupState('firm', id), reprocessed: reprocessChanges('firm', id)
  }
}

export function thesisPage(id: string): ThesisPageDTO | Redirect {
  const row = getThesis(id)
  if (!row) throw new AppError('NOT_FOUND', 'Thesis not found')
  if (row.merged_into_id) {
    let into: string | null = row.merged_into_id
    for (let i = 0; i < 6 && into; i++) { const n = getThesis(into); if (!n?.merged_into_id) break; into = n.merged_into_id }
    if (into && getThesis(into)) return { redirect: { type: 'thesis', id: into } }
    throw new AppError('NOT_FOUND', 'Thesis not found')
  }
  const tree = thesisTree(true)
  const thesis = tree.find(t => t.id === id)!
  const view = getPageView('thesis', id)
  const b = baseBag('thesis', id, row.title)
  b.evidence = memo(() => thesisCards(id))
  b.currentView = () => row.current_view
  b.thoughts = memo(() => notesFor('thesis', id).filter(n => n.kind !== 'question'))
  b.questions = memo(() => notesFor('thesis', id).filter(n => n.kind === 'question'))
  b.children = memo(() => tree.filter(t => t.parentId === id && !t.archived))
  b.recent = memo(() => recentChanges(id))
  b.companies = memo(() => thesisCompanies(id))
  b.firms = memo(() => thesisFirms(id, b.companies().map(c => c.id)))
  const { main, rail } = buildSections(b, view)
  const crumbs: { id: string; title: string }[] = []
  const seen = new Set<string>([id])
  for (let p = row.parent_id; p && !seen.has(p);) {
    seen.add(p)
    const t = getThesis(p)
    if (!t) break
    crumbs.unshift({ id: t.id, title: t.title })
    p = t.parent_id
  }
  const cards = b.evidence()
  const newThesisSuggestions = all<{ id: string; payload_json: string; explanation: string }>("SELECT id, payload_json, explanation FROM suggestions WHERE type = 'new_thesis' AND status = 'open' ORDER BY confidence DESC, created_at")
    .map(s => ({ s, p: json<any>(s.payload_json, {}) })).filter(x => x.p.parentId === id).map(x => ({ id: x.s.id, title: String(x.p.title || ''), explanation: x.s.explanation || String(x.p.description || '') }))
  return {
    thesis, crumbs, pinned: (getSetting<string[]>('pins.theses') || []).includes(id), view: viewMeta(view), main, rail,
    supporting: cards.filter(c => c.stance !== 'contra').map(publicCard), contradicting: cards.filter(c => c.stance === 'contra').map(publicCard),
    thoughts: b.thoughts(), questions: b.questions(), children: b.children(), recentChanges: b.recent(),
    companies: b.companies().map(c => ({ id: c.id, name: c.name, stage: c.stage, lastTitle: c.lastTitle || '' })), firms: b.firms(),
    ...(newThesisSuggestions.length ? { newThesisSuggestions } : {}),
    fromYou: fromYou('thesis', id),
    // topic sources while none covers this thesis yet: a news search and a Hacker News search for its subject (added
    // through the normal Add source sheet, which probes them first)
    suggestedSources: one("SELECT 1 FROM relationships r JOIN sources s ON s.id = r.from_id WHERE r.from_type = 'source' AND r.rel = 'covers' AND r.to_type = 'thesis' AND r.to_id = ? AND r.status = 'accepted' AND s.deleted_at IS NULL", id)
      ? [] : [{ label: `News search: ${row.title}`, locator: `search: ${row.title}` }, { label: `Hacker News: ${row.title}`, locator: `search: ${row.title} on hn` }],
    match: (() => { const m = matchStatus(id); return { state: m.state, facts: m.result?.facts || 0, companies: m.result?.companies || 0, documents: m.result?.documents || 0 } })()
  }
}

const SQL_PERSON_ORG = `SELECT r.to_type, r.to_id FROM relationships r WHERE r.from_type = 'person' AND r.from_id = ? AND r.rel IN ('works_at','founded','partner_at')
  AND r.to_type IN ('company','firm') ORDER BY CASE r.status WHEN 'accepted' THEN 0 ELSE 1 END, CASE r.rel WHEN 'founded' THEN 0 WHEN 'works_at' THEN 1 ELSE 2 END, r.updated_at DESC`
function personOrg(personId: string): { type: 'company' | 'firm'; id: string; name: string } | null {
  for (const r of all<{ to_type: 'company' | 'firm'; to_id: string }>(SQL_PERSON_ORG, personId)) {
    const e = liveEntity(r.to_type, r.to_id)
    if (e) return { type: r.to_type, id: e.id, name: e.name }
  }
  return null
}

export function getObject(type: ObjType, id: string): CompanyPageDTO | FirmPageDTO | ThesisPageDTO | Redirect {
  if (type === 'company') return companyPage(id)
  if (type === 'firm') return firmPage(id)
  if (type === 'thesis') return thesisPage(id)
  const p = liveEntity('person', id)
  if (!p) throw new AppError('NOT_FOUND', 'Person not found')
  const org = personOrg(p.id)
  if (!org) throw new AppError('NOT_FOUND', 'This person isn’t linked to a company or firm yet')
  return { redirect: { type: org.type, id: org.id } }
}

// ---------------------------------------------------------------- object.list
const SQL_LATEST_DOCS = `SELECT r.to_id, d.id AS doc_id, COALESCE(fi.headline, d.title) AS title, COALESCE(d.published_at, d.first_fetched_at) AS at,
    fi.id AS item_id, fi.read_at, fi.dismissed_at, fi.hidden_reason
  FROM relationships r JOIN documents d ON d.id = r.from_id LEFT JOIN feed_items fi ON fi.document_id = d.id
  WHERE r.from_type = 'document' AND r.rel IN ('mentions','about') AND r.to_type = ? AND r.status = 'accepted' AND d.deleted_at IS NULL AND d.status <> 'duplicate'
    AND ${rejectedPairSql('d.id', 'r.to_type', 'r.to_id')}`

function latestByEntity(type: EntityType): Map<string, { title: string; at: number | null; unread: boolean }> {
  const out = new Map<string, { title: string; at: number | null; unread: boolean }>()
  for (const r of all<any>(SQL_LATEST_DOCS, type)) {
    const cur = out.get(r.to_id) || { title: '', at: null, unread: false }
    if (cur.at === null || (r.at ?? 0) > cur.at) { cur.title = r.title; cur.at = r.at ?? null }
    if (r.item_id && !r.read_at && !r.dismissed_at && !r.hidden_reason) cur.unread = true
    out.set(r.to_id, cur)
  }
  return out
}

const byFollowThenRecent = <T extends { followed: boolean; lastDate: number | null; name: string }>(a: T, b: T) =>
  Number(b.followed) - Number(a.followed) || (b.lastDate ?? 0) - (a.lastDate ?? 0) || a.name.localeCompare(b.name)

export function listObjects(type: ObjType, mode: 'following' | 'all'): CompanyListDTO[] | FirmListDTO[] | PersonListDTO[] | { suggestions: { id: string; title: string; explanation: string }[] } {
  if (type === 'thesis') {
    return {
      suggestions: all<{ id: string; payload_json: string; explanation: string }>("SELECT id, payload_json, explanation FROM suggestions WHERE type = 'new_thesis' AND status = 'open' ORDER BY confidence DESC, created_at")
        .map(s => { const p = json<any>(s.payload_json, {}); return { id: s.id, title: String(p.title || ''), explanation: s.explanation || String(p.description || '') } })
        .filter(s => s.title)
    }
  }
  const followedOnly = mode === 'following'
  const latest = latestByEntity(type)
  const rows = all<{ id: string; name: string; followed: number; domain?: string | null }>(
    `SELECT id, name, followed${type === 'person' ? '' : ', domain'} FROM ${entityTable(type)} WHERE merged_into_id IS NULL AND deleted_at IS NULL${followedOnly ? ' AND followed = 1' : ''}`)
  if (type === 'company') {
    return rows.map(r => {
      const l = latest.get(r.id)
      return { id: r.id, name: r.name, tagline: fieldDisplay('company', r.id, 'tagline'), stage: fieldDisplay('company', r.id, 'stage'), hq: fieldDisplay('company', r.id, 'hq'), domain: r.domain ?? null,
        followed: !!r.followed, lastTitle: l?.title || '', lastDate: l?.at ?? null, hasUnread: !!l?.unread }
    }).sort(byFollowThenRecent)
  }
  if (type === 'firm') {
    return rows.map(r => {
      const l = latest.get(r.id)
      return { id: r.id, name: r.name, tagline: fieldDisplay('firm', r.id, 'tagline'), hq: fieldDisplay('firm', r.id, 'hq'), domain: r.domain ?? null, followed: !!r.followed, lastTitle: l?.title || '', lastDate: l?.at ?? null }
    }).sort(byFollowThenRecent)
  }
  const out: PersonListDTO[] = []
  for (const r of rows) {
    const org = personOrg(r.id)
    if (!org) continue
    const role = String(json<any>(one<{ payload_json: string }>("SELECT payload_json FROM relationships WHERE from_type = 'person' AND from_id = ? AND to_type = ? AND to_id = ? AND rel IN ('works_at','founded','partner_at') ORDER BY CASE status WHEN 'accepted' THEN 0 ELSE 1 END", r.id, org.type, org.id)?.payload_json, {}).title || '')
    const l = latest.get(r.id)
    out.push({ id: r.id, name: r.name, role, orgId: org.id, orgType: org.type, orgName: org.name, followed: !!r.followed, lastTitle: l?.title || '', lastDate: l?.at ?? null })
  }
  return out.sort(byFollowThenRecent)
}

// ---------------------------------------------------------------- actions
const SQL_DOCS_MENTIONING = `SELECT DISTINCT fi.document_id FROM relationships r JOIN feed_items fi ON fi.document_id = r.from_id
  WHERE r.from_type = 'document' AND r.rel IN ('mentions','about') AND r.to_type = ? AND r.to_id = ? AND r.status = 'accepted'`
const SQL_FIRM_COMPANIES = "SELECT to_id FROM relationships WHERE from_type = 'firm' AND from_id = ? AND rel = 'invested_in' AND to_type = 'company' AND status = 'accepted'"

export function follow(type: ObjType, id: string, on: boolean): { ok: true; followed: boolean } {
  const t = now()
  if (type === 'thesis') {
    if (!getThesis(id)) throw new AppError('NOT_FOUND', 'Thesis not found')
    run('UPDATE theses SET watching = ?, updated_at = ? WHERE id = ?', on ? 1 : 0, t, id)
    // following a thesis matches it against everything already stored again (DEC-099)
    if (on) queueMatch(id)
    emit('object.updated', { type, id })
    emit('feed.updated', { thesisId: id })
    return { ok: true, followed: on }
  }
  const e = liveEntity(type, id)
  if (!e) throw new AppError('NOT_FOUND', 'Not found')
  run(`UPDATE ${entityTable(type)} SET followed = ?, followed_at = CASE WHEN ? = 1 AND followed = 1 THEN followed_at WHEN ? = 1 THEN ? ELSE NULL END, updated_at = ? WHERE id = ?`,
    on ? 1 : 0, on ? 1 : 0, on ? 1 : 0, t, t, e.id)
  // rescore feed items mentioning the entity (followed reasons/score/group), and for a firm those of its portfolio (investor_followed)
  const docs = new Set(all<{ document_id: string }>(SQL_DOCS_MENTIONING, type, e.id).map(r => r.document_id))
  if (type === 'firm') for (const c of all<{ to_id: string }>(SQL_FIRM_COMPANIES, e.id)) for (const r of all<{ document_id: string }>(SQL_DOCS_MENTIONING, 'company', c.to_id)) docs.add(r.document_id)
  tiersChanged(type as 'company' | 'firm' | 'person', e.id, on) // DEC-096: following pulls actively; connected entities follow from the graph
  for (const d of docs) upsertFeedItem(d)
  emit('object.updated', { type, id: e.id })
  emit('feed.updated', { [type + 'Id']: e.id })
  return { ok: true, followed: on }
}

const pinKey = (type: 'company' | 'thesis') => (type === 'thesis' ? 'pins.theses' : 'pins.companies')

export function pin(type: 'company' | 'thesis', id: string, on: boolean): string[] {
  if (type === 'thesis' ? !getThesis(id) : !liveEntity('company', id)) throw new AppError('NOT_FOUND', 'Not found')
  const key = pinKey(type)
  const cur = (getSetting<string[]>(key) || []).filter(x => x !== id)
  const next = on ? [...cur, id] : cur
  setSetting(key, next)
  emit('settings.updated', { keys: [key] })
  return next
}

export function reorderPins(type: 'company' | 'thesis', ids: string[]): string[] {
  const key = pinKey(type)
  const cur = getSetting<string[]>(key) || []
  const ordered = [...new Set(ids)].filter(x => cur.includes(x))
  const next = [...ordered, ...cur.filter(x => !ordered.includes(x))]
  setSetting(key, next)
  emit('settings.updated', { keys: [key] })
  return next
}

export function markViewed(type: PageType, id: string): { ok: true } {
  const table = type === 'thesis' ? 'theses' : entityTable(type)
  const r = run(`UPDATE ${table} SET last_viewed_at = ? WHERE id = ?`, now(), id)
  if (!r.changes) throw new AppError('NOT_FOUND', 'Not found')
  return { ok: true }
}

/** Pull latest (DEC-096): one lookup for an entity that isn't followed — its coverage is read into the library; nothing
 *  is subscribed and it stays unfollowed. */
export function pullLatest(type: 'company' | 'firm' | 'person', id: string): { jobId: string; message: string } {
  const e = liveEntity(type, id)
  if (!e) throw new AppError('NOT_FOUND', 'Not found')
  return { jobId: startHydrate(type, e.id, { once: true }), message: `Looking for the latest on ${e.name}…` }
}
