// Entity catalogs for CREATE_REPORT / REFINE_REPORT / CREATE_ALERT. The model may only use ids it is shown, so an
// entity the request names must be in the list even when the library holds more entities than the cap: names (with
// common firm suffixes dropped) and aliases mentioned in the request come first, then followed, then recently updated.
import { all } from '../db'

type Ent = 'company' | 'firm' | 'person'
const TABLE: Record<Ent, string> = { company: 'companies', firm: 'firms', person: 'people' }
const SUFFIX = /\s+(capital|ventures|venture partners|partners|management|holdings|vc|fund|group|inc\.?|labs)$/i

export function entityCatalog(type: Ent, text: string, limit: number): { id: string; name: string }[] {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  const has = (s: string) => { const k = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); return k.length >= 3 && t.includes(` ${k} `) }
  const rows = all<{ id: string; name: string; followed: number; updated_at: number }>(`SELECT id, name, followed, updated_at FROM ${TABLE[type]} WHERE merged_into_id IS NULL AND deleted_at IS NULL`)
  const aliased = new Set(all<{ entity_id: string; alias: string }>('SELECT entity_id, alias FROM aliases WHERE entity_type = ?', type).filter(a => has(a.alias)).map(a => a.entity_id))
  const named = (r: { id: string; name: string }) => aliased.has(r.id) || has(r.name) || (SUFFIX.test(r.name) && has(r.name.replace(SUFFIX, '')))
  return rows.map(r => ({ ...r, hit: named(r) ? 1 : 0 }))
    .sort((a, b) => b.hit - a.hit || b.followed - a.followed || b.updated_at - a.updated_at)
    .slice(0, limit).map(({ id, name }) => ({ id, name }))
}
