// SMK-06's live-newsletter step (DEC-086): the frozen real StrictlyVC issue, appended to the user's Gmail, becomes a
// document with ≥3 evidence rows. Non-blocking live check; skipped (with the reason recorded) while the saved message
// is only the subscription confirmation — `node prereq/email-probe.mjs` saves a real issue once one arrives.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, installEmail, ROOT } from '../harness/app'
import { imapAppend, imapCleanup } from '../harness/imap'

const SVC = path.join(ROOT, 'fixtures/email/strictlyvc-live.eml')

test('LIVE StrictlyVC newsletter issue (SMK-06 live step)', async () => {
  // the saved issue is a real email to the maintainer's inbox and is not published (.gitignore): skip without it
  test.skip(!fs.existsSync(SVC), 'fixtures/email/strictlyvc-live.eml is local-only — `node prereq/email-probe.mjs` saves one')
  const raw = fs.readFileSync(SVC, 'utf8')
  const subject = (raw.match(/^Subject:\s*(.*)$/im) || [])[1] || ''
  test.skip(/confirm|verify|welcome|subscription/i.test(subject), `saved StrictlyVC message is "${subject}", not an issue yet (CP-EMAIL, DEC-086)`)
  const rw = await launch()
  try {
    await imapAppend(SVC)
    await installEmail(rw)
    const p = await rw.invoke('source.probe', { locator: 'connie@strictlyvc.com' })
    expect(p.status).toBe('found')
    const svc = await rw.invoke('source.create', { locator: 'connie@strictlyvc.com', mode: 'all', instruction: '', freq: 'realtime', thesisIds: [], probe: p })
    await rw.drain(600_000)
    const docs = await rw.inspect('document_sources', { source_id: svc.id })
    expect(docs.length).toBeGreaterThanOrEqual(1)
    let best = 0
    for (const d of docs) best = Math.max(best, (await rw.inspect('evidence', { document_id: d.document_id, status: 'active' })).length)
    expect(best).toBeGreaterThanOrEqual(3)
  } finally {
    await imapCleanup()
    await rw.close()
  }
})
