// Real-data quality evaluation (DEC-087). A clean profile subscribes to real sources (no fixtures), processes what
// they publish, and fresh `claude -p` judges (no tools, temp dir) grade the app's output against the real article text:
// RD-1 extraction accuracy, RD-2 coverage of key facts, RD-3 entity quality, RD-4 relevance decisions,
// RD-5 Ask on questions the judge writes from real articles. Inputs/outputs saved to tests/results/<run>/realdata/.
import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { preparedLibrary, installEmail, ROOT, type RW } from '../harness/app'

const SOURCES: { locator: string; mode?: string; instruction?: string }[] = [
  { locator: 'https://techcrunch.com/category/startups/feed/', mode: 'custom', instruction: 'Only startup funding rounds, acquisitions and major product launches' },
  { locator: 'https://news.crunchbase.com/feed/' },
  { locator: 'https://hacker-news.firebaseio.com/v0', mode: 'relevant' },
  { locator: 'https://www.ycombinator.com/blog/rss/' },
  { locator: 'https://a16z.com/news-content/' },
  { locator: 'https://sequoiacap.com/feeds/stories' },
  { locator: 'https://paulgraham.com/articles.html' },
  { locator: 'https://stratechery.com/feed/' },
  { locator: 'https://news.google.com/rss/search?q=%22raises%22+%22seed+round%22+when:7d&hl=en-US&gl=US&ceid=US:en' },
  { locator: 'https://news.google.com/rss/search?q=%22Series+A%22+raises+when:7d&hl=en-US&gl=US&ceid=US:en' }
]
const THESES = ['AI applications', 'Developer tools and infrastructure', 'Fintech']
const OUT = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev', 'realdata')
const results: Record<string, any> = {}
const save = () => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2)) }

/** A fresh judge process: no tools, empty temp dir, strict JSON out. Input and output are saved for review. */
function judge(name: string, prompt: string): any {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-rd-judge-'))
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, `${name}.input.txt`), prompt)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = spawnSync('claude', ['-p', '--model', 'opus', '--output-format', 'json', '--tools', '', '--permission-mode', 'dontAsk', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence'],
      { cwd, input: prompt, encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 64 << 20 })
    fs.writeFileSync(path.join(OUT, `${name}.output-${attempt}.json`), r.stdout || r.stderr || '')
    try { const t = JSON.parse(r.stdout).result as string; return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) } catch { /* retry once */ }
  }
  throw new Error(`judge ${name}: no JSON verdict`)
}
const sample = <T>(xs: T[], n: number, seed = 7): T[] => { const a = [...xs]; let s = seed; for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a.slice(0, n) }
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + ' […]' : t)

async function build(rw: RW): Promise<void> {
  await installEmail(rw)
  for (const t of THESES) await rw.invoke('thesis.create', { title: t })
  const subscribed: string[] = [], failed: Record<string, string> = {}
  for (const s of SOURCES) {
    const probe = await rw.invoke('source.probe', { locator: s.locator })
    if (probe.status !== 'found') { failed[s.locator] = probe.status; continue }
    await rw.invoke('source.create', { locator: s.locator, mode: s.mode || 'all', instruction: s.instruction || '', freq: 'daily', thesisIds: [], probe })
    subscribed.push(s.locator)
  }
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'sources.json'), JSON.stringify({ subscribed, failed }, null, 2))
  await rw.drain(90 * 60_000)
}

