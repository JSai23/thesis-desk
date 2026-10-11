// Alerts (RFC FLOW-H, §1B.18, DEC-036): the request is saved as a draft rule before any model call; COMPILE_ALERT
// compiles it to structured filters (+ optional semantic condition) with a deterministic summary and a 30-day backtest.
// EVALUATE_ALERTS runs after every PROCESS_DOCUMENT: structured match → optional EVALUATE_ALERT → one notification per
// (rule, evidence), with per-rule cooldown and a global email cap of 3/day.
import { Notification } from 'electron'
import { all, one, run, tx, json } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { log } from '../log'
import { TEST_MODE } from '../env'
import { getSetting, setSetting } from '../settings'
import { writeHistory } from '../history'
import { enqueue, registerJob, onJobFailure } from '../jobs'
import { runTask } from '../ai/runtime'
import { readAuth } from '../ai/codex-auth'
import { CREATE_ALERT, EVALUATE_ALERT, type ModelAlert } from '../ai/tasks/alerts'
import { AlertRule } from '../../shared/schemas/alert-rule'
import { STAGE_ENUM } from '../../shared/schemas/report-def'
import { descendants } from '../theses'
import { upsertFeedItem } from '../feed'
import { account } from '../mail'
import { entityCatalog } from '../reports/catalog'
import { showMainWindow } from '../window'
import type { AlertDTO } from '../../shared/dto'
import { Handles } from '../ai/handles'

const DAY = 86400_000
const EMAIL_CAP = 3
type Ent = 'company' | 'firm' | 'person'
const TABLE: Record<Ent, string> = { company: 'companies', firm: 'firms', person: 'people' }

interface Row { id: string; text: string; name: string; status: string; rule_json: string | null; summary: string | null; backtest_count: number | null; last_error: string | null; channels_json: string; enabled: number; cooldown_minutes: number; anchor_type: string | null; anchor_id: string | null; last_triggered_at: number | null; created_at: number; deleted_at: number | null }
const getRow = (id: string) => one<Row>('SELECT * FROM alert_rules WHERE id = ?', id)

/** Follows merged_into_id so rules keep matching after an entity merge. */
function canon(type: Ent | 'thesis', id: string): string {
  const tbl = type === 'thesis' ? 'theses' : TABLE[type]
  let cur = id
  for (let i = 0; i < 6; i++) { const r = one<{ merged_into_id: string | null }>(`SELECT merged_into_id FROM ${tbl} WHERE id = ?`, cur); if (!r?.merged_into_id) return cur; cur = r.merged_into_id }
  return cur
}
const nameOf = (type: Ent | 'thesis', id: string) => type === 'thesis' ? one<{ title: string }>('SELECT title FROM theses WHERE id = ?', id)?.title : one<{ name: string }>(`SELECT name FROM ${TABLE[type]} WHERE id = ?`, id)?.name

// ---------------------------------------------------------------- DTO + seeds
export function toDTO(r: Row): AlertDTO {
  return { id: r.id, name: r.name, text: r.text, status: r.status as any, summary: r.summary, backtestCount: r.backtest_count, lastError: r.last_error, channels: json<string[]>(r.channels_json, ['in_app']), enabled: !!r.enabled, anchorType: r.anchor_type, anchorId: r.anchor_id, lastTriggeredAt: r.last_triggered_at }
}
export const listAlerts = () => all<Row>('SELECT * FROM alert_rules WHERE deleted_at IS NULL ORDER BY created_at DESC').map(toDTO)

export function seedAlerts(): void {
  if (getSetting('alerts.seeded')) return
  const t = now()
  const ins = (name: string, rule: AlertRule) => run("INSERT INTO alert_rules(id, text, name, status, rule_json, summary, channels_json, enabled, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, '[\"in_app\"]', 0, ?, ?)", newId('al'), name, name, JSON.stringify(rule), summarize(rule), t, t)
  tx(() => {
    ins('A company I follow announces a round', { version: 1, event: 'evidence_created', filters: { kinds: ['funding'], scope: 'followed_companies', novelOnly: true } })
    ins('New evidence challenges a pinned thesis', { version: 1, event: 'evidence_created', filters: { scope: 'pinned_theses', stance: 'contra', novelOnly: true } })
    const firms = ['Benchmark', 'Sequoia'].map(n => one<{ id: string }>("SELECT id FROM firms WHERE merged_into_id IS NULL AND deleted_at IS NULL AND (name = ? OR name LIKE ?)", n, n + ' %')?.id).filter(Boolean) as string[]
    if (firms.length === 2) ins('Benchmark or Sequoia leads a new round', { version: 1, event: 'evidence_created', filters: { kinds: ['funding', 'investment'], investorFirms: firms, investorRole: 'lead', novelOnly: true } })
    setSetting('alerts.seeded', true)
  })
}

