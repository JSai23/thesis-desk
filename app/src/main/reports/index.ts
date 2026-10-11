// Reports (RFC FLOW-G, §1B.17, DEC-036): the request is saved as a draft row before any model call; COMPILE_REPORT
// turns it into a validated ReportDefinition (or routes it to an alert). RUN_REPORT resolves section queries over the
// library into a self-contained snapshot (claims, quotes, sources, URLs, dates, lead images) and, for story layouts,
// a grounded narrative (COMPOSE_STORY); render.ts turns the snapshot into Markdown and email-safe HTML (DEC-093).
import fs from 'node:fs'
import path from 'node:path'
import { all, one, run, tx, json } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { writeHistory } from '../history'
import { enqueue, registerJob, onJobFailure } from '../jobs'
import { upsertSchedule, deleteSchedule, setScheduleEnabled, onSchedule, type Spec } from '../scheduler'
import { runTask } from '../ai/runtime'
import { readAuth } from '../ai/codex-auth'
import { CREATE_REPORT, REFINE_REPORT, COMPOSE, COMPOSE_STORY, sectionOf, type ModelReport } from '../ai/tasks/reports'
import { Handles } from '../ai/handles'
import { groundingCheck, numbers } from '../ai/grounding'
import { ReportDefinition, STAGE_ENUM, type SectionQuery, type ReportStyle } from '../../shared/schemas/report-def'
import { DATA_DIR } from '../env'
import { leadImage } from '../ingest/lead-image'
import { renderHtml, renderMarkdown, type RowOut, type Deal, type RunContent, type RunSection, type Sentence } from './render'
import { descendants } from '../theses'
import { account } from '../mail'
import { listBriefings, createBriefing, updateBriefing } from './briefings'
import { getSetting, setSetting } from '../settings'
import { log } from '../log'
import { entityCatalog } from './catalog'
import type { ReportDTO, ReportRunDTO } from '../../shared/dto'
import { tierOf, tierWeight } from '../objects/tiers'

export { esc, FOOTER, renderHtml, renderMarkdown, reportBlock, documentHtml } from './render'

const DAY = 86400_000
type Def = ReportDefinition

// ---------------------------------------------------------------- templates (P-REPORT-008, DEC-031)
function templates(): { key: string; def: Def }[] {
  const vertical = all<{ id: string; title: string }>('SELECT id, title FROM theses WHERE merged_into_id IS NULL').find(t => /vertical/i.test(t.title))
  const q = (o: Partial<SectionQuery> & { source: SectionQuery['source']; since: SectionQuery['since'] }): SectionQuery => ({ sort: 'newest', ...o })
  return [
    { key: 'daily_brief', def: { version: 1, name: 'Daily Brief', style: 'story', schedule: { kind: 'weekdays', at: '07:30' }, delivery: { inApp: true, email: false }, sections: [
      { id: 'top', title: 'Top signals', query: q({ source: 'feed_items', since: '24h', sort: 'importance' }), limit: 5, presentation: 'list' },
      { id: 'theses', title: 'Thesis updates', query: q({ source: 'thesis_changes', since: '24h' }), limit: 8, presentation: 'list' },
      { id: 'deals', title: 'New deals', query: q({ source: 'evidence', since: '24h', kinds: ['funding', 'investment'] }), limit: 8, presentation: 'list' },
      { id: 'people', title: 'People to watch', query: q({ source: 'people_activity', since: '7d' }), limit: 5, presentation: 'list' }] } },
    { key: 'theses_changed', def: { version: 1, name: 'How my theses changed', style: 'story', schedule: { kind: 'weekly', at: '17:00', weekday: 5 }, delivery: { inApp: true, email: false }, sections: [
      { id: 'changes', title: 'Thesis updates', query: q({ source: 'thesis_changes', since: '7d' }), limit: 12, presentation: 'list' },
      { id: 'top', title: 'Top signals', query: q({ source: 'feed_items', since: '7d', sort: 'importance' }), limit: 5, presentation: 'list' }] } },
    { key: 'vertical_ai_deals', def: { version: 1, name: 'Seed and Series A deals in vertical AI', style: 'story', schedule: { kind: 'none' }, delivery: { inApp: true, email: false }, sections: [
      { id: 'deals', title: 'Seed and Series A deals', query: q({ source: 'evidence', since: '30d', kinds: ['funding'], stages: ['Pre-seed', 'Seed', 'Series A'], ...(vertical ? { theses: [vertical.id] } : {}) }), limit: 12, presentation: 'list' }] } },
    { key: 'evidence_against', def: { version: 1, name: 'Evidence against my theses', style: 'story', schedule: { kind: 'weekly', at: '08:00', weekday: 1 }, delivery: { inApp: true, email: false }, sections: [
      { id: 'contra', title: 'Evidence against my theses', query: q({ source: 'thesis_contra', since: '7d' }), limit: 12, presentation: 'list' }] } }
  ]
}

export function seedTemplates(): void {
  // DEC-093: built-in templates saved before layouts existed become story reports (once: afterwards they carry a style)
  for (const r of all<{ id: string; definition_json: string }>("SELECT id, definition_json FROM reports WHERE template_key IS NOT NULL AND definition_json IS NOT NULL AND json_extract(definition_json, '$.style') IS NULL"))
    run("UPDATE reports SET definition_json = json_set(definition_json, '$.style', 'story') WHERE id = ?", r.id)
  if (one("SELECT 1 FROM reports WHERE template_key IS NOT NULL")) return
  const t = now()
  for (const tp of templates()) run("INSERT INTO reports(id, name, status, definition_json, enabled, template_key, created_at, updated_at) VALUES (?, ?, 'active', ?, 0, ?, ?, ?)", newId('rp'), tp.def.name, JSON.stringify(tp.def), tp.key, t, t)
}

/** Queue a preview run. One already waiting reads the latest definition when it runs; one already *running* read the
 *  old one, so a new preview is queued after it — a refine made meanwhile must show (UI-REP-01, iteration 2). */
function queuePreview(id: string): void {
  const key = `report:${id}:preview`
  if (one("SELECT 1 FROM jobs WHERE type = 'RUN_REPORT' AND idempotency_key LIKE ? AND status = 'queued'", key + '%')) return
  const running = one("SELECT 1 FROM jobs WHERE type = 'RUN_REPORT' AND idempotency_key LIKE ? AND status = 'running'", key + '%')
  enqueue('RUN_REPORT', { reportId: id, trigger: 'preview' }, { idempotencyKey: running ? `${key}:after:${now()}` : key, priority: 2 })
}

// ---------------------------------------------------------------- only briefings send (DEC-100)
/** A report that asks for email ("email it to me", an old template, a report from before DEC-100) goes into a briefing —
 *  one already holding it, else its own one-report briefing that takes over the report's schedule (the briefing runs it)
 *  — and the report itself never emails. Returns the definition to save and the briefing's name. */
