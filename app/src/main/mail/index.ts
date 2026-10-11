// Gmail over IMAP/SMTP with an app password (RFC §1B.8.2 email, §1B.19, DEC-075). The password lives only in
// safeStorage (secrets.bin); settings hold the address and recipient.
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { secrets } from '../secrets'
import { getSetting, setSetting } from '../settings'
import { AppError } from '../errors'
import { emit } from '../events'
import { log } from '../log'

export interface Account { user: string; recipient: string }
export const account = (): Account | null => { const a = getSetting<Account | null>('email.account'); return a?.user ? a : null }
const password = () => secrets.get('email.password')

export function imapClient(user: string, pass: string): ImapFlow {
  return new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass: pass.replace(/\s+/g, '') }, logger: false, socketTimeout: 60_000, connectionTimeout: 20_000, greetingTimeout: 20_000 })
}

/** Run fn with a connected IMAP client for the configured account. */
export async function withImap<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const a = account(); const p = password()
  if (!a || !p) throw new AppError('AUTH_REQUIRED', 'Connect Gmail in Settings ▸ Accounts first.')
  const c = imapClient(a.user, p)
  try { await c.connect() } catch (e) {
    const auth = /auth|credential|invalid/i.test(String((e as any)?.responseText || (e as Error).message))
    if (auth) { setSetting('email.auth_failed', true); emit('banner.updated', {}) }
    throw new AppError(auth ? 'AUTH_EXPIRED' : 'FETCH_FAILED', auth ? 'Gmail rejected the app password. Create a new one in Settings ▸ Accounts.' : 'Couldn’t reach Gmail.')
  }
  if (getSetting('email.auth_failed')) { setSetting('email.auth_failed', false); emit('banner.updated', {}) }
  try { return await fn(c) } finally { try { await c.logout() } catch { /* closed */ } }
}

/** "[Gmail]/All Mail" (every label, no spam/trash) when present, else INBOX. */
export async function searchFolder(c: ImapFlow): Promise<string> {
  const boxes = await c.list()
  return boxes.find(b => b.specialUse === '\\All')?.path || 'INBOX'
}

/** Gmail that doesn't answer fails in seconds, not minutes: Settings never hangs on "Connecting…" (nodemailer's defaults
 *  allow 2 min to connect and 10 min of socket silence; a test waited past 120 s, iteration 2). */
const SMTP_TIMEOUTS = { connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 60_000 }
/** A step that must finish within `ms`, or fail with `what`. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out`)), ms) })]).finally(() => clearTimeout(t))
}

async function smtpVerify(user: string, pass: string): Promise<void> {
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass: pass.replace(/\s+/g, '') }, ...SMTP_TIMEOUTS })
  await t.verify()
}

export async function configure(user: string, appPassword: string, recipient?: string): Promise<{ ok: boolean; message: string }> {
  const c = imapClient(user, appPassword)
  try { await within((async () => { await c.connect(); await c.list(); await c.logout() })(), 45_000, 'IMAP login') } catch (e) {
    try { c.close() } catch { /* already closed */ }
    log.warn('mail', 'IMAP login failed during configure', { timedOut: /timed out/.test(String((e as Error)?.message)) })
    return { ok: false, message: 'Email login failed. Check the address and the 16-character app password.' }
  }
  try { await within(smtpVerify(user, appPassword), 45_000, 'SMTP check') } catch { return { ok: false, message: 'Email login worked for reading but sending failed. Check SMTP access for this account.' } }
  secrets.set('email.password', appPassword.replace(/\s+/g, ''))
  setSetting('email.account', { user, recipient: recipient || user })
  setSetting('email.auth_failed', false)
  emit('settings.updated', { keys: ['email.account'] })
  emit('banner.updated', {})
  return { ok: true, message: 'Connected' }
}

export async function test(): Promise<{ ok: boolean; message: string }> {
  const a = account(); const p = password()
  if (!a || !p) return { ok: false, message: 'Gmail isn’t connected.' }
  try {
    const n = await withImap(async c => (await c.list()).length)
    await smtpVerify(a.user, p)
    return { ok: true, message: `Gmail works · ${n} labels · sending verified` }
  } catch (e) { return { ok: false, message: (e as Error).message || 'Email login failed' } }
}

export function remove(): void {
  secrets.delete('email.password')
  setSetting('email.account', null)
  setSetting('email.auth_failed', false)
  emit('settings.updated', { keys: ['email.account'] })
}

/** Send one email from the account to its recipient (reports, alerts, exports). */
export async function send(o: { subject: string; text: string; html?: string; to?: string }): Promise<{ messageId: string }> {
  const a = account(); const p = password()
  if (!a || !p) throw new AppError('AUTH_REQUIRED', 'Email not set up')
  if (getSetting('notify.email') === false) throw new AppError('VALIDATION', 'Email is turned off in Settings ▸ Notifications')
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: a.user, pass: p }, ...SMTP_TIMEOUTS })
  try {
    const r = await t.sendMail({ from: `Research Workspace <${a.user}>`, to: o.to || a.recipient || a.user, subject: o.subject, text: o.text, html: o.html })
    return { messageId: r.messageId }
  } catch (e) {
    const auth = /auth|535|534|credential/i.test(String((e as any)?.response || (e as Error).message))
    if (auth) { setSetting('email.auth_failed', true); emit('banner.updated', {}) }
    throw new AppError(auth ? 'AUTH_EXPIRED' : 'FETCH_FAILED', auth ? 'Gmail rejected the app password. Create a new one in Settings ▸ Accounts.' : 'Couldn’t send email: ' + ((e as Error).message || ''))
  }
}
