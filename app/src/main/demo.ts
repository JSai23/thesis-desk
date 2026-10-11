// test.seedDemo (RFC §3B VIS-01 design parity): loads the approved prototype's demo data (design/prototype/data.js, copied
// verbatim into demo-data.ts) into the library so the app's screens can be compared with the prototype's. Everything goes
// through the app's own modules where one fits (theses, follow/pin, notes, field values, source facts, feed items, reports,
// alerts, on-demand history); documents, evidence and thesis links are written directly because their content is fixed
// here instead of extracted. Deterministic: no model calls, no network, no jobs that call the model.
import crypto from 'node:crypto'
import { all, one, run, tx } from './db'
import { now, setClock } from './clock'
import { newId } from './ids'
import { AppError } from './errors'
import { emit } from './events'
import { writeHistory } from './history'
import { getSetting, setSetting } from './settings'
import { contentHash } from './ingest/dedupe'
import { cleanUrl, normalizeLocator, registrableDomain } from './ingest/url'
import { addDocumentSource } from './ingest/pipeline'
import { normalizeName } from './entities/resolve'
import { invalidateNameCache } from './ai/grounding'
import { upsertSourceFact, type RelType } from './entities/relationships'
import { writeSourceValue } from './entities/fields'
import { createThesis, updateThesis, addCompanyToThesis } from './theses'
import { follow, pin } from './objects/pages'
import { createNote } from './notes'
import { upsertFeedItem } from './feed'
import { recordOnDemand } from './ingest/ingress'
import * as reports from './reports'
import * as alerts from './alerts'
import * as sources from './sources'
import { seed as prototypeSeed } from './demo-data'
import type { AlertRule } from '../shared/schemas/alert-rule'

// ---------------------------------------------------------------- prototype data shapes (design/prototype/data.js)
type Stance = 'support' | 'contra' | 'neutral'
interface PTh { id: string; name: string; parent: string | null; desc: string; conviction: number; updated: string; created: string; view: string; sup: string[]; con: string[]; companies: string[]; firms: string[]; questions: string[]; changes: { date: string; text: string; kind: string }[]; thoughts: { text: string; date: string }[]; evo: { month: string; conv: number; events: { kind: string; date: string; text: string; before?: string; after?: string }[] }[] }
interface PAct { date: string; kind: string; title: string; why: string; src: string; item?: string }
interface PCo { id: string; name: string; tagline: string; stage: string; hq: string; hue: number; site: string; founded: string; followed: boolean; founders: { name: string; role: string }[]; funding: { round: string; date: string; amount: string; lead: string }[]; activity: PAct[]; notes: { text: string; date: string }[] }
interface PFm { id: string; name: string; hq: string; tagline: string; hue: number; followed: boolean; site: string; investments: { co: string; round: string; date: string; note: string }[]; writing: { title: string; date: string; item?: string }[]; commentary: { quote: string; who: string; where: string; date: string }[]; theses: string[]; evidence: string[]; notes: { text: string; date: string }[] }
interface PEv { id: string; text: string; src: string; date: string; cos: string[]; theses: string[]; stance: Stance; note: string }
interface PIt { id: string; group: string; day: string; ago: number; source: string; srcId: string; url: string; title: string; summary: string; why: string; reason: string; reasons: string[]; thesis: string; stance: Stance; cos: string[]; theses: string[]; firms: string[]; body: string[]; extracts: string[]; hl: string[]; unread: boolean; review: boolean; suggest: { thesis: string; stance: Stance } | null }
interface PSrc { id: string; name: string; type: string; hue: number; handle: string; enabled: boolean; freq: string; priority: string; mode: string; instr: string; theses: string[]; last: string }
interface PPerson { id: string; name: string; role: string; org: string; orgType: 'company' | 'firm'; hue: number; followed: boolean; last: string; lastDate: string }
interface PData { theses: PTh[]; companies: PCo[]; firms: PFm[]; evidence: PEv[]; items: PIt[]; sources: PSrc[]; history: { title: string; type: string; date: string; outcome: string }[]; suggested: { name: string }[]; people: PPerson[]; reports: { id: string; last: string }[]; alerts: { id: string; text: string; enabled: boolean }[] }

