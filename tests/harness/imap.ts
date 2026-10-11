// Test-only Gmail fixture tool (PH-06): APPEND .eml files into label RW-Fixtures and clean up exactly the UIDs it
// appended (moved to [Gmail]/Trash by UID — never delete, never by search). Credentials come from prereq/.env.local.
import { ImapFlow } from 'imapflow'
import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { envLocal } from './app'

const LABEL = 'RW-Fixtures'
const appended: number[] = []
// Every appended UID is also written to a ledger outside the repo (git clean keeps it), so a run that was killed before
// its cleanup is cleaned by the next one — still strictly by the UIDs the harness appended, never by search.
const LEDGER = path.join(os.tmpdir(), 'rw-imap-appended.json')
type Ledger = { uidValidity: string; uids: number[] }
const readLedger = (): Ledger | null => { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch { return null } }
const writeLedger = (l: Ledger | null) => { try { if (l && l.uids.length) fs.writeFileSync(LEDGER, JSON.stringify(l)); else fs.rmSync(LEDGER, { force: true }) } catch { /* best effort */ } }

async function client(): Promise<ImapFlow> {
  const e = envLocal()
  // bounded: a stalled Gmail connection (throttling with several test lanes) must fail and be retried, not hang a test
  const c = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: e.RW_EMAIL_USER, pass: (e.RW_EMAIL_PASS || '').replace(/\s+/g, '') }, logger: false,
    connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 120_000 } as any)
  await c.connect()
  return c
}

/** Append an .eml; `messageId` replaces the Message-ID header (pass the same id twice to re-append the same message). */
export async function imapAppend(emlPath: string, o: { messageId?: string; fromTag?: string } = {}): Promise<{ uid: number; messageId: string }> {
  let raw = fs.readFileSync(emlPath, 'utf8')
  // a per-run sender (dealmemo+<tag>@…) keeps this run's message apart from fixture mail an older run left in the label
  if (o.fromTag) raw = raw.replace(/^(From:.*?<?)([^@<\s]+)@/im, `$1$2+${o.fromTag}@`)
  const messageId = o.messageId || `<rw-${crypto.randomBytes(6).toString('hex')}@fixtures.research-workspace.test>`
  raw = /^Message-ID:/im.test(raw) ? raw.replace(/^Message-ID:.*$/im, `Message-ID: ${messageId}`) : `Message-ID: ${messageId}\r\n` + raw
  const c = await client()
  try {
    const boxes = await c.list()
    if (!boxes.some(b => b.path === LABEL)) await c.mailboxCreate(LABEL)
    const r = await c.append(LABEL, raw, ['\\Seen'], new Date())
    const uid = Number((r as any).uid)
    appended.push(uid)
    const uidValidity = String((r as any).uidValidity ?? '')
    const l = readLedger()
    writeLedger({ uidValidity, uids: [...new Set([...(l && l.uidValidity === uidValidity ? l.uids : []), uid])] })
    return { uid, messageId }
  } finally { await c.logout() }
}

export async function imapCleanup(): Promise<void> {
  if (!appended.length) return
  const c = await client()
  try {
    const trash = (await c.list()).find(b => b.specialUse === '\\Trash')?.path || '[Gmail]/Trash'
    const lock = await c.getMailboxLock(LABEL)
    try { await c.messageMove(appended.join(','), trash, { uid: true }) } finally { lock.release() }
    const l = readLedger()
    if (l) writeLedger({ ...l, uids: l.uids.filter(u => !appended.includes(u)) })
    appended.length = 0
  } finally { await c.logout() }
}

/** Move what an earlier, killed run appended and never cleaned up — only UIDs from the ledger, only if the label's
 *  UIDVALIDITY still matches (otherwise the numbers could point at other messages, so nothing is touched). */
