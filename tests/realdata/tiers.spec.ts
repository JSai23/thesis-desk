// Real data, backlog iteration 1 (DEC-096, MEM-060): aliases a source may add, the repair of what unstated aliases
// attached, the three tiers (followed / connected / extracted), unfollow removing orphaned sources, Pull latest, and
// Today's three sections — on a live library (Google News, real company sites, the real model, an independent judge).
// Results: tests/results/<run>/realdata-tiers.json (+ judge inputs/outputs).
import { test, expect } from '@playwright/test'
import { launch, type RW } from '../harness/app'
import { judge } from './judge'
import { DIR, results, hydrated } from './hydrate-lib'

const { out, save } = results('realdata-tiers.json')
const MIN = 60_000
const gn = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:7d&hl=en-US&gl=US&ceid=US:en`
// companies whose coverage is full of big partners (chips, clouds, platforms) — the trap that gave Makora AMD and NVIDIA
const COMPANIES = ['Makora', 'Modular', 'Baseten']
const PARTNERS = /^(nvidia|nvda|amd|advanced micro devices|intel|google|google cloud|aws|amazon|amazon web services|microsoft|azure|qualcomm|tenstorrent|h100s?|nvidia h100s?|blackwell|hopper|tpu|cuda|pytorch|openai|anthropic|meta)$/i
const HEADLINE_DEAL = 0.7, HEADLINE_ANY = 0.9 // app/src/main/feed — the Headlines bar

test.describe.serial('RD-TIER aliases, repair, three tiers and Today on real data', () => {
  let rw: RW
  const ids: Record<string, string> = {}
  const apply = async (op: string, input: Record<string, unknown>) => rw.invoke('ontology.apply', { op, input })
  const aliasesOf = async (type: string, id: string) => (await rw.inspect('aliases', { entity_type: type, entity_id: id })).map((a: any) => ({ alias: a.alias, origin: a.origin }))
  const docsOf = async (type: string, id: string) => {
    const rels = (await rw.inspect('relationships', { from_type: 'document', to_type: type, to_id: id })).filter((r: any) => ['accepted', 'suggested'].includes(r.status))
    const docs = await rw.inspect('documents')
    return rels.map((r: any) => docs.find((d: any) => d.id === r.from_id)).filter(Boolean)
  }
  const tiers = () => rw.invoke('test.tiers')

  test.beforeAll(async () => {
    test.setTimeout(10 * MIN)
    rw = await launch({ testNow: new Date().toISOString(), env: { RW_REAL_SEARCH: '1' } })
    await rw.invoke('settings.update', { patch: { 'processing.daily_cap': 1000 } })
    const th = await rw.invoke('thesis.create', { title: 'Software that makes AI compute cheaper wins GPU budgets' })
    await rw.invoke('thesis.update', { id: th.id, patch: { description: 'Compilers, kernel optimization, inference serving and runtimes that cut the cost of running AI models on GPUs and accelerators capture spend that would go to more hardware.' } })
    ids.thesis = th.id
  })
  test.afterAll(async () => { out.finished = new Date().toISOString(); save(); await rw?.close() })

  test('RD-TIER-01 companies with big-partner coverage get no partner, product, chip or ticker aliases', async () => {
    test.setTimeout(60 * MIN)
    for (const name of COMPANIES) {
      const r = await apply('entity.create', { type: 'company', name })
      ids[name] = r.result.id
    }
    for (const name of COMPANIES) await hydrated(rw, 'company', ids[name])
    out.aliases = {}
    for (const name of COMPANIES) {
      const al = (await aliasesOf('company', ids[name])).filter(a => a.origin === 'source_fact').map(a => a.alias)
      out.aliases[name] = al; save()
      expect(al.filter(a => PARTNERS.test(a.trim())), `${name}: partner/chip/ticker aliases`).toEqual([])
    }
    // an independent judge reads every source alias and says which are not names of the same company
    const v = judge(DIR, 'tier-aliases', `For each company, list the aliases that are NOT another name of that same company (a partner, customer, investor, chip, product, ticker, or a different company). A former name, abbreviation, legal name or spelling variant IS the same company.
Output ONLY JSON: {"wrong":[{"company":"…","alias":"…","why":"…"}]}

