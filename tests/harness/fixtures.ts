// Fixture server control (RFC Appendix A control API). The harness starts the server if it isn't running.
import { spawn } from 'node:child_process'
import path from 'node:path'
import http from 'node:http'

const ROOT = path.resolve(__dirname, '../..')
/** Pages and URLs always say :4700; a parallel worker's own server listens on FIXTURE_PORT, and the app maps *.test
 *  there (RW_FIXTURE_PORT). A lane sets RW_FIXTURE_PORT_BASE; worker n of that lane uses base + n. Unset → 4700. */
const PUBLIC_PORT = 4700
export const FIXTURE_PORT = process.env.RW_FIXTURE_PORT_BASE ? Number(process.env.RW_FIXTURE_PORT_BASE) + Number(process.env.TEST_PARALLEL_INDEX || 0) : PUBLIC_PORT
const PORT = FIXTURE_PORT

function request(method: string, p: string, body?: unknown, host = 'control.test'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: { Host: `${host}:${PUBLIC_PORT}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      let b = ''
      res.on('data', c => (b += c))
      res.on('end', () => resolve({ status: res.statusCode || 0, body: b }))
    })
    req.on('error', reject)
    req.setTimeout(5000, () => req.destroy(new Error('timeout')))
    if (data) req.write(data)
    req.end()
  })
}

let started = false
export async function ensureFixtures(): Promise<void> {
  try { await request('GET', '/__control/state'); return } catch { /* start it */ }
  if (!started) {
    const child = spawn(process.execPath, [path.join(ROOT, 'fixtures/server/server.mjs')], { detached: true, stdio: 'ignore', cwd: ROOT, env: { ...process.env, FIXTURE_LISTEN_PORT: String(PORT) } })
    child.unref()
    started = true
  }
  for (let i = 0; i < 50; i++) {
    try { await request('GET', '/__control/state'); return } catch { await new Promise(r => setTimeout(r, 100)) }
  }
  throw new Error(`fixture server did not start on 127.0.0.1:${PORT}`)
}

const ctl = async (method: string, p: string, body?: unknown, host?: string) => { await ensureFixtures(); return request(method, p, body, host) }

export const fixtures = {
  reset: () => ctl('POST', '/__control/reset', {}),
  epoch: (n: number) => ctl('POST', '/__control/epoch', { n }),
  fail: (route: string, status: number | 'off') => ctl('POST', '/__control/fail', { route, status }),
  expireLedger: () => ctl('POST', '/__control/ledger/expire-sessions', {}),
  xChallenge: (on: boolean) => ctl('POST', '/__control/x/challenge', { on }),
  xState: async () => JSON.parse((await ctl('GET', '/__control/x/state')).body),
  state: async () => JSON.parse((await ctl('GET', '/__control/state')).body),
  get: (host: string, p: string) => ctl('GET', p, undefined, host)
}
