// PROCESS_DOCUMENT (RFC §1B.9 steps 7–15): daily cap / usage guard → TRIAGE → EXTRACT → verify quotes → resolve
// entities → persist evidence, relationships, field values (one transaction, with §1B.9.7 supersession) → INTERPRET →
// feed gate → processed → EVALUATE_ALERTS.
import crypto from 'node:crypto'
import { all, one, run, tx, json } from '../db'
import { newId } from '../ids'
import { now, localMidnight, nextLocalMidnight } from '../clock'
import { registerJob, onJobFailure, enqueue } from '../jobs'
import { emit } from '../events'
import { AppError, ParkJob } from '../errors'
import { getSetting, setSetting } from '../settings'
import { log } from '../log'
import { upsertFeedItem, regate, liveSourcesOf, isUserAdded, firstSentences } from '../feed'
import { setRegateHook, enqueueProcess } from './pipeline'
import { locateQuote, sentenceContaining } from './quotes'
import { runTask, annotateRun } from '../ai/runtime'
import { readAuth } from '../ai/codex-auth'
import { usagePauseUntil } from '../ai/provider'
import { groundingCheck, groundProse } from '../ai/grounding'
import { TRIAGE, EXTRACT, INTERPRET, SAME_ENTITY, bearsOnThesis, SELF_DENIAL, type ExtractValue, type InterpretValue } from '../ai/tasks/document'
import { plan, apply, normalizeName, type Mention, type Decision, type EntityType } from '../entities/resolve'
import { upsertSourceFact, upsertSuggestion, recomputeStatus, relsSupportedBy, docPairRejected } from '../entities/relationships'
import { writeSourceValue, resolveCurrent, activeFieldDefs, fieldDef, normalizeValue } from '../entities/fields'
import { guardEntities, groundPeople, personSupport, junkQuote, stageSupported, roundSupported, FOUNDER_WORDS, type DocCtx } from './entity-guards'
import { registrableDomain } from './url'
import { eventDateOf } from './event-date'
import { userContext } from '../objects/details'

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'its', 'it', 'by', 'with', 'as', 'at', 'that', 'this', 'from', 'be', 'will', 'said'])
const SUMMARY_SENTENCES: Record<string, number> = { Short: 1, Medium: 2, Long: 4 }

interface Doc { id: string; title: string; url: string | null; text: string; status: string; current_version: number; ai_generation: number; metadata_json: string; published_at: number | null; author: string | null; site_name: string | null }

export function registerProcess(): void {
  setRegateHook((docId, srcId) => regate(docId, srcId, d => enqueueProcess(d, { skipTriage: true, priority: 2 })))
  registerJob('PROCESS_DOCUMENT', job => processDocument(job.payload as any, job.id))
  onJobFailure((job, code, message, final) => {
    if (job.type !== 'PROCESS_DOCUMENT' || !final) return
    const id = job.payload.documentId
    run("UPDATE documents SET status = 'failed', processing_error = ?, updated_at = ? WHERE id = ? AND status <> 'pending_capture'", code === 'AI_INVALID' ? 'Couldn’t extract evidence. Retry' : message, now(), id)
    emit('feed.updated', { documentId: id })
  })
}

