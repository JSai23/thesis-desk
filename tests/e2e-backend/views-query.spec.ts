// RFC §3A views, fields, query and feed ranking: E2E-VIEW-01/02, E2E-FIELD-01, E2E-Q-01/02, E2E-FEED-01.
import { test, expect } from '@playwright/test'
import { launch, type RW } from '../harness/app'
import { fixtures } from '../harness/fixtures'
import { U, H, corpusTheses, addSource, docByUrl, company } from './common'

const comps = (sections: any[]) => sections.map((s: any) => s.component)

test('E2E-VIEW-01 view patch validity (Appendix B)', async () => {
  await fixtures.reset()
  let rw = await launch()
  for (const u of [U.D1, U.D7, 'http://signalwire.test:4700/quillmate-amlaw']) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(400_000)
  const lumen = await company(rw, 'Lumen Legal')
  const cust = async (instruction: string, objectId: string | null = lumen.id) => {
    await rw.invoke('view.customize', { objectType: 'company', objectId, instruction })
    return (await rw.invoke('view.get', { objectType: 'company', objectId })).definition
  }
  let d = await cust('Put funding history first and hide headquarters.')
  expect(d.main[0].component).toBe('funding_table'); expect(d.headerFields).not.toContain('hq')
  d = await cust('Show pricing changes at the top.')
  expect(d.main[0].component).toBe('activity_timeline'); expect(d.main[0].params?.kinds).toContain('pricing')
  d = await cust('Compare with competitors I track.')
  expect(comps([...d.main, ...d.rail])).toContain('related_companies')
  const before5 = await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })
  const t = await cust('On every company page, show the founders above my notes.', null)
  const all = [...t.main, ...t.rail]
  const people = all.findIndex((s: any) => s.component === 'people'), notes = all.findIndex((s: any) => s.component === 'notes')
  expect(people).toBeGreaterThan(-1)
  if (notes > -1) expect(t.main.some((s: any) => s.component === 'people') && t.main.some((s: any) => s.component === 'notes') ? people < notes : true).toBe(true)
  d = await cust('Remove the latest round box.')
  expect(comps([...d.main, ...d.rail])).not.toContain('latest_round')
  const finalObj = await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })
  const finalType = await rw.invoke('view.get', { objectType: 'company', objectId: null })
  rw = await rw.restart()
  expect(await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })).toEqual(finalObj)
  expect(await rw.invoke('view.get', { objectType: 'company', objectId: null })).toEqual(finalType)
  await rw.invoke('view.undo', { viewId: finalObj.id })
  const undone = await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })
  expect(JSON.stringify(undone.definition)).toBe(JSON.stringify(before5.definition))
  await rw.close()
})

test('E2E-VIEW-02 invalid model output', async () => {
  await fixtures.reset()
  const rw = await launch({ faults: 'invalid_always:CUSTOMIZE_VIEW' })
  await rw.invoke('ingress.addUrl', { url: U.D1 }); await rw.drain(300_000)
  const lumen = await company(rw, 'Lumen Legal')
  const v0 = await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })
  const r = await rw.raw('view.customize', { objectType: 'company', objectId: lumen.id, instruction: 'Put funding history first.' })
  expect(r.ok).toBe(false); expect(r.code).toBe('AI_INVALID')
  const v1 = await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })
  expect(v1.version).toBe(v0.version); expect(v1.definition).toEqual(v0.definition)
  const run = (await rw.inspect('agent_runs', { task: 'CUSTOMIZE_VIEW' })).pop()
  expect(run.status).toBe('invalid'); expect(run.attempts).toBe(2)
  await rw.close()
})

test('E2E-FIELD-01 custom field backfill', async () => {
  await fixtures.reset()
  const rw = await launch()
  await rw.invoke('ingress.addUrl', { url: U.D13 }); await rw.drain(300_000)
  await rw.invoke('view.customize', { objectType: 'company', objectId: null, instruction: 'Track employee count on companies' })
  await rw.drain(400_000)
  const def = (await rw.inspect('field_defs', { object_type: 'company' })).find((f: any) => !f.builtin && /employee/i.test(f.key + f.label))
  expect(def, 'custom field def').toBeTruthy()
  const cw = await company(rw, 'Claimwise')
  const fv = (await rw.inspect('field_values', { object_type: 'company', object_id: cw.id, field_key: def.key, status: 'current' }))[0]
  expect(fv, 'Claimwise employee count').toBeTruthy()
  expect(fv.display).toMatch(/^40\b/)
  const ev = (await rw.inspect('evidence', { id: fv.evidence_id }))[0]
  expect(ev.quote).toContain('40 employees')
  await rw.close()
})

