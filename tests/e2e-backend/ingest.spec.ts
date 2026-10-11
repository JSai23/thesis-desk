// RFC §3A ingestion: E2E-ING-01…08, E2E-VER-01.
import { test, expect } from '@playwright/test'
import path from 'node:path'
import { launch, installEmail, ROOT, until } from '../harness/app'
import { fixtures } from '../harness/fixtures'
import { imapAppend, imapCleanup } from '../harness/imap'
import { U, MIN, addSource, docByUrl, company, firm, activeEvidence, payload } from './common'

test('E2E-ING-01/02 first and repeat ingestion', async () => {
  await fixtures.reset()
  const rw = await launch()
  const sw = await addSource(rw, U.swFeed)
  await rw.drain(400_000)
  const ds = await rw.inspect('document_sources', { source_id: sw.id })
  expect(ds.length).toBe(4)
  const docs = await rw.inspect('documents')
  for (const u of [U.D1, U.D3, U.D4, U.D5]) {
    const d = docs.find((x: any) => x.url === u)
    expect(d, u).toBeTruthy()
    expect(d.status).toBe('processed')
    expect(ds.some((r: any) => r.document_id === d.id)).toBe(true)
  }
  const s = await rw.invoke('source.get', { id: sw.id })
  expect(s.health).toBe('ok'); expect(s.lastSuccessAt).toBeTruthy()

  // ING-02: repeat → 0 new documents, 0 new EXTRACT runs, event counts {new:0, updated:0}
  const extractRuns = async () => (await rw.inspect('agent_runs', { task: 'EXTRACT_DOCUMENT' })).length
  const runsBefore = await extractRuns(), docsBefore = docs.length
  const ev = rw.page.evaluate(() => new Promise<any>(r => { const off = (window as any).rw.on('source.syncCompleted', (p: any) => { off(); r(p) }) }))
  await rw.invoke('source.syncNow', { id: sw.id })
  const done = await ev
  await rw.drain(300_000)
  expect(done.new).toBe(0); expect(done.updated).toBe(0)
  expect((await rw.inspect('documents')).length).toBe(docsBefore)
  expect(await extractRuns()).toBe(runsBefore)
  await rw.close()
})

test('E2E-ING-03 + E2E-VER-01 changed content and version supersession', async () => {
  await fixtures.reset()
  const rw = await launch()
  const nw = await addSource(rw, U.nwBlog)
  await rw.drain(400_000)
  const d7 = await docByUrl(rw, U.D7)
  expect(d7.status).toBe('processed')
  const ev1 = await activeEvidence(rw, d7.id)
  const fnw2 = ev1.find((e: any) => e.quote.includes("Northwind partner Priya Raman will join Lumen Legal's board."))
  const f18 = ev1.find((e: any) => e.kind === 'funding' && payload(e).amountUsd === 18_000_000)
  expect(fnw2, 'F-NW-2 evidence').toBeTruthy(); expect(f18, '$18M funding evidence').toBeTruthy()
  // VER-01 setup: keep F-NW-2, read + save D7
  await rw.invoke('evidence.keep', { id: fnw2.id })
  const item = (await rw.inspect('feed_items', { document_id: d7.id }))[0]
  await rw.invoke('feed.markRead', { ids: [item.id], read: true })
  await rw.invoke('feed.save', { ids: [item.id], saved: true })

  await fixtures.epoch(2)
  await rw.invoke('source.syncNow', { id: nw.id })
  await rw.drain(400_000)
  const d7b = (await rw.inspect('documents', { id: d7.id }))[0]
  expect(d7b.current_version).toBe(2)
  const vers = await rw.inspect('document_versions', { document_id: d7.id })
  expect(vers.find((v: any) => v.version === 1).text).toContain('$18 million Series A')
  expect(vers.find((v: any) => v.version === 2).text).toContain('expanded to $20 million')
  const all = await rw.inspect('evidence', { document_id: d7.id })
  const f20 = all.find((e: any) => e.status === 'active' && e.kind === 'funding' && payload(e).amountUsd === 20_000_000)
  expect(f20, '$20M funding evidence from v2').toBeTruthy()
  expect(f20.document_version).toBe(2)
  expect(all.find((e: any) => e.id === f18.id).status).toBe('superseded')
  // VER-01: kept F-NW-2 re-anchored (same id, v2 offsets)
  const k = all.find((e: any) => e.id === fnw2.id)
  expect(k.status).toBe('active'); expect(k.document_version).toBe(2)
  expect(vers.find((v: any) => v.version === 2).text.slice(k.quote_start, k.quote_end)).toBe(k.quote)
  // superseded evidence's relationship_evidence rows superseded; invested_in Northwind→Lumen still accepted
  for (const re of await rw.inspect('relationship_evidence', { evidence_id: f18.id })) expect(re.status).toBe('superseded')
  const lumen = await company(rw, 'Lumen Legal'), nwf = await firm(rw, /^Northwind/)
  const inv = (await rw.inspect('relationships', { from_type: 'firm', from_id: nwf.id, to_type: 'company', to_id: lumen.id, rel: 'invested_in' }))
  expect(inv.length).toBe(1); expect(inv[0].status).toBe('accepted')
  expect(f20.is_novel).toBe(1); expect(payload(f20).previousEvidenceId).toBe(f18.id)
  // latest round shows $20M
  const page = await rw.invoke('object.get', { type: 'company', id: lumen.id })
  const lr = [...page.main, ...page.rail].find((s: any) => s.component === 'funding_table' || s.component === 'latest_round')
  expect(JSON.stringify(lr.data)).toMatch(/\$20M|\$20 million|20,000,000/)
  // feed item re-surfaced with "Updated since you read it", still saved
  const it2 = (await rw.inspect('feed_items', { id: item.id }))[0]
  expect(it2.saved_at).toBeTruthy(); expect(it2.read_at).toBeNull()
  expect(JSON.parse(it2.reasons_json)[0].label).toBe('Updated since you read it')
  await rw.close()
})

