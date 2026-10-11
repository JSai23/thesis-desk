// RECEIVE task contracts (RFC §1B.12.3): CREATE_REPORT, REFINE_REPORT, COMPOSE_REPORT_SECTION, COMPOSE_STORY (DEC-093).
import { z } from 'zod'
import { doc, UNTRUSTED, type TaskDef } from '../runtime'
import { EVIDENCE_KINDS } from './document'
import { STAGE_ENUM, REPORT_STYLES } from '../../../shared/schemas/report-def'

// The model-facing shape is fully required/nullable (strict mode); it is mapped to ReportDefinition afterwards.
const Q = z.object({
  source: z.enum(['feed_items', 'evidence', 'thesis_changes', 'firm_investments', 'people_activity', 'thesis_contra']),
  since: z.enum(['last_run', '24h', '7d', '30d']),
  theses: z.array(z.string()).nullable(), kinds: z.array(z.enum(EVIDENCE_KINDS)).nullable(), stages: z.array(z.enum(STAGE_ENUM)).nullable(),
  excludeStagesAbove: z.enum(STAGE_ENUM).nullable(), followedOnly: z.boolean().nullable(), firms: z.array(z.string()).nullable(), companies: z.array(z.string()).nullable(),
  minImportance: z.number().nullable(), novelOnly: z.boolean().nullable(), sort: z.enum(['importance', 'newest'])
})
export const ModelReport = z.object({
  name: z.string(),
  style: z.enum(REPORT_STYLES),
  schedule: z.object({ kind: z.enum(['none', 'daily', 'weekdays', 'weekly']), at: z.string().nullable(), weekday: z.number().int().nullable() }),
  email: z.boolean(),
  sections: z.array(z.object({ id: z.string(), title: z.string(), query: Q, limit: z.number().int(), presentation: z.enum(['list', 'summary']), style: z.enum(REPORT_STYLES).nullable() }))
})
export type ModelReport = z.infer<typeof ModelReport>

export const DSL = `Report definition:
- name: short title. schedule: {kind: none|daily|weekdays|weekly, at: "HH:MM" 24h local or null, weekday: 0=Sun…6=Sat for weekly else null}. "Every weekday at 7:30" → weekdays "07:30"; "every Monday morning" → weekly, weekday 1, "08:00"; no timing → none. email: true only if the user asks for email.
- style (how the report looks): story (default — a short narrative lede, a paragraph per section, a hero card with the lead article's picture, cards with thumbnails and charts) | digest (compact cards only, no narrative: "short digest", "just the headlines", "no commentary") | table (one row per item, deals as Company | Round | Amount | Lead investors | Source: "as a table", "in a table", "spreadsheet-style"). When the request names a layout, use it.
- sections (1–8, each with a different query — two sections with the same query show the same rows twice): {id: short slug, title, limit 1–20, presentation: list|summary, style: null (inherit) or story|digest|table for this section only ("…and the deals as a table"), query}. "shorter" → lower limits (and digest only if they ask for less text).
- query: {source, since, sort: importance|newest, theses: thesis ids|null, kinds: evidence kinds|null, stages|null, excludeStagesAbove|null, followedOnly|null, firms: firm ids|null, companies: company ids|null, minImportance 0–1|null, novelOnly|null}
  sources: feed_items (top items in Today), evidence (facts; e.g. new deals = kinds [funding, investment] with stages), thesis_changes (evidence newly linked to theses), firm_investments, people_activity (executive changes), thesis_contra (evidence that challenges theses).
  since: last_run | 24h | 7d | 30d (daily reports use 24h, weekly 7d).
  "seed deals" → evidence kinds [funding, investment] stages [Pre-seed, Seed]; "evidence against <thesis>" → thesis_contra with that thesis id; "in my theses" → theses = all listed thesis ids.
Evidence kinds: ${EVIDENCE_KINDS.join(', ')}. Stages: ${STAGE_ENUM.join(', ')}.`

