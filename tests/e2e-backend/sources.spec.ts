// RFC §3A source lifecycle: E2E-SRC-01…05.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, until, type RW } from '../harness/app'
import { fixtures } from '../harness/fixtures'
import { U, H, D, corpusTheses, addSource, docByUrl, company } from './common'

/** SRC-01/02 shared state: Signal Wire ingested, an alert matching D5, and the user's marks on D1/D3/D4/D5 and Lumen. */
async function srcSetup(rw: RW) {
  const th = await corpusTheses(rw)
  const al = await rw.invoke('alert.compile', { text: 'Tell me when a company hires a new executive' })
  await rw.drain(300_000)
  await rw.invoke('alert.activate', { id: al.alertId, channels: ['in_app'] })
  const sw = await addSource(rw, U.swFeed)
  await rw.drain(500_000)
  const d1 = await docByUrl(rw, U.D1), d3 = await docByUrl(rw, U.D3), d4 = await docByUrl(rw, U.D4), d5 = await docByUrl(rw, U.D5)
  expect((await rw.inspect('notifications', { alert_rule_id: al.alertId })).some((n: any) => n.document_id === d5.id), 'alert matched D5').toBe(true)
  const note = await rw.invoke('note.create', { text: 'The 58% ceiling is the number to watch for support automation.', documentId: d4.id, anchor: { type: 'none' } })
  const q = 'Beacon Hill Partners also participated in the round.'
  const start = d1.text.indexOf(q)
  expect(start).toBeGreaterThan(-1)
  const hl = await rw.invoke('evidence.highlight', { documentId: d1.id, start, end: start + q.length })
  await rw.invoke('link.attach', { fromType: 'document', fromId: d4.id, thesisId: th.labor.id, stance: 'contra' })
  const lumen = await company(rw, 'Lumen Legal')
  await rw.invoke('field.set', { objectType: 'company', objectId: lumen.id, key: 'stage', value: 'Series B' })
  const d3ev = new Set((await rw.inspect('evidence', { document_id: d3.id })).map((e: any) => e.id))
  let rel = (await rw.inspect('relationships', { to_type: 'thesis', to_id: th.legal.id })).find((r: any) => r.from_id === d3.id || d3ev.has(r.from_id))
  if (!rel) { await rw.invoke('link.attach', { fromType: 'document', fromId: d3.id, thesisId: th.legal.id }); rel = (await rw.inspect('relationships', { from_type: 'document', from_id: d3.id, to_id: th.legal.id }))[0] }
  await rw.invoke('link.reject', { relId: rel.id })
  const item = async (docId: string) => (await rw.inspect('feed_items', { document_id: docId }))[0]
  await rw.invoke('feed.dismiss', { ids: [(await item(d5.id)).id] })
  await rw.invoke('feed.save', { ids: [(await item(d1.id)).id], saved: true })
  return { th, sw, al, d1, d3, d4, d5, note, hl, lumen }
}

test('E2E-SRC-01 reset and re-ingest preserves user state', async () => {
  await fixtures.reset()
  const rw = await launch()
  const s = await srcSetup(rw)
  const docs = [s.d1, s.d3, s.d4, s.d5]
  const gen0 = new Map((await rw.inspect('documents')).map((d: any) => [d.id, d.ai_generation]))
  const items0 = new Map((await rw.inspect('feed_items')).map((i: any) => [i.id, i]))
  const notif0 = (await rw.inspect('notifications')).length
  const aiEv0 = (await rw.inspect('evidence')).filter((e: any) => e.origin === 'ai_extraction' && !e.kept && e.status === 'active' && docs.some(d => d.id === e.document_id))
  await rw.invoke('source.reset', { id: s.sw.id })
  await rw.drain(600_000)
  const src = (await rw.inspect('sources', { id: s.sw.id }))[0]
  expect(src.cursor_json).toBeTruthy()
  for (const d of docs) expect((await rw.inspect('documents', { id: d.id }))[0].ai_generation).toBe(gen0.get(d.id) + 1)
  // user state untouched
  const note = (await rw.inspect('notes', { id: s.note.id }))[0]
  expect(note.text).toBe('The 58% ceiling is the number to watch for support automation.'); expect(note.deleted_at).toBeNull()
  const hl = (await rw.inspect('evidence', { origin: 'user_highlight' }))
  expect(hl.length).toBe(1); expect(hl[0].status).toBe('active')
  const acc = await rw.inspect('relationships', { from_type: 'document', from_id: s.d4.id, to_id: s.th.labor.id })
  expect(acc[0].status).toBe('accepted'); expect(acc[0].stance).toBe('contra')
  const stage = await rw.inspect('field_values', { object_type: 'company', object_id: s.lumen.id, field_key: 'stage' })
  expect(stage.find((f: any) => f.status === 'current')).toMatchObject({ display: 'Series B', origin: 'user' })
  expect(stage.some((f: any) => f.status === 'proposed' && f.display === 'Series A')).toBe(true)
  // rejected link stays rejected and is not re-suggested
  const d3ev = new Set((await rw.inspect('evidence', { document_id: s.d3.id })).map((e: any) => e.id))
  const d3links = (await rw.inspect('relationships', { to_type: 'thesis', to_id: s.th.legal.id })).filter((r: any) => r.from_id === s.d3.id || d3ev.has(r.from_id))
  expect(d3links.some((r: any) => r.status === 'rejected')).toBe(true)
  expect(d3links.some((r: any) => r.status === 'suggested' || r.status === 'accepted')).toBe(false)
  // feed state
  const items = await rw.inspect('feed_items')
  for (const it of items) {
    const before: any = items0.get(it.id)
    if (!before) continue
    expect(it.read_at).toBe(before.read_at); expect(it.surfaced_at).toBe(before.surfaced_at)
  }
  expect(items.find((i: any) => i.document_id === s.d5.id).dismissed_at).toBeTruthy()
  expect(items.find((i: any) => i.document_id === s.d1.id).saved_at).toBeTruthy()
  // old-generation AI evidence superseded (kept), new generation active and not novel
  const ev = await rw.inspect('evidence')
  for (const e of aiEv0) expect(ev.find((x: any) => x.id === e.id).status).toBe('superseded')
  const fresh = ev.filter((e: any) => e.origin === 'ai_extraction' && e.status === 'active' && docs.some(d => d.id === e.document_id && e.ai_generation === gen0.get(d.id) + 1))
  expect(fresh.length).toBeGreaterThan(0)
  for (const e of fresh) expect(e.is_novel).toBe(0)
  expect((await rw.inspect('notifications')).length).toBe(notif0)
  await rw.close()
})

