// Real data, backlog iteration 2 — "Following anything always hydrates it and gives it sources" (DEC-099): a short,
// ambiguous name (Cua) keeps a news watch even when the first search finds nothing and asks for a hint; the hint (its
// website) makes the lookup find it; a name typed as a web address is taken as the website and named from the home page;
// a new thesis is matched against facts already stored without reading anything new; following a firm the library
// already extracted runs a fresh lookup and gives it sources. Live Google News, live sites, the real model.
// Results: tests/results/<run>/realdata-lookup.json
import { test, expect } from '@playwright/test'
import { launch, preparedLibrary, until, type RW } from '../harness/app'
import { DIR, results, hydrated } from './hydrate-lib'
import { judge } from './judge'
import { buildBriefsLibrary } from './briefs-library'

const { out, save } = results('realdata-lookup.json')
const MIN = 60_000
const LAUNCH = { testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } }
const build = async (rw: RW) => { await buildBriefsLibrary(rw) }

/** The entity's live watch sources (news searches that cover it). */
async function watches(rw: RW, type: string, id: string) {
  const covers = (await rw.inspect('relationships', { from_type: 'source', rel: 'covers', to_type: type, to_id: id })).filter((r: any) => r.status === 'accepted')
  const sources = await rw.inspect('sources')
  return covers.map((c: any) => sources.find((s: any) => s.id === c.from_id && !s.deleted_at)).filter(Boolean)
}
const lookups = async (rw: RW, id: string) => (await rw.inspect('jobs')).filter((j: any) => j.type === 'HYDRATE_OBJECT' && j.idempotency_key === `hydrate:${id}`).length
/** Wait for a new lookup of an entity (more lookup jobs than `before`) — counted, not timed: the app's test clock
 *  starts when the spec loads, minutes behind the real clock for a copied library. */
async function lookupAfter(rw: RW, id: string, before: number) {
  await until(async () => (await lookups(rw, id)) > before || null, 2 * MIN, 1000)
}

/** Wait until the entity's own site source (if the lookup followed one) has fetched and its articles are read. */
async function siteRead(rw: RW, type: string, id: string) {
  const covers = (await rw.inspect('relationships', { from_type: 'source', rel: 'covers', to_type: type, to_id: id })).filter((r: any) => r.status === 'accepted' && JSON.parse(r.payload_json || '{}').role === 'own_site')
  for (const c of covers) await rw.settle(await rw.sourceDocs(c.from_id, 10 * MIN), 20 * MIN)
  return covers.length
}

