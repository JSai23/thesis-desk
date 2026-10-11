// Content hashing and near-duplicate detection (RFC §1B.9 step 4c/4d, B-INGEST-002/003).
import crypto from 'node:crypto'
import { all } from '../db'

export const normText = (s: string) => s.replace(/\s+/g, ' ').trim()
export const contentHash = (text: string) => crypto.createHash('sha256').update(normText(text)).digest('hex')

const tokens = (s: string) => normText(s).toLowerCase().split(/[^a-z0-9$%.]+/).filter(Boolean)

export function shingles(text: string): Set<string> {
  const w = normText(text.slice(0, 5000)).toLowerCase().split(' ')
  const out = new Set<string>()
  for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(' '))
  return out
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

function titleOverlap(a: string, b: string): number {
  const ta = new Set(tokens(a)), tb = new Set(tokens(b))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const x of ta) if (tb.has(x)) inter++
  return inter / Math.min(ta.size, tb.size)
}

/** Find a live, non-duplicate document that is a near-duplicate of the given text (Jaccard ≥ 0.80). */
export function findNearDuplicate(title: string, text: string, when: number, excludeId?: string): { id: string; score: number } | null {
  const window = 14 * 86400_000
  const cands = all<{ id: string; title: string; text: string }>(
    `SELECT id, title, text FROM documents WHERE deleted_at IS NULL AND status NOT IN ('duplicate','pending_capture')
       AND COALESCE(published_at, first_fetched_at) BETWEEN ? AND ? ORDER BY first_fetched_at DESC LIMIT 400`, when - window, when + window)
  const first = normText(text).slice(0, 200)
  let sh: Set<string> | null = null
  let best: { id: string; score: number } | null = null
  for (const c of cands) {
    if (c.id === excludeId) continue
    if (titleOverlap(title, c.title) < 0.6 && normText(c.text).slice(0, 200) !== first) continue
    sh = sh || shingles(text)
    const j = jaccard(sh, shingles(c.text))
    if (j >= 0.8 && (!best || j > best.score)) best = { id: c.id, score: j }
  }
  return best
}
