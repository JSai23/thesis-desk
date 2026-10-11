// "Check for updates" (RFC P-OBJECT-004, DEC-047): retrieval only — sync the sources that cover the entity plus
// sources that produced documents mentioning it in the last 90 days; never answer from model memory. If no source
// covers it, offer to add its website. Also SUMMARIZE_OBJECT (cached, regenerable interpretation).
import { getDetails } from './details'
import fs from 'node:fs'
import path from 'node:path'
import { all, one, json } from '../db'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { enqueue, registerJob } from '../jobs'
import { registerMaintenance } from '../maintenance'
import { registrableDomain } from '../ingest/url'
import { DATA_DIR } from '../env'
import { runTask } from '../ai/runtime'
import { readAuth } from '../ai/codex-auth'
import { SUMMARIZE } from '../ai/tasks/think'
import { groundingCheck, sentences } from '../ai/grounding'
import { startHydrate } from './hydrate'

const DAY = 86400_000

function entity(type: 'company' | 'firm', id: string) {
  const e = one<{ id: string; name: string; domain: string | null }>(`SELECT id, name, domain FROM ${type === 'company' ? 'companies' : 'firms'} WHERE id = ? AND merged_into_id IS NULL`, id)
  if (!e) throw new AppError('NOT_FOUND', 'Not found')
  const site = one<{ value_json: string }>("SELECT value_json FROM field_values WHERE object_type = ? AND object_id = ? AND field_key = 'website' AND status = 'current'", type, id)
  return { ...e, website: site ? String(JSON.parse(site.value_json)) : null }
}

export function refreshObject(type: 'company' | 'firm' | 'thesis', id: string): { jobId: string | null; sources: number; message: string; offerAddWebsite?: string } {
  if (type === 'thesis') throw new AppError('VALIDATION', 'Theses update from your sources automatically')
  const e = entity(type, id)
  const domains = [e.domain, e.website ? registrableDomain(e.website) : null].filter(Boolean) as string[]
  const covering = all<{ id: string; name: string; site_domain: string }>("SELECT id, name, site_domain FROM sources WHERE deleted_at IS NULL AND kind <> 'manual' AND site_domain IS NOT NULL").filter(s => domains.includes(s.site_domain))
  const mentioning = all<{ id: string; name: string }>(`SELECT DISTINCT s.id, s.name FROM relationships r JOIN documents d ON d.id = r.from_id JOIN document_sources ds ON ds.document_id = d.id JOIN sources s ON s.id = ds.source_id
     WHERE r.from_type = 'document' AND r.to_type = ? AND r.to_id = ? AND r.status = 'accepted' AND s.deleted_at IS NULL AND s.kind <> 'manual' AND d.first_fetched_at >= ?`, type, id, now() - 90 * DAY)
  const ids = [...new Set([...covering, ...mentioning].map(s => s.id))]
  // nothing covers it yet: look for it (your library, then the news and its own site) instead of giving up (DEC-088)
  if (!ids.length) return { jobId: startHydrate(type, id, { once: !one<{ followed: number }>(`SELECT followed FROM ${type === 'company' ? 'companies' : 'firms'} WHERE id = ?`, id)?.followed }), sources: 0, message: `Looking for ${e.name} in your library and the news…` }
  const fetchIds = ids.map(sid => enqueue('FETCH_SOURCE', { sourceId: sid, trigger: 'refresh' }, { idempotencyKey: `fetch:${sid}`, priority: 1 }))
  const jobId = enqueue('REFRESH_OBJECT', { type, id, fetchJobIds: fetchIds, since: now() }, { idempotencyKey: `refresh:${id}`, priority: 2 })
  return { jobId, sources: ids.length, message: `Checking ${ids.length} source${ids.length === 1 ? '' : 's'} for ${e.name} on this Mac…` }
}

async function refreshJob(p: { type: 'company' | 'firm'; id: string; fetchJobIds: string[]; since: number }): Promise<unknown> {
  const e = entity(p.type, p.id)
  const deadline = Date.now() + 10 * 60_000
  for (;;) {
    const pending = p.fetchJobIds.filter(j => { const r = one<{ status: string }>('SELECT status FROM jobs WHERE id = ?', j); return r && (r.status === 'queued' || r.status === 'running') })
    if (!pending.length || Date.now() > deadline) break
    await new Promise(r => setTimeout(r, 500))
  }
  const results = p.fetchJobIds.map(j => json<any>(one<{ result_json: string | null }>('SELECT result_json FROM jobs WHERE id = ?', j)?.result_json, {}))
  const created = results.reduce((n, r) => n + (r.new || 0), 0), updated = results.reduce((n, r) => n + (r.updated || 0), 0)
  const last = one<{ t: number }>(`SELECT MAX(COALESCE(d.published_at, d.first_fetched_at)) t FROM relationships r JOIN documents d ON d.id = r.from_id WHERE r.from_type = 'document' AND r.to_type = ? AND r.to_id = ? AND r.status = 'accepted'`, p.type, p.id)?.t
  const toast = created || updated ? `${e.name}: ${created} new · ${updated} updated` : `Nothing new for ${e.name}${last ? ' since ' + new Date(last).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}. Still watching.`
  emit('source.syncCompleted', { objectId: p.id, toast })
  return { new: created, updated, toast }
}