export function emailThroughBriefing(reportId: string, def: Def, enabled = true): { def: Def; briefing: string | null } {
  if (!def.delivery.email) return { def, briefing: null }
  const next: Def = { ...def, delivery: { ...def.delivery, email: false } }
  const holding = listBriefings().find(b => b.reports.some(r => r.id === reportId))
  if (holding) return { def: next, briefing: holding.name }
  const sc = def.schedule
  const b = createBriefing({ name: def.name, reportIds: [reportId], schedule: sc.kind === 'none' || !sc.at ? { kind: 'none' } : { kind: sc.kind, at: sc.at, ...(sc.kind === 'weekly' ? { weekday: sc.weekday ?? 1 } : {}) } })
  if (!enabled) updateBriefing(b.id, { enabled: false })
  writeHistory('report', reportId, 'report.email_to_briefing', { schedule: def.schedule }, { briefingId: b.id })
  return { def: { ...next, schedule: sc.kind === 'none' ? sc : { kind: 'none' } }, briefing: b.name }
}

/** Once per library: reports that emailed before DEC-100 move into one-report briefings with their schedule. */
function migrateEmailingReports(): void {
  if (getSetting('reports.briefings_only') === 1) return
  for (const r of all<Row>("SELECT * FROM reports WHERE deleted_at IS NULL AND definition_json IS NOT NULL AND json_extract(definition_json, '$.delivery.email') = 1")) {
    const def = json<Def>(r.definition_json, null as any)
    if (!def) continue
    const m = emailThroughBriefing(r.id, def, !!r.enabled)
    run('UPDATE reports SET definition_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(m.def), now(), r.id)
    syncSchedule(r.id, m.def, !!r.enabled)
    log.info('reports', 'emailing report moved into a briefing', { report: r.id })
  }
  setSetting('reports.briefings_only', 1)
}

// ---------------------------------------------------------------- schedule helpers
function specOf(d: Def): Spec | null {
  const s = d.schedule
  if (s.kind === 'none' || !s.at) return null
  return { at: s.at, days: s.kind === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : s.kind === 'weekdays' ? [1, 2, 3, 4, 5] : [s.weekday ?? 1] }
}
const DAYNAME = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
export function scheduleLabel(d: Def | null): string {
  if (!d || d.schedule.kind === 'none' || !d.schedule.at) return 'On demand'
  const [h, m] = d.schedule.at.split(':').map(Number)
  const tm = `${h}:${String(m).padStart(2, '0')}`
  return d.schedule.kind === 'daily' ? `Daily ${tm}` : d.schedule.kind === 'weekdays' ? `Weekdays ${tm}` : `${DAYNAME[d.schedule.weekday ?? 1]} ${tm}`
}
function syncSchedule(id: string, d: Def | null, enabled: boolean): void {
  const sp = d ? specOf(d) : null
  if (!sp) { deleteSchedule('report', id); return }
  upsertSchedule('report', id, sp, undefined, enabled)
}

// ---------------------------------------------------------------- DTO
interface Row { id: string; name: string; status: string; prompt_text: string | null; pending_refinement: string | null; last_error: string | null; definition_json: string | null; enabled: number; template_key: string | null; last_run_at: number | null; created_at: number; deleted_at: number | null }
const getRow = (id: string) => one<Row>('SELECT * FROM reports WHERE id = ?', id)
export function toDTO(r: Row): ReportDTO {
  const d = json<Def | null>(r.definition_json, null)
  return {
    id: r.id, name: r.name, status: r.status as any, promptText: r.prompt_text, pendingRefinement: r.pending_refinement, lastError: r.last_error, enabled: !!r.enabled,
    scheduleLabel: scheduleLabel(d), channels: ['In-app'], lastRunAt: r.last_run_at, templateKey: r.template_key,
    briefings: listBriefings().filter(b => b.reports.some(x => x.id === r.id)).map(b => ({ id: b.id, name: b.name, enabled: b.enabled })),
    lastChange: lastChange(r.id),
    emailNotSetUp: !account(), refineFailed: !!r.pending_refinement && !!r.last_error, definition: d
  }
}
export const listReports = () => all<Row>('SELECT * FROM reports WHERE deleted_at IS NULL ORDER BY (template_key IS NOT NULL), created_at DESC').map(toDTO)

// ---------------------------------------------------------------- model ↔ definition
function catalogs(text: string) {
  return {
    theses: all<{ id: string; title: string }>('SELECT id, title FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL'),
    firms: entityCatalog('firm', text, 200),
    companies: entityCatalog('company', text, 250)
  }
}
function mapIds(m: ModelReport, f: (x: string) => string): ModelReport {
  const g = (xs: string[] | null) => xs ? xs.map(f) : xs
  return { ...m, sections: m.sections.map(s => ({ ...s, query: { ...s.query, theses: g(s.query.theses), firms: g(s.query.firms), companies: g(s.query.companies) } })) }
}
export function toDef(m: ModelReport): Def {
  const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length)))
  return ReportDefinition.parse({
    version: 1, name: m.name.slice(0, 80), style: m.style,
    schedule: clean({ kind: m.schedule.kind, at: m.schedule.kind === 'none' ? null : m.schedule.at, weekday: m.schedule.kind === 'weekly' ? m.schedule.weekday : null }),
    delivery: { inApp: true, email: m.email },
    // two sections with the same query would show the same rows (and chart) twice — keep the first (run #15, RD-STORY-01)
    sections: m.sections.filter((s, i) => m.sections.findIndex(x => JSON.stringify(clean(x.query)) === JSON.stringify(clean(s.query))) === i)
      .map(s => ({ id: s.id, title: s.title, limit: Math.max(1, Math.min(20, s.limit)), presentation: s.presentation, ...(s.style && s.style !== m.style ? { style: s.style } : {}), query: clean(s.query) }))
  })
}
const toModel = (d: Def): ModelReport => ({
  name: d.name, style: d.style ?? 'digest', email: d.delivery.email, schedule: { kind: d.schedule.kind, at: d.schedule.at ?? null, weekday: d.schedule.weekday ?? null },
  sections: d.sections.map(s => ({ id: s.id, title: s.title, limit: s.limit, presentation: s.presentation, style: s.style ?? null, query: { theses: null, kinds: null, stages: null, excludeStagesAbove: null, followedOnly: null, firms: null, companies: null, minImportance: null, novelOnly: null, ...s.query } as any }))
})
/** Layout words in the user's request always win (the adversarial review found "as a table" silently ignored): after the
 * model, a deterministic pass applies an explicit layout the definition doesn't have. Negated mentions ("not as a
 * table", "instead of the table") remove that layout. A refinement asking for "shorter" that didn't shrink the report
 * lowers every section's limit. (See DEC-093) */
export function enforceLayout(text: string, d: Def, prev?: Def | null): Def {
  const t = ` ${(text || '').toLowerCase()} `
  const used = () => new Set<string>([d.style ?? 'digest', ...d.sections.map(s => s.style || d.style || 'digest')])
  const neg = (w: string) => new RegExp(`\\b(no|not|without|instead of|rather than|stop|drop|remove|don't|dont|never)\\b[^.;,]{0,24}\\b${w}`).test(t)
  const setAll = (st: ReportStyle, keep?: ReportStyle) => { d = { ...d, style: st, sections: d.sections.map(s => (s.style && s.style === keep ? s : (({ style: _x, ...rest }) => rest)(s))) } }
  const words: [ReportStyle, RegExp, string][] = [
    ['table', /\b(table|tabular|spreadsheet)\b/, '(table|tabular|spreadsheet)'],
    ['digest', /\b(digest|just (the )?(list|headlines|links)|no (narrative|commentary|story))\b/, 'digest'],
    ['story', /\b(story|narrative|visuals?|images?|pictures?|photos?|charts?|graphs?)\b/, '(story|narrative|visuals?|images?|pictures?|photos?|charts?|graphs?)']
  ]
  for (const [st, re, w] of words) {
    if (!re.test(t)) continue
    if (neg(w)) { if (used().has(st)) setAll(st === 'story' ? 'digest' : 'story') }
    else if (!used().has(st)) setAll(st, st === 'story' ? 'table' : undefined)
  }
  if (prev && /\b(shorter|briefer|condense|trim it|cut it down)\b/.test(t)) {
    const n = (x: Def) => x.sections.reduce((k, s) => k + s.limit, 0)
    if (n(d) >= n(prev)) d = { ...d, sections: d.sections.map(s => ({ ...s, limit: Math.max(1, Math.round(s.limit * 0.6)) })) }
  }
  return ReportDefinition.parse(d)
}

