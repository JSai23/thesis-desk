// THINK/CORRECT task contracts (RFC §1B.12.3): ORGANIZE_NOTE, SUGGEST_THESES, CORRECT_OBJECT, SUMMARIZE_OBJECT.
import { z } from 'zod'
import { doc, UNTRUSTED, type TaskDef } from '../runtime'

// ---------------------------------------------------------------- ORGANIZE_NOTE
export interface OrganizeIn { text: string; context: string; theses: { id: string; title: string; description: string }[]; companies: { id: string; name: string }[]; firms: { id: string; name: string }[] }
export const OrganizeOut = z.object({
  thesisId: z.string().nullable(), kind: z.enum(['observation', 'question', 'counterpoint', 'correction']),
  companyIds: z.array(z.string()), firmIds: z.array(z.string()), newThesis: z.object({ title: z.string(), description: z.string() }).nullable()
})
export type OrganizeValue = z.infer<typeof OrganizeOut>
export const ORGANIZE: TaskDef<OrganizeIn, OrganizeValue> = {
  name: 'ORGANIZE_NOTE', promptVersion: 'organize-1', schema: OrganizeOut,
  system: `You file a venture investor's own thought. Choose the one thesis it belongs to (thesisId from the list, or null if none fits), its kind (observation; question if it asks something; counterpoint if it doubts or challenges a thesis or prevailing view; correction if it corrects a fact), the companies and firms it mentions (ids from the lists only), and newThesis only when the thought clearly states a new investable hypothesis that no listed thesis covers. Never rewrite the thought.`,
  user: i => `Thought: ${i.text}\nContext: ${i.context || '(none)'}\nTheses:\n${i.theses.map(t => `- id=${t.id} · ${t.title}${t.description ? ' — ' + t.description : ''}`).join('\n') || '(none)'}\nCompanies: ${i.companies.map(c => `${c.name} (id=${c.id})`).join(', ') || '(none)'}\nFirms: ${i.firms.map(f => `${f.name} (id=${f.id})`).join(', ') || '(none)'}`,
  validate: (o, i) => {
    const p: string[] = []
    if (o.thesisId && !i.theses.some(t => t.id === o.thesisId)) p.push('thesisId must be one of the listed ids or null')
    for (const c of o.companyIds) if (!i.companies.some(x => x.id === c)) p.push(`unknown company id ${c}`)
    for (const f of o.firmIds) if (!i.firms.some(x => x.id === f)) p.push(`unknown firm id ${f}`)
    return p
  }
}

// ---------------------------------------------------------------- SUGGEST_THESES
export interface SuggestIn { notes: { id: string; text: string }[]; theses: { id: string; title: string }[] }
export const SuggestOut = z.object({ suggestions: z.array(z.object({ title: z.string(), description: z.string(), noteIds: z.array(z.string()), parentThesisId: z.string().nullable() })).max(3) })
export const SUGGEST_THESES: TaskDef<SuggestIn, z.infer<typeof SuggestOut>> = {
  name: 'SUGGEST_THESES', promptVersion: 'suggest-theses-1', schema: SuggestOut,
  system: 'Group a venture investor\'s unfiled thoughts into at most 3 new thesis suggestions that none of their current theses cover. Each suggestion: a short title, a one-sentence description in their voice, the ids of the thoughts it groups (≥2 when possible), and optionally a parent thesis id. Return [] when nothing new emerges.',
  user: i => `Current theses:\n${i.theses.map(t => `- id=${t.id} · ${t.title}`).join('\n') || '(none)'}\nUnfiled thoughts:\n${i.notes.map(n => `- id=${n.id} · ${n.text}`).join('\n')}`,
  validate: (o, i) => o.suggestions.flatMap(s => [...s.noteIds.filter(n => !i.notes.some(x => x.id === n)).map(n => `unknown note id ${n}`), ...(s.parentThesisId && !i.theses.some(t => t.id === s.parentThesisId) ? ['unknown parentThesisId'] : [])])
}

