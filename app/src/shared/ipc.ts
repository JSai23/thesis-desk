// Frozen public interface (RFC §1B.3). Every command has a zod request schema; the renderer calls
// window.rw.invoke(name, payload) and receives { ok:true, data } | { ok:false, code, message }.
// Positional arguments in the RFC become named payload fields here.
import { z } from 'zod'

const id = z.string().min(1)
const ids = z.array(id)
const objType = z.enum(['company', 'firm', 'person', 'thesis'])
const pageType = z.enum(['company', 'firm', 'thesis'])
const briefingSchedule = z.object({ kind: z.enum(['none', 'daily', 'weekdays', 'weekly']), at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), weekday: z.number().int().min(0).max(6).optional() })
const viewObjType = z.enum(['company', 'firm', 'thesis', 'feed'])
const entityType = z.enum(['company', 'firm', 'person'])
const stance = z.enum(['support', 'contra', 'neutral'])
const freq = z.enum(['realtime', 'hourly', 'daily', 'weekly'])
const priority = z.enum(['low', 'normal', 'high'])
const mode = z.enum(['all', 'relevant', 'custom'])
const none = z.object({}).passthrough()

export const FeedViewSpec = z.object({
  segment: z.enum(['today', 'all', 'unread', 'saved', 'review']).default('today'),
  thesisFilter: z.string().nullish(),
  groupBy: z.enum(['section', 'source', 'thesis', 'none']).optional(),
  sort: z.enum(['relevance', 'newest']).optional(),
  filters: z.object({
    stages: z.array(z.string()).optional(),
    excludeKinds: z.array(z.string()).optional(),
    onlyFollowed: z.boolean().optional(),
    sourceIds: z.array(z.string()).optional()
  }).optional(),
  sectionOrder: z.array(z.enum(['important', 'companies', 'theses', 'sources', 'firms'])).optional(),
  thesisOrder: z.array(z.string()).optional()
})
export type FeedViewSpec = z.infer<typeof FeedViewSpec>

export const SourceDraft = z.object({
  locator: z.string().min(1),
  name: z.string().optional(),
  mode: mode.default('relevant'),
  instruction: z.string().default(''),
  freq: freq.default('daily'),
  priority: priority.default('normal'),
  thesisIds: ids.default([]),
  origin: z.enum(['user', 'starter_pack', 'suggestion']).default('user'),
  probe: z.any().optional()
})

const c = <T extends z.ZodTypeAny>(req: T, opts: { test?: boolean } = {}) => ({ req, ...opts })