function validateModel(m: ModelReport, ids: { theses: Set<string>; firms: Set<string>; companies: Set<string> }): string[] {
  const p: string[] = []
  try { toDef(m) } catch (e: any) { p.push(...(e.issues || [{ path: [], message: String(e.message) }]).slice(0, 6).map((i: any) => `${(i.path || []).join('.')}: ${i.message}`)) }
  for (const s of m.sections) {
    for (const t of s.query.theses || []) if (!ids.theses.has(t)) p.push(`section ${s.id}: unknown thesis id ${t}`)
    for (const f of s.query.firms || []) if (!ids.firms.has(f)) p.push(`section ${s.id}: unknown firm id ${f}`)
    for (const c of s.query.companies || []) if (!ids.companies.has(c)) p.push(`section ${s.id}: unknown company id ${c}`)
  }
  if (m.sections.length > 8) p.push('at most 8 sections')
  return p
}

// ---------------------------------------------------------------- lifecycle
export function createFromPrompt(text: string): { reportId: string; status: 'draft' } {
  if (!text.trim()) throw new AppError('VALIDATION', 'Describe the report you want.')
  const id = newId('rp')
  const t = now()
  tx(() => {
    run("INSERT INTO reports(id, name, status, prompt_text, enabled, created_at, updated_at) VALUES (?, ?, 'draft', ?, 1, ?, ?)", id, text.trim().slice(0, 60), text.trim(), t, t)
    writeHistory('report', id, 'report.requested', null, { text })
  })
  enqueue('COMPILE_REPORT', { reportId: id, mode: 'create' }, { idempotencyKey: `compile:${id}`, priority: 1, maxAttempts: 2 })
  emit('report.ready', { reportId: id })
  return { reportId: id, status: 'draft' }
}

async function compile(p: { reportId: string; mode: 'create' | 'refine' }, jobId: string): Promise<unknown> {
  const r = getRow(p.reportId)
  if (!r || r.deleted_at) return { skipped: true }
  if (readAuth().status !== 'ok') throw new AppError('AI_UNAVAILABLE', 'No ChatGPT sign-in found')
  const raw = catalogs([r.prompt_text, r.pending_refinement, r.name].filter(Boolean).join(' '))
  const h = new Handles() // the model sees T1/F2/C3, never ULIDs (MEM-053)
  const cat = { theses: h.label('T', raw.theses), firms: h.label('F', raw.firms), companies: h.label('C', raw.companies) }
  const ids = { theses: new Set(cat.theses.map(x => x.id)), firms: new Set(cat.firms.map(x => x.id)), companies: new Set(cat.companies.map(x => x.id)) }
  if (p.mode === 'refine') {
    if (!r.pending_refinement || !r.definition_json) return { skipped: true }
    const cur = json<Def>(r.definition_json, null as any)
    const out = await runTask(REFINE_REPORT, { text: r.pending_refinement, current: mapIds(toModel(cur), x => h.out(x)), theses: cat.theses, firms: cat.firms, validate: m => validateModel(m, ids) }, { jobId })
    const routed = emailThroughBriefing(r.id, enforceLayout(r.pending_refinement, toDef(mapIds(out.value.report, x => h.back(x))), cur), !!r.enabled)
    const next = routed.def
    tx(() => {
      run('UPDATE reports SET definition_json = ?, name = ?, pending_refinement = NULL, last_error = NULL, updated_at = ? WHERE id = ?', JSON.stringify(next), next.name, now(), r.id)
      writeHistory('report', r.id, 'report.changed', { definition_json: r.definition_json, name: r.name }, { definition_json: JSON.stringify(next), name: next.name, summary: out.value.summary, refinement: r.pending_refinement })
      syncSchedule(r.id, next, !!r.enabled)
    })
    emit('report.ready', { reportId: r.id, toast: routed.briefing ? `Updated · reports aren't emailed on their own — it's in the briefing “${routed.briefing}”, which emails you` : 'Updated · ' + out.value.summary, undo: true })
    queuePreview(r.id)
    return { refined: true }
  }
  const out = await runTask(CREATE_REPORT, { text: r.prompt_text || r.name, now: new Date(now()).toISOString(), ...cat, templates: templates().map(t => `- ${t.def.name}: ${t.def.sections.map(s => s.title).join(', ')}`).join('\n'), validate: m => validateModel(m, ids) }, { jobId })
  if (out.value.route === 'clarify') {
    // the request can't be built faithfully (unintelligible, unknown entity, unsupported channel): tell the user, keep the text
    run("UPDATE reports SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?", (out.value.clarification || 'I couldn’t turn this into a report.').slice(0, 300), now(), r.id)
    writeHistory('report', r.id, 'report.needs_clarification', null, { clarification: out.value.clarification })
    emit('report.ready', { reportId: r.id })
    return { clarify: out.value.clarification }
  }
  if (out.value.route === 'alert') {
    const { compileAlertDraft } = await import('../alerts')
    const alertId = tx(() => {
      run('DELETE FROM reports WHERE id = ?', r.id)
      writeHistory('report', r.id, 'report.routed_to_alert', null, { text: r.prompt_text })
      return compileAlertDraft(out.value.alertText || r.prompt_text || '', null)
    })
    emit('alert.needsConfirmation', { alertId })
    emit('report.ready', { reportId: r.id })
    return { routed: 'alert', alertId }
  }
  const routed = emailThroughBriefing(r.id, enforceLayout(r.prompt_text || '', toDef(mapIds(out.value.report!, x => h.back(x)))))
  const def = routed.def
  tx(() => {
    run("UPDATE reports SET status = 'active', name = ?, definition_json = ?, last_error = NULL, updated_at = ? WHERE id = ?", def.name, JSON.stringify(def), now(), r.id)
    writeHistory('report', r.id, 'report.changed', null, { definition_json: JSON.stringify(def), name: def.name })
    syncSchedule(r.id, def, true)
  })
  queuePreview(r.id)
  emit('report.ready', { reportId: r.id, toast: `Report created · ${routed.briefing ? `emailed through the briefing “${routed.briefing}”` : scheduleLabel(def)}` })
  return { created: true }
}

export function retry(id: string): void {
  const r = getRow(id)
  if (!r || r.deleted_at) throw new AppError('NOT_FOUND', 'Report not found')
  run('UPDATE reports SET last_error = NULL, updated_at = ? WHERE id = ?', now(), id)
  if (r.status === 'failed' || r.status === 'draft') run("UPDATE reports SET status = 'draft' WHERE id = ?", id)
  enqueue('COMPILE_REPORT', { reportId: id, mode: r.pending_refinement ? 'refine' : 'create' }, { idempotencyKey: `compile:${id}`, priority: 1, maxAttempts: 2 })
  emit('report.ready', { reportId: id })
}

