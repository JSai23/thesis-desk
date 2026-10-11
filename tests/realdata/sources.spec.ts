// Real-source pipeline verification (DEC-087). No fixtures: a clean profile subscribes to real sites of every
// automatic source type and the source lifecycle is exercised end to end on what they publish today —
// first sync (24 h + 5 newest), Sync now, Read once, Load older posts (7 days), the daily scheduled sync, the
// processing pipeline to a terminal state, and a restart. The fake clock starts at the real time so the daily
// sync can be driven forward; every fetch is a real network request. Results: tests/results/<run>/realdata-sources.json.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, until, ROOT, type RW } from '../harness/app'

const H = 3600_000, DAY = 24 * H
const SOURCES: { locator: string; kind: string; mode?: string; instruction?: string }[] = [
  { locator: 'https://techcrunch.com/category/startups/feed/', kind: 'rss', mode: 'custom', instruction: 'Only startup funding rounds, acquisitions and major product launches' },
  { locator: 'https://news.crunchbase.com/feed/', kind: 'rss' },
  { locator: 'https://www.ycombinator.com/blog/rss/', kind: 'rss' },
  { locator: 'https://hacker-news.firebaseio.com/v0', kind: 'hn_api', mode: 'relevant' },
  { locator: 'https://a16z.com/news-content/', kind: 'web' },
  { locator: 'https://paulgraham.com/articles.html', kind: 'web' },
  { locator: 'https://news.google.com/rss/search?q=%22raises%22+%22seed+round%22+when:7d&hl=en-US&gl=US&ceid=US:en', kind: 'search' }
]
const READ_ONCE = 'https://paulgraham.com/greatwork.html' // a real essay outside every first-sync window
const OUT = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev', 'realdata-sources.json')
const out: Record<string, any> = { started: new Date().toISOString() }
const save = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 2)) }

const TERMINAL = ['processed', 'duplicate', 'triaged_out', 'failed']
export const fetchesIdle = async (rw: RW, ms = 30 * 60_000) => until(async () => {
  const busy = (await rw.inspect('jobs')).filter((j: any) => ['FETCH_SOURCE', 'CONFIGURE_SOURCE'].includes(j.type) && ['queued', 'running'].includes(j.status) && j.error_code !== 'PARKED')
  return busy.length ? null : true
}, ms, 3000)
async function perSource(rw: RW) {
  const [srcs, links, docs] = await Promise.all([rw.inspect('sources'), rw.inspect('document_sources'), rw.inspect('documents')])
  const byId = new Map(docs.map((d: any) => [d.id, d]))
  return srcs.filter((s: any) => s.kind !== 'manual' && !s.deleted_at).map((s: any) => ({ ...s, docs: links.filter((l: any) => l.source_id === s.id).map((l: any) => byId.get(l.document_id)).filter(Boolean) as any[] }))
}
const urlDupes = (docs: any[]) => {
  const n = new Map<string, number>()
  for (const d of docs) if (d.canonical_url || d.url) n.set(d.canonical_url || d.url, (n.get(d.canonical_url || d.url) || 0) + 1)
  return [...n].filter(([, c]) => c > 1).map(([u]) => u)
}