test.describe.serial('RD-LOOK follow always looks it up; hints, web-address names, thesis matching', () => {
  let rw: RW
  let cua = ''
  test.beforeAll(async () => {
    test.setTimeout(10 * MIN)
    rw = await launch(LAUNCH)
    await rw.invoke('settings.update', { patch: { 'processing.daily_cap': 1000 } })
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('RD-LOOK-01 a 3-letter name alone (Cua): a news watch is kept either way; nothing to go on → the page asks for a hint', async () => {
    test.setTimeout(30 * MIN)
    const c = await rw.invoke('object.create', { type: 'company', name: 'Cua' })
    cua = c.id
    const h = await hydrated(rw, 'company', cua)
    const w = await watches(rw, 'company', cua)
    const pg = await rw.invoke('object.get', { type: 'company', id: cua })
    out.nameOnly = { job: h.job, steps: h.result, watches: w.map((s: any) => s.name), lookup: pg.lookup, docLinks: h.docLinks }; save()
    expect(h.job.status).toBe('succeeded')
    expect(w.length, 'a news watch exists even if the first search picked nothing').toBeGreaterThan(0)
    expect(pg.lookup.watchQuery, 'the page shows what it watches').toMatch(/Cua/)
    if (pg.lookup.articles === 0 && !pg.lookup.website) expect(pg.lookup.needsHint, 'nothing found → the page asks for a hint').toBe(true)
    else expect(pg.lookup.needsHint).toBe(false)
  })

  test('RD-LOOK-02 the hint (its website) re-runs the lookup: domain, a search with what the site says it does, coverage that names Cua', async () => {
    test.setTimeout(45 * MIN)
    const since = await lookups(rw, cua)
    const r = await rw.invoke('ontology.apply', { op: 'object.describe', input: { type: 'company', id: cua, patch: { website: 'https://www.cua.ai/' } } })
    expect(r.result.rerunJobId, 'saving the website re-runs the lookup').toBeTruthy()
    await lookupAfter(rw, cua, since)
    const h = await hydrated(rw, 'company', cua)
    await siteRead(rw, 'company', cua)
    const pg = await rw.invoke('object.get', { type: 'company', id: cua })
    const docs = (await rw.inspect('relationships', { from_type: 'document', to_type: 'company', to_id: cua })).filter((x: any) => ['accepted', 'suggested'].includes(x.status))
    const all = await rw.inspect('documents')
    const texts = docs.map((d: any) => all.find((x: any) => x.id === d.from_id)).filter(Boolean)
    out.withWebsite = { steps: h.result, lookup: pg.lookup, fromYou: pg.fromYou, docs: texts.map((d: any) => d.title) }; save()
    expect(pg.fromYou.website).toBe('cua.ai')
    expect(h.row.domain).toBe('cua.ai')
    expect(pg.lookup.watchQuery, 'the news search carries what the site says it does').toMatch(/"Cua".*\(.+\)/)
    expect(texts.length, 'articles on its page').toBeGreaterThan(0)
    expect(texts.filter((d: any) => !/\bcua\b/i.test(`${d.title}\n${d.text}`)).map((d: any) => d.title), 'linked articles that never name Cua').toEqual([])
    const v = judge(DIR, 'look-cua-docs', `Cua (cua.ai) is a startup building open-source infrastructure for computer-use AI agents (sandboxes, virtual machines, Lume, Cua Driver). For each article excerpt, is it about or mentioning THIS Cua — not a credit union, a university, or the generic "CUA" (computer-use agent) acronym?
Output ONLY JSON: {"notAbout":[{"n":1,"why":"…"}]}

${texts.slice(0, 12).map((d: any, i: number) => { const k = d.text.toLowerCase().indexOf('cua'); return `${i + 1}. ${d.title}\n   …${d.text.slice(Math.max(0, k - 250), k + 250).replace(/\s+/g, ' ')}…` }).join('\n\n')}`)
    out.cuaJudge = v; save()
    expect(v.notAbout, 'articles not about this Cua').toEqual([])
    expect(pg.lookup.needsHint).toBe(false)
  })

  test('RD-LOOK-03 a name typed as a web address ("cua.ai") is taken as the website and named from its home page', async () => {
    test.setTimeout(30 * MIN)
    const other = await launch(LAUNCH)
    try {
      const c = await other.invoke('object.create', { type: 'company', name: 'cua.ai' })
      const h = await hydrated(other, 'company', c.id)
      out.domainName = { steps: h.result, name: h.row.name, domain: h.row.domain, aliases: h.aliases }; save()
      expect(h.row.domain).toBe('cua.ai')
      expect(h.row.name, 'named from its home page').toBe('Cua')
      expect(h.aliases, 'what the user typed stays an alias').toContain('cua.ai')
      expect((await watches(other, 'company', c.id)).length).toBeGreaterThan(0)
    } finally { await other.close() }
  })

  test('RD-LOOK-04 following a firm the library already extracted runs a fresh lookup and gives it sources', async () => {
    test.setTimeout(45 * MIN)
    const lib = await preparedLibrary('realdata-briefs', build, LAUNCH)
    try {
      const firms = (await lib.inspect('firms')).filter((f: any) => !f.followed && !f.merged_into_id && !f.deleted_at && f.created_origin === 'source_fact')
      const docsOf = async (id: string) => (await lib.inspect('relationships', { from_type: 'document', to_type: 'firm', to_id: id })).length
      let pick: any = null
      for (const f of firms) if ((await docsOf(f.id)) >= 1) { pick = f; break }
      test.skip(!pick, 'the library has no extracted firm')
      const since = await lookups(lib, pick.id)
      await lib.invoke('object.follow', { type: 'firm', id: pick.id, follow: true })
      await lookupAfter(lib, pick.id, since)
      const h = await hydrated(lib, 'firm', pick.id)
      const w = await watches(lib, 'firm', pick.id)
      out.followExtracted = { firm: pick.name, steps: h.result, watches: w.map((s: any) => s.name) }; save()
      expect(h.job.status).toBe('succeeded')
      expect(w.length, 'its news watch').toBeGreaterThan(0)
    } finally { await lib.close() }
  })

  test('RD-LOOK-05 a new thesis is matched against facts already stored — links appear without reading anything new', async () => {
    test.setTimeout(45 * MIN)
    const lib = await preparedLibrary('realdata-briefs', build, LAUNCH)
    try {
      const docsBefore = (await lib.inspect('documents')).length
      const th = await lib.invoke('thesis.create', { title: 'AI inference layer' })
      await lib.invoke('thesis.update', { id: th.id, patch: { description: 'Startups that serve and optimize AI model inference — inference clouds, serving runtimes, inference chips — will capture a growing share of AI infrastructure spend.' } })
      await until(async () => { const j = (await lib.inspect('jobs')).filter((x: any) => x.type === 'MATCH_THESIS' && String(x.idempotency_key).startsWith(`match_thesis:${th.id}`)); return j.length && j.every((x: any) => ['succeeded', 'failed'].includes(x.status)) ? j : null }, 20 * MIN, 2000)
      const pg = await lib.invoke('object.get', { type: 'thesis', id: th.id })
      const links = (await lib.inspect('relationships', { to_type: 'thesis', to_id: th.id })).filter((r: any) => r.from_type === 'evidence' && ['accepted', 'suggested'].includes(r.status))
      const docsAfter = (await lib.inspect('documents')).length
      out.thesisMatch = { match: pg.match, links: links.length, docsBefore, docsAfter }; save()
      expect(pg.match.state).toBe('done')
      expect(links.length, 'facts linked to the new thesis').toBeGreaterThan(0)
      expect(pg.match.facts, 'the page reports what the match found').toBeGreaterThan(0)
      expect(links.length).toBeGreaterThanOrEqual(pg.match.facts)
      expect(docsAfter, 'nothing new was read').toBe(docsBefore)
    } finally { await lib.close() }
  })
})
