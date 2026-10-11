// Real data, backlog iteration 2 — "Your description of anything comes first, and you can re-process anything"
// (DEC-099): a described company re-processed with what the user says finds its site and coverage; a note saying a
// linked article is about a different company makes the re-read drop that link (and Keep puts it back); a thesis with a
// description re-processed links stored facts; the user's words never become a cited fact. Live sites, real model.
// Results: tests/results/<run>/realdata-describe.json
import { test, expect } from '@playwright/test'
import { launch, until, type RW } from '../harness/app'
import { DIR, results, hydrated } from './hydrate-lib'
import { judge } from './judge'

const { out, save } = results('realdata-describe.json')
const MIN = 60_000
const LAUNCH = { testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } }
const ABOUT = 'Open-source infrastructure for computer-use AI agents: sandboxes and virtual machines agents can operate'

async function linkedDocs(rw: RW, type: string, id: string) {
  const rels = (await rw.inspect('relationships', { from_type: 'document', to_type: type, to_id: id })).filter((r: any) => ['accepted', 'suggested'].includes(r.status))
  const docs = await rw.inspect('documents')
  return rels.map((r: any) => ({ rel: r, doc: docs.find((d: any) => d.id === r.from_id) })).filter((x: any) => x.doc)
}
const reprocessDone = (rw: RW, type: string, id: string) => until(async () => {
  const pg = await rw.invoke('object.get', { type, id })
  return pg.reprocessed && pg.reprocessed.pending === 0 && pg.lookup.state === 'done' ? pg : null
}, 40 * MIN, 5000)

/** Wait until the entity's own site source (if the lookup followed one) has fetched and its articles are read. */
async function siteRead(rw: RW, type: string, id: string) {
  const covers = (await rw.inspect('relationships', { from_type: 'source', rel: 'covers', to_type: type, to_id: id })).filter((r: any) => r.status === 'accepted' && JSON.parse(r.payload_json || '{}').role === 'own_site')
  for (const c of covers) await rw.settle(await rw.sourceDocs(c.from_id, 10 * MIN), 20 * MIN)
  return covers.length
}

