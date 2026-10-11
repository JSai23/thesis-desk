// Theses: user-owned beliefs. AI never writes title, description, current view or conviction (LAW-04, P-THESIS-008).
import { all, one, run, tx, json } from '../db'
import { newId } from '../ids'
import { now } from '../clock'
import { writeHistory } from '../history'
import { AppError } from '../errors'
import { emit } from '../events'
import { getSetting, setSetting } from '../settings'

export interface ThesisRow {
  id: string; parent_id: string | null; title: string; description: string; current_view: string; conviction: number; watching: number
  archived_at: number | null; merged_into_id: string | null; sort_order: number; last_viewed_at: number | null; created_origin: string; created_at: number; updated_at: number
}

export const getThesis = (id: string): ThesisRow | undefined => one<ThesisRow>('SELECT * FROM theses WHERE id = ?', id)
export const liveTheses = (): ThesisRow[] => all<ThesisRow>('SELECT * FROM theses WHERE merged_into_id IS NULL AND archived_at IS NULL ORDER BY sort_order, created_at')

export function descendants(id: string, includeSelf = true): string[] {
  const rows = all<{ id: string; parent_id: string | null }>('SELECT id, parent_id FROM theses WHERE merged_into_id IS NULL')
  const out: string[] = includeSelf ? [id] : []
  const walk = (p: string) => { for (const r of rows) if (r.parent_id === p) { out.push(r.id); walk(r.id) } }
  walk(id)
  return out
}

export function thesisPath(id: string): string {
  const t = getThesis(id)
  if (!t) return ''
  const p = t.parent_id ? getThesis(t.parent_id) : undefined
  return p ? `${p.title} → ${t.title}` : t.title
}

export function createThesis(parentId: string | null | undefined, title?: string, origin: 'user' | 'accepted_suggestion' = 'user', description = ''): ThesisRow {
  const id = newId('th')
  const t = now()
  const name = (title || '').trim() || 'Untitled thesis'
  tx(() => {
    if (parentId && !getThesis(parentId)) throw new AppError('NOT_FOUND', 'Parent thesis not found')
    const order = (one<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) m FROM theses')!.m) + 1
    run(`INSERT INTO theses(id, parent_id, title, description, current_view, conviction, watching, sort_order, created_origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 2, 1, ?, ?, ?, ?)`, id, parentId ?? null, name, description, order, origin, t, t)
    writeHistory('thesis', id, 'thesis.created', null, { title: name, parentId: parentId ?? null, conviction: 2 }, 'user')
    if (parentId) writeHistory('thesis', parentId, 'thesis.child_created', null, { childId: id, title: name }, 'user')
  })
  emit('object.updated', { type: 'thesis', id })
  return getThesis(id)!
}

export function updateThesis(id: string, patch: { title?: string; description?: string; currentView?: string; conviction?: number; watching?: boolean }): ThesisRow {
  const t0 = getThesis(id)
  if (!t0) throw new AppError('NOT_FOUND', 'Thesis not found')
  const t = now()
  tx(() => {
    if (patch.title !== undefined && patch.title !== t0.title) {
      run('UPDATE theses SET title = ?, updated_at = ? WHERE id = ?', patch.title, t, id)
      writeHistory('thesis', id, 'thesis.renamed', { title: t0.title }, { title: patch.title })
    }
    if (patch.description !== undefined && patch.description !== t0.description) {
      run('UPDATE theses SET description = ?, updated_at = ? WHERE id = ?', patch.description, t, id)
      writeHistory('thesis', id, 'thesis.description', { description: t0.description }, { description: patch.description })
    }
    if (patch.currentView !== undefined && patch.currentView.trim() !== t0.current_view.trim()) {
      run('UPDATE theses SET current_view = ?, updated_at = ? WHERE id = ?', patch.currentView, t, id)
      writeHistory('thesis', id, 'thesis.view_revised', { currentView: t0.current_view }, { currentView: patch.currentView })
    }
    if (patch.conviction !== undefined && patch.conviction !== t0.conviction) {
      run('UPDATE theses SET conviction = ?, updated_at = ? WHERE id = ?', patch.conviction, t, id)
      writeHistory('thesis', id, 'thesis.conviction', { conviction: t0.conviction }, { conviction: patch.conviction })
    }
    if (patch.watching !== undefined && (patch.watching ? 1 : 0) !== t0.watching) {
      run('UPDATE theses SET watching = ?, updated_at = ? WHERE id = ?', patch.watching ? 1 : 0, t, id)
    }
  })
  emit('object.updated', { type: 'thesis', id })
  return getThesis(id)!
}