${COMPANIES.map(n => `${n}: ${JSON.stringify(out.aliases[n])}`).join('\n')}`)
    out.aliasJudge = v; save()
    expect(v.wrong, 'aliases the judge calls a different thing').toEqual([])
    // every document linked to Makora names Makora; a judge confirms 10 of them are about this Makora
    const docs = await docsOf('company', ids.Makora)
    out.makoraDocs = docs.length; save()
    expect(docs.length, 'Makora has coverage').toBeGreaterThan(0)
    expect(docs.filter((d: any) => !/makora/i.test(`${d.title}\n${d.text}`)).map((d: any) => d.title), 'linked documents that never name Makora').toEqual([])
    const sample = docs.slice(0, 10).map((d: any, i: number) => { const k = d.text.toLowerCase().indexOf('makora'); return `${i + 1}. ${d.title}\n   …${d.text.slice(Math.max(0, k - 300), k + 300).replace(/\s+/g, ' ')}…` })
    const j = judge(DIR, 'tier-makora-docs', `Makora is a startup that automates GPU kernel optimization (products MakoraGenerate, MakoraOptimize). For each excerpt, is the article about or mentioning THIS Makora (not a namesake)?
Output ONLY JSON: {"notAbout":[{"n":1,"why":"…"}]}

${sample.join('\n\n')}`)
    out.makoraDocsJudge = j; save()
    expect(j.notAbout, 'documents not about this Makora').toEqual([])
  })

  test('RD-TIER-02 repair removes a seeded unstated alias, unlinks what it attached, and undo restores', async () => {
    test.setTimeout(45 * MIN)
    const mk = ids.Makora
    // the bug as it happened: an alias naming another real company that is not in the library yet (resolution tries
    // entity names before aliases, so a company already present would win) — then that company's real news is read
    const present = new Set((await rw.inspect('companies')).map((c: any) => c.normalized_name))
    const cand = ['Groq', 'Cerebras', 'SambaNova', 'Lightmatter', 'Etched', 'd-Matrix', 'Tenstorrent', 'Graphcore'].find(n => !present.has(n.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim()))!
    out.repair = { alias: cand }; save()
    expect(cand, 'a chip company not yet in the library').toBeTruthy()
    await rw.invoke('test.aliases.add', { type: 'company', id: mk, alias: cand })
    const loc = gn(`"${cand}" (chips OR AI OR inference OR raises)`)
    const p = await rw.invoke('source.probe', { locator: loc })
    expect(p.status).toBe('found')
    const src = await rw.invoke('source.create', { locator: loc, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
    const srcDocs = await rw.sourceDocs(src.id, 10 * MIN)
    await rw.settle(srcDocs, 30 * MIN)
    const before = await docsOf('company', mk)
    const wrong = before.filter((d: any) => !/makora/i.test(`${d.title}\n${d.text}`))
    out.repair = { ...out.repair, linkedBefore: before.length, wrongBefore: wrong.length, sourceId: src.id }; save()
    expect(wrong.length, `precondition: the seeded alias attached ${cand} articles to Makora`).toBeGreaterThan(0)
    const audit = (await rw.invoke('ontology.aliasAudit')).find((x: any) => x.id === mk)
    expect(audit?.bad || [], 'audit names the seeded alias').toContain(cand)
    const r = await apply('entity.repairAliases', { type: 'company', id: mk })
    out.repair.result = r.result; save()
    expect((await aliasesOf('company', mk)).map(a => a.alias), `${cand} removed`).not.toContain(cand)
    const page = await rw.invoke('object.get', { type: 'company', id: mk })
    expect(page.evidence.filter((e: any) => wrong.some((d: any) => d.id === e.documentId)).map((e: any) => e.text), 'evidence from the unlinked articles').toEqual([])
    await rw.settle(wrong.map((d: any) => d.id), 20 * MIN) // the unlinked articles are re-read and link to the company they name
    const after = await docsOf('company', mk)
    out.repair.linkedAfter = after.length; save()
    expect(after.filter((d: any) => !/makora/i.test(`${d.title}\n${d.text}`)).map((d: any) => d.title), 'articles that never name Makora').toEqual([])
    // the company under its press name counts ("Cerebras Systems" for Cerebras — acc-2026-10-07T19-22-20)
    const norm = cand.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim()
    const own = (await rw.inspect('companies')).find((c: any) => !c.merged_into_id && c.id !== mk && (c.normalized_name === norm || c.normalized_name.startsWith(norm + ' ')))
    out.repair.relinkedTo = own?.name || null; save()
    expect(own, `re-read articles link to ${cand} itself`).toBeTruthy()
    // Today's reasons follow the repair (Backlog 2026-10-06, "Blackstone is connected to Makora"): every "X is connected
    // to Makora" reason names an entity that still has an accepted investment/partnership/founding/job link with Makora
    const tierRels = (await rw.inspect('relationships')).filter((x: any) => x.status === 'accepted' && ['invested_in', 'partner_at', 'founded', 'works_at'].includes(x.rel) && (x.to_id === mk || x.from_id === mk))
    const linkedToMk = new Set(tierRels.map((x: any) => (x.to_id === mk ? x.from_id : x.to_id)))
    const stale = (await rw.inspect('feed_items')).flatMap((it: any) => JSON.parse(it.reasons_json || '[]')).filter((r: any) => r.type === 'connected' && /connected to Makora/.test(r.label) && !linkedToMk.has(r.ref))
    out.repair.staleReasons = stale.map((r: any) => r.label); save()
    expect(stale.map((r: any) => r.label), 'Today reasons naming a link the repair removed').toEqual([])
    expect((await docsOf('company', own.id)).length, `${cand} has the articles`).toBeGreaterThan(0)
    // undo puts the alias and Makora's links back
    await rw.invoke('ontology.undo', { historyIds: r.undo.historyIds })
    expect((await aliasesOf('company', mk)).map(a => a.alias), `${cand} restored by undo`).toContain(cand)
    expect((await docsOf('company', mk)).length, 'links restored by undo').toBeGreaterThanOrEqual(before.length)
    // and repair again, so the rest of the suite works on a clean library
    await apply('entity.repairAliases', { type: 'company', id: mk })
    await rw.settle(srcDocs, 10 * MIN)
    const inv = await rw.invoke('test.ontology.invariants')
    expect(inv.violations, 'invariants').toEqual([])
    await rw.invoke('source.remove', { id: src.id })
  })

  test('RD-TIER-03 following a real firm makes its portfolio Connected within the cap; unfollow removes only orphaned sources', async () => {
    test.setTimeout(60 * MIN)
    const r = await apply('entity.create', { type: 'firm', name: 'M13' })
    ids.M13 = r.result.id
    await hydrated(rw, 'firm', ids.M13)
    await rw.drain(20 * MIN)
    const t = await tiers()
    const viaM13 = t.connected.filter((c: any) => c.via.some((v: any) => v.id === ids.M13))
    out.m13 = { connected: viaM13.map((c: any) => `${c.type}:${c.name}`) }; save()
    expect(viaM13.length, 'M13 portfolio/partners become Connected').toBeGreaterThan(0)
    expect(viaM13.length, 'cap per followed entity').toBeLessThanOrEqual(25)
    const watches = t.covers.filter((c: any) => c.role === 'connected_watch' && c.status === 'accepted' && !c.deletedAt)
    for (const c of viaM13) expect(watches.some((w: any) => w.id === c.id), `${c.name} has a daily news watch`).toBe(true)
    // a source the user adds for M13 themselves must survive unfollow
    const own = t.covers.find((c: any) => c.id === ids.M13 && c.role === 'news_watch')
    expect(own, 'M13 has its own news watch').toBeTruthy()
    const userLoc = gn('"M13" venture')
    const up = await rw.invoke('source.probe', { locator: userLoc })
    const userSrc = up.status === 'found' ? await rw.invoke('source.create', { locator: userLoc, name: 'My M13 search', mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: up }) : null
    await rw.invoke('object.follow', { type: 'firm', id: ids.M13, follow: false })
    await rw.drain(10 * MIN)
    const t2 = await tiers()
    const live = new Set((await rw.inspect('sources')).filter((s: any) => !s.deleted_at).map((s: any) => s.id))
    const stillConnected = new Set(t2.connected.map((c: any) => `${c.type}:${c.id}`))
    const followed = new Set([...(await rw.inspect('companies')), ...(await rw.inspect('firms')), ...(await rw.inspect('people'))].filter((e: any) => e.followed).map((e: any) => e.id))
    out.m13.afterUnfollow = { removed: t.covers.filter((c: any) => !live.has(c.sourceId)).map((c: any) => c.sourceName), kept: t2.covers.filter((c: any) => live.has(c.sourceId)).map((c: any) => c.sourceName) }; save()
    expect(live.has(own.sourceId), "M13's own news watch removed (orphaned)").toBe(false)
    if (userSrc) expect(live.has(userSrc.id), 'the user-added M13 source is kept').toBe(true)
    // every system source still running covers something followed or connected; nothing needed was removed
    for (const c of t2.covers.filter((c: any) => live.has(c.sourceId) && c.origin !== 'user')) {
      const needed = t2.covers.filter((x: any) => x.sourceId === c.sourceId).some((x: any) => followed.has(x.id) || (x.role === 'connected_watch' && stillConnected.has(`${x.type}:${x.id}`)))
      expect(needed, `${c.sourceName} is still needed`).toBe(true)
    }
    for (const c of t.covers.filter((c: any) => !live.has(c.sourceId))) expect(followed.has(c.id) && c.role !== 'connected_watch', `${c.sourceName} was removed while its entity is followed`).toBe(false)
  })

  test('RD-TIER-04 a followed company: hydration ran, its people and investors are Connected; Pull latest subscribes nothing', async () => {
    test.setTimeout(30 * MIN)
    const job = (await rw.inspect('jobs')).filter((j: any) => j.type === 'HYDRATE_OBJECT' && j.idempotency_key === `hydrate:${ids.Makora}`).pop()
    expect(job?.status, 'Makora was looked up when followed').toBe('succeeded')
    const t = await tiers()
    const viaMakora = t.connected.filter((c: any) => c.via.some((v: any) => v.id === ids.Makora))
    out.makoraConnected = viaMakora.map((c: any) => `${c.type}:${c.name}`); save()
    expect(viaMakora.some((c: any) => c.type === 'person' || c.type === 'firm'), "Makora's founders/investors are Connected").toBe(true)
    // Pull latest on an extracted company: coverage is read, no source is created, it stays unfollowed
    const followedOrConnected = new Set([...COMPANIES.map(n => ids[n]), ...t.connected.map((c: any) => c.id)])
    const cos = (await rw.inspect('companies')).filter((c: any) => !c.followed && !c.merged_into_id && !c.deleted_at && !followedOrConnected.has(c.id) && c.name.length > 3)
    const target = cos.find((c: any) => /^[A-Z][\w.-]+(?: [A-Z][\w.-]+)?$/.test(c.name)) || cos[0]
    expect(target, 'an extracted company to pull').toBeTruthy()
    const sourcesBefore = (await rw.inspect('sources')).filter((s: any) => !s.deleted_at).length
    const docsBefore = (await docsOf('company', target.id)).length
    const pr = await rw.invoke('object.pullLatest', { type: 'company', id: target.id })
    expect(pr.message).toMatch(/Looking for the latest/)
    await rw.drain(20 * MIN)
    const job2 = (await rw.inspect('jobs')).filter((j: any) => j.type === 'HYDRATE_OBJECT' && j.idempotency_key === `hydrate:${target.id}`).pop()
    out.pull = { company: target.name, docsBefore, docsAfter: (await docsOf('company', target.id)).length, job: job2?.status, result: JSON.parse(job2?.result_json || '{}').toast }; save()
    expect(job2?.status).toBe('succeeded')
    // nothing subscribed for the pulled company (other sources can appear meanwhile: the tier sync keeps adding watches
    // for the firm followed in RD-TIER-03)
    const forTarget = (await rw.inspect('relationships', { from_type: 'source', rel: 'covers', to_type: 'company', to_id: target.id })).filter((r: any) => r.status === 'accepted')
    const named = (await rw.inspect('sources')).filter((s: any) => !s.deleted_at && s.name === `News: ${target.name}`)
    out.pull.sourcesBefore = sourcesBefore; out.pull.sourcesAfter = (await rw.inspect('sources')).filter((s: any) => !s.deleted_at).length; save()
    expect([...forTarget, ...named], 'no source created by Pull latest').toEqual([])
    expect((await rw.inspect('companies', { id: target.id }))[0].followed, 'still not followed').toBe(0)
  })

  test('RD-TIER-05 Today: Following holds followed/connected items, Your theses holds thesis items, Headlines only items above the bar', async () => {
    test.setTimeout(20 * MIN)
    await rw.invoke('object.follow', { type: 'firm', id: ids.M13, follow: true })
    await rw.drain(15 * MIN)
    const items = (await rw.invoke('feed.list', {})).items
    const docs = await rw.inspect('documents')
    const ev = await rw.inspect('evidence')
    const groups: Record<string, number> = {}
    for (const i of items) groups[i.group] = (groups[i.group] || 0) + 1
    out.today = { groups }; save()
    expect(groups.companies || 0, 'Following has items').toBeGreaterThan(0)
    for (const i of items) {
      const types = i.reasons.map((r: any) => r.type)
      if (i.group === 'companies') expect(types.some((t: string) => /^followed_/.test(t) || t === 'connected'), `Following item "${i.title}" is about something followed or connected`).toBe(true)
      if (i.group === 'theses') expect(i.theses.length, `Your theses item "${i.title}" has a thesis`).toBeGreaterThan(0)
      if (i.group === 'important') {
        const d = docs.find((x: any) => x.id === i.documentId)
        const imp = JSON.parse(d.metadata_json || '{}').interpret?.importance ?? 0
        const deal = ev.some((e: any) => e.document_id === d.id && e.status === 'active' && e.is_novel && ['funding', 'acquisition', 'fund_raise', 'investment'].includes(e.kind))
        const userOrAlert = types.includes('added_by_you') || types.includes('alert')
        expect(userOrAlert || imp >= HEADLINE_ANY || (deal && imp >= HEADLINE_DEAL), `Headline "${i.title}" is above the bar (importance ${imp}, deal ${deal})`).toBe(true)
      }
    }
  })
})
