// Deterministic guards on EXTRACT_DOCUMENT output (DEC-092). The model proposes entities; these rules decide which
// names may become library companies/firms, using only the document text, its publisher and what the library already
// knows — never model memory:
//  - companies are businesses the document reports on; firms are organizations that invest money in companies.
//  - generic placeholders ("startups", "unknown", "undisclosed angels") are never entities.
//  - the document's own publisher (site name / source / domain) is not an entity from its byline or boilerplate; it
//    stays only when it is the subject of a business event in the text, or the document is its own blog.
//  - government bodies, countries and universities are never companies, and are firms only where they invest.
//  - a new firm needs an investor role in this document (or text that describes it as an investor, or a
//    venture-style name); a name is one type per document (investor role → firm, unless the library knows it only as
//    a company — a corporation that invests stays a company).
//  - in-document aliases ("Amazon Web Services (AWS)", or aliases the model lists) fold into one mention.
// Field-value and people-role groundings live here too, so process.ts only orchestrates.
import { normalizeName, resolveDeterministic } from '../entities/resolve'
import type { ExtractValue } from '../ai/tasks/document'
import { acceptAlias } from '../entities/aliases'

type V = ExtractValue
type Ev = V['evidence'][number]

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------------------------------------------------------------- name classes
const PLACEHOLDER = new RegExp('^(?:(?:an?|the|other|others|several|various|some|many|multiple|unnamed|undisclosed|unknown|unidentified|existing|new|returning|prominent|notable|high[- ]profile|individual|private|strategic|institutional|angel|anonymous|additional|top|leading|major|well[- ]known|local|global|its|their)\\s+)*' +
  '(?:investors?|angels?|angel investors?|backers?|investment firms?|vc firms?|vcs?|venture (?:capital )?firms?|venture capitalists?|funds?|firms?|family offices?|' +
  'compan(?:y|ies)|startups?|start-ups?|businesses|organi[sz]ations?|entities|parties|individuals|people|others|unknown|undisclosed|n/?a|none|stealth(?: startup| company)?|' +
  'tech compan(?:y|ies)|ai (?:compan(?:y|ies)|startups?|labs?))$', 'i')

/** A generic stand-in, not a name. */
export function isPlaceholder(name: string): boolean {
  const n = name.trim().replace(/[’']s$/, '')
  return !/\p{L}/u.test(n) || n.length < 2 || PLACEHOLDER.test(n) || /^(?:fortune|global|forbes|inc\.?|s&p)\s+\d+$/i.test(n) || COLLECTIVE.test(n)
}
/** A description of a group, not a name: it ends in a lowercase plural class noun ("European AI-focused startups",
 *  "Bay Area fintech companies"). Real names capitalize that word ("Hearst Companies", "Founders Fund"). Run #15:
 *  "European AI-focused startups raised $23 billion" became a company and topped a capital chart. */
const COLLECTIVE = /\s(?:startups|start-ups|companies|businesses|firms|investors|founders|unicorns|players|vendors|providers|makers|labs|lenders|insurers|banks|funds)$/

const INSTITUTION = /\b(?:university|universit[éä]|college|polytechnic|school of|department of|ministry|government|parliament|senate|congress|white house|supreme court|court of|federal reserve|national laborator(?:y|ies)|national institutes? of|office of|armed forces|army|navy|air force|military|pentagon|police)\b|(?:commission|agency|administration|bureau|authority|council)$/i
const GOV_ACRONYMS = new Set(['ftc', 'sec', 'doj', 'dod', 'fda', 'fcc', 'nasa', 'darpa', 'nist', 'nih', 'nsf', 'irs', 'cia', 'nsa', 'fbi', 'cfpb', 'occ', 'fdic', 'eu', 'un', 'us', 'usa', 'uk', 'u s', 'u s government', 'us government'])
let countries: Set<string> | null = null
function countryNames(): Set<string> {
  if (countries) return countries
  countries = new Set()
  const dn = new Intl.DisplayNames(['en'], { type: 'region' })
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b)
    try { const n = dn.of(code); if (n && n !== code) countries.add(normalizeName(n)) } catch { /* not a region */ }
  }
  for (const extra of ['united states of america', 'america', 'britain', 'great britain', 'europe', 'european union']) countries.add(extra)
  return countries
}

