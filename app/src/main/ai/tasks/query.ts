// QUERY task contracts (RFC §1B.12.3, §1B.16): PLAN_QUERY and ANSWER_QUERY (structured, never streamed).
import { z } from 'zod'
import { doc, UNTRUSTED, type TaskDef } from '../runtime'
import { EVIDENCE_KINDS } from './document'

export interface PlanIn { question: string; today: string; theses: string[]; followed: string[]; conversation: { q: string; a: string }[] }
export const PlanOut = z.object({
  intent: z.enum(['what_changed', 'lookup', 'compare', 'evidence_for_against', 'list', 'other']),
  entities: z.array(z.object({ type: z.enum(['company', 'firm', 'person']), name: z.string() })),
  thesisTitles: z.array(z.string()),
  since: z.string(),
  kinds: z.array(z.enum(EVIDENCE_KINDS)),
  stance: z.enum(['support', 'contra', 'any']),
  searchTerms: z.array(z.string()).max(12),
  includeNotes: z.boolean()
})
export type Plan = z.infer<typeof PlanOut>
export const PLAN: TaskDef<PlanIn, Plan> = {
  name: 'PLAN_QUERY', promptVersion: 'plan-1', schema: PlanOut,
  system: `Plan a search over a venture investor's private research library (documents, extracted evidence, notes) for their question. Do not answer it.
- entities: companies, firms or people named or clearly referred to (resolve "they"/"their" from the conversation).
- thesisTitles: the investor's theses the question is about (copy titles exactly from the list).
- since: "last_viewed" for "since I last looked", "7d" for this week, "30d" for this month/recently, "90d", "all", or an ISO date.
- kinds: evidence kinds to focus on ([] = any). stance: "contra" for evidence against/contradicting, "support" for evidence for, else "any".
- searchTerms: up to 12 short keywords/phrases (names, synonyms) for full-text search.
- includeNotes: true when the investor's own notes could help.`,
  user: i => `Today: ${i.today}\nTheses: ${i.theses.join('; ') || '(none)'}\nFollowed: ${i.followed.join(', ') || '(none)'}\n${i.conversation.length ? 'Conversation so far:\n' + i.conversation.map(c => `Q: ${c.q}\nA: ${c.a}`).join('\n') + '\n' : ''}Question: ${i.question}`
}

export interface AnswerIn { question: string; context: { n: number; kind: 'evidence' | 'note' | 'fact'; text: string; quote?: string; source?: string; date?: string }[]; conversation: { q: string; a: string }[]; extraInstruction?: string }
export const AnswerOut = z.object({
  answer: z.array(z.object({ type: z.enum(['fact', 'interpretation', 'user_note']), text: z.string(), citations: z.array(z.number().int()), quotes: z.array(z.string()) })),
  insufficient: z.boolean(),
  followups: z.array(z.string()).max(3)
})
export type Answer = z.infer<typeof AnswerOut>
export const ANSWER: TaskDef<AnswerIn, Answer> = {
  name: 'ANSWER_QUERY', promptVersion: 'answer-3', schema: AnswerOut,
  system: `Answer a venture investor's question using ONLY the numbered context from their library. Never use outside knowledge.
Return items:
- fact: one sentence stating something the cited evidence says. citations = the context numbers it relies on (≥1); quotes = exact verbatim excerpts copied from those items' quotes that support every name and number in the sentence (≥1). Attribute opinions ("X argues …"). Keep the quote's tense and timing: "now pays" is not "began paying"; never add when something happened (a date, "recently", "first", "started") unless the quote says it — the date after a source is when it was published, not when the event happened.
- interpretation: your analysis or synthesis (clearly not a fact); cite context where relevant; quotes may be [].
- user_note: what the investor's own notes (items marked USER NOTE) say; cite only those notes.
Cover every distinct relevant item in the context — each deal, launch, hire, fund, partnership, and each published view by the entity or its people (partners, founders, executives) — as its own fact; do not drop relevant items to keep the answer short, and merge only restatements of the same event.
If the context does not contain the answer, set insufficient = true, state no facts that are not supported, and you may list the closest related facts. Never invent numbers or names. followups: up to 3 short follow-up questions. ${UNTRUSTED}`,
  user: i => `${i.conversation.length ? 'Conversation so far:\n' + i.conversation.map(c => `Q: ${c.q}\nA: ${c.a}`).join('\n') + '\n\n' : ''}Question: ${i.question}\n\nContext:\n${doc(i.context.map(c => c.kind === 'note' ? `[${c.n}] USER NOTE: ${c.text}` : c.kind === 'fact' ? `[${c.n}] FIELD: ${c.text}${c.source ? ` (${c.source}${c.date ? ', ' + c.date : ''})` : ''}` : `[${c.n}] ${c.text}\n     quote: “${c.quote}” — ${c.source || 'source'}${c.date ? ', ' + c.date : ''}`).join('\n'))}${i.extraInstruction ? '\n\n' + i.extraInstruction : ''}`,
  validate: (o, i) => {
    const p: string[] = []
    const ns = new Set(i.context.map(c => c.n))
    const notes = new Set(i.context.filter(c => c.kind === 'note').map(c => c.n))
    o.answer.forEach((a, k) => {
      for (const c of a.citations) if (!ns.has(c)) p.push(`item ${k + 1}: citation [${c}] is not in the context`)
      if (a.type === 'fact' && (!a.citations.length || !a.quotes.length)) p.push(`item ${k + 1}: every fact needs ≥1 citation and ≥1 quote`)
      if (a.type === 'user_note' && a.citations.some(c => !notes.has(c))) p.push(`item ${k + 1}: user_note items may cite only USER NOTE items`)
    })
    return p
  },
  fabricate: o => {
    const i = o.answer.findIndex(a => a.type === 'fact')
    if (i < 0) return o
    const a = [...o.answer]
    a[i] = { ...a[i], text: a[i].text.replace(/\$?\d+(\.\d+)?(\s?(million|billion|m|bn|%))?/gi, '97') || a[i].text + ' 97' }
    if (a[i].text === o.answer[i].text) a[i] = { ...a[i], text: a[i].text + ' It raised $97 million.' }
    return { ...o, answer: a }
  }
}