export function refine(id: string, text: string): void {
  const r = getRow(id)
  if (!r || r.deleted_at || !r.definition_json) throw new AppError('NOT_FOUND', 'Report not found')
  if (!text.trim()) throw new AppError('VALIDATION', 'Describe the change you want.')
  run('UPDATE reports SET pending_refinement = ?, last_error = NULL, updated_at = ? WHERE id = ?', text.trim(), now(), id)
  enqueue('COMPILE_REPORT', { reportId: id, mode: 'refine' }, { idempotencyKey: `compile:${id}`, priority: 1, maxAttempts: 2 })
  emit('report.ready', { reportId: id })
}

/** Undo steps back one definition change at a time (each undo consumes the newest change not yet undone). */
export function undo(id: string): void {
  const undone = new Set(all<{ after_json: string | null }>("SELECT after_json FROM history WHERE entity_type = 'report' AND entity_id = ? AND action = 'report.undone'", id).map(r => json<any>(r.after_json, {}).undid))
  const h = all<any>("SELECT * FROM history WHERE entity_type = 'report' AND entity_id = ? AND action = 'report.changed' AND before_json IS NOT NULL ORDER BY created_at DESC, rowid DESC", id).find(x => !undone.has(x.id))
  const r = getRow(id)
  if (!h || !r) throw new AppError('NOT_FOUND', 'Nothing to undo')
  const before = json<any>(h.before_json, {})
  const def = json<Def | null>(before.definition_json, null)
  tx(() => {
    run('UPDATE reports SET definition_json = ?, name = ?, updated_at = ? WHERE id = ?', before.definition_json, before.name || r.name, now(), id)
    writeHistory('report', id, 'report.undone', { definition_json: r.definition_json }, { definition_json: before.definition_json, undid: h.id })
    syncSchedule(id, def, !!r.enabled)
  })
  emit('report.ready', { reportId: id })
}

/** The settings strip (Backlog "Clearer report editing"): schedule, layout and sections edited directly — the same
 *  definition the AI refines, the same history row, so Undo and the next refine see it. Sections: ordered ids with titles;
 *  a section left out is removed (at least one stays). */