test('E2E-SRC-02 delete and retention', async () => {
  await fixtures.reset()
  const rw = await launch()
  const s = await srcSetup(rw)
  const quill = await company(rw, 'Quillmate')
  const visible = async () => new Set((await rw.invoke('feed.list', { viewSpec: { segment: 'all' } })).items.map((i: any) => i.documentId))
  const all0 = new Set((await rw.inspect('feed_items')).filter((i: any) => !i.hidden_reason).map((i: any) => i.document_id))
  await rw.invoke('source.remove', { id: s.sw.id })
  let items = await rw.inspect('feed_items')
  const hidden = (id: string) => !!items.find((i: any) => i.document_id === id)?.hidden_reason
  expect(hidden(s.d3.id)).toBe(true); expect(hidden(s.d5.id)).toBe(true)
  expect(hidden(s.d1.id)).toBe(false); expect(hidden(s.d4.id)).toBe(false)
  // restore before purge → all visible again
  await rw.invoke('source.restore', { id: s.sw.id })
  items = await rw.inspect('feed_items')
  expect(new Set(items.filter((i: any) => !i.hidden_reason).map((i: any) => i.document_id))).toEqual(all0)
  void visible
  // remove again, 31 days later the maintenance purge runs
  await rw.invoke('source.remove', { id: s.sw.id })
  await rw.invoke('test.clock.advance', { ms: 31 * D })
  await rw.invoke('test.scheduler.tick')
  await rw.drain(300_000)
  await until(async () => (await rw.inspect('documents', { id: s.d3.id })).length === 0 || null, 60_000)
  for (const d of [s.d1, s.d4]) expect((await rw.inspect('documents', { id: d.id })).length).toBe(1)
  for (const d of [s.d3, s.d5]) {
    await expect(rw.invoke('document.get', { id: d.id })).rejects.toThrow(/NOT_FOUND|not found/i)
    expect(fs.existsSync(path.join(rw.dataDir, 'content', d.id))).toBe(false)
  }
  const stage = (await rw.inspect('field_values', { object_type: 'company', object_id: s.lumen.id, field_key: 'stage', status: 'current' }))[0]
  expect(stage).toMatchObject({ display: 'Series B', origin: 'user' })
  const evIds = new Set((await rw.inspect('evidence')).map((e: any) => e.id))
  for (const fv of await rw.inspect('field_values')) if (fv.origin !== 'user' && fv.evidence_id) expect(evIds.has(fv.evidence_id)).toBe(true)
  if (quill) {
    const hq = await rw.inspect('field_values', { object_type: 'company', object_id: quill.id, field_key: 'hq', status: 'current' })
    for (const f of hq) expect(evIds.has(f.evidence_id)).toBe(true)
  }
  const n = (await rw.inspect('notifications', { alert_rule_id: s.al.alertId })).find((x: any) => x.title && x.evidence_id === null)
  expect(n, 'notification from D5 survives with NULL evidence').toBeTruthy()
  await rw.close()
})

test('E2E-SRC-03 pause', async () => {
  await fixtures.reset()
  const rw = await launch()
  const sw = await addSource(rw, U.swFeed, { freq: 'hourly' })
  await rw.drain(500_000)
  await rw.invoke('source.setEnabled', { id: sw.id, enabled: false })
  const fetches = async () => (await rw.inspect('jobs', { type: 'FETCH_SOURCE' })).filter((j: any) => JSON.parse(j.payload_json).sourceId === sw.id).length
  const before = await fetches()
  await rw.invoke('test.clock.advance', { ms: 2 * H }); await rw.invoke('test.scheduler.tick')
  expect(await fetches()).toBe(before)
  await rw.invoke('source.setEnabled', { id: sw.id, enabled: true })
  await rw.invoke('test.scheduler.tick')
  expect(await fetches()).toBe(before + 1)
  await rw.drain(300_000)
  await rw.close()
})

