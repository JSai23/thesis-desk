// Verbatim quote location (RFC §1B.9 step 10, B-INGEST-005): whitespace-normalized exact substring search that maps
// back to offsets in the original text. Curly/straight quote marks are treated as equal; the stored quote is always
// the original substring, so it is verbatim by construction.
const canon = (ch: string) => (ch === '’' || ch === '‘' ? "'" : ch === '“' || ch === '”' ? '"' : ch === '–' || ch === '—' ? '-' : ch)

function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let inWs = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      if (!inWs && norm.length) { norm += ' '; map.push(i) }
      inWs = true
      continue
    }
    inWs = false
    norm += canon(ch)
    map.push(i)
  }
  return { norm, map }
}

export function locateQuote(text: string, quote: string, from = 0): { start: number; end: number } | null {
  const q = normalizeWithMap(quote.trim().replace(/^["“”']+|["“”']+$/g, '').replace(/\s*(\.\.\.|…)\s*$/, '')).norm.trim()
  if (q.length < 4) return null
  const { norm, map } = normalizeWithMap(text)
  const fromN = map.findIndex(i => i >= from)
  const idx = norm.indexOf(q, Math.max(0, fromN))
  if (idx < 0) return null
  const start = map[idx]
  const end = map[idx + q.length - 1] + 1
  return { start, end }
}

/** First sentence of `text` that contains `needle` (case-insensitive), with offsets. */
export function sentenceContaining(text: string, needle: string): { start: number; end: number } | null {
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return null
  let s = i
  while (s > 0 && !/[.!?\n]/.test(text[s - 1])) s--
  while (s < i && /\s/.test(text[s])) s++
  let e = i + needle.length
  while (e < text.length && !/[.!?\n]/.test(text[e])) e++
  if (e < text.length && /[.!?]/.test(text[e])) e++
  return { start: s, end: e }
}