// ---------------------------------------------------------------- fixed mappings the prototype leaves implicit
/** Where each prototype evidence lives: a verbatim span of a feed item's body, a company activity document, or (default) its own archive document. */
const EV_HOME: Record<string, { item?: string; quote?: string; activityOf?: string }> = {
  e1: { item: 'i1', quote: 'it now serves more than half of the AmLaw 100 and customers in 50 countries' },
  e3: { item: 'i2', quote: '70% of the enterprise contracts it signed in the third quarter are priced per resolved conversation' },
  e4: { item: 'i9', quote: 'reduced net headcount for the third consecutive quarter' },
  e5: { item: 'i7', quote: 'Two of the three firms already run Harvey.' },
  e6: { item: 'i10', quote: 'autonomous resolution rates tend to level off around 60 percent' },
  e7: { item: 'i8', quote: 'When software does the work, the seat stops being the unit of value.' },
  e9: { activityOf: 'decagon' },
  e11: { item: 'i6', quote: 'moving to usage-based pricing on Business plans' },
  e12: { item: 'i14', quote: 'processes first-notice-of-loss insurance claims end to end for carriers' }
}
const EV_KIND: Record<string, string> = { e1: 'expansion', e2: 'other', e3: 'pricing', e4: 'metric', e5: 'other', e6: 'metric', e7: 'opinion', e8: 'metric', e9: 'customer_adoption', e10: 'other', e11: 'pricing', e12: 'customer_adoption', e13: 'opinion' }
/** Prototype activity kinds → evidence kinds (pages.ts KIND_LABEL maps them back; "Interview" has no label of its own). */
const ACT_KIND: Record<string, string> = { Expansion: 'expansion', News: 'other', Interview: 'opinion', Commentary: 'opinion', Product: 'product_launch', Funding: 'funding', Pricing: 'pricing', Milestone: 'metric', Customers: 'customer_adoption' }
const FREQ: Record<string, string> = { 'Real-time': 'realtime', Hourly: 'hourly', Daily: 'daily', Weekly: 'weekly' }
const SRC_KIND: Record<string, string> = { Newsletter: 'email', 'RSS feed': 'rss', Podcast: 'rss' }
const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
const HOUR = 3600_000, DAY = 86400_000

// ---------------------------------------------------------------- time
let NOW = 0
/** Run fn with the app clock at t, so module functions stamp the prototype's dates (seeding is synchronous). */
function at<T>(t: number, fn: () => T): T {
  const base = now(), start = Date.now()
  setClock(t)
  try { return fn() } finally { setClock(base + (Date.now() - start)) }
}
const local = (y: number, m: number, d: number, h = 8) => new Date(y, m, d, h).getTime()
/** Prototype date labels ("2h ago", "Yesterday", "Sep 25–29", "Mar 2, 2026", "Jun 2025", "2025", "Today 7:30") → a time before NOW. */
function when(s: string): number {
  const t = s.trim()
  let m: RegExpMatchArray | null
  const y0 = new Date(NOW).getFullYear()
  let r: number
  if (t === 'Today' || t === 'Just now') r = NOW - HOUR
  else if ((m = t.match(/^Today (\d+):(\d+)$/))) { const d = new Date(NOW); r = local(d.getFullYear(), d.getMonth(), d.getDate(), Number(m[1])) + Number(m[2]) * 60_000 }
  else if (t === 'Yesterday') r = NOW - DAY
  else if ((m = t.match(/^(\d+)([hdw]) ago$/))) r = NOW - Number(m[1]) * (m[2] === 'h' ? HOUR : m[2] === 'd' ? DAY : 7 * DAY)
  else if ((m = t.match(/^([A-Z][a-z]{2}) (\d{1,2})(?:–(\d{1,2}))?(?:, (\d{4}))?$/))) r = local(m[4] ? Number(m[4]) : y0, MON[m[1]], Number(m[3] || m[2]))
  else if ((m = t.match(/^([A-Z][a-z]{2}) (\d{4})$/))) r = local(Number(m[2]), MON[m[1]], 1)
  else if ((m = t.match(/^(\d{4})$/))) r = local(Number(m[1]), 0, 1)
  else throw new AppError('INTERNAL', `Unrecognized demo date “${s}”`)
  return Math.min(r, NOW - 60_000)
}
/** ISO event date at the label's precision (day, month or year) for evidence.event_date. */
function isoOf(s: string): string {
  const d = new Date(when(s)), p = (n: number) => String(n).padStart(2, '0')
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return /^([A-Z][a-z]{2} )?\d{4}$/.test(s) ? day.slice(0, 7) : day
}

// ---------------------------------------------------------------- ids with the prototype's tile hues
/** Same hash as the renderer's hueOf (util.ts): tiles are colored from ids, so ids are picked to land on the prototype hue. */
function hueOf(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return 20 + (h % 320)
}
/** Picks an id whose hue (and, for sources, the hue of `extra(id)`) is nearest the target; both keys share low hash bits, so the pair may only be approximate. */
function hueId(base: string, hue: number, extra?: (id: string) => string): string {
  const want = Math.min(339, Math.max(20, hue))
  let best = `${base}_0`, bestD = Infinity
  for (let n = 0; n < 50_000 && bestD > 0; n++) {
    const id = `${base}_${n.toString(36)}`
    const d = Math.max(Math.abs(hueOf(id) - want), extra ? Math.abs(hueOf(extra(id)) - want) : 0)
    if (d < bestD) { best = id; bestD = d }
  }
  return best
}

// ---------------------------------------------------------------- documents and evidence
interface DocIn { sourceId: string; siteName?: string | null; url?: string | null; kind?: 'web' | 'text'; title: string; paras: string[]; at: number; summary?: string; why?: string }
function insertDoc(d: DocIn): { id: string; text: string } {
  const id = newId('doc')
  const text = d.paras.join('\n\n')
  const hash = contentHash(text)
  const meta = { demo: true, processedVersion: 1, processedGeneration: 0, ...(d.why !== undefined ? { interpret: { whyItMatters: d.why, importance: 0.8, relevant: true, matchesSourceInstruction: true } } : {}) }
  run(`INSERT INTO documents(id, kind, canonical_url, url, title, site_name, published_at, first_fetched_at, last_fetched_at, current_version, content_hash, text, text_chars, access, status, summary, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'full', 'processed', ?, ?, ?, ?)`,
    id, d.kind || 'web', d.url ? cleanUrl(d.url) : null, d.url ?? null, d.title, d.siteName ?? null, d.at, d.at, d.at, hash, text, text.length, d.summary ?? null, JSON.stringify(meta), d.at, d.at)
  run('INSERT INTO document_versions(document_id, version, content_hash, text, raw_path, fetched_at) VALUES (?, 1, ?, ?, NULL, ?)', id, hash, text, d.at)
  at(d.at, () => addDocumentSource(id, d.sourceId, d.url ?? null))
  return { id, text }
}

