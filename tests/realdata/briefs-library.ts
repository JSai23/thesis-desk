// The shared real library for the report/briefing suites (RD-BR, RD-BRF, RD-BRF-UI): TechCrunch startups, Crunchbase
// News + 7 days of older posts, a Google News seed/Series A search; three theses; the user's Gmail installed. Built once
// per run by whichever suite runs first (preparedLibrary cache name 'realdata-briefs').
import { installEmail, until, type RW } from '../harness/app'

const MIN = 60_000
export const BRIEFS_THESES = ['AI infrastructure', 'AI applications', 'Fintech']
export const BRIEFS_SOURCES = ['https://techcrunch.com/category/startups/feed/', 'https://news.crunchbase.com/feed/',
  'https://news.google.com/rss/search?q=%28%22seed+round%22+OR+%22Series+A%22%29+raises+when:7d&hl=en-US&gl=US&ceid=US:en']

export async function buildBriefsLibrary(rw: RW): Promise<{ subscribed: string[]; failed: Record<string, string> }> {
  await installEmail(rw)
  await rw.invoke('settings.update', { patch: { 'processing.daily_cap': 1000 } })
  for (const t of BRIEFS_THESES) await rw.invoke('thesis.create', { title: t })
  const subscribed: string[] = [], failed: Record<string, string> = {}
  for (const loc of BRIEFS_SOURCES) {
    const probe = await rw.invoke('source.probe', { locator: loc })
    if (probe.status !== 'found') { failed[loc] = probe.status; continue }
    await rw.invoke('source.create', { locator: loc, mode: 'all', instruction: '', freq: 'daily', thesisIds: [], probe })
    subscribed.push(loc)
  }
  await until(async () => (await rw.inspect('jobs')).every((j: any) => j.type !== 'FETCH_SOURCE' || !['queued', 'running'].includes(j.status)) || null, 30 * MIN, 3000)
  const cb = (await rw.inspect('sources')).find((s: any) => /crunchbase/i.test(s.locator || s.config_json || s.name))
  if (cb) await rw.invoke('source.backfill', { id: cb.id, days: 7 })
  await rw.drain(90 * MIN)
  return { subscribed, failed }
}
