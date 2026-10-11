// The Ledger fixture (auth source) helpers: drive the app-owned sign-in window like a user.
import type { Page } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, until, type RW } from './app'

export const USERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/server/ledger-users.json'), 'utf8'))
export const reader = USERS.find((u: any) => u.email === 'reader@ledger.test')
export const F_LEDGER_2 = 'Meridian Mutual now pays Brightdesk $0.90 per resolved conversation.'

export async function signInLedger(rw: RW, sourceId: string, user = reader): Promise<void> {
  await rw.invoke('source.signIn', { id: sourceId })
  const login: Page = await until(async () => rw.app.windows().find(p => /ledger\.test:4700\/login/.test(p.url())) || null, 30_000)
  await login.fill('input[name=email]', user.email)
  await login.fill('input[name=password]', user.password)
  await login.click('button[type=submit]')
}