interface EvIn { quote: string; claim?: string; kind: string; at: number; eventDate?: string | null; origin?: 'ai_extraction' | 'user_highlight'; kept?: boolean; attributedTo?: string | null; payload?: Record<string, unknown>; confidence?: number }
/** Evidence quotes are verbatim spans of the document's version-1 text (offsets checked here). */
function addEvidence(doc: { id: string; text: string }, e: EvIn): string {
  const start = doc.text.indexOf(e.quote)
  if (start < 0) throw new AppError('INTERNAL', `Demo quote not in document: ${e.quote}`)
  const id = newId('ev')
  const claim = e.claim || e.quote
  const assertion = e.kind === 'opinion' ? 'attributed_opinion' : 'fact'
  run(`INSERT INTO evidence(id, document_id, document_version, origin, kind, assertion, claim, quote, quote_start, quote_end, attributed_to, event_date, payload_json, fingerprint, is_novel, confidence, kept, status, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'active', ?, ?)`,
    id, doc.id, e.origin || 'ai_extraction', e.kind, assertion, claim, e.quote, start, start + e.quote.length, e.attributedTo ?? null, e.eventDate ?? null, JSON.stringify(e.payload || {}),
    crypto.createHash('sha1').update(`${e.kind}|${claim}`).digest('hex'), e.confidence ?? 0.8, e.kept || e.origin === 'user_highlight' ? 1 : 0, e.at, e.at)
  return id
}