/** Governments, agencies, countries and universities (by name form only; "NASA’s Jet Propulsion Laboratory" too). */
export function isInstitution(name: string): boolean {
  const n = normalizeName(name)
  const owner = name.match(/^(.+?)[’']s\s/)?.[1]
  return INSTITUTION.test(name) || GOV_ACRONYMS.has(n) || countryNames().has(n) || (!!owner && (GOV_ACRONYMS.has(normalizeName(owner)) || INSTITUTION.test(owner)))
}

/** News outlets, magazines, newsletters and podcasts by name form ("Korea IT Times", "Lenny’s Newsletter"). */
const MEDIA = /\b(?:news|times|journal|post|magazine|review|insider|newsletter|daily|weekly|tribune|herald|gazette|media|press|radio|tv|podcast|reporter|chronicle|wire)\b/i

const FIRM_NAME = /\b(?:ventures?|capital|partners|partnership|vc|fund|funds|investments?|investors|holdings|accelerator|incubator|combinator|angels|equity|asset management|management)\b/i

// ---------------------------------------------------------------- per-document context
export interface DocCtx {
  text: string
  title: string
  byline: string | null
  /** site name, source names and the domain label of the document's own publisher */
  publisherNames: string[]
  /** the document comes from the publisher's own blog (company/VC blog, or a site a library entity owns) */
  ownSite: boolean
  /** the firm whose VC blog this is, if known */
  publisherFirm: string
}

const BUSINESS_KINDS = new Set(['funding', 'investment', 'fund_raise', 'product_launch', 'partnership', 'customer_adoption', 'pricing', 'acquisition', 'expansion', 'metric'])
const INVESTOR_TITLE = /partner|principal|general partner|managing director|investor|venture/i

function investorNames(v: V): Set<string> {
  const s = new Set<string>()
  for (const e of v.evidence) {
    const p = e.payload
    if (e.kind === 'funding' || e.kind === 'investment') for (const n of [...p.leadInvestors, ...p.participants]) s.add(normalizeName(n))
    if ((e.kind === 'investment' || e.kind === 'fund_raise') && p.firm) s.add(normalizeName(p.firm))
    if ((e.kind === 'investment' || e.kind === 'fund_raise') && e.subject.type === 'firm') s.add(normalizeName(e.subject.name))
  }
  for (const pp of v.people) if (pp.orgType === 'firm' && INVESTOR_TITLE.test(pp.title || '')) s.add(normalizeName(pp.org))
  s.delete('')
  return s
}

/** The text itself describes `name` as an investor ("venture firm X", "X, a seed fund", "X-backed", "X led"). */
function describedAsInvestor(name: string, text: string): boolean {
  const n = esc(name)
  return new RegExp(`(?:venture(?: capital)?|VC|investment|private[- ]equity|growth(?: equity)?|seed|crossover)\\s+(?:firm|fund|investor|arm|shop)\\s+${n}\\b`, 'i').test(text)
    || new RegExp(`\\b${n},\\s+(?:a|an|the)\\s+[^,.;]{0,60}?\\b(?:venture|VC|investment|investor|private[- ]equity|fund|accelerator|incubator)`, 'i').test(text)
    || new RegExp(`\\b${n}(?:-backed|\\s+(?:led|co-led|invested|participated|backed))\\b`, 'i').test(text)
    // named among a round's backers: "… seed round led by A with participation from B", "brought in C and D"
    || sentencesWith(name, text).some(s => /\b(?:round|funding|financing|raised?|raises|seed|series)\b/i.test(s)
      && new RegExp(`\\b(?:led by|co-led by|from|participation (?:from|of)|brought in|including|joined by|backed by|investors? (?:include|including))\\b[^.;]{0,240}?\\b${n}\\b`, 'i').test(s))
}

function sentencesWith(name: string, text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(new RegExp(esc(name), 'g'))) {
    let s = m.index!, e = m.index! + name.length
    while (s > 0 && !/[.!?\n]/.test(text[s - 1])) s--
    while (e < text.length && !/[.!?\n]/.test(text[e])) e++
    out.push(text.slice(s, e))
    if (out.length > 5) break
  }
  return out
}

/** "Amazon Web Services (AWS)" in the text → AWS is an alias of Amazon Web Services in this document. */
function textAbbreviations(name: string, text: string): string[] {
  const out: string[] = []
  const re = new RegExp(`\\b${esc(name)}\\s+\\(([A-Z][A-Za-z0-9.&-]{1,11})\\)`, 'g')
  for (const m of text.matchAll(re)) out.push(m[1])
  return out
}

// ---------------------------------------------------------------- the guard
export interface GuardResult { rejected: { name: string; type: string; why: string }[]; typeOf: (name: string) => 'company' | 'firm' }

/** Clean the extraction in place. Order: aliases → types → rejects → apply drops everywhere a name is used. */
export function guardEntities(v: V, ctx: DocCtx): GuardResult {
  const rejected: GuardResult['rejected'] = []
  // (1) names must be the document's own: a listed name the text never uses is replaced by an alias it does use
  // ("AWS" when the model expanded it to "Amazon Web Services"), else it is not an entity of this document
  const inText = textMatcher(`${ctx.title}\n${ctx.text}`)
  for (const c of [...v.companies, ...v.firms] as { name: string; aliases: string[] }[]) {
    c.aliases = (c.aliases || []).filter(a => inText(a))
    if (!inText(c.name) && c.aliases.length) { const used = c.aliases[0]; c.aliases = c.aliases.slice(1); renameAll(v, c.name, used); c.name = used }
  }
  // in-document aliases: fold every alias spelling into the listed name — but never another listed entity's own name:
  // "Mercury" with alias "Stripe" while Stripe is listed too would fold Stripe into Mercury (run #18; MEM-058)
  const listed = new Set(([...v.companies, ...v.firms] as { name: string }[]).map(c => normalizeName(c.name)))
  const canon = new Map<string, string>()   // normalized alias → listed name
  for (const c of [...v.companies, ...v.firms] as { name: string; aliases: string[] }[]) {
    const abbr = textAbbreviations(c.name, ctx.text)   // "Amazon Web Services (AWS)" in the text: AWS folds in even when listed
    c.aliases = [...new Set([...(c.aliases || []), ...abbr])]
      .filter(a => a && spelling(a) !== spelling(c.name) && !isPlaceholder(a))   // "Lumen Legal, Inc." stays an alias
      .filter(a => abbr.includes(a) || normalizeName(a) === normalizeName(c.name) || !listed.has(normalizeName(a)))
      // and only a name this text states is the same entity — partners, chips, tickers and products never (MEM-060)
      .filter(a => abbr.includes(a) || acceptAlias(c.name, a, `${ctx.title}\n${ctx.text}`, 'company'))
    for (const a of c.aliases) if (!canon.has(normalizeName(a))) canon.set(normalizeName(a), c.name)
  }
  const C = (n: string | null) => (n ? canon.get(normalizeName(n)) || n : n)
  rename(v, C)
  v.companies = dedupeByName(v.companies)
  v.firms = dedupeByName(v.firms)

  // (2) one type per name in this document
  const inv = investorNames(v)
  const knownOnly = (name: string, t: 'company' | 'firm') => !!resolveDeterministic(t, name) && !resolveDeterministic(t === 'firm' ? 'company' : 'firm', name)
  const listedCo = new Set(v.companies.map(c => normalizeName(c.name)))
  const listedFm = new Set(v.firms.map(f => normalizeName(f.name)))
  const hint = new Map<string, 'company' | 'firm'>()
  const hintAs = (n: string | null, t: string) => { if (n && (t === 'company' || t === 'firm') && !hint.has(normalizeName(n))) hint.set(normalizeName(n), t) }
  for (const e of v.evidence) { if (e.subject.type !== 'person') hintAs(e.subject.name, e.subject.type); hintAs(e.payload.firm, 'firm'); hintAs(e.payload.company, 'company') }
  for (const pp of v.people) hintAs(pp.org, pp.orgType)
  for (const f of v.fields) hintAs(f.objectName, f.objectType)
  // a business here: the subject of a non-investing business event, or the company in a fact's payload
  const businessHere = (n: string) => v.evidence.some(e => (BUSINESS_KINDS.has(e.kind) && e.kind !== 'investment' && e.kind !== 'fund_raise' && e.subject.type !== 'person' && normalizeName(e.subject.name) === n) || normalizeName(e.payload.company || '') === n)
  const typeOf = (name: string): 'company' | 'firm' => {
    const n = normalizeName(name)
    if (knownOnly(name, 'company')) return 'company'
    if (knownOnly(name, 'firm')) return 'firm'
    // an investor in this document is a firm — unless the document also treats it as an operating business
    // (a corporation investing stays a company)
    if (inv.has(n)) return businessHere(n) && !listedFm.has(n) ? 'company' : 'firm'
    if (listedCo.has(n) && listedFm.has(n)) return 'company'
    if (listedCo.has(n)) return FIRM_NAME.test(name) && !businessHere(n) && describedAsInvestor(name, ctx.text) ? 'firm' : 'company'
    if (listedFm.has(n)) return 'firm'
    return hint.get(n) || 'company'
  }

  // (3) which names may exist at all
  const pub = new Set(ctx.publisherNames.map(normalizeName).filter(Boolean))
  const subjectOfBusiness = (n: string) => v.evidence.some(e => BUSINESS_KINDS.has(e.kind) && ((e.subject.type !== 'person' && normalizeName(e.subject.name) === n) || normalizeName(e.payload.company || '') === n)) || inv.has(n)
  const retype = new Map<string, 'company' | 'firm'>()
  const drop = new Map<string, string>()     // `${type}:${normalized}` → reason
  const verdict = (name: string, type: 'company' | 'firm'): string | null => {
    const n = normalizeName(name)
    if (isPlaceholder(name)) return 'placeholder'
    if (resolveDeterministic(type, name)) return null       // already in the library as this type
    if (!inText(name)) return 'not in the text'
    if (!ctx.ownSite && pub.has(n) && !subjectOfBusiness(n)) return 'publisher'
    if (type === 'company' && isInstitution(name)) return 'institution'
    if (MEDIA.test(name) && !subjectOfBusiness(n)) return 'media'
    if (type === 'firm') {
      if (inv.has(n)) return null                           // invests in this document (incl. endowments, sovereign funds)
      if (isInstitution(name)) return 'institution'
      if (FIRM_NAME.test(name) || describedAsInvestor(name, ctx.text) || normalizeName(ctx.publisherFirm) === n) return null
      // listed as a firm but only acts as a business here (OpenAI launching a product) → a company; else nothing
      if (businessHere(n)) { retype.set(n, 'company'); return null }
      return 'not an investor here'
    }
    return null
  }
  const names = new Set<string>()
  const each = (n: string | null | undefined) => { if (n && n.trim()) names.add(n.trim()) }
  for (const c of v.companies) each(c.name)
  for (const f of v.firms) each(f.name)
  for (const e of v.evidence) { if (e.subject.type !== 'person') each(e.subject.name); each(e.payload.company); each(e.payload.firm); e.payload.leadInvestors.forEach(each); e.payload.participants.forEach(each) }
  for (const pp of v.people) each(pp.org)
  for (const f of v.fields) each(f.objectName)
  const finalType = new Map<string, 'company' | 'firm'>()
  for (const name of names) {
    const t = typeOf(name)
    const why = verdict(name, t)
    finalType.set(normalizeName(name), retype.get(normalizeName(name)) || t)
    if (why) { drop.set(normalizeName(name), why); rejected.push({ name, type: t, why }) }
  }
  const ok = (n: string | null | undefined) => !!n && !drop.has(normalizeName(n))
  const tOf = (n: string) => finalType.get(normalizeName(n)) || 'company'

  // (4) apply: lists, payloads, subjects, people, fields
  const retyped = [...v.companies, ...v.firms] as { name: string; domain: string | null; aliases: string[] }[]
  v.companies = retyped.filter(c => ok(c.name) && tOf(c.name) === 'company').map(c => ({ name: c.name, domain: c.domain, aliases: c.aliases || [] }))
  v.firms = retyped.filter(c => ok(c.name) && tOf(c.name) === 'firm').map(c => ({ name: c.name, domain: c.domain, aliases: c.aliases || [] }))
  v.companies = dedupeByName(v.companies); v.firms = dedupeByName(v.firms)
  const kept: Ev[] = []
  for (const e of v.evidence) {
    const p = e.payload
    p.leadInvestors = p.leadInvestors.filter(ok); p.participants = p.participants.filter(ok)
    if (p.company && !ok(p.company)) p.company = null
    if (p.firm && !ok(p.firm)) p.firm = null
    if (e.subject.type !== 'person') {
      if (!ok(e.subject.name)) {
        // re-subject to a kept company the quote itself names, else the claim has no library subject
        const alt = v.companies.find(c => e.quote.toLowerCase().includes(c.name.toLowerCase()))
        if (!alt) continue
        e.subject = { type: 'company', name: alt.name }
      } else e.subject = { ...e.subject, type: tOf(e.subject.name) }
    }
    kept.push(e)
  }
  v.evidence = kept
  v.people = v.people.filter(pp => ok(pp.org) && !isPlaceholder(pp.name)).map(pp => ({ ...pp, orgType: tOf(pp.org) }))
  // a field follows its object's type; keys that type doesn't have are ignored at persist time
  v.fields = v.fields.filter(f => ok(f.objectName)).map(f => ({ ...f, objectType: tOf(f.objectName) }))
  return { rejected, typeOf: tOf }
}

const spelling = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Loose "the text uses this name": case, punctuation, curly quotes and spacing ignored. */
function textMatcher(text: string): (name: string) => boolean {
  const flat = (s: string) => ' ' + s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' '
  const t = flat(text)
  return (name: string) => { const n = flat(name).trim(); return !!n && t.includes(' ' + n + ' ') || (n.length > 3 && t.includes(' ' + n)) }
}

function renameAll(v: V, from: string, to: string): void {
  const k = normalizeName(from)
  rename(v, n => (n && normalizeName(n) === k ? to : n))
}

function rename(v: V, C: (n: string | null) => string | null): void {
  for (const e of v.evidence) {
    if (e.subject.type !== 'person') e.subject = { ...e.subject, name: C(e.subject.name)! }
    const p = e.payload
    p.company = C(p.company); p.firm = C(p.firm); p.org = C(p.org)
    p.leadInvestors = [...new Set(p.leadInvestors.map(n => C(n)!))]
    p.participants = [...new Set(p.participants.map(n => C(n)!))]
  }
  for (const pp of v.people) pp.org = C(pp.org)!
  for (const f of v.fields) f.objectName = C(f.objectName)!
}

function dedupeByName<T extends { name: string; domain: string | null; aliases: string[] }>(xs: T[]): T[] {
  const m = new Map<string, T>()
  for (const x of xs) {
    const k = normalizeName(x.name), ex = m.get(k)
    if (!ex) m.set(k, { ...x, aliases: [...(x.aliases || [])] })
    else { ex.domain = ex.domain || x.domain; ex.aliases = [...new Set([...ex.aliases, ...(x.aliases || [])])] }
  }
  return [...m.values()]
}

// ---------------------------------------------------------------- people
const ROLE_WORDS = /\b(?:founder|co-?founder|founded|founding|ceo|cto|cfo|coo|chief|president|chair(?:man|woman|person)?|head|vp|vice president|director|partner|principal|investor|engineer|lead|manager|executive|officer|board|joined|hired|appointed|leads|led)\b/i
/** "By Jane Doe", "Illustration: Dom Guzman", "Photo credit: …" — but not "By 2027, …" or "By focusing on …". */
const BYLINE_LINE = /^(?:(?:written |reporting |edited )?by\s+\p{Lu}[\p{L}.'’-]*(?:\s+(?:\p{Lu}[\p{L}.'’-]*|and|&))*\.?$|(?:illustration|photo|photograph|image|credit|photo credit)s?\s*(?::|by\b))/iu