// ---------------------------------------------------------------- CORRECT_OBJECT
// The action list is the ontology-operation registry's chat entries (entities/ops, DEC-094): one prompt line per op.
// The output is a flat set of slots; the registry maps (action, slots) → {op, input}. `check` is that mapping plus
// "ids come from the lists", so a reply that doesn't fit is sent back to the model with the problem.
export interface CorrectIn { text: string; candidates: { type: string; id: string; name: string; deleted?: boolean }[]; fields: { objectType: string; key: string; label: string; valueType: string; enumValues: string[] | null }[]; theses: { id: string; title: string }[] }
export const CORRECT_PROMPT_VERSION = 'correct-7'
const slots = {
  objectType: z.enum(['company', 'firm', 'person', 'thesis']).nullable(), objectId: z.string().nullable(), key: z.string().nullable(), value: z.string().nullable(),
  fromId: z.string().nullable(), intoId: z.string().nullable(), parentId: z.string().nullable(), relatedType: z.enum(['company', 'firm', 'thesis']).nullable(), relatedId: z.string().nullable(),
  confirmText: z.string()
}
export interface CorrectValue { action: string; objectType: string | null; objectId: string | null; key: string | null; value: string | null; fromId: string | null; intoId: string | null; parentId: string | null; relatedType: string | null; relatedId: string | null; confirmText: string }
export function correctTask(actions: { action: string; line: string }[], check: (o: CorrectValue) => string[]): TaskDef<CorrectIn, CorrectValue> {
  const names = actions.map(a => a.action)
  return {
    name: 'CORRECT_OBJECT', promptVersion: CORRECT_PROMPT_VERSION,
    schema: z.object({ action: z.enum(['none', ...names] as [string, ...string[]]), ...slots }) as unknown as TaskDef<CorrectIn, CorrectValue>['schema'],
    system: `Turn an investor's natural-language correction of their research library into one typed action. Actions:
${actions.map(a => `- ${a.action}: ${a.line}`).join('\n')}
- none: when the text is not a clear correction.
Fill only the slots the action uses; others null. confirmText: a short question the user confirms, e.g. "Set Claimwise stage to Series A?". Use only ids from the lists; a candidate marked (deleted) is only for restore_entity.`,
    user: i => `Correction: ${i.text}\nCandidates:\n${i.candidates.map(c => `- ${c.type} id=${c.id} · ${c.name}${c.deleted ? ' (deleted)' : ''}`).join('\n') || '(none)'}\nTheses:\n${i.theses.map(t => `- id=${t.id} · ${t.title}`).join('\n') || '(none)'}\nField catalog (key — for which object type):\n${i.fields.map(f => `- ${f.key} — ${f.objectType} (${f.label}, ${f.valueType}${f.enumValues ? ': ' + f.enumValues.join(', ') : ''})`).join('\n')}`,
    validate: (o, i) => {
      if (o.action === 'none') return []
      const ids = new Set([...i.candidates.map(c => c.id), ...i.theses.map(t => t.id)])
      // models often put the listed NAME (or "id=…") where the id goes: map an exact name/title to its id before checking
      const byName = new Map<string, string>([...i.candidates.map(c => [c.name.toLowerCase(), c.id] as const), ...i.theses.map(t => [t.title.toLowerCase(), t.id] as const)])
      for (const k of ['objectId', 'fromId', 'intoId', 'parentId', 'relatedId'] as const) {
        const v = o[k]?.trim().replace(/^id=/, '')
        if (!v || ids.has(v)) { if (v) o[k] = v; continue }
        const lv = v.toLowerCase().replace(/^["“]|["”]$/g, '').replace(/\s+thesis$/, '')
        const loose = [...byName].filter(([n]) => lv.includes(n) || n.includes(lv))
        const hit = byName.get(lv) ?? (loose.length === 1 ? loose[0][1] : undefined) // "Developer tools thesis" → its id; ambiguous → no guess
        if (hit) o[k] = hit
      }
      const p: string[] = []
      for (const k of ['objectId', 'fromId', 'intoId', 'parentId', 'relatedId'] as const) if (o[k] && !ids.has(o[k]!)) p.push(`${k} must be one of the listed ids (copy the id=… value, not the name)`)
      if (o.key) o.key = o.key.replace(/^(company|firm|thesis|person)\./, '') // "company.stage" → "stage"
      if (o.action === 'set_field' && o.key && !i.fields.some(f => f.key === o.key && f.objectType === o.objectType)) p.push(`key must be one of the field catalog keys for ${o.objectType}: ${i.fields.filter(f => f.objectType === o.objectType).map(f => f.key).join(', ')}`)
      return p.length ? p : check(o)
    }
  }
}

// ---------------------------------------------------------------- SUMMARIZE_OBJECT
export interface SummarizeIn { name: string; facts: string[]; evidence: { n: number; claim: string; quote: string }[]; investorSays?: string }
export const SummarizeOut = z.object({ summary: z.string(), citations: z.array(z.number().int()), yours: z.array(z.string()) })
export const SUMMARIZE: TaskDef<SummarizeIn, z.infer<typeof SummarizeOut>> = {
  name: 'SUMMARIZE_OBJECT', promptVersion: 'summarize-2', schema: SummarizeOut,
  system: `Write a neutral summary (≤ 600 characters) of what the investor's library says about one company, firm or thesis. Use only the numbered evidence; cite the numbers you used. Use only names and numbers that appear in the cited quotes. The investor's own words (when given) steer what matters; a sentence that rests on them rather than on evidence is allowed only if you copy it, exactly as it appears in the summary, into "yours" — it is shown marked as the investor's words, never as a fact. Otherwise "yours" is []. ${UNTRUSTED}`,
  user: i => `Object: ${i.name}${i.investorSays ? `\nWhat the investor says it is (their words): ${i.investorSays}` : ''}\nKnown fields: ${i.facts.join('; ') || '(none)'}\nEvidence:\n${doc(i.evidence.map(e => `[${e.n}] ${e.claim} — “${e.quote}”`).join('\n'))}`,
  validate: (o, i) => [...(o.summary.length > 600 ? ['summary must be ≤ 600 characters'] : []), ...o.citations.filter(n => !i.evidence.some(e => e.n === n)).map(n => `unknown citation ${n}`),
    ...o.yours.filter(y => !o.summary.includes(y.trim())).map(y => `"yours" sentence not in the summary: ${y.slice(0, 40)}`), ...(o.yours.length && !i.investorSays ? ['"yours" must be [] when the investor said nothing'] : [])]
}
