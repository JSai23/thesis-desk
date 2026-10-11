// Deterministic grounding check (RFC §1B.9.8, B-AGENT-007, DEC-040): every number and name in `text` must be
// supported by the verbatim `supports` (quotes or source text). No model involved.
import { all } from '../db'

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec']
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 }
const PRODUCT = 'research workspace'

const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()

/** Numeric tokens normalized to canonical values: currency → USD units, percentages → fractions, others as-is. */
export function numbers(text: string): number[] {
  const t = norm(text)
  const out: number[] = []
  const re = /(\$|usd\s*|€|£)?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s?(%|percent\b|per cent\b)|\s?(k|thousand|mm|mn|m|million|bn|b|billion|tn|t|trillion)\b)?(st|nd|rd|th)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const raw = m[2].replace(/,/g, '')
    let v = Number(raw)
    if (!Number.isFinite(v)) continue
    const before = t.slice(Math.max(0, m.index - 12), m.index).toLowerCase()
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 1)
    // years and dates are exempt
    if (!m[1] && !m[3] && !m[4] && /^\d{4}$/.test(raw) && v >= 1900 && v <= 2100) continue
    if (!m[1] && !m[3] && !m[4] && v <= 31 && MONTHS.some(mo => new RegExp(`\\b${mo}\\.?\\s*$`).test(before))) continue
    if (/[A-Za-z]/.test(after) && !m[3] && !m[4] && !m[5]) continue // part of a word/identifier like "50x", "4o"
    if (m[3]) v = v / 100
    else if (m[4]) v = v * SCALE[m[4].toLowerCase()]
    out.push(Math.round(v * 1e6) / 1e6)
  }
  return out
}

const sameNum = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 1e-6)

let entityCache: { at: number; names: string[] } = { at: 0, names: [] }
function libraryNames(): string[] {
  if (Date.now() - entityCache.at < 5000) return entityCache.names
  const names = [
    ...all<{ name: string }>('SELECT name FROM companies WHERE merged_into_id IS NULL AND deleted_at IS NULL'),
    ...all<{ name: string }>('SELECT name FROM firms WHERE merged_into_id IS NULL AND deleted_at IS NULL'),
    ...all<{ name: string }>('SELECT name FROM people WHERE merged_into_id IS NULL AND deleted_at IS NULL'),
    ...all<{ name: string }>('SELECT alias AS name FROM aliases')
  ].map(r => r.name).filter(n => n && n.length >= 3)
  entityCache = { at: Date.now(), names: [...new Set(names)] }
  return entityCache.names
}
export function invalidateNameCache(): void { entityCache.at = 0 }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function containsTokens(hay: string, needle: string): boolean {
  const n = norm(needle).toLowerCase().replace(/[.,;:!?]+$/, '')
  if (!n) return true
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}([^\\p{L}\\p{N}]|$)`, 'iu').test(norm(hay).toLowerCase())
}

/** Capitalized multi-word sequences that do not start a sentence. */
function capitalizedSequences(text: string): string[] {
  const t = norm(text)
  const out: string[] = []
  const re = /([A-Z][\p{L}\p{N}'&.-]*)(\s+(?:of|and|&|de|du|van|von)?\s*[A-Z][\p{L}\p{N}'&.-]*)+/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    let seq = m[0]
    const pre = t.slice(0, m.index).trimEnd()
    const atStart = !pre || /[.!?:;"(\[]$/.test(pre)
    if (atStart) {
      const words = seq.split(/\s+/)
      words.shift()
      seq = words.join(' ')
      if (!/^[A-Z]/.test(seq) || seq.split(/\s+/).length < 2) continue
    }
    out.push(seq.replace(/[.,]+$/, ''))
  }
  return out
}

/** Specific calendar days in text, as "month-day" keys: "September 27", "Sept. 27th", "27 September", "2026-09-27". */
export function dayDates(text: string): string[] {
  const t = norm(text).toLowerCase()
  const mi = (w: string) => { const i = MONTHS.indexOf(w.replace(/\.$/, '')); return i < 0 ? -1 : i < 12 ? i : [0, 1, 2, 3, 5, 6, 7, 8, 8, 9, 10, 11][i - 12] }
  const out: string[] = []
  const mo = MONTHS.join('|')
  for (const m of t.matchAll(new RegExp(`\\b(${mo})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?:%|percent|million|billion|[kmb]\\b))`, 'g'))) if (+m[2] >= 1 && +m[2] <= 31) out.push(`${mi(m[1])}-${+m[2]}`)
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${mo})\\b`, 'g'))) if (+m[1] >= 1 && +m[1] <= 31) out.push(`${mi(m[2])}-${+m[1]}`)
  for (const m of t.matchAll(/\b(?:19|20)\d\d-(\d\d)-(\d\d)\b/g)) out.push(`${+m[1] - 1}-${+m[2]}`)
  return [...new Set(out)]
}