export function moveThesis(id: string, parentId: string | null): ThesisRow {
  const th = getThesis(id)
  if (!th) throw new AppError('NOT_FOUND', 'Thesis not found')
  if (parentId) {
    if (!getThesis(parentId)) throw new AppError('NOT_FOUND', 'Parent thesis not found')
    if (descendants(id).includes(parentId)) throw new AppError('CONFLICT', 'A thesis can’t be moved under itself or one of its children')
  }
  tx(() => {
    run('UPDATE theses SET parent_id = ?, updated_at = ? WHERE id = ?', parentId, now(), id)
    writeHistory('thesis', id, 'thesis.moved', { parentId: th.parent_id }, { parentId })
  })
  emit('object.updated', { type: 'thesis', id })
  return getThesis(id)!
}

export function archiveThesis(id: string, archived: boolean): void {
  const th = getThesis(id)
  if (!th) throw new AppError('NOT_FOUND', 'Thesis not found')
  tx(() => {
    run('UPDATE theses SET archived_at = ?, updated_at = ? WHERE id = ?', archived ? now() : null, now(), id)
    writeHistory('thesis', id, archived ? 'thesis.archived' : 'thesis.unarchived', null, null)
    if (archived) setSetting('pins.theses', (getSetting<string[]>('pins.theses') || []).filter(x => x !== id))
  })
  emit('object.updated', { type: 'thesis', id })
}

/** Evidence ids linked to a thesis by accepted links (user places include orphaned evidence). */
export function thesisEvidence(thesisId: string, stanceFilter?: 'support' | 'contra'): { evidenceId: string; stance: string; relId: string }[] {
  return all(`SELECT r.from_id evidenceId, COALESCE(r.stance, 'support') stance, r.id relId FROM relationships r JOIN evidence e ON e.id = r.from_id
              WHERE r.from_type = 'evidence' AND r.to_type = 'thesis' AND r.to_id = ? AND r.status = 'accepted' AND e.status IN ('active','orphaned')
              ${stanceFilter ? "AND COALESCE(r.stance,'support') = ?" : ''} ORDER BY r.updated_at DESC`, ...(stanceFilter ? [thesisId, stanceFilter] : [thesisId]))
}

export function thesisTree(includeArchived = false) {
  const rows = all<ThesisRow>(`SELECT * FROM theses WHERE merged_into_id IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY sort_order, created_at`)
  const evCounts = new Map<string, number>()
  for (const r of all<{ to_id: string; n: number }>(`SELECT r.to_id, COUNT(DISTINCT r.from_id) n FROM relationships r JOIN evidence e ON e.id = r.from_id
      WHERE r.from_type = 'evidence' AND r.to_type = 'thesis' AND r.status = 'accepted' AND e.status IN ('active','orphaned') GROUP BY r.to_id`)) evCounts.set(r.to_id, r.n)
  const t = now()
  const fresh = all<{ primary_thesis_id: string }>(`SELECT primary_thesis_id FROM feed_items WHERE primary_thesis_id IS NOT NULL AND read_at IS NULL AND dismissed_at IS NULL
      AND hidden_reason IS NULL AND surfaced_at >= ?`, t - 86400_000)
  const parentOf = new Map(rows.map(r => [r.id, r.parent_id]))
  const freshCount = new Map<string, number>()
  for (const f of fresh) {
    let cur: string | null | undefined = f.primary_thesis_id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) { seen.add(cur); freshCount.set(cur, (freshCount.get(cur) || 0) + 1); cur = parentOf.get(cur) }
  }
  return rows.map(r => ({
    id: r.id, parentId: r.parent_id, title: r.title, description: r.description, currentView: r.current_view, conviction: r.conviction,
    watching: !!r.watching, archived: !!r.archived_at, updatedAt: r.updated_at, createdAt: r.created_at,
    evidenceCount: evCounts.get(r.id) || 0, fresh: freshCount.get(r.id) || 0
  }))
}

