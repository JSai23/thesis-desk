// SMK-09 (RFC PH-09): AI-editable views and custom fields (company, thesis type scope, Today), Undo, invalid output.
import { test, expect } from '@playwright/test'
import { launch, until } from '../harness/app'
import { fixtures } from '../harness/fixtures'

test('SMK-09 PH-09 AI-editable views and custom fields', async () => {
  await fixtures.reset()
  let rw = await launch()
  const page = rw.page
  const t1 = await rw.invoke('thesis.create', { title: 'Legal AI' })
  const t2 = await rw.invoke('thesis.create', { title: 'AI replacing outsourced support labor' })
  await rw.invoke('ingress.addUrl', { url: 'http://signalwire.test:4700/lumen-legal-series-a' })
  await rw.invoke('ingress.addUrl', { url: 'http://misc.test:4700/claimwise-interview.html' })
  await rw.drain(300_000)
  const lumen = (await rw.inspect('companies')).find((c: any) => c.name === 'Lumen Legal')
  const cw = (await rw.inspect('companies')).find((c: any) => c.name === 'Claimwise')
  expect(lumen && cw).toBeTruthy()

  // (a) company page through the Customize sheet
  const before = await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })
  await page.getByText('Companies', { exact: true }).first().click()
  await page.getByText('All tracked').click()
  await page.getByText('Lumen Legal', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Customize' }).click()
  await page.getByLabel('Describe the layout').fill('Put funding history first and hide headquarters')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText(/Updated Lumen Legal’s page/)).toBeVisible({ timeout: 60_000 })
  const after = await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })
  expect(after.definition.main[0].component).toBe('funding_table')
  expect(after.definition.headerFields).not.toContain('hq')
  await expect(page.locator('[data-section="custom"]').first()).toBeVisible()
  rw = await rw.restart()
  const again = await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })
  expect(JSON.stringify(again.definition)).toBe(JSON.stringify(after.definition))
  await rw.invoke('view.undo', { viewId: after.id })
  const undone = await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })
  expect(JSON.stringify(undone.definition)).toBe(JSON.stringify(before.definition))

  // (b) type scope on theses → a second thesis also shows contra first
  const r = await rw.invoke('view.customize', { objectType: 'thesis', objectId: t1.id, instruction: 'On thesis pages, show contradicting evidence before supporting' })
  expect(r.scope).toBe('type')
  const v2 = await rw.invoke('view.get', { objectType: 'thesis', objectId: t2.id })
  expect(v2.scope).toBe('type')
  expect(v2.definition.main.find((s: any) => s.component === 'evidence_columns').params.order).toBe('contra_first')

  // (c) custom field with backfill and evidence provenance
  await rw.invoke('view.customize', { objectType: 'company', objectId: lumen.id, instruction: 'Track employee count on companies' })
  const fd = (await rw.inspect('field_defs')).find((f: any) => f.key === 'employee_count')
  expect(fd?.value_type).toBe('number')
  await rw.drain(300_000)
  const fv = (await rw.inspect('field_values', { object_type: 'company', object_id: cw.id, field_key: 'employee_count', status: 'current' }))[0]
  expect(JSON.parse(fv.value_json)).toBe(40)
  const ev = (await rw.inspect('evidence', { id: fv.evidence_id }))[0]
  expect(ev.quote).toContain('40 employees')

  // (d) Today: group by thesis
  await rw.invoke('view.customize', { objectType: 'feed', instruction: 'Group by thesis' })
  const fdef = await rw.invoke('view.get', { objectType: 'feed' })
  expect(fdef.definition.spec.groupBy).toBe('thesis')

  // (e) invalid output twice → no new version, sheet error
  await rw.invoke('test.faults.set', { spec: 'invalid_always:CUSTOMIZE_VIEW' })
  const vbefore = await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })
  await rw.page.getByText('Companies', { exact: true }).first().click()
  await rw.page.getByText('All tracked').click()
  await rw.page.getByText('Lumen Legal', { exact: true }).first().click()
  await rw.page.getByRole('button', { name: 'Customize' }).click()
  await rw.page.getByLabel('Describe the layout').fill('Show pricing changes at the top')
  await rw.page.getByRole('button', { name: 'Apply' }).click()
  await expect(rw.page.getByText('I couldn’t turn that into a layout change. Try naming a section, field or order.')).toBeVisible({ timeout: 60_000 })
  const vafter = await rw.invoke('view.get', { objectType: 'company', objectId: lumen.id })
  expect(vafter.version).toBe(vbefore.version)
  const bad = await rw.inspect('agent_runs', { task: 'CUSTOMIZE_VIEW', status: 'invalid' })
  expect(bad[bad.length - 1].attempts).toBe(2)
  await rw.close()
})
