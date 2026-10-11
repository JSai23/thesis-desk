// SMK-07b (RFC PH-07b): saved searches; user-sent restricted pages (one page load per send, no clicks); refusal of
// profile URLs; bookmarklet capture via the researchworkspace:// scheme with no page load.
import { test, expect, type Page } from '@playwright/test'
import { launch, until } from '../harness/app'
import { fixtures } from '../harness/fixtures'

test('SMK-07b PH-07b saved searches, user-sent pages, bookmarklet', async () => {
  await fixtures.reset()
  const rw = await launch()

  // (a) saved search (Google-News-shaped fixture with redirect links) → publisher URLs canonical; resync adds 0
  const p = await rw.invoke('source.probe', { locator: 'Lumen Legal funding news' })
  expect(p.status).toBe('found'); expect(p.kind).toBe('search'); expect(p.typeLabel).toBe('Saved search')
  const src = await rw.invoke('source.create', { locator: 'Lumen Legal funding news', mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  await rw.drain(400_000)
  const docs = await rw.inspect('documents')
  expect(docs.some((d: any) => d.canonical_url === 'http://vln.test:4700/2026/09/22/lumen-legal-series-a')).toBe(true)
  expect(docs.some((d: any) => d.canonical_url === 'http://vln.test:4700/2026/09/24/brightdesk-pricing')).toBe(true)
  const partial = docs.find((d: any) => d.title.startsWith('Unresolvable story'))
  expect(partial?.access).toBe('partial')
  const n = docs.length
  await rw.invoke('source.syncNow', { id: src.id }); await rw.drain(300_000)
  expect((await rw.inspect('documents')).length).toBe(n)

  // (b) Read once of an x.test post while signed out → pending capture + sign-in prompt; sign in → processed
  const post = 'http://x.test:4700/dana_okafor_fx/status/101'
  const r1 = await rw.invoke('ingress.addUrl', { url: post })
  expect(r1.pending).toBe(true)
  expect((await rw.inspect('documents', { id: r1.documentId }))[0].status).toBe('pending_capture')
  const hist = await rw.invoke('source.history')
  expect(hist[0].outcome).toMatch(/Sign in to X/); expect(hist[0].signInDomain).toBe('x.test')
  expect((await fixtures.xState()).postLoads['/dana_okafor_fx/status/101']).toBe(1)
  await rw.invoke('source.signIn', { id: 'site:x.test' })
  const login: Page = await until(async () => rw.app.windows().find(w => /x\.test:4700\/login/.test(w.url())) || null, 30_000)
  await login.fill('input[name=user]', 'reader@x.test')
  await login.fill('input[name=password]', 'fixture')
  await login.click('button[type=submit]')
  await until(async () => (await rw.inspect('documents')).some((d: any) => d.text.includes('run Lumen Legal next to a second vendor')), 60_000)
  await rw.drain(300_000)
  const xs = await fixtures.xState()
  expect(xs.postLoads['/dana_okafor_fx/status/101']).toBe(2) // one per send: the first (signed out) and the retry
  expect(xs.clicks).toBe(0)
  const xdoc = (await rw.inspect('documents')).find((d: any) => d.text.includes('run Lumen Legal next to a second vendor'))
  expect(xdoc.status).toBe('processed')
  expect(xdoc.title).toMatch(/^Dana Okafor/)

  // (c) a profile URL is refused for watching, without loading the page
  const before = JSON.stringify((await fixtures.xState()).postLoads)
  const loadsBefore = (await fixtures.state()).loads.x || 0
  const pr = await rw.invoke('source.probe', { locator: 'http://x.test:4700/somehandle' })
  expect(pr.status).toBe('unsupported'); expect(pr.message).toMatch(/can’t be watched automatically/)
  expect((await fixtures.state()).loads.x || 0).toBe(loadsBefore)
  expect(JSON.stringify((await fixtures.xState()).postLoads)).toBe(before)

  // (d) researchworkspace://add?url=…&text=… → capture with the selected text and no page load
  const sel = 'Claims intake is the next wedge for vertical AI; carriers want vendors who take the SLA, not just sell software.'
  const link = `researchworkspace://add?url=${encodeURIComponent('http://x.test:4700/someone/status/103')}&text=${encodeURIComponent(sel)}`
  await rw.app.evaluate(({ app }, l) => { app.emit('open-url', { preventDefault() {} }, l) }, link)
  await until(async () => (await rw.inspect('documents')).some((d: any) => d.text === sel), 30_000)
  const cap = (await rw.inspect('documents')).find((d: any) => d.text === sel)
  expect(JSON.parse(cap.metadata_json).capturedBy).toBe('user_selection')
  expect((await fixtures.xState()).postLoads['/someone/status/103']).toBeUndefined()
  await rw.drain(300_000)
  await rw.close()
})