test('E2E-Q-01 query grounding over BK questions', async () => {
  await fixtures.reset()
  const rw = await launch()
  await corpusTheses(rw)
  const srcs = []
  for (const loc of [U.swFeed, 'http://vln.test:4700/', U.nwBlog, U.sfBlog]) srcs.push(await addSource(rw, loc))
  await addSource(rw, U.hn, { mode: 'relevant' })
  await rw.invoke('ingress.addUrl', { url: U.D13 })
  await rw.drain(1_500_000)
  await fixtures.epoch(2)
  for (const s of srcs) await rw.invoke('source.syncNow', { id: s.id })
  await rw.drain(900_000)
  const docs = new Set((await rw.inspect('documents')).map((d: any) => d.id))
  const Q = ["Who led Lumen Legal's Series A, and how much did they raise?", 'What evidence contradicts my thesis that AI replaces outsourced support labor?', 'What has Northwind Ventures done recently?',
    'What changed with Brightdesk this month?', 'Which legal AI companies am I tracking and how do they compare?', "What is Claimwise's annual revenue?", 'What did Harbor Point Capital announce?', 'What is Stackforge building and who is behind it?']
  for (const [i, q] of Q.entries()) {
    const a = await rw.invoke('query.ask', { question: q })
    for (const f of a.items.filter((x: any) => x.type === 'fact')) {
      expect(f.citations.length, `Q${i + 1} fact "${f.text}"`).toBeGreaterThanOrEqual(1)
      for (const n of f.citations) {
        const c = a.citations.find((x: any) => x.n === n)
        expect(c, `Q${i + 1} citation ${n}`).toBeTruthy()
        expect(docs.has(c.documentId)).toBe(true)
      }
    }
    if (i === 5) expect(a.insufficient).toBe(true)
  }
  await rw.close()
})

test('E2E-Q-02 since I last looked', async () => {
  await fixtures.reset()
  const rw = await launch()
  await rw.invoke('ingress.addUrl', { url: U.D5 }); await rw.drain(300_000)
  const bd = await company(rw, 'Brightdesk')
  await rw.invoke('object.markViewed', { type: 'company', id: bd.id })
  const T = (await rw.inspect('companies', { id: bd.id }))[0].last_viewed_at
  await rw.invoke('test.clock.advance', { ms: 2 * H })
  await rw.invoke('ingress.addUrl', { url: U.D6 }); await rw.drain(300_000)
  const a = await rw.invoke('query.ask', { question: 'What should I know about Brightdesk since I last looked?' })
  const plan = JSON.parse((await rw.inspect('agent_runs', { task: 'PLAN_QUERY' })).pop().output_json)
  expect(plan.since).toBe('last_viewed')
  const d6 = await docByUrl(rw, U.D6)
  const after = new Set((await rw.inspect('documents')).filter((d: any) => d.first_fetched_at > T).map((d: any) => d.id))
  expect(after.has(d6.id)).toBe(true)
  const cited = a.items.filter((x: any) => x.type === 'fact').flatMap((f: any) => f.citations).map((n: number) => a.citations.find((c: any) => c.n === n)?.documentId)
  expect(cited.length).toBeGreaterThan(0)
  for (const id of cited) expect(after.has(id)).toBe(true)
  await rw.close()
})

test('E2E-FEED-01 feedback ranking', async () => {
  await fixtures.reset()
  const rw = await launch()
  await corpusTheses(rw)
  const sw = await addSource(rw, U.swFeed)
  await rw.drain(500_000)
  const item = (await rw.invoke('feed.list', { viewSpec: { segment: 'all' } })).items.find((i: any) => i.srcId === sw.id)
  await rw.invoke('feed.feedback', { id: item.id, value: 'less' })
  const w = (await rw.invoke('settings.get')).feedback_weights
  expect(w.source[sw.id]).toBeCloseTo(0.9, 5)
  await fixtures.epoch(2)
  await rw.invoke('source.syncNow', { id: sw.id }); await rw.drain(400_000)
  const d18 = await docByUrl(rw, U.D18)
  const fi = (await rw.inspect('feed_items', { document_id: d18.id }))[0]
  expect(fi, 'D18 feed item').toBeTruthy()
  const weights = (await rw.invoke('settings.get')).feedback_weights
  // recompute §1B.14.3 from stored components
  const ev = await rw.inspect('evidence', { document_id: d18.id, status: 'active' })
  const evIds = new Set(ev.map((e: any) => e.id))
  const rejected = new Set((await rw.inspect('relationships', { from_type: 'document', from_id: d18.id, to_type: 'thesis' })).filter((r: any) => r.status === 'rejected').map((r: any) => r.to_id))
  const links = (await rw.inspect('relationships', { to_type: 'thesis' })).filter((r: any) => r.rel === 'relates_to' && ['accepted', 'suggested'].includes(r.status) && !rejected.has(r.to_id) && ((r.from_type === 'document' && r.from_id === d18.id) || (r.from_type === 'evidence' && evIds.has(r.from_id))))
  const maxConf = links.reduce((m: number, l: any) => Math.max(m, Math.min(1, l.status === 'accepted' ? Math.max(l.confidence ?? 1, 1) : l.confidence ?? 0)), 0)
  const followed = new Set([...(await rw.inspect('companies')), ...(await rw.inspect('firms')), ...(await rw.inspect('people'))].filter((e: any) => e.followed).map((e: any) => e.id))
  const mentions = (await rw.inspect('relationships', { from_type: 'document', from_id: d18.id })).filter((r: any) => followed.has(r.to_id) && r.status === 'accepted' && ['mentions', 'about'].includes(r.rel))
  const novel = ev.some((e: any) => e.is_novel && ['fact', 'attributed_opinion'].includes(e.assertion))
  const N = novel || !ev.length ? 1 : 0.4
  const thW = fi.primary_thesis_id ? (weights.thesis?.[fi.primary_thesis_id] ?? 1) : 1
  const expected = Math.min(1, Math.max(0, 1.0 * (0.45 * fi.importance + 0.30 * maxConf + 0.25 * (mentions.length ? 1 : 0)) * N * 0.9 * thW))
  expect(fi.score).toBeCloseTo(expected, 6)
  await rw.close()
})

export type { RW }
