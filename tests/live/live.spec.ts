// Live smoke (RFC §3E step 9, non-blocking): every starter-pack source is subscribed in a clean profile and must
// yield ≥1 processed document from the real site. To spare the shared ChatGPT allowance (PRQ-AI-02) each source gets
// its own profile and the app is closed as soon as one document is processed. No real-Chrome bridge read happens here.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launch, installEmail, until, ROOT } from '../harness/app'

const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/resources/starter-pack.json'), 'utf8'))
const SOURCES: { name: string; locator: string; kind: string }[] = PACK.sources || PACK
const RESULTS = path.join(ROOT, 'tests/results', process.env.RW_RUN_ID || 'dev', 'live-smoke.jsonl')

for (const s of SOURCES) {
  test(`LIVE ${s.name}`, async () => {
    test.setTimeout(10 * 60_000)
    const rw = await launch({ testNow: null })
    const outcome: Record<string, unknown> = { name: s.name, locator: s.locator, kind: s.kind }
    try {
      if (s.kind === 'email') await installEmail(rw)
      const probe = await rw.invoke('source.probe', { locator: s.locator })
      outcome.probe = probe.status
      expect(probe.status, `probe ${s.locator}: ${probe.message || ''}`).toBe('found')
      const src = await rw.invoke('source.create', { locator: s.locator, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe })
      const processed = await until(async () => {
        const ds = new Set((await rw.inspect('document_sources', { source_id: src.id })).map((r: any) => r.document_id))
        const docs = (await rw.inspect('documents')).filter((d: any) => ds.has(d.id))
        outcome.documents = docs.length
        const failed = (await rw.inspect('jobs', { type: 'FETCH_SOURCE' })).find((j: any) => j.status === 'failed')
        if (failed) throw new Error(`fetch failed: ${failed.error_code} ${failed.error_message}`)
        return docs.find((d: any) => d.status === 'processed' || d.status === 'triaged_out') || null
      }, 8 * 60_000, 2000)
      outcome.processed = processed.title
      outcome.ok = true
    } catch (e) {
      outcome.ok = false; outcome.error = String((e as Error).message).slice(0, 300)
      throw e
    } finally {
      fs.mkdirSync(path.dirname(RESULTS), { recursive: true })
      fs.appendFileSync(RESULTS, JSON.stringify(outcome) + '\n')
      await rw.close()
    }
  })
}
