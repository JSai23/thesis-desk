// View definitions (RFC §1B.15): defaults equal the prototype; resolution object-scope → type-scope → default.
// view.customize (CUSTOMIZE_VIEW) and view.undo live with the AI customization phase; this module owns storage and reads.
import { all, one, run, tx, json } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { writeHistory } from '../history'
import { AppError } from '../errors'
import { emit } from '../events'
import { ViewDefinition, PageViewDefinition, FeedViewDefinition, FeedSpecPartial } from '../../shared/schemas/view-def'

export type ViewObjectType = 'company' | 'firm' | 'thesis' | 'feed'
export type PageType = 'company' | 'firm' | 'thesis'

export const DEFAULTS: { company: PageViewDefinition; firm: PageViewDefinition; thesis: PageViewDefinition; feed: FeedViewDefinition } = {
  company: {
    version: 1, objectType: 'company', headerFields: ['stage', 'hq', 'founded', 'website'],
    main: [{ id: 'activity', component: 'activity_timeline' }],
    rail: [
      { id: 'notes', component: 'notes' },
      { id: 'theses', component: 'linked_objects', params: { targetType: 'thesis' } },
      { id: 'founders', component: 'people', title: 'Founders' },
      { id: 'latest_round', component: 'latest_round' }
    ]
  },
  firm: {
    // The RFC lists no firm header fields; the prototype firm header shows location and site.
    version: 1, objectType: 'firm', headerFields: ['hq', 'website'],
    main: [
      { id: 'investments', component: 'investments' },
      { id: 'writing', component: 'writing' },
      { id: 'commentary', component: 'commentary' }
    ],
    rail: [
      { id: 'notes', component: 'notes' },
      { id: 'portfolio', component: 'portfolio' },
      { id: 'theses', component: 'linked_objects', params: { targetType: 'thesis' } },
      { id: 'kept_evidence', component: 'evidence_list', params: { keptOnly: true } }
    ]
  },
  thesis: {
    version: 1, objectType: 'thesis', headerFields: [],
    main: [
      { id: 'current_view', component: 'current_view' },
      { id: 'evidence', component: 'evidence_columns', params: { order: 'support_first' } },
      { id: 'thoughts', component: 'thoughts' },
      { id: 'children', component: 'thesis_children' }
    ],
    rail: [
      { id: 'recent_changes', component: 'recent_changes' },
      { id: 'companies', component: 'linked_objects', params: { targetType: 'company' } },
      { id: 'firms', component: 'linked_objects', params: { targetType: 'firm' } },
      { id: 'questions', component: 'questions' }
    ]
  },
  feed: { version: 1, objectType: 'feed', spec: { groupBy: 'section', sort: 'relevance' } }
}

export interface ViewResult {
  id: string | null; version: number; scope: 'object' | 'type' | 'default'; instruction: string | null; isDefault: boolean
  definition: ViewDefinition
}

interface ViewRow { id: string; scope: string; object_type: string; object_id: string | null; name: string | null; definition_json: string; instruction: string | null; version: number; created_at: number; updated_at: number }

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

/** Parse a stored definition; null when it no longer validates or belongs to another object type. */
function parseStored(row: ViewRow | undefined, objectType: ViewObjectType): ViewDefinition | null {
  if (!row) return null
  const r = ViewDefinition.safeParse(json(row.definition_json, null))
  return r.success && r.data.objectType === objectType ? r.data : null
}

export function getView(objectType: ViewObjectType, objectId?: string | null): ViewResult {
  if (objectId && objectType !== 'feed') {
    const row = one<ViewRow>("SELECT * FROM view_definitions WHERE scope = 'object' AND object_type = ? AND object_id = ?", objectType, objectId)
    const def = parseStored(row, objectType)
    if (row && def) return { id: row.id, version: row.version, scope: 'object', instruction: row.instruction, isDefault: false, definition: def }
  }
  const row = one<ViewRow>("SELECT * FROM view_definitions WHERE scope = 'type' AND object_type = ? AND object_id IS NULL", objectType)
  const def = parseStored(row, objectType)
  if (row && def) return { id: row.id, version: row.version, scope: 'type', instruction: row.instruction, isDefault: false, definition: def }
  return { id: null, version: 0, scope: 'default', instruction: null, isDefault: true, definition: clone(DEFAULTS[objectType]) }
}

/** Page definition for object.get (company/firm/thesis). */
export function getPageView(objectType: PageType, objectId: string): ViewResult & { definition: PageViewDefinition } {
  return getView(objectType, objectId) as ViewResult & { definition: PageViewDefinition }
}

