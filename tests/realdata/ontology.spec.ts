// Ontology operations on a real library (DEC-094): every registry op is exercised twice — once through the one IPC
// path `ontology.apply`, once through chat (`correct.parse` → CORRECT_OBJECT → `correct.apply`) with the phrasing a
// user would type — then undone where the op has an inverse. The invariants checker (`test.ontology.invariants`) runs
// after every step and must be clean. Library: ~10 real funding articles read once from TechCrunch's startups feed,
// plus two entities hydrated from the web by name (object.create via the registry, and chat "start tracking …").
// Results: tests/results/<run>/realdata-ontology-ops.json
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { preparedLibrary, until, ROOT, type RW } from '../harness/app'

const DIR = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev')
const OUT = path.join(DIR, 'realdata-ontology-ops.json')
const out: Record<string, any> = { started: new Date().toISOString(), library: {}, steps: [] }
const save = () => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 2)) }
const MIN = 60_000
// real funding news; a single feed some days has too few funding headlines (run #21: 4), so the next one tops it up
const FEEDS = ['https://techcrunch.com/category/startups/feed/', 'https://techcrunch.com/category/venture/feed/', 'https://news.crunchbase.com/feed/']
const THESES = ['Fintech', 'AI infrastructure', 'Developer tools']
const FUNDING = /\braise[sd]?\b|\blands\b|\$\d|\bvaluation\b|\bseed\b|\bseries [a-f]\b|\bbacks?\b|\bfunding\b/i

let rw: RW
const ctx: Record<string, any> = {}

async function invariants(step: string) {
  const r = await rw.invoke('test.ontology.invariants')
  out.steps.push({ step, invariantsOk: r.ok, violations: r.violations.slice(0, 25), info: r.info }); save()
  expect(r.violations, `invariants after: ${step}`).toEqual([])
}
async function apply(op: string, input: Record<string, unknown>) {
  const r = await rw.invoke('ontology.apply', { op, input })
  out.steps.push({ via: 'ontology.apply', op, input, message: r.message, undo: r.undo, result: r.result }); save()
  await invariants(`${op} via ontology.apply`)
  return r
}
async function chat(text: string, op: string) {
  const p = await rw.invoke('correct.parse', { text })
  out.steps.push({ via: 'chat', text, proposal: { action: p.action, op: p.op, input: p.input, confirmText: p.confirmText } }); save()
  expect(p.op, `"${text}" → ${op} (got ${p.action}: ${p.confirmText})`).toBe(op)
  const r = await rw.invoke('correct.apply', { proposal: p })
  out.steps.push({ via: 'correct.apply', op, message: r.message, undo: r.undo, result: r.result }); save()
  await invariants(`chat "${text}"`)
  return { p, r }
}
async function undo(r: any, label: string) {
  expect(r.undo, `${label} is undoable`).toBeTruthy()
  const u = await rw.invoke('ontology.undo', { historyIds: r.undo.historyIds })
  out.steps.push({ via: 'ontology.undo', label, ops: u.results.map((x: any) => x.op) }); save()
  await invariants(`undo ${label}`)
  return u
}
const row = async (table: string, id: string) => (await rw.inspect(table, { id }))[0]
const rels = async (type: string, id: string) => (await rw.inspect('relationships')).filter((r: any) => (r.to_type === type && r.to_id === id) || (r.from_type === type && r.from_id === id))
const liveCompanies = async () => (await rw.inspect('companies')).filter((c: any) => !c.merged_into_id && !c.deleted_at)
const current = async (type: string, id: string, key: string) => (await rw.inspect('field_values', { object_type: type, object_id: id, field_key: key, status: 'current' }))[0]

async function hydratedAll() {
  await until(async () => (await rw.inspect('jobs')).every((j: any) => j.type !== 'HYDRATE_OBJECT' || !['queued', 'running'].includes(j.status)) || null, 40 * MIN, 5000)
  await rw.drain(60 * MIN)
}