function dayKey(): string { const d = new Date(localMidnight()); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` }
function capCount(): number { const c = getSetting<{ day: string; n: number } | null>('processing.count'); return c && c.day === dayKey() ? c.n : 0 }
/** Articles read today (Settings shows it next to the limit). */
export const readToday = (): number => capCount()
/** "Read the rest now" / a raised limit: articles parked by the limit run now. */
export function releaseCapParked(liftToday: boolean): number {
  if (liftToday) setSetting('processing.cap_lifted_day', dayKey())
  const n = all<{ id: string }>("SELECT id FROM jobs WHERE status = 'queued' AND type = 'PROCESS_DOCUMENT' AND error_code = 'PARKED' AND error_message = 'daily_cap'").length
  run("UPDATE jobs SET run_after = ?, error_code = NULL, error_message = NULL WHERE status = 'queued' AND type = 'PROCESS_DOCUMENT' AND error_code = 'PARKED' AND error_message = 'daily_cap'", now())
  emit('banner.updated', {})
  return n
}
function bumpCap(): void { setSetting('processing.count', { day: dayKey(), n: capCount() + 1 }) }

function fingerprint(kind: string, subjectId: string, payload: any, claim: string): string {
  let key: string
  if (kind === 'funding') {
    const amt = typeof payload.amountUsd === 'number' && payload.amountUsd > 0 ? Number(payload.amountUsd.toPrecision(2)) : 'na'
    key = `${String(payload.round || '').toLowerCase()}|${amt}`
  } else if (kind === 'investment') key = `${payload.firmId || ''}|${payload.companyId || ''}|${String(payload.round || '').toLowerCase()}`
  else if (kind === 'executive_change') key = `${payload.personId || String(payload.person || '').toLowerCase()}|${String(payload.title || '').toLowerCase()}`
  else key = claim.toLowerCase().replace(/[^a-z0-9$%. ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)).slice(0, 12).join(' ')
  return crypto.createHash('sha1').update(`${kind}|${subjectId}|${key}`).digest('hex')
}

export async function processDocument(p: { documentId: string; version: number; generation: number; sourceId?: string; skipTriage?: boolean }, jobId?: string): Promise<unknown> {
  const doc = one<Doc>('SELECT id, title, url, text, status, current_version, ai_generation, metadata_json, published_at, author, site_name FROM documents WHERE id = ? AND deleted_at IS NULL', p.documentId)
  if (!doc || doc.current_version > p.version || doc.ai_generation > p.generation) return { obsolete: true }
  if (doc.status === 'pending_capture' || doc.status === 'duplicate') return { skipped: doc.status }
  const meta = json<any>(doc.metadata_json, {})
  const processedVersion: number | null = meta.processedVersion ?? null
  const processedGeneration: number | null = meta.processedGeneration ?? null
  const generationOnly = processedVersion === p.version && processedGeneration != null && processedGeneration < p.generation
  const newVersion = processedVersion != null && processedVersion < p.version
  const sources = liveSourcesOf(doc.id)
  const manual = isUserAdded(doc.id)

  if (readAuth().status !== 'ok') throw new AppError('AI_UNAVAILABLE', 'No ChatGPT sign-in found for Codex on this Mac')
  const until = usagePauseUntil()
  if (until) throw new ParkJob(until, 'ai_usage')
  // the daily reading limit (Settings → Processing; DEC-101): 0 / unset = no limit — the ChatGPT usage stop does the
  // braking; "Read the rest now" lifts it for the rest of the day
  const cap = Number(getSetting('processing.daily_cap') ?? 0)
  const lifted = getSetting('processing.cap_lifted_day') === dayKey()
  if (cap > 0 && !lifted && !manual && !generationOnly && capCount() >= cap) { emit('banner.updated', {}); throw new ParkJob(nextLocalMidnight(), 'daily_cap') }

  run("UPDATE documents SET status = 'processing', updated_at = ? WHERE id = ?", now(), doc.id)
  const firstSource = sources.find(s => s.id === p.sourceId) || sources.find(s => s.kind !== 'manual') || sources[0]
  const research = String(getSetting('research_instruction') || '')
  const followed = [
    ...all<{ name: string }>('SELECT name FROM companies WHERE followed = 1 AND merged_into_id IS NULL AND deleted_at IS NULL'),
    ...all<{ name: string }>('SELECT name FROM firms WHERE followed = 1 AND merged_into_id IS NULL AND deleted_at IS NULL'),
    ...all<{ name: string }>('SELECT name FROM people WHERE followed = 1 AND merged_into_id IS NULL AND deleted_at IS NULL'),
    // what a followed company/firm is also called ("Acme Code", a former name) so extraction recognises it (DEC-088)
    ...all<{ name: string }>(`SELECT a.alias || ' (= ' || COALESCE(c.name, f.name) || ')' AS name FROM aliases a LEFT JOIN companies c ON a.entity_type = 'company' AND c.id = a.entity_id AND c.followed = 1
       LEFT JOIN firms f ON a.entity_type = 'firm' AND f.id = a.entity_id AND f.followed = 1 WHERE COALESCE(c.name, f.name) IS NOT NULL AND lower(a.alias) <> lower(COALESCE(c.name, f.name))`)
  ].map(r => r.name).slice(0, 200)
  // what the user says a followed entity is (DEC-099): "Cua — you: computer-use agent infrastructure", so triage and
  // interpretation can tell it from namesakes
  const described = new Map(all<{ name: string; about: string }>(`SELECT COALESCE(c.name, f.name, p.name) name, d.about FROM object_details d
    LEFT JOIN companies c ON d.object_type = 'company' AND c.id = d.object_id AND c.followed = 1 AND c.merged_into_id IS NULL
    LEFT JOIN firms f ON d.object_type = 'firm' AND f.id = d.object_id AND f.followed = 1 AND f.merged_into_id IS NULL
    LEFT JOIN people p ON d.object_type = 'person' AND p.id = d.object_id AND p.followed = 1 AND p.merged_into_id IS NULL
    WHERE d.about <> '' AND COALESCE(c.name, f.name, p.name) IS NOT NULL`).map(r => [r.name, r.about.slice(0, 140)]))
  for (let i = 0; i < followed.length; i++) if (described.has(followed[i])) followed[i] = `${followed[i]} — you: ${described.get(followed[i])}`
  const theses = all<{ id: string; title: string; description: string; current_view: string }>('SELECT id, title, description, current_view FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL ORDER BY sort_order')

  // 8 triage
  const decisive = manual || sources.some(s => s.mode === 'all' || s.trust === 'primary')
  if (!p.skipTriage && !decisive && processedVersion == null) {
    const cfg = json<any>(one<{ config_json: string }>('SELECT config_json FROM sources WHERE id = ?', firstSource?.id || '')?.config_json, {})
    try {
      const tr = await runTask(TRIAGE, { title: doc.title, text: doc.text, sourceInstruction: firstSource?.instruction || '', include: cfg.relevance?.include || [], exclude: cfg.relevance?.exclude || [], researchInstruction: research, followed, theses: theses.map(t => t.title) }, { jobId })
      if (!tr.value.relevant) {
        run("UPDATE documents SET status = 'triaged_out', metadata_json = json_set(metadata_json, '$.triage', json(?)), updated_at = ? WHERE id = ?", JSON.stringify(tr.value), now(), doc.id)
        emit('document.ingested', { documentId: doc.id })
        return { triagedOut: true }
      }
    } catch (e) {
      if (e instanceof AppError && (e.code === 'AI_UNAVAILABLE')) throw e
      if (e instanceof AppError && e.code === 'RATE_LIMITED') throw new ParkJob(Number(e.extra.until) || now() + 900_000, 'rate_limited')
      log.warn('process', 'triage failed; treating as relevant', { documentId: doc.id })
    }
  }

  // 9 extract
  const fieldDefs = activeFieldDefs().filter(f => f.object_type !== 'thesis').map(f => ({ objectType: f.object_type, key: f.key, label: f.label, valueType: f.value_type, enumValues: json<string[] | null>(f.enum_values_json, null), instruction: f.builtin ? '__builtin__' : f.extraction_instruction }))
  let ex
  try {
    if (!manual && !generationOnly) bumpCap()
    ex = await runTask(EXTRACT, { title: doc.title, url: doc.url, author: doc.author, siteName: doc.site_name, trust: firstSource?.trust || 'editorial', text: doc.text, fieldDefs }, { jobId })
  } catch (e) {
    if (e instanceof AppError && e.code === 'RATE_LIMITED') throw new ParkJob(Number(e.extra.until) || now() + 900_000, 'rate_limited')
    if (e instanceof AppError && e.code === 'AI_INVALID') {
      run("UPDATE documents SET status = 'failed', processing_error = 'Couldn’t extract evidence. Retry', updated_at = ? WHERE id = ?", now(), doc.id)
      upsertFeedItemSafe(doc.id)
      emit('feed.updated', { documentId: doc.id })
    }
    throw e
  }

  // 10–11 verify quotes, plan entity resolution (may call RESOLVE_ENTITY)
  orgSubjects(ex.value, doc.id)
  const ctx = docContext(doc)
  const guard = guardEntities(ex.value, ctx)
  groundPeople(ex.value, ctx)
  const mentions = collectMentions(ex.value, doc.text, guard.typeOf)
  const decisions = new Map<string, Decision>()
  for (const m of mentions.values()) decisions.set(mkey(m.type, m.name), await plan(m, jobId))
  // an entity the user described (or wrote notes on) is matched only when this document is about that one (DEC-099):
  // a namesake — another "Cua", an article their note says is about a different Makora — gets its own entity
  const notThis: string[] = []
  const notThisKeys = new Set<string>()
  for (const [k, d] of decisions) {
    if (d.kind !== 'match') continue
    const m = mentions.get(k)!
    if (m.type !== 'company' && m.type !== 'firm' && m.type !== 'person') continue
    const ctx = userContext(m.type, d.id)
    if (!ctx) continue
    const name = one<{ name: string }>(`SELECT name FROM ${m.type === 'company' ? 'companies' : m.type === 'firm' ? 'firms' : 'people'} WHERE id = ?`, d.id)?.name || m.name
    try {
      const r = await runTask(SAME_ENTITY, { name: m.name, type: m.type, documentTitle: doc.title || '', context: m.context.slice(0, 1500), described: { name, about: ctx.about, website: ctx.website, otherNames: ctx.otherNames, notes: ctx.notes } }, { jobId })
      // not linked at all: a second entity with the same name would catch this name in every later article
      if (!r.value.same && r.value.confidence >= 0.6) { notThis.push(`${m.name}: ${r.value.why}`); notThisKeys.add(k) }
    } catch (e) { log.warn('process', 'SAME_ENTITY failed; keeping the match', { err: String(e) }) }
  }
  for (const k of notThisKeys) { mentions.delete(k); decisions.delete(k) }

  // 12 persist (one transaction) — aborts if a newer version/generation appeared meanwhile
  const persisted = tx(() => persistExtraction(doc.id, p.version, p.generation, ex.value, mentions, decisions, ex.runId, { generationOnly, newVersion }))
  if (!persisted) return { obsolete: true }
  annotateRun(ex.runId, { notThis, dropped: persisted.dropped, claimsReplaced: persisted.claimsReplaced, rejectedEntities: guard.rejected, sharedEvidence: persisted.shared })

  // 13 interpret
  const suggest = getSetting('ai.suggest') !== false
  // this document's facts: its own rows plus rows it shares with an earlier copy of the same claim (dedupe)
  const evidenceForInterp = persisted.supportIds.length ? all<{ id: string; claim: string; kind: string }>(`SELECT id, claim, kind FROM evidence WHERE id IN (${persisted.supportIds.map(() => '?').join(',')}) AND status = 'active' ORDER BY confidence DESC LIMIT 40`, ...persisted.supportIds) : []
  const entityNames = [...new Set([...mentions.values()].map(m => m.name))]
  let interp: InterpretValue | null = null
  try {
    const r = await runTask(INTERPRET, {
      title: doc.title, summarySentences: SUMMARY_SENTENCES[String(getSetting('ai.summary_len') || 'Medium')] ?? 2, evidence: evidenceForInterp, entities: entityNames,
      theses: theses.map(t => ({ id: t.id, title: t.title, description: t.description, currentView: t.current_view })), followed, sourceInstruction: firstSource?.instruction || '', researchInstruction: research, text: doc.text, suggest
    }, { jobId })
    interp = r.value
  } catch (e) {
    if (e instanceof AppError && e.code === 'AI_UNAVAILABLE') throw e
    if (e instanceof AppError && e.code === 'RATE_LIMITED') throw new ParkJob(Number(e.extra.until) || now() + 900_000, 'rate_limited')
    log.warn('process', 'interpret failed; using fallback', { documentId: doc.id, err: String(e) })
  }
  const stillCurrent = one<{ current_version: number; ai_generation: number }>('SELECT current_version, ai_generation FROM documents WHERE id = ?', doc.id)
  if (!stillCurrent || stillCurrent.current_version !== p.version || stillCurrent.ai_generation !== p.generation) return { obsolete: true }
  tx(() => persistInterpretation(doc, p.generation, interp, theses.map(t => t.title), sources.map(s => s.name), entityNames, suggest, persisted.supportIds))

  // 14–15 feed gate, processed
  tx(() => {
    run("UPDATE documents SET status = 'processed', processing_error = NULL, metadata_json = json_set(json_set(metadata_json, '$.processedVersion', ?), '$.processedGeneration', ?), updated_at = ? WHERE id = ?", p.version, p.generation, now(), doc.id)
    upsertFeedItem(doc.id, { resurface: newVersion && persisted.novelAny, generationOnly })
  })
  emit('document.ingested', { documentId: doc.id })
  emit('feed.updated', { documentId: doc.id })
  emit('object.updated', {})
  retryForPeople(doc.id, persisted.unknownPeople)
  if (!generationOnly) enqueue('EVALUATE_ALERTS', { documentId: doc.id, generation: p.generation, version: p.version }, { idempotencyKey: `alerts:${doc.id}:${p.version}:${p.generation}`, priority: 3 })
  return { processed: true, evidence: persisted.inserted, dropped: persisted.dropped }
}

function upsertFeedItemSafe(docId: string): void { try { if (isUserAdded(docId)) upsertFeedItem(docId) } catch { /* ignore */ } }

const mkey = (type: string, name: string) => `${type}:${normalizeName(name)}`

/**
 * People exist only attached to a company or firm (DEC-020). Evidence whose subject is a person the model didn't list
 * under people (e.g. an essay's author) is re-subjected to that person's org from the payload, keeping attributedTo,
 * instead of being dropped.
 */
/**
 * A VC-blog post can name only its author (e.g. a partner's essay) before any sibling post ties that person to the
 * firm, so evidence about the author is dropped (people exist only attached, DEC-020). Such a document is processed
 * once more, at the back of the queue, after its siblings have introduced the person and linked the firm's domain.
 */
function retryForPeople(docId: string, unknownPeople: number): void {
  if (!unknownPeople) return
  const d = one<{ metadata_json: string }>('SELECT metadata_json FROM documents WHERE id = ?', docId)
  if (!d || json<any>(d.metadata_json, {}).peopleRetry) return
  if (!one("SELECT 1 FROM document_sources ds JOIN sources s ON s.id = ds.source_id WHERE ds.document_id = ? AND s.type_label = 'VC blog'", docId)) return
  run("UPDATE documents SET metadata_json = json_set(metadata_json, '$.peopleRetry', 1), ai_generation = ai_generation + 1, updated_at = ? WHERE id = ?", now(), docId)
  enqueueProcess(docId, { skipTriage: true, priority: 9 })
}

/** The firm that owns the VC-blog source this document came from (by site domain), if known. */
function publisherFirmName(docId: string): string {
  return one<{ name: string }>(`SELECT f.name FROM document_sources ds JOIN sources s ON s.id = ds.source_id JOIN firms f ON f.domain = s.site_domain
    WHERE ds.document_id = ? AND s.type_label = 'VC blog' AND f.merged_into_id IS NULL AND f.deleted_at IS NULL LIMIT 1`, docId)?.name || ''
}

/**
 * Who published this document, for the entity guards (DEC-092): its site name, the domain label and the names of
 * sources on that same site; `ownSite` when it is a company/VC blog or a library entity owns the domain (then the
 * publisher is a legitimate subject — Linear on linear.app).
 */
function docContext(doc: Doc): DocCtx {
  const srcs = all<{ name: string; type_label: string; site_domain: string | null }>('SELECT s.name, s.type_label, s.site_domain FROM document_sources ds JOIN sources s ON s.id = ds.source_id WHERE ds.document_id = ?', doc.id)
  const dom = doc.url ? registrableDomain(doc.url) : ''
  const owned = !!dom && (!!one('SELECT 1 FROM companies WHERE domain = ? AND merged_into_id IS NULL AND deleted_at IS NULL', dom) || !!one('SELECT 1 FROM firms WHERE domain = ? AND merged_into_id IS NULL AND deleted_at IS NULL', dom))
  const ownSite = owned || srcs.some(s => (s.type_label === 'Company blog' || s.type_label === 'VC blog') && (!s.site_domain || s.site_domain === dom))
  const publisherNames = [doc.site_name || '', dom.split('.')[0] || '', ...srcs.filter(s => s.site_domain && s.site_domain === dom).map(s => s.name)].filter(Boolean)
  return { text: doc.text, title: doc.title, byline: doc.author, publisherNames, ownSite, publisherFirm: publisherFirmName(doc.id) }
}

function orgSubjects(v: ExtractValue, docId: string): void {
  const listed = new Set(v.people.map(pp => normalizeName(pp.name)))
  for (const e of v.evidence) {
    if (e.subject.type !== 'person' || listed.has(normalizeName(e.subject.name))) continue
    if (one("SELECT 1 FROM people WHERE normalized_name = ? AND merged_into_id IS NULL AND deleted_at IS NULL", normalizeName(e.subject.name))) continue
    const org = (e.payload.org || e.payload.firm || e.payload.company || '').trim() || publisherFirmName(docId)
    if (!org) continue
    const isCompany = v.companies.some(c => normalizeName(c.name) === normalizeName(org)) || (!!e.payload.company && !e.payload.firm && !e.payload.org)
    e.attributedTo = e.attributedTo || e.subject.name
    e.subject = { type: isCompany ? 'company' : 'firm', name: org }
  }
}

function collectMentions(v: ExtractValue, text: string, typeOf: (name: string) => 'company' | 'firm'): Map<string, Mention> {
  const out = new Map<string, Mention>()
  const ctx = (name: string) => { const s = sentenceContaining(text, name); return s ? text.slice(s.start, s.end) : text.slice(0, 400) }
  const add = (type: EntityType, name: string | null | undefined, extra: Partial<Mention> = {}) => {
    const n = (name || '').trim()
    if (!n || n.length < 2) return
    const k = mkey(type, n)
    const ex = out.get(k)
    if (ex) { ex.aliases = [...new Set([...(ex.aliases || []), ...(extra.aliases || [])])]; ex.domain = ex.domain || extra.domain; return }
    out.set(k, { type, name: n, context: ctx(n), domain: extra.domain ?? null, aliases: extra.aliases || [] })
  }
  for (const c of v.companies) add('company', c.name, { domain: c.domain, aliases: c.aliases })
  for (const f of v.firms) add('firm', f.name, { domain: f.domain, aliases: f.aliases })
  // payload names take the type the guards decided (a corporation investing stays a company, DEC-092)
  for (const e of v.evidence) {
    const pl = e.payload
    if (e.subject.type !== 'person') add(e.subject.type, e.subject.name)
    if (pl.company) add(typeOf(pl.company), pl.company)
    if (pl.firm) add(typeOf(pl.firm), pl.firm)
    for (const n of [...pl.leadInvestors, ...pl.participants]) add(typeOf(n), n)
  }
  for (const f of v.fields) add(f.objectType, f.objectName)
  // people only when their org resolves to a company/firm (DEC-020)
  for (const pp of v.people) { add(pp.orgType, pp.org); add('person', pp.name) }
  // a person subject counts when listed with an org in this document or already known (attached) in the library
  const known = (name: string) => !!one("SELECT 1 FROM people WHERE normalized_name = ? AND merged_into_id IS NULL AND deleted_at IS NULL", normalizeName(name))
  for (const e of v.evidence) if (e.subject.type === 'person' && (v.people.some(pp => normalizeName(pp.name) === normalizeName(e.subject.name)) || known(e.subject.name))) add('person', e.subject.name)
  return out
}

interface PersistResult { inserted: number; dropped: number; claimsReplaced: number; novelAny: boolean; newIds: string[]; supportIds: string[]; shared: number; unknownPeople: number }

/**
 * A VC firm's own blog names the firm but rarely prints its web address. When a document from a "VC blog" source on
 * site D mentions exactly one firm and no firm owns D yet, that firm is the publisher: give it domain D, so its page
 * shows the blog's writing, partner commentary and source.
 */
function linkPublisherFirm(docId: string, firmIds: string[]): void {
  const uniq = [...new Set(firmIds)]
  if (uniq.length !== 1) return
  const src = one<{ site_domain: string | null }>(`SELECT s.site_domain FROM document_sources ds JOIN sources s ON s.id = ds.source_id
    WHERE ds.document_id = ? AND s.type_label = 'VC blog' AND s.site_domain IS NOT NULL AND s.deleted_at IS NULL LIMIT 1`, docId)
  if (!src?.site_domain) return
  if (one('SELECT 1 FROM firms WHERE domain = ? AND merged_into_id IS NULL AND deleted_at IS NULL', src.site_domain)) return
  run('UPDATE firms SET domain = ?, updated_at = ? WHERE id = ? AND domain IS NULL', src.site_domain, now(), uniq[0])
}

/** A first-person or generic holder ("the authors", "we") is the document's byline author when there is one. */
const GENERIC_HOLDER = /^(the )?(author|authors|byline|byline author|writer|writers|we|us|our team|the team|the firm|this post|the post|the article|i|publisher|site|site's organization|organization|blog)$/i
function attribution(who: string | null, byline: string | null): string | null {
  if (!who) return byline
  return GENERIC_HOLDER.test(who.trim()) && byline ? byline : who
}

function persistExtraction(docId: string, version: number, generation: number, v: ExtractValue, mentions: Map<string, Mention>, decisions: Map<string, Decision>, runId: string, o: { generationOnly: boolean; newVersion: boolean }): PersistResult | null {
  const d = one<{ current_version: number; ai_generation: number; text: string; published_at: number | null }>('SELECT current_version, ai_generation, text, published_at FROM documents WHERE id = ?', docId)!
  if (d.current_version !== version || d.ai_generation !== generation) return null
  const text = d.text
  const t = now()
  const byline = one<{ author: string | null }>('SELECT author FROM documents WHERE id = ?', docId)?.author?.trim() || null

  // (1) supersede prior AI evidence (any earlier version or generation); keep user evidence
  const prior = all<{ id: string; fingerprint: string | null; kind: string; payload_json: string; claim: string }>(
    "SELECT id, fingerprint, kind, payload_json, claim FROM evidence WHERE document_id = ? AND origin = 'ai_extraction' AND kept = 0 AND status = 'active'", docId)
  const priorFields = prior.length ? all<{ object_type: string; object_id: string; field_key: string }>(`SELECT DISTINCT object_type, object_id, field_key FROM field_values WHERE evidence_id IN (${prior.map(() => '?').join(',')})`, ...prior.map(x => x.id)) : []
  if (prior.length) {
    const ids = prior.map(x => x.id)
    run(`UPDATE evidence SET status = 'superseded', updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`, t, ...ids)
    run(`UPDATE relationship_evidence SET status = 'superseded' WHERE evidence_id IN (${ids.map(() => '?').join(',')})`, ...ids)
    recomputeStatus(relsSupportedBy(ids))
  }
  const supersededFp = new Map(prior.map(x => [x.fingerprint, x.id]))
  // (2) re-anchor kept/highlight evidence in the current text
  for (const k of all<{ id: string; quote: string }>("SELECT id, quote FROM evidence WHERE document_id = ? AND (kept = 1 OR origin = 'user_highlight') AND status IN ('active','orphaned')", docId)) {
    const loc = locateQuote(text, k.quote)
    if (loc) run("UPDATE evidence SET document_version = ?, quote_start = ?, quote_end = ?, quote = ?, status = 'active', updated_at = ? WHERE id = ?", version, loc.start, loc.end, text.slice(loc.start, loc.end), t, k.id)
    else run("UPDATE evidence SET status = 'orphaned', updated_at = ? WHERE id = ?", t, k.id)
  }
  if (prior.length || o.newVersion) recomputeStatus(all<{ relationship_id: string }>(`SELECT DISTINCT re.relationship_id FROM relationship_evidence re JOIN evidence e ON e.id = re.evidence_id WHERE e.document_id = ?`, docId).map(r => r.relationship_id))

  // (3) resolve entities
  const ids = new Map<string, string>()
  for (const [k, m] of mentions) ids.set(k, apply(m, decisions.get(k) || { kind: 'create' }))
  const idOf = (type: string, name: string | null | undefined) => (name ? ids.get(mkey(type, name)) : undefined)
  const nameOf = (type: string, id: string) => one<{ name: string }>(`SELECT name FROM ${type === 'company' ? 'companies' : type === 'firm' ? 'firms' : 'people'} WHERE id = ?`, id)?.name || ''
  linkPublisherFirm(docId, [...mentions.entries()].filter(([, m]) => m.type === 'firm').map(([k]) => ids.get(k)).filter(Boolean) as string[])

  // (4) evidence — one visible row per (claim, quote): an identical claim on the same quote in this document is one row
  // shared by its subjects (a round's funding item and each investor's investment item), and a claim+quote already
  // recorded for the same subject by another document (syndicated copy, duplicate article) is not recorded again —
  // this document is linked to that row as additional support (DEC-092).
  let dropped = 0, claimsReplaced = 0, novelAny = false, unknownPeople = 0, shared = 0
  const newIds: string[] = []                 // rows this document inserted
  const supportIds: string[] = []             // rows supporting this document's facts (inserted + shared)
  const own = new Map<string, { start: number; end: number; quote: string }>()
  const usedSpans = new Map<string, string>()
  const byClaim = new Map<string, string>()   // `${start}:${end}|claim` → id
  const claimKey = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}$%.]+/gu, ' ').trim()
  const insertEvidence = (e: { kind: string; assertion: string; claim: string; start: number; end: number; attributedTo: string | null; eventDate: string | null; payload: any; subjectType: string; subjectId: string; confidence: number }): string => {
    const quote = text.slice(e.start, e.end)
    const dupKey = `${e.start}:${e.end}|${claimKey(e.claim)}`
    const same = byClaim.get(dupKey)
    if (same) return same
    const fp = fingerprint(e.kind, e.subjectId, e.payload, e.claim)
    if (!o.generationOnly) {
      // the subject's facts from other documents (via its "about" links), whatever kind the model gave them
      const elsewhere = all<{ id: string; claim: string; quote: string }>(`SELECT e.id, e.claim, e.quote FROM relationships r JOIN evidence e ON e.id = r.from_id
          WHERE r.to_type = ? AND r.to_id = ? AND r.rel = 'about' AND r.from_type = 'evidence' AND e.status = 'active' AND e.document_id <> ?`, e.subjectType, e.subjectId, docId)
        .find(r => claimKey(r.claim) === claimKey(e.claim) && claimKey(r.quote) === claimKey(quote))
      if (elsewhere) { byClaim.set(dupKey, elsewhere.id); if (!supportIds.includes(elsewhere.id)) supportIds.push(elsewhere.id); shared++; return elsewhere.id }
    }
    let isNovel = 1
    let previous: string | null = null
    if (o.generationOnly) isNovel = 0
    else {
      if (supersededFp.has(fp)) isNovel = 0
      else if (one("SELECT 1 FROM evidence WHERE fingerprint = ? AND status = 'active' AND document_id <> ? AND created_at >= ?", fp, docId, t - 120 * 86400_000)) isNovel = 0
      if (isNovel && o.newVersion) {
        const prev = prior.find(x => x.kind === e.kind && JSON.parse(x.payload_json || '{}').subjectId === e.subjectId && x.fingerprint !== fp)
        if (prev) previous = prev.id
      }
    }
    const id = newId('ev')
    run(`INSERT INTO evidence(id, document_id, document_version, origin, kind, assertion, claim, quote, quote_start, quote_end, attributed_to, event_date, payload_json, fingerprint, is_novel, confidence, kept, status, ai_generation, created_at, updated_at)
         VALUES (?, ?, ?, 'ai_extraction', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)`,
      id, docId, version, e.kind, e.assertion, e.claim, quote, e.start, e.end, e.attributedTo, e.eventDate, JSON.stringify({ ...e.payload, subjectId: e.subjectId, subjectType: e.subjectType, ...(previous ? { previousEvidenceId: previous } : {}) }), fp, isNovel, e.confidence, generation, t, t)
    if (isNovel) novelAny = true
    newIds.push(id); supportIds.push(id)
    own.set(id, { start: e.start, end: e.end, quote })
    byClaim.set(dupKey, id)
    usedSpans.set(`${e.start}:${e.end}`, id)
    return id
  }
  const quoteOf = (id: string) => own.get(id)?.quote ?? one<{ quote: string }>('SELECT quote FROM evidence WHERE id = ?', id)?.quote ?? ''

  for (const e of v.evidence) {
    const loc = locateQuote(text, e.quote)
    if (!loc) { dropped++; continue }
    const subjectId = idOf(e.subject.type, e.subject.name)
    if (!subjectId) { dropped++; if (e.subject.type === 'person') unknownPeople++; continue }
    const quote = text.slice(loc.start, loc.end)
    if (junkQuote(quote)) { dropped++; continue }        // a URL, byline or bare name is not a fact
    const pl = e.payload
    const payload: any = {}
    for (const [k, val] of Object.entries(pl)) if (val !== null && !(Array.isArray(val) && !val.length)) payload[k] = val
    // a funding round name (→ funding table, latest round) the quote doesn't state is dropped; the fact stands
    if (e.kind === 'funding' && payload.round && !roundSupported(String(payload.round), quote)) delete payload.round
    const round = payload.round ?? null
    const companyId = idOf('company', pl.company) || (e.subject.type === 'company' ? subjectId : undefined)
    const firmId = idOf('firm', pl.firm) || (e.subject.type === 'firm' ? subjectId : undefined)
    if (companyId) payload.companyId = companyId
    if (firmId) payload.firmId = firmId
    if (pl.person) { const pid = idOf('person', pl.person); if (pid) payload.personId = pid }
    // an investor the guards typed as a company (a corporation investing) keeps its name in the payload only
    if (pl.leadInvestors.length) payload.leadInvestorIds = pl.leadInvestors.map(n => idOf('firm', n)).filter(Boolean)
    if (pl.participants.length) payload.participantIds = pl.participants.map(n => idOf('firm', n)).filter(Boolean)
    let claim = e.claim.trim()
    // opinions keep their holder in attributed_to (shown as "X argues: …"), so a leading "X believes that" is dropped
    if (e.assertion === 'attributed_opinion') claim = claim.replace(/^[\p{Lu}][\p{L}.'’& -]{1,60}?\s+(?:believes|argues|says|said|thinks|expects|predicts|writes|contends)(?:\s+that)?\s+/u, '').replace(/^\p{Ll}/u, c => c.toUpperCase())
    // every stored claim is grounded in its own quote alone (E2E-GRD-03); otherwise the verbatim quote stands in
    // …except that it may name its own subject, which the quote may call "the startup" or "it" (the subject is linked anyway)
    if (!groundingCheck(claim, [quote], { allowedNames: [e.subject.name] }).ok) { claim = quote; claimsReplaced++ }
    const evId = insertEvidence({ kind: e.kind, assertion: e.assertion, claim, start: loc.start, end: loc.end, attributedTo: attribution(e.attributedTo, byline), eventDate: eventDateOf(e.eventDate, quote, d.published_at), payload, subjectType: e.subject.type, subjectId, confidence: 0.8 })
    // (5) relationships from the fact
    if (!docPairRejected(docId, e.subject.type, subjectId)) upsertSourceFact('evidence', evId, 'about', e.subject.type, subjectId, evId)
    const leads = (payload.leadInvestorIds || []) as string[]
    const parts = (payload.participantIds || []) as string[]
    if (e.kind === 'funding' && companyId) {
      for (const f of leads) upsertSourceFact('firm', f, 'invested_in', 'company', companyId, evId, { role: 'lead', round })
      for (const f of parts) if (!leads.includes(f)) upsertSourceFact('firm', f, 'invested_in', 'company', companyId, evId, { ...(getRolePayload('firm', f, companyId) || { role: 'participant' }), round })
    }
    if (e.kind === 'investment' && firmId && companyId) {
      const role = pl.role || 'unknown'
      const prevRole = getRolePayload('firm', firmId, companyId)?.role
      upsertSourceFact('firm', firmId, 'invested_in', 'company', companyId, evId, { role: prevRole === 'lead' ? 'lead' : role, round })
      if (!docPairRejected(docId, 'firm', firmId) && e.subject.type !== 'firm') upsertSourceFact('evidence', evId, 'about', 'firm', firmId, evId)
    }
  }

  // people and their org relationships — the tie must be stated: support is a fact quote naming them, else a sentence
  // naming them with their org or role (never a byline/credit line); "founded" only when that support says so
  for (const pp of v.people) {
    const pid = idOf('person', pp.name), orgId = idOf(pp.orgType, pp.org)
    if (!pid || !orgId) continue
    const title = (pp.title || '').trim()
    let support = supportIds.find(id => { const q = quoteOf(id); return q.toLowerCase().includes(pp.name.toLowerCase()) && (q.toLowerCase().includes(pp.org.toLowerCase()) || !!title && q.toLowerCase().includes(title.toLowerCase().split(/[\s,]+/)[0])) })
    if (!support) {
      const s = personSupport(text, pp.name, pp.org, title || null)
      if (s && !junkQuote(text.slice(s.start, s.end))) support = usedSpans.get(`${s.start}:${s.end}`) || insertEvidence({ kind: 'other', assertion: 'fact', claim: text.slice(s.start, s.end), start: s.start, end: s.end, attributedTo: null, eventDate: null, payload: { subject: pp.name, detail: title || null, personId: pid }, subjectType: 'person', subjectId: pid, confidence: 0.7 })
    }
    if (!support) continue
    const founder = /founder/i.test(title) && FOUNDER_WORDS.test(quoteOf(support))
    const rel = pp.orgType === 'firm' && /partner|principal|general partner|managing director|investor/i.test(title) ? 'partner_at' : founder ? 'founded' : pp.orgType === 'firm' && !title ? 'partner_at' : 'works_at'
    upsertSourceFact('person', pid, rel as any, pp.orgType, orgId, support, { title: title || null })
    upsertSourceFact('evidence', support, 'about', 'person', pid, support)
  }

  // document-level mentions/about
  for (const [k, m] of mentions) {
    const id = ids.get(k)!
    if (docPairRejected(docId, m.type, id)) continue
    const supporting = supportIds.filter(eid => {
      const r = one<{ quote: string; payload_json: string }>('SELECT quote, payload_json FROM evidence WHERE id = ?', eid)!
      return r.payload_json.includes(id) || r.quote.toLowerCase().includes(m.name.toLowerCase())
    })
    const isSubject = supportIds.some(eid => JSON.parse(one<{ payload_json: string }>('SELECT payload_json FROM evidence WHERE id = ?', eid)!.payload_json).subjectId === id)
    if (supporting.length) for (const s of supporting) upsertSourceFact('document', docId, isSubject ? 'about' : 'mentions', m.type, id, s)
    else upsertSourceFact('document', docId, 'mentions', m.type, id, null)
  }
  // a re-read that no longer finds an entity (or found the mention is a namesake, SAME_ENTITY) leaves no link to it from
  // this document; the user's own links stay (DEC-099)
  const linkedNow = new Set([...mentions.keys()].map(k => ids.get(k)))
  for (const r of all<{ id: string; to_id: string }>("SELECT id, to_id FROM relationships WHERE from_type = 'document' AND from_id = ? AND rel IN ('mentions','about') AND to_type IN ('company','firm','person') AND origin = 'source_fact' AND status IN ('accepted','suggested')", docId))
    if (!linkedNow.has(r.to_id)) run("UPDATE relationships SET status = 'inactive', updated_at = ? WHERE id = ?", now(), r.id)

  // (6) field values (each with an evidence row holding its quote)
  const touched = new Set<string>(priorFields.map(f => `${f.object_type}|${f.object_id}|${f.field_key}`))
  for (const f of v.fields) {
    const objId = idOf(f.objectType, f.objectName)
    const def = objId ? fieldDef(f.objectType, f.key) : undefined
    if (!objId || !def) continue   // unknown/invented keys are ignored
    const loc = locateQuote(text, f.quote)
    if (!loc) { dropped++; continue }
    const quote = text.slice(loc.start, loc.end)
    if (!groundingCheck(f.value, [quote]).ok && !quote.toLowerCase().includes(f.value.toLowerCase().replace(/^the /, ''))) { dropped++; continue }
    // a website is the object's home page, not a link to one of its articles
    if (f.key === 'website' && /^(?:https?:\/\/)?[^/\s]+\/[^\s]+/i.test(f.value.trim().replace(/\/$/, ''))) { dropped++; continue }
    // an enum value must be stated by its quote (stage words or a clear synonym), else the value is dropped
    if (def.value_type === 'enum') {
      const canonical = normalizeValue(def, f.value)?.display || f.value
      if (!(f.key === 'stage' ? stageSupported(canonical, quote) : quote.toLowerCase().includes(canonical.toLowerCase()))) { dropped++; continue }
    }
    let evId = usedSpans.get(`${loc.start}:${loc.end}`) || [...own].find(([, r]) => r.start <= loc.start && r.end >= loc.end)?.[0]
    // a field needs a real sentence behind it: a bare URL or name as its "quote" is not evidence (RD-EXT-08)
    if (!evId && junkQuote(quote)) { dropped++; continue }
    if (!evId) evId = insertEvidence({ kind: /\d/.test(f.value) && f.key !== 'founded' ? 'metric' : 'other', assertion: 'fact', claim: quote, start: loc.start, end: loc.end, attributedTo: null, eventDate: null, payload: { subject: f.objectName, detail: `${f.key}: ${f.value}` }, subjectType: f.objectType, subjectId: objId, confidence: 0.75 })
    if (f.key === 'website') {
      try { const dom = new URL(/^https?:/i.test(f.value) ? f.value : 'https://' + f.value).hostname.replace(/^www\./, ''); run(`UPDATE ${f.objectType === 'company' ? 'companies' : 'firms'} SET domain = COALESCE(domain, ?) WHERE id = ? AND NOT EXISTS (SELECT 1 FROM ${f.objectType === 'company' ? 'companies' : 'firms'} WHERE domain = ? AND id <> ?)`, dom, objId, dom, objId) } catch { /* not a URL */ }
    }
    if (writeSourceValue(f.objectType, objId, f.key, f.value, evId, runId)) touched.add(`${f.objectType}|${objId}|${f.key}`)
  }
  for (const k of touched) { const [ot, oid, key] = k.split('|'); resolveCurrent(ot, oid, key) }
  return { inserted: newIds.length, dropped, claimsReplaced, novelAny, newIds, supportIds, shared, unknownPeople }
}

function getRolePayload(fromType: string, fromId: string, companyId: string): { role?: string } | null {
  const r = one<{ payload_json: string }>("SELECT payload_json FROM relationships WHERE from_type = ? AND from_id = ? AND rel = 'invested_in' AND to_type = 'company' AND to_id = ?", fromType, fromId, companyId)
  return r ? JSON.parse(r.payload_json || '{}') : null
}

function persistInterpretation(doc: Doc, generation: number, v: InterpretValue | null, thesisTitles: string[], sourceNames: string[], entityNames: string[], suggest: boolean, supportIds: string[]): void {
  const allowed = [...thesisTitles, ...sourceNames, ...entityNames]
  const fallback = firstSentences(doc.text, 2)
  let summary = fallback, why = '', importance = 0.5, relevant = true, matches = true
  let groundingDropped = 0
  if (v) {
    const s = groundProse(v.summary, [doc.text], { allowedNames: allowed })
    const w = groundProse(v.whyItMatters, [doc.text], { allowedNames: allowed })
    groundingDropped = s.dropped + w.dropped
    summary = s.text || fallback
    why = w.text
    importance = v.importance; relevant = v.relevant; matches = v.matchesSourceInstruction
  }
  run(`UPDATE documents SET summary = ?, metadata_json = json_set(metadata_json, '$.interpret', json(?)), updated_at = ? WHERE id = ?`,
    summary, JSON.stringify({ whyItMatters: why, importance, relevant, matchesSourceInstruction: matches, groundingDropped, fallback: !v }), now(), doc.id)
  if (!v || !suggest) return
  const active = new Set([...all<{ id: string }>("SELECT id FROM evidence WHERE document_id = ? AND status = 'active'", doc.id).map(r => r.id), ...supportIds])
  // only evidence that moves the hypothesis is linked (support | contra); "about the same topic" is no link (DEC-092)
  // a rationale that itself says the evidence doesn't address the thesis is not a link (the model contradicting itself)
  // …and a link must name the part of the thesis it bears on, in the thesis' own words ("AI risk debates" isn't in it)
  const thesisText = new Map(all<{ id: string; title: string; description: string }>('SELECT id, title, description FROM theses WHERE merged_into_id IS NULL').map(t => [t.id, t]))
  for (const l of v.theses.filter(x => (x.stance === 'support' || x.stance === 'contra') && !SELF_DENIAL.test(x.rationale)
    && (!thesisText.get(x.thesisId) || bearsOnThesis(x.bearsOn, thesisText.get(x.thesisId)!)))) {
    if (docPairRejected(doc.id, 'thesis', l.thesisId)) continue
    upsertSuggestion('document', doc.id, 'thesis', l.thesisId, { stance: l.stance, confidence: l.confidence, explanation: l.rationale, generation })
    for (const eid of l.evidenceIds) if (active.has(eid)) upsertSuggestion('evidence', eid, 'thesis', l.thesisId, { stance: l.stance, confidence: l.confidence, explanation: l.rationale, generation })
  }
  if (v.newThesis && v.newThesis.confidence >= 0.8) {
    const key = 'thesis:' + v.newThesis.title.toLowerCase().replace(/\s+/g, ' ').trim()
    run(`INSERT OR IGNORE INTO suggestions(id, type, target_type, target_id, payload_json, explanation, confidence, status, dedupe_key, created_at)
         VALUES (?, 'new_thesis', 'document', ?, ?, ?, ?, 'open', ?, ?)`, newId('sg'), doc.id, JSON.stringify({ title: v.newThesis.title, description: v.newThesis.description, documentId: doc.id }), v.newThesis.description, v.newThesis.confidence, key, now())
  }
}