test('E2E-SRC-04 mute', async () => {
  await fixtures.reset()
  const rw = await launch()
  const al = await rw.invoke('alert.compile', { text: 'Tell me when a company announces a partnership' })
  await rw.drain(300_000)
  await rw.invoke('alert.activate', { id: al.alertId, channels: ['in_app'] })
  const sw = await addSource(rw, U.swFeed, { freq: 'hourly' })
  await rw.drain(500_000)
  await rw.invoke('source.mute', { id: sw.id, muted: true })
  await fixtures.epoch(2)
  await rw.invoke('test.clock.advance', { ms: 61 * 60_000 }); await rw.invoke('test.scheduler.tick')
  await rw.drain(500_000)
  const d18 = await docByUrl(rw, U.D18)
  expect(d18, 'D18 ingested').toBeTruthy()
  const it = (await rw.inspect('feed_items', { document_id: d18.id }))[0]
  expect(it.hidden_reason).toBe('muted')
  const today = (await rw.invoke('feed.list', { viewSpec: { segment: 'today' } })).items
  expect(today.some((i: any) => i.documentId === d18.id)).toBe(false)
  const evalJobs = (await rw.inspect('jobs', { type: 'EVALUATE_ALERTS' })).filter((j: any) => JSON.parse(j.payload_json).documentId === d18.id)
  expect(evalJobs.some((j: any) => j.status === 'succeeded')).toBe(true)
  expect((await rw.inspect('notifications', { alert_rule_id: al.alertId })).some((n: any) => n.document_id === d18.id)).toBe(true)
  await rw.invoke('test.clock.advance', { ms: 7 * D + H }); await rw.invoke('test.scheduler.tick')
  await rw.drain(300_000)
  await until(async () => (await rw.inspect('feed_items', { document_id: d18.id }))[0].hidden_reason === null || null, 60_000)
  await rw.close()
})

test('E2E-SRC-05 probe classification', async () => {
  await fixtures.reset()
  const rw = await launch()
  const p = (locator: string) => rw.invoke('source.probe', { locator })
  expect(await p(U.swFeed)).toMatchObject({ status: 'found', kind: 'rss' })
  expect(await p('http://vln.test:4700/')).toMatchObject({ status: 'found', kind: 'web' })
  const nw = await p('http://northwind.test:4700/')
  expect(nw).toMatchObject({ status: 'found', kind: 'web' })
  expect(nw.trust).toBe('primary'); expect(nw.typeLabel).toBe('VC blog')
  expect(await p(U.hn)).toMatchObject({ status: 'found', kind: 'hn_api' })
  expect((await p('producthunt.com/posts/a')).status).toBe('unsupported')
  expect((await p('http://gone.test:4700/')).status).toBe('unreachable')
  expect((await p('http://robots-blocked.test:4700/')).status).toBe('blocked')
  expect((await p('http://ledger.test:4700/')).status).toBe('login_required')
  await rw.close()
})

test('E2E-SRC-06 first sync starts today; backfill loads older posts on request (DEC-085)', async () => {
  await fixtures.reset()
  const rw = await launch() // clock 2026-09-29 09:00 PDT; archive.test posts every 3 days from Sep 29 back to Aug 27
  const src = await addSource(rw, 'http://archive.test:4700/feed.xml')
  await rw.drain(500_000)
  const titles = async () => (await rw.inspect('documents')).filter((d: any) => /archive\.test/.test(d.url || '')).map((d: any) => d.title).sort()
  // only post 1 is from the last 24 h → topped up to the 5 newest
  expect(await titles()).toEqual(['Archive note 1', 'Archive note 2', 'Archive note 3', 'Archive note 4', 'Archive note 5'])
  // nothing older arrives on a normal sync
  await rw.invoke('source.syncNow', { id: src.id }); await rw.drain(300_000)
  expect((await titles()).length).toBe(5)
  // Load older posts → last 30 days: posts 6–10 (Sep 14 … Sep 2); post 11 (Aug 30 09:00 UTC) is just outside
  const done = rw.page.evaluate(() => new Promise<any>(r => { const off = (window as any).rw.on('source.syncCompleted', (p: any) => { if (p.trigger === 'backfill') { off(); r(p) } }) }))
  await rw.invoke('source.backfill', { id: src.id, days: 30 })
  const ev = await done
  await rw.drain(500_000)
  expect(ev.new).toBe(5); expect(ev.toast).toMatch(/5 older posts added from the last 30 days/)
  expect((await titles()).length).toBe(10)
  await rw.invoke('source.backfill', { id: src.id, days: 90 }); await rw.drain(400_000)
  expect((await titles()).length).toBe(12)
  // re-running a backfill adds nothing (dedupe)
  await rw.invoke('source.backfill', { id: src.id, days: 90 }); await rw.drain(300_000)
  expect((await titles()).length).toBe(12)
  await rw.close()
})
