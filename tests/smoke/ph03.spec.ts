// SMK-03 (RFC PH-03): documents become grounded evidence, entities, relationships, field values and thesis links.
import { test, expect } from '@playwright/test'
import { launch, until, reloadApp } from '../harness/app'
import { fixtures } from '../harness/fixtures'

test('SMK-03 PH-03 extraction, evidence, entities, interpretation', async () => {
  await fixtures.reset()
  const rw = await launch()
  const th = await rw.invoke('thesis.create', { title: 'Legal AI' })
  await rw.invoke('thesis.update', { id: th.id, patch: { description: 'AI products that automate legal work such as contract review are becoming the default for law firms and legal teams.' } })
  const r = await rw.invoke('ingress.addUrl', { url: 'http://northwind.test:4700/blog/our-investment-in-lumen-legal' })
  const t0 = Date.now()
  await rw.drain(180_000)
  expect(Date.now() - t0).toBeLessThan(180_000)

  const doc = (await rw.inspect('documents', { id: r.documentId }))[0]
  expect(doc.status).toBe('processed')
  const cos = await rw.inspect('companies')
  const lumen = cos.find((c: any) => c.name === 'Lumen Legal')
  expect(lumen, 'company Lumen Legal').toBeTruthy()
  const firms = await rw.inspect('firms')
  const nw = firms.find((f: any) => f.name === 'Northwind Ventures')
  expect(nw, 'firm Northwind Ventures').toBeTruthy()
  const inv = (await rw.inspect('relationships', { from_type: 'firm', from_id: nw.id, rel: 'invested_in', to_type: 'company', to_id: lumen.id }))[0]
  expect(inv?.status).toBe('accepted')
  expect(JSON.parse(inv.payload_json).role).toBe('lead')

  const ev = await rw.inspect('evidence', { document_id: r.documentId, status: 'active' })
  const funding = ev.filter((e: any) => e.kind === 'funding')
  expect(funding.length).toBeGreaterThanOrEqual(1)
  for (const e of ev) expect(doc.text.slice(e.quote_start, e.quote_end)).toBe(e.quote)

  const people = await rw.inspect('people')
  const priya = people.find((p: any) => p.name === 'Priya Raman')
  expect(priya, 'person Priya Raman').toBeTruthy()
  const pa = await rw.inspect('relationships', { from_type: 'person', from_id: priya.id, rel: 'partner_at', to_type: 'firm', to_id: nw.id })
  expect(pa[0]?.status).toBe('accepted')

  const stage = (await rw.inspect('field_values', { object_type: 'company', object_id: lumen.id, field_key: 'stage', status: 'current' }))[0]
  expect(stage?.display).toBe('Series A')
  expect(stage.origin).toBe('source_fact')
  expect(stage.evidence_id).toBeTruthy()

  const thLinks = (await rw.inspect('relationships', { to_type: 'thesis', to_id: th.id, status: 'suggested' })).filter((x: any) => x.origin === 'ai_inference')
  expect(thLinks.length, 'suggested link to Legal AI').toBeGreaterThanOrEqual(1)
  const runs = await rw.inspect('agent_runs', { status: 'succeeded' })
  expect(runs.some((x: any) => x.task === 'EXTRACT_DOCUMENT')).toBe(true)
  expect(runs.some((x: any) => x.task === 'INTERPRET_DOCUMENT')).toBe(true)

  // fault: invalid_always:EXTRACT_DOCUMENT → document failed, reader shows Retry, no evidence
  await rw.invoke('test.faults.set', { spec: 'invalid_always:EXTRACT_DOCUMENT' })
  const r2 = await rw.invoke('ingress.addUrl', { url: 'http://misc.test:4700/claimwise-interview.html' })
  await rw.drain(180_000)
  const d2 = (await rw.inspect('documents', { id: r2.documentId }))[0]
  expect(d2.status).toBe('failed')
  expect((await rw.inspect('evidence', { document_id: r2.documentId })).length).toBe(0)
  const inv2 = await rw.inspect('agent_runs', { task: 'EXTRACT_DOCUMENT', status: 'invalid' })
  expect(inv2.length).toBeGreaterThanOrEqual(1)
  await rw.invoke('test.faults.set', { spec: '' })
  await reloadApp(rw.page)
  await rw.page.getByText('Claimwise’s Ana Costa on taking the SLA').first().click().catch(async () => { await rw.page.getByText("Claimwise's Ana Costa on taking the SLA").first().click() })
  await expect(rw.page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await rw.close()
})