export interface CreateIn { text: string; now: string; theses: { id: string; title: string }[]; firms: { id: string; name: string }[]; companies: { id: string; name: string }[]; templates: string; validate: (r: ModelReport) => string[] }
export const CreateOut = z.object({ route: z.enum(['report', 'alert', 'clarify']), report: ModelReport.nullable(), alertText: z.string().nullable(), clarification: z.string().nullable() })
export const CLARIFY_RULES = `Return route "clarify" with clarification = one or two plain sentences to the user (what you can't do and what they could ask instead) — never a definition that only looks like an answer — when:
- the request is not understandable as a request for information (gibberish, a single unrelated word);
- it names a specific company, firm or person that is not in the lists below (say the library has no coverage of them yet and that following them or adding a source that covers them fixes it). Never drop such a name and build a generic report under its title;
- it asks for delivery the app doesn't have: only in-app and email exist (no SMS/text, phone, Slack, WhatsApp).
- it restricts to a topic, sector or geography that none of the listed theses covers and the filters can't express (e.g. "quantum computing startups" with no such thesis): say the app can only narrow by theses, entities, event types and stages, and suggest creating a thesis for it. Never build a report under that topic's title whose rows ignore it.
Names in the request may be abbreviations or nicknames of listed entities (a16z = Andreessen Horowitz): map them before deciding there is no coverage. A thesis matches when the request names its subject in other words ("AI infra" → "AI infrastructure").
A request that is merely ambiguous about timing or scope is not a reason to clarify: pick the most likely reading.`
export const CREATE_REPORT: TaskDef<CreateIn, z.infer<typeof CreateOut>> = {
  name: 'CREATE_REPORT', promptVersion: 'create-report-5', schema: CreateOut,
  system: `Turn a venture investor's request into a report definition for their research app, or route it to an alert. If the request asks to be told/notified/alerted when or if something happens (a trigger, not a periodic digest), return route "alert" with alertText = the request; a recurring digest ("every morning send me…") is a report, not an alert. Otherwise route "report" with the definition.\n${CLARIFY_RULES}\n${DSL}`,
  user: i => `Now: ${i.now}\nTheses: ${i.theses.map(t => `${t.title} (id=${t.id})`).join('; ') || '(none)'}\nFirms: ${i.firms.map(f => `${f.name} (id=${f.id})`).join('; ') || '(none)'}\nCompanies: ${i.companies.map(c => `${c.name} (id=${c.id})`).join('; ') || '(none)'}\nTemplates for reference:\n${i.templates}\n\nRequest: ${i.text}`,
  validate: (o, i) => o.route === 'clarify' ? (o.clarification?.trim() ? [] : ['clarification is required for route clarify'])
    : o.route === 'alert' ? (o.alertText ? [] : ['alertText is required for route alert']) : o.report ? i.validate(o.report) : ['report is required for route report']
}

export interface RefineIn { text: string; current: unknown; theses: { id: string; title: string }[]; firms: { id: string; name: string }[]; validate: (r: ModelReport) => string[] }
export const RefineOut = z.object({ report: ModelReport, summary: z.string() })
export const REFINE_REPORT: TaskDef<RefineIn, z.infer<typeof RefineOut>> = {
  name: 'REFINE_REPORT', promptVersion: 'refine-report-2', schema: RefineOut,
  system: `Apply a venture investor's change request to their report definition. Return the complete updated definition (keep everything they did not ask to change, including section ids) and a short summary of what changed (e.g. "Weekly on Mondays · removed Seed deals", "Shown as a table"). Layout requests change style: "make it a table" → table; "add visuals"/"tell it as a story"/"more visual" → story; "just a list"/"digest" → digest; "shorter" → lower limits.\n${DSL}`,
  user: i => `Theses: ${i.theses.map(t => `${t.title} (id=${t.id})`).join('; ') || '(none)'}\nFirms: ${i.firms.map(f => `${f.name} (id=${f.id})`).join('; ') || '(none)'}\nCurrent definition:\n${JSON.stringify(i.current, null, 1)}\n\nChange request: ${i.text}`,
  validate: (o, i) => i.validate(o.report)
}

