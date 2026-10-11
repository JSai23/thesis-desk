// Secret values seen by the harness during a run (bridge cookies/localStorage, sign-in cookies). Kept outside
// tests/results so E2E-SEC-01 can grep results, logs and data dirs for them without matching this record itself.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SECRETS_FILE = path.join(os.tmpdir(), 'rw-e2e-secret-values.json')
export function recordSecret(v: string): void {
  if (!v || v.length < 12) return
  const cur: string[] = fs.existsSync(SECRETS_FILE) ? JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')) : []
  if (!cur.includes(v)) cur.push(v)
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(cur), { mode: 0o600 })
}
export const recordedSecrets = (): string[] => (fs.existsSync(SECRETS_FILE) ? JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')) : [])
