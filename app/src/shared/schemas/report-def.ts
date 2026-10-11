// ReportDefinition (RFC §1B.17). Shared by the reports module and CREATE_REPORT / REFINE_REPORT validation.
import { z } from 'zod'
import { EVIDENCE_KINDS } from './view-def'

export const STAGE_ENUM = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Series E', 'Series F', 'Series G', 'Series H', 'Late stage', 'Acquired', 'Public', 'Unknown'] as const

export const SectionQuery = z.object({
  source: z.enum(['feed_items', 'evidence', 'thesis_changes', 'firm_investments', 'people_activity', 'thesis_contra']),
  since: z.enum(['last_run', '24h', '7d', '30d']),
  theses: z.array(z.string()).optional(),
  kinds: z.array(z.enum(EVIDENCE_KINDS)).optional(),
  stages: z.array(z.enum(STAGE_ENUM)).optional(),
  excludeStagesAbove: z.enum(STAGE_ENUM).optional(),
  followedOnly: z.boolean().optional(),
  firms: z.array(z.string()).optional(),
  companies: z.array(z.string()).optional(),
  minImportance: z.number().min(0).max(1).optional(),
  novelOnly: z.boolean().optional(),
  sort: z.enum(['importance', 'newest'])
}).strict()
export type SectionQuery = z.infer<typeof SectionQuery>

/** Layout of a run (See DEC-093): story = lede + per-section narrative, hero card, card grid, charts; digest = cards only;
 * table = one table row per item (deal table for funding sections). A definition without `style` renders as digest. */
export const REPORT_STYLES = ['story', 'digest', 'table'] as const
export type ReportStyle = typeof REPORT_STYLES[number]

export const ReportSection = z.object({ id: z.string().min(1).max(40), title: z.string().min(1).max(80), query: SectionQuery, limit: z.number().int().min(1).max(20), presentation: z.enum(['list', 'summary']),
  /** overrides the report's style for this section */
  style: z.enum(REPORT_STYLES).optional() }).strict()

export const ReportDefinition = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(80),
  style: z.enum(REPORT_STYLES).optional(),
  schedule: z.object({ kind: z.enum(['none', 'daily', 'weekdays', 'weekly']), at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), weekday: z.number().int().min(0).max(6).optional() }).strict(),
  delivery: z.object({ inApp: z.literal(true), email: z.boolean() }).strict(),
  sections: z.array(ReportSection).min(1).max(8)
}).strict().refine(d => new Set(d.sections.map(s => s.id)).size === d.sections.length, { message: 'section ids must be unique' })
  .refine(d => d.schedule.kind === 'none' || !!d.schedule.at, { message: 'scheduled reports need a time (at)' })
  .refine(d => d.schedule.kind !== 'weekly' || d.schedule.weekday !== undefined, { message: 'weekly reports need a weekday' })
export type ReportDefinition = z.infer<typeof ReportDefinition>