test.describe.serial('RD-ONT ontology operations: add, rename, merge, split, change type, delete/restore, fields, links, theses', () => {
  test.beforeAll(async () => {
    test.setTimeout(90 * MIN)
    // built once per RW_RUN_ID (preparedLibrary cache), so a rerun of a failed step doesn't re-read the web
    rw = await preparedLibrary('realdata-ontology', async b => {
      await b.invoke('settings.update', { patch: { 'processing.daily_cap': 1000 } })
      for (const t of THESES) await b.invoke('thesis.create', { title: t })
      // ~10 real funding articles, read once (the test reads the feed itself, independent of the app)
      const picked: { title: string; link: string }[] = []
      for (const feed of FEEDS) {
        if (picked.length >= 10) break
        const xml = await (await fetch(feed, { headers: { 'user-agent': 'Mozilla/5.0' } })).text()
        const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({ title: (m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&#8217;|&#8216;/g, "'").replace(/&amp;/g, '&'), link: (m[1].match(/<link>([^<]+)<\/link>/)?.[1] || '').trim() }))
        for (const i of items) if (i.link && FUNDING.test(i.title) && !picked.some(p => p.link === i.link) && picked.length < 10) picked.push(i)
      }
      expect(picked.length, 'real funding articles in the feed').toBeGreaterThanOrEqual(6)
      for (const a of picked) await b.raw('ingress.addUrl', { url: a.link })
      await b.drain(60 * MIN)
      // one entity hydrated from the web by name through the registry (the chat one is RD-ONT-01)
      await b.invoke('ontology.apply', { op: 'entity.create', input: { type: 'company', name: 'Mercury' } })
      await until(async () => (await b.inspect('jobs')).every((j: any) => j.type !== 'HYDRATE_OBJECT' || !['queued', 'running'].includes(j.status)) || null, 40 * MIN, 5000)
      await b.drain(60 * MIN)
    }, { testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } })
    const theses = await rw.inspect('theses')
    for (const t of THESES) ctx[t] = theses.find((x: any) => x.title === t).id
    const created = (await rw.inspect('history', { action: 'entity.created' }))[0]
    ctx.mercury = { result: { id: created.entity_id, ...JSON.parse(created.after_json) } }
    out.library.articles = (await rw.inspect('documents')).filter((d: any) => /techcrunch/.test(d.url || '')).map((d: any) => ({ title: d.title, url: d.url, status: d.status }))
    out.library.mercury = ctx.mercury.result
    out.steps.push({ via: 'ontology.apply', op: 'entity.create', input: { type: 'company', name: 'Mercury' }, result: ctx.mercury.result, note: 'library build' }); save()
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('RD-ONT-00 the real library starts clean; pick real companies to correct', async () => {
    await invariants('library built')
    const docs = await rw.inspect('documents')
    const links = (await rw.inspect('relationships')).filter((r: any) => r.from_type === 'document' && r.to_type === 'company' && r.status === 'accepted')
    const count = new Map<string, number>()
    for (const l of links) count.set(l.to_id, (count.get(l.to_id) || 0) + 1)
    const mercuryId = ctx.mercury.result.id
    const cos = (await liveCompanies()).filter((c: any) => c.id !== mercuryId && c.name.length >= 4 && /^[A-Z0-9]/.test(c.name) && count.get(c.id))
      .sort((a: any, b: any) => (count.get(b.id) || 0) - (count.get(a.id) || 0))
    // names that don't contain one another, so chat candidates are unambiguous
    const pick: any[] = []
    for (const c of cos) if (!pick.some(p => p.name.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(p.name.toLowerCase())) && !/mercury/i.test(c.name)) pick.push(c)
    out.library.documents = docs.length; out.library.companies = cos.map((c: any) => ({ id: c.id, name: c.name, docLinks: count.get(c.id) })); save()
    expect(pick.length, 'enough real companies with coverage').toBeGreaterThanOrEqual(8)
    ctx.c = pick.slice(0, 10)
  })

  test('RD-ONT-01 entity.create — chat "start tracking …" adds and hydrates a firm', async () => {
    test.setTimeout(60 * MIN)
    const { r } = await chat('Start tracking Precursor Ventures, the seed-stage VC firm', 'entity.create')
    expect(r.result.id).toMatch(/^fm/)
    ctx.precursor = r.result
    await hydratedAll()
    await invariants('after hydrating chat-created firm')
    const job = (await rw.inspect('jobs')).find((j: any) => j.type === 'HYDRATE_OBJECT' && j.idempotency_key === `hydrate:${r.result.id}`)
    expect(job?.status).toBe('succeeded')
  })

  test('RD-ONT-02 entity.rename — via ontology.apply and chat, each undone', async () => {
    const [a, b] = ctx.c
    const r1 = await apply('entity.rename', { type: 'company', id: a.id, name: `${a.name} Holdings` })
    expect((await row('companies', a.id)).name).toBe(`${a.name} Holdings`)
    expect((await rw.inspect('aliases', { entity_id: a.id })).map((x: any) => x.alias)).toContain(a.name)
    await undo(r1, 'rename (ipc)')
    expect((await row('companies', a.id)).name).toBe(a.name)
    expect((await rw.inspect('aliases', { entity_id: a.id })).map((x: any) => x.alias)).not.toContain(`${a.name} Holdings`)
    const { r: r2 } = await chat(`${b.name} rebranded — rename ${b.name} to ${b.name} Labs`, 'entity.rename')
    expect((await row('companies', b.id)).name).toBe(`${b.name} Labs`)
    await undo(r2, 'rename (chat)')
    expect((await row('companies', b.id)).name).toBe(b.name)
  })

  test('RD-ONT-03 entity.changeType — company → firm keeps its links; undo brings the same company back', async () => {
    const [, , a, b] = ctx.c
    const before = (await rels('company', a.id)).length
    const r1 = await apply('entity.changeType', { type: 'company', id: a.id })
    const fid = r1.result.id
    expect((await row('companies', a.id)).deleted_at).toBeTruthy()
    expect((await row('firms', fid)).name).toBe(a.name)
    expect((await rels('firm', fid)).length).toBe(before)
    await undo(r1, 'changeType (ipc)')
    expect((await row('companies', a.id)).deleted_at).toBeNull()
    expect((await rels('company', a.id)).length).toBe(before)
    expect((await row('firms', fid)).deleted_at).toBeTruthy()
    const { r: r2 } = await chat(`${b.name} is a VC firm, not a company`, 'entity.changeType')
    expect(r2.result.type).toBe('firm')
    await undo(r2, 'changeType (chat)')
    expect((await row('companies', b.id)).deleted_at).toBeNull()
  })

  test('RD-ONT-04 entity.delete / entity.restore — links removed and put back; chat delete + undo; chat restore', async () => {
    const [, , , , a, b] = ctx.c
    const before = (await rels('company', a.id)).map((r: any) => r.id).sort()
    const aliasesBefore = (await rw.inspect('aliases', { entity_id: a.id })).length
    await apply('entity.delete', { type: 'company', id: a.id })
    expect((await row('companies', a.id)).deleted_at).toBeTruthy()
    expect(await rels('company', a.id)).toEqual([])
    const r1 = await apply('entity.restore', { type: 'company', id: a.id })
    expect((await row('companies', a.id)).deleted_at).toBeNull()
    expect((await rels('company', a.id)).map((r: any) => r.id).sort()).toEqual(before)
    expect((await rw.inspect('aliases', { entity_id: a.id })).length).toBe(aliasesBefore)
    expect(r1.undo, 'restore is undoable (→ delete)').toBeTruthy()
    const { r: r2 } = await chat(`Delete ${b.name}, I don't want it in my library`, 'entity.delete')
    expect((await row('companies', b.id)).deleted_at).toBeTruthy()
    await undo(r2, 'delete (chat)')
    expect((await row('companies', b.id)).deleted_at).toBeNull()
    await chat(`Delete ${b.name}`, 'entity.delete')
    await chat(`Restore ${b.name}, I deleted it by mistake`, 'entity.restore')
    expect((await row('companies', b.id)).deleted_at).toBeNull()
    // deleting an entity the user added by name also pauses the news watch hydration made for it; Undo resumes it
    const d = await apply('entity.delete', { type: 'firm', id: ctx.precursor.id })
    const h = (await rw.inspect('history', { entity_id: ctx.precursor.id, action: 'entity.deleted' })).pop()
    const paused: string[] = JSON.parse(h.before_json).pausedSources
    out.pausedSources = paused; save()
    expect(paused.length, 'its news watch is paused').toBeGreaterThanOrEqual(1)
    for (const s of paused) expect((await row('sources', s)).enabled).toBe(0)
    await undo(d, 'delete hydrated firm')
    for (const s of paused) expect((await row('sources', s)).enabled).toBe(1)
  })

  test('RD-ONT-05 entity.split — "Mercury is a different company from Mercury Insurance"; undo merges back; chat merge', async () => {
    const m = ctx.mercury.result.id
    const r1 = await apply('entity.split', { type: 'company', id: m, newName: 'Mercury Insurance' })
    const ins = r1.result.id
    expect((await row('companies', ins)).name).toBe('Mercury Insurance')
    await undo(r1, 'split (ipc)')
    expect((await row('companies', ins)).merged_into_id).toBe(m)
    const { r: r2 } = await chat('Mercury is a different company from Mercury Insurance', 'entity.split')
    const ins2 = r2.result.id
    expect((await row('companies', ins2)).merged_into_id).toBeNull()
    await rw.drain(30 * MIN)   // documents naming both are re-read
    await invariants('after split re-reads')
    await chat('Actually Mercury Insurance and Mercury are the same company, merge Mercury Insurance into Mercury', 'entity.merge')
    expect((await row('companies', ins2)).merged_into_id).toBe(m)
  })

  test('RD-ONT-06 entity.merge — via ontology.apply; merges are not undoable', async () => {
    const [, , , , , , a, b] = ctx.c
    const r = await apply('entity.merge', { type: 'company', fromId: a.id, intoId: b.id })
    expect((await row('companies', a.id)).merged_into_id).toBe(b.id)
    expect(await rels('company', a.id)).toEqual([])
    expect((await rw.inspect('aliases', { entity_id: b.id })).map((x: any) => x.alias)).toContain(a.name)
    expect(r.undo).toBeNull()
    const h = (await rw.inspect('history', { entity_id: b.id, action: 'merge' })).pop()
    const u = await rw.raw('ontology.undo', { historyId: h.id })
    expect(u.ok).toBe(false)
    expect(u.code).toBe('CONFLICT')
  })

  test('RD-ONT-07 field.set / field.revert — via ontology.apply and chat ("X\'s stage is Series B"), each undone', async () => {
    const [x, y] = ctx.c
    const before = await current('company', x.id, 'hq')
    const r1 = await apply('field.set', { objectType: 'company', objectId: x.id, key: 'hq', value: 'Lisbon, Portugal' })
    expect((await current('company', x.id, 'hq')).display).toBe('Lisbon, Portugal')
    await undo(r1, 'field.set (ipc)')
    expect((await current('company', x.id, 'hq'))?.display ?? null).toBe(before?.display ?? null)
    await chat(`${y.name}'s stage is Series B`, 'field.set')
    expect((await current('company', y.id, 'stage')).display).toBe('Series B')
    expect((await current('company', y.id, 'stage')).origin).toBe('user')
    // revert: through the registry, then undo puts the user's value back
    const r3 = await apply('field.revert', { objectType: 'company', objectId: y.id, key: 'stage' })
    expect((await current('company', y.id, 'stage'))?.origin ?? 'none').not.toBe('user')
    await undo(r3, 'field.revert (ipc)')
    expect((await current('company', y.id, 'stage')).display).toBe('Series B')
    await chat(`Drop my stage for ${y.name} and use what the articles say`, 'field.revert')
    expect((await current('company', y.id, 'stage'))?.origin ?? 'none').not.toBe('user')
  })

  test('RD-ONT-08 link.attach / link.reject — company ↔ thesis via ontology.apply and chat; Not about on a real article', async () => {
    const [x, y] = ctx.c
    await apply('link.attach', { fromType: 'company', fromId: x.id, thesisId: ctx.Fintech })
    const rel = (await rw.inspect('relationships', { from_type: 'company', from_id: x.id, to_id: ctx.Fintech }))[0]
    expect(rel.status).toBe('accepted')
    await chat(`${y.name} belongs in my Fintech thesis`, 'link.attach')
    expect((await rw.inspect('relationships', { from_type: 'company', from_id: y.id, to_id: ctx.Fintech }))[0]?.status).toBe('accepted')
    await apply('link.reject', { relId: rel.id })
    expect((await row('relationships', rel.id)).status).toBe('rejected')
    await chat(`${y.name} is not related to my Fintech thesis`, 'link.reject')
    expect((await rw.inspect('relationships', { from_type: 'company', from_id: y.id, to_id: ctx.Fintech }))[0]?.status).toBe('rejected')
    // "Not about <company>" on a real article (the reader's chip)
    const docLink = (await rw.inspect('relationships')).find((r: any) => r.from_type === 'document' && r.to_type === 'company' && r.to_id === x.id && r.status === 'accepted')
    if (docLink) {
      await apply('link.reject', { documentId: docLink.from_id, entityType: 'company', entityId: x.id })
      expect((await row('relationships', docLink.id)).status).toBe('rejected')
    }
  })

  test('RD-ONT-09 theses — create, rename, move, archive (each via ontology.apply and chat, undone) and merge', async () => {
    const r1 = await apply('thesis.create', { title: 'Embedded insurance', parentId: ctx.Fintech })
    const ins = r1.result.id
    const { r: r2 } = await chat('New thesis: Agent infrastructure, under AI infrastructure', 'thesis.create')
    const agent = r2.result.id
    expect((await row('theses', agent)).parent_id).toBe(ctx['AI infrastructure'])
    // rename
    const r3 = await apply('thesis.update', { id: ctx['Developer tools'], patch: { title: 'Devtools' } })
    expect((await row('theses', ctx['Developer tools'])).title).toBe('Devtools')
    await undo(r3, 'thesis rename (ipc)')
    expect((await row('theses', ctx['Developer tools'])).title).toBe('Developer tools')
    const { r: r4 } = await chat('Rename my Developer tools thesis to Developer platforms', 'thesis.update')
    expect((await row('theses', ctx['Developer tools'])).title).toBe('Developer platforms')
    await undo(r4, 'thesis rename (chat)')
    // move
    const r5 = await apply('thesis.move', { id: ins, parentId: null })
    expect((await row('theses', ins)).parent_id).toBeNull()
    await undo(r5, 'thesis move (ipc)')
    expect((await row('theses', ins)).parent_id).toBe(ctx.Fintech)
    const { r: r6 } = await chat('Move the Agent infrastructure thesis under Developer tools', 'thesis.move')
    expect((await row('theses', agent)).parent_id).toBe(ctx['Developer tools'])
    await undo(r6, 'thesis move (chat)')
    expect((await row('theses', agent)).parent_id).toBe(ctx['AI infrastructure'])
    // archive
    const r7 = await apply('thesis.archive', { id: ins, archived: true })
    expect((await row('theses', ins)).archived_at).toBeTruthy()
    await undo(r7, 'thesis archive (ipc)')
    expect((await row('theses', ins)).archived_at).toBeNull()
    const { r: r8 } = await chat('Archive the Embedded insurance thesis, I am done with it', 'thesis.archive')
    expect((await row('theses', ins)).archived_at).toBeTruthy()
    await undo(r8, 'thesis archive (chat)')
    // merge (irreversible)
    await apply('thesis.merge', { fromId: ins, intoId: ctx.Fintech })
    expect((await row('theses', ins)).merged_into_id).toBe(ctx.Fintech)
    await chat('Merge the Agent infrastructure thesis into AI infrastructure', 'thesis.merge')
    expect((await row('theses', agent)).merged_into_id).toBe(ctx['AI infrastructure'])
  })

  test('RD-ONT-09b entity.repairAliases — unstated source aliases removed via ontology.apply and via chat, each undone', async () => {
    const [a] = ctx.c
    // the bug as it was: names the sources never tie to the company stored as its aliases (a chip maker, a partner) —
    // two that share no word with the company the real library gave us (run #22 picked Nvidia, whose legal name
    // "Nvidia Corp" rightly isn't a wrong alias)
    const words = new Set(a.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
    const [x, y] = ['Nvidia Corp', 'Tenstorrent', 'Graphcore', 'Cerebras Systems', 'Lightmatter'].filter(n => !n.toLowerCase().split(/\s+/).some(w => words.has(w)))
    for (const alias of [x, y]) await rw.invoke('test.aliases.add', { type: 'company', id: a.id, alias })
    const names = async () => (await rw.inspect('aliases', { entity_type: 'company', entity_id: a.id })).map((x: any) => x.alias)
    const audit = (await rw.invoke('ontology.aliasAudit')).find((x: any) => x.id === a.id)
    expect(audit?.bad || [], 'the audit names both').toEqual(expect.arrayContaining([x, y]))
    const r1 = await apply('entity.repairAliases', { type: 'company', id: a.id, aliases: [x], reread: false })
    expect(await names()).not.toContain(x)
    await undo(r1, 'repairAliases (ipc)')
    expect(await names()).toContain(x)
    const { r: r2 } = await chat(`Stop treating ${y} as another name for ${a.name} — it's a chip maker that appears near it, remove that alias`, 'entity.repairAliases')
    expect(await names()).not.toContain(y)
    await undo(r2, 'repairAliases (chat)')
    expect(await names()).toContain(y)
    // leave the library clean for the checks that follow
    await apply('entity.repairAliases', { type: 'company', id: a.id, aliases: [x, y], reread: false })
    expect((await names()).filter((n: string) => n === x || n === y)).toEqual([])
  })

  test('RD-ONT-11 object.describe — the user\'s own description via ontology.apply and chat, each undone; it never becomes a fact', async () => {
    const [x, y] = ctx.c
    const about = 'Builds compilers for AI chips; met the founders at a demo day'
    const r1 = await apply('object.describe', { type: 'company', id: x.id, patch: { about, otherNames: [`${x.name} Labs`] }, rerun: false })
    expect((await rw.invoke('object.details', { type: 'company', id: x.id })).about).toBe(about)
    await undo(r1, 'object.describe (ipc)')
    expect((await rw.invoke('object.details', { type: 'company', id: x.id })).about).toBe('')
    const { r } = await chat(`${y.name} is a payments infrastructure company for small banks — remember that as my description of it`, 'object.describe')
    const d = await rw.invoke('object.details', { type: 'company', id: y.id })
    expect(d.about.toLowerCase()).toContain('payments')
    // the user's words are context, never evidence
    expect((await rw.inspect('evidence')).filter((e: any) => e.claim.includes(about) || e.quote.includes(about))).toEqual([])
    await undo(r, 'object.describe (chat)')
    expect((await rw.invoke('object.details', { type: 'company', id: y.id })).about).toBe('')
  })

  test('RD-ONT-10 every registry op was exercised through both paths', async () => {
    const ops = (await rw.invoke('ontology.ops')).map((o: any) => o.name)
    const viaIpc = new Set(out.steps.filter((s: any) => s.via === 'ontology.apply').map((s: any) => s.op))
    const viaChat = new Set(out.steps.filter((s: any) => s.via === 'correct.apply').map((s: any) => s.op))
    out.coverage = { ops, viaIpc: [...viaIpc], viaChat: [...viaChat] }; save()
    // entity.create via ontology.apply ran in beforeAll (Mercury)
    expect(ops.filter((o: string) => !viaIpc.has(o)), 'ops not run via ontology.apply').toEqual([])
    expect(ops.filter((o: string) => !viaChat.has(o)), 'ops not run via chat').toEqual([])
    await invariants('end')
  })
})
