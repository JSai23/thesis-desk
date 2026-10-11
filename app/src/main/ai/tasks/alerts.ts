// RECEIVE task contracts (RFC §1B.12.3): CREATE_ALERT (compile NL → AlertRule) and EVALUATE_ALERT (semantic condition).
import { z } from 'zod'
import { doc, UNTRUSTED, type TaskDef } from '../runtime'
import { EVIDENCE_KINDS } from './document'
import { STAGE_ENUM } from '../../../shared/schemas/report-def'

export const ModelAlert = z.object({
  name: z.string(),
  filters: z.object({
    kinds: z.array(z.enum(EVIDENCE_KINDS)).nullable(), companies: z.array(z.string()).nullable(), firms: z.array(z.string()).nullable(), people: z.array(z.string()).nullable(),
    scope: z.enum(['followed_companies', 'pinned_theses', 'watched_theses']).nullable(),
    investorFirms: z.array(z.string()).nullable(), investorRole: z.enum(['lead', 'any']).nullable(),
    theses: z.array(z.string()).nullable(), stance: z.enum(['support', 'contra', 'any']).nullable(), minLinkConfidence: z.number().nullable(),
    stages: z.array(z.enum(STAGE_ENUM)).nullable(), novelOnly: z.boolean()
  }),
  semanticCondition: z.string().nullable(),
  clarification: z.string().nullable()
})
export type ModelAlert = z.infer<typeof ModelAlert>

type Named = { id: string; name: string }
export interface CreateAlertIn { text: string; anchor: { type: string; id: string; name: string } | null; companies: Named[]; firms: Named[]; people: Named[]; theses: { id: string; title: string }[]; validate: (a: ModelAlert) => string[] }
export const CREATE_ALERT: TaskDef<CreateAlertIn, ModelAlert> = {
  name: 'CREATE_ALERT', promptVersion: 'create-alert-3', schema: ModelAlert,
  system: `Compile a venture investor's alert request into structured filters over new evidence (facts extracted from articles). Use only ids from the lists given. Leave a filter null when the request doesn't constrain it.
- kinds: funding (a company raised), investment (a firm invested/led), fund_raise, product_launch, partnership, customer_adoption, pricing, executive_change, acquisition, expansion, metric, opinion, other. "raises a round"/"leads a round" → [funding, investment].
- companies / firms / people: the evidence must be about one of these (ids).
- investorFirms + investorRole: when the request is about a firm investing ("Northwind leads a round" → investorFirms [Northwind id], investorRole lead, firms null; "backs"/"invests in" → role any).
- scope: followed_companies ("a company I follow"), pinned_theses, watched_theses.
- theses + stance: evidence linked to these theses (support/contra/any); "challenges/contradicts/against" → contra.
- stages: only for round-stage constraints.
- novelOnly: true unless the user wants restatements too.
- semanticCondition: only for qualitative conditions the filters can't express (e.g. "meaningful", "from a credible source"); otherwise null.
- name: short (≤ 60 chars) e.g. "Northwind leads a round".
- clarification: null normally. Set it (one or two plain sentences to the user: what you can't do and what they could ask instead) and leave the filters null when the alert can't be compiled faithfully: the request is unintelligible; it names a company, firm or person not in the lists (say there is no coverage of them yet — following them or adding a source that covers them fixes it; never drop the name and alert on everything); it asks for a channel other than in-app notifications and email (no SMS/text, phone, Slack); or it names no event type, entity, thesis or quality at all ("anything", "interesting stuff"). An event type alone ("a startup raises a round", "a company gets acquired") is a valid alert, not a vague one.
- Names in the request may be abbreviations or nicknames of listed entities (a16z = Andreessen Horowitz, YC = Y Combinator): map them to the listed id before deciding there is no coverage. Generic words like "startup" or "company" are not a semantic condition.`,
  user: i => `${i.anchor ? `Asked from the ${i.anchor.type} page of ${i.anchor.name} (id=${i.anchor.id}).\n` : ''}Companies: ${i.companies.map(c => `${c.name} (id=${c.id})`).join('; ') || '(none)'}\nFirms: ${i.firms.map(c => `${c.name} (id=${c.id})`).join('; ') || '(none)'}\nPeople: ${i.people.map(c => `${c.name} (id=${c.id})`).join('; ') || '(none)'}\nTheses: ${i.theses.map(t => `${t.title} (id=${t.id})`).join('; ') || '(none)'}\n\nRequest: ${i.text}`,
  validate: (o, i) => i.validate(o)
}

export interface EvalIn { request: string; condition: string; claim: string; quote: string; source: string; theses: string[] }
export const EvalOut = z.object({ matches: z.boolean(), reason: z.string() })
export const EVALUATE_ALERT: TaskDef<EvalIn, z.infer<typeof EvalOut>> = {
  name: 'EVALUATE_ALERT', promptVersion: 'evaluate-alert-3', schema: EvalOut,
  system: `Decide whether one piece of evidence satisfies an investor's alert condition. Judge the condition in the context of the full request; structured filters (entities, thesis, stance) already matched. Match when the evidence clearly satisfies the qualitative condition. Words like "meaningful", "significant" or "important" ask for substantive evidence — a concrete figure, event, decision or finding that bears on the request — not a passing mention or opinion without substance; they do not require one piece of evidence to settle the question on its own. reason: one short sentence. ${UNTRUSTED}`,
  user: i => `The investor's alert request: ${i.request}\nCondition to check (already-matched filters: the evidence is about the right entities/theses/stance): ${i.condition}\n${i.theses.length ? `Linked theses: ${i.theses.join('; ')}\n` : ''}Evidence: ${doc(`${i.claim}\n“${i.quote}” (${i.source})`)}`,
  validate: () => []
}
