// AlertRule (RFC §1B.18). Shared by the alerts module and CREATE_ALERT validation.
import { z } from 'zod'
import { EVIDENCE_KINDS } from './view-def'
import { STAGE_ENUM } from './report-def'

export const AlertFilters = z.object({
  kinds: z.array(z.enum(EVIDENCE_KINDS)).optional(),
  companies: z.array(z.string()).optional(), firms: z.array(z.string()).optional(), people: z.array(z.string()).optional(),
  scope: z.enum(['followed_companies', 'pinned_theses', 'watched_theses']).nullable().optional(),
  investorFirms: z.array(z.string()).optional(), investorRole: z.enum(['lead', 'any']).optional(),
  theses: z.array(z.string()).optional(), stance: z.enum(['support', 'contra', 'any']).optional(), minLinkConfidence: z.number().min(0).max(1).optional(),
  stages: z.array(z.enum(STAGE_ENUM)).optional(),
  novelOnly: z.boolean()
}).strict()
export const AlertRule = z.object({
  version: z.literal(1),
  event: z.literal('evidence_created'),
  filters: AlertFilters,
  semanticCondition: z.string().min(1).max(400).optional()
}).strict()
export type AlertRule = z.infer<typeof AlertRule>
