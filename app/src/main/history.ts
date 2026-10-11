// Audit trail for every user-visible change to theses, views, reports, alerts, fields, merges (B-DATA-007).
import { run } from './db'
import { newId } from './ids'
import { now } from './clock'

export function writeHistory(entityType: string, entityId: string, action: string, before: unknown, after: unknown, actor: 'user' | 'ai' | 'system' = 'user'): string {
  const id = newId('hi')
  run('INSERT INTO history(id, entity_type, entity_id, action, before_json, after_json, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, entityType, entityId, action, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after), actor, now())
  return id
}