test('E2E-ING-04 duplicate content', async () => {
  await fixtures.reset()
  const rw = await launch()
  await rw.invoke('ingress.addUrl', { url: U.D1 })
  await rw.drain(300_000)
  await rw.invoke('ingress.addUrl', { url: U.D2 })
  await rw.drain(300_000)
  const d1 = await docByUrl(rw, U.D1), d2 = await docByUrl(rw, U.D2)
  expect(d2.status).toBe('duplicate'); expect(d2.duplicate_of_id).toBe(d1.id)
  const items = (await rw.inspect('feed_items')).filter((i: any) => i.document_id === d1.id || i.document_id === d2.id)
  expect(items.length).toBe(1)
  expect((await rw.inspect('document_sources', { document_id: d1.id, source_id: 'src_manual' })).length).toBe(1)
  await rw.close()
})

test('E2E-ING-05 cross-source same URL', async () => {
  await fixtures.reset()
  const rw = await launch()
  const hn = await addSource(rw, U.hn, { mode: 'all' })
  const sf = await addSource(rw, U.sfBlog)
  await rw.drain(500_000)
  const d9s = (await rw.inspect('documents')).filter((d: any) => d.canonical_url === U.D9 || d.url === U.D9)
  expect(d9s.length).toBe(1)
  const srcs = (await rw.inspect('document_sources', { document_id: d9s[0].id })).map((r: any) => r.source_id).sort()
  expect(srcs).toEqual([hn.id, sf.id].sort())
  expect((await rw.inspect('feed_items', { document_id: d9s[0].id })).length).toBe(1)
  await rw.close()
})

test('E2E-ING-06 failed fetch and retry', async () => {
  await fixtures.reset()
  const rw = await launch()
  await fixtures.fail('broken/feed.xml', 200)
  const probe = await rw.invoke('source.probe', { locator: 'http://broken.test:4700/feed.xml' })
  await fixtures.fail('broken/feed.xml', 'off')
  const br = await rw.invoke('source.create', { locator: 'http://broken.test:4700/feed.xml', mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe })
  await rw.drain(60_000)
  await rw.invoke('test.clock.advance', { ms: 2 * MIN }); await rw.drain(60_000)
  await rw.invoke('test.clock.advance', { ms: 6 * MIN }); await rw.drain(60_000)
  const jobs = (await rw.inspect('jobs', { type: 'FETCH_SOURCE' })).filter((j: any) => JSON.parse(j.payload_json).sourceId === br.id)
  expect(jobs[jobs.length - 1].attempts).toBe(3); expect(jobs[jobs.length - 1].status).toBe('failed')
  const s = (await rw.inspect('sources', { id: br.id }))[0]
  expect(s.health).toBe('failing'); expect(s.last_error_code).toBe('HTTP_500')
  expect((await rw.invoke('app.status')).banners.some((b: any) => b.kind === 'source_attention' && b.sourceIds.includes(br.id))).toBe(true)
  await fixtures.fail('broken/feed.xml', 200)
  await rw.invoke('source.retry', { id: br.id }); await rw.drain(120_000)
  expect((await rw.inspect('sources', { id: br.id }))[0].health).toBe('ok')
  expect((await rw.invoke('app.status')).banners.some((b: any) => b.kind === 'source_attention')).toBe(false)
  await fixtures.fail('broken/feed.xml', 'off')
  await rw.close()
})

test('E2E-ING-07 triage filter', async () => {
  await fixtures.reset()
  const rw = await launch()
  await addSource(rw, U.hn, { mode: 'relevant' })
  await rw.drain(500_000)
  const sour = (await rw.inspect('documents')).find((d: any) => /sourdough/.test(d.url))
  expect(sour.status).toBe('triaged_out')
  expect((await rw.inspect('feed_items', { document_id: sour.id })).length).toBe(0)
  const s = await rw.invoke('search.query', { text: 'sourdough' })
  expect(s.documents.some((d: any) => d.id === sour.id)).toBe(true)
  await rw.close()
})

test('E2E-ING-08 near-duplicate email and web copy', async () => {
  await fixtures.reset()
  const rw = await launch()
  try {
    await imapAppend(path.join(ROOT, 'fixtures/email/deal-memo-daily-2026-09-25.eml'))
    await installEmail(rw)
    await addSource(rw, 'dealmemo@fixtures.research-workspace.test', { freq: 'realtime' })
    await rw.drain(300_000)
    const email = (await rw.inspect('documents')).find((d: any) => d.kind === 'email')
    expect(email.status).toBe('processed')
    await rw.invoke('ingress.addUrl', { url: U.D12w })
    await rw.drain(300_000)
    const web = await docByUrl(rw, U.D12w)
    expect(web.status).toBe('duplicate'); expect(web.duplicate_of_id).toBe(email.id)
  } finally {
    await imapCleanup()
    await rw.close()
  }
})
