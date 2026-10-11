// Shared CORPUS-1 setup and small helpers for the backend E2E suite (RFC §3A).
import { expect } from '@playwright/test'
import type { RW } from '../harness/app'

export const MIN = 60_000, H = 60 * MIN, D = 24 * H
export const U = {
  swFeed: 'http://signalwire.test:4700/feed.xml',
  D1: 'http://signalwire.test:4700/lumen-legal-series-a',
  D2: 'http://vln.test:4700/2026/09/22/lumen-legal-series-a',
  D3: 'http://signalwire.test:4700/quillmate-amlaw',
  D4: 'http://signalwire.test:4700/callhaven-ceiling',
  D5: 'http://signalwire.test:4700/brightdesk-cfo',
  D6: 'http://vln.test:4700/2026/09/24/brightdesk-pricing',
  D7: 'http://northwind.test:4700/blog/our-investment-in-lumen-legal',
  D8: 'http://northwind.test:4700/blog/services-are-the-new-software',
  D9: 'http://stackforge.test:4700/blog/introducing-forge-agents',
  D10: 'http://stackforge.test:4700/blog/series-b',
  D12w: 'http://vln.test:4700/2026/09/25/deal-memo-daily',
  D13: 'http://misc.test:4700/claimwise-interview.html',
  D18: 'http://signalwire.test:4700/claimwise-meridian',
  nwBlog: 'http://northwind.test:4700/blog/',
  sfBlog: 'http://stackforge.test:4700/blog/',
  hn: 'http://hn.test:4700/v0'
}

/** CORPUS-1 theses (§3A). */
export async function corpusTheses(rw: RW) {
  const legal = await rw.invoke('thesis.create', { title: 'Legal AI' })
  const labor = await rw.invoke('thesis.create', { title: 'AI replacing outsourced support labor' })
  const claims = await rw.invoke('thesis.create', { parentId: labor.id, title: 'Claims & insurance operations' })
  const devinfra = await rw.invoke('thesis.create', { title: 'AI-native developer infrastructure' })
  return { legal, labor, claims, devinfra }
}

export async function addSource(rw: RW, locator: string, o: { mode?: string; freq?: string; instruction?: string } = {}) {
  const probe = await rw.invoke('source.probe', { locator })
  expect(probe.status, `probe ${locator}`).toBe('found')
  return rw.invoke('source.create', { locator, mode: o.mode || 'all', instruction: o.instruction || '', freq: o.freq || 'daily', thesisIds: [], probe })
}

export const docBy = async (rw: RW, pred: (d: any) => boolean) => (await rw.inspect('documents')).find(pred)
export const docByUrl = (rw: RW, url: string) => docBy(rw, d => d.url === url || d.canonical_url === url)
export const company = async (rw: RW, name: string) => (await rw.inspect('companies')).find((c: any) => c.name === name && !c.merged_into_id)
export const firm = async (rw: RW, re: RegExp) => (await rw.inspect('firms')).find((f: any) => re.test(f.name) && !f.merged_into_id)
export const activeEvidence = (rw: RW, documentId: string) => rw.inspect('evidence', { document_id: documentId, status: 'active' })
export const payload = (e: any) => JSON.parse(e.payload_json || '{}')
