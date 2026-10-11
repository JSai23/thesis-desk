// object.describe (DEC-099): the user's own description and details of a company, firm, person, thesis or source —
// their layer, apart from what the agent maintains. Changing what the lookup uses (website, what it does, other names)
// re-runs the agent's work on it: the lookup for an entity, the match against stored facts for a thesis.
import { z } from 'zod'
import { one, run } from '../../db'
import { now } from '../../clock'
import { queueMatch } from '../../theses/match'
import { updateThesis } from '../../theses'
import { getDetails, writeDetails, siteOf, type Details, type DetailType } from '../../objects/details'
import { startHydrate } from '../../objects/hydrate'
import { addAlias } from '../resolve'
import { defineOp } from './types'
import { audit, nameOf } from './primitives'

const TABLE: Record<DetailType, string> = { company: 'companies', firm: 'firms', person: 'people', thesis: 'theses', source: 'sources' }
const live = (t: DetailType, id: string) => one(`SELECT 1 FROM ${TABLE[t]} WHERE id = ? AND ${t === 'thesis' ? 'merged_into_id IS NULL' : t === 'source' ? 'deleted_at IS NULL' : 'merged_into_id IS NULL AND deleted_at IS NULL'}`, id)
const Patch = z.object({ about: z.string().max(2000).optional(), website: z.string().max(300).nullable().optional(), otherNames: z.array(z.string().max(120)).max(20).optional(), fields: z.record(z.string(), z.string().max(500)).optional() })

/** Queue the agent's work for an object again with the user's details (Re-process). */
export function rerun(type: DetailType, id: string): string | null {
  if (type === 'company' || type === 'firm' || type === 'person') {
    const followed = one<{ followed: number }>(`SELECT followed FROM ${TABLE[type]} WHERE id = ?`, id)?.followed === 1
    return startHydrate(type, id, { once: !followed })
  }
  if (type === 'thesis') return queueMatch(id)
  return null
}

export const describe = defineOp({
  name: 'object.describe',
  input: z.object({ type: z.enum(['company', 'firm', 'person', 'thesis', 'source']), id: z.string().min(1), patch: Patch, rerun: z.boolean().optional() }),
  validate: i => (live(i.type, i.id) ? [] : [`That ${i.type} no longer exists`]),
  describe: i => `Save your description of ${i.type === 'source' ? 'this source' : nameOf(i.type as any, i.id) || 'it'}?`,
  apply: (i, cs) => {
    const before = getDetails(i.type, i.id)
    const after: Details = { about: i.patch.about ?? before.about, website: i.patch.website === undefined ? before.website : siteOf(i.patch.website), otherNames: i.patch.otherNames ?? before.otherNames, fields: { ...before.fields, ...(i.patch.fields || {}) } }
    writeDetails(i.type, i.id, after)
    if (i.type === 'thesis' && after.about !== before.about) updateThesis(i.id, { description: after.about })
    // the user's word on the website is the entity's domain (its site is followed; Check for updates uses it)
    if ((i.type === 'company' || i.type === 'firm') && after.website && after.website !== before.website) run(`UPDATE ${TABLE[i.type]} SET domain = ?, updated_at = ? WHERE id = ?`, after.website, now(), i.id)
    if (i.type === 'company' || i.type === 'firm' || i.type === 'person') for (const n of after.otherNames.filter(n => !before.otherNames.includes(n))) addAlias(i.type, i.id, n, 'user')
    audit(i.type, i.id, 'object.described', before, after)
    cs.touch(i.type, i.id)
    const lookupInputs = (d: Details) => JSON.stringify([d.about, d.website, d.otherNames])
    const job = i.rerun !== false && lookupInputs(after) !== lookupInputs(before) ? rerun(i.type, i.id) : null
    return { details: after, rerunJobId: job }
  },
  undo: { 'object.described': h => ({ op: 'object.describe', input: { type: h.entity_type, id: h.entity_id, patch: h.before, rerun: false } }) },
  chat: {
    action: 'describe_object',
    line: 'the user tells you, in their own words, what a listed company, firm or person is or does, to keep as their description (their knowledge, not a sourced fact, not a field such as stage or HQ): objectType, objectId, value = their description.',
    toInput: (s, typeOf) => {
      const t = typeOf(s.objectId)
      if (t !== 'company' && t !== 'firm' && t !== 'person') throw 'describe_object needs objectId of a listed company, firm or person'
      if (!s.value?.trim()) throw 'describe_object needs value (the description)'
      return { type: t, id: s.objectId!, patch: { about: s.value.trim() } }
    }
  }
})

export const DETAIL_OPS = [describe]