export function patchDefinition(id: string, patch: { schedule?: Def['schedule']; style?: Def['style']; sections?: { id: string; title: string }[] }): void {
  const r = getRow(id)
  if (!r || r.deleted_at || !r.definition_json) throw new AppError('NOT_FOUND', 'Report not found')
  const cur = json<Def>(r.definition_json, null as any)
  const sections = patch.sections
    ? patch.sections.map(p => { const sec = cur.sections.find(x => x.id === p.id); if (!sec) throw new AppError('VALIDATION', 'Unknown section'); return { ...sec, title: p.title.trim() || sec.title } })
    : cur.sections
  if (!sections.length) throw new AppError('VALIDATION', 'A report needs at least one section')
  const sc = patch.schedule as any
  const schedule = sc ? { kind: sc.kind, ...(sc.kind !== 'none' && sc.at ? { at: sc.at } : {}), ...(sc.kind === 'weekly' ? { weekday: sc.weekday ?? 1 } : {}) } : null
  if (schedule && schedule.kind !== 'none' && !schedule.at) throw new AppError('VALIDATION', 'Pick a time')
  const parsed = ReportDefinition.safeParse({ ...cur, ...(schedule ? { schedule } : {}), ...(patch.style ? { style: patch.style } : {}), sections })
  if (!parsed.success) throw new AppError('VALIDATION', 'That change doesn’t make a valid report')
  const next = parsed.data as Def
  const summary = [patch.schedule && `schedule: ${scheduleLabel(next)}`, patch.style && `layout: ${next.style}`, patch.sections && `sections: ${next.sections.map(x => x.title).join(', ')}`].filter(Boolean).join(' · ')
  tx(() => {
    run('UPDATE reports SET definition_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(next), now(), id)
    writeHistory('report', id, 'report.changed', { definition_json: r.definition_json, name: r.name }, { definition_json: JSON.stringify(next), name: r.name, summary, manual: true })
    syncSchedule(id, next, !!r.enabled)
  })
  queuePreview(id)
  emit('report.ready', { reportId: id, toast: 'Updated · ' + summary, undo: true })
}

/** The last change to a report's definition (AI refine or the settings strip), for "Last change: … · Undo". */
function lastChange(id: string): { summary: string; at: number } | null {
  const undone = new Set(all<{ after_json: string | null }>("SELECT after_json FROM history WHERE entity_type = 'report' AND entity_id = ? AND action = 'report.undone'", id).map(x => json<any>(x.after_json, {}).undid))
  const h = all<any>("SELECT id, after_json, created_at FROM history WHERE entity_type = 'report' AND entity_id = ? AND action = 'report.changed' AND before_json IS NOT NULL ORDER BY created_at DESC, rowid DESC", id).find(x => !undone.has(x.id))
  const a = h ? json<any>(h.after_json, {}) : null
  return a?.summary ? { summary: String(a.summary), at: h.created_at } : null
}

export function setEnabled(id: string, enabled: boolean): void {
  const r = getRow(id)
  if (!r || r.deleted_at) throw new AppError('NOT_FOUND', 'Report not found')
  tx(() => {
    run('UPDATE reports SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, now(), id)
    syncSchedule(id, json<Def | null>(r.definition_json, null), enabled && r.status === 'active')
    writeHistory('report', id, enabled ? 'report.enabled' : 'report.disabled', null, null)
  })
  emit('report.ready', { reportId: id })
}
export function rename(id: string, name: string): void {
  const r = getRow(id); if (!r) throw new AppError('NOT_FOUND', 'Report not found')
  const d = json<Def | null>(r.definition_json, null)
  tx(() => { run('UPDATE reports SET name = ?, definition_json = ?, updated_at = ? WHERE id = ?', name, d ? JSON.stringify({ ...d, name }) : null, now(), id); writeHistory('report', id, 'report.renamed', { name: r.name }, { name }) })
  emit('report.ready', { reportId: id })
}
export function remove(id: string): void {
  tx(() => { run('UPDATE reports SET deleted_at = ?, updated_at = ? WHERE id = ?', now(), now(), id); setScheduleEnabled('report', id, false); writeHistory('report', id, 'report.deleted', null, null) })
  emit('report.ready', { reportId: id })
}
export function restore(id: string): void {
  const r = getRow(id); if (!r) throw new AppError('NOT_FOUND', 'Report not found')
  tx(() => { run('UPDATE reports SET deleted_at = NULL, updated_at = ? WHERE id = ?', now(), id); syncSchedule(id, json<Def | null>(r.definition_json, null), !!r.enabled && r.status === 'active') })
  emit('report.ready', { reportId: id })
}

// ---------------------------------------------------------------- run
const srcOf = (docId: string) => one<{ name: string; site: string | null; kind: string }>(`SELECT s.name, s.kind, d.site_name site FROM document_sources ds JOIN sources s ON s.id = ds.source_id JOIN documents d ON d.id = ds.document_id WHERE ds.document_id = ? ORDER BY CASE WHEN s.kind IN ('hn_api','search') THEN 1 ELSE 0 END, ds.first_seen_at LIMIT 1`, docId)
// a search or HN "source" is a query, not a publication: name the site the article came from
const srcName = (docId: string) => { const s = srcOf(docId); return s ? (s.name === 'Added by you' || s.kind === 'search' || s.kind === 'hn_api' ? s.site || s.name : s.name) : 'Source' }
const stageRank = (s: string) => (STAGE_ENUM as readonly string[]).indexOf(s)

function sinceTs(since: SectionQuery['since'], lastRun: number | null): number {
  if (since === 'last_run') return lastRun || now() - 7 * DAY
  return now() - (since === '24h' ? 1 : since === '7d' ? 7 : 30) * DAY
}

/** The document's lead image (DEC-093). Documents ingested before images were captured are filled lazily from their
 * stored raw HTML, once (the answer — an image or null — is saved in metadata_json.image). */
export function docImage(docId: string): string | null {
  const d = one<{ metadata_json: string; url: string | null; kind: string }>('SELECT metadata_json, url, kind FROM documents WHERE id = ?', docId)
  if (!d) return null
  const meta = json<any>(d.metadata_json, {})
  if ('image' in meta) return typeof meta.image === 'string' ? meta.image : null
  let image: string | null = null
  if (d.kind === 'web') {
    const v = one<{ raw_path: string | null }>("SELECT raw_path FROM document_versions WHERE document_id = ? AND raw_path LIKE '%.html' ORDER BY version DESC LIMIT 1", docId)
    try { if (v?.raw_path) image = leadImage(fs.readFileSync(path.join(DATA_DIR, v.raw_path), 'utf8'), d.url) } catch { image = null }
  }
  run("UPDATE documents SET metadata_json = json_set(metadata_json, '$.image', ?) WHERE id = ?", image, docId)
  return image
}

/** Deal facts for charts and tables: company, round, amount (kept only when its quote states it), lead investors. */
function dealOf(e: any): Deal | null {
  if (e.kind !== 'funding' && e.kind !== 'investment') return null
  const pl = json<any>(e.payload_json, {})
  const coId = pl.companyId || (pl.subjectType === 'company' ? pl.subjectId : null)
  const company = (coId && one<{ name: string }>('SELECT name FROM companies WHERE id = ?', coId)?.name) || pl.company || null
  if (!company) return null
  const amt = typeof pl.amountUsd === 'number' && pl.amountUsd > 0 ? pl.amountUsd : null
  const grounded = amt != null && numbers(e.quote || '').some(n => Math.abs(n - amt) <= amt * 0.01)
  const leads = e.kind === 'funding' ? (Array.isArray(pl.leadInvestors) ? pl.leadInvestors.filter((x: unknown) => typeof x === 'string') : [])
    : pl.role === 'lead' && pl.firm ? [String(pl.firm)] : []
  return { company: String(company), round: pl.round ? String(pl.round) : null, amountUsd: grounded ? amt : null, amountText: grounded ? pl.amountText || null : null, leads }
}

function evRow(e: any, text?: string): RowOut {
  const d = one<any>('SELECT url, title, published_at, first_fetched_at FROM documents WHERE id = ?', e.document_id)
  return { text: text || (e.assertion === 'attributed_opinion' && e.attributed_to ? `${e.attributed_to} argues: ${e.claim}` : e.claim), quote: e.quote, source: srcName(e.document_id), url: d?.url || null, date: d?.published_at || d?.first_fetched_at || null, documentId: e.document_id, itemId: one<any>('SELECT id FROM feed_items WHERE document_id = ?', e.document_id)?.id || null, evidenceId: e.id, citations: [e.id], ref: null,
    title: d?.title || '', image: docImage(e.document_id), kind: e.kind, deal: dealOf(e), stance: e.stance === 'support' || e.stance === 'contra' ? e.stance : null }
}

function dealKey(e: any): string | null {
  if (e.kind !== 'funding' && e.kind !== 'investment') return null
  const pl = json<any>(e.payload_json, {})
  const co = pl.companyId || (pl.subjectType === 'company' ? pl.subjectId : null)
  return co ? `${co}|${String(pl.round || '').trim().toLowerCase()}` : null
}

function thesisSet(q: SectionQuery): Set<string> | null { return q.theses?.length ? new Set(q.theses.flatMap(t => descendants(t))) : null }

/** When a fact happened: its stated event date, else its article's publish date, else when it was fetched (SQL). */
// a month alone ("in July" → 2026-07) counts as its last day (inclusive); a year alone is too vague → publish date
const HAPPENED = `COALESCE(CAST(strftime('%s', CASE length(e.event_date) WHEN 7 THEN date(e.event_date || '-01', '+1 month', '-1 day') WHEN 4 THEN NULL ELSE substr(e.event_date, 1, 10) END) AS INTEGER) * 1000, d.published_at, d.first_fetched_at)`
export function resolveSection(q: SectionQuery, limit: number, lastRun: number | null): RowOut[] {
  const since = sinceTs(q.since, lastRun)
  // a report's window is about when things happened, not when the app read them: "last 30 days" never shows a July
  // round from an article fetched today; "since last run" = newly learned AND happened within 30 days. What the user
  // sent themselves (Read once) is new to them when they sent it (same rule as the feed's groups).
  const happenedSince = q.since === 'last_run' ? now() - 30 * DAY : since
  const ths = thesisSet(q)
  const evLinkedTo = (evId: string, docId: string, stance?: string) => all<any>(`SELECT r.to_id, r.stance, r.confidence, r.status FROM relationships r WHERE r.from_type = 'evidence' AND r.from_id = ? AND r.to_type = 'thesis' AND r.status IN ('accepted','suggested')
     AND NOT EXISTS (SELECT 1 FROM relationships x WHERE x.from_type = 'document' AND x.from_id = ? AND x.to_type = 'thesis' AND x.to_id = r.to_id AND x.status = 'rejected')`, evId, docId).filter(l => !stance || l.stance === stance)
  const stageOk = (e: any) => {
    if (!q.stages?.length && !q.excludeStagesAbove) return true
    const pl = json<any>(e.payload_json, {})
    const coId = pl.companyId || (pl.subjectType === 'company' ? pl.subjectId : null)
    const round = String(pl.round || '')
    const stage = (STAGE_ENUM as readonly string[]).find(s => s.toLowerCase() === round.toLowerCase()) || (coId ? one<{ display: string }>("SELECT display FROM field_values WHERE object_type = 'company' AND object_id = ? AND field_key = 'stage' AND status = 'current'", coId)?.display : null) || null
    if (q.stages?.length && (!stage || !q.stages.includes(stage as any))) return false
    if (q.excludeStagesAbove && stage && stageRank(stage) > stageRank(q.excludeStagesAbove)) return false
    return true
  }
  const entityOk = (e: any) => {
    const pl = e.payload_json || ''
    if (q.companies?.length && !q.companies.some(c => pl.includes(c))) return false
    if (q.firms?.length && !q.firms.some(f => pl.includes(f))) return false
    if (q.followedOnly) { const fol = [...all<any>('SELECT id FROM companies WHERE followed = 1'), ...all<any>('SELECT id FROM firms WHERE followed = 1')].map(x => x.id); if (!fol.some(id => pl.includes(id))) return false }
    return true
  }
  // importance plus the tier of what the row is about (DEC-096): followed lifts it most, connected half as much
  const tierLift = (r: any): number => {
    if (r.reasons_json) { const rs = json<any[]>(r.reasons_json, []); return rs.some(x => /^followed_/.test(x.type)) ? 1 : rs.some(x => x.type === 'connected') ? 0.5 : 0 }
    const p = r.payload_json ? json<any>(r.payload_json, {}) : {}
    const t = p.subjectType || (r.company_id ? 'company' : null), id = p.subjectId || r.company_id
    return t && id ? tierWeight(tierOf(t, id)) : 0
  }
  const rank = (r: any, imp: (r: any) => number) => imp(r) + 0.2 * tierLift(r)
  const order = (rows: any[], imp: (r: any) => number) => (q.sort === 'importance' ? rows.sort((a, b) => rank(b, imp) - rank(a, imp)) : rows.sort((a, b) => b._t - a._t))
  switch (q.source) {
    case 'feed_items': {
      let rows = all<any>(`SELECT fi.*, d.published_at, d.first_fetched_at, d.url, d.title doc_title FROM feed_items fi JOIN documents d ON d.id = fi.document_id WHERE fi.surfaced_at >= ? AND (COALESCE(d.published_at, fi.surfaced_at) >= ? OR EXISTS (SELECT 1 FROM document_sources us WHERE us.document_id = d.id AND us.source_id = 'src_manual')) AND fi.dismissed_at IS NULL AND fi.hidden_reason IS NULL`, since, happenedSince).map(r => ({ ...r, _t: r.surfaced_at }))
      if (ths) rows = rows.filter(r => r.primary_thesis_id && ths.has(r.primary_thesis_id))
      if (q.minImportance != null) rows = rows.filter(r => r.importance >= q.minImportance!)
      if (q.followedOnly) rows = rows.filter(r => json<any[]>(r.reasons_json, []).some(x => /^followed_/.test(x.type)))
      return order(rows, r => r.score).slice(0, limit).map(r => {
        const top = one<any>("SELECT * FROM evidence WHERE document_id = ? AND status = 'active' ORDER BY confidence DESC, quote_start LIMIT 1", r.document_id)
        return { text: r.headline, quote: top?.quote || r.summary, source: srcName(r.document_id), url: r.url, date: r.published_at || r.first_fetched_at, documentId: r.document_id, itemId: r.id, evidenceId: top?.id || null, citations: top ? [top.id] : [], ref: null,
          title: r.doc_title || r.headline, image: docImage(r.document_id), kind: top?.kind || null, deal: top ? dealOf(top) : null, stance: null }
      })
    }
    case 'evidence': case 'people_activity': {
      const kinds = q.source === 'people_activity' ? ['executive_change'] : q.kinds
      let rows = all<any>(`SELECT e.*, COALESCE(d.published_at, d.first_fetched_at) _t FROM evidence e JOIN documents d ON d.id = e.document_id WHERE e.status = 'active' AND d.deleted_at IS NULL AND e.created_at >= ? AND ${HAPPENED} >= ?`, since, happenedSince)
      if (kinds?.length) rows = rows.filter(e => kinds.includes(e.kind))
      if (q.novelOnly) rows = rows.filter(e => e.is_novel)
      if (ths) rows = rows.filter(e => evLinkedTo(e.id, e.document_id).some(l => ths.has(l.to_id)))
      rows = rows.filter(e => stageOk(e) && entityOk(e))
      // one row per fact: collapse restatements (same fingerprint) to the newest
      const seen = new Set<string>()
      rows = order(rows, e => e.confidence).filter(e => { const k = e.fingerprint || e.id; if (seen.has(k)) return false; seen.add(k); return true })
      // one row per deal: a round is extracted as one funding fact plus one investment fact per investor (often the
      // same sentence); keep a single row per (company, round), preferring the funding fact that names the company
      const deals = new Map<string, number>()
      const kept: any[] = []
      for (const e of rows) {
        const k = dealKey(e)
        if (k == null) { kept.push(e); continue }
        const at = deals.get(k)
        if (at === undefined) { deals.set(k, kept.length); kept.push(e) } else if (kept[at].kind !== 'funding' && e.kind === 'funding') kept[at] = e
      }
      return kept.slice(0, limit).map(e => evRow(e))
    }
    case 'thesis_changes': case 'thesis_contra': {
      const contra = q.source === 'thesis_contra'
      const rows = all<any>(`SELECT e.*, r.to_id thesis_id, r.stance, r.confidence lc, r.status lstatus, t.title thesis_title, COALESCE(d.published_at, d.first_fetched_at) _t FROM relationships r JOIN evidence e ON e.id = r.from_id
          JOIN theses t ON t.id = r.to_id JOIN documents d ON d.id = e.document_id
          WHERE r.from_type = 'evidence' AND r.to_type = 'thesis' AND r.status IN ('accepted','suggested') AND e.status = 'active' AND t.merged_into_id IS NULL AND r.updated_at >= ? AND ${HAPPENED} >= ?
          AND NOT EXISTS (SELECT 1 FROM relationships x WHERE x.from_type = 'document' AND x.from_id = e.document_id AND x.to_type = 'thesis' AND x.to_id = r.to_id AND x.status = 'rejected')`, since, happenedSince)
        .filter(r => (!contra || (r.stance === 'contra' && (r.lstatus === 'accepted' || (r.lc ?? 0) >= 0.6))) && (!ths || ths.has(r.thesis_id)) && stageOk(r) && entityOk(r))
      const seen = new Set<string>()
      // one row per fact and per deal (see dealKey) for each thesis
      return order(rows, r => r.lc ?? 0).filter(r => {
        const ks = [(r.fingerprint || r.id) + r.thesis_id, ...(dealKey(r) ? [`deal:${dealKey(r)}|${r.thesis_id}`] : [])]
        if (ks.some(k => seen.has(k))) return false
        ks.forEach(k => seen.add(k)); return true
      }).slice(0, limit)
        .map(r => ({ ...evRow(r, `${r.thesis_title}: ${r.stance === 'contra' ? 'Challenges' : 'Supports'} — ${r.claim}`), ref: { type: 'thesis', id: r.thesis_id } }))
    }
    case 'firm_investments': {
      const rows = all<any>(`SELECT e.*, f.name firm, f.id firm_id, c.name company, c.id company_id, rel.payload_json rp, COALESCE(d.published_at, d.first_fetched_at) _t FROM relationships rel JOIN relationship_evidence re ON re.relationship_id = rel.id AND re.status = 'active'
          JOIN evidence e ON e.id = re.evidence_id JOIN firms f ON f.id = rel.from_id JOIN companies c ON c.id = rel.to_id JOIN documents d ON d.id = e.document_id
          WHERE rel.from_type = 'firm' AND rel.rel = 'invested_in' AND rel.status = 'accepted' AND e.status = 'active' AND e.created_at >= ? AND ${HAPPENED} >= ?`, since, happenedSince)
        .filter(r => (!q.firms?.length || q.firms.includes(r.firm_id)) && (!q.companies?.length || q.companies.includes(r.company_id)) && stageOk(r))
      const seen = new Set<string>()
      return order(rows, r => r.confidence).filter(r => { const k = r.firm_id + r.company_id + (json<any>(r.rp, {}).round || ''); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, limit)
        .map(r => ({ ...evRow(r, `${r.firm} → ${r.company}${json<any>(r.rp, {}).round ? ' · ' + json<any>(r.rp, {}).round : ''}`), ref: { type: 'company', id: r.company_id } }))
    }
  }
}

const MAX_STORY_ROWS = 80

/** Story narrative (DEC-093): one COMPOSE_STORY call over the run's rows; each sentence must pass the grounding check
 * against the rows it cites (quote, claim text and article title — all verbatim or already grounded) or it is dropped. */
/** A story section's standout companies (its first rows' subjects) and their other stored facts — the deep dive's
 *  material (Backlog "Reports go deeper"). Facts already in the section or from the same article are left out. */
function backgroundFor(sec: RunSection, nextN: () => number): { subject: string; rows: RowOut[] }[] {
  const out: { subject: string; rows: RowOut[] }[] = []
  const inSection = new Set(sec.rows.map(r => r.evidenceId).filter(Boolean))
  const docs = new Set(sec.rows.map(r => r.documentId).filter(Boolean))
  const seen = new Set<string>()
  const maxSubjects = sec.rows.length >= 6 ? 3 : 2
  for (const r of sec.rows.slice(0, 6)) {
    if (out.length >= maxSubjects) break
    const pl = r.evidenceId ? JSON.parse(one<{ payload_json: string }>('SELECT payload_json FROM evidence WHERE id = ?', r.evidenceId)?.payload_json || '{}') : {}
    let subj: { type: string; id: string } | null = pl.subjectType === 'company' || pl.subjectType === 'firm' ? { type: pl.subjectType, id: pl.subjectId } : null
    if (!subj && r.documentId) subj = one<{ type: string; id: string }>("SELECT to_type type, to_id id FROM relationships WHERE from_type = 'document' AND from_id = ? AND rel = 'about' AND to_type IN ('company','firm') AND status = 'accepted' LIMIT 1", r.documentId) || null
    if (!subj || seen.has(subj.id)) continue
    seen.add(subj.id)
    const name = one<{ name: string }>(`SELECT name FROM ${subj.type === 'company' ? 'companies' : 'firms'} WHERE id = ? AND merged_into_id IS NULL`, subj.id)?.name
    if (!name) continue
    const facts = all<any>(`SELECT e.*, d.published_at FROM relationships x JOIN evidence e ON e.id = x.from_id JOIN documents d ON d.id = e.document_id
      WHERE x.from_type = 'evidence' AND x.rel = 'about' AND x.to_type = ? AND x.to_id = ? AND x.status = 'accepted' AND e.status = 'active' AND d.deleted_at IS NULL
      ORDER BY COALESCE(e.event_date, d.published_at, d.first_fetched_at) DESC LIMIT 30`, subj.type, subj.id)
      // context, not echoes: the row's own article's other facts (investors, product, customers, use of funds) are
      // context; another article's copy of the same deal (within a week) adds nothing and reads as "earlier" news
      .filter(e => !inSection.has(e.id))
      .filter(e => {
        if (docs.has(e.document_id)) return e.kind !== r.kind || e.claim !== r.text
        const DEAL = ['funding', 'investment', 'fund_raise', 'acquisition']
        const sameNews = e.kind === r.kind || (DEAL.includes(e.kind) && DEAL.includes(r.kind || ''))
        return !sameNews || !r.date || Math.abs((e.published_at || 0) - r.date) > 7 * 86_400_000
      }).slice(0, 6)
    if (facts.length >= 2) out.push({ subject: name, rows: facts.map(e => ({ ...evRow(e), n: nextN() })) })
  }
  return out
}

async function composeStory(name: string, sections: RunSection[], jobId: string): Promise<{ lede: Sentence[]; paragraphs: Map<string, Sentence[]>; deepDives: Map<string, { subject: string; sentences: Sentence[] }[]>; background: Map<string, RowOut[]>; dropped: number }> {
  const byN = new Map<number, RowOut>()
  for (const s of sections) for (const r of s.rows) if (r.n && r.n <= MAX_STORY_ROWS) byN.set(r.n, r)
  let n = 1000
  const bg = new Map(sections.map(s => [s.id, backgroundFor(s, () => ++n)] as const))
  for (const b of bg.values()) for (const x of b) for (const r of x.rows) byN.set(r.n!, r)
  const day = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : '')
  const input = { name, sections: sections.map(s => ({ id: s.id, title: s.title, rows: s.rows.filter(r => r.n && r.n <= MAX_STORY_ROWS).map(r => ({ n: r.n!, title: (r.title || '').slice(0, 200), text: r.text.slice(0, 300), quote: (r.quote || '').slice(0, 400), source: r.source })),
    background: (bg.get(s.id) || []).map(b => ({ subject: b.subject, facts: b.rows.map(r => ({ n: r.n!, text: r.text.slice(0, 300), quote: (r.quote || '').slice(0, 400), source: r.source, date: day(r.date) })) })) })) }
  const out = await runTask(COMPOSE_STORY, input, { jobId })
  const allowed = [name, ...sections.map(s => s.title), ...[...bg.values()].flat().map(b => b.subject)]
  let dropped = 0
  // lede and section sentences stand on the section rows (n ≤ MAX_STORY_ROWS); deep dives may also use background facts
  const keep = (ss: Sentence[], rowsOnly = false) => ss.map(x => ({ text: x.text.replace(/\s*\[\d+\]/g, '').trim(), citations: [...new Set(x.citations)].filter(k => byN.has(k) && (!rowsOnly || k <= MAX_STORY_ROWS)) })).filter(x => {
    const ok = !!x.text && x.citations.length > 0 && groundingCheck(x.text, x.citations.flatMap(k => supportsOf(byN.get(k)!)), { allowedNames: allowed, strictDates: true }).ok
    if (!ok) dropped++
    return ok
  })
  const lede = keep(out.value.lede, true).slice(0, 7)
  const paragraphs = new Map(out.value.sections.map(x => [sectionOf(sections, x.id)?.id || x.id, keep(x.sentences, true).slice(0, 5)] as const))
  const deepDives = new Map<string, { subject: string; sentences: Sentence[] }[]>()
  for (const d of out.value.deepDives) {
    const sentences = keep(d.sentences).slice(0, 4)
    if (sentences.length < 2) continue
    const sid = sectionOf(sections, d.sectionId)?.id || d.sectionId
    const list = deepDives.get(sid) || []
    if (list.length < 3) deepDives.set(sid, [...list, { subject: d.subject, sentences }])
  }
  // the background facts a deep dive cites travel with the run so its citations resolve
  const background = new Map([...bg].map(([id, b]) => [id, b.flatMap(x => x.rows).filter(r => (deepDives.get(id) || []).some(d => d.sentences.some(sn => sn.citations.includes(r.n!))))] as const))
  return { lede, paragraphs, deepDives, background, dropped }
}
/** What a story sentence citing this row may draw on. */
export const supportsOf = (r: RowOut) => [r.quote, r.text, r.title || ''].filter(Boolean)

/** `noEmail`: the run feeds a briefing, which sends one email for all its reports (DEC-091). */
export async function runReport(p: { reportId: string; trigger: 'manual' | 'schedule' | 'catchup' | 'preview'; scheduledFor?: number; late?: boolean; noEmail?: boolean }, jobId: string): Promise<{ runId?: string; sections?: number; skipped?: unknown }> {
  const r = getRow(p.reportId)
  if (!r || r.deleted_at || r.status !== 'active' || !r.definition_json) return { skipped: true }
  if ((p.trigger === 'schedule' || p.trigger === 'catchup') && !r.enabled) return { skipped: 'disabled' }
  const def = json<Def>(r.definition_json, null as any)
  const runId = newId('rr')
  const t = now()
  run("INSERT INTO report_runs(id, report_id, trigger, scheduled_for, started_at, status, late) VALUES (?, ?, ?, ?, ?, 'running', ?)", runId, r.id, p.trigger, p.scheduledFor ?? null, t, p.late ? 1 : 0)
  try {
    const sections: RunSection[] = []
    let n = 0
    const ai = readAuth().status === 'ok'
    for (const s of def.sections) {
      const rows = resolveSection(s.query, s.limit, r.last_run_at).map(x => ({ n: ++n, ...x }))
      const style = s.style || def.style || 'digest'
      let bullets: RunSection['bullets']
      if (style === 'digest' && s.presentation === 'summary' && rows.length && ai) {
        try {
          const numbered = rows.map(x => ({ n: x.n, text: x.text, quote: x.quote, source: x.source }))
          const c = await runTask(COMPOSE, { title: s.title, rows: numbered }, { jobId })
          bullets = c.value.bullets.filter(b => groundingCheck(b.text, b.citations.map(k => numbered.find(x => x.n === k)?.quote).filter(Boolean) as string[], { strictDates: true }).ok)
        } catch { bullets = undefined }
      }
      sections.push({ id: s.id, title: s.title, ...(s.style ? { style: s.style } : {}), rows, ...(bullets?.length ? { bullets } : {}) })
    }
    const content: RunContent = { name: def.name, at: t, style: def.style || 'digest', sections }
    // the narrative: only for story layouts with rows to tell; a model failure leaves the run without prose (cards and
    // charts still render) rather than failing it
    const storySections = sections.filter(s => (s.style || content.style) === 'story' && s.rows.length)
    // a preview shows at once — rows, cards, charts — and the written story fills in when the model returns
    if (p.trigger === 'preview' && storySections.length && ai) {
      run("UPDATE report_runs SET status = 'succeeded', finished_at = ?, content_json = ?, markdown = ?, html = ? WHERE id = ?", now(), JSON.stringify(content), renderMarkdown(content), renderHtml(content), runId)
      emit('report.ready', { reportId: r.id, runId })
    }
    if (storySections.length && ai) {
      try {
        const st = await composeStory(def.name, sections, jobId)
        if (content.style === 'story' && st.lede.length) content.lede = st.lede
        for (const s of storySections) {
          const para = st.paragraphs.get(s.id); if (para?.length) s.paragraph = para
          const dd = st.deepDives.get(s.id); if (dd?.length) { s.deepDives = dd; s.background = st.background.get(s.id) || [] }
        }
        ;(content as any).groundingDropped = st.dropped
      } catch { /* run without prose */ }
    }
    const md = renderMarkdown(content)
    const html = renderHtml(content)
    tx(() => {
      run("UPDATE report_runs SET status = 'succeeded', finished_at = ?, content_json = ?, markdown = ?, html = ? WHERE id = ?", now(), JSON.stringify(content), md, html, runId)
      if (p.trigger !== 'preview') run('UPDATE reports SET last_run_at = ?, updated_at = ? WHERE id = ?', t, now(), r.id)
    })
    // only briefings send email (DEC-100): a report run is read in the app; its briefing (if any) mails it
    emit('report.ready', { reportId: r.id, runId, toast: p.trigger === 'manual' ? `${def.name} is ready` : undefined })
    return { runId, sections: sections.length }
  } catch (e) {
    run("UPDATE report_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?", now(), String((e as Error).message), runId)
    throw e
  }
}

export function runNow(id: string): { jobId: string } {
  const r = getRow(id)
  if (!r || r.deleted_at || r.status !== 'active') throw new AppError('VALIDATION', 'This report isn’t set up yet')
  return { jobId: enqueue('RUN_REPORT', { reportId: id, trigger: 'manual' }, { priority: 1 }) }
}

/** Marks rows whose document was purged ("Source removed"); the stored snapshot itself is never rewritten. */
function withRemoved(content: any): any {
  if (!content?.sections) return content
  const live = (id: string | null) => !id || !!one('SELECT 1 FROM documents WHERE id = ? AND deleted_at IS NULL', id)
  return { ...content, sections: content.sections.map((s: any) => ({ ...s, rows: (s.rows || []).map((r: any) => (live(r.documentId) ? r : { ...r, removed: true })) })) }
}
/** `view`: the in-app view of the run — the same renderer as the email, over the snapshot with purged sources marked. */
const runDTO = (x: any, withView = false): ReportRunDTO => {
  const content = withRemoved(json(x.content_json, null))
  return { id: x.id, reportId: x.report_id, trigger: x.trigger, startedAt: x.started_at, finishedAt: x.finished_at, status: x.status, late: !!x.late, content, deliveredEmailAt: x.delivered_email_at, deliveryError: x.delivery_error, error: x.error,
    ...(withView && content?.sections ? { view: renderHtml(content, { embed: true }) } : {}) }
}
export const runs = (id: string) => all<any>("SELECT * FROM report_runs WHERE report_id = ? AND trigger <> 'preview' ORDER BY started_at DESC LIMIT 50", id).map(x => runDTO(x))
export const getRun = (runId: string) => { const x = one<any>('SELECT * FROM report_runs WHERE id = ?', runId); if (!x) throw new AppError('NOT_FOUND', 'Run not found'); return { ...runDTO(x, true), markdown: x.markdown, html: x.html } }
export function preview(id: string): ReportRunDTO | null {
  const x = one<any>("SELECT * FROM report_runs WHERE report_id = ? AND status = 'succeeded' ORDER BY started_at DESC LIMIT 1", id)
  const r = getRow(id)
  if (r && r.status === 'active' && (!x || now() - x.started_at > 10 * 60_000)) enqueue('RUN_REPORT', { reportId: id, trigger: 'preview' }, { idempotencyKey: `report:${id}:preview`, priority: 2 })
  return x ? runDTO(x, true) : null
}

export function registerReports(): void {
  seedTemplates()
  migrateEmailingReports()
  registerJob('COMPILE_REPORT', job => compile(job.payload as any, job.id))
  registerJob('RUN_REPORT', job => runReport(job.payload as any, job.id))
  onJobFailure((job, code, message, final) => {
    if (job.type !== 'COMPILE_REPORT') return
    const id = job.payload.reportId
    const r = getRow(id)
    if (!r) return
    if (job.payload.mode === 'refine') run('UPDATE reports SET last_error = ? WHERE id = ?', 'Couldn’t apply · Retry', id)
    else if (final) run("UPDATE reports SET status = 'failed', last_error = ? WHERE id = ?", message.slice(0, 300), id)
    emit('report.ready', { reportId: id })
  })
  onSchedule('report', (sc, info) => {
    enqueue('RUN_REPORT', { reportId: sc.target_id, trigger: info.trigger, scheduledFor: info.scheduledFor, late: info.late }, { idempotencyKey: `report:${sc.target_id}:${info.scheduledFor}`, priority: 2 })
  })
}