// ---------------------------------------------------------------- compile
export function summarize(rule: AlertRule): string {
  const f = rule.filters
  const names = (type: Ent | 'thesis', ids?: string[]) => (ids || []).map(id => nameOf(type, canon(type, id)) || 'removed').join(' or ')
  const parts: string[] = []
  parts.push(f.kinds?.length ? `${f.kinds.map(k => k.replace(/_/g, ' ')).join('/')} evidence` : 'any evidence')
  if (f.investorFirms?.length) parts.push(`${names('firm', f.investorFirms)} ${f.investorRole === 'lead' ? 'leads' : 'invests'}`)
  if (f.companies?.length) parts.push(`company ${names('company', f.companies)}`)
  if (f.firms?.length) parts.push(`firm ${names('firm', f.firms)}`)
  if (f.people?.length) parts.push(`person ${names('person', f.people)}`)
  if (f.scope) parts.push({ followed_companies: 'companies you follow', pinned_theses: 'pinned theses', watched_theses: 'watched theses' }[f.scope])
  if (f.theses?.length) parts.push(`thesis ${names('thesis', f.theses)}`)
  if (f.stance && f.stance !== 'any') parts.push(f.stance === 'contra' ? 'challenges' : 'supports')
  parts.push(f.stages?.length ? f.stages.join('/') : 'any stage')
  if (rule.semanticCondition) parts.push(`AI check: ${rule.semanticCondition}`)
  return 'Matches: ' + parts.join(' · ')
}

export function toRule(m: ModelAlert): AlertRule {
  const f = m.filters
  const filters: Record<string, unknown> = { novelOnly: f.novelOnly }
  for (const [k, v] of Object.entries(f)) if (k !== 'novelOnly' && v !== null && !(Array.isArray(v) && !v.length)) filters[k] = v
  if (filters.investorFirms && !filters.investorRole) filters.investorRole = 'any'
  return AlertRule.parse({ version: 1, event: 'evidence_created', filters, ...(m.semanticCondition?.trim() ? { semanticCondition: m.semanticCondition.trim() } : {}) })
}

function catalogs(text: string) {
  return { companies: entityCatalog('company', text, 200), firms: entityCatalog('firm', text, 200), people: entityCatalog('person', text, 150), theses: all<{ id: string; title: string }>('SELECT id, title FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL') }
}

/** Inserts a draft rule (no model call). Used by alert.compile and by report requests routed to alerts. */
export function compileAlertDraft(text: string, anchor: { type: string; id: string } | null): string {
  const id = newId('al')
  const t = now()
  run("INSERT INTO alert_rules(id, text, name, status, channels_json, enabled, anchor_type, anchor_id, created_at, updated_at) VALUES (?, ?, ?, 'draft', '[\"in_app\"]', 1, ?, ?, ?, ?)", id, text.trim(), text.trim().slice(0, 60), anchor?.type ?? null, anchor?.id ?? null, t, t)
  writeHistory('alert', id, 'alert.requested', null, { text })
  enqueue('COMPILE_ALERT', { alertId: id }, { idempotencyKey: `compile_alert:${id}`, priority: 1, maxAttempts: 2 })
  return id
}

export function compileAlert(text: string, anchor?: { type: string; id: string }): { alertId: string; status: 'draft' } {
  if (!text.trim()) throw new AppError('VALIDATION', 'Describe what you want to be told about.')
  const id = tx(() => compileAlertDraft(text, anchor || null))
  emit('report.ready', { alertId: id })
  return { alertId: id, status: 'draft' }
}

