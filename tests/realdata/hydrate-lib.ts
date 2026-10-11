// Shared by the two hydration suites (split so they run in parallel): wait for HYDRATE_OBJECT and its documents,
// then collect what the entity got. Each suite writes its own results JSON.
import fs from 'node:fs'
import path from 'node:path'
import { until, ROOT, type RW } from '../harness/app'

export const DIR = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev')
export function results(file: string) {
  const out: Record<string, any> = { started: new Date().toISOString(), entities: {} }
  const save = () => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, file), JSON.stringify(out, null, 2)) }
  return { out, save }
}

export async function hydrated(rw: RW, type: 'company' | 'firm', id: string) {
  const job = await until(async () => {
    const j = (await rw.inspect('jobs')).filter((x: any) => x.type === 'HYDRATE_OBJECT' && x.idempotency_key === `hydrate:${id}`).pop()
    return j && ['succeeded', 'failed'].includes(j.status) ? j : null
  }, 20 * 60_000, 3000)
  const r = JSON.parse(job.result_json || '{}')
  await until(async () => {
    const docs = await rw.inspect('documents')
    return docs.filter((d: any) => (r.documentIds || []).includes(d.id) && ['fetched', 'processing'].includes(d.status)).length ? null : true
  }, 60 * 60_000, 5000)
  const table = type === 'company' ? 'companies' : 'firms'
  const row = (await rw.inspect(table, { id }))[0]
  const rels = (await rw.inspect('relationships')).filter((x: any) => (x.to_id === id || x.from_id === id) && ['accepted', 'suggested'].includes(x.status))
  const evIds = new Set(rels.filter((x: any) => x.from_type === 'evidence').map((x: any) => x.from_id))
  const ev = (await rw.inspect('evidence')).filter((e: any) => evIds.has(e.id) && e.status === 'active')
  const fields = (await rw.inspect('field_values', { object_type: type, object_id: id })).filter((f: any) => f.status === 'current').map((f: any) => ({ key: f.field_key, display: f.display, origin: f.origin }))
  const sources = (await rw.inspect('sources')).filter((s: any) => s.origin === 'system' && !s.deleted_at).map((s: any) => ({ name: s.name, kind: s.kind, site: s.site_domain }))
  const aliases = (await rw.inspect('aliases', { entity_id: id })).map((a: any) => a.alias)
  const investments = rels.filter((x: any) => x.rel === 'invested_in' && x.from_id === id).length
  // the same name must not also exist as the other entity type (a firm filed as a company)
  const other = (await rw.inspect(type === 'company' ? 'firms' : 'companies')).filter((x: any) => !x.merged_into_id && x.normalized_name === row.normalized_name)
  return { job: { status: job.status, error: job.error_message }, result: r, row, ev, fields, sources, aliases, investments, crossTypeDupes: other.length, docLinks: rels.filter((x: any) => x.from_type === 'document').length }
}
export const recorder = (out: Record<string, any>, save: () => void) => (key: string, c: any, h: Awaited<ReturnType<typeof hydrated>>, extra: Record<string, unknown> = {}) => {
  out.entities[key] = { id: c.id, name: c.name, nameNow: h.row.name, existing: c.existing, job: h.job, steps: h.result, website: h.row.domain, aliases: h.aliases, fields: h.fields, investments: h.investments, crossTypeDupes: h.crossTypeDupes,
    evidence: h.ev.map((e: any) => ({ kind: e.kind, claim: e.claim })), docLinks: h.docLinks, ...extra }
  save()
}