/** Reset to the default layout: removes the object's definition and the type definition it would fall back to. */
export function resetView(objectType: ViewObjectType, objectId?: string | null): ViewResult {
  tx(() => {
    // Reset the layout the page actually uses: its own object-scope row if it has one, else the type-scope row.
    const own = objectId && objectType !== 'feed' ? all<ViewRow>("SELECT * FROM view_definitions WHERE object_type = ? AND scope = 'object' AND object_id = ?", objectType, objectId) : []
    const rows = own.length ? own : all<ViewRow>("SELECT * FROM view_definitions WHERE object_type = ? AND scope = 'type'", objectType)
    for (const r of rows) run('DELETE FROM view_definitions WHERE id = ?', r.id)
    writeHistory('view', objectId || objectType, 'view.reset',
      rows.map(r => ({ id: r.id, scope: r.scope, objectType: r.object_type, objectId: r.object_id, version: r.version, instruction: r.instruction, definition: json(r.definition_json, null) })),
      { scope: 'default', objectType, objectId: objectId ?? null })
  })
  emit('view.updated', { objectType, objectId: objectId ?? null })
  return getView(objectType, objectId)
}

// ---------------------------------------------------------------- saved feed views
export interface SavedFeedView { id: string; name: string; spec: Record<string, unknown>; createdAt: number; updatedAt: number }

const savedDTO = (r: ViewRow): SavedFeedView => ({ id: r.id, name: r.name || '', spec: json<any>(r.definition_json, {}).spec || {}, createdAt: r.created_at, updatedAt: r.updated_at })

export function listFeedViews(): SavedFeedView[] {
  return all<ViewRow>("SELECT * FROM view_definitions WHERE scope = 'saved_feed' AND object_type = 'feed' ORDER BY created_at, rowid").map(savedDTO)
}

export function saveFeedView(name: string, spec: unknown): SavedFeedView {
  const nm = name.trim()
  if (!nm) throw new AppError('VALIDATION', 'Give the view a name')
  const parsed = FeedSpecPartial.safeParse(spec ?? {})
  if (!parsed.success) throw new AppError('VALIDATION', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
  const def: FeedViewDefinition = { version: 1, objectType: 'feed', spec: parsed.data }
  const id = newId('vd')
  const t = now()
  tx(() => {
    run(`INSERT INTO view_definitions(id, scope, object_type, object_id, name, definition_json, instruction, version, created_at, updated_at)
         VALUES (?, 'saved_feed', 'feed', NULL, ?, ?, NULL, 1, ?, ?)`, id, nm, JSON.stringify(def), t, t)
    writeHistory('view', id, 'view.saved_feed', null, { name: nm, spec: parsed.data })
  })
  emit('view.updated', { objectType: 'feed', savedViewId: id })
  return savedDTO(one<ViewRow>('SELECT * FROM view_definitions WHERE id = ?', id)!)
}

export function deleteFeedView(id: string): { ok: true } {
  const r = one<ViewRow>("SELECT * FROM view_definitions WHERE id = ? AND scope = 'saved_feed'", id)
  if (!r) throw new AppError('NOT_FOUND', 'Saved view not found')
  tx(() => {
    run('DELETE FROM view_definitions WHERE id = ?', id)
    writeHistory('view', id, 'view.deleted_feed', { name: r.name, spec: json<any>(r.definition_json, {}).spec || {} }, null)
  })
  emit('view.updated', { objectType: 'feed', savedViewId: id })
  return { ok: true }
}

/** Group ▾ / Settings ▸ Group Today by are structured shortcuts for the feed view definition's groupBy (LAW-01). */
export function setFeedGroupBy(groupBy: 'section' | 'source' | 'thesis' | 'none'): void {
  const t = now()
  tx(() => {
    const row = one<ViewRow>("SELECT * FROM view_definitions WHERE scope = 'type' AND object_type = 'feed' AND object_id IS NULL")
    const cur = parseStored(row, 'feed') as FeedViewDefinition | null
    const next: FeedViewDefinition = { version: 1, objectType: 'feed', spec: { ...(cur?.spec || DEFAULTS.feed.spec), groupBy } }
    if (row) run('UPDATE view_definitions SET definition_json = ?, version = version + 1, updated_at = ? WHERE id = ?', JSON.stringify(next), t, row.id)
    else run("INSERT INTO view_definitions(id, scope, object_type, object_id, definition_json, instruction, version, created_at, updated_at) VALUES (?, 'type', 'feed', NULL, ?, NULL, 1, ?, ?)", newId('vd'), JSON.stringify(next), t, t)
    writeHistory('view', 'feed', 'view.changed', { groupBy: cur?.spec?.groupBy ?? 'section' }, { groupBy }, 'user')
  })
  emit('view.updated', { objectType: 'feed' })
}
