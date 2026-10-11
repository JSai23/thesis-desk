// Entity resolution (RFC §1B.13.1, B-INGEST-006): exact normalized name → domain → alias → fuzzy (Jaro-Winkler);
// 0.85–0.95 asks RESOLVE_ENTITY; no/low-confidence match → new entity + entity_merge suggestion (DEC-026).
// Planning is async (may call the model); applying happens inside the caller's transaction.
import { all, one, run } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { runTask } from '../ai/runtime'
import { RESOLVE } from '../ai/tasks/document'
import { invalidateNameCache } from '../ai/grounding'
import { registrableDomain } from '../ingest/url'
import { log } from '../log'

export type EntityType = 'company' | 'firm' | 'person'
export const TABLE: Record<EntityType, string> = { company: 'companies', firm: 'firms', person: 'people' }
export const PREFIX: Record<EntityType, 'co' | 'fm' | 'pp'> = { company: 'co', firm: 'fm', person: 'pp' }

const SUFFIXES = new Set(['inc', 'incorporated', 'ltd', 'limited', 'llc', 'labs', 'lab', 'ai', 'hq', 'capital', 'ventures', 'venture', 'partners', 'co', 'corp', 'corporation', 'gmbh', 'sa', 'plc', 'the'])

/** Display name normalized for matching only: lowercase, no punctuation, generic suffixes stripped. */
export function normalizeName(name: string): string {
  const words = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const core = words.filter((w, i) => !(SUFFIXES.has(w) && (i > 0 || words.length > 1)))
  return (core.length ? core : words).join(' ')
}

