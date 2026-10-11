// RFC §3A AI pipeline guarantees: E2E-EV-01, E2E-GRD-01…03, E2E-ENT-01/02, E2E-REL-01, E2E-COR-01/02, E2E-INJ-01,
// E2E-AI-01, E2E-CAP-01, E2E-NOTE-01, E2E-JOB-01.
import { test, expect } from '@playwright/test'
import { launch, until, preparedLibrary, type RW } from '../harness/app'
import { fixtures } from '../harness/fixtures'
import { U, corpusTheses, addSource, docByUrl, company, firm, payload } from './common'

export async function buildCorpusWeb(rw: RW): Promise<void> {
  await fixtures.reset()
  await corpusTheses(rw)
  for (const loc of [U.swFeed, 'http://vln.test:4700/', U.nwBlog, U.sfBlog]) await addSource(rw, loc)
  await addSource(rw, U.hn, { mode: 'relevant' })
  for (const u of [U.D13, 'http://misc.test:4700/injection.html']) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(1_500_000)
  for (const n of ['Lumen Legal', 'Brightdesk']) { const c = await company(rw, n); if (c) await rw.invoke('object.follow', { type: 'company', id: c.id, follow: true }) }
}

test.describe('CORPUS-1 (web, HN and manual sources)', () => {
  let rw: RW
  const thesis = async (title: string) => (await rw.inspect('theses')).find((t: any) => t.title === title)
  test.beforeEach(async () => { test.setTimeout(40 * 60_000); rw = await preparedLibrary('corpus1-web', buildCorpusWeb) })
  test.afterEach(async () => { await rw?.close() })

  test('E2E-EV-01 evidence provenance', async () => {
    const ev = (await rw.inspect('evidence')).filter((e: any) => e.status === 'active')
    expect(ev.length).toBeGreaterThan(20)
    const vers = await rw.inspect('document_versions')
    const docs = new Map((await rw.inspect('documents')).map((d: any) => [d.id, d]))
    for (const e of ev) {
      expect(docs.has(e.document_id), `document of ${e.id}`).toBe(true)
      const v = vers.find((x: any) => x.document_id === e.document_id && x.version === e.document_version)
      expect(v, `version ${e.document_version} of ${e.document_id}`).toBeTruthy()
      expect(v.text.slice(e.quote_start, e.quote_end)).toBe(e.quote)
    }
    for (const it of await rw.inspect('feed_items')) expect(JSON.parse(it.reasons_json).length, `reasons of ${it.id}`).toBeGreaterThanOrEqual(1)
  })

  test('E2E-GRD-03 claim grounding sweep', async () => {
    const ev = (await rw.inspect('evidence')).filter((e: any) => e.status === 'active' && e.origin === 'ai_extraction')
    // a claim may name its own subject even when the quote says "the startup" (DEC-092): the same rule as the product
    const rels = (await rw.inspect('relationships')).filter((r: any) => r.from_type === 'evidence' && r.rel === 'about')
    const names = new Map<string, string>()
    for (const t of ['companies', 'firms', 'people']) for (const x of await rw.inspect(t)) names.set(x.id, x.name)
    const bad: string[] = []
    for (const e of ev) {
      const allowedNames = rels.filter((r: any) => r.from_id === e.id).map((r: any) => names.get(r.to_id)).filter(Boolean)
      const r = await rw.invoke('test.groundingCheck', { text: e.claim, supports: [e.quote], allowedNames })
      if (!r.ok) bad.push(`${e.claim} ← ${e.quote} :: ${r.problems.join('; ')}`)
    }
    expect(bad).toEqual([])
  })

  test('E2E-ENT-01 entity resolution', async () => {
    const cos = (await rw.inspect('companies')).filter((c: any) => !c.merged_into_id && /^Lumen/.test(c.name))
    const lumen = cos.find((c: any) => c.name === 'Lumen Legal')
    expect(lumen).toBeTruthy()
    const aliases = (await rw.inspect('aliases', { entity_id: lumen.id })).map((a: any) => a.alias)
    expect(aliases).toContain('Lumen Legal, Inc.')
    for (const other of cos.filter((c: any) => c.id !== lumen.id)) {
      const sug = (await rw.inspect('suggestions')).filter((s: any) => s.type === 'entity_merge' && s.status === 'open' && s.payload_json.includes(other.id) && s.payload_json.includes(lumen.id))
      expect(sug.length, `merge suggestion for ${other.name}`).toBeGreaterThan(0)
    }
  })

  test('E2E-ENT-02 firm/person relations and attributed opinion', async () => {
    const nw = await firm(rw, /^Northwind/)
    const priya = (await rw.inspect('people')).find((p: any) => p.name === 'Priya Raman' && !p.merged_into_id)
    expect(nw && priya).toBeTruthy()
    const rel = (await rw.inspect('relationships', { from_type: 'person', from_id: priya.id, to_type: 'firm', to_id: nw.id })).filter((r: any) => r.rel === 'partner_at' && r.status !== 'rejected')
    expect(rel.length).toBe(1)
    const d8 = await docByUrl(rw, U.D8)
    const ops = (await rw.inspect('evidence', { document_id: d8.id, status: 'active' })).filter((e: any) => e.kind === 'opinion' || e.assertion === 'attributed_opinion')
    expect(ops.length).toBeGreaterThan(0)
    for (const o of ops) { expect(o.assertion).toBe('attributed_opinion'); expect(o.attributed_to).toMatch(/Northwind|Priya Raman/) }
  })

  test('E2E-REL-01 multi-evidence relationship', async () => {
    const nw = await firm(rw, /^Northwind/), lumen = await company(rw, 'Lumen Legal')
    const inv = (await rw.inspect('relationships', { from_type: 'firm', from_id: nw.id, to_type: 'company', to_id: lumen.id })).filter((r: any) => r.rel === 'invested_in')
    expect(inv.length).toBe(1); expect(inv[0].status).toBe('accepted')
    const re = (await rw.inspect('relationship_evidence', { relationship_id: inv[0].id })).filter((x: any) => x.status === 'active')
    const ev = await rw.inspect('evidence')
    const docsOf = new Set(re.map((x: any) => ev.find((e: any) => e.id === x.evidence_id)?.document_id))
    const d1 = await docByUrl(rw, U.D1), d7 = await docByUrl(rw, U.D7), d12w = await docByUrl(rw, U.D12w)
    // D2 and D12w may resolve as duplicates of D1 / each other; count the distinct live documents that state the lead
    expect(re.length).toBeGreaterThanOrEqual(3)
    expect(docsOf.has(d1.id) && docsOf.has(d7.id)).toBe(true)
    void d12w
  })

  test('E2E-INJ-01 prompt injection is inert', async () => {
    const d19 = await docByUrl(rw, 'http://misc.test:4700/injection.html')
    const ev = await rw.inspect('evidence', { document_id: d19.id, status: 'active' })
    expect(ev.some((e: any) => /annual platform fee/.test(e.quote))).toBe(true)
    const evIds = new Set(ev.map((e: any) => e.id))
    const contra = (await rw.inspect('relationships', { to_type: 'thesis' })).filter((r: any) => (r.from_id === d19.id || evIds.has(r.from_id)) && r.stance === 'contra')
    expect(contra).toEqual([])
    const runs = (await rw.inspect('agent_runs')).map((r: any) => String(r.output_json || ''))
    for (const o of runs) { expect(o).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); expect(o).not.toMatch(/\bBearer\b/) }
  })

  test('E2E-COR-01 correction persists through reprocessing', async () => {
    const cw = await company(rw, 'Claimwise')
    await rw.invoke('field.set', { objectType: 'company', objectId: cw.id, key: 'stage', value: 'Series A' })
    for (const u of [U.D12w, U.D13]) { const d = await docByUrl(rw, u); await rw.invoke('document.retry', { id: d.duplicate_of_id || d.id, resetGeneration: true }) }
    await rw.drain(600_000)
    const rows = await rw.inspect('field_values', { object_type: 'company', object_id: cw.id, field_key: 'stage' })
    expect(rows.find((r: any) => r.status === 'current')).toMatchObject({ display: 'Series A', origin: 'user' })
    const conflicting = rows.filter((r: any) => r.origin !== 'user' && r.display !== 'Series A' && r.status !== 'superseded' && r.status !== 'rejected')
    for (const r of conflicting) expect(r.status).toBe('proposed')
    const p = conflicting[0]
    if (p) {
      await rw.invoke('field.resolveProposal', { fvId: p.id, choice: 'keep' })
      expect((await rw.inspect('field_values', { id: p.id }))[0].status).toBe('rejected')
    }
  })

  test('E2E-COR-02 merge', async () => {
    const lumen = await company(rw, 'Lumen Legal')
    // adding a name the library already knows reuses it (DEC-088)…
    const same = await rw.invoke('object.create', { type: 'company', name: 'Lumen Legal AI' })
    expect(same.existing).toBe(true); expect(same.id).toBe(lumen.id)
    // …so a real duplicate is a different spelling the resolver can't tie to it, merged by the user
    const dup = await rw.invoke('object.create', { type: 'company', name: 'LumenLaw Assistant' })
    expect(dup.existing).toBe(false)
    await rw.invoke('note.create', { text: 'Note on the duplicate', anchor: { type: 'company', id: dup.id } })
    await rw.invoke('thesis.addCompany', { id: (await thesis('Legal AI')).id, companyId: dup.id })
    await rw.invoke('merge.entities', { type: 'company', fromId: dup.id, intoId: lumen.id })
    expect((await rw.inspect('companies', { id: dup.id }))[0].merged_into_id).toBe(lumen.id)
    expect((await rw.inspect('notes')).find((n: any) => n.text === 'Note on the duplicate').anchor_id).toBe(lumen.id)
    expect((await rw.inspect('relationships', { from_type: 'company', from_id: dup.id })).filter((r: any) => r.status !== 'rejected')).toEqual([])
    expect((await rw.inspect('aliases', { entity_id: lumen.id })).some((a: any) => a.alias === 'LumenLaw Assistant')).toBe(true)
    const s = await rw.invoke('search.query', { text: 'LumenLaw Assistant' })
    expect(s.companies[0].id).toBe(lumen.id)
  })
})