async function compileJob(p: { alertId: string }, jobId: string): Promise<unknown> {
  const r = getRow(p.alertId)
  if (!r || r.deleted_at) return { skipped: true }
  if (readAuth().status !== 'ok') throw new AppError('AI_UNAVAILABLE', 'No ChatGPT sign-in found')
  const raw = catalogs(r.text)
  const h = new Handles() // the model sees C1/F2/P3/T4, never ULIDs (MEM-053)
  const cat = { companies: h.label('C', raw.companies), firms: h.label('F', raw.firms), people: h.label('P', raw.people), theses: h.label('T', raw.theses) }
  const ids = { company: new Set(cat.companies.map(x => x.id)), firm: new Set(cat.firms.map(x => x.id)), person: new Set(cat.people.map(x => x.id)), thesis: new Set(cat.theses.map(x => x.id)) }
  const anchor = r.anchor_type && r.anchor_id ? { type: r.anchor_type, id: h.out(r.anchor_id), name: nameOf(r.anchor_type as any, r.anchor_id) || '' } : null
  const validate = (m: ModelAlert): string[] => {
    if (m.clarification?.trim()) return []
    const p: string[] = []
    const f = m.filters
    if (!m.semanticCondition?.trim() && !Object.entries(f).some(([k, v]) => k !== 'novelOnly' && k !== 'investorRole' && k !== 'minLinkConfidence' && v !== null && !(Array.isArray(v) && !v.length) && v !== 'any'))
      p.push('the rule has no filter and no semanticCondition, so it would fire on every new fact: constrain it or set clarification')
    if (f.investorRole && !f.investorFirms?.length) p.push('investorRole needs investorFirms (ids from the Firms list); if the firm is not listed, set clarification')
    try { toRule(m) } catch (e: any) { p.push(...(e.issues || [{ path: [], message: String(e.message) }]).slice(0, 6).map((i: any) => `${(i.path || []).join('.')}: ${i.message}`)) }
    const chk = (k: string, set: Set<string>, v: string[] | null) => { for (const x of v || []) if (!set.has(x)) p.push(`${k}: unknown id ${x}`) }
    chk('companies', ids.company, m.filters.companies); chk('firms', ids.firm, m.filters.firms); chk('people', ids.person, m.filters.people)
    chk('investorFirms', ids.firm, m.filters.investorFirms); chk('theses', ids.thesis, m.filters.theses)
    return p
  }
  const res = await runTask(CREATE_ALERT, { text: r.text, anchor, ...cat, validate }, { jobId })
  const f = res.value.filters
  const out = { ...res, value: { ...res.value, filters: { ...f, companies: h.backAll(f.companies), firms: h.backAll(f.firms), people: h.backAll(f.people), investorFirms: h.backAll(f.investorFirms), theses: h.backAll(f.theses) } } }
  if (out.value.clarification?.trim()) {
    // can't be compiled faithfully: tell the user (an edited, already-active rule keeps its previous rule)
    run("UPDATE alert_rules SET status = CASE WHEN rule_json IS NULL THEN 'failed' ELSE status END, last_error = ?, updated_at = ? WHERE id = ?", out.value.clarification.trim().slice(0, 300), now(), r.id)
    writeHistory('alert', r.id, 'alert.needs_clarification', null, { clarification: out.value.clarification }, 'ai')
    emit('report.ready', { alertId: r.id })
    return { clarify: out.value.clarification }
  }
  const rule = toRule(out.value)
  const count = backtest(rule)
  tx(() => {
    run("UPDATE alert_rules SET status = CASE WHEN status = 'active' THEN 'active' ELSE 'compiled' END, name = ?, rule_json = ?, summary = ?, backtest_count = ?, last_error = NULL, updated_at = ? WHERE id = ?", out.value.name.slice(0, 80) || r.name, JSON.stringify(rule), summarize(rule), count, now(), r.id)
    writeHistory('alert', r.id, 'alert.compiled', r.rule_json ? { rule_json: r.rule_json } : null, { rule_json: JSON.stringify(rule) }, 'ai')
  })
  emit('report.ready', { alertId: r.id })
  return { compiled: true, backtest: count }
}

