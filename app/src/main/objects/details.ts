// What the user says about an object (DEC-099): their own layer, kept apart from what the agent maintains and never
// overwritten by sources. The lookup, reading, matching, summaries and Ask read it as context — never as evidence: a
// fact still needs a source quote. Writes go through the ontology op `object.describe` (history + undo).
import { all, one, run, json } from '../db'
import { now } from '../clock'
import { registrableDomain } from '../ingest/url'

export type DetailType = 'company' | 'firm' | 'person' | 'thesis' | 'source'
export interface Details { about: string; website: string | null; otherNames: string[]; fields: Record<string, string> }
export const EMPTY: Details = { about: '', website: null, otherNames: [], fields: {} }

/** Kind-specific fields the "Describe it" sheet and the From you block offer (labels are UI copy). */
export const FIELD_SETS: Record<DetailType, { key: string; label: string }[]> = {
  company: [{ key: 'sector', label: 'Sector' }, { key: 'stage', label: 'Stage' }],
  firm: [{ key: 'focus', label: 'Focus' }, { key: 'stage', label: 'Stages' }],
  person: [{ key: 'role', label: 'Role' }, { key: 'org', label: 'Where' }, { key: 'howKnown', label: 'How you know them' }],
  thesis: [{ key: 'proof', label: 'What would prove or disprove it' }],
  source: []
}

export function getDetails(type: string, id: string): Details {
  const d = storedDetails(type, id)
  // a thesis's own description is its "about" (one text, edited in either place)
  if (type === 'thesis') d.about = one<{ description: string }>('SELECT description FROM theses WHERE id = ?', id)?.description || ''
  return d
}

function storedDetails(type: string, id: string): Details {
  const r = one<{ about: string; website: string | null; other_names_json: string; fields_json: string }>('SELECT about, website, other_names_json, fields_json FROM object_details WHERE object_type = ? AND object_id = ?', type, id)
  return r ? { about: r.about, website: r.website, otherNames: json<string[]>(r.other_names_json, []), fields: json<Record<string, string>>(r.fields_json, {}) } : { ...EMPTY, otherNames: [], fields: {} }
}

export const hasDetails = (d: Details): boolean => !!(d.about.trim() || d.website || d.otherNames.length || Object.values(d.fields).some(v => v.trim()))

/** "https://www.Cua.ai/about" → "cua.ai"; null when it isn't a web address. */
export function siteOf(input: string | null | undefined): string | null {
  const t = (input || '').trim()
  if (!t) return null
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
    return /\.[a-z]{2,}$/i.test(u.hostname) ? registrableDomain(u.href) || u.hostname.replace(/^www\./, '') : null
  } catch { return null }
}

/** A name typed as a web address ("cua.ai", "www.acme.com"): the lookup takes it as the website. */
export const looksLikeDomain = (name: string): boolean => /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/?$/i.test(name.trim())

export function writeDetails(type: DetailType, id: string, d: Details): void {
  run(`INSERT INTO object_details(object_type, object_id, about, website, other_names_json, fields_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(object_type, object_id) DO UPDATE SET about = excluded.about, website = excluded.website, other_names_json = excluded.other_names_json, fields_json = excluded.fields_json, updated_at = excluded.updated_at`,
    type, id, d.about.trim(), d.website ? siteOf(d.website) : null, JSON.stringify([...new Set(d.otherNames.map(n => n.trim()).filter(Boolean))]),
    JSON.stringify(Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v))), now())
}

/** Context words for a news search from what the user (or, failing that, the library) says it does: the 3 most specific
 *  words — "computer-use agent infrastructure" → computer-use, agent, infrastructure. */
const STOP = new Set('a an and the of for to in on with by at from or is are its it that this we our they their builds build building makes make company startup platform provides provider tools tool software solutions solution service services based new using use helps help focused focus'.split(' '))
export function contextWords(text: string, max = 3): string[] {
  const words = (text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []).filter(w => !STOP.has(w))
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, max)
}

/** The user's layer for an entity as context for the agent: their details plus their latest notes on it (null when
 *  they said nothing) — read by reading (SAME_ENTITY), summaries and Ask. */
export function userContext(type: 'company' | 'firm' | 'person', id: string): { about: string; website: string | null; otherNames: string[]; fields: Record<string, string>; notes: string[] } | null {
  const d = getDetails(type, id)
  const notes = type === 'person' ? [] : all<{ text: string }>(`SELECT text FROM notes WHERE deleted_at IS NULL AND ((anchor_type = ? AND anchor_id = ?)
      OR id IN (SELECT from_id FROM relationships WHERE from_type = 'note' AND to_type = ? AND to_id = ? AND status = 'accepted')) ORDER BY created_at DESC LIMIT 5`, type, id, type, id).map(n => n.text.slice(0, 400))
  if (!hasDetails(d) && !notes.length) return null
  return { ...d, notes }
}