/** strictDates: a specific day ("hired on September 27") must appear in the cited text — for prose the user reads
 *  (Ask, reports, summaries). Extraction leaves it off: "today" in an article legitimately becomes an event date.
 *  (BK-Q4 in run #14: an answer gave a publish date as the hire date — MEM-054.) */
export interface GroundingCtx { allowedNames?: string[]; extraText?: string; strictDates?: boolean }

const ROLE_RE = /\b(?:CEO|CFO|CTO|COO|CPO|co-?founders?|founders?|chief (?:executive|financial|technology|operating|product) officer|chairman|chairwoman|chairperson|managing partner|general partner)\b/gi
const ROLE_FORMS: string[][] = [['ceo', 'chief executive'], ['cfo', 'chief financial'], ['cto', 'chief technology'], ['coo', 'chief operating'], ['cpo', 'chief product'],
  ['founder', 'co-founder', 'cofounder', 'founded'], ['chairman', 'chairwoman', 'chairperson', 'chair'], ['managing partner'], ['general partner']]

export function groundingCheck(text: string, supports: string[], ctx: GroundingCtx = {}): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  const sup = supports.join('\n')
  const supNums = numbers(sup)
  for (const n of numbers(text)) if (!supNums.some(s => sameNum(s, n))) problems.push(`number ${n} is not in the cited text`)
  if (ctx.strictDates) { const supDays = dayDates(sup); for (const d of dayDates(text)) if (!supDays.includes(d)) problems.push(`date ${d} is not in the cited text`) }
  const allowed = [...(ctx.allowedNames || []), PRODUCT, ...MONTHS, ...DAYS].map(a => a.toLowerCase())
  const isAllowed = (name: string) => {
    const l = norm(name).toLowerCase()
    return allowed.some(a => a === l || containsTokens(a, l)) || (ctx.extraText ? containsTokens(ctx.extraText, name) : false)
  }
  // a role is a claim too: "its CEO said" over a quote that only names the person is unsupported (RD-STORY-06,
  // acc-2026-10-08T07-44-19) — each role in the sentence must be in the cited text (CEO ≈ chief executive)
  const supL = sup.toLowerCase()
  for (const m of text.matchAll(ROLE_RE)) {
    const role = m[0].toLowerCase().replace(/\s+/g, ' ').replace(/co-?founder/, 'founder')
    const forms = ROLE_FORMS.find(f => f.some(x => x === role || role.startsWith(x))) || [role]
    if (!forms.some(f => supL.includes(f))) problems.push(`role “${m[0]}” is not in the cited text`)
  }
  const t = norm(text)
  const seen = new Set<string>()
  for (const name of libraryNames()) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(name)})(?=[^\\p{L}\\p{N}]|$)`, 'giu')
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) {
      const span = m[2]
      if (!/^\p{Lu}/u.test(span)) continue // common-word names count only when capitalized
      const key = span.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (!containsTokens(sup, span) && !isAllowed(span)) problems.push(`name “${span}” is not in the cited text`)
    }
  }
  for (const seq of capitalizedSequences(text)) {
    const key = seq.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (!containsTokens(sup, seq) && !isAllowed(seq)) problems.push(`name “${seq}” is not in the cited text`)
  }
  return { ok: problems.length === 0, problems }
}

/** Split prose into sentences: a terminator followed by whitespace and an uppercase letter/quote/digit ends one,
 * except after common abbreviations and initials. Decimals ("$0.90") never split. */
export function sentences(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim()
  const out: string[] = []
  let start = 0
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch !== '.' && ch !== '!' && ch !== '?') continue
    let j = i
    while (j + 1 < t.length && /[.!?"”’)]/.test(t[j + 1])) j++
    if (j + 1 < t.length && t[j + 1] !== ' ') { i = j; continue }
    const next = t[j + 2] || ''
    if (j + 1 < t.length && !/[A-Z“"(\d‘']/.test(next)) { i = j; continue }
    const word = t.slice(start, i).split(' ').pop() || ''
    if (ch === '.' && /^(Inc|Ltd|Co|Corp|Mr|Ms|Mrs|Dr|St|vs|Jr|Sr|U\.S)$/.test(word)) { i = j; continue }
    out.push(t.slice(start, j + 1).trim())
    start = j + 1
    i = j
  }
  const rest = t.slice(start).trim()
  if (rest) out.push(rest)
  return out.filter(Boolean)
}

/** Keep only sentences that pass the grounding check against `supports`. */
export function groundProse(text: string, supports: string[], ctx: GroundingCtx = {}): { text: string; dropped: number } {
  const ss = sentences(text)
  const kept = ss.filter(s => groundingCheck(s, supports, ctx).ok)
  return { text: kept.join(' '), dropped: ss.length - kept.length }
}