/** Words in `s` other than the person's name. */
const otherWords = (s: string, name: string) => s.replace(new RegExp(esc(name), 'gi'), ' ').split(/\s+/).filter(w => /\p{L}/u.test(w)).length

/**
 * A sentence that grounds a person's tie to their org: it names the person and (the org, or a role word), and is not a
 * byline/credit line. Returns null when the text never ties them — e.g. a reporter named only in the byline.
 */
export function personSupport(text: string, name: string, org: string, title: string | null, strict = false): { start: number; end: number } | null {
  const re = new RegExp(esc(name), 'gi')
  for (const m of text.matchAll(re)) {
    let s = m.index!, e = m.index! + name.length
    while (s > 0 && !/[.!?\n]/.test(text[s - 1])) s--
    while (s < m.index! && /\s/.test(text[s])) s++
    while (e < text.length && !/[.!?\n]/.test(text[e])) e++
    if (e < text.length && /[.!?]/.test(text[e])) e++
    const sent = text.slice(s, e)
    if (BYLINE_LINE.test(sent.trim()) || otherWords(sent, name) < 3) continue
    const t = (title || '').split(/[\s,]+/).filter(w => w.length > 3)
    const hasOrg = sent.toLowerCase().includes(org.toLowerCase())
    const hasRole = ROLE_WORDS.test(sent) || t.some(w => sent.toLowerCase().includes(w.toLowerCase()))
    if (strict ? hasOrg && hasRole : hasOrg || hasRole) return { start: s, end: e }
  }
  return null
}