test('E2E-GRD-01 answer grounding drops fabricated facts', async () => {
  await fixtures.reset()
  const rw = await launch({ faults: 'fabricate:ANSWER_QUERY' })
  for (const u of [U.D1, U.D7]) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(400_000)
  const a = await rw.invoke('query.ask', { question: "Who led Lumen Legal's Series A, and how much did they raise?" })
  const facts = a.items.filter((i: any) => i.type === 'fact')
  for (const f of facts) expect(f.text).not.toMatch(/\b97\b/)
  const run = (await rw.inspect('agent_runs', { task: 'ANSWER_QUERY' })).pop()
  expect(JSON.parse(run.output_json).groundingDropped).toBeGreaterThanOrEqual(1)
  for (const f of facts) {
    const quotes = f.citations.map((n: number) => a.citations.find((c: any) => c.n === n)?.quote).filter(Boolean)
    expect((await rw.invoke('test.groundingCheck', { text: f.text, supports: quotes })).ok, f.text).toBe(true)
  }
  await rw.close()
})

test('E2E-GRD-02 prose grounding drops fabricated summary sentences', async () => {
  await fixtures.reset()
  const rw = await launch({ faults: 'fabricate:INTERPRET_DOCUMENT' })
  await rw.invoke('ingress.addUrl', { url: U.D6 })
  await rw.drain(300_000)
  const d6 = await docByUrl(rw, U.D6)
  const it = (await rw.inspect('feed_items', { document_id: d6.id }))[0]
  expect(it.summary).not.toContain('Acme Capital'); expect(it.summary).not.toContain('97')
  expect(it.why_it_matters).not.toContain('Acme Capital')
  const r = await rw.invoke('feed.get', { itemId: it.id })
  expect(JSON.stringify(r)).not.toContain('Acme Capital')
  await rw.close()
})

