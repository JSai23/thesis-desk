// SHAPE tasks (RFC §1B.12.3): CUSTOMIZE_VIEW (instruction → validated JSON patch over a ViewDefinition, optional new
// custom fields) and EXTRACT_FIELD (one custom field value for one object, with a verbatim quote).
import { z } from 'zod'
import { doc, UNTRUSTED, type TaskDef } from '../runtime'

export const PatchOp = z.object({ op: z.enum(['add', 'remove', 'replace', 'move']), path: z.string(), from: z.string().nullable(), valueJson: z.string().nullable() })
export const CustomizeOut = z.object({
  scope: z.enum(['object', 'type']),
  patch: z.array(PatchOp).max(20),
  createFields: z.array(z.object({ key: z.string(), label: z.string(), valueType: z.enum(['text', 'number', 'money', 'date', 'enum', 'url']), enumValues: z.array(z.string()).nullable(), extractionInstruction: z.string() })).max(3),
  summary: z.string()
})
export type CustomizeValue = z.infer<typeof CustomizeOut>
export interface CustomizeIn { instruction: string; objectType: string; objectName: string | null; current: unknown; catalog: string; fields: string; theses: string; validate: (v: CustomizeValue) => string[] }

export const CATALOG = `Components (section.component, with params):
- activity_timeline {kinds?: EvidenceKind[], limit?: ≤50, compact?: boolean} — dated activity rows (company/firm). kinds filter, e.g. ["pricing"] shows only pricing changes. Not for funding/rounds: "funding history" is funding_table.
- evidence_list {stance?: support|contra|any, kinds?, keptOnly?: boolean, limit?} — evidence cards.
- evidence_columns {order: support_first|contra_first} — thesis Supporting/Contradicting columns (thesis only).
- current_view, thoughts, questions, thesis_children, recent_changes — thesis sections (no params).
- notes — the user's notes (no params).
- linked_objects {targetType: company|firm|thesis|person, relation?, limit?} — related theses/companies/firms/people.
- related_companies {via: "shared_theses"} — competitors the user tracks (companies sharing theses).
- funding_table — the company's funding history: every round with date, amount and investors (no params). "funding history"/"rounds" → funding_table.
- latest_round — a single card with only the most recent round (no params).
- investors — the firms that invested in the company (no params).
- people {roles?: string[]} — founders/executives (company) or partners (firm).
- investments, writing, commentary, portfolio — firm sections (no params).
- field_table {fields: fieldKey[]} — a table of field values (built-in or custom fields).
- summary — cached AI summary (labelled AI).
EvidenceKind: funding, investment, fund_raise, product_launch, partnership, customer_adoption, pricing, executive_change, acquisition, expansion, metric, opinion, other.
Page definition shape: {version:1, objectType, headerFields: fieldKey[], main: Section[], rail: Section[]}; Section = {id, component, title?, params?}. Section ids must be unique.
Feed (Today) definition shape: {version:1, objectType:"feed", spec:{groupBy?: section|source|thesis|none, sort?: relevance|newest, sectionOrder?: (important|companies|theses|sources|firms)[], thesisOrder?: thesisId[], filters?: {stages?: string[], excludeKinds?: EvidenceKind[], onlyFollowed?: boolean, sourceIds?: string[]}}}.`

export const CUSTOMIZE: TaskDef<CustomizeIn, CustomizeValue> = {
  name: 'CUSTOMIZE_VIEW', promptVersion: 'customize-3', schema: CustomizeOut,
  system: `You change the layout of one page in a research app by returning a JSON Patch (RFC 6902) over its current view definition. Only the layout changes; data never changes. You cannot write code or change any database schema.
Rules:
- Use only components, params and field keys from the catalogs. To show a new tracked attribute that is not in the field catalog, add it to createFields (key matches ^[a-z][a-z0-9_]{1,30}$, ≤ 3 fields) and reference it (e.g. in headerFields or a field_table).
- scope "type" when the instruction says every/all pages of this kind (e.g. "on every company page", "on thesis pages"); otherwise "object" (only this page). Today (feed) always uses "type".
- Each op: {op, path, from, valueJson}: valueJson is the JSON-encoded value for add/replace (e.g. "\\"funding_table\\"" or "{\\"id\\":\\"funding\\",\\"component\\":\\"funding_table\\"}"), null for remove/move; from is used only by move.
- Paths address the current definition, e.g. /main/0, /main/-, /rail/2, /headerFields/1, /main/1/params/order, /spec/groupBy.
- "Hide X" removes the section or header field; "put X first" moves or inserts it at index 0 of main; "show X at the top" inserts at /main/0.
- summary: one short sentence describing the change.`,
  user: i => `Instruction: ${i.instruction}\nPage type: ${i.objectType}${i.objectName ? ` (this page: ${i.objectName})` : ''}\n\n${i.catalog}\n\nField catalog (${i.objectType}): ${i.fields}\n${i.theses ? `Theses (for thesisOrder): ${i.theses}\n` : ''}\nCurrent definition:\n${JSON.stringify(i.current, null, 1)}`,
  validate: (o, i) => i.validate(o)
}

export interface ExtractFieldIn { label: string; key: string; valueType: string; enumValues: string[] | null; instruction: string; objectName: string; excerpts: { documentId: string; text: string }[] }
export const ExtractFieldOut = z.object({ value: z.string().nullable(), evidenceQuote: z.string().nullable(), documentId: z.string().nullable() })
export const EXTRACT_FIELD: TaskDef<ExtractFieldIn, z.infer<typeof ExtractFieldOut>> = {
  name: 'EXTRACT_FIELD', promptVersion: 'extract-field-1', schema: ExtractFieldOut,
  system: `Find the value of one attribute for one company or firm in the excerpts. Return value (as written, normalized to the type: number → digits only), evidenceQuote = the exact sentence from one excerpt that states it, and that excerpt's documentId. Return all null when the excerpts do not state it. Never guess. ${UNTRUSTED}`,
  user: i => `Attribute: ${i.label} (${i.key}, ${i.valueType}${i.enumValues ? ': ' + i.enumValues.join(', ') : ''})\nHow to extract: ${i.instruction}\nObject: ${i.objectName}\n\n${i.excerpts.map(e => `documentId=${e.documentId}\n${doc(e.text)}`).join('\n\n')}`,
  validate: (o, i) => {
    if (!o.value) return []
    const ex = i.excerpts.find(e => e.documentId === o.documentId)
    if (!ex) return ['documentId must be one of the given excerpts']
    if (!o.evidenceQuote || !ex.text.replace(/\s+/g, ' ').includes(o.evidenceQuote.replace(/\s+/g, ' ').trim())) return ['evidenceQuote must be an exact sentence from that excerpt']
    return []
  }
}