/**
 * People stay only when the text ties them to their org: named in a fact quote, or in a sentence with their org or
 * role. The byline author needs a sentence naming them with their org and role ("Jane Doe, a partner at Northwind") —
 * or the document is that org's own blog — so a reporter never becomes a company's founder or employee.
 */
export function groundPeople(v: V, ctx: DocCtx): void {
  const authors = bylineNames(ctx.byline)
  const pub = new Set([...ctx.publisherNames, ctx.publisherFirm].map(normalizeName).filter(Boolean))
  v.people = v.people.filter(pp => {
    if (authors.has(normalizeName(pp.name))) return !!personSupport(ctx.text, pp.name, pp.org, pp.title, true) || (ctx.ownSite && pub.has(normalizeName(pp.org)))
    const inQuote = v.evidence.some(e => e.quote.toLowerCase().includes(pp.name.toLowerCase()) && !junkQuote(e.quote))
    return inQuote || !!personSupport(ctx.text, pp.name, pp.org, pp.title)
  })
}

/** The byline author(s): "A and B", "A, B". */
export function bylineNames(byline: string | null): Set<string> {
  return new Set((byline || '').split(/\s*(?:,|&|\band\b)\s*/i).map(s => normalizeName(s)).filter(Boolean))
}

export const FOUNDER_WORDS = /\bfound(?:er|ers|ed|ing)\b|\bco-?found/i