export interface ComposeIn { title: string; rows: { n: number; text: string; quote: string; source: string }[] }
export const ComposeOut = z.object({ bullets: z.array(z.object({ text: z.string(), citations: z.array(z.number().int()) })).max(5) })
export const COMPOSE: TaskDef<ComposeIn, z.infer<typeof ComposeOut>> = {
  name: 'COMPOSE_REPORT_SECTION', promptVersion: 'compose-1', schema: ComposeOut,
  system: `Summarize one report section in up to 5 bullets for a venture investor. Each bullet cites the numbered rows it uses and uses only names and numbers from those rows' quotes. ${UNTRUSTED}`,
  user: i => `Section: ${i.title}\n${doc(i.rows.map(r => `[${r.n}] ${r.text} — “${r.quote}” (${r.source})`).join('\n'))}`,
  validate: (o, i) => o.bullets.flatMap((b, k) => [...(!b.citations.length ? [`bullet ${k + 1} needs citations`] : []), ...b.citations.filter(n => !i.rows.some(r => r.n === n)).map(n => `bullet ${k + 1}: unknown row ${n}`)])
}

// ---------------------------------------------------------------- COMPOSE_STORY (DEC-093)
// One call per story run: a 4–7 sentence lede connecting the sections, a 2–5 sentence paragraph per section, and a deep
// dive on each section's standout companies drawn from their other stored facts (Backlog "Reports go deeper": ~50% more
// written analysis). Every sentence cites the numbered rows it uses; the caller drops sentences that fail grounding.
const Sentence = z.object({ text: z.string(), citations: z.array(z.number().int()) })
export interface StoryIn { name: string; sections: { id: string; title: string; rows: { n: number; title: string; text: string; quote: string; source: string }[]; background: { subject: string; facts: { n: number; text: string; quote: string; source: string; date: string }[] }[] }[] }
// no item limits in the model-facing schema: one sentence too many failed the whole story twice (run #15); the caller keeps 5 / 3
export const StoryOut = z.object({ lede: z.array(Sentence), sections: z.array(z.object({ id: z.string(), sentences: z.array(Sentence) })), deepDives: z.array(z.object({ sectionId: z.string(), subject: z.string(), sentences: z.array(Sentence) })) })
export type StoryOut = z.infer<typeof StoryOut>
export const COMPOSE_STORY: TaskDef<StoryIn, StoryOut> = {
  name: 'COMPOSE_STORY', promptVersion: 'compose-story-7', schema: StoryOut,
  system: `You write the narrative of a venture investor's report from its numbered rows only. Return:
- lede: 5 to 7 sentences that tell the one story connecting the sections (what happened, who, how much, what it means for the reader's theses as the rows state it). Lead with the most significant fact.
- sections: for every section that has rows, 3 to 5 sentences (1 is enough for a section with a single row) on that section's rows: the pattern across them, how the items compare (sizes, stages, investors, timing as the rows state them), and the standout item. Use the section id given; a section's sentences cite only that section's rows.
- deepDives: for each "Background" block given under a section, one deep dive on that subject: 3 to 4 sentences putting the section's item about it in context with its background facts (earlier rounds, investors, people, customers, earlier news — as stated); add what the section's rows don't already say, never restate the headline, and call a fact "earlier", "previously" or "before" only when its date shows it. sectionId = that section's id exactly as given in id="…" (not its title), subject = the subject's name as given; cite that section's rows and that subject's background facts only.
Every sentence: one claim, short, with names, numbers and amounts copied exactly as written in the rows it cites (a sentence the rows don't fully support is dropped), cites the row numbers it relies on in citations (at least one), and uses only names, numbers and amounts written in those rows' quotes or titles — no outside knowledge, no totals or counts you computed, no adjectives the rows don't support. Section sentences add what the lede doesn't say (other rows, the pattern across them) — never repeat a lede sentence. Plain, precise English; no hype; never talk about "rows", "items", "this report" or "the data" — write about the companies and events. Never put citation markers like [1] inside the text, and never name a publication, newsletter, data provider or wire service in the text ("according to Dealroom") — the citations show where a fact comes from. ${UNTRUSTED}`,
  user: i => `Report: ${i.name}\n${doc(i.sections.map(s => `## Section id="${s.id}" — ${s.title}\n${s.rows.map(r => `[${r.n}] ${r.title} — ${r.text} — “${r.quote}” (${r.source})`).join('\n') || '(no rows)'}${s.background.map(b => `\n### Background: ${b.subject}\n${b.facts.map(f => `[${f.n}] ${f.text} — “${f.quote}” (${f.source}${f.date ? ', ' + f.date : ''})`).join('\n')}`).join('')}`).join('\n\n'))}`,
  validate: (o, i) => {
    const ns = new Set(i.sections.flatMap(s => s.rows.map(r => r.n)))
    const bgAll = new Set(i.sections.flatMap(s => s.background.flatMap(b => b.facts.map(f => f.n))))
    const withRows = i.sections.filter(s => s.rows.length)
    const p: string[] = []
    // a lede or section sentence citing a background fact (1001+) is not a broken answer: the caller drops just that
    // sentence (its citations must be the section's rows) — rejecting the whole story for it left reports with no
    // lede at all (RD-STORY-01, acc-2026-10-07T11-52-00)
    const check = (where: string, ss: { text: string; citations: number[] }[]) => ss.forEach((s, k) => {
      if (!s.citations.length) p.push(`${where} sentence ${k + 1} needs citations`)
      for (const n of s.citations) if (!ns.has(n) && !bgAll.has(n)) p.push(`${where} sentence ${k + 1}: unknown row ${n}`)
    })
    const bg = new Map(i.sections.map(s => [s.id, new Set(s.background.flatMap(b => b.facts.map(f => f.n)))] as const))
    // the model sometimes names a section by its title: accept that, the caller maps it back (sectionOf)
    const byIdOrTitle = (x: string) => i.sections.find(s => s.id === x || s.title.toLowerCase() === x.trim().toLowerCase())
    if (ns.size >= 3 && o.lede.length < 4) p.push('the lede needs 4 to 7 sentences')
    for (const d of o.deepDives) {
      const sec = byIdOrTitle(d.sectionId)
      if (!sec) { p.push(`deep dive: unknown section id ${d.sectionId}`); continue }
      for (const c of d.sentences.flatMap(x => x.citations)) if (!sec.rows.some(r => r.n === c) && !bg.get(sec.id)!.has(c)) p.push(`deep dive on ${d.subject} cites ${c}, which is not in its section or background`)
    }
    check('lede', o.lede)
    for (const s of o.sections) {
      const sec = byIdOrTitle(s.id)
      if (!sec) { p.push(`unknown section id ${s.id}`); continue }
      check(`section ${s.id}`, s.sentences)
      for (const c of s.sentences.flatMap(x => x.citations)) if (!sec.rows.some(r => r.n === c)) p.push(`section ${s.id} cites row ${c}, which belongs to another section`)
    }
    for (const s of withRows) {
      const got = o.sections.find(x => byIdOrTitle(x.id)?.id === s.id)?.sentences.length || 0
      if (got < (s.rows.length >= 2 ? 2 : 1)) p.push(`section id "${s.id}" needs ${s.rows.length >= 2 ? '2 to 5' : 'at least 1'} sentences`)
    }
    return p
  }
}

/** A story section named by its id or (as the model sometimes does) its title. */
export const sectionOf = <S extends { id: string; title: string }>(sections: S[], x: string): S | undefined => sections.find(s => s.id === x || s.title.toLowerCase() === x.trim().toLowerCase())