test.describe.serial('RD-SRC real sources: lifecycle and pipeline', () => {
  let rw: RW
  let t0 = 0
  test.beforeAll(async () => {
    test.setTimeout(30 * 60_000)
    t0 = Date.now()
    rw = await launch({ testNow: new Date(t0).toISOString() }) // fake clock = real time, so the daily sync can be advanced
    await rw.invoke('settings.update', { patch: { 'processing.daily_cap': 1000 } })
    await rw.invoke('thesis.create', { title: 'AI applications' })
    await rw.invoke('thesis.create', { title: 'Developer tools and infrastructure' })
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('RD-SRC-01 every automatic source type subscribes to a real site and first-syncs from today', async () => {
    test.setTimeout(45 * 60_000)
    out.probe = {}
    for (const s of SOURCES) {
      const probe = await rw.invoke('source.probe', { locator: s.locator })
      out.probe[s.locator] = { status: probe.status, kind: probe.kind, name: probe.name }
      if (probe.status !== 'found') continue
      expect(probe.kind, s.locator).toBe(s.kind)
      await rw.invoke('source.create', { locator: s.locator, mode: s.mode || 'all', instruction: s.instruction || '', freq: 'daily', thesisIds: [], probe })
    }
    await fetchesIdle(rw)
    const ps = await perSource(rw)
    out.firstSync = ps.map(s => ({ name: s.name, kind: s.kind, health: s.health, docs: s.docs.length, today: s.docs.filter((d: any) => d.published_at >= t0 - DAY).length, olderOrUndated: s.docs.filter((d: any) => !(d.published_at >= t0 - DAY)).length }))
    save()
    // every type is covered by at least one reachable real site; a site being down is external, not an app failure
    for (const kind of ['rss', 'web', 'hn_api', 'search']) expect(ps.some(s => s.kind === kind), `a ${kind} source subscribed`).toBe(true)
    expect(ps.length).toBeGreaterThanOrEqual(SOURCES.length - 1)
    for (const s of ps) {
      expect(s.health, `${s.name} healthy`).toBe('ok')
      expect(s.last_success_at, `${s.name} synced`).toBeTruthy()
      expect(s.docs.length, `${s.name} ingested something`).toBeGreaterThan(0)
      // DEC-085: first sync = published in the last 24 h, topped up to the 5 newest — never the whole archive
      // HN's window is the submission time; a story submitted today may link to an older article (its own date)
      if (s.kind === 'hn_api') expect(s.docs.length, `${s.name}: one sync's worth`).toBeLessThanOrEqual(30)
      else expect(s.docs.filter((d: any) => !(d.published_at >= t0 - DAY)).length, `${s.name}: older/undated beyond the floor of 5`).toBeLessThanOrEqual(5)
      expect(s.name, 'source names say whose they are').not.toMatch(/^(essays?|blog|news|articles?)$/i)
    }
    expect(urlDupes(await rw.inspect('documents')), 'one document per URL').toEqual([])
  })

  test('RD-SRC-02 Sync now on every source is idempotent (no re-ingest, cursor holds)', async () => {
    test.setTimeout(30 * 60_000)
    const before = (await rw.inspect('documents')).length
    const ps = await perSource(rw)
    const ids0 = new Set((await rw.inspect('documents')).map((d: any) => d.id))
    for (const s of ps) await rw.invoke('source.syncNow', { id: s.id })
    await fetchesIdle(rw)
    const after = await rw.inspect('documents')
    // which source brought each new document, and how old it is (a re-ingest shows up as old + "new")
    const added = (await perSource(rw)).map(s => ({ name: s.name, kind: s.kind, added: s.docs.filter((d: any) => !ids0.has(d.id)).map((d: any) => ({ title: d.title.slice(0, 70), published: d.published_at ? new Date(d.published_at).toISOString().slice(0, 16) : null, url: d.url })) })).filter(x => x.added.length)
    out.syncNow = { before, after: after.length, added }
    // sites may publish between the two syncs; anything new must be genuinely new (no URL twice)
    expect(after.length - before).toBeLessThanOrEqual(ps.length * 2)
    expect(urlDupes(after)).toEqual([])
    for (const s of await perSource(rw)) expect(s.health, `${s.name} still healthy`).toBe('ok')
    save()
  })

  test('RD-SRC-03 Read once fetches a real article on demand and processes it', async () => {
    test.setTimeout(15 * 60_000)
    await rw.invoke('ingress.addUrl', { url: READ_ONCE })
    const doc = await until(async () => (await rw.inspect('documents')).find((d: any) => (d.canonical_url || d.url || '').includes('greatwork') && TERMINAL.includes(d.status)) || null, 12 * 60_000, 3000)
    out.readOnce = { status: doc.status, title: doc.title, chars: doc.text.length }
    expect(doc.status).toBe('processed')
    expect(doc.text.length).toBeGreaterThan(5000)
    expect(doc.title).toMatch(/great work/i)
    await rw.invoke('ingress.addUrl', { url: READ_ONCE }); await fetchesIdle(rw)
    expect((await rw.inspect('documents')).filter((d: any) => (d.canonical_url || d.url || '').includes('greatwork')).length, 'the same URL again is not re-ingested').toBe(1)
    save()
  })

  test('RD-SRC-04 Load older posts (7 days) backfills real history inside the window, and only once', async () => {
    test.setTimeout(45 * 60_000)
    const targets = (await perSource(rw)).filter(s => ['rss', 'search'].includes(s.kind)).slice(0, 3)
    out.backfill = []
    for (const s of targets) {
      const before = new Set(s.docs.map((d: any) => d.id))
      await rw.invoke('source.backfill', { id: s.id, days: 7 }); await fetchesIdle(rw)
      const docs = (await perSource(rw)).find(x => x.id === s.id)!.docs
      const added = docs.filter((d: any) => !before.has(d.id))
      await rw.invoke('source.backfill', { id: s.id, days: 7 }); await fetchesIdle(rw)
      const again = (await perSource(rw)).find(x => x.id === s.id)!.docs.length - docs.length
      out.backfill.push({ name: s.name, before: before.size, added: added.length, outside7d: added.filter((d: any) => d.published_at && d.published_at < t0 - 7 * DAY - H).length, secondRun: again })
      save()
      for (const d of added) if (d.published_at) expect(d.published_at, `${s.name}: ${d.title} within 7 days`).toBeGreaterThanOrEqual(t0 - 7 * DAY - H)
      expect(again, `${s.name}: a second backfill adds nothing`).toBeLessThanOrEqual(1)
    }
    expect(out.backfill.some((b: any) => b.added > 0), 'a real feed had older posts to bring in').toBe(true)
    expect(urlDupes(await rw.inspect('documents'))).toEqual([])
  })

  test('RD-SRC-05 the daily scheduled sync fires for every source and fetches only new posts', async () => {
    test.setTimeout(30 * 60_000)
    const before = (await rw.inspect('documents')).length
    const jobsBefore = new Set((await rw.inspect('jobs')).map((j: any) => j.id))
    await rw.invoke('test.clock.advance', { ms: 25 * H })
    await rw.invoke('test.scheduler.tick', {})
    await fetchesIdle(rw)
    const sched = (await rw.inspect('jobs')).filter((j: any) => !jobsBefore.has(j.id) && j.type === 'FETCH_SOURCE' && JSON.parse(j.payload_json).trigger === 'schedule')
    const ps = await perSource(rw)
    out.daily = { scheduledJobs: sched.map((j: any) => j.status), docsBefore: before, docsAfter: (await rw.inspect('documents')).length }
    save()
    expect(new Set(sched.map((j: any) => JSON.parse(j.payload_json).sourceId)).size, 'one scheduled fetch per daily source').toBe(ps.length)
    expect(sched.every((j: any) => j.status === 'succeeded'), 'scheduled fetches succeeded').toBe(true)
    expect(urlDupes(await rw.inspect('documents'))).toEqual([])
  })

  test('RD-SRC-06 every real document goes through the pipeline to a terminal state with grounded output', async () => {
    test.setTimeout(240 * 60_000)
    const d = await rw.drain(230 * 60_000)
    const docs = await rw.inspect('documents')
    const jobs = await rw.inspect('jobs')
    const ev = (await rw.inspect('evidence')).filter((e: any) => e.status === 'active')
    const vers = await rw.inspect('document_versions')
    const byStatus: Record<string, number> = {}
    for (const x of docs) byStatus[x.status] = (byStatus[x.status] || 0) + 1
    const ps = await perSource(rw)
    // a reader picking up page chrome instead of the article gives many pages of one site the same text
    const sameText = ps.map(s => {
      const seen = new Map<string, number>()
      for (const x of s.docs.filter((x: any) => x.status === 'processed')) seen.set(x.text.slice(0, 400), (seen.get(x.text.slice(0, 400)) || 0) + 1)
      return { name: s.name, repeated: [...seen.values()].filter(n => n > 1).reduce((a, b) => a + b, 0) }
    })
    const failed = docs.filter((x: any) => x.status === 'failed').map((x: any) => ({ url: x.url, error: x.error_code || x.error_message }))
    const dupBad = docs.filter((x: any) => x.status === 'duplicate' && !docs.some((y: any) => y.id === x.duplicate_of_id))
    const feed = (await rw.invoke('feed.list', { viewSpec: { segment: 'all' } })).items
    const tc = ps.find(s => s.mode === 'custom')
    out.pipeline = { drained: d.drained, byStatus, evidence: ev.length, failed, sameText, deadJobs: jobs.filter((j: any) => j.status === 'failed').map((j: any) => ({ type: j.type, error: j.error_code })), feedItems: feed.length,
      companies: (await rw.inspect('companies')).length, firms: (await rw.inspect('firms')).length, people: (await rw.inspect('people')).length,
      custom: tc ? { kept: tc.docs.filter((x: any) => x.status === 'processed').length, dropped: tc.docs.filter((x: any) => x.status === 'triaged_out').length } : null }
    save()
    expect(d.drained, 'queue drained').toBe(true)
    expect(docs.filter((x: any) => !TERMINAL.includes(x.status)).map((x: any) => x.url), 'no document stuck mid-pipeline').toEqual([])
    expect(failed.length / docs.length, 'failed documents (paywalls, dead links) stay rare').toBeLessThanOrEqual(0.1)
    expect(dupBad, 'duplicates point at a real original').toEqual([])
    for (const s of sameText) expect(s.repeated, `${s.name}: distinct article text per page`).toBe(0)
    expect(byStatus.processed).toBeGreaterThanOrEqual(30)
    expect(ev.length).toBeGreaterThanOrEqual(50)
    for (const e of ev) {
      const v = vers.find((x: any) => x.document_id === e.document_id && x.version === e.document_version)
      expect(v.text.slice(e.quote_start, e.quote_end), `evidence ${e.id} quote is verbatim`).toBe(e.quote)
    }
    expect(feed.length).toBeGreaterThan(0)
    for (const it of feed) expect(it.reasonLine || it.reasons?.length, 'every feed card says why').toBeTruthy()
  })

  test('RD-SRC-07 restart keeps sources, cursors and library; the next sync stays incremental', async () => {
    test.setTimeout(30 * 60_000)
    const before = { sources: (await perSource(rw)).map(s => [s.id, s.cursor_json]), docs: (await rw.inspect('documents')).length }
    rw = await rw.restart()
    const after = await perSource(rw)
    expect(after.map(s => [s.id, s.cursor_json])).toEqual(before.sources)
    expect((await rw.inspect('documents')).length).toBe(before.docs)
    for (const s of after) await rw.invoke('source.syncNow', { id: s.id })
    await fetchesIdle(rw)
    const docs = await rw.inspect('documents')
    out.restart = { docsBefore: before.docs, docsAfterSync: docs.length }
    expect(docs.length - before.docs).toBeLessThanOrEqual(after.length * 2)
    expect(urlDupes(docs)).toEqual([])
    save()
  })
})
