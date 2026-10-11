// When a second name is the same entity (MEM-060). A source may add an alias only if it is shaped like the same name —
// a legal-form variant ("Lumen Legal, Inc."), initials ("BVP", "NEA"), a numeronym ("a16z"), a possessive, or for a
// person the same first and last name ("Hamad Obaid Al Mansoori") — or the text ties the two names together ("X,
// formerly Y", "Y, now X", "Y rebranded as X", "X, also known as Y", "X (Y)"). Names that merely appear near the
// entity — partners, chips, tickers, products, customers — never qualify: hydration once stored AMD and NVIDIA as
// Makora's aliases, and every NVIDIA article became "about Makora".
import { normalizeName } from './resolve'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
const flat = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ')

const SAME = '(?:formerly|previously|formerly\\s+known\\s+as|fka|f/k/a|also\\s+known\\s+as|aka|a\\.k\\.a\\.|known\\s+as|d/b/a|doing\\s+business\\s+as)'
const NOW = '(?:now|now\\s+called|now\\s+known\\s+as|which\\s+(?:is\\s+)?now|is\\s+now|has\\s+rebranded\\s+as|rebranded\\s+as|rebranded\\s+to|renamed|renamed\\s+(?:as|to))'

/** True when `alias` is stated in `text` to be another name of `name` (or is only a legal-form variant of it). */
export function statedAlias(name: string, alias: string, text: string): boolean {
  const n = name.trim(), a = alias.trim()
  if (!n || !a) return false
  if (normalizeName(a) === normalizeName(n)) return true // "Makora, Inc." / "Makora AI" — the same name in another legal form
  const t = flat(text), N = esc(flat(n)), A = esc(flat(a))
  const B = (x: string) => `(?<![\\p{L}\\p{N}])${x}(?![\\p{L}\\p{N}])`
  const tests = [
    `${B(N)}[\\s,(—–-]*${SAME}\\s+(?:as\\s+)?${B(A)}`,              // Makora, formerly Mako  ·  Makora (fka Mako)
    `${B(A)}[\\s,(—–-]*${NOW}\\s+${B(N)}`,                            // Mako, now Makora  ·  Mako (now Makora)
    `${B(A)}\\s+(?:has\\s+|have\\s+|was\\s+)?(?:rebranded|renamed|changed\\s+its\\s+name)(?:\\s+itself)?\\s+(?:as|to)\\s+${B(N)}`,
    `${B(N)}\\s*\\(\\s*${B(A)}\\s*\\)`,                                // Amazon Web Services (AWS)
    `${B(A)}\\s*\\(\\s*${B(N)}\\s*\\)`                                 // AWS (Amazon Web Services)
  ]
  return tests.some(p => new RegExp(p, 'iu').test(t))
}

const STOP = new Set(['and', 'of', 'the', 'for', 'de', 'la', '&'])
const ORG_WORDS = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'and', 'group', 'holdings', 'international',
  'systems', 'platforms', 'technologies', 'technology', 'tech', 'research', 'industries', 'networks', 'labs', 'lab', 'ai', 'hq', 'software', 'solutions',
  'global', 'ventures', 'capital', 'partners', 'management', 'plc', 'gmbh', 'sa', 'ag', 'bv', 'nv', 'se', 'pte'])
const GLUED = new Set(['ai', 'hq', 'labs', 'lab', 'io', 'app'])
const words = (s: string) => s.replace(/[’']s\b/gi, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
const initials = (s: string) => words(s).filter(w => !STOP.has(w.toLowerCase())).map(w => w[0].toLowerCase()).join('')
const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

/** True when `alias` has the shape of another way of writing `name` (no text needed). */
export function sameNameShape(name: string, alias: string, type: 'company' | 'firm' | 'person'): boolean {
  const n = name.trim(), a = alias.trim().replace(/[’']s$/i, '')
  if (!n || !a) return false
  if (normalizeName(a) === normalizeName(n)) return true                       // legal form, possessive
  if (letters(a) && letters(a) === letters(n)) return true                    // Red Hat / RedHat
  const short = [n, a].sort((x, y) => x.length - y.length)[0], long = short === n ? a : n
  // the same company with a generic company word more or less (Conway Research, Cerebras Systems, Meta Platforms,
  // Bain & Company, EliseAI); a specific extra word is a product or division (Google Cloud, Uber Eats, DeepSeek V3.2)
  const sw0 = words(short).map(w => w.toLowerCase()), lw0 = words(long).map(w => w.toLowerCase())
  if (sw0.length && sw0.every((w, i) => lw0[i] === w) && lw0.slice(sw0.length).every(w => ORG_WORDS.has(w))) return true
  if (sw0.length === 1 && lw0.length === 1 && [...GLUED].some(g => lw0[0] === sw0[0] + g)) return true
  const sl = letters(short)
  if (/^[A-Za-z&.\s-]{2,8}$/.test(short) && words(long).length >= 2 && sl === initials(long)) return true   // BVP, NEA, IBM
  const m = short.match(/^([a-z])(\d{1,2})([a-z])$/i), ll = letters(long)                                 // a16z, i18n
  if (m && ll.length === Number(m[2]) + 2 && ll[0] === m[1].toLowerCase() && ll.at(-1) === m[3].toLowerCase()) return true
  if (type === 'person') {                                                     // same first and last name, middle names differ
    const sw = words(short).map(w => w.toLowerCase()), lw = words(long).map(w => w.toLowerCase())
    if (sw.length >= 2 && sw[0] === lw[0] && sw.at(-1) === lw.at(-1) && sw.every(w => lw.includes(w))) return true
  }
  return false
}

/** The rule sources must meet before adding an alias: the same name's shape, or the text states it. */
export function acceptAlias(name: string, alias: string, text: string, type: 'company' | 'firm' | 'person'): boolean {
  return sameNameShape(name, alias, type) || statedAlias(name, alias, text)
}
