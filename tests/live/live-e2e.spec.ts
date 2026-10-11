// Live end-to-end on real data (no fixtures): a clean profile subscribes to real sources, processes what they publish,
// and the core loops are checked mechanically on that real library — evidence provenance, grounded Ask with citations,
// a report built from plain English, run and emailed to the user's Gmail, and an alert compiled + backtested.
// Content is whatever the sites publish today, so assertions check structure and provenance, never specific facts.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, installEmail, until, ROOT, type RW } from '../harness/app'
import { imapHasSubject } from '../harness/imap'

const SOURCES = ['https://techcrunch.com/category/startups/feed/', 'https://news.crunchbase.com/feed/', 'https://hacker-news.firebaseio.com/v0',
  'https://a16z.com/news-content/', 'https://paulgraham.com/articles.html',
  'https://news.google.com/rss/search?q=%22raises%22+%22seed+round%22+when:7d&hl=en-US&gl=US&ceid=US:en']
const OUT = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev', 'live-e2e.json')
const report: Record<string, unknown> = { started: new Date().toISOString() }
const save = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 2)) }

test.describe.serial('LIVE-E2E real sources, real model, real Gmail', () => {
  let rw: RW
  test.beforeAll(async () => {
    test.setTimeout(60 * 60_000)
    rw = await launch({ testNow: null }) // real clock: "today" is today
    await installEmail(rw)
    await rw.invoke('thesis.create', { title: 'AI applications' })
    await rw.invoke('thesis.create', { title: 'Developer tools and infrastructure' })
    const subscribed: string[] = []
    for (const loc of SOURCES) {
      const probe = await rw.invoke('source.probe', { locator: loc })
      if (probe.status !== 'found') { report[`probe:${loc}`] = probe.status; continue }
      await rw.invoke('source.create', { locator: loc, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe })
      subscribed.push(loc)
    }
    report.subscribed = subscribed
    await rw.drain(45 * 60_000)
    save()
  })
  test.afterAll(async () => { report.finished = new Date().toISOString(); save(); await rw?.close() })

  test('LIVE-E2E-1 real articles ingested and processed with verbatim provenance', async () => {
    const docs = (await rw.inspect('documents')).filter((d: any) => d.status === 'processed')
    const ev = (await rw.inspect('evidence')).filter((e: any) => e.status === 'active')
    const vers = await rw.inspect('document_versions')
    report.processedDocuments = docs.length; report.evidence = ev.length
    report.sampleDocuments = docs.slice(0, 12).map((d: any) => ({ title: d.title, url: d.url }))
    expect(docs.length).toBeGreaterThanOrEqual(10)
    expect(ev.length).toBeGreaterThanOrEqual(20)
    for (const e of ev) {
      const v = vers.find((x: any) => x.document_id === e.document_id && x.version === e.document_version)
      expect(v.text.slice(e.quote_start, e.quote_end), `quote of ${e.id}`).toBe(e.quote)
    }
    const feed = (await rw.invoke('feed.list', { viewSpec: { segment: 'all' } })).items
    expect(feed.length).toBeGreaterThan(0)
    for (const it of feed) expect(it.reasonLine || it.reasons?.length).toBeTruthy()
    save()
  })

  test('LIVE-E2E-2 Ask over the real library: every fact cites a real document containing its quote', async () => {
    const asked: any[] = []
    for (const q of ['Which startups raised funding recently, and who invested?', 'What are the most notable AI product launches in my sources this week?']) {
      const a = await rw.invoke('query.ask', { question: q })
      const facts = a.items.filter((i: any) => i.type === 'fact')
      asked.push({ q, insufficient: a.insufficient, facts: facts.map((f: any) => f.text), citations: a.citations.map((c: any) => c.title) })
      if (!a.insufficient) expect(facts.length).toBeGreaterThan(0)
      for (const f of facts) {
        expect(f.citations.length).toBeGreaterThan(0)
        for (const n of f.citations) {
          const c = a.citations.find((x: any) => x.n === n)
          const doc = (await rw.inspect('documents', { id: c.documentId }))[0]
          expect(doc, `citation [${n}] → a document in the library`).toBeTruthy()
        }
        for (const q2 of f.quotes || []) {
          const plain = q2.replace(/^[“"']+|[”"']+$/g, '').replace(/\s+/g, ' ').trim()
          const texts = await Promise.all(f.citations.map(async (n: number) => (await rw.inspect('documents', { id: a.citations.find((x: any) => x.n === n).documentId }))[0].text.replace(/\s+/g, ' ')))
          expect(texts.some((t: string) => t.replace(/[’‘]/g, "'").includes(plain.replace(/[’‘]/g, "'").replace(/^\.\.\.|…$/g, '').trim().slice(0, 60))), `quote "${plain.slice(0, 60)}" is in a cited document`).toBe(true)
        }
      }
    }
    report.ask = asked
    expect(asked.some(x => !x.insufficient)).toBe(true)
    save()
  })

  test('LIVE-E2E-3 report from plain English, run on real data, emailed to Gmail through its briefing', async () => {
    const { reportId } = await rw.invoke('report.createFromPrompt', { text: 'Every weekday at 8am email me the top startup funding news and new AI product launches' })
    await rw.drain(10 * 60_000)
    const r = (await rw.invoke('report.list', {})).find((x: any) => x.id === reportId)
    // DEC-100: "email me" puts the report in its own briefing; the briefing is what emails it
    expect(r.status).toBe('active'); expect(r.definition.delivery.email).toBe(false); expect(r.briefings.length).toBe(1)
    const b = r.briefings[0]
    const t0 = new Date()
    await rw.invoke('briefing.sendNow', { id: b.id }); await rw.drain(10 * 60_000)
    const br = await until(async () => { const x = (await rw.invoke('briefing.runs', { id: b.id }))[0]; return x && x.status !== 'running' ? x : null }, 10 * 60_000, 2000)
    const run = await rw.invoke('report.run', { runId: br.reportRunIds[0] })
    expect(run.status).toBe('succeeded')
    const rows = run.content.sections.flatMap((s: any) => s.rows)
    report.reportSections = run.content.sections.map((s: any) => ({ title: s.title, rows: s.rows.map((x: any) => x.text).slice(0, 5) }))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) { expect(row.quote).toBeTruthy(); expect(row.url || row.documentId).toBeTruthy() }
    await until(async () => (await rw.invoke('briefing.runs', { id: b.id }))[0].emailedAt || null, 180_000, 2000)
    await until(async () => (await imapHasSubject(b.name, t0)) || null, 180_000, 5000)
    report.reportEmailed = r.name
    save()
  })

  test('LIVE-E2E-4 alert compiled and backtested against real evidence', async () => {
    const a = await rw.invoke('alert.compile', { text: 'Tell me when a startup announces a funding round' })
    await rw.drain(5 * 60_000)
    const al = (await rw.invoke('alert.list', {})).find((x: any) => x.id === a.alertId)
    expect(al.status).toBe('compiled')
    const rule = JSON.parse((await rw.inspect('alert_rules', { id: al.id }))[0].rule_json)
    expect(rule.filters.kinds).toContain('funding')
    report.alert = { summary: al.summary, backtest: al.backtestCount }
    const fundingEvidence = (await rw.inspect('evidence')).filter((e: any) => e.status === 'active' && e.kind === 'funding').length
    if (fundingEvidence) expect(al.backtestCount).toBeGreaterThan(0)
    save()
  })
})
