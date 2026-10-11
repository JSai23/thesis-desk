// ViewDefinition contract (RFC §1B.15). Shared by the views module (main) and CUSTOMIZE_VIEW validation.
import { z } from 'zod'
import { FeedViewSpec } from '../ipc'

export const EVIDENCE_KINDS = ['funding', 'investment', 'fund_raise', 'product_launch', 'partnership', 'customer_adoption',
  'pricing', 'executive_change', 'acquisition', 'expansion', 'metric', 'opinion', 'other'] as const
export const RELS = ['mentions', 'about', 'invested_in', 'works_at', 'partner_at', 'founded', 'relates_to', 'covers'] as const
export const COMPONENTS = ['activity_timeline', 'evidence_list', 'evidence_columns', 'current_view', 'thoughts', 'questions', 'thesis_children',
  'recent_changes', 'notes', 'linked_objects', 'related_companies', 'funding_table', 'investors', 'people', 'latest_round', 'investments',
  'writing', 'commentary', 'portfolio', 'field_table', 'summary'] as const
export type Component = typeof COMPONENTS[number]

export const FieldKey = z.string().regex(/^[a-z][a-z0-9_]{1,30}$/)
const kinds = z.array(z.enum(EVIDENCE_KINDS)).optional()
const limit = z.number().int().min(1).max(50).optional()
const empty = z.object({}).strict()

/** Params schema per component (frozen catalog). */
export const COMPONENT_PARAMS: Record<Component, z.ZodTypeAny> = {
  activity_timeline: z.object({ kinds, limit, compact: z.boolean().optional() }).strict(),
  evidence_list: z.object({ stance: z.enum(['support', 'contra', 'any']).optional(), kinds, keptOnly: z.boolean().optional(), limit }).strict(),
  evidence_columns: z.object({ order: z.enum(['support_first', 'contra_first']) }).strict(),
  current_view: empty, thoughts: empty, questions: empty, thesis_children: empty, recent_changes: empty, notes: empty,
  linked_objects: z.object({ targetType: z.enum(['company', 'firm', 'thesis', 'person']), relation: z.enum(RELS).optional(), limit }).strict(),
  related_companies: z.object({ via: z.literal('shared_theses') }).strict(),
  funding_table: empty, investors: empty, latest_round: empty,
  people: z.object({ roles: z.array(z.string().min(1)).optional() }).strict(),
  investments: empty, writing: empty, commentary: empty, portfolio: empty,
  field_table: z.object({ fields: z.array(FieldKey).min(1) }).strict(),
  summary: empty
}

export const Section = z.object({
  id: z.string().min(1).max(64),
  component: z.enum(COMPONENTS),
  title: z.string().min(1).max(80).optional(),
  params: z.record(z.string(), z.any()).optional()
}).strict().superRefine((s, ctx) => {
  const r = COMPONENT_PARAMS[s.component].safeParse(s.params ?? {})
  if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: 'custom', path: ['params', ...i.path.map(p => p as string | number)], message: i.message })
})
export type Section = z.infer<typeof Section>

const uniqueIds = (secs: Section[]) => new Set(secs.map(s => s.id)).size === secs.length

export const PageViewDefinition = z.object({
  version: z.literal(1),
  objectType: z.enum(['company', 'firm', 'thesis']),
  headerFields: z.array(FieldKey).max(12),
  main: z.array(Section).max(20),
  rail: z.array(Section).max(20)
}).strict().refine(d => uniqueIds([...d.main, ...d.rail]), { message: 'Section ids must be unique' })
export type PageViewDefinition = z.infer<typeof PageViewDefinition>

/** Feed spec stored in a definition: every field optional and no defaults (segment is a UI toggle). */
export const FeedSpecPartial = FeedViewSpec.extend({ segment: z.enum(['today', 'all', 'unread', 'saved', 'review']).optional() }).partial()

export const FeedViewDefinition = z.object({
  version: z.literal(1),
  objectType: z.literal('feed'),
  spec: FeedSpecPartial
}).strict()
export type FeedViewDefinition = z.infer<typeof FeedViewDefinition>

export const ViewDefinition = z.union([PageViewDefinition, FeedViewDefinition])
export type ViewDefinition = z.infer<typeof ViewDefinition>
