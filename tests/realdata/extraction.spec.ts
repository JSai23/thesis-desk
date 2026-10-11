// Real-data extraction/entity quality (DEC-092). A clean profile reads once ~17 real articles — the ones that produced
// junk in the 2026-10-01 adversarial review (tests/results/adversarial/findings.md) plus fresh funding coverage — and
// subscribes Hacker News with automatic processing parked (daily cap 0) to check HN titles and dates. Assertions:
// no generic/publisher/government junk entities, no name in both lists, no stage value its quote doesn't state, no
// duplicate visible evidence, quotes verbatim at their offsets, titles intact, reporters never tied to companies,
// no "neutral"/topic-only thesis links. Results: tests/results/<run>/realdata-extraction.json.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, until, ROOT, type RW } from '../harness/app'

const MIN = 60_000
const URLS = [
  'https://techcrunch.com/2026/09/30/google-releases-gemini-4-argon-called-its-most-powerful-model-yet/',              // journalists, TechCrunch as company/firm
  'https://techcrunch.com/2026/09/30/hackers-stole-millions-of-us-military-personnel-records-during-months-long-data-breach/', // DoD, TechCrunch website
  'https://www.prnewswire.com/news-releases/homeward-secures-120-million-series-d-equity-and-330-million-in-debt-to-expand-cash-offer-and-bridge-financing-solutions-for-real-estate-agents-and-their-clients-302895128.html', // 10× identical rows; investors as companies
  'https://www.investing.com/news/stock-market-news/homeward-raises-120m-in-series-d-on-proptech-expansion-93CH-4927757', // same round, other outlet
  'https://www.bankingdive.com/news/chartering-must-be-top-priority-fintechs-mercury-bank-jon-auxier-sofi/831810/',      // Mercury stage "Acquired" from a charter quote
  'https://www.cpapracticeadvisor.com/2026/09/30/mercury-debuts-accounting-software-for-its-digital-banking-platform/190825/', // reporter tied to Mercury
  'https://www.theguardian.com/us-news/2026/sep/30/ftc-investigation-anthropic-openai',                                 // FTC as firm; thesis stance
  'https://www.cnbc.com/2026/09/30/ftc-ai-probe-openai-anthropic.html',                                                  // CNBC as company
  'https://fortune.com/2026/10/01/ai-godfather-yann-lecun-has-zero-concerns-about-human-extinction-says-anthropic-ceo-dario-amodei-is-deuded/', // "unknown"; "AI risks overblown" as Supports
  'https://betakit.com/a16z-backed-blueprint-raises-1-4-million-to-bring-vibe-coding-to-hardware/',                      // "undisclosed angels", BetaKit
  'https://techcrunch.com/2026/09/22/a16z-is-challenging-silicon-valleys-love-for-drop-outs-by-launching-a-school/',      // YC / Harvard
  'https://www.koreaittimes.com/news/articleView.html?idxno=153546',                                                      // AWS, Claude Code, Korea IT Times
  'https://www.anthropic.com/research/what-work-can-robots-do',                                                           // astral characters before quotes
  'https://www.afr.com/street-talk/titanium-ventures-leads-30m-raise-for-ai-powered-documents-platform-20241009-p5kgzj',  // title lost its first letter
  'https://crypto.news/perptools-raises-8m-with-near-animoca-brands-joining-seed-round/',                                // 6× identical rows
  'https://techcrunch.com/2026/09/30/valor-atreides-and-sequoia-back-ai-startup-flow-engineering-at-750m-valuation/',    // fresh funding
  'https://techcrunch.com/2026/09/29/a16z-backed-eliseai-raises-350m-doubles-valuation-to-4b/',                          // fresh funding, "Late stage" from a valuation
  'https://fortune.com/2026/09/29/elise-ai-4-billion-valuation-funding-round-housing-unicorn-andreessen-bessemer/'       // same round, other outlet
]
const THESIS = { title: 'AI infrastructure and developer tools', description: 'Seed to Series B companies building inference, agent tooling, and coding infrastructure will capture outsized value as AI apps scale.' }
// names the adversarial run created as companies/firms that are publishers, institutions, places or placeholders
const JUNK = ['TechCrunch', 'CNBC', 'Reuters', 'Fortune', 'BetaKit', 'Korea IT Times', 'crypto.news', 'The Guardian', 'Banking Dive', 'Investing.com', 'PR Newswire', 'AFR', 'Australian Financial Review',
  'Federal Trade Commission', 'FTC', 'Department of Defense', 'U.S. Department of Defense', 'DoD', 'Office of Personnel Management', 'U.S. government', 'NASA', 'Harvard', 'Poland', 'United States',
  'unknown', 'startups', 'undisclosed angels', 'prominent angel investors', 'investors', 'undisclosed investors']