export function retry(id: string): void {
  const r = getRow(id)
  if (!r || r.deleted_at) throw new AppError('NOT_FOUND', 'Alert not found')
  run("UPDATE alert_rules SET last_error = NULL, status = CASE WHEN status = 'failed' THEN 'draft' ELSE status END, updated_at = ? WHERE id = ?", now(), id)
  enqueue('COMPILE_ALERT', { alertId: id }, { idempotencyKey: `compile_alert:${id}`, priority: 1, maxAttempts: 2 })
  emit('report.ready', { alertId: id })
}
export function activate(id: string, channels: ('in_app' | 'email')[]): AlertDTO {
  const r = getRow(id)
  if (!r || r.deleted_at || !r.rule_json) throw new AppError('VALIDATION', 'This alert isn’t set up yet')
  tx(() => {
    run("UPDATE alert_rules SET status = 'active', enabled = 1, channels_json = ?, updated_at = ? WHERE id = ?", JSON.stringify(channels.includes('in_app') ? channels : ['in_app', ...channels]), now(), id)
    writeHistory('alert', id, 'alert.activated', { status: r.status }, { status: 'active', channels })
  })
  emit('report.ready', { alertId: id })
  return toDTO(getRow(id)!)
}
export function update(id: string, text: string): void {
  const r = getRow(id); if (!r || r.deleted_at) throw new AppError('NOT_FOUND', 'Alert not found')
  if (!text.trim()) throw new AppError('VALIDATION', 'Describe what you want to be told about.')
  tx(() => {
    run('UPDATE alert_rules SET text = ?, last_error = NULL, updated_at = ? WHERE id = ?', text.trim(), now(), id)
    writeHistory('alert', id, 'alert.edited', { text: r.text }, { text })
  })
  enqueue('COMPILE_ALERT', { alertId: id }, { idempotencyKey: `compile_alert:${id}`, priority: 1, maxAttempts: 2 })
  emit('report.ready', { alertId: id })
}
export function setEnabled(id: string, enabled: boolean): void {
  tx(() => { run('UPDATE alert_rules SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, now(), id); writeHistory('alert', id, enabled ? 'alert.enabled' : 'alert.disabled', null, null) })
  emit('report.ready', { alertId: id })
}
/** Test hook (RW_TEST_MODE): per-rule cooldown; the product keeps the 6 h default (§1B.18). */
export function setCooldown(id: string, minutes: number): void { run('UPDATE alert_rules SET cooldown_minutes = ? WHERE id = ?', minutes, id) }

export function remove(id: string): void {
  tx(() => { run('UPDATE alert_rules SET deleted_at = ?, updated_at = ? WHERE id = ?', now(), now(), id); writeHistory('alert', id, 'alert.deleted', null, null) })
  emit('report.ready', { alertId: id })
}
export function restore(id: string): void {
  run('UPDATE alert_rules SET deleted_at = NULL, updated_at = ? WHERE id = ?', now(), id)
  emit('report.ready', { alertId: id })
}

// ---------------------------------------------------------------- matching
interface Ev { id: string; document_id: string; kind: string; claim: string; quote: string; payload_json: string; is_novel: number; created_at: number }
const stageRank = (s: string) => (STAGE_ENUM as readonly string[]).indexOf(s)

function thesisLinks(e: Ev, minConf: number): { thesisId: string; stance: string; status: string }[] {
  return all<{ to_id: string; stance: string; status: string; confidence: number | null }>(`SELECT r.to_id, r.stance, r.status, r.confidence FROM relationships r WHERE r.from_type = 'evidence' AND r.from_id = ? AND r.to_type = 'thesis' AND r.status IN ('accepted','suggested')
     AND NOT EXISTS (SELECT 1 FROM relationships x WHERE x.from_type = 'document' AND x.from_id = ? AND x.to_type = 'thesis' AND x.to_id = r.to_id AND x.status = 'rejected')`, e.id, e.document_id)
    .filter(l => l.status === 'accepted' || (l.confidence ?? 0) >= minConf).map(l => ({ thesisId: canon('thesis', l.to_id), stance: l.stance, status: l.status }))
}

/** Structured filter match (no model). Returns the matching thesis links when thesis filters apply. */
export function structuredMatch(rule: AlertRule, e: Ev): boolean {
  const f = rule.filters
  if (f.novelOnly && !e.is_novel) return false
  if (f.kinds?.length && !f.kinds.includes(e.kind as any)) return false
  const pl = json<any>(e.payload_json, {})
  const ent = (type: Ent): string[] => {
    const raw = [pl.subjectType === type ? pl.subjectId : null, type === 'company' ? pl.companyId : null, type === 'firm' ? pl.firmId : null, type === 'person' ? pl.personId : null,
      ...(type === 'firm' ? [...(pl.leadInvestorIds || []), ...(pl.participantIds || [])] : [])].filter(Boolean) as string[]
    return [...new Set(raw.map(id => canon(type, id)))]
  }
  const anyIn = (have: string[], want: string[] | undefined, type: Ent) => !want?.length || want.map(w => canon(type, w)).some(w => have.includes(w))
  // companies/firms/people: the evidence must be about one of them (investor lists only count for investorFirms)
  const subjectFirms = [pl.subjectType === 'firm' ? pl.subjectId : null, pl.firmId].filter(Boolean).map((id: string) => canon('firm', id))
  if (!anyIn(ent('company'), f.companies, 'company')) return false
  if (f.firms?.length && !anyIn(subjectFirms, f.firms, 'firm')) return false
  if (!anyIn(ent('person'), f.people, 'person')) return false
  if (f.investorFirms?.length) {
    const want = f.investorFirms.map(x => canon('firm', x))
    const leads: string[] = [...(pl.leadInvestorIds || [])].map((x: string) => canon('firm', x))
    const parts: string[] = [...(pl.participantIds || [])].map((x: string) => canon('firm', x))
    if (e.kind === 'investment' && pl.firmId) (pl.role === 'lead' ? leads : parts).push(canon('firm', pl.firmId))
    const pool = f.investorRole === 'lead' ? leads : [...leads, ...parts]
    if (!want.some(w => pool.includes(w))) return false
  }
  if (f.scope === 'followed_companies') {
    const fol = new Set(all<{ id: string }>('SELECT id FROM companies WHERE followed = 1 AND merged_into_id IS NULL').map(x => x.id))
    if (!ent('company').some(c => fol.has(c))) return false
  }
  const needLinks = f.scope === 'pinned_theses' || f.scope === 'watched_theses' || !!f.theses?.length || (f.stance && f.stance !== 'any')
  if (needLinks) {
    let links = thesisLinks(e, f.minLinkConfidence ?? 0.6)
    if (f.stance && f.stance !== 'any') links = links.filter(l => l.stance === f.stance)
    if (f.theses?.length) { const set = new Set(f.theses.flatMap(t => descendants(canon('thesis', t)))); links = links.filter(l => set.has(l.thesisId)) }
    if (f.scope === 'pinned_theses') { const pins = new Set((getSetting<string[]>('pins.theses') || []).flatMap(t => descendants(t))); links = links.filter(l => pins.has(l.thesisId)) }
    if (f.scope === 'watched_theses') { const w = new Set(all<{ id: string }>('SELECT id FROM theses WHERE watching = 1 AND archived_at IS NULL').map(x => x.id)); links = links.filter(l => w.has(l.thesisId)) }
    if (!links.length) return false
  }
  if (f.stages?.length) {
    const round = String(pl.round || '')
    const coId = pl.companyId || (pl.subjectType === 'company' ? pl.subjectId : null)
    const stage = (STAGE_ENUM as readonly string[]).find(s => s.toLowerCase() === round.toLowerCase())
      || (coId ? one<{ display: string }>("SELECT display FROM field_values WHERE object_type = 'company' AND object_id = ? AND field_key = 'stage' AND status = 'current'", canon('company', coId))?.display : null)
    if (!stage || !f.stages.includes(stage as any)) return false
  }
  return true
}

export function backtest(rule: AlertRule): number {
  const evs = all<Ev>(`SELECT e.* FROM evidence e JOIN documents d ON d.id = e.document_id WHERE e.status = 'active' AND d.deleted_at IS NULL AND COALESCE(d.published_at, e.created_at) >= ?`, now() - 30 * DAY)
  const seen = new Set<string>()
  let n = 0
  for (const e of evs) {
    if (!structuredMatch(rule, e)) continue
    const k = (e as any).fingerprint || e.id
    if (seen.has(k)) continue
    seen.add(k); n++
  }
  return n
}

function startOfLocalDay(t: number): number { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

async function evaluateDocument(p: { documentId: string }, jobId: string): Promise<unknown> {
  const rules = all<Row>("SELECT * FROM alert_rules WHERE status = 'active' AND enabled = 1 AND deleted_at IS NULL AND rule_json IS NOT NULL")
  if (!rules.length) return { rules: 0 }
  const evs = all<Ev>("SELECT * FROM evidence WHERE document_id = ? AND status = 'active' ORDER BY quote_start", p.documentId)
  let created = 0
  for (const r of rules) {
    const rule = json<AlertRule | null>(r.rule_json, null)
    if (!rule) continue
    for (const e of evs) {
      if (e.created_at < r.created_at) continue                       // rules fire only on evidence created after they exist
      if (one('SELECT 1 FROM notifications WHERE alert_rule_id = ? AND evidence_id = ?', r.id, e.id)) continue
      if (!structuredMatch(rule, e)) continue
      if (rule.semanticCondition) {
        if (readAuth().status !== 'ok') throw new AppError('AI_UNAVAILABLE', 'No ChatGPT sign-in found')
        const theses = thesisLinks(e, rule.filters.minLinkConfidence ?? 0.6).map(l => `${nameOf('thesis', l.thesisId)} (${l.stance === 'contra' ? 'challenges' : 'supports'}${l.status === 'suggested' ? ', may' : ''})`)
        const v = await runTask(EVALUATE_ALERT, { request: r.text, condition: rule.semanticCondition, claim: e.claim, quote: e.quote, source: one<{ title: string }>('SELECT title FROM documents WHERE id = ?', e.document_id)?.title || '', theses }, { jobId })
        if (!v.value.matches) continue
      }
      if (deliver(r, e)) created++
    }
  }
  return { notifications: created }
}

/** Inserts the (rule, evidence) notification and delivers it subject to cooldown and the email cap. */
function deliver(r: Row, e: Ev): boolean {
  const t = now()
  const fresh = getRow(r.id)!
  const channels = json<string[]>(fresh.channels_json, ['in_app'])
  const cooling = fresh.last_triggered_at != null && t - fresh.last_triggered_at < fresh.cooldown_minutes * 60_000
  const wantEmail = channels.includes('email') && !!account() && getSetting('notify.email') !== false
  const emailsToday = one<{ n: number }>(`SELECT COUNT(*) n FROM notifications WHERE suppressed_reason IS NULL AND created_at >= ? AND channels_json LIKE '%email%'`, startOfLocalDay(t))!.n
  const suppressed = cooling ? 'cooldown' : wantEmail && emailsToday >= EMAIL_CAP ? 'daily_cap' : null
  const sendEmail = wantEmail && !suppressed
  const item = one<{ id: string; headline: string; why_it_matters: string }>('SELECT id, headline, why_it_matters FROM feed_items WHERE document_id = ?', e.document_id)
  const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] || s).trim()
  const title = fresh.name
  const body = [item?.headline || e.claim, item?.why_it_matters ? firstSentence(item.why_it_matters) : ''].filter(Boolean).join(' — ')
  const nid = newId('nt')
  const inserted = tx(() => {
    const res = run(`INSERT OR IGNORE INTO notifications(id, alert_rule_id, evidence_id, document_id, title, body, channels_json, suppressed_reason, delivered_in_app_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, nid, r.id, e.id, e.document_id, title, body, JSON.stringify(sendEmail ? channels : channels.filter(c => c !== 'email')), suppressed, suppressed === 'cooldown' ? null : t, t)
    if (!res.changes) return false
    if (suppressed !== 'cooldown') {
      run('UPDATE alert_rules SET last_triggered_at = ? WHERE id = ?', t, r.id)
      upsertFeedItem(e.document_id, { alertRuleId: r.id, alertName: r.name })
    }
    return true
  })
  if (!inserted) return false
  if (suppressed === 'cooldown') { log.info('alerts', 'notification suppressed by cooldown', { ruleId: r.id, evidenceId: e.id }); return true }
  if (sendEmail) enqueue('SEND_EMAIL', { kind: 'notification', notificationId: nid }, { idempotencyKey: `email:${nid}`, priority: 2 })
  emit('feed.updated', { documentId: e.document_id })
  const itemId = item?.id || one<{ id: string }>('SELECT id FROM feed_items WHERE document_id = ?', e.document_id)?.id || null
  emit('notification.triggered', { notificationId: nid, ruleId: r.id, itemId, title, body })
  showOsNotification(title, body, itemId)
  return true
}

function showOsNotification(title: string, body: string, itemId: string | null): void {
  if (getSetting('notify.in_app') === false) return
  if (TEST_MODE) { setSetting('test.os_notifications', Number(getSetting('test.os_notifications') || 0) + 1); return }
  try {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body: body.slice(0, 240), silent: false })
    n.on('click', () => {
      showMainWindow()
      if (itemId) emit('app.deeplink', { select: { kind: 'item', id: itemId } })
    })
    n.show()
  } catch (e) { log.warn('alerts', 'OS notification failed', { err: String(e) }) }
}

export function registerAlerts(): void {
  seedAlerts()
  registerJob('COMPILE_ALERT', job => compileJob(job.payload as any, job.id))
  registerJob('EVALUATE_ALERTS', job => evaluateDocument(job.payload as any, job.id))
  onJobFailure((job, _code, message, final) => {
    if (job.type !== 'COMPILE_ALERT') return
    const r = getRow(job.payload.alertId)
    if (!r) return
    if (final) run("UPDATE alert_rules SET status = CASE WHEN rule_json IS NULL THEN 'failed' ELSE status END, last_error = ? WHERE id = ?", message.slice(0, 300), r.id)
    emit('report.ready', { alertId: r.id })
  })
}