const KIND: Record<string, string> = {
  'thesis.created': 'Created', 'thesis.view_revised': 'Revision', 'thesis.conviction': 'Conviction', 'thesis.child_created': 'Child thesis',
  'evidence.accepted': 'Evidence', 'note.counterpoint': 'Counterpoint', 'thesis.merged_view': 'Merged view'
}

/** Evolution tab: history grouped by month with the conviction at the end of each month. */
export function thesisEvolution(id: string) {
  const th = getThesis(id)
  if (!th) throw new AppError('NOT_FOUND', 'Thesis not found')
  const rows = all<{ action: string; before_json: string | null; after_json: string | null; created_at: number }>(
    'SELECT action, before_json, after_json, created_at FROM history WHERE entity_type = ? AND entity_id = ? ORDER BY created_at, rowid', 'thesis', id)
  const months: { month: string; conv: number; events: any[] }[] = []
  let conv = 2
  for (const r of rows) {
    const kind = KIND[r.action]
    if (!kind) continue
    const before = json<any>(r.before_json, {}); const after = json<any>(r.after_json, {})
    const d = new Date(r.created_at)
    const month = d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
    const date = d.toLocaleString('en-US', { month: 'short', day: 'numeric' })
    let text = ''
    const ev: any = { kind, date, at: r.created_at }
    if (r.action === 'thesis.created') { text = 'Thesis created.'; conv = after.conviction ?? conv }
    else if (r.action === 'thesis.conviction') { text = `Conviction changed from ${before.conviction} to ${after.conviction}.`; conv = after.conviction }
    else if (r.action === 'thesis.view_revised') {
      text = 'Revised current view'
      const clip = (s: string) => { const l = (s || '').split('\n')[0]; return l.length > 140 ? l.slice(0, 140) + '…' : (l || '(empty)') }
      ev.before = clip(before.currentView); ev.after = clip(after.currentView)
    }
    else if (r.action === 'thesis.child_created') text = `Created child thesis “${after.title}”.`
    else if (r.action === 'evidence.accepted') text = after.text || 'Evidence added.'
    else if (r.action === 'note.counterpoint') text = after.text || 'Counterpoint added.'
    else if (r.action === 'thesis.merged_view') { text = `Merged “${after.fromTitle}”.`; ev.before = after.fromView || '' }
    ev.text = text
    let m = months[months.length - 1]
    if (!m || m.month !== month) { m = { month, conv, events: [] }; months.push(m) }
    m.events.push(ev)
    m.conv = conv
  }
  return months
}

export function addCompanyToThesis(id: string, companyId: string): void {
  if (!getThesis(id)) throw new AppError('NOT_FOUND', 'Thesis not found')
  const t = now()
  tx(() => {
    const ex = one<{ id: string }>("SELECT id FROM relationships WHERE from_type = 'company' AND from_id = ? AND rel = 'relates_to' AND to_type = 'thesis' AND to_id = ?", companyId, id)
    if (ex) run("UPDATE relationships SET origin = 'user', status = 'accepted', updated_at = ? WHERE id = ?", t, ex.id)
    else run(`INSERT INTO relationships(id, from_type, from_id, rel, to_type, to_id, origin, status, created_at, updated_at)
              VALUES (?, 'company', ?, 'relates_to', 'thesis', ?, 'user', 'accepted', ?, ?)`, newId('rel'), companyId, id, t, t)
    writeHistory('thesis', id, 'thesis.company_added', null, { companyId })
  })
  emit('object.updated', { type: 'thesis', id })
}