test.describe('RD real-data quality', () => {
  let rw: RW
  test.beforeEach(async () => { test.setTimeout(150 * 60_000); rw = await preparedLibrary('realdata', build, { testNow: null }) })
  test.afterEach(async () => { save(); await rw?.close() })

  test('RD-0 real library built from real sources', async () => {
    const docs = await rw.inspect('documents')
    const byStatus: Record<string, number> = {}
    for (const d of docs) byStatus[d.status] = (byStatus[d.status] || 0) + 1
    const src = JSON.parse(fs.readFileSync(path.join(OUT, 'sources.json'), 'utf8'))
    results.library = { byStatus, sources: src, evidence: (await rw.inspect('evidence')).filter((e: any) => e.status === 'active').length, companies: (await rw.inspect('companies')).length, firms: (await rw.inspect('firms')).length }
    expect(src.subscribed.length).toBeGreaterThanOrEqual(8)
    expect(byStatus.processed || 0).toBeGreaterThanOrEqual(40)
  })

  test('RD-1 extraction accuracy (judge reads the real article)', async () => {
    const ev = (await rw.inspect('evidence')).filter((e: any) => e.status === 'active' && e.origin === 'ai_extraction')
    const picked = sample(ev, 40)
    const docs = new Map((await rw.inspect('documents')).map((d: any) => [d.id, d]))
    const items = picked.map((e: any, i: number) => ({ n: i + 1, kind: e.kind, assertion: e.assertion, attributedTo: e.attributed_to, claim: e.claim, quote: e.quote, payload: JSON.parse(e.payload_json || '{}'), document: docs.get(e.document_id)?.title, documentId: e.document_id }))
    const articleIds = [...new Set(items.map(x => x.documentId))]
    const articles = articleIds.map(id => `=== ${id} · ${docs.get(id)?.title}\n${docs.get(id)?.author ? `[Byline: ${docs.get(id).author}]\n` : ''}${clip(docs.get(id)?.text || '', 7000)}`).join('\n\n')
    const v = judge('rd1', `You audit a research app's extraction of evidence from real news articles. For each numbered item, decide whether it is CORRECT: the claim states what the article says (right company/firm/person, numbers, round, dates), the kind is a reasonable label (funding, investment, fund_raise, product_launch, partnership, customer_adoption, pricing, executive_change, acquisition, expansion, metric, opinion, other), payload values (amounts, round, investors, roles) match the article, and opinions are attributed to whoever holds them. Minor wording differences are fine; wrong facts, wrong entities, invented numbers, or mislabeled opinions-as-facts are not.
Output ONLY JSON: {"items":[{"n":1,"correct":true,"problem":""}...],"notes":"…"}

ITEMS:
${JSON.stringify(items.map(({ documentId, ...x }) => ({ ...x, documentId })), null, 1)}

ARTICLES:
${articles}`)
    const ok = v.items.filter((x: any) => x.correct).length
    results.rd1 = { sampled: items.length, correct: ok, rate: ok / items.length, problems: v.items.filter((x: any) => !x.correct), notes: v.notes }
    expect(ok / items.length).toBeGreaterThanOrEqual(0.95)
  })

  test('RD-2 coverage of key facts', async () => {
    const docs = (await rw.inspect('documents')).filter((d: any) => d.status === 'processed' && d.text.length > 1500)
    const picked = sample(docs, 8, 11)
    const ev = (await rw.inspect('evidence')).filter((e: any) => e.status === 'active')
    const payload = picked.map((d: any) => `=== ${d.id} · ${d.title}\nARTICLE:\n${clip(d.text, 6000)}\nEXTRACTED:\n${ev.filter((e: any) => e.document_id === d.id).map((e: any) => `- [${e.kind}] ${e.claim}`).join('\n') || '(none)'}`).join('\n\n')
    const v = judge('rd2', `For each article below, list the key facts a venture investor would want captured (funding rounds with amount/round/investors, acquisitions, product launches, executive hires/departures, pricing changes, partnerships, customer wins, notable metrics, attributed opinions about markets). Ignore boilerplate and background. Then mark each key fact as captured if any EXTRACTED line states it (paraphrase fine). Articles with no such facts have an empty list.
Output ONLY JSON: {"articles":[{"id":"…","keyFacts":[{"fact":"…","captured":true}]}],"notes":"…"}

${payload}`)
    const facts = v.articles.flatMap((a: any) => a.keyFacts)
    const cap = facts.filter((f: any) => f.captured).length
    results.rd2 = { articles: picked.length, keyFacts: facts.length, captured: cap, rate: facts.length ? cap / facts.length : 1, missed: v.articles.map((a: any) => ({ id: a.id, missed: a.keyFacts.filter((f: any) => !f.captured).map((f: any) => f.fact) })).filter((a: any) => a.missed.length), notes: v.notes }
    expect(facts.length ? cap / facts.length : 1).toBeGreaterThanOrEqual(0.8)
  })

  test('RD-3 entity quality (no junk or duplicates)', async () => {
    const live = (rows: any[]) => rows.filter((r: any) => !r.merged_into_id && !r.deleted_at).map((r: any) => r.name)
    const companies = live(await rw.inspect('companies')), firms = live(await rw.inspect('firms')), people = live(await rw.inspect('people'))
    const v = judge('rd3', `A research app extracted these entity lists from real startup/VC news. Flag JUNK entries (not a real company/firm/person name: generic phrases, publications/newsletters, fragments, roles, products mistaken for companies unless clearly a company) and DUPLICATES (two entries that are clearly the same entity, e.g. "Acme" and "Acme Inc.", or "a16z" and "Andreessen Horowitz"). Investment firms listed under companies (or vice versa) count as junk only if clearly misfiled.
Output ONLY JSON: {"junk":[{"list":"companies","name":"…","why":"…"}],"duplicates":[{"list":"firms","names":["…","…"]}],"notes":"…"}

COMPANIES (${companies.length}): ${JSON.stringify(companies)}
FIRMS (${firms.length}): ${JSON.stringify(firms)}
PEOPLE (${people.length}): ${JSON.stringify(people)}`)
    const total = companies.length + firms.length + people.length
    const bad = v.junk.length + v.duplicates.length
    results.rd3 = { total, junk: v.junk, duplicates: v.duplicates, rate: total ? bad / total : 0, notes: v.notes }
    expect(total ? bad / total : 0).toBeLessThanOrEqual(0.03)
  })

  test('RD-4 relevance decisions against the source instruction', async () => {
    const src = (await rw.inspect('sources')).find((s: any) => s.mode === 'custom')
    test.skip(!src, 'no custom-instruction source was reachable')
    const ds = new Set((await rw.inspect('document_sources', { source_id: src.id })).map((r: any) => r.document_id))
    const docs = (await rw.inspect('documents')).filter((d: any) => ds.has(d.id) && ['processed', 'triaged_out'].includes(d.status))
    const items = docs.map((d: any) => ({ id: d.id, title: d.title, kept: d.status === 'processed', lead: clip(d.text, 600) }))
    const v = judge('rd4', `A research app watches a news source with the user's instruction: "${src.instruction}". For each item it either KEPT it (shown to the user) or DROPPED it. Judge whether each decision follows the instruction (when unsure, keeping is acceptable).
Output ONLY JSON: {"items":[{"id":"…","agree":true,"why":""}],"notes":"…"}

${JSON.stringify(items, null, 1)}`)
    const agree = v.items.filter((x: any) => x.agree).length
    results.rd4 = { decisions: items.length, kept: items.filter(x => x.kept).length, agree, rate: items.length ? agree / items.length : 1, disagreements: v.items.filter((x: any) => !x.agree), notes: v.notes }
    expect(items.length).toBeGreaterThan(0)
    expect(agree / items.length).toBeGreaterThanOrEqual(0.85)
  })

  test('RD-5 Ask on questions written from real articles', async () => {
    const docs = (await rw.inspect('documents')).filter((d: any) => d.status === 'processed' && d.text.length > 1200)
    const picked = sample(docs, 6, 23)
    const qs = judge('rd5-questions', `Write one factual question per article that a venture investor might ask their research library, answerable from that article alone, naming the company/firm/person (not "this article"). Give the reference answer in one sentence.
Output ONLY JSON: {"questions":[{"id":"…","question":"…","answer":"…"}]}

${picked.map((d: any) => `=== ${d.id} · ${d.title}\n${clip(d.text, 5000)}`).join('\n\n')}`).questions
    const graded: any[] = []
    for (const q of qs) {
      const a = await rw.invoke('query.ask', { question: q.question })
      const facts = a.items.filter((i: any) => i.type === 'fact').map((f: any) => ({ text: f.text, cites: f.citations.map((n: number) => a.citations.find((c: any) => c.n === n)?.title) }))
      graded.push({ ...q, insufficient: a.insufficient, facts, interpretation: a.items.filter((i: any) => i.type === 'interpretation').map((i: any) => i.text) })
    }
    const v = judge('rd5-grade', `Grade a research app's answers. For each question you have the reference answer (from the source article) and the app's answer facts with the titles of the documents they cite. PASS when the app's facts contain the reference answer's substance (paraphrase fine) and cite a document plausibly being the source article, and state nothing contradicted by the reference. An "insufficient" answer FAILS.
Output ONLY JSON: {"items":[{"id":"…","pass":true,"why":""}],"notes":"…"}

${JSON.stringify(graded, null, 1)}`)
    const pass = v.items.filter((x: any) => x.pass).length
    results.rd5 = { questions: graded.length, pass, graded, verdicts: v.items, notes: v.notes }
    expect(pass).toBeGreaterThanOrEqual(Math.ceil(graded.length * 5 / 6))
  })
})