/** Alias key: case and punctuation only, so every distinct spelling ("Lumen Legal AI", "Lumen Legal, Inc.") is kept. */
export function aliasKey(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false)
  let m = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue
      am[i] = bm[j] = true; m++; break
    }
  }
  if (!m) return 0
  let t = 0, k = 0
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue
    while (!bm[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3
  let p = 0
  while (p < Math.min(4, a.length, b.length) && a[p] === b[p]) p++
  return jaro + p * 0.1 * (1 - jaro)
}

interface Cand { id: string; name: string; normalized_name: string; domain: string | null }
export interface Mention { type: EntityType; name: string; domain?: string | null; aliases?: string[]; context: string }
export type Decision = { kind: 'match'; id: string } | { kind: 'create'; mergeWith?: string; mergeScore?: number }

const live = (type: EntityType) => all<Cand>(`SELECT id, name, normalized_name, ${type === 'person' ? 'NULL AS domain' : 'domain'} FROM ${TABLE[type]} WHERE merged_into_id IS NULL AND deleted_at IS NULL`)

/** Deterministic steps 1–3 (no AI). Used by query resolution too. */
export function resolveDeterministic(type: EntityType, name: string, domain?: string | null): string | null {
  const n = normalizeName(name)
  if (!n) return null
  const exact = one<{ id: string }>(`SELECT id FROM ${TABLE[type]} WHERE normalized_name = ? AND merged_into_id IS NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, n)
  if (exact) return exact.id
  if (domain && type !== 'person') {
    const d = registrableDomain(domain)
    const byDomain = one<{ id: string }>(`SELECT id FROM ${TABLE[type]} WHERE domain = ? AND merged_into_id IS NULL AND deleted_at IS NULL`, d)
    if (byDomain) return byDomain.id
  }
  const alias = one<{ entity_id: string }>('SELECT entity_id FROM aliases WHERE entity_type = ? AND alias_normalized = ?', type, aliasKey(name))
  if (alias) {
    let id = alias.entity_id
    for (let i = 0; i < 5; i++) { const m = one<{ merged_into_id: string | null }>(`SELECT merged_into_id FROM ${TABLE[type]} WHERE id = ?`, id); if (!m?.merged_into_id) break; id = m.merged_into_id }
    return id
  }
  return null
}

export async function plan(m: Mention, jobId?: string | null): Promise<Decision> {
  const det = resolveDeterministic(m.type, m.name, m.domain) || (m.aliases || []).map(a => resolveDeterministic(m.type, a)).find(Boolean)
  if (det) return { kind: 'match', id: det }
  const n = normalizeName(m.name)
  const scored = live(m.type).map(c => ({ c, s: jaroWinkler(n, c.normalized_name) })).filter(x => x.s >= 0.85).sort((a, b) => b.s - a.s)
  if (scored.length && scored[0].s >= 0.95) return { kind: 'match', id: scored[0].c.id }
  if (!scored.length) return { kind: 'create' }
  const cands = scored.slice(0, 5).map(x => ({ id: x.c.id, name: x.c.name, domain: x.c.domain, tagline: tagline(m.type, x.c.id) }))
  try {
    const r = await runTask(RESOLVE, { mention: m.name, type: m.type, context: m.context, candidates: cands }, { jobId })
    if (r.value.match && r.value.confidence >= 0.7) return { kind: 'match', id: r.value.match }
  } catch (e) {
    log.warn('resolve', 'RESOLVE_ENTITY failed; creating a new entity with a merge suggestion', { err: String(e) })
  }
  return { kind: 'create', mergeWith: cands[0].id, mergeScore: scored[0].s }
}

function tagline(type: EntityType, id: string): string {
  if (type === 'person') return ''
  return one<{ display: string }>("SELECT display FROM field_values WHERE object_type = ? AND object_id = ? AND field_key = 'tagline' AND status = 'current'", type, id)?.display || ''
}

export function addAlias(type: EntityType, id: string, alias: string, origin: 'source_fact' | 'user' | 'merge'): void {
  const n = aliasKey(alias)
  if (!n) return
  // a source never makes another live entity's name an alias: "Stripe" became an alias of Mercury (source_fact), so
  // renaming Stripe could not keep its own old name and mentions of Stripe would resolve to Mercury (run #18, RD-ONT-02;
  // MEM-058). The user (rename, merge, create) decides that kind of identity — and merges keep their aliases.
  if (origin === 'source_fact' && one(`SELECT 1 FROM ${TABLE[type]} WHERE normalized_name = ? AND id <> ? AND merged_into_id IS NULL AND deleted_at IS NULL`, normalizeName(alias), id)) return
  run('INSERT OR IGNORE INTO aliases(entity_type, entity_id, alias, alias_normalized, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)', type, id, alias, n, origin, now())
}

/** Display name without trailing legal-form suffixes ("Lumen Legal, Inc." → "Lumen Legal"); the full form stays an alias. */
export function displayName(name: string): string {
  const n = name.trim().replace(/,?\s+(inc|inc\.|incorporated|llc|l\.l\.c\.|ltd|ltd\.|limited|corp|corp\.|corporation|gmbh|plc|s\.a\.)$/i, '').trim()
  return n || name.trim()
}

export function createEntity(type: EntityType, name: string, o: { domain?: string | null; origin?: 'source_fact' | 'user' } = {}): string {
  const id = newId(PREFIX[type])
  if (type !== 'person' && o.origin !== 'user') name = displayName(name)
  const t = now()
  const dom = o.domain ? registrableDomain(o.domain) : null
  if (type === 'person') run('INSERT INTO people(id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, name, normalizeName(name), t, t)
  else {
    const taken = dom ? one(`SELECT 1 FROM ${TABLE[type]} WHERE domain = ? AND merged_into_id IS NULL AND deleted_at IS NULL`, dom) : null
    run(`INSERT INTO ${TABLE[type]}(id, name, normalized_name, domain, created_origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, id, name, normalizeName(name), taken ? null : dom, o.origin || 'source_fact', t, t)
  }
  invalidateNameCache()
  return id
}

/** Apply a planned decision (inside a transaction). Returns the entity id. */
export function apply(m: Mention, d: Decision): string {
  let id: string
  if (d.kind === 'match') {
    id = d.id
    if (m.domain && m.type !== 'person') run(`UPDATE ${TABLE[m.type]} SET domain = COALESCE(domain, ?) WHERE id = ? AND NOT EXISTS (SELECT 1 FROM ${TABLE[m.type]} WHERE domain = ? AND id <> ?)`, registrableDomain(m.domain), id, registrableDomain(m.domain), id)
  } else {
    // a mention planned earlier in the same document may already have created it
    id = resolveDeterministic(m.type, m.name, m.domain) || createEntity(m.type, m.name, { domain: m.domain })
    if (d.mergeWith && d.mergeWith !== id) {
      const [a, b] = [id, d.mergeWith].sort()
      run(`INSERT OR IGNORE INTO suggestions(id, type, target_type, target_id, payload_json, explanation, confidence, status, dedupe_key, created_at)
           VALUES (?, 'entity_merge', ?, ?, ?, ?, ?, 'open', ?, ?)`, newId('sg'), m.type, id, JSON.stringify({ fromId: id, intoId: d.mergeWith, type: m.type }),
        `“${m.name}” may be the same as an existing ${m.type}.`, d.mergeScore ?? 0.85, `merge:${a}:${b}`, now())
    }
  }
  let canonical = one<{ name: string }>(`SELECT name FROM ${TABLE[m.type]} WHERE id = ?`, id)?.name
  // a name typed in lower case ("acme robotics labs") takes the source's spelling of the same name ("Acme Robotics Lab")
  const lowerWord = (n: string) => n.split(/\s+/).some(w => /^\p{Ll}/u.test(w))
  if (m.type !== 'person' && canonical && lowerWord(canonical) && !lowerWord(m.name) && normalizeName(m.name) === normalizeName(canonical)) {
    run(`UPDATE ${TABLE[m.type]} SET name = ?, updated_at = ? WHERE id = ?`, m.name, now(), id)
    addAlias(m.type, id, canonical, 'user')
    canonical = m.name
  }
  for (const al of [m.name, ...(m.aliases || [])]) if (al && al !== canonical) addAlias(m.type, id, al, 'source_fact')
  // A grounded abbreviation ("Amazon Web Services (AWS)") naming another existing entity: that one was created before
  // the text tied the two names, so offer the merge (merges stay user-confirmed, §1B.13.4).
  if (m.type !== 'person') for (const al of m.aliases || []) {
    if (!isAbbreviation(al, canonical || m.name)) continue
    const other = one<{ id: string }>(`SELECT id FROM ${TABLE[m.type]} WHERE normalized_name = ? AND id <> ? AND merged_into_id IS NULL AND deleted_at IS NULL`, normalizeName(al), id)
    if (!other) continue
    const [a, b] = [other.id, id].sort()
    run(`INSERT OR IGNORE INTO suggestions(id, type, target_type, target_id, payload_json, explanation, confidence, status, dedupe_key, created_at)
         VALUES (?, 'entity_merge', ?, ?, ?, ?, 0.9, 'open', ?, ?)`, newId('sg'), m.type, other.id, JSON.stringify({ fromId: other.id, intoId: id, type: m.type }),
      `A source calls ${canonical || m.name} “${al}”.`, `merge:${a}:${b}`, now())
  }
  return id
}

/** "AWS" for Amazon Web Services, "YC" for Y Combinator, "a16z": initials, or a short token with digits/capitals. */
export function isAbbreviation(alias: string, name: string): boolean {
  const a = alias.replace(/[.\s]/g, '')
  if (a.length < 2 || a.length > 8) return false
  const initials = name.split(/[\s-]+/).filter(w => /^\p{L}/u.test(w)).map(w => w[0]).join('')
  return a.toLowerCase() === initials.toLowerCase() || /\d/.test(a) || (a === a.toUpperCase() && /[A-Z]{2}/.test(a))
}