/** Thesis/firm links the user made (or, for review items, the suggestion awaiting a decision). */
function link(fromType: string, fromId: string, toType: string, toId: string, t: number, o: { stance?: Stance | null; suggested?: boolean; explanation?: string; createdAt?: number } = {}): void {
  run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, stance, confidence, explanation, created_at, updated_at)
       VALUES (?, ?, ?, 'relates_to', ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(from_type, from_id, rel, to_type, to_id) DO NOTHING`,
    newId('rel'), fromType, fromId, toType, toId, o.suggested ? 'ai_inference' : 'user', o.suggested ? 'suggested' : 'accepted', o.stance ?? null, o.suggested ? 0.6 : 1, o.explanation ?? null, o.createdAt ?? t, t)
}
const fact = (fromType: string, fromId: string, rel: RelType, toType: string, toId: string, evId: string | null, t: number, payload?: Record<string, unknown>) =>
  at(t, () => upsertSourceFact(fromType, fromId, rel, toType, toId, evId, payload))

/** "Because …" line of the prototype → per-reason short phrases that itemDTO joins back into it. */
function reasonsJson(it: PIt): string {
  const body = it.reason.startsWith('Because ') ? it.reason.slice(8) : it.reason.charAt(0).toLowerCase() + it.reason.slice(1)
  const k = body.search(/ and | · /)
  const parts = k < 0 ? [body] : [body.slice(0, k), body.slice(k + (body[k + 1] === '·' ? 3 : 5))]
  const type = (l: string) => /^You follow/.test(l) ? 'followed_company' : /firm you follow|is an investor/.test(l) ? 'investor_followed' : /^(Matches|Contradicts|Close to)|thesis|connection/.test(l) ? 'thesis' : 'source'
  return JSON.stringify(it.reasons.map((label, i) => ({ type: type(label), label, short: parts[i] ?? label.replace(/^You /, 'you '), ref: null })))
}

// ---------------------------------------------------------------- seed
export function seedDemo(): { ok: true; counts: Record<string, number> } {
  const busy = one<{ n: number }>("SELECT (SELECT COUNT(*) FROM theses) + (SELECT COUNT(*) FROM documents) + (SELECT COUNT(*) FROM sources WHERE kind <> 'manual') + (SELECT COUNT(*) FROM companies) n")!.n
  if (busy) throw new AppError('CONFLICT', 'The demo library can only be loaded into an empty library')
  const D = prototypeSeed() as unknown as PData
  NOW = now()
  const organize = one('SELECT 1 FROM settings WHERE key = ?', 'ai.organize') ? getSetting('ai.organize') : undefined
  const ids = { th: new Map<string, string>(), co: new Map<string, string>(), fm: new Map<string, string>(), src: new Map<string, string>(), pp: new Map<string, string>() }
  const T = (k: string) => ids.th.get(k)!, C = (k: string) => ids.co.get(k)!, F = (k: string) => ids.fm.get(k)!
  const thesisIds: string[] = []

  tx(() => {
    setSetting('ai.organize', false)   // notes are seeded as already organized; no ORGANIZE_NOTE jobs

    // theses: created and edited through the theses module at their prototype dates (history is replaced below)
    for (const th of D.theses) {
      const created = when(th.created)
      const row = at(created, () => createThesis(th.parent ? T(th.parent) : null, th.name, 'user', th.desc))
      at(created, () => updateThesis(row.id, { currentView: th.view, conviction: th.conviction }))
      ids.th.set(th.id, row.id)
      thesisIds.push(row.id)
    }

    // companies, firms, people: ids carry the prototype tile hue; follows go through objects.follow
    const insertEntity = (table: 'companies' | 'firms', id: string, name: string, site: string) =>
      run(`INSERT INTO ${table}(id, name, normalized_name, domain, created_origin, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', ?, ?)`, id, name, normalizeName(name), registrableDomain(site), NOW - 120 * DAY, NOW - 120 * DAY)
    const followedSince = when('Jun 2026')
    for (const c of D.companies) { const id = hueId('co_' + c.id, c.hue); insertEntity('companies', id, c.name, c.site); ids.co.set(c.id, id) }
    for (const f of D.firms) { const id = hueId('fm_' + f.id, f.hue); insertEntity('firms', id, f.name, f.site); ids.fm.set(f.id, id) }
    // people: every founder plus the prototype's People list (which carries their hue and follow state)
    const people = new Map<string, { name: string; hue: number; followed: boolean }>()
    for (const c of D.companies) for (const f of c.founders) people.set(f.name, { name: f.name, hue: c.hue, followed: false })
    for (const p of D.people) people.set(p.name, { name: p.name, hue: p.hue, followed: p.followed })
    for (const p of people.values()) {
      const id = hueId('pp_' + normalizeName(p.name).replace(/\s+/g, '_'), p.hue)
      run('INSERT INTO people(id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, p.name, normalizeName(p.name), NOW - 120 * DAY, NOW - 120 * DAY)
      ids.pp.set(p.name, id)
    }
    invalidateNameCache()
    at(followedSince, () => {
      for (const c of D.companies) if (c.followed) follow('company', C(c.id), true)
      for (const f of D.firms) if (f.followed) follow('firm', F(f.id), true)
      for (const p of people.values()) if (p.followed) follow('person', ids.pp.get(p.name)!, true)
    })

    // sources (direct rows: no probe, no polling schedule — demo locators are never fetched)
    D.sources.forEach((s, i) => {
      const id = hueId('src_' + s.id.replace(/^s_/, ''), s.hue, x => x + s.name)
      const kind = SRC_KIND[s.type] || 'web'
      const locator = kind === 'email' ? `newsletter@${s.name.toLowerCase().replace(/[^a-z]/g, '')}.com` : normalizeLocator(s.handle)
      const mode = s.mode === 'custom' || s.mode === 'relevant' ? s.mode : 'all'
      const config = { version: 1, fetch: { adapter: kind, render: 'http', maxItemsPerSync: 20, historyWindowDays: 30 }, relevance: { mode, instruction: s.instr, include: [], exclude: [], entityFocus: 'none' }, extract: { customFieldKeys: 'all_active' } }
      const last = when(s.last), created = NOW - 60 * DAY + (D.sources.length - i) * 60_000
      run(`INSERT INTO sources(id, name, kind, locator, canonical_locator, site_domain, type_label, trust, mode, instruction, config_json, freq, priority, enabled, last_attempt_at, last_success_at, origin, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?)`,
        id, s.name, kind, locator, kind === 'email' ? locator : cleanUrl(locator), kind === 'email' ? locator.split('@')[1] : registrableDomain(locator), s.type,
        s.type === 'Company blog' ? 'primary' : 'editorial', mode, s.instr, JSON.stringify(config), FREQ[s.freq] || 'daily', s.priority.toLowerCase(), s.enabled ? 1 : 0, last, last, created, created)
      for (const th of s.theses) run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, created_at, updated_at) VALUES (?, 'source', ?, 'covers', 'thesis', ?, 'user', 'accepted', ?, ?)`, newId('rel'), id, T(th), created, created)
      ids.src.set(s.id, id)
    })
    const srcByName = new Map(D.sources.map(s => [s.name, ids.src.get(s.id)!]))
    const srcByDomain = new Map(all<{ id: string; site_domain: string }>("SELECT id, site_domain FROM sources WHERE kind <> 'manual'").map(r => [r.site_domain, r.id]))
    const placeOf = (srcName: string) => srcByName.has(srcName) ? { sourceId: srcByName.get(srcName)!, siteName: null } : { sourceId: 'src_manual', siteName: srcName }

    // company and firm profiles: one document of facts per object → field values, founders/partners, funding, investments, commentary
    const profile = (name: string, site: string, lines: string[], t: number) => insertDoc({ sourceId: 'src_manual', siteName: registrableDomain(site), title: `About ${name}`, paras: lines, at: t })
    for (const c of D.companies) {
      const id = C(c.id), t = when('Sep 28')
      const L = { tagline: `${c.name}: ${c.tagline}.`, hq: `Headquarters: ${c.hq}.`, founded: `Founded: ${c.founded}.`, website: `Website: ${c.site}.`, stage: `Stage: ${c.stage}.` }
      const founders = c.founders.map(f => `${f.name}, ${f.role}.`)
      const rounds = c.funding.map(f => `${f.round}: ${f.amount}, ${f.date}, led by ${f.lead}.`)
      const doc = profile(c.name, c.site, [L.tagline, L.hq, ...(c.founded ? [L.founded] : []), L.website, L.stage, ...founders, ...rounds], t)
      const vals: [string, string, string][] = [['tagline', L.tagline, c.tagline], ['hq', L.hq, c.hq], ['founded', L.founded, c.founded], ['website', L.website, c.site], ['stage', L.stage, c.stage]]
      for (const [key, line, value] of vals) if (value) { const ev = addEvidence(doc, { quote: line, kind: 'other', at: t, payload: { subject: c.name, detail: `${key}: ${value}`, subjectId: id, subjectType: 'company' } }); at(t, () => writeSourceValue('company', id, key, value, ev)) }
      c.founders.forEach((f, i) => { const ev = addEvidence(doc, { quote: founders[i], kind: 'other', at: t, payload: { subject: f.name, detail: f.role } }); fact('person', ids.pp.get(f.name)!, 'founded', 'company', id, ev, t, { title: f.role }) })
      c.funding.forEach((f, i) => addEvidence(doc, { quote: rounds[i], kind: 'funding', at: when(f.date), eventDate: isoOf(f.date), payload: { round: f.round, amountText: f.amount, leadInvestors: f.lead.split(/,\s*/), companyId: id, subjectId: id, subjectType: 'company' } }))
    }
    for (const f of D.firms) {
      const id = F(f.id), t = when('Sep 28')
      const L = { tagline: `${f.name}: ${f.tagline}.`, hq: `Headquarters: ${f.hq}.`, website: `Website: ${f.site}.` }
      const inv = f.investments.map(x => `${f.name} → ${D.companies.find(c => c.id === x.co)!.name}: ${x.round}, ${x.date}.`)
      const partners = D.people.filter(p => p.orgType === 'firm' && p.org === f.id)
      const pl = partners.map(p => `${p.name}, ${p.role}.`)
      const com = f.commentary.map(x => `“${x.quote}” — ${x.who}, ${x.where}, ${x.date}.`)
      const doc = profile(f.name, f.site, [L.tagline, L.hq, L.website, ...pl, ...inv, ...com], t)
      for (const [key, line, value] of [['tagline', L.tagline, f.tagline], ['hq', L.hq, f.hq], ['website', L.website, f.site]] as [string, string, string][]) {
        const ev = addEvidence(doc, { quote: line, kind: 'other', at: t, payload: { subject: f.name, detail: `${key}: ${value}`, subjectId: id, subjectType: 'firm' } })
        at(t, () => writeSourceValue('firm', id, key, value, ev))
      }
      partners.forEach((p, i) => { const ev = addEvidence(doc, { quote: pl[i], kind: 'other', at: t, payload: { subject: p.name, detail: p.role } }); fact('person', ids.pp.get(p.name)!, 'partner_at', 'firm', id, ev, t, { title: p.role }) })
      f.investments.forEach((x, i) => {
        const role = /lead/i.test(x.round) ? 'lead' : /participation/i.test(x.round) ? 'participant' : 'unknown'
        const ev = addEvidence(doc, { quote: inv[i], kind: 'investment', at: when(x.date), eventDate: isoOf(x.date), confidence: 0.9, payload: { firmId: id, companyId: C(x.co), round: x.round, role, subjectId: id, subjectType: 'firm' } })
        fact('firm', id, 'invested_in', 'company', C(x.co), ev, when(x.date), { role, round: x.round })
      })
      f.commentary.forEach((x, i) => addEvidence(doc, { quote: x.quote, claim: x.quote, kind: 'opinion', at: when(x.date), eventDate: isoOf(x.date), attributedTo: `${x.who}, ${f.name}`, payload: { speaker: x.who, org: f.name } }))
    }

    // feed items: document (body), evidence (extracts, highlights, thesis evidence), entity and thesis links, then upsertFeedItem
    const itemKind = (it: PIt) => { for (const c of D.companies) { const a = c.activity.find(x => x.item === it.id); if (a) return ACT_KIND[a.kind] || 'other' } return 'other' }
    const evDoc = new Map<string, { id: string; text: string }>()
    const evIds = new Map<string, string>()
    const evAt = (e: PEv) => when(e.date)
    const addThesisEvidence = (e: PEv, doc: { id: string; text: string }, quote: string, kept: boolean) => {
      const evId = addEvidence(doc, { quote, claim: e.text, kind: EV_KIND[e.id] || 'other', at: evAt(e), eventDate: isoOf(e.date), kept, payload: e.cos.length ? { subjectId: C(e.cos[0]), subjectType: 'company' } : {} })
      evIds.set(e.id, evId); evDoc.set(e.id, doc)
      for (const co of e.cos) fact('evidence', evId, 'about', 'company', C(co), evId, evAt(e))
      return evId
    }
    const firmKept = new Set(D.firms.flatMap(f => f.evidence))
    D.items.forEach((it, idx) => {
      const surfaced = NOW - (it.day === 'earlier' ? it.ago : Math.min(it.ago, 23)) * HOUR
      const published = NOW - it.ago * HOUR
      const doc = insertDoc({ sourceId: ids.src.get(it.srcId)!, url: 'https://' + it.url, title: it.title, paras: it.body, at: published, summary: it.summary, why: it.why })
      const hosted = D.evidence.filter(e => EV_HOME[e.id]?.item === it.id)
      for (const e of hosted) addThesisEvidence(e, doc, EV_HOME[e.id].quote!, it.hl.includes(EV_HOME[e.id].quote!) || (firmKept.has(e.id) && it.day === 'earlier'))
      for (const x of it.extracts) if (!hosted.some(e => EV_HOME[e.id].quote === x)) addEvidence(doc, { quote: x, kind: itemKind(it), at: published, origin: it.hl.includes(x) ? 'user_highlight' : 'ai_extraction' })
      for (const x of it.hl) if (!it.extracts.includes(x)) addEvidence(doc, { quote: x, kind: itemKind(it), at: published, origin: 'user_highlight' })
      const firstEv = one<{ id: string }>("SELECT id FROM evidence WHERE document_id = ? ORDER BY confidence DESC, quote_start LIMIT 1", doc.id)?.id ?? null
      it.cos.forEach((co, i) => fact('document', doc.id, i === 0 ? 'about' : 'mentions', 'company', C(co), firstEv, published))
      for (const fm of it.firms) fact('document', doc.id, 'mentions', 'firm', F(fm), null, published)
      // a review item's primary thesis is the suggested one (itemDTO offers the suggestion for the primary link only);
      // the primary link carries the item's stance, the others read "Related"
      const primary = it.review && it.suggest ? it.suggest : { thesis: it.thesis, stance: it.stance }
      for (const th of it.theses) {
        const sug = it.review && it.suggest?.thesis === th
        link('document', doc.id, 'thesis', T(th), published, { stance: th === it.thesis || sug ? (sug ? it.suggest!.stance : it.stance) : 'neutral', suggested: sug, explanation: sug ? 'Suggested connection needs your review' : undefined })
      }
      const fi = upsertFeedItem(doc.id)
      if (!fi) throw new AppError('INTERNAL', `Demo item ${it.id} did not pass the feed gate`)
      run(`UPDATE feed_items SET headline = ?, reasons_json = ?, group_key = ?, score = ?, importance = ?, novelty = 1, primary_thesis_id = ?, primary_stance = ?, needs_review = ?,
             surfaced_at = ?, read_at = ?, created_at = ?, updated_at = ? WHERE id = ?`,
        it.title, reasonsJson(it), it.group, 0.99 - idx * 0.01, 0.8, T(primary.thesis), primary.stance, it.review ? 1 : 0, surfaced, it.unread ? null : surfaced, surfaced, surfaced, fi)
    })

    // company activity without a feed item: one dated document each (and an archived item when the prototype gives a "why")
    for (const c of D.companies) for (const a of c.activity) {
      if (a.item) continue
      const t = when(a.date)
      const extra = D.evidence.filter(e => EV_HOME[e.id]?.activityOf === c.id && e.date === a.date.replace(/, \d{4}$/, ''))
      const doc = insertDoc({ ...placeOf(a.src), title: a.title, paras: [a.title + '.', ...extra.map(e => e.text)], at: t, summary: a.title + '.', ...(a.why ? { why: a.why } : {}) })
      const ev = addEvidence(doc, { quote: a.title + '.', claim: a.title, kind: ACT_KIND[a.kind] || 'other', at: t, eventDate: isoOf(a.date), confidence: 0.7 })
      for (const e of extra) addThesisEvidence(e, doc, e.text, firmKept.has(e.id))
      fact('document', doc.id, 'about', 'company', C(c.id), extra.length ? evIds.get(extra[0].id)! : ev, t)
      if (a.why) {
        const fi = at(t, () => upsertFeedItem(doc.id))
        if (fi) run('UPDATE feed_items SET group_key = ?, read_at = ?, dismissed_at = ?, dismiss_reason = ?, surfaced_at = ?, created_at = ? WHERE id = ?', 'companies', t, t, 'archived', t, t, fi)
      }
    }

    // remaining evidence: an archive document per quote (source by name, else a Read-once document labelled with the site)
    for (const e of D.evidence) {
      if (evIds.has(e.id)) continue
      const t = evAt(e)
      const doc = insertDoc({ ...placeOf(e.src), kind: e.src === 'Your note' ? 'text' : 'web', title: e.text.length > 90 ? e.text.slice(0, e.text.lastIndexOf(' ', 88)) + '…' : e.text.replace(/\.$/, ''), paras: [e.text], at: t })
      addThesisEvidence(e, doc, e.text, firmKept.has(e.id) || e.src === 'Your note')
    }
    // evidence → thesis links (user-accepted; a review item's suggested thesis stays a suggestion) and firm "kept evidence"
    // Pairs come from each thesis's Supporting/Contradicting columns, then from the evidence's own thesis list. A link counts
    // as a recent change (thesis rail, 30 days) only when the thesis lists a change on that date and stance; others are older.
    const pairs = new Map<string, { e: PEv; th: PTh; stance: Stance }>()
    for (const th of D.theses) for (const [ids2, stance] of [[th.sup, 'support'], [th.con, 'contra']] as [string[], Stance][]) for (const id of ids2) pairs.set(id + '|' + th.id, { e: D.evidence.find(x => x.id === id)!, th, stance })
    for (const e of D.evidence) for (const th of e.theses) if (!pairs.has(e.id + '|' + th)) pairs.set(e.id + '|' + th, { e, th: D.theses.find(x => x.id === th)!, stance: e.stance })
    for (const { e, th, stance } of pairs.values()) {
      const host = D.items.find(i => i.id === EV_HOME[e.id]?.item)
      const sug = !!host?.review && host.suggest?.thesis === th.id
      const recent = th.changes.some(c => c.date === e.date && c.kind === stance)
      link('evidence', evIds.get(e.id)!, 'thesis', T(th.id), evAt(e), { stance, suggested: sug, explanation: sug ? 'Suggested connection needs your review' : undefined, createdAt: recent ? evAt(e) : evAt(e) - 31 * DAY })
    }
    for (const f of D.firms) for (const e of f.evidence) fact('evidence', evIds.get(e)!, 'about', 'firm', F(f.id), evIds.get(e)!, when('Sep 28'))
    for (const e of D.evidence) if (e.note) at(evAt(e), () => createNote({ text: e.note, kind: 'observation', kindDecided: true, anchor: { type: 'none' }, documentId: evDoc.get(e.id)!.id, quote: one<{ quote: string }>('SELECT quote FROM evidence WHERE id = ?', evIds.get(e.id))!.quote }))

    // firm writing without a feed item (only firms with a source on their site can show writing)
    for (const f of D.firms) for (const w of f.writing) {
      const sourceId = srcByDomain.get(registrableDomain(f.site))
      if (w.item || !sourceId) continue
      insertDoc({ sourceId, title: w.title, paras: [w.title + '.'], at: when(w.date) })
    }
    // people: their latest appearance
    for (const p of D.people) {
      const t = when(p.lastDate)
      const org = p.orgType === 'company' ? D.companies.find(c => c.id === p.org)!.name : D.firms.find(f => f.id === p.org)!.name
      const doc = insertDoc({ sourceId: 'src_manual', siteName: org, title: p.last, paras: [p.last + '.'], at: t })
      fact('document', doc.id, 'about', 'person', ids.pp.get(p.name)!, null, t)
    }

    // thesis ↔ company / firm links, notes, questions, thoughts
    for (const th of D.theses) {
      const base = when(th.updated)
      th.companies.forEach((co, i) => at(base - i * 60_000, () => addCompanyToThesis(T(th.id), C(co))))
      // questions list newest first, so the first one is stamped last
      th.questions.forEach((q, i) => at(when(th.created) + (th.questions.length - i) * 60_000, () => createNote({ text: q, kind: 'question', kindDecided: true, anchor: { type: 'thesis', id: T(th.id) } })))
      for (const x of th.thoughts) at(when(x.date), () => createNote({ text: x.text, kind: 'observation', kindDecided: true, anchor: { type: 'thesis', id: T(th.id) } }))
    }
    // firm ↔ thesis from the firm's list (thesis pages add the investors of their companies on their own)
    for (const f of D.firms) for (const th of f.theses) link('firm', F(f.id), 'thesis', T(th), NOW - 30 * DAY)
    for (const c of D.companies) for (const n of c.notes) at(when(n.date), () => createNote({ text: n.text, kind: 'observation', kindDecided: true, anchor: { type: 'company', id: C(c.id) } }))
    for (const f of D.firms) for (const n of f.notes) at(when(n.date), () => createNote({ text: n.text, kind: 'observation', kindDecided: true, anchor: { type: 'firm', id: F(f.id) } }))

    // thesis history: replace what seeding wrote with the prototype's Evolution timeline
    run(`DELETE FROM history WHERE entity_type = 'thesis' AND entity_id IN (${thesisIds.map(() => '?').join(',')})`, ...thesisIds)
    for (const th of D.theses) {
      const id = T(th.id)
      if (!th.evo.length) { at(when(th.created), () => writeHistory('thesis', id, 'thesis.created', null, { title: th.name, parentId: th.parent ? T(th.parent) : null, conviction: th.conviction })); continue }
      let conv = 0
      for (const m of th.evo) {
        let last = 0
        m.events.forEach((ev, i) => {
          const t = when(ev.date) + i * 1000
          last = t
          at(t, () => {
            if (ev.kind === 'Created') { writeHistory('thesis', id, 'thesis.created', null, { title: th.name, parentId: th.parent ? T(th.parent) : null, conviction: m.conv }); conv = m.conv }
            else if (ev.kind === 'Conviction') { writeHistory('thesis', id, 'thesis.conviction', { conviction: conv }, { conviction: m.conv }); conv = m.conv }
            else if (ev.kind === 'Revision') writeHistory('thesis', id, 'thesis.view_revised', { currentView: ev.before }, { currentView: ev.after })
            else if (ev.kind === 'Child thesis') writeHistory('thesis', id, 'thesis.child_created', null, { title: (ev.text.match(/“(.+)”/) || [])[1] || ev.text })
            else if (ev.kind === 'Counterpoint') writeHistory('thesis', id, 'note.counterpoint', null, { text: ev.text })
            else writeHistory('thesis', id, 'evidence.accepted', null, { text: ev.text })
          })
        })
        // the prototype states each month's conviction; a change without its own event is logged after the month's events
        if (conv !== m.conv) { at(last + 1000, () => writeHistory('thesis', id, 'thesis.conviction', { conviction: conv }, { conviction: m.conv })); conv = m.conv }
      }
    }
    for (const th of D.theses) run('UPDATE theses SET created_at = ?, updated_at = ? WHERE id = ?', when(th.created), when(th.updated), T(th.id))

    // sidebar pins (prototype initial state)
    for (const th of ['t_vai', 't_infra', 't_pricing']) pin('thesis', T(th), true)
    for (const co of ['harvey', 'ramp', 'eleven']) pin('company', C(co), true)

    // Sources ▸ On-demand history
    for (const h of D.history) at(when(h.date), () => recordOnDemand({ url: null, title: h.title, type: h.type, outcome: h.outcome, documentId: null }))

    // reports: the prototype's three are the built-in templates; enable them, scope the vertical-AI one, drop the fourth
    const tpl = (key: string) => one<{ id: string; definition_json: string }>('SELECT id, definition_json FROM reports WHERE template_key = ? AND deleted_at IS NULL', key)
    const order: [string, string][] = [['daily_brief', 'r_daily'], ['theses_changed', 'r_weekly'], ['vertical_ai_deals', 'r_seed']]
    order.forEach(([key, pid], i) => {
      const r = tpl(key)
      if (!r) return
      if (key === 'vertical_ai_deals') {
        const def = JSON.parse(r.definition_json)
        for (const s of def.sections) s.query.theses = [T('t_vai')]
        run('UPDATE reports SET definition_json = ? WHERE id = ?', JSON.stringify(def), r.id)
      }
      reports.setEnabled(r.id, true)
      run('UPDATE reports SET last_run_at = ?, created_at = ? WHERE id = ?', when(D.reports.find(x => x.id === pid)!.last), NOW - (i + 1) * 60_000, r.id)
    })
    const extraTpl = tpl('evidence_against')
    if (extraTpl) reports.remove(extraTpl.id)

    // alerts: the first two are the built-in seeds; the firm-led one needs the firms, so it is added here
    const alertByName = (name: string) => one<{ id: string }>('SELECT id FROM alert_rules WHERE name = ? AND deleted_at IS NULL', name)?.id
    const a3 = D.alerts[2]
    if (!alertByName(a3.text)) {
      const rule: AlertRule = { version: 1, event: 'evidence_created', filters: { kinds: ['funding', 'investment'], investorFirms: [F('benchmark'), F('sequoia')], investorRole: 'lead', novelOnly: true } }
      run(`INSERT INTO alert_rules(id, text, name, status, rule_json, summary, channels_json, enabled, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, '["in_app"]', 0, ?, ?)`,
        newId('al'), a3.text, a3.text, JSON.stringify(rule), alerts.summarize(rule), NOW, NOW)
    }
    D.alerts.forEach((a, i) => {
      const id = alertByName(a.text)
      if (!id) return
      alerts.setEnabled(id, a.enabled)
      run('UPDATE alert_rules SET created_at = ? WHERE id = ?', NOW - (i + 1) * 60_000, id)
    })

    // Sources ▸ Suggested: the prototype lists its own picks; starter-pack entries it doesn't show are dismissed
    const keep = D.suggested.map(x => x.name.toLowerCase())
    for (const sg of sources.suggestions()) if (sg.id.startsWith('starter:') && !keep.some(k => k.startsWith(sg.name.toLowerCase()) || sg.name.toLowerCase().startsWith(k))) sources.dismissSuggestion(sg.id)
    // prototype page state outside data.js: the signed-in name and ⌘K recent searches
    if (!getSetting('display_name')) setSetting('display_name', 'Maya Rosen')
    setSetting('recent_queries', ['what changed in legal AI', 'evidence about AI replacing BPO', 'Benchmark investments', 'Harvey'])

    if (organize === undefined) run("DELETE FROM settings WHERE key = 'ai.organize'")
    else setSetting('ai.organize', organize)
    setSetting('first_run_done', true)
  })

  for (const ev of ['feed.updated', 'object.updated', 'source.updated', 'report.ready', 'settings.updated', 'banner.updated'] as const) emit(ev, {})
  const count = (sql: string) => one<{ n: number }>(sql)!.n
  return {
    ok: true,
    counts: {
      theses: count('SELECT COUNT(*) n FROM theses'), companies: count('SELECT COUNT(*) n FROM companies'), firms: count('SELECT COUNT(*) n FROM firms'), people: count('SELECT COUNT(*) n FROM people'),
      sources: count("SELECT COUNT(*) n FROM sources WHERE kind <> 'manual'"), documents: count('SELECT COUNT(*) n FROM documents'), evidence: count('SELECT COUNT(*) n FROM evidence'),
      feedItems: count('SELECT COUNT(*) n FROM feed_items WHERE dismissed_at IS NULL'), notes: count('SELECT COUNT(*) n FROM notes'),
      reports: count('SELECT COUNT(*) n FROM reports WHERE deleted_at IS NULL'), alerts: count('SELECT COUNT(*) n FROM alert_rules WHERE deleted_at IS NULL')
    }
  }
}
