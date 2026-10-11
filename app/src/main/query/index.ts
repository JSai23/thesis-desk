// Query and search (RFC §1B.16): lexical palette search over objects + FTS5, and Ask = PLAN_QUERY → deterministic
// retrieval → ANSWER_QUERY → citation + grounding checks. The answer is returned only after validation (never streamed).
import { getDetails, hasDetails } from '../objects/details'
import { all, one } from '../db'
import { now, localDay } from '../clock'
import { emit } from '../events'
import { getSetting, setSetting } from '../settings'
import { AppError } from '../errors'
import { normalizeName, resolveDeterministic } from '../entities/resolve'
import { descendants } from '../theses'
import { itemDTO, type FeedRow } from '../feed'
import { runTask, annotateRun } from '../ai/runtime'
import { PLAN, ANSWER, type Plan, type Answer } from '../ai/tasks/query'
import { groundingCheck } from '../ai/grounding'
import { log } from '../log'

const DAY = 86400_000

/** FTS5 query from free text: each token quoted, prefix-matched, OR-joined. */
function ftsQuery(text: string): string | null {
  const toks = text.toLowerCase().replace(/[^\p{L}\p{N}\s$%.-]/gu, ' ').split(/\s+/).filter(t => t.length > 1 && !STOP.has(t)).slice(0, 12)
  if (!toks.length) return null
  return toks.map(t => `"${t.replace(/"/g, '')}"*`).join(' OR ')
}
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'was', 'what', 'who', 'how', 'did', 'does', 'do', 'with', 'about', 'this', 'that', 'my', 'me', 'i', 'it', 'its', 'their', 'they', 'has', 'have', 'which', 'when', 'since', 'changed', 'evidence'])

function entityHits(table: string, type: string, q: string, limit: number): { id: string; name: string }[] {
  const n = normalizeName(q)
  const like = '%' + q.toLowerCase().replace(/[%_]/g, '') + '%'
  const rows = all<{ id: string; name: string; rank: number }>(`SELECT id, name, CASE WHEN normalized_name = ? THEN 0 WHEN normalized_name LIKE ? THEN 1 ELSE 2 END rank FROM ${table}
     WHERE merged_into_id IS NULL AND deleted_at IS NULL AND (normalized_name LIKE ? OR LOWER(name) LIKE ? OR id IN (SELECT entity_id FROM aliases WHERE entity_type = ? AND (alias_normalized LIKE ? OR LOWER(alias) LIKE ?)))
     ORDER BY rank, followed DESC, name LIMIT ?`, n, n + '%', '%' + n + '%', like, type, '%' + n + '%', like, limit)
  // also match when the query contains the entity name ("Northwind investments")
  if (rows.length < limit) {
    for (const r of all<{ id: string; name: string; normalized_name: string }>(`SELECT id, name, normalized_name FROM ${table} WHERE merged_into_id IS NULL AND deleted_at IS NULL`)) {
      if (rows.length >= limit) break
      if (r.normalized_name.length >= 3 && n.includes(r.normalized_name) && !rows.some(x => x.id === r.id)) rows.push({ id: r.id, name: r.name, rank: 3 })
    }
  }
  return rows
}

const field = (type: string, id: string, key: string) => one<{ display: string }>("SELECT display FROM field_values WHERE object_type = ? AND object_id = ? AND field_key = ? AND status = 'current'", type, id, key)?.display || ''
/** Citation source: the publisher, not an aggregator (HN, saved searches) that merely pointed at the article. */
const srcName = (docId: string) => one<{ name: string }>(`SELECT CASE WHEN s.id = 'src_manual' THEN COALESCE(d.site_name, 'Added by you') WHEN s.kind IN ('hn_api','search') THEN COALESCE(d.site_name, s.name) ELSE s.name END name
  FROM document_sources ds JOIN sources s ON s.id = ds.source_id JOIN documents d ON d.id = ds.document_id WHERE ds.document_id = ?
  ORDER BY CASE WHEN s.kind IN ('hn_api','search') THEN 1 ELSE 0 END, ds.first_seen_at LIMIT 1`, docId)?.name || ''

