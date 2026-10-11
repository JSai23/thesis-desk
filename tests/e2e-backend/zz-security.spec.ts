// E2E-SEC-01 (RFC §3A): runs last in the suite. Greps every data dir created by this run (except secrets.bin), their
// logs and tests/results for live secret values: Codex access/refresh tokens, the Gmail app password (the Gmail
// account uses an app password, not OAuth tokens — DEC-075), ledger fixture passwords, every cookie/localStorage
// value the harness saw the bridge and sign-in windows use, and any JWT-shaped string.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ROOT, envLocal } from '../harness/app'
import { USERS } from '../harness/ledger'
import { recordedSecrets } from '../harness/secrets'

const SINCE = Number(process.env.RW_RUN_STARTED) || Date.now() - 12 * 3600_000 // data dirs and results of this run only

function files(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out } // removed meanwhile by a running app
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) files(p, out)
    else if (e.name !== 'secrets.bin') out.push(p)
  }
  return out
}

test('E2E-SEC-01 secret hygiene', async () => {
  const codex = JSON.parse(fs.readFileSync(path.join(process.env.RW_CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'), 'utf8'))
  const env = envLocal()
  const needles = [codex.tokens?.access_token, codex.tokens?.refresh_token, codex.tokens?.id_token, (env.RW_EMAIL_PASS || '').replace(/\s+/g, ''), env.RW_EMAIL_PASS,
    ...USERS.map((u: any) => u.password), ...recordedSecrets()].filter((x: any) => typeof x === 'string' && x.length >= 8)
  const dataDirs = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('rw-test-')).map(n => path.join(os.tmpdir(), n))
    .filter(d => { try { return fs.statSync(d).mtimeMs >= SINCE } catch { return false } })
  const targets = [...dataDirs.flatMap(d => files(d)), ...files(path.join(ROOT, 'tests/results')).filter(f => { try { return fs.statSync(f).mtimeMs >= SINCE } catch { return false } })]
  expect(targets.length).toBeGreaterThan(0)
  // a real JWT: three base64url parts whose header decodes to JSON with "alg" (the Codex tokens' shape) — not any
  // base64 JSON (real articles carry e.g. eyJldmVudCI6InBhZ2VfdmlldyJ9 = {"event":"page_view"})
  const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
  const jwt = { test: (t: string) => [...t.matchAll(JWT)].some(m => { try { return /"alg"/.test(Buffer.from(m[0].split('.')[0], 'base64url').toString('utf8')) } catch { return false } }) }
  const hits: string[] = []
  for (const f of targets) {
    // the real-data lane's apps run in parallel in the same temp folder: their caches change under the scan, so a file
    // that vanished between listing and reading is skipped (run #16 — ENOENT on a Chromium cache entry)
    let buf: Buffer
    try { buf = fs.readFileSync(f) } catch (e: any) { if (e.code === 'ENOENT') continue; throw e }
    for (const n of needles) if (buf.includes(n)) hits.push(`${f}: secret ${n.slice(0, 3)}…`)
    // the JWT-shape heuristic is for files the app writes itself (logs, database, settings, results); a saved page's raw
    // HTML and Chromium's caches are third-party content verbatim — real sites embed eyJ… strings (the exact-secret check
    // above still covers every file)
    const thirdParty = /[\\/]content[\\/][^\\/]+[\\/]v\d+\.raw\.[a-z]+$|[\\/]electron[\\/]/.test(f)
    if (!thirdParty && jwt.test(buf.toString('latin1'))) hits.push(`${f}: JWT-shaped string`)
  }
  expect(hits).toEqual([])
})
