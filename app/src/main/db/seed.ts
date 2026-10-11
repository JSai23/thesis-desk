// Idempotent first-run seed: builtin field defs, the system Read-once source, maintenance schedules (RFC §1B.4.2).
import { run, one } from './index'
import { now } from '../clock'
import { newId } from '../ids'
import { seedMaintenance } from '../scheduler'

export const STAGES = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Series E', 'Series F', 'Series G', 'Series H', 'Late stage', 'Acquired', 'Public', 'Unknown']

const BUILTIN_FIELDS: [string, string, string, string, string[] | null][] = [
  ['company', 'stage', 'Stage', 'enum', STAGES],
  ['company', 'hq', 'HQ', 'text', null],
  ['company', 'founded', 'Founded', 'text', null],
  ['company', 'tagline', 'Tagline', 'text', null],
  ['company', 'website', 'Website', 'url', null],
  ['firm', 'hq', 'HQ', 'text', null],
  ['firm', 'tagline', 'Tagline', 'text', null],
  ['firm', 'website', 'Website', 'url', null]
]

export function seed(): void {
  const t = now()
  for (const [ot, key, label, vt, en] of BUILTIN_FIELDS) {
    if (!one('SELECT id FROM field_defs WHERE object_type = ? AND key = ? AND deleted_at IS NULL', ot, key))
      run('INSERT INTO field_defs(id, object_type, key, label, value_type, enum_values_json, builtin, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
        newId('fd'), ot, key, label, vt, en ? JSON.stringify(en) : null, t)
  }
  run(`INSERT OR IGNORE INTO sources(id, name, kind, locator, canonical_locator, type_label, trust, mode, instruction, config_json, freq, priority, enabled, origin, created_at, updated_at)
       VALUES ('src_manual', 'Added by you', 'manual', 'manual:', 'manual:', 'Added by you', 'editorial', 'all', '', ?, 'daily', 'normal', 1, 'system', ?, ?)`,
    JSON.stringify({ version: 1, fetch: { adapter: 'manual', render: 'http', maxItemsPerSync: 1, historyWindowDays: 30 }, relevance: { mode: 'all', instruction: '', include: [], exclude: [], entityFocus: 'none' }, extract: { customFieldKeys: 'all_active' } }), t, t)
  seedMaintenance()
}