export const commands = {
  // app
  'processing.readRest': c(z.object({})),
  'processing.setLimit': c(z.object({ limit: z.number().int().min(0).max(100000) })),
  'app.status': c(none),
  // settings & accounts
  'settings.get': c(none),
  'settings.update': c(z.object({ patch: z.record(z.string(), z.unknown()) })),
  'ai.status': c(none),
  'ai.test': c(none),
  'email.configure': c(z.object({ user: z.string().email(), appPassword: z.string().min(8), recipient: z.string().email().optional() })),
  'email.test': c(none),
  'email.remove': c(none),
  'bridge.listProfiles': c(none),
  'bridge.allow': c(z.object({ profile: z.string() })),
  'bridge.status': c(none),
  'library.reindex': c(none),
  'library.export': c(z.object({ dir: z.string().optional() })),
  'library.reveal': c(none),
  // sources
  'source.probe': c(z.object({ locator: z.string().min(1), once: z.boolean().optional() })),
  'source.create': c(SourceDraft),
  'source.update': c(z.object({ id, patch: z.object({ name: z.string().optional(), mode: mode.optional(), instruction: z.string().optional(), freq: freq.optional(), priority: priority.optional(), thesisIds: ids.optional() }) })),
  'source.list': c(z.object({ filter: z.object({ type: z.string().optional(), includeRemoved: z.boolean().optional() }).optional() })),
  'source.get': c(z.object({ id })),
  'source.syncNow': c(z.object({ id })),
  'source.backfill': c(z.object({ id, days: z.union([z.literal(7), z.literal(30), z.literal(90)]) })),
  'source.setEnabled': c(z.object({ id, enabled: z.boolean() })),
  'source.mute': c(z.object({ id, muted: z.boolean() })),
  'source.reset': c(z.object({ id })),
  'source.remove': c(z.object({ id })),
  'source.restore': c(z.object({ id })),
  'source.retry': c(z.object({ id })),
  'source.signIn': c(z.object({ id })),
  'source.signOutSite': c(z.object({ domain: z.string() })),
  'source.suggestions': c(none),
  'source.dismissSuggestion': c(z.object({ id })),
  'source.history': c(none),
  // ingress
  'ingress.addUrl': c(z.object({ url: z.string().min(1), thesisIds: ids.optional(), text: z.string().optional() })),
  'ingress.addText': c(z.object({ text: z.string().min(1), thesisIds: ids.optional() })),
  // feed
  'feed.list': c(z.object({ viewSpec: FeedViewSpec.optional() })),
  'feed.counts': c(z.object({ viewSpec: FeedViewSpec.optional() })),
  'feed.get': c(z.object({ itemId: id })),
  'feed.markRead': c(z.object({ ids, read: z.boolean() })),
  'feed.save': c(z.object({ ids, saved: z.boolean() })),
  'feed.dismiss': c(z.object({ ids, reason: z.string().optional() })),
  'feed.undismiss': c(z.object({ ids })),
  'feed.feedback': c(z.object({ id, value: z.enum(['more', 'less']) })),
  'feed.muteTopic': c(z.object({ id, thesisId: z.string().nullable().optional() })),
  'feed.why': c(z.object({ id })),
  // reader
  'document.get': c(z.object({ id })),
  'document.open': c(z.object({ id })),
  'document.reader': c(z.object({ id })),
  'document.retry': c(z.object({ id, resetGeneration: z.boolean().optional() })),
  'evidence.keep': c(z.object({ id, thesisId: z.string().optional(), stance: stance.optional() })),
  'evidence.highlight': c(z.object({ documentId: id, start: z.number().int().nonnegative(), end: z.number().int().positive(), thesisId: z.string().optional(), companyId: z.string().optional() })),
  // links
  'link.confirm': c(z.object({ relId: id })),
  'link.change': c(z.object({ relId: id, thesisId: id, stance })),
  'link.reject': c(z.object({ relId: id })),
  'link.attach': c(z.object({ fromType: z.enum(['document', 'evidence', 'feed_item', 'company', 'firm', 'note']), fromId: id, thesisId: id, stance: stance.optional() })),
  'link.rejectEntity': c(z.object({ documentId: id, entityType, entityId: id })),
  // objects
  'object.get': c(z.object({ type: objType, id })),
  'object.list': c(z.object({ type: objType, mode: z.enum(['following', 'all']).default('all') })),
  'object.follow': c(z.object({ type: objType, id, follow: z.boolean() })),
  'object.pin': c(z.object({ type: z.enum(['company', 'thesis']), id, pin: z.boolean() })),
  'object.reorderPins': c(z.object({ type: z.enum(['company', 'thesis']), ids })),
  'object.refresh': c(z.object({ type: pageType, id })),
  'object.pullLatest': c(z.object({ type: z.enum(['company', 'firm', 'person']), id })),
  // Re-process (DEC-099): redo the agent's work on one object; Plan = what it will do (the confirm's cost hint)
  'object.reprocessPlan': c(z.object({ type: z.enum(['company', 'firm', 'person', 'thesis', 'source', 'document']), id })),
  'object.reprocess': c(z.object({ type: z.enum(['company', 'firm', 'person', 'thesis', 'source', 'document']), id })),
  'object.reprocessKeep': c(z.object({ type: z.enum(['company', 'firm', 'person']), id })),
  'object.details': c(z.object({ type: z.enum(['company', 'firm', 'person', 'thesis', 'source']), id })),
  'object.watch': c(z.object({ type: z.enum(['company', 'firm', 'person']), id, query: z.string().min(1).max(300) })),
  'object.create': c(z.object({ type: z.enum(['company', 'firm', 'person']), name: z.string().min(1), website: z.string().max(300).optional(), about: z.string().max(2000).optional() })),
  'object.markViewed': c(z.object({ type: pageType, id })),
  // fields
  'field.set': c(z.object({ objectType: pageType, objectId: id, key: z.string(), value: z.string() })),
  'field.revert': c(z.object({ objectType: pageType, objectId: id, key: z.string() })),
  'field.history': c(z.object({ objectType: pageType, objectId: id, key: z.string() })),
  'field.resolveProposal': c(z.object({ fvId: id, choice: z.enum(['keep', 'use_new']) })),
  // corrections
  'correct.parse': c(z.object({ text: z.string().min(1) })),
  'correct.apply': c(z.object({ proposal: z.record(z.string(), z.unknown()) })),
  'merge.entities': c(z.object({ type: entityType, fromId: id, intoId: id })),
  'merge.theses': c(z.object({ fromId: id, intoId: id })),
  'suggestion.resolve': c(z.object({ id, accept: z.boolean() })),
  // ontology operations (DEC-094): one dispatch path for every change to companies/firms/people/theses/fields/links
  // the user's own description/details of an object (DEC-099); writes go through ontology.apply op object.describe
  'object.describe': c(z.object({ type: z.enum(['company', 'firm', 'person', 'thesis', 'source']), id, patch: z.record(z.string(), z.unknown()), rerun: z.boolean().optional() })),
  'ontology.apply': c(z.object({ op: z.string().min(1), input: z.record(z.string(), z.unknown()) })),
  'ontology.undo': c(z.object({ historyId: z.string().optional(), historyIds: ids.optional() }).refine(x => !!x.historyId || !!x.historyIds?.length, 'historyId or historyIds required')),
  'ontology.ops': c(none),
  'ontology.aliasAudit': c(none),
  // theses
  'thesis.create': c(z.object({ parentId: z.string().nullish(), title: z.string().optional() })),
  'thesis.update': c(z.object({ id, patch: z.object({ title: z.string().optional(), description: z.string().optional(), currentView: z.string().optional(), conviction: z.number().int().min(1).max(5).optional(), watching: z.boolean().optional() }) })),
  'thesis.move': c(z.object({ id, parentId: z.string().nullable() })),
  'thesis.archive': c(z.object({ id, archived: z.boolean() })),
  'thesis.tree': c(z.object({ includeArchived: z.boolean().optional() })),
  'thesis.evolution': c(z.object({ id })),
  'thesis.addCompany': c(z.object({ id, companyId: id })),
  // notes
  'note.create': c(z.object({ text: z.string().min(1), kind: z.enum(['observation', 'question', 'counterpoint', 'correction']).optional(), kindDecided: z.boolean().optional(), anchor: z.object({ type: z.enum(['thesis', 'company', 'firm', 'none']), id: z.string().nullish() }).optional(), documentId: z.string().optional(), quote: z.string().optional(), thesisId: z.string().nullish(), companyIds: ids.optional(), firmIds: ids.optional() })),
  'note.suggest': c(z.object({ text: z.string(), context: z.object({ documentId: z.string().optional(), thesisId: z.string().optional() }).optional() })),
  'note.update': c(z.object({ id, patch: z.object({ text: z.string().optional(), kind: z.enum(['observation', 'question', 'counterpoint', 'correction']).optional() }) })),
  'note.delete': c(z.object({ id })),
  'note.retry': c(z.object({ id })),
  // views
  'view.get': c(z.object({ objectType: viewObjType, objectId: z.string().nullish() })),
  'view.customize': c(z.object({ objectType: viewObjType, objectId: z.string().nullish(), instruction: z.string().min(1) })),
  'view.undo': c(z.object({ viewId: id })),
  'view.reset': c(z.object({ objectType: viewObjType, objectId: z.string().nullish() })),
  'view.saveFeedView': c(z.object({ name: z.string().min(1), spec: FeedViewSpec.partial() })),
  'view.deleteFeedView': c(z.object({ id })),
  'view.listFeedViews': c(none),
  // query
  'search.query': c(z.object({ text: z.string(), scope: z.enum(['all', 'company', 'firm', 'evidence']).optional() })),
  'query.ask': c(z.object({ question: z.string().min(1), conversationId: z.string().optional() })),
  'query.recent': c(none),
  // reports
  'report.list': c(none),
  'report.createFromPrompt': c(z.object({ text: z.string().min(1) })),
  'report.retry': c(z.object({ id })),
  'report.refine': c(z.object({ id, text: z.string().min(1) })),
  'report.undo': c(z.object({ id })),
  // the settings strip: schedule / layout / sections edited directly (same definition and history as Refine)
  'report.patch': c(z.object({ id, patch: z.object({ schedule: z.object({ kind: z.enum(['none', 'daily', 'weekdays', 'weekly']), at: z.string().nullish(), weekday: z.number().int().min(0).max(6).nullish() }).optional(), style: z.enum(['story', 'digest', 'table']).optional(), sections: z.array(z.object({ id: z.string(), title: z.string() })).min(1).optional() }) })),
  'report.preview': c(z.object({ id })),
  'report.runNow': c(z.object({ id })),
  'report.runs': c(z.object({ id })),
  'report.run': c(z.object({ runId: id })),
  'report.setEnabled': c(z.object({ id, enabled: z.boolean() })),
  'report.rename': c(z.object({ id, name: z.string().min(1) })),
  'report.delete': c(z.object({ id })),
  'report.restore': c(z.object({ id })),
  'report.export': c(z.object({ id: z.string().optional(), runId: z.string().optional(), format: z.enum(['pdf', 'markdown', 'copy_markdown', 'email']), path: z.string().optional() })),
  // briefings (DEC-091): one email built from tagged reports
  'briefing.list': c(none),
  'briefing.create': c(z.object({ name: z.string().min(1), reportIds: ids.min(1), schedule: briefingSchedule })),
  'briefing.update': c(z.object({ id, patch: z.object({ name: z.string().min(1).optional(), reportIds: ids.min(1).optional(), schedule: briefingSchedule.optional(), enabled: z.boolean().optional() }) })),
  'briefing.setReport': c(z.object({ id, reportId: id, on: z.boolean() })),
  'briefing.delete': c(z.object({ id })),
  'briefing.sendNow': c(z.object({ id })),
  'briefing.runs': c(z.object({ id })),
  // alerts
  'alert.compile': c(z.object({ text: z.string().min(1), anchor: z.object({ type: pageType, id }).optional() })),
  'alert.retry': c(z.object({ id })),
  'alert.activate': c(z.object({ id, channels: z.array(z.enum(['in_app', 'email'])).min(1) })),
  'alert.update': c(z.object({ id, text: z.string().min(1) })),
  'alert.setEnabled': c(z.object({ id, enabled: z.boolean() })),
  'alert.delete': c(z.object({ id })),
  'alert.list': c(none),
  // export
  'export.thesis': c(z.object({ id, format: z.enum(['pdf', 'markdown', 'copy_markdown', 'email']), path: z.string().optional() })),
  'export.email': c(z.object({ kind: z.enum(['thesis', 'report', 'run']), id })),
  // test-only (RW_TEST_MODE=1)
  'test.clock.set': c(z.object({ iso: z.string() }), { test: true }),
  'test.clock.advance': c(z.object({ ms: z.number() }), { test: true }),
  'test.scheduler.tick': c(none, { test: true }),
  'test.jobs.drain': c(z.object({ timeoutMs: z.number().optional() }), { test: true }),
  'test.inspect': c(z.object({ table: z.string(), where: z.record(z.string(), z.unknown()).optional() }), { test: true }),
  'test.faults.set': c(z.object({ spec: z.string() }), { test: true }),
  'test.auth.clearPartition': c(z.object({ domain: z.string() }), { test: true }),
  'test.secrets.set': c(z.object({ name: z.string(), value: z.string() }), { test: true }),
  'test.seedDemo': c(none, { test: true }),
  'test.alerts.setCooldown': c(z.object({ id, minutes: z.number().int().min(0) }), { test: true }),
  'test.groundingCheck': c(z.object({ text: z.string(), supports: z.array(z.string()), allowedNames: z.array(z.string()).optional() }), { test: true }),
  'test.ontology.invariants': c(none, { test: true }),
  'test.feed.review': c(z.object({ documentId: id, thesisId: id, stance: z.enum(['support', 'contra']) }), { test: true }),
  'test.aliases.add': c(z.object({ type: z.enum(['company', 'firm', 'person']), id, alias: z.string().min(1), origin: z.enum(['source_fact', 'user', 'merge']).default('source_fact') }), { test: true }),
  'test.tiers': c(none, { test: true })
} as const

export type CommandName = keyof typeof commands

export const EVENTS = ['job.started', 'job.completed', 'job.failed', 'source.updated', 'source.syncCompleted', 'document.ingested', 'feed.updated',
  'object.updated', 'suggestion.created', 'view.updated', 'report.ready', 'notification.triggered', 'query.progress', 'banner.updated',
  'settings.updated', 'alert.needsConfirmation', 'app.deeplink'] as const