/** Junk evidence: a quote that is a URL, a byline/credit line, or a bare name. */
export function junkQuote(quote: string): boolean {
  const noUrl = quote.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ').replace(/\b[\w-]+\.(?:com|io|ai|co|net|org)\b\S*/gi, ' ')
  const words = noUrl.split(/\s+/).filter(w => /\p{L}/u.test(w))
  return words.length < 3 || BYLINE_LINE.test(quote.trim())
}

// ---------------------------------------------------------------- enum values vs their quote
const STAGE_WORDS: Record<string, RegExp> = {
  'Pre-seed': /\bpre[- ]?seed\b/i,
  Seed: /\bseed\b/i,
  'Late stage': /\blate[- ]stage\b|\bgrowth[- ](?:stage|round|equity|financing)\b|\bpre-ipo\b/i,
  Acquired: /\bacquir(?:e|ed|es|ing|ition)\b|\bbought\b|\bbuys?\b|\bpurchas(?:e|ed|es)\b|\bmerg(?:e|ed|er|es)\b|\btake-?over\b|\btaken over\b/i,
  Public: /\bipo\b|\binitial public offering\b|\b(?:went|go(?:es|ing)?|taken?) public\b|\bpublicly (?:traded|listed)\b|\blisted on\b|\b(?:nasdaq|nyse|stock exchange|ticker)\b|\b(?:market|trading|stock market) debut\b|\bspac\b|\bdirect listing\b|\binitial trading\b|\bshares (?:rose|fell|jumped|slid|traded)\b/i
}
const seriesRe = (letter: string) => new RegExp(`\\bseries[- ]${letter}\\b`, 'i')

/** Is the stage value stated by its quote? (the stage words or a clear synonym must appear) */
export function stageSupported(value: string, quote: string): boolean {
  const m = value.match(/^series\s+([a-h])\b/i)
  if (m) return seriesRe(m[1]).test(quote)
  const re = STAGE_WORDS[value]
  if (!re) return value.toLowerCase() === 'unknown' ? false : quote.toLowerCase().includes(value.toLowerCase())
  return re.test(value === 'Seed' ? quote.replace(/\bpre[- ]?seed\b/gi, ' ') : quote)
}

/** A funding round name ("Series A", "seed", "Series B extension") is stated by its quote. */
export function roundSupported(round: string, quote: string): boolean {
  const r = round.trim()
  const series = r.match(/series\s+([a-h])\b/i)
  if (series) return seriesRe(series[1]).test(quote)
  if (/pre[- ]?seed/i.test(r)) return STAGE_WORDS['Pre-seed'].test(quote)
  if (/\bseed\b/i.test(r)) return stageSupported('Seed', quote)
  const words = r.toLowerCase().split(/\s+/).filter(w => w.length > 2 && w !== 'round')
  return words.length > 0 && words.every(w => quote.toLowerCase().includes(w))
}