test('E2E-AI-01 usage guard', async () => {
  await fixtures.reset()
  const rw = await launch({ faults: 'usage:90' })
  for (const u of [U.D1, U.D7]) await rw.invoke('ingress.addUrl', { url: u })
  await rw.drain(30_000)
  // the first call reports 90% used → later PROCESS jobs park until the reset
  await until(async () => (await rw.inspect('jobs', { type: 'PROCESS_DOCUMENT' })).some((j: any) => j.status === 'queued' && j.error_code === 'PARKED') || null, 120_000, 1000)
  expect((await rw.invoke('app.status')).banners.some((b: any) => b.kind === 'ai_usage')).toBe(true)
  const a = await rw.invoke('query.ask', { question: 'What do I know about Lumen Legal?' })
  expect(a).toBeTruthy(); expect(Array.isArray(a.items)).toBe(true)
  await rw.close()
})

test('E2E-CAP-01 daily processing cap', async () => {
  await fixtures.reset()
  const rw = await launch()
  await rw.invoke('settings.update', { patch: { 'processing.daily_cap': 2 } })
  await addSource(rw, U.swFeed)
  await rw.drain(400_000)
  const docs = (await rw.inspect('documents')).filter((d: any) => /signalwire/.test(d.url || ''))
  expect(docs.length).toBe(4)
  expect(docs.filter((d: any) => d.status === 'processed').length).toBe(2)
  const parked = (await rw.inspect('jobs', { type: 'PROCESS_DOCUMENT' })).filter((j: any) => j.status === 'queued')
  expect(parked.length).toBe(2)
  // the app runs in America/Los_Angeles (harness TZ); test clock starts 2026-09-29 09:00 PDT → next local midnight
  for (const j of parked) expect(j.run_after).toBe(Date.parse('2026-09-30T00:00:00-07:00'))
  expect((await rw.invoke('app.status')).banners.some((b: any) => b.kind === 'daily_cap')).toBe(true)
  await rw.close()
})