const PLACEHOLDER = /^(?:(?:undisclosed|unknown|unnamed|other|several|various|prominent|existing|new|angel|individual|private|strategic)\s+)*(?:investors?|angels?|backers?|startups?|compan(?:y|ies)|firms?|unknown|undisclosed)$/i
const STAGE_RE: Record<string, RegExp> = {
  'Pre-seed': /pre[- ]?seed/i, Seed: /\bseed\b/i, 'Late stage': /late[- ]stage|growth[- ](?:stage|round|equity)|pre-ipo/i,
  Acquired: /acqui|bought|\bbuys?\b|purchas|merg|take-?over|taken over/i,
  Public: /\bipo\b|initial public offering|public|listed|nasdaq|nyse|stock exchange|debut|spac|ticker|initial trading|shares/i
}
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}$%.]+/gu, ' ').trim()
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(inc|ltd|llc|corp|the|ventures?|capital|partners|labs?|ai)\b/g, ' ').replace(/\s+/g, ' ').trim()

const OUT = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev', 'realdata-extraction.json')
const out: Record<string, any> = { started: new Date().toISOString() }
const save = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 2)) }
const TERMINAL = ['processed', 'duplicate', 'triaged_out', 'failed']

test.describe.serial('RD-EXT real-data extraction and entity quality', () => {
  let rw: RW
  const t: Record<string, any[]> = {}
  test.beforeAll(async () => {
    test.setTimeout(90 * MIN)
    rw = await launch({ testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } })
    await rw.invoke('settings.update', { patch: { 'processing.daily_cap': 0 } })   // automatic sources park; Read once is exempt
    const th = await rw.invoke('thesis.create', { title: THESIS.title })
    await rw.invoke('thesis.update', { id: th.id, patch: { description: THESIS.description } })
    // HN: fetched for title/date checks only (processing parks on the daily cap)
    const probe = await rw.invoke('source.probe', { locator: 'https://hacker-news.firebaseio.com/v0' })
    if (probe.status === 'found') await rw.invoke('source.create', { locator: 'https://hacker-news.firebaseio.com/v0', mode: 'relevant', instruction: '', freq: 'daily', thesisIds: [], probe })
    out.hnProbe = probe.status
    for (const url of URLS) { const r = await rw.raw('ingress.addUrl', { url }); if (!r.ok) out[`add:${url}`] = r.code }
    await until(async () => {
      const docs = (await rw.inspect('documents')).filter((d: any) => URLS.some(u => (d.url || '').startsWith(u.slice(0, 60)) || (d.canonical_url || '').startsWith(u.slice(0, 60))))
      return docs.length >= URLS.length - 3 && docs.every((d: any) => TERMINAL.includes(d.status)) ? true : null
    }, 75 * MIN, 5000).catch(() => null)
    await rw.drain(10 * MIN)
    for (const k of ['documents', 'companies', 'firms', 'people', 'evidence', 'relationships', 'relationship_evidence', 'field_values', 'suggestions', 'agent_runs']) t[k] = await rw.inspect(k)
    t.liveCo = t.companies.filter((c: any) => !c.merged_into_id && !c.deleted_at)
    t.liveFm = t.firms.filter((c: any) => !c.merged_into_id && !c.deleted_at)
    t.active = t.evidence.filter((e: any) => e.status === 'active')
    const byStatus: Record<string, number> = {}
    for (const d of t.documents) byStatus[d.status] = (byStatus[d.status] || 0) + 1
    const rejected = t.agent_runs.filter((r: any) => r.task === 'EXTRACT_DOCUMENT')
    out.library = { byStatus, companies: t.liveCo.length, firms: t.liveFm.length, people: t.people.length, activeEvidence: t.active.length,
      companyNames: t.liveCo.map((c: any) => c.name).sort(), firmNames: t.liveFm.map((c: any) => c.name).sort(), extractRuns: rejected.length }
    save()
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('RD-EXT extraction and entity quality on real articles', async () => {
    await test.step('RD-EXT-01 the articles were read and processed', async () => {
      const mine = t.documents.filter((d: any) => !(d.metadata_json || '').includes('"hn"'))
      out.docs = mine.map((d: any) => ({ title: d.title, status: d.status, url: d.url, error: d.processing_error }))
      expect.soft(mine.filter((d: any) => d.status === 'processed').length).toBeGreaterThanOrEqual(12)
    })

    await test.step('RD-EXT-02 no generic, publisher, government or placeholder entities', async () => {
      const junk = new Set(JUNK.map(nameKey))
      const bad = [...t.liveCo.map((c: any) => ['company', c.name]), ...t.liveFm.map((f: any) => ['firm', f.name])].filter(([, n]) => junk.has(nameKey(n)) || PLACEHOLDER.test(n.trim()))
      out.junkEntities = bad
      expect.soft(bad).toEqual([])
    })

    await test.step('RD-EXT-03 no name is both a company and a firm', async () => {
      const fm = new Set(t.liveFm.map((f: any) => nameKey(f.name)))
      const both = t.liveCo.filter((c: any) => fm.has(nameKey(c.name))).map((c: any) => c.name)
      out.bothLists = both
      expect.soft(both).toEqual([])
    })

    await test.step('RD-EXT-04 every current stage value is stated by its quote', async () => {
      const ev = new Map(t.evidence.map((e: any) => [e.id, e]))
      const bad = t.field_values.filter((f: any) => f.field_key === 'stage' && f.status === 'current' && f.origin === 'source_fact').map((f: any) => {
        const q = (ev.get(f.evidence_id) as any)?.quote || ''
        const re = /^Series ([A-H])$/.exec(f.display) ? new RegExp(`series[- ]${f.display.slice(-1)}\\b`, 'i') : STAGE_RE[f.display]
        return re && re.test(f.display === 'Seed' ? q.replace(/pre[- ]?seed/gi, '') : q) ? null : { value: f.display, quote: q }
      }).filter(Boolean)
      const rounds = t.active.filter((e: any) => e.kind === 'funding').map((e: any) => ({ round: JSON.parse(e.payload_json).round, quote: e.quote })).filter((r: any) => r.round)
      const badRounds = rounds.filter((r: any) => { const s = /series\s+([a-h])\b/i.exec(r.round); return s ? !new RegExp(`series[- ]${s[1]}\\b`, 'i').test(r.quote) : /seed/i.test(r.round) && !/seed/i.test(r.quote) })
      out.stage = { checked: t.field_values.filter((f: any) => f.field_key === 'stage').length, unsupported: bad, rounds: rounds.length, unsupportedRounds: badRounds }
      expect.soft(bad).toEqual([])
      expect.soft(badRounds).toEqual([])
    })

    await test.step('RD-EXT-05 no duplicate visible evidence rows', async () => {
      const subj = (e: any) => JSON.parse(e.payload_json || '{}').subjectId
      const groups = new Map<string, any[]>()
      for (const e of t.active) { const k = `${subj(e)}|${norm(e.claim)}|${norm(e.quote)}`; groups.set(k, [...(groups.get(k) || []), e]) }
      const sameDoc = new Map<string, number>()
      for (const e of t.active) { const k = `${e.document_id}|${norm(e.claim)}|${norm(e.quote)}`; sameDoc.set(k, (sameDoc.get(k) || 0) + 1) }
      out.duplicates = { crossDoc: [...groups.values()].filter(g => g.length > 1).map(g => ({ n: g.length, claim: g[0].claim.slice(0, 100) })), sameDoc: [...sameDoc].filter(([, n]) => n > 1).map(([k, n]) => ({ n, k: k.slice(0, 120) })) }
      const runs = t.agent_runs.filter((r: any) => r.task === 'EXTRACT_DOCUMENT' && r.output_json).map((r: any) => JSON.parse(r.output_json))
      out.sharedEvidence = runs.reduce((n: number, o: any) => n + (o.sharedEvidence || 0), 0)
      out.rejectedEntities = runs.flatMap((o: any) => o.rejectedEntities || [])
      expect.soft(out.duplicates.crossDoc).toEqual([])
      expect.soft(out.duplicates.sameDoc).toEqual([])
    })

    await test.step('RD-EXT-06 quotes are verbatim at their offsets (UTF-16, as stored and rendered)', async () => {
      const docs = new Map(t.documents.map((d: any) => [d.id, d]))
      const bad = t.active.filter((e: any) => { const d: any = docs.get(e.document_id); return d && e.document_version === d.current_version && d.text.slice(e.quote_start, e.quote_end) !== e.quote })
      const astral = t.active.filter((e: any) => { const d: any = docs.get(e.document_id); return d && /[\u{10000}-\u{10FFFF}]/u.test(d.text.slice(0, e.quote_start)) }).length
      out.quotes = { checked: t.active.length, bad: bad.map((e: any) => e.id), afterAstralChars: astral }
      expect.soft(bad).toEqual([])
    })

    await test.step('RD-EXT-07 titles intact; HN titles and dates', async () => {
      const afr = t.documents.find((d: any) => (d.url || '').includes('afr.com'))
      out.afrTitle = afr?.title ?? null
      if (afr) expect.soft(afr.title).toMatch(/^Titanium Ventures/)
      const hn = t.documents.filter((d: any) => (d.metadata_json || '').includes('"hn"'))
      out.hn = hn.map((d: any) => ({ title: d.title, published: d.published_at ? new Date(d.published_at).toISOString() : null, fetched: new Date(d.first_fetched_at).toISOString() }))
      for (const d of hn) {
        expect.soft(d.title.trim().length, d.url).toBeGreaterThan(3)
        if (d.published_at) expect.soft(d.published_at, `${d.title} is not dated in the future`).toBeLessThanOrEqual(d.first_fetched_at + 60_000)
      }
    })

    await test.step('RD-EXT-08 reporters are never tied to companies; people roles are grounded', async () => {
      const authors = new Set(t.documents.map((d: any) => (d.author || '').toLowerCase()).filter(Boolean))
      const people = new Map(t.people.map((p: any) => [p.id, p]))
      const ev = new Map(t.evidence.map((e: any) => [e.id, e]))
      const orgName = (type: string, id: string) => (type === 'company' ? t.companies : t.firms).find((x: any) => x.id === id)?.name || ''
      const bad: any[] = []
      for (const r of t.relationships.filter((r: any) => r.from_type === 'person' && ['works_at', 'founded', 'partner_at'].includes(r.rel) && r.status === 'accepted')) {
        const p: any = people.get(r.from_id)
        const sup = t.relationship_evidence.filter((x: any) => x.relationship_id === r.id).map((x: any) => (ev.get(x.evidence_id) as any)?.quote || '')
        const org = orgName(r.to_type, r.to_id)
        if (authors.has(p.name.toLowerCase()) && !sup.some((q: string) => q.includes(p.name) && q.toLowerCase().includes(org.toLowerCase()))) bad.push({ person: p.name, rel: r.rel, org, why: 'byline author' })
        if (r.rel === 'founded' && !sup.some((q: string) => /found/i.test(q))) bad.push({ person: p.name, rel: r.rel, org, why: 'founder not stated' })
      }
      const junkRows = t.active.filter((e: any) => /^(?:by\s+\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*){0,3}\.?|https?:\/\/\S+|illustration:.*)$/iu.test(e.quote.trim()) || e.quote.trim().split(/\s+/).length < 3)
      out.people = { relationships: t.relationships.filter((r: any) => r.from_type === 'person').length, bad, junkRows: junkRows.map((e: any) => e.quote) }
      expect.soft(bad).toEqual([])
      expect.soft(out.people.junkRows).toEqual([])
    })

    await test.step('RD-EXT-09 thesis links only where evidence moves the hypothesis', async () => {
      const th = (await rw.inspect('theses'))[0]
      const links = t.relationships.filter((r: any) => r.to_type === 'thesis' && r.to_id === th.id && r.from_type === 'evidence')
      const ev = new Map(t.evidence.map((e: any) => [e.id, e]))
      const docs = new Map(t.documents.map((d: any) => [d.id, d]))
      const offTopic = links.filter((r: any) => { const e: any = ev.get(r.from_id); const d: any = e && docs.get(e.document_id); return d && /ftc|lecun|investigation|probe/i.test(d.title + ' ' + (d.url || '')) && r.stance === 'support' })
      out.thesis = { links: links.map((r: any) => ({ stance: r.stance, confidence: r.confidence, claim: (ev.get(r.from_id) as any)?.claim?.slice(0, 120) })), offTopicSupports: offTopic.length }
      expect.soft(links.filter((r: any) => r.stance === 'neutral')).toEqual([])
      expect.soft(offTopic).toEqual([])
    })
  })
})