export function search(text: string, scope = 'all') {
  const t0 = performance.now()
  const q = text.trim()
  if (!q) return { elapsedMs: 0 }
  const keepDismissed = getSetting('keep_dismissed') !== false
  const companies = entityHits('companies', 'company', q, 4).map(c => ({ id: c.id, name: c.name, tagline: field('company', c.id, 'tagline'), stage: field('company', c.id, 'stage') }))
  if (scope === 'company') return { companies, elapsedMs: Math.round(performance.now() - t0) }
  const firms = entityHits('firms', 'firm', q, 3).map(f => ({ id: f.id, name: f.name, tagline: field('firm', f.id, 'tagline') }))
  if (scope === 'firm') return { firms, elapsedMs: Math.round(performance.now() - t0) }
  const people = entityHits('people', 'person', q, 3).map(p => {
    const org = one<any>(`SELECT r.rel, r.to_type, r.to_id, r.payload_json FROM relationships r WHERE r.from_type = 'person' AND r.from_id = ? AND r.status = 'accepted' AND r.rel IN ('works_at','partner_at','founded') LIMIT 1`, p.id)
    const orgName = org ? one<any>(`SELECT name FROM ${org.to_type === 'firm' ? 'firms' : 'companies'} WHERE id = ?`, org.to_id)?.name : ''
    return { id: p.id, name: p.name, role: org ? JSON.parse(org.payload_json || '{}').title || '' : '', orgId: org?.to_id, orgType: org?.to_type, orgName }
  }).filter(p => p.orgId)
  const ql = '%' + q.toLowerCase() + '%'
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
  const thesesAll = all<any>('SELECT id, title, description, conviction, archived_at, merged_into_id FROM theses WHERE merged_into_id IS NULL')
  const theses = thesesAll.map(t => ({ t, sc: (t.title.toLowerCase().includes(q.toLowerCase()) ? 3 : 0) + words.filter(w => (t.title + ' ' + t.description).toLowerCase().includes(w)).length }))
    .filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 4).map(({ t }) => ({ id: t.id, title: t.title, description: t.description, conviction: t.conviction, archived: !!t.archived_at, evidenceCount: one<{ n: number }>("SELECT COUNT(DISTINCT from_id) n FROM relationships WHERE from_type = 'evidence' AND to_type = 'thesis' AND to_id = ? AND status = 'accepted'", t.id)!.n }))
  void ql
  const fq = ftsQuery(q)
  let evidence: any[] = [], items: any[] = [], notes: any[] = [], documents: any[] = []
  if (fq) {
    evidence = all<any>(`SELECT e.id, e.claim, e.quote, e.document_id, d.published_at, d.first_fetched_at, bm25(fts_evidence) score FROM fts_evidence JOIN evidence e ON e.rowid = fts_evidence.rowid JOIN documents d ON d.id = e.document_id
       WHERE fts_evidence MATCH ? AND e.status = 'active' AND d.deleted_at IS NULL ORDER BY score LIMIT 5`, fq).map(e => {
      const link = one<any>("SELECT r.stance, t.title FROM relationships r JOIN theses t ON t.id = r.to_id WHERE r.from_type = 'evidence' AND r.from_id = ? AND r.to_type = 'thesis' AND r.status IN ('accepted','suggested') ORDER BY r.status = 'accepted' DESC LIMIT 1", e.id)
      return { id: e.id, claim: e.claim, quote: e.quote, documentId: e.document_id, itemId: one<any>('SELECT id FROM feed_items WHERE document_id = ?', e.document_id)?.id || null, source: srcName(e.document_id), date: e.published_at || e.first_fetched_at, stance: link?.stance || null, theses: link ? [link.title] : [] }
    })
    items = all<FeedRow & { score: number }>(`SELECT fi.*, bm25(fts_documents, 5.0, 1.0) score FROM fts_documents JOIN documents d ON d.rowid = fts_documents.rowid JOIN feed_items fi ON fi.document_id = d.id
       WHERE fts_documents MATCH ? AND d.deleted_at IS NULL AND fi.hidden_reason IS NULL ${keepDismissed ? '' : 'AND fi.dismissed_at IS NULL'} ORDER BY score LIMIT 4`, fq).map(r => { const d = itemDTO(r); return { id: d.id, title: d.title, source: d.source, srcId: d.srcId, surfacedAt: d.surfacedAt, saved: d.saved } })
    notes = all<any>(`SELECT n.id, n.text, n.kind, n.anchor_type, n.anchor_id, n.created_at FROM fts_notes JOIN notes n ON n.rowid = fts_notes.rowid WHERE fts_notes MATCH ? AND n.deleted_at IS NULL ORDER BY bm25(fts_notes) LIMIT 3`, fq)
      .map(n => ({ id: n.id, text: n.text, kind: n.kind, anchorType: n.anchor_type, anchorId: n.anchor_id, createdAt: n.created_at, anchorName: n.anchor_type === 'thesis' ? one<any>('SELECT title FROM theses WHERE id = ?', n.anchor_id)?.title : n.anchor_type === 'company' ? one<any>('SELECT name FROM companies WHERE id = ?', n.anchor_id)?.name : n.anchor_type === 'firm' ? one<any>('SELECT name FROM firms WHERE id = ?', n.anchor_id)?.name : null }))
  }
  if (fq) {
    // Library documents with no feed item (screened out, duplicates kept for provenance) stay findable (E2E-ING-07).
    documents = all<any>(`SELECT d.id, d.title, d.url, d.status, d.site_name FROM fts_documents JOIN documents d ON d.rowid = fts_documents.rowid
       WHERE fts_documents MATCH ? AND d.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM feed_items fi WHERE fi.document_id = d.id) ORDER BY bm25(fts_documents, 5.0, 1.0) LIMIT 4`, fq)
      .map(d => ({ id: d.id, title: d.title, url: d.url, status: d.status, site: d.site_name }))
  }
  if (scope === 'evidence') return { evidence: fq ? evidence : [], elapsedMs: Math.round(performance.now() - t0) }
  let investments: any[] = []
  if (/invest/i.test(q) && firms.length) {
    investments = all<any>(`SELECT r.to_id company_id, c.name company_name, r.payload_json FROM relationships r JOIN companies c ON c.id = r.to_id WHERE r.from_type = 'firm' AND r.from_id = ? AND r.rel = 'invested_in' AND r.status = 'accepted' LIMIT 4`, firms[0].id)
      .map(r => ({ firmName: firms[0].name, companyId: r.company_id, companyName: r.company_name, round: JSON.parse(r.payload_json || '{}').round || '', date: '' }))
  }
  let whatChanged: any = null
  if (/changed|new|lately|recent/i.test(q) && theses.length) {
    const ids = descendants(theses[0].id)
    const rows = all<any>(`SELECT e.id, e.claim, r.stance, r.to_id, e.created_at, t.title FROM relationships r JOIN evidence e ON e.id = r.from_id JOIN theses t ON t.id = r.to_id
       WHERE r.from_type = 'evidence' AND r.to_type = 'thesis' AND r.to_id IN (${ids.map(() => '?').join(',')}) AND r.status IN ('accepted','suggested') AND e.status = 'active' AND e.created_at >= ? ORDER BY e.created_at DESC LIMIT 4`, ...ids, now() - 30 * DAY)
    whatChanged = { thesis: theses[0].title, rows: rows.map(r => ({ text: r.claim, stance: r.stance || 'support', date: r.created_at, thesisId: r.to_id, thesisTitle: r.title })) }
  }
  return { companies, firms, people, theses, evidence, items, documents, notes, investments, whatChanged, elapsedMs: Math.round(performance.now() - t0) }
}

