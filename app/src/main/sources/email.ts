// Newsletter sources from the user's Gmail over IMAP (RFC §1B.8.2 `email`, PH-06). Probe: SEARCH FROM <sender>
// SINCE 60 days; fetch: messages newer than the cursor → mailparser → normalized paragraphs (tracking/footer stripped).
import { simpleParser } from 'mailparser'
import { withImap, searchFolder, account } from '../mail'
import { parseFragment } from '../ingest/parser'
import { addProbeHandler, baseResult, relatedTheses, type ProbeResult } from './probe'
import { addAdapter } from './index'
import type { SourceRow, FetchResult, Item } from './adapters'
import { log } from '../log'
import { redactTokens } from '../files'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DAY = 86400_000

/** Drop the trailing unsubscribe/footer block and tiny link-list lines. */
export function cleanNewsletter(paras: string[]): string[] {
  let end = paras.length
  for (let i = Math.floor(paras.length * 0.6); i < paras.length; i++) {
    if (/unsubscribe|update your preferences|manage (your )?subscription|view (this email|in browser)|you('| a)re receiving this/i.test(paras[i])) { end = i; break }
  }
  return paras.slice(0, end).filter(p => p.length > 1 && !/^(view in browser|read online|forward to a friend)$/i.test(p))
}

async function messageItem(source: Buffer, uid: number): Promise<Item | null> {
  const m = await simpleParser(source)
  const html = m.html || (m.textAsHtml ?? '') || ''
  let paras = html ? await parseFragment(String(html).replace(/<img[^>]*>/gi, '')) : (m.text || '').split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  paras = cleanNewsletter(paras)
  const text = paras.join('\n\n')
  if (!text) return null
  const fromName = m.from?.value?.[0]?.name || m.from?.value?.[0]?.address || 'Newsletter'
  return {
    itemKey: 'uid:' + uid, url: null, kind: 'email', title: (m.subject || '(no subject)').trim(), text, author: fromName, siteName: fromName,
    publishedAt: m.date ? m.date.getTime() : null, access: 'full', raw: { ext: 'eml', body: redactTokens(source.toString('utf8')) }, emailMessageId: m.messageId || null,
    metadata: { from: m.from?.value?.[0]?.address || null, listId: (m.headers.get('list-id') as any)?.text || m.headers.get('list-id') || null }
  }
}

export function registerEmail(): void {
  addProbeHandler(async (locator: string): Promise<ProbeResult | null> => {
    if (!EMAIL_RE.test(locator.trim())) return null
    const sender = locator.trim().toLowerCase()
    if (!account()) return baseResult(sender, { status: 'unsupported', kind: 'email', name: sender, typeLabel: 'Newsletter', message: 'Connect Gmail in Settings ▸ Accounts to add newsletters.' })
    try {
      return await withImap(async c => {
        const folder = await searchFolder(c)
        const lock = await c.getMailboxLock(folder)
        try {
          const uids = (await c.search({ from: sender, since: new Date(Date.now() - 60 * DAY) }, { uid: true })) || []
          const recent: ProbeResult['recent'] = []
          let name = sender
          for (const uid of uids.slice(-5).reverse()) {
            const msg = await c.fetchOne(String(uid), { envelope: true }, { uid: true })
            if (msg && msg.envelope) { recent.push({ title: msg.envelope.subject || '(no subject)', publishedAt: msg.envelope.date ? new Date(msg.envelope.date as any).getTime() : undefined }); name = msg.envelope.from?.[0]?.name || name }
          }
          return baseResult(sender, {
            status: 'found', kind: 'email', name, typeLabel: 'Newsletter', canonicalLocator: sender, trust: 'editorial', recent, siteDomain: sender.split('@')[1],
            suggestedMode: 'relevant', suggestedFreq: 'realtime', relatedThesisIds: relatedTheses(recent.map(r => r.title)),
            configDraft: { version: 1, fetch: { adapter: 'email', render: 'http', email: { folder, match: { from: sender } }, maxItemsPerSync: 50, historyWindowDays: 30 }, extract: { customFieldKeys: 'all_active' } },
            message: recent.length ? undefined : 'Nothing from this sender in the last 60 days yet. New issues will appear as they arrive.'
          })
        } finally { lock.release() }
      })
    } catch (e) {
      return baseResult(sender, { status: 'unreachable', kind: 'email', name: sender, message: (e as Error).message })
    }
  })

  addAdapter('email', async (src: SourceRow, cursor: any): Promise<FetchResult> => {
    const cfg = JSON.parse(src.config_json)
    const match = cfg.fetch.email?.match || { from: src.locator }
    return withImap(async c => {
      const folder = cfg.fetch.email?.folder || await searchFolder(c)
      const lock = await c.getMailboxLock(folder)
      try {
        const uidValidity = Number((c.mailbox as any)?.uidValidity || 0)
        const sameBox = cursor && Number(cursor.uidValidity) === uidValidity
        const since = new Date(sameBox && cursor.lastDate ? cursor.lastDate - DAY : Date.now() - (cfg.fetch.historyWindowDays || 30) * DAY)
        const uids = ((await c.search({ from: match.from, since }, { uid: true })) || []).filter(u => !sameBox || u > (cursor.lastUid || 0)).slice(-(cfg.fetch.maxItemsPerSync || 50))
        const items: Item[] = []
        let errors = 0, lastUid = sameBox ? cursor.lastUid || 0 : 0, lastDate = sameBox ? cursor.lastDate || 0 : 0
        for (const uid of uids) {
          try {
            const msg = await c.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true })
            if (!msg || !msg.source) continue
            const it = await messageItem(msg.source as Buffer, uid)
            if (it) items.push(it)
            lastUid = Math.max(lastUid, uid)
            lastDate = Math.max(lastDate, (msg.internalDate as Date | undefined)?.getTime?.() || 0)
          } catch (e) { errors++; log.warn('email', 'message failed', { uid, err: String((e as Error).message) }) }
        }
        return { items, cursor: { lastUid, uidValidity, lastDate: lastDate || Date.now() }, stats: { seen: uids.length, new: items.length }, errors }
      } finally { lock.release() }
    })
  })
}
