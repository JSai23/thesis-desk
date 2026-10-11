// Blind-evaluation pre-states (RFC §3C). Run by tests/blind/run.mjs through tests/blind/playwright.config.ts with:
//   BLIND_SETUP_DIR=<run>/setup  BLIND_PROFILE=knowledge|ux
// knowledge → <setup>/base = BK-SETUP.
// ux        → <setup>/base = BK-SETUP + signed in to X inside the app (UX-11); Ledger is added last so that
//             <setup>/ux08 = the same state *without* the Ledger source (UX-08 asks the agent to add it);
//             <setup>/ux09 = base + a note on a Signal Wire article + a saved Signal Wire item (UX-09 pre-state).
// Every pre-state is copied while the app is closed. Writes <setup>/manifest.json.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, installEmail, envLocal, until, ROOT, type RW } from '../harness/app'
import { fixtures } from '../harness/fixtures'
import { imapAppend, imapCleanup } from '../harness/imap'
import { signInLedger } from '../harness/ledger'
import { U, corpusTheses, addSource, docByUrl, company } from '../e2e-backend/common'

const OUT = process.env.BLIND_SETUP_DIR || ''
const PROFILE = process.env.BLIND_PROFILE || 'knowledge'
const D12_EML = path.join(ROOT, 'fixtures/email/deal-memo-daily-2026-09-25.eml')
const DEAL_MEMO = 'dealmemo@fixtures.research-workspace.test'
const LEDGER = 'http://ledger.test:4700/'
const VLN = 'http://vln.test:4700/'

const manifest: Record<string, any> = { profile: PROFILE, startedAt: new Date().toISOString(), steps: [] as string[], warnings: [] as string[], states: {} }
const step = (s: string) => { manifest.steps.push(`${new Date().toISOString()} ${s}`); console.log('[blind-setup]', s) }

/** Copy a closed profile, skipping Chromium's per-process singleton files. */
function copyProfile(from: string, to: string) {
  fs.cpSync(from, to, { recursive: true, filter: src => !/Singleton(Lock|Cookie|Socket)$/.test(src) })
}

async function counts(rw: RW) {
  const docs = await rw.inspect('documents')
  return {
    sources: (await rw.inspect('sources')).filter((s: any) => !s.deleted_at).map((s: any) => ({ kind: s.kind, locator: s.locator, auth: s.auth_state, health: s.health })),
    documents: docs.length,
    byStatus: docs.reduce((m: any, d: any) => ((m[d.status] = (m[d.status] || 0) + 1), m), {}),
    evidence: (await rw.inspect('evidence')).length,
    feedItems: (await rw.inspect('feed_items')).length
  }
}

async function addLedger(rw: RW) {
  const p = await rw.invoke('source.probe', { locator: LEDGER })
  expect(p.status, 'ledger probe').toBe('login_required')
  const src = await rw.invoke('source.create', { locator: LEDGER, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe: p })
  await signInLedger(rw, src.id)
  await until(async () => (await rw.invoke('source.get', { id: src.id })).authState === 'authenticated', 60_000)
  step('ledger source added and signed in')
  return src
}

async function signInX(rw: RW) {
  await rw.invoke('source.signIn', { id: 'site:x.test' })
  const login: Page = await until(async () => rw.app.windows().find(w => /x\.test:4700\/login/.test(w.url())) || null, 30_000)
  await login.fill('input[name=user]', 'reader@x.test'); await login.fill('input[name=password]', 'fixture')
  await login.click('button[type=submit]')
  await until(async () => rw.app.windows().find(w => /x\.test:4700\/home/.test(w.url())) || null, 30_000)
  step('signed in to X inside the app')
}