test.describe.serial('RD-DESC the user layer steers the agent; Re-process redoes its work', () => {
  let rw: RW
  test.beforeAll(async () => {
    test.setTimeout(10 * MIN)
    rw = await launch(LAUNCH)
    await rw.invoke('settings.update', { patch: { 'processing.daily_cap': 1000 } })
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('RD-DESC-01 Cua described (what it does, cua.ai) and re-processed: its site, a watch with its words, coverage that names it', async () => {
    test.setTimeout(45 * MIN)
    const c = await rw.invoke('object.create', { type: 'company', name: 'Cua' })
    await hydrated(rw, 'company', c.id)
    await rw.invoke('ontology.apply', { op: 'object.describe', input: { type: 'company', id: c.id, patch: { about: ABOUT, website: 'cua.ai' }, rerun: false } })
    const plan = await rw.invoke('object.reprocessPlan', { type: 'company', id: c.id })
    expect(plan.text).toMatch(/^Look Cua up again and re-read \d+ articles? about it/)
    await rw.invoke('object.reprocess', { type: 'company', id: c.id })
    await reprocessDone(rw, 'company', c.id)
    const site = await siteRead(rw, 'company', c.id)
    const pg = await rw.invoke('object.get', { type: 'company', id: c.id })
    const docs = await linkedDocs(rw, 'company', c.id)
    out.cua = { siteSources: site, plan: plan.text, lookup: pg.lookup, reprocessed: pg.reprocessed, docs: docs.map((x: any) => x.doc.title) }; save()
    expect(pg.lookup.website).toBe('cua.ai')
    expect(pg.lookup.watchQuery, 'the watch carries what the user said it does').toMatch(/"Cua".*\((?=.*(computer-use|infrastructure|sandboxes|machines|agents)).*\)/)
    expect(docs.length, 'coverage on its page').toBeGreaterThan(0)
    expect(docs.filter((x: any) => !/\bcua\b/i.test(`${x.doc.title}\n${x.doc.text}`)).map((x: any) => x.doc.title), 'linked articles that never name Cua').toEqual([])
    // naming "CUA" isn't enough (a credit union and the computer-use-agent acronym share it): an independent judge reads them
    const v = judge(DIR, 'desc-cua-docs', `Cua (cua.ai) is a startup building open-source infrastructure for computer-use AI agents (sandboxes, virtual machines, Lume, Cua Driver). For each article excerpt, is it about or mentioning THIS Cua — not a credit union, a university, or the generic "CUA" (computer-use agent) acronym?
Output ONLY JSON: {"notAbout":[{"n":1,"why":"…"}]}

${docs.slice(0, 12).map((x: any, i: number) => { const t = x.doc.text; const k = t.toLowerCase().indexOf('cua'); return `${i + 1}. ${x.doc.title}\n   …${t.slice(Math.max(0, k - 250), k + 250).replace(/\s+/g, ' ')}…` }).join('\n\n')}`)
    out.cuaJudge = v; save()
    expect(v.notAbout, 'articles not about this Cua').toEqual([])
    // the user's words are context, never evidence: no fact quotes or claims them
    const ev = await rw.inspect('evidence')
    expect(ev.filter((e: any) => e.claim.includes(ABOUT.slice(0, 40)) || e.quote.includes(ABOUT.slice(0, 40))), 'facts made of the user\'s words').toEqual([])
  })

  test('RD-DESC-02 a note saying a linked article is about a different company: re-process drops that link; Keep restores it', async () => {
    test.setTimeout(60 * MIN)
    const c = await rw.invoke('object.create', { type: 'company', name: 'Makora' })
    await hydrated(rw, 'company', c.id)
    await siteRead(rw, 'company', c.id) // its own site's posts are part of its coverage
    const before = await linkedDocs(rw, 'company', c.id)
    expect(before.length, 'Makora has real coverage').toBeGreaterThan(1)
    const target = before[0].doc
    await rw.invoke('note.create', { text: `The article “${target.title}” is about a different company, not this Makora.`, anchor: { type: 'company', id: c.id } })
    await rw.invoke('object.reprocess', { type: 'company', id: c.id })
    const pg = await reprocessDone(rw, 'company', c.id)
    const after = await linkedDocs(rw, 'company', c.id)
    out.makoraNote = { target: target.title, before: before.length, after: after.length, removed: pg.reprocessed.removed.map((r: any) => r.title) }; save()
    expect(after.some((x: any) => x.doc.id === target.id), 'the article the note names is no longer linked').toBe(false)
    expect(after.length, 'the rest of Makora\'s coverage stays').toBeGreaterThan(0)
    expect(pg.reprocessed.removed.map((r: any) => r.documentId)).toContain(target.id)
    // Keep those links: the user overrides the re-read
    const k = await rw.invoke('object.reprocessKeep', { type: 'company', id: c.id })
    expect(k.kept).toBeGreaterThan(0)
    expect((await linkedDocs(rw, 'company', c.id)).some((x: any) => x.doc.id === target.id), 'kept').toBe(true)
  })

  test('RD-DESC-03 a thesis with a description, re-processed, links facts already stored', async () => {
    test.setTimeout(30 * MIN)
    const th = await rw.invoke('thesis.create', { title: 'GPU efficiency software' })
    await rw.invoke('ontology.apply', { op: 'object.describe', input: { type: 'thesis', id: th.id, patch: { about: 'Software that makes AI models run faster or cheaper on GPUs — kernel optimization, compilers, inference serving — captures value as compute spend grows.', fields: { proof: 'Proof: such startups raise rounds and win customers; disproof: GPU vendors bundle it for free.' } }, rerun: false } })
    const docsBefore = (await rw.inspect('documents')).length
    await rw.invoke('object.reprocess', { type: 'thesis', id: th.id })
    await until(async () => { const j = (await rw.inspect('jobs')).filter((x: any) => x.type === 'MATCH_THESIS' && String(x.idempotency_key).startsWith(`match_thesis:${th.id}`)); return j.length && j.every((x: any) => ['succeeded', 'failed'].includes(x.status)) ? j : null }, 20 * MIN, 2000)
    const pg = await rw.invoke('object.get', { type: 'thesis', id: th.id })
    out.thesis = { match: pg.match, fromYou: pg.fromYou }; save()
    expect(pg.fromYou.fields.proof).toMatch(/^Proof:/)
    expect(pg.match.facts, 'facts linked from the library (Makora, Cua coverage)').toBeGreaterThan(0)
    expect((await rw.inspect('documents')).length, 'nothing new read').toBe(docsBefore)
  })
})