export async function imapCleanupLeftovers(): Promise<number> {
  const l = readLedger()
  if (!l || !l.uids.length) return 0
  const c = await client()
  try {
    if (!(await c.list()).some(b => b.path === LABEL)) { writeLedger(null); return 0 }
    const lock = await c.getMailboxLock(LABEL)
    try {
      const v = String((c.mailbox as any)?.uidValidity ?? '')
      if (v !== l.uidValidity) { writeLedger(null); return 0 }
      const present = await c.search({ uid: l.uids.join(',') }, { uid: true })
      const trash = (await c.list()).find(b => b.specialUse === '\\Trash')?.path || '[Gmail]/Trash'
      if (Array.isArray(present) && present.length) await c.messageMove(present.join(','), trash, { uid: true })
      writeLedger(null)
      return Array.isArray(present) ? present.length : 0
    } finally { lock.release() }
  } finally { await c.logout() }
}

/** Read-only: does a message whose subject contains `text` exist in All Mail since `since`? (never acts on results) */
async function hasSubject(text: string, since: Date): Promise<boolean> {
  const c = await client()
  try {
    const all = (await c.list()).find(b => b.specialUse === '\\All')?.path || '[Gmail]/All Mail'
    const lock = await c.getMailboxLock(all)
    try {
      // Gmail's SUBJECT search tokenizes punctuation (e.g. "&"), so search the fixed prefix and compare envelopes.
      const uids = await c.search({ subject: 'Research Workspace', since: new Date(since.getTime() - 86400_000) }, { uid: true })
      if (!Array.isArray(uids) || !uids.length) return false
      for await (const m of c.fetch(uids.slice(-50).join(','), { envelope: true, internalDate: true }, { uid: true }))
        if ((m.envelope?.subject || '').includes(text) && new Date(m.internalDate as any).getTime() >= since.getTime() - 60_000) return true
      return false
    } finally { lock.release() }
  } finally { await c.logout() }
}

export interface FoundMessage { uid: number; subject: string; date: Date; from: string; to: string; html: string; text: string }

/**
 * Read-only: messages in All Mail whose subject contains `text`, received since `since` (newest first). Gmail's
 * SUBJECT search tokenizes punctuation, so the server-side search uses one plain word (`word`) plus SINCE, and the
 * full subject is compared client-side. Bodies are parsed with mailparser. Never moves, flags or deletes anything.
 */
async function findMessages(text: string, since: Date, word = 'Research Workspace', max = 20): Promise<FoundMessage[]> {
  const { simpleParser } = await import('mailparser')
  const c = await client()
  try {
    const all = (await c.list()).find(b => b.specialUse === '\\All')?.path || '[Gmail]/All Mail'
    const lock = await c.getMailboxLock(all, { readOnly: true })
    try {
      const uids = await c.search({ subject: word, since: new Date(since.getTime() - 86400_000) }, { uid: true })
      if (!Array.isArray(uids) || !uids.length) return []
      const hits: number[] = []
      for await (const m of c.fetch(uids.slice(-100).join(','), { envelope: true, internalDate: true }, { uid: true }))
        if ((m.envelope?.subject || '').includes(text) && new Date(m.internalDate as any).getTime() >= since.getTime() - 60_000) hits.push(m.uid)
      const out: FoundMessage[] = []
      for (const uid of hits.slice(-max)) {
        const m: any = await c.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true })
        if (!m?.source) continue
        const p: any = await simpleParser(m.source)
        out.push({ uid, subject: p.subject || '', date: new Date(m.internalDate), from: p.from?.text || '', to: p.to?.text || '', html: typeof p.html === 'string' ? p.html : '', text: p.text || '' })
      }
      return out.sort((a, b) => b.date.getTime() - a.date.getTime())
    } finally { lock.release() }
  } finally { await c.logout() }
}

/** A read that hangs (stalled connection) counts as "not found yet" after 90 s, so the caller's wait loop retries. */
const bounded = <T>(p: Promise<T>, fallback: T): Promise<T> => Promise.race([p, new Promise<T>(r => setTimeout(() => r(fallback), 90_000))])
export const imapHasSubject = (text: string, since: Date): Promise<boolean> => bounded(hasSubject(text, since).catch(e => { console.warn('imap read failed:', String(e?.message || e)); return false }), false)
export const imapFindMessages = (text: string, since: Date, word = 'Research Workspace', max = 20): Promise<FoundMessage[]> => bounded(findMessages(text, since, word, max).catch(e => { console.warn('imap read failed:', String(e?.message || e)); return [] as FoundMessage[] }), [])
