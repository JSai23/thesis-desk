// Raw fetched artifacts on disk: content/<document_id>/v<N>.raw.<ext> (RFC §1B.5, B-DATA-002).
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './env'

export const contentDir = (docId: string) => path.join(DATA_DIR, 'content', docId)

export function writeRaw(docId: string, version: number, ext: string, body: Buffer | string): string {
  const dir = contentDir(docId)
  fs.mkdirSync(dir, { recursive: true })
  const rel = path.join('content', docId, `v${version}.raw.${ext}`)
  fs.writeFileSync(path.join(DATA_DIR, rel), body)
  return rel
}

export function removeContent(docId: string): void { fs.rmSync(contentDir(docId), { recursive: true, force: true }) }

export function dirSize(dir: string): number {
  let n = 0
  if (!fs.existsSync(dir)) return 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size
  }
  return n
}

/** Per-recipient tokens in emails (unsubscribe/tracking JWTs) are credentials for the user's subscriptions; never store them. */
export const redactTokens = (s: string): string => s.replace(/eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+){0,2}/g, '[token removed]')