// ---------------------------------------------------------------- Ask
const conversations = new Map<string, { q: string; a: string }[]>()

function sinceTs(since: string, entityIds: { type: string; id: string }[]): number {
  if (since === 'all') return 0
  if (since === 'last_viewed') {
    const t = entityIds.map(e => one<{ t: number | null }>(`SELECT last_viewed_at t FROM ${e.type === 'company' ? 'companies' : e.type === 'firm' ? 'firms' : 'theses'} WHERE id = ?`, e.id)?.t).filter(Boolean) as number[]
    return t.length ? Math.min(...t) : now() - 30 * DAY
  }
  const m = since.match(/^(\d+)d$/)
  if (m) return now() - Number(m[1]) * DAY
  const d = Date.parse(since)
  return Number.isFinite(d) ? d : 0
}

export async function ask(question: string, conversationId?: string): Promise<any> {
  const conv = (conversationId && conversations.get(conversationId)) || []
  const cid = conversationId || 'conv_' + Math.random().toString(36).slice(2)
  const progress = (step: string, text: string) => emit('query.progress', { conversationId: cid, step, text })
  progress('planning', 'Planning the search…')
  const theses = all<{ id: string; title: string }>('SELECT id, title FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL')
  const followed = [...all<{ name: string }>('SELECT name FROM companies WHERE followed = 1 AND merged_into_id IS NULL'), ...all<{ name: string }>('SELECT name FROM firms WHERE followed = 1 AND merged_into_id IS NULL')].map(r => r.name)
  let plan: Plan
  try { plan = (await runTask(PLAN, { question, today: localDay(), theses: theses.map(t => t.title), followed, conversation: conv.slice(-3) })).value } catch (e) {
    if (e instanceof AppError && e.code === 'AI_UNAVAILABLE') throw e
    plan = { intent: 'other', entities: [], thesisTitles: [], since: 'all', kinds: [], stance: 'any', searchTerms: question.split(/\s+/).filter(w => w.length > 2 && !STOP.has(w.toLowerCase())).slice(0, 12), includeNotes: true }
  }
  // resolve names deterministically (no AI)
  const ents: { type: string; id: string }[] = []
  // the planner may mistype an entity (a firm as a company): fall back to the other types before giving up
  for (const e of plan.entities) {
    for (const type of [e.type, ...(['company', 'firm', 'person'] as const).filter(t => t !== e.type)]) {
      const id = resolveDeterministic(type as any, e.name)
      if (id) { ents.push({ type, id }); break }
    }
  }
  const thesisIds = new Set<string>()
  for (const tt of plan.thesisTitles) { const t = theses.find(x => x.title.toLowerCase() === tt.toLowerCase()) || theses.find(x => x.title.toLowerCase().includes(tt.toLowerCase()) || tt.toLowerCase().includes(x.title.toLowerCase())); if (t) for (const d of descendants(t.id)) thesisIds.add(d) }
  const since = sinceTs(plan.since, [...ents, ...[...thesisIds].slice(0, 1).map(id => ({ type: 'thesis', id }))])
  const byIngest = plan.since === 'last_viewed'
  // retrieval
  const cand = new Map<string, { id: string; bm: number; linked: boolean }>()
  for (const e of ents) for (const r of all<{ id: string }>(`SELECT DISTINCT ev.id FROM relationships r JOIN evidence ev ON ev.id = r.from_id WHERE r.from_type = 'evidence' AND r.to_type = ? AND r.to_id = ? AND r.status <> 'rejected' AND ev.status = 'active'
       UNION SELECT ev.id FROM evidence ev WHERE ev.status = 'active' AND ev.payload_json LIKE ?`, e.type, e.id, `%${e.id}%`)) cand.set(r.id, { id: r.id, bm: 0, linked: true })
  // a firm's or company's people speak for it (partners' essays, founders' interviews); its own site publishes for it
  for (const e of ents.filter(x => x.type === 'firm' || x.type === 'company')) {
    const people = all<{ id: string; name: string }>(`SELECT p.id, p.name FROM relationships r JOIN people p ON p.id = r.from_id WHERE r.from_type = 'person' AND r.to_type = ? AND r.to_id = ?
      AND r.rel IN ('partner_at','works_at','founded') AND r.status = 'accepted' AND p.merged_into_id IS NULL`, e.type, e.id)
    for (const p of people) for (const r of all<{ id: string }>(`SELECT ev.id FROM evidence ev WHERE ev.status = 'active' AND (ev.payload_json LIKE ? OR ev.attributed_to = ?)`, `%${p.id}%`, p.name)) if (!cand.has(r.id)) cand.set(r.id, { id: r.id, bm: 0, linked: true })
    const domain = one<{ domain: string | null }>(`SELECT domain FROM ${e.type === 'firm' ? 'firms' : 'companies'} WHERE id = ?`, e.id)?.domain
    if (domain) for (const r of all<{ id: string }>(`SELECT ev.id FROM evidence ev JOIN documents d ON d.id = ev.document_id WHERE ev.status = 'active' AND d.deleted_at IS NULL AND (d.url LIKE ? OR d.url LIKE ? OR d.url LIKE ?)`, `%://${domain}/%`, `%://${domain}:%`, `%://www.${domain}/%`)) if (!cand.has(r.id)) cand.set(r.id, { id: r.id, bm: 0, linked: true })
  }
  for (const tid of thesisIds) for (const r of all<{ id: string; stance: string }>(`SELECT DISTINCT ev.id, r.stance FROM relationships r JOIN evidence ev ON ev.id = r.from_id WHERE r.from_type = 'evidence' AND r.to_type = 'thesis' AND r.to_id = ? AND r.status <> 'rejected' AND ev.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM relationships x WHERE x.from_type = 'document' AND x.from_id = ev.document_id AND x.to_type = 'thesis' AND x.to_id = r.to_id AND x.status = 'rejected')`, tid)) {
    if (plan.stance !== 'any' && r.stance !== plan.stance) continue
    cand.set(r.id, { id: r.id, bm: 0, linked: true })
  }
  const fq = ftsQuery([...plan.searchTerms, ...plan.entities.map(e => e.name)].join(' '))
  if (fq) for (const r of all<{ id: string; score: number }>(`SELECT e.id, bm25(fts_evidence) score FROM fts_evidence JOIN evidence e ON e.rowid = fts_evidence.rowid WHERE fts_evidence MATCH ? AND e.status = 'active' ORDER BY score LIMIT 120`, fq)) {
    const c = cand.get(r.id); if (c) c.bm = Math.min(c.bm, r.score); else cand.set(r.id, { id: r.id, bm: r.score, linked: false })
  }
  const inWindow = [...cand.values()].map(c => ({ c, e: one<any>(`SELECT e.*, d.published_at, d.first_fetched_at, d.title doc_title, d.url FROM evidence e JOIN documents d ON d.id = e.document_id WHERE e.id = ? AND d.deleted_at IS NULL`, c.id) }))
    .filter(x => x.e && (byIngest ? x.e.first_fetched_at >= since : (x.e.published_at || x.e.first_fetched_at) >= since))
  // the planner's kinds narrow retrieval but never empty it ("announce" → ["other"] must not hide the fund close)
  const kinds = plan.kinds.filter(k => k !== 'other')
  const byKind = kinds.length ? inWindow.filter(x => kinds.includes(x.e.kind)) : inWindow
  const rows = byKind.length ? byKind : inWindow
  const minBm = Math.min(0, ...rows.map(r => r.c.bm))
  const newest = Math.max(1, ...rows.map(r => r.e.published_at || r.e.first_fetched_at))
  const ranked = rows.map(r => {
    const bmN = minBm < 0 ? r.c.bm / minBm : 0
    const rec = (r.e.published_at || r.e.first_fetched_at) / newest
    const acc = r.e.kept || one("SELECT 1 FROM relationships WHERE from_type = 'evidence' AND from_id = ? AND origin = 'user' AND status = 'accepted'", r.e.id) ? 1 : r.c.linked ? 0.5 : 0
    return { ...r, score: 0.5 * Math.max(bmN, r.c.linked ? 0.6 : 0) + 0.3 * rec + 0.2 * acc }
  }).sort((a, b) => b.score - a.score).slice(0, 40)
  const scopeLine = `Looking in ${ranked.length} evidence item${ranked.length === 1 ? '' : 's'}${ents.length ? ' about ' + ents.map(e => one<any>(`SELECT name FROM ${e.type === 'company' ? 'companies' : e.type === 'firm' ? 'firms' : 'people'} WHERE id = ?`, e.id)?.name).filter(Boolean).join(', ') : thesisIds.size ? ' about ' + theses.filter(t => thesisIds.has(t.id)).map(t => t.title).slice(0, 2).join(', ') : ''}${since ? ' since ' + new Date(since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}`
  progress('scope', scopeLine)
  progress('retrieving', 'Reading the evidence…')
  const notes = plan.includeNotes && fq ? all<any>(`SELECT n.id, n.text FROM fts_notes JOIN notes n ON n.rowid = fts_notes.rowid WHERE fts_notes MATCH ? AND n.deleted_at IS NULL ORDER BY bm25(fts_notes) LIMIT 10`, fq) : []
  const facts = ents.filter(e => e.type !== 'person').flatMap(e => all<any>(`SELECT fv.field_key, fv.display, fv.evidence_id FROM field_values fv WHERE fv.object_type = ? AND fv.object_id = ? AND fv.status = 'current'`, e.type, e.id)
    .map(f => ({ name: one<any>(`SELECT name FROM ${e.type === 'company' ? 'companies' : 'firms'} WHERE id = ?`, e.id)?.name, ...f })))
  const context: any[] = []
  ranked.forEach(r => context.push({ n: context.length + 1, kind: 'evidence', text: r.e.assertion === 'attributed_opinion' && r.e.attributed_to ? `${r.e.attributed_to} argues: ${r.e.claim}` : r.e.claim, quote: r.e.quote, source: srcName(r.e.document_id), date: localDay(r.e.published_at || r.e.first_fetched_at), evidenceId: r.e.id, documentId: r.e.document_id, title: r.e.doc_title, url: r.e.url, attributedTo: r.e.attributed_to || '' }))
  notes.forEach(n => context.push({ n: context.length + 1, kind: 'note', text: n.text, noteId: n.id }))
  // what the user says about the entities asked about (DEC-099): their words, cited as theirs (like a note)
  for (const e of ents) {
    const d = e.type === 'company' || e.type === 'firm' || e.type === 'person' ? getDetails(e.type, e.id) : null
    if (!d || !hasDetails(d)) continue
    const nm = one<any>(`SELECT name FROM ${e.type === 'company' ? 'companies' : e.type === 'firm' ? 'firms' : 'people'} WHERE id = ?`, e.id)?.name
    const parts = [d.about && `${nm} — ${d.about}`, d.website && `website ${d.website}`, d.otherNames.length && `also called ${d.otherNames.join(', ')}`, ...Object.entries(d.fields).map(([k, v]) => `${k}: ${v}`)].filter(Boolean)
    context.push({ n: context.length + 1, kind: 'note', text: `You describe ${nm}: ${parts.join('; ')}` })
  }
  facts.forEach(f => { const q = f.evidence_id ? one<any>('SELECT quote, document_id FROM evidence WHERE id = ?', f.evidence_id) : null; context.push({ n: context.length + 1, kind: 'fact', text: `${f.name} ${f.field_key}: ${f.display}`, quote: q?.quote, source: q ? srcName(q.document_id) : 'You', evidenceId: f.evidence_id, documentId: q?.document_id }) })
  const lexicalFallback = () => ranked.slice(0, 10).map(r => ({ id: r.e.id, claim: r.e.claim, quote: r.e.quote, source: srcName(r.e.document_id), documentId: r.e.document_id, itemId: one<any>('SELECT id FROM feed_items WHERE document_id = ?', r.e.document_id)?.id || null, date: r.e.published_at || r.e.first_fetched_at }))
  rememberQuery(question)
  if (!context.length) return { conversationId: cid, items: [], citations: [], insufficient: true, followups: [], fallbackEvidence: [], scopeLine }
  progress('composing', 'Composing the answer…')
  const allowed = [...theses.map(t => t.title), ...all<{ name: string }>('SELECT name FROM sources').map(s => s.name), question]
  let answer: Answer, runId: string
  try {
    const r = await runTask(ANSWER, { question, context, conversation: conv.slice(-3) })
    answer = r.value; runId = r.runId
  } catch (e) {
    if (e instanceof AppError && e.code === 'AI_INVALID') return { conversationId: cid, items: [], citations: [], insufficient: false, followups: [], error: 'I couldn’t compose a grounded answer.', fallback: true, fallbackEvidence: lexicalFallback(), scopeLine }
    if (e instanceof AppError && e.code === 'AI_UNAVAILABLE') throw e
    return { conversationId: cid, items: [], citations: [], insufficient: false, followups: [], error: 'I couldn’t reach the AI provider. Showing matching evidence instead.', fallback: true, fallbackEvidence: lexicalFallback(), scopeLine }
  }
  progress('checking', 'Checking every fact against its sources…')
  // grounding (B-AGENT-007): numbers and names against the cited verbatim quotes; one retry, then drop failures
  const problemsOf = (a: Answer) => a.answer.map((it, k) => {
    if (it.type === 'user_note') return null
    const cited = it.citations.map(n => context.find(c => c.n === n)).filter(Boolean)
    const docTexts = cited.map(c => (c.documentId ? one<{ text: string }>('SELECT text FROM documents WHERE id = ?', c.documentId)?.text || '' : ''))
    const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').trim().replace(/^["']+|["']+$/g, '').replace(/\s*(\.\.\.|…)$/, '').replace(/^(\.\.\.|…)\s*/, '').trim()
    it.quotes = it.quotes.map(q => q.trim().replace(/^["“”']+|["“”']+$/g, '').trim())
    if (it.type === 'fact') {
      const badQuote = it.quotes.find(q => !cited.some((c, i) => norm(c.quote || '').includes(norm(q)) || norm(docTexts[i]).includes(norm(q))))
      if (badQuote) return { k, msg: `item ${k + 1}: quote “${badQuote.slice(0, 60)}” is not verbatim in the cited sources` }
      const g = groundingCheck(it.text, it.quotes, { allowedNames: [...allowed, ...cited.map(c => c.source || ''), ...cited.map(c => c.attributedTo || '')], strictDates: true } /* an opinion's holder is known from attributed_to */)
      return g.ok ? null : { k, msg: `item ${k + 1}: ${g.problems.join('; ')}` }
    }
    if (/\d|[A-Z][a-z]+\s[A-Z]/.test(it.text) && cited.length) {
      const g = groundingCheck(it.text, cited.map(c => c.quote || c.text), { allowedNames: [...allowed, ...cited.map(c => c.source || ''), ...cited.map(c => c.attributedTo || '')], strictDates: true } /* an opinion's holder is known from attributed_to */)
      return g.ok ? null : { k, msg: `item ${k + 1}: ${g.problems.join('; ')}` }
    }
    return null
  }).filter(Boolean) as { k: number; msg: string }[]
  let probs = problemsOf(answer)
  if (probs.length) {
    try {
      const r2 = await runTask(ANSWER, { question, context, conversation: conv.slice(-3), extraInstruction: 'Your previous answer had unsupported content. Fix or remove these items:\n- ' + probs.map(p => p.msg).join('\n- ') })
      answer = r2.value; runId = r2.runId
      probs = problemsOf(answer)
    } catch (e) { log.warn('query', 'answer retry failed', { err: String(e) }) }
  }
  const dropped = new Set(probs.map(p => p.k))
  const kept = answer.answer.filter((_, k) => !dropped.has(k))
  annotateRun(runId, { groundingDropped: dropped.size, groundingProblems: probs.map(p => p.msg).slice(0, 10) })
  const insufficient = answer.insufficient || !kept.some(i => i.type === 'fact')
  const usedNs = [...new Set(kept.flatMap(i => i.citations))].sort((a, b) => a - b)
  const citations = usedNs.map(n => { const c = context.find(x => x.n === n)!; return { n, source: c.source || 'Your note', date: c.date || null, quote: c.quote || c.text, title: c.title || '', evidenceId: c.evidenceId || null, documentId: c.documentId || null, itemId: c.documentId ? one<any>('SELECT id FROM feed_items WHERE document_id = ?', c.documentId)?.id || null : null, kind: c.kind } })
  const result = { conversationId: cid, items: kept, citations, insufficient, followups: answer.followups, groundingDropped: dropped.size, scopeLine, plan: { since: plan.since, intent: plan.intent, sinceTs: since }, fallbackEvidence: insufficient ? lexicalFallback().slice(0, 5) : [] }
  conversations.set(cid, [...conv, { q: question, a: kept.map(i => i.text).join(' ').slice(0, 1200) }].slice(-3))
  return result
}

/** Documents still being fetched or read (queued/running PROCESS_DOCUMENT or mid-pipeline), so Ask can say an answer may be incomplete. */
export function processingBacklog(): number {
  return one<{ n: number }>(`SELECT COUNT(*) n FROM (
    SELECT json_extract(payload_json, '$.documentId') id FROM jobs WHERE type = 'PROCESS_DOCUMENT' AND status IN ('queued','running')
    UNION SELECT id FROM documents WHERE status IN ('fetched','processing') AND deleted_at IS NULL)`)!.n
}

function rememberQuery(q: string): void {
  const list = (getSetting<string[]>('recent_queries') || []).filter(x => x !== q)
  setSetting('recent_queries', [q, ...list].slice(0, 10))
}
export const recentQueries = () => getSetting<string[]>('recent_queries') || []
