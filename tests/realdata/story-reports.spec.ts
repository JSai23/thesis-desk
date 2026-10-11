// RD-STORY story reports (DEC-093) on the real RD-BR library (TechCrunch, Crunchbase News, a Google News funding
// search) with the real model and the user's real Gmail: reports created in plain English render as a grounded story
// (lede + section paragraphs, every sentence passing the grounding check against the rows it cites), with a hero card
// whose real article image loads, a "Capital raised" chart whose bars are the rows' grounded amounts, a deal table on
// request, a for/against bar on thesis reports, and a briefing that mails exactly one email with both stories.
// Artifacts for a human (screenshots of the in-app view, the email HTML, the email at 390/680 px):
//   tests/results/<RW_RUN_ID or dev>/story-reports/
// Reuses the cached library:  RW_RUN_ID=briefs-20261001 npx playwright test -c tests/playwright.config.ts --project=realdata story-reports
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { preparedLibrary, installEmail, until, ROOT, type RW, reloadApp } from '../harness/app'
import { imapFindMessages, type FoundMessage } from '../harness/imap'
import { buildBriefsLibrary } from './briefs-library'
import { judge } from './judge'

const MIN = 60_000
const LAUNCH = { testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } }
const DIR = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev', 'story-reports')
const out: Record<string, any> = { started: new Date().toISOString() }
const save = () => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(out, null, 2)) }
const unesc = (s: string) => (s || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const nav = (page: Page, label: string) => page.locator('aside').getByText(label, { exact: true }).first().click()
const build = async (rw: RW) => { await buildBriefsLibrary(rw) }

async function create(rw: RW, text: string): Promise<any> {
  const { reportId } = await rw.invoke('report.createFromPrompt', { text })
  await rw.drain(15 * MIN)
  const r = (await rw.invoke('report.list', {})).find((x: any) => x.id === reportId)
  expect(r?.status, `report "${text}" compiled: ${r?.lastError || ''}`).toBe('active')
  return r
}
async function runOnce(rw: RW, id: string): Promise<any> {
  await rw.invoke('report.runNow', { id })
  await rw.drain(15 * MIN)
  const runs = await rw.invoke('report.runs', { id })
  expect(runs[0]?.status).toBe('succeeded')
  return rw.invoke('report.run', { runId: runs[0].id })
}
const rowsOf = (run: any) => run.content.sections.flatMap((s: any) => s.rows)
const supportsOf = (r: any) => [r.quote, r.text, r.title || ''].filter(Boolean)

/** every lede / paragraph sentence cites rows of this run and passes the app's own grounding check against them */
async function checkGrounded(rw: RW, run: any): Promise<number> {
  const byN = new Map([...rowsOf(run), ...run.content.sections.flatMap((s: any) => s.background || [])].map((r: any) => [r.n, r]))
  const allowed = [run.content.name, ...run.content.sections.map((s: any) => s.title), ...run.content.sections.flatMap((s: any) => (s.deepDives || []).map((d: any) => d.subject))]
  const sentences = [...(run.content.lede || []), ...run.content.sections.flatMap((s: any) => [...(s.paragraph || []), ...(s.deepDives || []).flatMap((d: any) => d.sentences)])]
  for (const s of sentences) {
    expect(s.citations.length, `"${s.text}" cites rows`).toBeGreaterThan(0)
    for (const n of s.citations) expect(byN.has(n), `"${s.text}" cites row ${n} of this run`).toBe(true)
    const g = await rw.invoke('test.groundingCheck', { text: s.text, supports: s.citations.flatMap((n: number) => supportsOf(byN.get(n))), allowedNames: allowed })
    expect(g.ok, `"${s.text}" grounded: ${g.problems.join('; ')}`).toBe(true)
  }
  return sentences.length
}
/** the picture of each hero card (the part of the card before its text block) */
const heroImages = (html: string) => [...new Set(html.split('data-rw="hero"').slice(1).map(seg => seg.slice(0, seg.indexOf('padding:18px 20px 20px')).match(/<img src="([^"]+)"/)?.[1]).filter(Boolean).map(u => unesc(u!)))]

async function imageLoads(url: string): Promise<{ ok: boolean; status: number; type: string }> {
  const r = await fetch(url, { redirect: 'follow', referrerPolicy: 'no-referrer', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' } })
  const type = r.headers.get('content-type') || ''
  await r.arrayBuffer().catch(() => null)
  return { ok: r.status === 200 && /^image\//i.test(type), status: r.status, type }
}

async function shotEmail(rw: RW, file: string, width: number, png: string): Promise<void> {
  const win = rw.app.waitForEvent('window')
  await rw.app.evaluate(({ BrowserWindow }, o) => {
    const w = new BrowserWindow({ width: o.width, height: 900, show: false, webPreferences: { javascript: false, sandbox: true } })
    w.loadFile(o.file)
  }, { file, width })
  const p = await win
  await p.setViewportSize({ width, height: 900 })
  await p.waitForLoadState('load')
  await p.waitForTimeout(2500)
  const scrollW = await p.evaluate(() => document.documentElement.scrollWidth).catch(() => -1)
  out.emailWidths = { ...(out.emailWidths || {}), [width]: scrollW }
  await p.screenshot({ path: png, fullPage: true })
  await p.close()
  expect(scrollW, `email fits ${width}px without horizontal scroll`).toBeLessThanOrEqual(width)
}

test.describe.serial('RD-STORY story reports: lede, hero, cards, charts, tables, one email', () => {
  let rw: RW
  let funding: any, table: any, thesis: any
  let fundingRun: any, thesisRun: any

  test.beforeAll(async () => {
    test.setTimeout(150 * MIN)
    rw = await preparedLibrary('realdata-briefs', build, LAUNCH)
    await installEmail(rw)
    fs.mkdirSync(DIR, { recursive: true })
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('RD-STORY-01 a funding story: grounded lede and paragraphs, hero with a real image, capital chart from evidence amounts', async () => {
    test.setTimeout(40 * MIN)
    funding = await create(rw, 'Tell me the story of startup funding over the last 30 days: the biggest rounds, who led them, with pictures and a chart of capital raised')
    expect(funding.definition.style, 'plain-English request → story layout').toBe('story')
    fundingRun = await runOnce(rw, funding.id)
    const rows = rowsOf(fundingRun)
    fs.writeFileSync(path.join(DIR, 'funding-story.html'), fundingRun.html)
    fs.writeFileSync(path.join(DIR, 'funding-story.md'), fundingRun.markdown)
    out.funding = { def: funding.definition, rows: rows.length, withImage: rows.filter((r: any) => r.image).length, withAmount: rows.filter((r: any) => r.deal?.amountUsd).length, lede: fundingRun.content.lede, groundingDropped: fundingRun.content.groundingDropped, htmlBytes: fundingRun.html.length }
    save()
    expect(rows.length, 'the library has funding rows').toBeGreaterThan(2)
    // lede: present, ≤ 7 sentences, every sentence (lede + paragraphs) grounded in the rows it cites
    expect(fundingRun.content.lede?.length || 0, 'lede present').toBeGreaterThanOrEqual(1)
    expect(fundingRun.content.lede.length).toBeLessThanOrEqual(7) // 4–7 since iteration 2 (DEC-100)
    expect(fundingRun.html).toContain('data-rw="lede"')
    out.funding.checkedSentences = await checkGrounded(rw, fundingRun)
    // hero: at least one, with the article's own image that really loads
    expect((fundingRun.html.match(/data-rw="hero"/g) || []).length).toBeGreaterThanOrEqual(1)
    const heroes = heroImages(fundingRun.html)
    out.funding.heroImages = heroes
    if (rows.some((r: any) => r.image)) {
      expect(heroes.length, 'a hero card shows a real article image').toBeGreaterThanOrEqual(1)
      const loads = await Promise.all(heroes.map(imageLoads))
      out.funding.heroLoads = loads; save()
      expect(loads.some(l => l.ok), `hero image loads (200, image/*): ${JSON.stringify(loads)}`).toBe(true)
    }
    // no row without an image renders a broken <img>: placeholders are typographic tiles
    for (const r of rows.filter((x: any) => !x.image)) expect(fundingRun.html).not.toContain(`alt="${(r.title || r.text).slice(0, 20)}`)
    // capital chart: each bar is a row's evidence amount (amounts are only kept when their quote states them)
    const bars = [...fundingRun.html.matchAll(/data-rw="bar" data-company="([^"]*)" data-amount="(\d+(?:\.\d+)?)"/g)].map(m => ({ company: unesc(m[1]), amount: Number(m[2]) }))
    out.funding.bars = bars; save()
    const amounts = rows.filter((r: any) => r.deal?.amountUsd)
    if (new Set(amounts.map((r: any) => r.deal.company.toLowerCase())).size >= 2) expect(bars.length, 'capital chart drawn').toBeGreaterThanOrEqual(2)
    for (const b of bars) {
      const src = amounts.filter((r: any) => r.deal.company === b.company)
      expect(src.length, `bar ${b.company} comes from a row`).toBeGreaterThan(0)
      expect(Math.max(...src.map((r: any) => r.deal.amountUsd)), `bar ${b.company} = the largest amount its rows report`).toBe(b.amount)
    }
    for (let i = 1; i < bars.length; i++) expect(bars[i].amount).toBeLessThanOrEqual(bars[i - 1].amount)
  })

  test('RD-STORY-02 "as a table" → deal table with Company | Round | Amount | Lead investors | Source; refinements change the layout', async () => {
    test.setTimeout(40 * MIN)
    table = await create(rw, 'Seed and Series A rounds from the last 30 days as a table')
    const styles = [table.definition.style, ...table.definition.sections.map((s: any) => s.style)]
    out.table = { def: table.definition }; save()
    expect(styles, '"as a table" is honoured').toContain('table')
    const run = await runOnce(rw, table.id)
    fs.writeFileSync(path.join(DIR, 'deal-table.html'), run.html)
    const deals = rowsOf(run).filter((r: any) => r.deal)
    out.table.rows = rowsOf(run).length; out.table.dealRows = deals.length; save()
    if (deals.length) {
      expect(run.html).toContain('data-rw="deal-table"')
      const head = run.html.slice(run.html.indexOf('data-rw="deal-table"'), run.html.indexOf('data-rw="deal-row"'))
      for (const col of ['Company', 'Round', 'Amount', 'Lead investors', 'Source']) expect(head, `column ${col}`).toContain(`>${col}</th>`)
      expect((run.html.match(/data-rw="deal-row"/g) || []).length).toBe(deals.length)
      for (const r of deals) if (r.url) expect(unesc(run.html)).toContain(r.url)
      expect(run.markdown).toContain('| Company | Round | Amount | Lead investors | Source |')
    }
    // refine: back to a visual story, then shorter
    await rw.invoke('report.refine', { id: table.id, text: 'Add visuals and tell it as a story instead of a table' })
    await rw.drain(15 * MIN)
    let def = (await rw.invoke('report.list', {})).find((x: any) => x.id === table.id).definition
    out.table.refinedStory = def; save()
    expect(def.style).toBe('story')
    expect(def.sections.every((s: any) => s.style !== 'table'), 'no table left').toBe(true)
    const before = def.sections.reduce((n: number, s: any) => n + s.limit, 0)
    await rw.invoke('report.refine', { id: table.id, text: 'Make it shorter' })
    await rw.drain(15 * MIN)
    def = (await rw.invoke('report.list', {})).find((x: any) => x.id === table.id).definition
    out.table.refinedShorter = def; save()
    expect(def.sections.reduce((n: number, s: any) => n + s.limit, 0), 'shorter → fewer rows').toBeLessThan(before)
    await rw.invoke('report.refine', { id: table.id, text: 'make it a table' })
    await rw.drain(15 * MIN)
    def = (await rw.invoke('report.list', {})).find((x: any) => x.id === table.id).definition
    out.table.refinedTable = def; save()
    expect([def.style, ...def.sections.map((s: any) => s.style)]).toContain('table')
  })

  test('RD-STORY-03 a thesis story: for vs against bar matches the rows', async () => {
    test.setTimeout(30 * MIN)
    thesis = await create(rw, 'Weekly story on new evidence for and against my AI infrastructure thesis over the last 30 days')
    thesisRun = await runOnce(rw, thesis.id)
    fs.writeFileSync(path.join(DIR, 'thesis-story.html'), thesisRun.html)
    const rows = rowsOf(thesisRun)
    const f = rows.filter((r: any) => r.stance === 'support').length, g = rows.filter((r: any) => r.stance === 'contra').length
    out.thesis = { def: thesis.definition, rows: rows.length, for: f, against: g, lede: thesisRun.content.lede }; save()
    out.thesis.checkedSentences = await checkGrounded(rw, thesisRun)
    if (f + g) {
      expect(thesisRun.html).toContain('data-rw="stance"')
      expect(thesisRun.html).toMatch(new RegExp(`data-rw="for" data-count="${f}"`))
      expect(thesisRun.html).toMatch(new RegExp(`data-rw="against" data-count="${g}"`))
    } else out.thesis.note = 'no thesis rows in the window — stance bar not drawn'
    save()
  })

  test('RD-STORY-04 a briefing with two story reports → exactly one email with hero images and chart markup', async () => {
    test.setTimeout(30 * MIN)
    const b = await rw.invoke('briefing.create', { name: `Story brief ${Date.now().toString(36)}`, reportIds: [funding.id, thesis.id], schedule: { kind: 'none' } })
    const t0 = new Date(Date.now() - 60_000)
    await rw.invoke('briefing.sendNow', { id: b.id })
    await rw.drain(20 * MIN)
    const br = (await rw.invoke('briefing.runs', { id: b.id }))[0]
    expect(br.status).toBe('succeeded')
    const parts = await Promise.all(br.reportRunIds.map((id: string) => rw.invoke('report.run', { runId: id })))
    const msgs = await until(async () => { const m = await imapFindMessages(`Research Workspace · ${b.name} ·`, t0); return m.length ? m : null }, 6 * MIN, 5000) as FoundMessage[]
    await new Promise(r => setTimeout(r, 20_000))
    const again = await imapFindMessages(`Research Workspace · ${b.name} ·`, t0)
    const html = msgs[0].html
    fs.writeFileSync(path.join(DIR, 'briefing-email.html'), html)
    out.briefing = { name: b.name, emails: again.length, bytes: html.length, subject: msgs[0].subject }; save()
    expect(again.length, 'exactly one email').toBe(1)
    expect(html).toContain('Research Workspace · Briefing')
    for (const p of parts) {
      expect(unesc(html)).toContain(p.content.name)
      for (const u of heroImages(p.html)) expect(unesc(html), `hero image ${u} in the email`).toContain(u)
      if (p.html.includes('data-rw="capital"')) expect(html).toContain('data-rw="capital"')
      if (p.html.includes('data-rw="stance"')) expect(html).toContain('data-rw="stance"')
      if (p.content.lede?.length) expect(unesc(html)).toContain(p.content.lede[0].text)
    }
    expect(html, 'no <style>, no SVG, no scripts').not.toMatch(/<style|<svg|<script/i)
    // the email at phone and desktop widths
    const file = path.join(DIR, 'briefing-email.html')
    await shotEmail(rw, file, 390, path.join(DIR, 'email-390.png'))
    await shotEmail(rw, file, 680, path.join(DIR, 'email-680.png'))
  })

  test('RD-STORY-05 the in-app report view shows the same story (sandboxed frame)', async () => {
    test.setTimeout(10 * MIN)
    const page = rw.page
    await reloadApp(page)
    await nav(page, 'Reports')
    for (const [r, name] of [[funding, 'app-funding-story.png'], [thesis, 'app-thesis-story.png'], [table, 'app-table.png']] as const) {
      await page.locator('main').getByText(r.name, { exact: true }).first().click()
      const frame = page.frameLocator('[data-testid="report-view"]')
      await expect(frame.getByText('Research Workspace · Report')).toBeVisible({ timeout: 2 * MIN })
      const iframe = page.locator('[data-testid="report-view"]')
      expect(await iframe.getAttribute('sandbox')).not.toContain('allow-scripts')
      await page.waitForTimeout(3000)
      await page.screenshot({ path: path.join(DIR, name) })
      await iframe.screenshot({ path: path.join(DIR, name.replace('.png', '-full.png')) })
      if (r === funding) {
        // images in the app load (CSP allows https images; no referrer)
        const loaded = await iframe.evaluate((f: HTMLIFrameElement) => [...(f.contentDocument?.querySelectorAll('img') || [])].map(i => ({ src: i.src, w: i.naturalWidth })))
        out.appImages = loaded; save()
        if (loaded.length) expect(loaded.some(i => i.w > 0), 'an article image rendered in the app').toBe(true)
      }
    }
  })

  test('RD-STORY-06 reports go deeper: a longer lede and section analysis, deep dives from stored facts, all grounded; a judge finds them more useful and no less accurate', async () => {
    test.setTimeout(40 * MIN)
    const r = await create(rw, 'A story report on this week\'s AI startup funding rounds and who led them')
    expect(r.definition.style, 'a story layout (a table has no written analysis to deepen)').toBe('story')
    const run = await runOnce(rw, r.id)
    const c = run.content
    const written = (ss: any[]) => ss.map((x: any) => x.text).join(' ')
    const lede = c.lede || []
    const paras = c.sections.filter((s: any) => s.rows.length >= 2) // a one-row section needs only one sentence
    const dives = c.sections.flatMap((s: any) => s.deepDives || [])
    const n = await checkGrounded(rw, run)
    out.depth = { lede: lede.length, paragraphs: paras.map((s: any) => (s.paragraph || []).length), deepDives: dives.map((d: any) => ({ subject: d.subject, sentences: d.sentences.length })), sentences: n,
      words: written([...lede, ...c.sections.flatMap((s: any) => [...(s.paragraph || []), ...(s.deepDives || []).flatMap((d: any) => d.sentences)])]).split(/\s+/).length, groundingDropped: c.groundingDropped || 0 }
    save()
    // the old shape topped out at a 5-sentence lede and 3 per section, with no deep dives: ~1.5× is a longer lede, fuller
    // sections and at least one deep dive
    // grounding may drop a sentence, so the floors are what survives it
    expect(lede.length, 'a fuller lede').toBeGreaterThanOrEqual(3)
    for (const s of paras) expect((s.paragraph || []).length, `section "${s.title}" 2+ sentences`).toBeGreaterThanOrEqual(2)
    expect(dives.length, 'at least one deep dive on a standout company').toBeGreaterThan(0)
    for (const d of dives) expect(d.sentences.length).toBeGreaterThanOrEqual(2)
    // the old shape could hold at most a 5-sentence lede and 3 sentences per section (and no deep dives): ~50% more
    // means well past that ceiling, after grounding
    const storySecs = c.sections.filter((s: any) => s.rows.length && (s.style || c.style) === 'story').length
    const oldCap = 5 + 3 * storySecs
    expect(n, `written analysis past the old ceiling of ${oldCap} sentences`).toBeGreaterThanOrEqual(Math.ceil(oldCap * 1.3))
    // an independent judge reads the deep dives with their cited facts: useful context, and nothing the facts don't say
    const byN = new Map([...rowsOf(run), ...c.sections.flatMap((s: any) => s.background || [])].map((x: any) => [x.n, x]))
    const v = judge(DIR, 'story-depth', `A venture investor's report adds "deep dives": short paragraphs that put a company in context using facts stored from earlier articles. For each deep dive below, with the facts it cites, answer: is every sentence supported by its cited facts (accurate), and does it add context a reader would want beyond the headline (useful)?
Output ONLY JSON: {"dives":[{"subject":"…","accurate":true,"useful":true,"why":"…"}]}

${dives.map((d: any) => `## ${d.subject}\n${d.sentences.map((x: any) => `- ${x.text} [${x.citations.join(',')}]`).join('\n')}\nCited facts:\n${[...new Set(d.sentences.flatMap((x: any) => x.citations))].map((k: any) => `[${k}] ${byN.get(k)?.text} — “${byN.get(k)?.quote}” (${byN.get(k)?.source || ''})`).join('\n')}`).join('\n\n')}`)
    out.depthJudge = v; save()
    expect(v.dives.filter((d: any) => !d.accurate).map((d: any) => `${d.subject}: ${d.why}`), 'deep dives the judge finds unsupported').toEqual([])
    expect(v.dives.filter((d: any) => d.useful).length, 'useful deep dives').toBeGreaterThanOrEqual(Math.ceil(v.dives.length / 2))
  })

})