test('blind setup', async () => {
  test.setTimeout(120 * 60_000)
  expect(OUT, 'BLIND_SETUP_DIR').toBeTruthy()
  fs.mkdirSync(OUT, { recursive: true })
  const base = path.join(OUT, 'base')
  await fixtures.reset()
  step('fixtures reset (epoch 1)')
  let rw = await launch({ dataDir: base })
  let emailOk = false
  try {
    await corpusTheses(rw)
    step('theses created: Legal AI, AI replacing outsourced support labor (child Claims & insurance operations), AI-native developer infrastructure')
    await addSource(rw, U.swFeed)
    await addSource(rw, VLN)
    await addSource(rw, U.nwBlog)
    await addSource(rw, U.sfBlog)
    await addSource(rw, U.hn, { mode: 'relevant' })
    step('sources added: Signal Wire rss, VLN web, Northwind web, Stackforge web, HN')
    const e = envLocal()
    if (e.RW_EMAIL_USER && e.RW_EMAIL_PASS) {
      await imapAppend(D12_EML)
      await installEmail(rw)
      await addSource(rw, DEAL_MEMO, { freq: 'realtime' })
      emailOk = true
      step('Deal Memo email appended over IMAP; Gmail installed; newsletter source added')
    } else manifest.warnings.push('prereq/.env.local lacks RW_EMAIL_USER/RW_EMAIL_PASS — Deal Memo email source skipped')
    if (PROFILE === 'knowledge') await addLedger(rw)
    await rw.invoke('ingress.addUrl', { url: U.D13 })
    step('manual D13 added (Read once)')
    const d1 = await rw.drain(1_200_000)
    step(`epoch 1 drain: ${JSON.stringify(d1)}`)
    for (const name of ['Lumen Legal', 'Brightdesk']) {
      const c = await company(rw, name)
      if (c) await rw.invoke('object.follow', { type: 'company', id: c.id, follow: true })
      else manifest.warnings.push(`company ${name} not found after epoch 1 — not followed`)
    }
    step('followed Lumen Legal and Brightdesk')
    await fixtures.epoch(2)
    for (const s of (await rw.inspect('sources')).filter((s: any) => !s.deleted_at && s.kind !== 'manual')) await rw.invoke('source.syncNow', { id: s.id })
    const d2 = await rw.drain(1_200_000)
    step(`epoch 2 sync all + drain: ${JSON.stringify(d2)}`)

    if (PROFILE === 'ux') {
      await signInX(rw)
      manifest.states.ux08 = await counts(rw)
      await rw.close()
      copyProfile(base, path.join(OUT, 'ux08'))
      step('pre-state ux08 copied (no Ledger source)')
      rw = await launch({ dataDir: base })
      await addLedger(rw)
      step(`ledger drain: ${JSON.stringify(await rw.drain(600_000))}`)
    }
    manifest.states.base = await counts(rw)
    await rw.close()

    if (PROFILE === 'ux') {
      const ux09 = path.join(OUT, 'ux09')
      copyProfile(base, ux09)
      rw = await launch({ dataDir: ux09 })
      const d4 = await docByUrl(rw, U.D4), d1doc = await docByUrl(rw, U.D1)
      expect(d4 && d1doc, 'Signal Wire D1/D4 present').toBeTruthy()
      await rw.invoke('note.create', { text: 'The 58% ceiling is the number to watch for support automation.', documentId: d4.id, anchor: { type: 'none' } })
      const item = (await rw.inspect('feed_items', { document_id: d1doc.id }))[0]
      await rw.invoke('feed.save', { ids: [item.id], saved: true })
      manifest.states.ux09 = { ...(await counts(rw)), note: 'The 58% ceiling is the number to watch for support automation.', noteDocumentId: d4.id, savedFeedItemId: item.id }
      await rw.close()
      step('pre-state ux09 prepared (note on D4, D1 saved)')
    }
  } finally {
    await rw.close()
    if (emailOk) { try { await imapCleanup(); step('IMAP fixture messages moved to Trash') } catch (err) { manifest.warnings.push('imapCleanup failed: ' + String(err)) } }
    manifest.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  }
})
