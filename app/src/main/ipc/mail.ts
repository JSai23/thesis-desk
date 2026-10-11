// Handlers: Settings ▸ Accounts ▸ Gmail.
import { handle } from './registry'
import * as mail from '../mail'

export function registerMailHandlers(): void {
  handle('email.configure', ({ user, appPassword, recipient }) => mail.configure(user, appPassword, recipient))
  handle('email.test', () => mail.test())
  handle('email.remove', () => { mail.remove(); return { ok: true } })
}