// ---------------------------------------------------------------- SUMMARIZE_OBJECT
const summaryFile = (type: string, id: string) => path.join(DATA_DIR, 'cache', 'summaries', `${type}_${id}.json`)

export function cachedSummary(type: string, id: string): { text: string; citations: string[]; at: number; yours?: string[] } | null {
  try { return JSON.parse(fs.readFileSync(summaryFile(type, id), 'utf8')) } catch { return null }
}

async function summarize(type: 'company' | 'firm' | 'thesis', id: string, jobId?: string): Promise<unknown> {
  if (readAuth().status !== 'ok') throw new AppError('AI_UNAVAILABLE', 'No ChatGPT sign-in found')
  const ev = type === 'thesis'
    ? all<any>(`SELECT e.id, e.claim, e.quote FROM relationships r JOIN evidence e ON e.id = r.from_id WHERE r.from_type = 'evidence' AND r.to_type = 'thesis' AND r.to_id = ? AND r.status IN ('accepted','suggested') AND e.status = 'active' ORDER BY e.created_at DESC LIMIT 30`, id)
    : all<any>(`SELECT DISTINCT e.id, e.claim, e.quote FROM relationships r JOIN evidence e ON e.id = r.from_id WHERE r.from_type = 'evidence' AND r.to_type = ? AND r.to_id = ? AND r.status = 'accepted' AND e.status = 'active' ORDER BY e.created_at DESC LIMIT 30`, type, id)
  if (!ev.length) return { skipped: 'no evidence' }
  const name = type === 'thesis' ? one<any>('SELECT title FROM theses WHERE id = ?', id)?.title : one<any>(`SELECT name FROM ${type === 'company' ? 'companies' : 'firms'} WHERE id = ?`, id)?.name
  const facts = all<{ field_key: string; display: string }>("SELECT field_key, display FROM field_values WHERE object_type = ? AND object_id = ? AND status = 'current'", type, id).map(f => `${f.field_key}: ${f.display}`)
  const numbered = ev.map((e, i) => ({ n: i + 1, claim: e.claim, quote: e.quote }))
  // the user's own description steers what the summary dwells on; a sentence resting on it is kept only when the model
  // names it in "yours" and it is grounded in their words — the page marks it as theirs, never as a fact (DEC-099)
  const investorSays = type === 'thesis' ? [one<{ description: string }>('SELECT description FROM theses WHERE id = ?', id)?.description, getDetails(type, id).about].filter(Boolean).join(' ') : getDetails(type, id).about
  const r = await runTask(SUMMARIZE, { name, facts, evidence: numbered, ...(investorSays ? { investorSays } : {}) }, { jobId })
  const supports = r.value.citations.map(n => numbered.find(x => x.n === n)?.quote).filter(Boolean) as string[]
  const yoursIn = new Set(r.value.yours.map(y => y.trim()))
  const parts = sentences(r.value.summary).map(sn => {
    const mine = yoursIn.has(sn.trim()) || [...yoursIn].some(y => y && sn.includes(y))
    const ok = mine ? !!investorSays && groundingCheck(sn, [investorSays], { allowedNames: [name] }).ok : groundingCheck(sn, supports.length ? supports : numbered.map(x => x.quote), { allowedNames: [name], strictDates: true }).ok
    return ok ? { text: sn, yours: mine } : null
  }).filter(Boolean) as { text: string; yours: boolean }[]
  if (!parts.some(p => !p.yours)) return { skipped: 'nothing grounded' }
  fs.mkdirSync(path.dirname(summaryFile(type, id)), { recursive: true })
  fs.writeFileSync(summaryFile(type, id), JSON.stringify({ text: parts.map(p => p.text).join(' '), yours: parts.filter(p => p.yours).map(p => p.text), citations: r.value.citations.map(n => ev[n - 1]?.id).filter(Boolean), at: now(), evidenceCount: ev.length }))
  emit('object.updated', { type, id })
  return { ok: true }
}

/** Enqueue a refresh when the cached summary is older than 24 h and evidence changed since. */
export function maybeSummarize(type: 'company' | 'firm' | 'thesis', id: string): void {
  const c = cachedSummary(type, id)
  if (c && now() - c.at < DAY) return
  enqueue('SUMMARIZE_OBJECT', { type, id }, { idempotencyKey: `summary:${type}:${id}`, priority: 6 })
}

export function registerRefresh(): void {
  registerJob('REFRESH_OBJECT', job => refreshJob(job.payload as any))
  registerJob('SUMMARIZE_OBJECT', job => summarize(job.payload.type, job.payload.id, job.id))
  registerMaintenance('summaries_refresh', () => {
    const dir = path.join(DATA_DIR, 'cache', 'summaries')
    if (!fs.existsSync(dir)) return { refreshed: 0 }
    let n = 0
    for (const f of fs.readdirSync(dir)) { const m = f.match(/^(company|firm|thesis)_(.+)\.json$/); if (m) { maybeSummarize(m[1] as any, m[2]); n++ } }
    return { refreshed: n }
  })
}
