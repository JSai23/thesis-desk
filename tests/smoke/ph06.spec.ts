// SMK-06 (RFC PH-06): Gmail newsletter sources over IMAP with an app password; Message-ID dedupe (live StrictlyVC step: tests/live, DEC-086).
import { test, expect } from '@playwright/test'
import path from 'node:path'
import { launch, installEmail, ROOT } from '../harness/app'
import { imapAppend, imapCleanup, imapCleanupLeftovers } from '../harness/imap'

const D12 = path.join(ROOT, 'fixtures/email/deal-memo-daily-2026-09-25.eml')

test('SMK-06 PH-06 email newsletter ingress', async () => {
  const rw = await launch()
  try {
    await imapCleanupLeftovers() // what a killed run appended and never moved to Trash (by ledger UID only)
    const tag = Date.now().toString(36)
    const a1 = await imapAppend(D12, { fromTag: tag })
    await installEmail(rw)
    expect((await rw.invoke('app.status')).emailConfigured).toBe(true)
    const t = await rw.invoke('email.test')
    expect(t.ok).toBe(true)

    const sender = `dealmemo+${tag}@fixtures.research-workspace.test`
    const p = await rw.invoke('source.probe', { locator: sender })
    expect(p.status).toBe('found'); expect(p.kind).toBe('email'); expect(p.typeLabel).toBe('Newsletter')
    expect(p.recent.some((r: any) => /Deal Memo Daily/.test(r.title))).toBe(true)
    const src = await rw.invoke('source.create', { locator: sender, mode: 'all', instruction: '', freq: 'realtime', thesisIds: [], probe: p })
    await rw.drain(300_000)
    // this run's message became exactly one document (older fixture mail in the label, if any, is not this test's)
    const ds = await rw.inspect('document_sources', { source_id: src.id })
    const mine = (await Promise.all(ds.map(async (x: any) => (await rw.inspect('documents', { id: x.document_id }))[0]))).filter((d: any) => d?.email_message_id === a1.messageId)
    expect(mine.length).toBe(1)
    const doc = mine[0]
    expect(doc.kind).toBe('email'); expect(doc.status).toBe('processed'); expect(doc.email_message_id).toBe(a1.messageId)
    const ev = await rw.inspect('evidence', { document_id: doc.id, status: 'active' })
    expect(ev.some((e: any) => /Claimwise/.test(e.quote) && /\$9 million seed/.test(e.quote) && /Harbor Point Capital/.test(e.quote))).toBe(true)
    const items = (await rw.invoke('feed.list', { viewSpec: { segment: 'all' } })).items
    expect(items.find((i: any) => i.documentId === doc.id)?.srcType).toBe('Newsletter')

    // the same message again → no new document
    await imapAppend(D12, { messageId: a1.messageId, fromTag: tag })
    await rw.invoke('source.syncNow', { id: src.id })
    await rw.drain(300_000)
    expect((await rw.inspect('documents')).filter((d: any) => d.kind === 'email' && d.email_message_id === a1.messageId).length).toBe(1)

    // the live StrictlyVC step runs in tests/live/strictlyvc.spec.ts (non-blocking until a real issue exists; DEC-086)
  } finally {
    await imapCleanup()
    await rw.close()
  }
})
