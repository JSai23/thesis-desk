// Deterministic backstop for evidence event dates (report windows count when facts happened — DEC-093). When the
// verbatim quote says when it happened — "in March", "in July 2025" — the event month comes from the quote, also when
// the model gave another date (it tends to give the publish date). Without a year it is the latest such month not
// after the publish month; a later month without a year is ambiguous (a plan, or last year) and is left alone.
// Run #15: "Saronic secured $1.75 billion in Series D funding in March", published Oct 2, sat in a 30-day story.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "YYYY-MM" from a single "in <Month>[ <year>]" in the quote, else null. */
export function eventMonthFromQuote(quote: string, publishedAt: number | null): string | null {
  const found = new Set<string>()
  const re = /\bin\s+(?:early\s+|mid[- ]|late\s+)?(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sept?\.?|Oct\.?|Nov\.?|Dec\.?)(?:\s+(?:of\s+)?((?:19|20)\d\d))?\b/g
  const pub = publishedAt ? new Date(publishedAt) : null
  for (const m of quote.matchAll(re)) {
    const w = m[1].toLowerCase().replace(/\.$/, '').replace(/^sept$/, 'sep')
    const mi = MONTHS.indexOf(w) >= 0 ? MONTHS.indexOf(w) : SHORT.indexOf(w)
    if (mi < 0) continue
    let year = m[2] ? Number(m[2]) : null
    if (year == null) {
      if (!pub) continue
      if (mi > pub.getUTCMonth()) continue // later than the publish month with no year: a plan, or last year
      year = pub.getUTCFullYear()
    }
    found.add(`${year}-${String(mi + 1).padStart(2, '0')}`)
  }
  return found.size === 1 ? [...found][0] : null
}

/** The evidence's event date: the model's, unless the quote names a different month — then the quote's month. */
export function eventDateOf(model: string | null, quote: string, publishedAt: number | null): string | null {
  if (model && !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(model.trim())) model = null // "July" is not a date the windows can read
  const q = eventMonthFromQuote(quote, publishedAt)
  return q && !(model || '').startsWith(q) ? q : model
}