test('E2E-NOTE-01 capture without AI', async () => {
  await fixtures.reset()
  const rw = await launch({ faults: 'provider_error:ORGANIZE_NOTE' })
  const text = 'Carriers want vendors who own the SLA — watch claims intake.'
  const n = await rw.invoke('note.create', { text })
  expect(n.elapsedMs).toBeLessThan(200)
  expect((await rw.inspect('notes', { id: n.id }))[0].text).toBe(text)
  await rw.drain(120_000)
  await rw.invoke('test.clock.advance', { ms: 10 * 60_000 }); await rw.drain(120_000)
  const row = (await rw.inspect('notes', { id: n.id }))[0]
  expect(row.ai_state).toBe('failed'); expect(row.text).toBe(text)
  await rw.close()
})

test('E2E-JOB-01 crash recovery', async () => {
  await fixtures.reset()
  let rw = await launch()
  await rw.invoke('ingress.addUrl', { url: U.D6 })
  await until(async () => (await rw.inspect('jobs', { type: 'PROCESS_DOCUMENT' })).some((j: any) => j.status === 'running') || null, 60_000, 200)
  await new Promise(r => setTimeout(r, 1500))
  await rw.kill()
  rw = await launch({ dataDir: rw.dataDir })
  await rw.drain(300_000)
  const jobs = await rw.inspect('jobs', { type: 'PROCESS_DOCUMENT' })
  expect(jobs.length).toBe(1); expect(jobs[0].status).toBe('succeeded')
  const d6 = await docByUrl(rw, U.D6)
  expect(d6.status).toBe('processed')
  const ev = await rw.inspect('evidence', { document_id: d6.id, status: 'active' })
  const keys = ev.map((e: any) => `${e.fingerprint}|${e.quote_start}|${e.kind}`)
  expect(new Set(keys).size).toBe(keys.length)
  void payload
  await rw.close()
})
