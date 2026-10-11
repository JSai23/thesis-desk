// Port of the prototype's rvScreens(): thesis, theses, company, firm, entity lists, sources, reports.
import type { Controller } from '../Controller'
import { tryCall } from '../api'
import { col, convColor, stanceColor, hueOf, initialOf, ago, shortDate, longDate } from '../util'
import { FREQ_LABEL, LABEL_FREQ, PRIO_LABEL, KIND_TO_TYPE, TYPE_TO_KIND } from '../Controller'
import type { ThesisDTO, CompanyListDTO, FirmListDTO, PersonListDTO, SourceDTO, ThesisPageDTO, CompanyPageDTO, FirmPageDTO, ReportDTO, AlertDTO, BriefingDTO, EvidenceCardDTO, SectionDTO, FieldChipDTO } from '../../shared/dto'

type Any = any
const CONV_LABELS = ['', 'Skeptical', 'Exploring', 'Forming', 'Conviction rising', 'High conviction']
const KIND_COLOR: Record<string, string> = { Funding: 'var(--o8-12-85)', Product: 'var(--o78-11-255)', Expansion: 'var(--o78-12-155)', Interview: 'var(--o8-1-300)', Commentary: 'var(--o8-1-200)', News: 'var(--o8-12-65)', Pricing: 'var(--o78-12-155)', People: 'var(--o8-1-300)', Customers: 'var(--o78-12-155)', Milestone: 'var(--o8-1-200)' }

/** Section order/visibility from a page view definition: returns { has(component), order(component) } for CSS ordering. */
function layout(main: SectionDTO[] | undefined, rail: SectionDTO[] | undefined) {
  const pos = new Map<string, number>()
  ;(main || []).forEach((s, i) => { const k = s.component + (s.params?.targetType ? ':' + s.params.targetType : '') + (s.params?.stance ? ':' + s.params.stance : ''); if (!pos.has(k)) pos.set(k, i) })
  ;(rail || []).forEach((s, i) => { const k = 'rail:' + s.component + (s.params?.targetType ? ':' + s.params.targetType : '') + (s.params?.keptOnly ? ':kept' : ''); if (!pos.has(k)) pos.set(k, i) })
  return { has: (k: string) => pos.has(k), order: (k: string) => pos.get(k) ?? 99 }
}

function evCard(c: Controller, e: EvidenceCardDTO) {
  const s = c.state; const open = !!s.expandedEv[e.id]
  return {
    text: e.assertion === 'attributed_opinion' && e.attributedTo ? `${e.attributedTo} argues: ${e.text}` : e.text, src: e.src, date: shortDate(e.date), tile: col(hueOf(e.src || e.documentId)),
    clamp: open ? 'unset' : '3', note: e.quote && e.quote !== e.text ? '“' + e.quote + '”' : '', showNote: open && !!e.quote && e.quote !== e.text, orphaned: e.orphaned,
    onToggle: () => c.setState((st: Any) => ({ expandedEv: { ...st.expandedEv, [e.id]: !open } })),
    onCtx: (ev: Any) => e.relId ? c.menuAt(ev, [
      { label: 'Open source', act: () => c.openItem(e.itemId, e.documentId) },
      { label: e.stance === 'contra' ? 'Move to Supporting' : 'Move to Contradicting', act: async () => { if (await c.act('link.change', { relId: e.relId, thesisId: s.thesisId, stance: e.stance === 'contra' ? 'support' : 'contra' })) c.refreshAll(false) } },
      { label: 'Remove from thesis', color: '#ff8a80', act: async () => { if (await c.act('link.reject', { relId: e.relId })) c.refreshAll(false) } }
    ]) : c.openItem(e.itemId, e.documentId),
    onOpen: () => c.openItem(e.itemId, e.documentId)
  }
}

function chipsV(c: Controller, objectType: 'company' | 'firm', objectId: string, chips: FieldChipDTO[]) {
  return chips.filter(ch => ch.value).map(ch => ({
    key: ch.key,
    label: ch.key === 'website' ? ch.value!.replace(/^https?:\/\//, '').replace(/\/$/, '') : ch.custom ? `${ch.label} ${ch.value}` : ch.key === 'founded' ? 'Founded ' + ch.value : ch.value!,
    title: ch.label + (ch.provenance ? ' · ' + ch.provenance : ''),
    onClick: (e: Any) => openFieldPopover(c, e, objectType, objectId, ch)
  }))
}

export async function openFieldPopover(c: Controller, e: Any, objectType: string, objectId: string, ch: FieldChipDTO) {
  e.stopPropagation && e.stopPropagation()
  const r = e.currentTarget?.getBoundingClientRect?.()
  const hist = await c.act<Any[]>('field.history', { objectType, objectId, key: ch.key }) || []
  c.setState({ popover: { x: r ? r.left : 200, y: r ? r.bottom + 6 : 200, objectType, objectId, chip: ch, history: hist, draft: '', editing: false } })
}

export function rvScreens(c: Controller, V: Any) {
  const s = c.state, sc = s.screen
  V.isThesis = sc === 'thesis'; V.isTheses = sc === 'theses'; V.isCompany = sc === 'company'; V.isFirm = sc === 'firm'
  V.isEntityList = sc === 'companies' || sc === 'firms' || sc === 'people'; V.isSources = sc === 'sources'; V.isReports = sc === 'reports'
  const thRow = (t: { id: string; title: string; description: string; conviction: number }) => ({ name: t.title, desc: t.description, color: convColor(t.conviction), onClick: () => c.goThesis(t.id) })

  if (sc === 'thesis') {
    const pg: ThesisPageDTO | null = s.thesisPage
    const th0 = c.T(s.thesisId)
    if (!pg && !th0) { V.isThesis = false; V.thLoading = true; return }
    const th: ThesisDTO = pg?.thesis || th0!
    V.th = { ...th, name: th.title, desc: th.description, view: th.currentView, status: CONV_LABELS[th.conviction], updated: ago(th.updatedAt, s.now), created: longDate(th.createdAt), tags: '' }
    V.titleRef = c.ref('titleEl')
    V.crumbs = (pg?.crumbs || c.ancestors(th.id).map(a => ({ id: a.id, title: a.title }))).map(a => ({ name: a.title, onClick: () => c.goThesis(a.id) }))
    V.convDots = [1, 2, 3, 4, 5].map(n => ({ bg: n <= th.conviction ? convColor(th.conviction) : 'var(--w100)', onClick: async () => { if (n === th.conviction) return; if (await c.act('thesis.update', { id: th.id, patch: { conviction: n } })) { c.toast('Conviction set to ' + n + '/5 · logged in Evolution'); c.refreshAll(false) } } }))
    V.convLabel = CONV_LABELS[th.conviction]
    V.thEvCount = (pg?.supporting.length || 0) + (pg?.contradicting.length || 0)
    V.onThName = (e: Any) => { const v = e.target.value; c.setState((st: Any) => ({ thesisPage: st.thesisPage ? { ...st.thesisPage, thesis: { ...st.thesisPage.thesis, title: v } } : st.thesisPage, theses: st.theses.map((t: ThesisDTO) => (t.id === th.id ? { ...t, title: v } : t)) })); clearTimeout((c as Any).nameTimer); (c as Any).nameTimer = setTimeout(() => c.act('thesis.update', { id: th.id, patch: { title: v } }), 400) }
    V.thFromYou = fromYouV(c, 'thesis', th.id, th.title, pg?.fromYou)
    V.thRe = reprocessV(c, 'thesis', th.id, th.title)
    // matching against facts already stored (MATCH_THESIS): what it found, and a nudge when only a title is there
    const m = pg?.match
    V.thMatch = !m || m.state === 'none' ? '' : m.state === 'running' ? 'Matching this thesis against your library…'
      : `Found ${m.facts} related fact${m.facts === 1 ? '' : 's'} in ${m.documents} article${m.documents === 1 ? '' : 's'}${m.companies ? ` about ${m.companies} compan${m.companies === 1 ? 'y' : 'ies'}` : ''} — review them under Supporting and Contradicting`
    V.thNeedsDesc = !(th.description || '').trim()
    V.thSourceSugs = (pg?.suggestedSources || []).map(x => ({ label: x.label, onAdd: () => { c.openAddSource(false, x.locator); c.setState((st: Any) => ({ add: { ...st.add, theses: [th.id] } })) } }))
    V.onThDesc = (e: Any) => { const v = e.target.value; c.setState((st: Any) => ({ thesisPage: st.thesisPage ? { ...st.thesisPage, thesis: { ...st.thesisPage.thesis, description: v } } : st.thesisPage })); clearTimeout((c as Any).descTimer); (c as Any).descTimer = setTimeout(() => c.act('thesis.update', { id: th.id, patch: { description: v } }), 400) }
    V.onThView = async (e: Any) => { const v = e.currentTarget.innerText.trim(); if (v === (th.currentView || '').trim()) return; if (await c.act('thesis.update', { id: th.id, patch: { currentView: v } })) { c.toast('Current view revised · previous version kept in Evolution', 'See Evolution', () => c.setState({ thesisTab: 'evolution' })); c.refreshAll(false) } }
    V.thNoView = !th.currentView
    const pinned = c.pins('theses').includes(th.id)
    V.thPinLabel = pinned ? '◆ Pinned' : 'Pin'; V.thPinBg = pinned ? 'var(--w100)' : 'var(--w40)'
    V.thPin = () => c.pin('thesis', th.id, !pinned)
    V.thFollowLabel = th.watching ? '✓ Watching' : 'Watch'; V.thFollowBg = th.watching ? 'var(--w100)' : 'var(--w40)'
    V.thFollow = async () => { if (await c.act('thesis.update', { id: th.id, patch: { watching: !th.watching } })) { c.toast(th.watching ? 'New evidence for this thesis will no longer be highlighted' : 'Watching: matching evidence will appear in Today'); c.refreshAll(false) } }
    V.thInbox = () => c.go('inbox', { view: 'all', thesisFilter: th.id })
    V.thExport = (e: Any) => c.exportMenu(e, th.title, 'thesis', th.id)
    V.thCustomize = () => c.openCustomize('thesis', th.id, th.title)
    V.thNotify = () => c.openNotify({ type: 'thesis', id: th.id, name: th.title })
    V.thTabs = c.tabs([['overview', 'Overview'], ['evolution', 'Evolution']], s.thesisTab, v => { c.setState({ thesisTab: v }); if (v === 'evolution') c.act('thesis.evolution', { id: th.id }).then(evo => c.setState({ thesisEvo: evo })) })
    V.thOverview = s.thesisTab === 'overview'; V.thEvolution = s.thesisTab === 'evolution'
    if (s.thesisTab === 'evolution' && !s.thesisEvo) c.act('thesis.evolution', { id: th.id }).then(evo => c.setState({ thesisEvo: evo || [] }))
    V.supV = (pg?.supporting || []).map(e => evCard(c, e)); V.conV = (pg?.contradicting || []).map(e => evCard(c, e))
    V.supCount = V.supV.length; V.conCount = V.conV.length; V.thNoCon = !V.conV.length; V.thNoSup = !V.supV.length
    V.addEvidence = () => c.openPalette('', 'attach')
    V.thoughtsV = (pg?.thoughts || []).map(n => ({ text: n.text, date: ago(n.createdAt, s.now), type: KIND_TO_TYPE[n.kind] || 'Personal observation', notOrganized: n.aiState === 'failed', onRetry: async () => { if (await c.act('note.retry', { id: n.id })) c.toast('Organizing…') } }))
    V.thDraft = s.thDraft; V.onThDraft = (e: Any) => c.setState({ thDraft: e.target.value })
    V.onThDraftKey = async (e: Any) => { if (e.key === 'Enter' && s.thDraft.trim()) { const text = s.thDraft.trim(); const type = c.propose(text).type; c.setState({ thDraft: '' }); if (await c.act('note.create', { text, kind: TYPE_TO_KIND[type], thesisId: th.id, anchor: { type: 'thesis', id: th.id } })) { c.toast('Thought added'); c.refreshAll(false) } } }
    V.childrenV = (pg?.children || []).map(t => ({ name: t.title, desc: t.description || 'No description yet', count: t.evidenceCount, color: convColor(t.conviction), onClick: () => c.goThesis(t.id) }))
    V.childDraft = s.childDraft; V.onChildDraft = (e: Any) => c.setState({ childDraft: e.target.value })
    V.onChildKey = async (e: Any) => { if (e.key === 'Enter' && s.childDraft.trim()) { const name = s.childDraft.trim(); c.setState({ childDraft: '' }); const t = await c.act<ThesisDTO>('thesis.create', { parentId: th.id, title: name }); if (t) { c.toast('Created “' + name + '” under ' + th.title, 'Open', () => c.goThesis(t.id)); c.refreshAll(false) } } }
    V.changesV = (pg?.recentChanges || []).map(ch => ({ text: ch.text, date: shortDate(ch.date), color: stanceColor(ch.stance), label: ch.stance === 'contra' ? 'Challenges' : 'Supports', onClick: () => c.openItem(ch.itemId, ch.documentId) }))
    V.thNoChanges = !V.changesV.length
    V.thCos = (pg?.companies || []).map(co => ({ name: co.name, stage: co.stage, tile: col(hueOf(co.id)), initial: initialOf(co.name), last: co.lastTitle, onClick: () => c.goCompany(co.id) }))
    V.addCompany = (e: Any) => c.menuAt(e, [{ head: true, label: 'Add company to watch' }, ...(s.companies as CompanyListDTO[]).filter(co => !(pg?.companies || []).some(x => x.id === co.id)).map(co => ({ label: co.name, act: async () => { if (await c.act('thesis.addCompany', { id: th.id, companyId: co.id })) { c.toast(co.name + ' added to ' + th.title); c.refreshAll(false) } } }))])
    V.thFirms = (pg?.firms || []).map(f => ({ name: f.name, tile: col(hueOf(f.id)), onClick: () => c.goFirm(f.id) }))
    V.thQs = (pg?.questions || []).map(q => ({ text: q.text }))
    V.qDraft = s.qDraft; V.onQDraft = (e: Any) => c.setState({ qDraft: e.target.value })
    V.onQKey = async (e: Any) => { if (e.key === 'Enter' && s.qDraft.trim()) { const q = s.qDraft.trim(); c.setState({ qDraft: '' }); if (await c.act('note.create', { text: q, kind: 'question', thesisId: th.id, anchor: { type: 'thesis', id: th.id } })) c.refreshAll(false) } }
    const evo = (s.thesisEvo || []) as Any[]
    V.evoV = evo.map(m => ({ month: m.month, short: m.month.split(' ')[0].slice(0, 3) + ' ' + m.month.split(' ')[1], conv: m.conv, evCount: m.events.length, dots: [1, 2, 3, 4, 5].map(n => ({ bg: n <= m.conv ? convColor(m.conv) : 'var(--w80)' })), events: m.events.map((e: Any) => ({ ...e, isRev: !!e.before, color: ({ Created: 'var(--o8-08-255)', Evidence: 'var(--o78-12-155)', Revision: 'var(--o82-1-300)', Counterpoint: 'var(--o8-12-65)', Conviction: 'var(--o8-1-200)', 'Child thesis': 'var(--o78-06-255)' } as Any)[e.kind] || 'var(--ga0a0aa)' })) }))
    V.thNoEvo = !evo.length
    // view-definition layout (thesis Overview)
    const L = layout(pg?.main, pg?.rail)
    V.thL = {
      showView: !pg || L.has('current_view'), showCols: !pg || L.has('evidence_columns'), showThoughts: !pg || L.has('thoughts'), showChildren: !pg || L.has('thesis_children'),
      oView: L.order('current_view'), oCols: L.order('evidence_columns'), oThoughts: L.order('thoughts'), oChildren: L.order('thesis_children'),
      showChanges: !pg || L.has('rail:recent_changes'), showCos: !pg || L.has('rail:linked_objects:company'), showFirms: !pg || L.has('rail:linked_objects:firm'), showQs: !pg || L.has('rail:questions'),
      oChanges: L.order('rail:recent_changes'), oCos: L.order('rail:linked_objects:company'), oFirms: L.order('rail:linked_objects:firm'), oQs: L.order('rail:questions'),
      contraFirst: (pg?.main || []).find(x => x.component === 'evidence_columns')?.params?.order === 'contra_first'
    }
    V.thCustoms = customSections(c, pg?.main || [], 'thesis', th.id, th.title)
    V.thSuggestions = (pg?.newThesisSuggestions || []).map(x => x)
  }

  if (sc === 'theses') {
    const rows: Any[] = []
    const all = s.theses as ThesisDTO[]
    const walk = (pid: string | null, d: number) => all.filter(t => (t.parentId || null) === pid).forEach(t => {
      const kids = all.some(x => x.parentId === t.id), colp = !!s.treeCollapsed[t.id]
      const moveItems = c.thesisMenuItems(async to => { if (await c.act('thesis.move', { id: t.id, parentId: to })) { c.toast('Moved “' + t.title + '” under ' + c.path(to)); c.refreshAll(false) } }, t.parentId, [{ label: 'Top level', act: async () => { if (await c.act('thesis.move', { id: t.id, parentId: null })) c.refreshAll(false) } }]).filter((x: Any) => x.head || !x.label || !c.isDesc(all.find(y => y.title === x.label)?.id || '', t.id))
      rows.push({ name: t.title, pad: d * 20 + 'px', chev: kids ? (colp ? '▸' : '▾') : '', color: convColor(t.conviction), fresh: t.fresh ? t.fresh + ' new' : '', count: t.evidenceCount, updated: ago(t.updatedAt, s.now), dots: [1, 2, 3, 4, 5].map(n => ({ bg: n <= t.conviction ? convColor(t.conviction) : 'var(--w80)' })),
        id: t.id,
        draggable: true,
        onDragStart: (e: Any) => { c.drag = { key: 'tree', id: t.id }; try { e.dataTransfer.effectAllowed = 'move' } catch { /* noop */ } },
        onDragOver: (e: Any) => { e.preventDefault() },
        onDrop: async (e: Any) => { e.preventDefault(); const dd = c.drag; c.drag = null; if (!dd || dd.key !== 'tree' || dd.id === t.id) return; if (await c.act('thesis.move', { id: dd.id, parentId: t.id })) { c.toast('Moved under ' + t.title); c.refreshAll(false) } },
        onClick: () => c.goThesis(t.id), onChev: (e: Any) => { e.stopPropagation(); c.setState((st: Any) => ({ treeCollapsed: { ...st.treeCollapsed, [t.id]: !colp } })) },
        onCtx: (e: Any) => c.menuAt(e, [
          { label: 'Open', act: () => c.goThesis(t.id) },
          { label: c.pins('theses').includes(t.id) ? 'Unpin from sidebar' : 'Pin to sidebar', act: () => c.pin('thesis', t.id, !c.pins('theses').includes(t.id)) },
          { label: 'Create child thesis', act: () => c.openDescribeAdd('thesis', t.id) },
          { label: 'Filter inbox by this thesis', act: () => c.go('inbox', { view: 'all', thesisFilter: t.id }) },
          { div: true },
          { label: 'Move under…', act: () => setTimeout(() => c.menuAt({ clientX: e.clientX + 10, clientY: e.clientY, type: 'contextmenu' }, moveItems), 0) },
          { label: 'Merge into…', act: () => setTimeout(() => c.menuAt({ clientX: e.clientX + 10, clientY: e.clientY, type: 'contextmenu' }, c.thesisMenuItems(to => c.confirmMerge('thesis', t.id, t.title, to, c.T(to)?.title || ''), null).filter((x: Any) => x.head || x.label !== t.title)), 0) },
          { label: 'Archive', color: '#ff8a80', act: async () => { if (await c.act('thesis.archive', { id: t.id, archived: true })) { c.toast('Archived “' + t.title + '”', 'Undo', async () => { await c.act('thesis.archive', { id: t.id, archived: false }); c.refreshAll(false) }); c.refreshAll(false) } } }
        ]) })
      if (kids && !colp) walk(t.id, d + 1)
    })
    walk(null, 0); V.thesisRows = rows
    V.thesesEmpty = !rows.length
    V.thesisSuggestRows = ((s.thesisSuggestions || []) as Any[]).map(x => ({ title: x.title, why: x.explanation, onCreate: async () => { if (await c.act('suggestion.resolve', { id: x.id, accept: true })) { c.toast('Created “' + x.title + '”'); c.refreshAll(false) } }, onDismiss: async () => { if (await c.act('suggestion.resolve', { id: x.id, accept: false })) c.refreshAll(false) } }))
    if (!s.thesisSuggestionsLoaded) { c.setState({ thesisSuggestionsLoaded: true }); tryCall<Any>('object.list', { type: 'thesis', mode: 'all' }, null).then(r => r && c.setState({ thesisSuggestions: r.suggestions || [] })) }
  }

  if (sc === 'company') {
    const pg: CompanyPageDTO | null = s.companyPage
    if (!pg) { V.isCompany = false; return }
    const pinned = c.pins('companies').includes(pg.id)
    const lead = pg.funding[0]
    V.c = {
      ...pg, tile: col(hueOf(pg.id)), initial: initialOf(pg.name), tagline: pg.tagline || '',
      chipsV: chipsV(c, 'company', pg.id, pg.header),
      followLabel: pg.followed ? '✓ Following' : 'Follow', followBg: pg.followed ? 'var(--w60)' : 'oklch(0.6 0.15 258)', followColor: pg.followed ? 'var(--gd8d8de)' : '#fff', followBorder: pg.followed ? 'var(--w120)' : 'transparent',
      pinLabel: pinned ? '◆ Pinned' : 'Pin', lastRound: lead ? `${lead.round} · ${lead.amount} · ${lead.date}` : (pg.header.find(h => h.key === 'stage')?.value || '—'),
      onFollow: () => c.follow('company', pg.id, pg.name, pg.followed), onPin: () => c.pin('company', pg.id, !pinned),
      ...tierUi(c, 'company', pg),
      onCheck: async () => { c.toast('Checking ' + pg.name + '’s sources on this Mac…'); const r = await c.act<Any>('object.refresh', { type: 'company', id: pg.id }, 'Couldn’t check for updates'); if (r) { c.toast(r.message); if (r.offerAddWebsite) c.toast(r.message, 'Add website', () => c.openAddSource(false, r.offerAddWebsite)); c.refreshAll(false) } },
      onCustomize: () => c.openCustomize('company', pg.id, pg.name),
      onNotify: () => c.openNotify({ type: 'company', id: pg.id, name: pg.name })
    }
    V.coProposals = pg.proposals.map(p => ({ text: `New evidence says ${p.value} (${p.source}${p.date ? ', ' + shortDate(p.date) : ''}). You set ${p.current}.`, onKeep: async () => { if (await c.act('field.resolveProposal', { fvId: p.fvId, choice: 'keep' })) c.refreshAll(false) }, onUseNew: async () => { if (await c.act('field.resolveProposal', { fvId: p.fvId, choice: 'use_new' })) c.refreshAll(false) } }))
    V.coMerges = pg.mergeSuggestions.map(m => ({ text: `Possibly the same company as ${m.otherName}`, onMerge: () => c.confirmMerge('company', pg.id, pg.name, m.otherId, m.otherName), onNotSame: async () => { if (await c.act('suggestion.resolve', { id: m.id, accept: false })) c.refreshAll(false) } }))
    V.coReading = readingLine(pg.reading, pg.name)
    V.coFromYou = fromYouV(c, 'company', pg.id, pg.name, pg.fromYou)
    V.coLookup = lookupV(c, 'company', pg.id, pg.name, pg.lookup, pg.followed)
    V.coHint = hintV(c, 'company', pg.id, pg.name, pg.lookup)
    V.coRe = reprocessV(c, 'company', pg.id, pg.name, pg.reprocessed)
    V.coHasBanners = V.coProposals.length + V.coMerges.length > 0
    V.coCustoms = customSections(c, pg.main, 'company', pg.id, pg.name)
    V.coHasCustom = V.coCustoms.length > 0 && s.companyTab === 'Overview'
    V.coTabs = c.tabs(['Overview', 'Activity', ['Evidence', 'Evidence ' + pg.evidence.length], 'Theses', 'Investors', ['Notes', 'Notes ' + pg.notes.length]], s.companyTab, v => c.setState({ companyTab: v }))
    const tab = s.companyTab
    V.coShowOverview = tab === 'Overview'
    V.coShowActivity = tab === 'Overview' || tab === 'Activity'; V.coShowEvidence = tab === 'Evidence'; V.coShowTheses = tab === 'Theses'; V.coShowInvestors = tab === 'Investors'; V.coShowNotes = tab === 'Notes'
    const L = layout(pg.main, pg.rail)
    V.coL = {
      activity: tab !== 'Overview' || L.has('activity_timeline'), oActivity: tab === 'Overview' ? L.order('activity_timeline') : 0,
      funding: tab === 'Overview' && L.has('funding_table'), oFunding: L.order('funding_table'),
      railNotes: L.has('rail:notes'), oRailNotes: L.order('rail:notes'), railTheses: L.has('rail:linked_objects:thesis'), oRailTheses: L.order('rail:linked_objects:thesis'),
      railPeople: L.has('rail:people'), oRailPeople: L.order('rail:people'), railRound: L.has('rail:latest_round'), oRailRound: L.order('rail:latest_round')
    }
    const kinds = ['All', ...new Set(pg.activity.map(a => a.kind))]
    V.actFilters = kinds.length > 2 ? kinds.map(k => ({ label: k, bg: s.actFilter === k ? 'var(--w120)' : 'transparent', color: s.actFilter === k ? 'var(--gf0f0f3)' : 'var(--g8e8e98)', onClick: () => c.setState({ actFilter: k }) })) : []
    const actSection = pg.main.find(x => x.component === 'activity_timeline')
    const actKinds: string[] | undefined = tab === 'Overview' ? actSection?.params?.kinds : undefined
    V.activityV = pg.activity.filter(a => (s.actFilter === 'All' || a.kind === s.actFilter)).map(a => ({ ...a, date: shortDate(a.date), hasWhy: !!a.why, color: KIND_COLOR[a.kind] || 'var(--o78-08-255)', onClick: () => c.openItem(a.itemId, a.documentId) }))
    if (actKinds?.length) V.activityV = V.activityV.filter((a: Any) => actKinds.some(k => a.kinds?.includes?.(k)) || true)
    V.coNoActivity = !V.activityV.length
    V.coEvidence = pg.evidence.map(e => ({ text: e.assertion === 'attributed_opinion' && e.attributedTo ? `${e.attributedTo} argues: ${e.text}` : e.text, src: e.src, date: shortDate(e.date), color: stanceColor(e.stance), theses: e.theses.map(t => c.T(t)?.title).filter(Boolean).join(', '), onClick: () => c.openItem(e.itemId, e.documentId) }))
    V.coNoEvidence = !pg.evidence.length
    V.coTheses = pg.theses.map(thRow)
    V.coFunding = pg.funding; V.coHasFunding = pg.funding.length > 0
    V.coFounders = pg.founders.map(p => ({ name: p.name, role: p.role }))
    V.coInvestors = pg.investors.map(f => ({ name: f.name, tag: f.followed ? 'Following' : '', color: 'var(--ge8e8ec)', onClick: () => c.goFirm(f.id) }))
    V.coNotes = pg.notes.map(n => ({ text: n.text, date: ago(n.createdAt, s.now) })); V.coNotesTop = V.coNotes.slice(0, 3)
    V.coDraft = s.coDraft; V.onCoDraft = (e: Any) => c.setState({ coDraft: e.target.value })
    V.onCoKey = async (e: Any) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && s.coDraft.trim()) { e.preventDefault(); const text = s.coDraft.trim(); c.setState({ coDraft: '' }); if (await c.act('note.create', { text, anchor: { type: 'company', id: pg.id } })) { c.toast('Note saved on ' + pg.name); c.refreshAll(false) } } }
  }

  if (sc === 'firm') {
    const f: FirmPageDTO | null = s.firmPage
    if (!f) { V.isFirm = false; return }
    V.f = { ...f, tile: col(hueOf(f.id)), initial: initialOf(f.name), tagline: f.tagline || '', hq: f.hq || '', chipsV: chipsV(c, 'firm', f.id, f.header),
      followLabel: f.followed ? '✓ Following' : 'Follow', followBg: f.followed ? 'var(--w60)' : 'oklch(0.6 0.15 258)', followColor: f.followed ? 'var(--gd8d8de)' : '#fff', followBorder: f.followed ? 'var(--w120)' : 'transparent',
      onFollow: () => c.follow('firm', f.id, f.name, f.followed), ...tierUi(c, 'firm', f), watchDot: f.watching.enabled ? 'var(--o76-12-155)' : 'var(--g5c5c66)', watchLabel: f.watching.label,
      onCustomize: () => c.openCustomize('firm', f.id, f.name), onNotify: () => c.openNotify({ type: 'firm', id: f.id, name: f.name }) }
    V.goSources = () => c.go('sources', { expandedSrc: f.watching.sourceId, sourcesTab: 'subscribed', srcType: 'All' })
    V.fInvest = f.investments.map(i => ({ name: i.name, round: i.round, date: i.date, note: i.note, tile: col(hueOf(i.companyId)), initial: initialOf(i.name), tracked: i.followed ? 'Following' : '', onClick: () => c.goCompany(i.companyId) }))
    V.fNoInvest = !f.investments.length
    V.fWriting = f.writing.map(w => ({ title: w.title, date: shortDate(w.date), summary: w.summary, onClick: () => c.openItem(w.itemId, w.documentId) }))
    V.fNoWriting = !f.writing.length; V.fComm = f.commentary.map(x => ({ text: x.text, quote: x.quote, where: x.where, who: x.who, date: shortDate(x.date), onClick: () => c.openItem(null, x.documentId) })); V.fNoComm = !f.commentary.length
    V.fNotes = f.notes.map(n => ({ text: n.text, date: ago(n.createdAt, s.now) }))
    V.fPortfolio = f.portfolio.map(co => ({ name: co.name, stage: co.stage, tile: col(hueOf(co.id)), initial: initialOf(co.name), onClick: () => c.goCompany(co.id) }))
    V.fTheses = f.theses.map(thRow)
    V.fEvidence = f.evidence.map(e => ({ text: e.text, src: e.src, date: shortDate(e.date) }))
    V.fNoEvidence = !V.fEvidence.length
    V.fProposals = f.proposals.map(p => ({ text: `New evidence says ${p.value} (${p.source}${p.date ? ', ' + shortDate(p.date) : ''}). You set ${p.current}.`, onKeep: async () => { if (await c.act('field.resolveProposal', { fvId: p.fvId, choice: 'keep' })) c.refreshAll(false) }, onUseNew: async () => { if (await c.act('field.resolveProposal', { fvId: p.fvId, choice: 'use_new' })) c.refreshAll(false) } }))
    V.fReading = readingLine(f.reading, f.name)
    V.fFromYou = fromYouV(c, 'firm', f.id, f.name, f.fromYou)
    V.fLookup = lookupV(c, 'firm', f.id, f.name, f.lookup, f.followed)
    V.fHint = hintV(c, 'firm', f.id, f.name, f.lookup)
    V.fRe = reprocessV(c, 'firm', f.id, f.name, f.reprocessed)
    V.fMerges = f.mergeSuggestions.map(m => ({ text: `Possibly the same firm as ${m.otherName}`, onMerge: () => c.confirmMerge('firm', f.id, f.name, m.otherId, m.otherName), onNotSame: async () => { if (await c.act('suggestion.resolve', { id: m.id, accept: false })) c.refreshAll(false) } }))
    const L = layout(f.main, f.rail)
    V.fL = { invest: L.has('investments'), oInvest: L.order('investments'), writing: L.has('writing'), oWriting: L.order('writing'), comm: L.has('commentary'), oComm: L.order('commentary'),
      railNotes: L.has('rail:notes'), oRailNotes: L.order('rail:notes'), railPortfolio: L.has('rail:portfolio'), oRailPortfolio: L.order('rail:portfolio'), railTheses: L.has('rail:linked_objects:thesis'), oRailTheses: L.order('rail:linked_objects:thesis'), railEvidence: L.has('rail:evidence_list:kept'), oRailEvidence: L.order('rail:evidence_list:kept'),
      evidenceMain: L.has('evidence_list'), oEvidenceMain: L.order('evidence_list') }
    V.fCustoms = customSections(c, f.main, 'firm', f.id, f.name)
    V.coDraft = s.coDraft; V.onCoDraft = (e: Any) => c.setState({ coDraft: e.target.value })
    V.onFirmKey = async (e: Any) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && s.coDraft.trim()) { e.preventDefault(); const text = s.coDraft.trim(); c.setState({ coDraft: '' }); if (await c.act('note.create', { text, anchor: { type: 'firm', id: f.id } })) { c.toast('Note saved on ' + f.name); c.refreshAll(false) } } }
  }

  if (sc === 'people') {
    V.listTitle = 'People'; V.listSub = 'Founders, executives and investors whose interviews, posts and moves you want to see.'
    V.listSegs = c.seg([['following', 'Following'], ['all', 'All tracked']], s.listMode, v => c.setState({ listMode: v }))
    V.entityRows = (s.people as PersonListDTO[]).filter(p => s.listMode === 'all' || p.followed).map(p => ({ name: p.name, tagline: [p.role, p.orgName].filter(Boolean).join(' · '), stage: p.orgName, tile: col(hueOf(p.id)), initial: p.name.split(' ').map(w => w[0]).join('').slice(0, 2), radius: '50%', last: p.lastTitle || '—', lastDate: shortDate(p.lastDate), followLabel: p.followed ? 'Following' : 'Follow', followBg: p.followed ? 'transparent' : 'oklch(0.6 0.15 258)', followColor: p.followed ? 'var(--ga6a6b0)' : '#fff',
      onFollow: (e: Any) => { e.stopPropagation(); c.follow('person', p.id, p.name, p.followed) }, onClick: () => c.goPerson(p),
      // people have no page of their own: Describe, Re-process and Pull latest sit on their row (DEC-096, DEC-099)
      onDescribe: (e: Any) => { e.stopPropagation(); c.openDescribeEdit('person', p.id, p.name) },
      onReprocess: (e: Any) => { e.stopPropagation(); reprocessV(c, 'person', p.id, p.name).onReprocess() },
      onPull: p.followed ? null : async (e: Any) => { e.stopPropagation(); const r: Any = await c.act('object.pullLatest', { type: 'person', id: p.id }, 'Couldn’t pull the latest'); if (r) c.toast(r.message + ' Follow to keep it current.') } }))
    V.listEmptyText = s.listMode === 'following' ? 'Follow a person from any company or firm page.' : 'No people tracked yet.'
  }

  if (V.isEntityList && sc !== 'people') {
    const isCo = sc === 'companies'
    const list = ((isCo ? s.companies : s.firms) as (CompanyListDTO | FirmListDTO)[]).filter(x => s.listMode === 'all' || x.followed)
    V.listTitle = isCo ? 'Companies' : 'Venture Firms'
    V.listSub = isCo ? 'Companies you follow feed Today. Unfollow anything that stops being useful.' : 'What these firms invest in, write and say, filtered to what you care about.'
    V.listSegs = c.seg([['following', 'Following'], ['all', 'All tracked']], s.listMode, v => c.setState({ listMode: v }))
    V.entityRows = list.map(x => ({ name: x.name, tagline: x.tagline, stage: isCo ? (x as CompanyListDTO).stage : x.hq, tile: col(hueOf(x.id)), initial: initialOf(x.name), radius: isCo ? '7px' : '50%', last: x.lastTitle || '—', lastDate: shortDate(x.lastDate), followLabel: x.followed ? 'Following' : 'Follow', followBg: x.followed ? 'transparent' : 'oklch(0.6 0.15 258)', followColor: x.followed ? 'var(--ga6a6b0)' : '#fff',
      onFollow: (e: Any) => { e.stopPropagation(); c.follow(isCo ? 'company' : 'firm', x.id, x.name, x.followed) }, onClick: () => (isCo ? c.goCompany(x.id) : c.goFirm(x.id)) }))
    V.listEmptyText = isCo ? 'Follow a company from ⌘K or any article.' : 'Follow a venture firm from ⌘K or any article.'
  }
  if (V.isEntityList) V.entityEmpty = !V.entityRows.length

  if (sc === 'sources') rvSources(c, V)
  if (sc === 'reports') rvReports(c, V)
}

/** Quiet "still reading" line for a followed/added company or firm whose coverage is being fetched or read. */
// ---------------------------------------------------------------- the user's layer (DEC-099)
type Det = { about: string; website: string | null; otherNames: string[]; fields: Record<string, string>; fieldSet: { key: string; label: string }[] }
/** "From you": what the user says about an object, saved through object.describe (history + Undo); a change to what the
 *  lookup reads (website, what it does, other names) re-runs it. */
export function fromYouV(c: Controller, type: 'company' | 'firm' | 'person' | 'thesis' | 'source', id: string, name: string, d: Det | undefined) {
  if (!d) return null
  // a thesis's description is edited in place on its page; here only what would prove or disprove it
  const base: Any[] = type === 'thesis' ? []
    : type === 'person' ? [{ key: 'about', label: 'Who they are', long: true }]
    : type === 'source' ? [{ key: 'about', label: 'What you want from it', long: true }]
    : [{ key: 'website', label: 'Website', placeholder: 'e.g. cua.ai' },
       { key: 'about', label: type === 'firm' ? 'What it invests in' : 'What it does', long: true, placeholder: 'A few words — the news search and the lookup use them' },
       { key: 'otherNames', label: 'Other names', placeholder: 'Comma-separated' }]
  const value = (k: string) => k === 'website' ? d.website || '' : k === 'about' ? d.about : k === 'otherNames' ? d.otherNames.join(', ') : d.fields[k.slice(2)] || ''
  const fields = [...base, ...d.fieldSet.map(f => ({ key: 'f.' + f.key, label: f.label, long: f.key === 'proof' || f.key === 'howKnown' }))].map(f => ({ ...f, value: value(f.key) }))
  const lookup = type === 'thesis' ? 'matched against your library again' : type === 'source' ? '' : `looked up again`
  return {
    fields,
    emptyText: type === 'thesis' ? 'Say what this thesis claims and what would prove or disprove it — matching uses your words.'
      : type === 'source' ? 'Say what you want from this source.' : `Add what you know — its website, what it does, other names. The lookup and the news search use it.`,
    saveHint: lookup ? `Saving re-runs the agent's work: ${name} is ${lookup}.` : '',
    onSave: async (vals: Record<string, string>) => {
      const patch: Any = { fields: {} }
      for (const [k, v] of Object.entries(vals)) {
        if (k === 'website') patch.website = v.trim() || null
        else if (k === 'about') patch.about = v
        else if (k === 'otherNames') patch.otherNames = v.split(',').map(x => x.trim()).filter(Boolean)
        else if (k.startsWith('f.')) patch.fields[k.slice(2)] = v
      }
      const r: Any = await c.act('object.describe', { type, id, patch }, 'Couldn’t save your description')
      if (!r) return false
      const msg = r.result?.rerunJobId ? `Saved — ${name} is being ${lookup || 'updated'} with your details` : 'Saved'
      c.toast(msg, 'Undo', async () => { if (await c.act('ontology.undo', { historyIds: r.undo.historyIds })) { c.toast('Undone'); c.refreshAll(false) } })
      c.refreshAll(false)
      return true
    }
  }
}

type Look = { state: string; articles: number; website: string | null; watchQuery: string | null; watchSourceId: string | null; needsHint: boolean; renamedFrom: string | null }
/** What the lookup found and the search that keeps watching — said on the page instead of an empty layout. */
export function lookupV(c: Controller, type: 'company' | 'firm' | 'person', id: string, name: string, l: Look | undefined, followed: boolean) {
  if (!l || l.state === 'none') return null
  // while it runs, the "Reading N articles… / Looking for coverage…" line already says so: one status line, not two
  if (l.state === 'running') return null
  const parts: string[] = [`${l.articles} article${l.articles === 1 ? '' : 's'}`]
  if (l.website) parts.push(`site ${l.website}`)
  if (l.renamedFrom) parts.push(`named from its site (you typed “${l.renamedFrom}”)`)
  return {
    text: parts.join(' · '), watchQuery: followed ? l.watchQuery : null,
    onSaveQuery: async (q: string) => { const r = await c.act('object.watch', { type, id, query: q }, 'Couldn’t change the search'); if (r) { c.toast('Watching with the new search'); c.refreshAll(false); return true } return false }
  }
}
/** Nothing found to go on: one hint (website or a few words) and the lookup runs again with it. */
export function hintV(c: Controller, type: 'company' | 'firm', id: string, name: string, l: Look | undefined) {
  if (!l?.needsHint) return null
  return {
    text: `Nothing found for ${name} yet. Add its website or a few words on what it does, and I'll look again.`,
    onLookAgain: async (website: string, about: string) => {
      const r: Any = await c.act('object.describe', { type, id, patch: { ...(website ? { website } : {}), ...(about ? { about } : {}) } }, 'Couldn’t look again')
      if (r) { c.toast(`Looking for ${name} again with your hint`); c.refreshAll(false) }
      return !!r
    }
  }
}

/** Re-process (DEC-099): the confirm shows what it will do ("re-reads 38 articles"); the page then says what changed. */
export function reprocessV(c: Controller, type: 'company' | 'firm' | 'person' | 'thesis' | 'source' | 'document', id: string, name: string, ch?: { pending: number; added: number; removed: { title: string }[]; website: string | null } | null) {
  const onReprocess = async () => {
    const plan: Any = await c.act('object.reprocessPlan', { type, id }, 'Couldn’t plan the re-process')
    if (!plan) return
    c.toast(plan.text, 'Re-process', async () => { if (await c.act('object.reprocess', { type, id }, 'Couldn’t re-process')) { c.toast(`Re-processing ${name}…`); c.refreshAll(false) } })
  }
  if (!ch) return { onReprocess, text: '', onKeep: null }
  const parts = ch.pending ? [`Re-processing ${name}: ${ch.pending} article${ch.pending === 1 ? '' : 's'} left to re-read`]
    : [`Re-processed ${name}`, ch.added ? `+${ch.added} article${ch.added === 1 ? '' : 's'}` : '', ch.removed.length ? `${ch.removed.length} link${ch.removed.length === 1 ? '' : 's'} removed` : '', ch.website ? `website ${ch.website}` : ''].filter(Boolean)
  if (!ch.pending && parts.length === 1) parts.push('no changes')
  return {
    onReprocess, text: parts.join(' · '),
    onKeep: !ch.pending && ch.removed.length && (type === 'company' || type === 'firm' || type === 'person')
      ? async () => { const r: Any = await c.act('object.reprocessKeep', { type, id }); if (r) { c.toast(`Kept ${r.kept} link${r.kept === 1 ? '' : 's'}`); c.refreshAll(false) } } : null
  }
}

function readingLine(r: { pending: number; etaMin: number; searching: boolean } | null | undefined, name: string): string {
  if (!r) return ''
  if (r.pending > 0) return `Reading ${r.pending} article${r.pending === 1 ? '' : 's'} about ${name}… (about ${r.etaMin} min)`
  return r.searching ? `Looking for coverage of ${name}…` : ''
}

function customSections(c: Controller, main: SectionDTO[], objectType: 'company' | 'firm' | 'thesis', objectId: string, name: string) {
  return main.map((sec, i) => ({ sec, i })).filter(({ sec }) => sec.custom).map(({ sec, i }) => ({
    instr: sec.instruction || '', title: sec.title || sectionTitle(sec), order: i,
    // a tracked field placed in a section opens the same source popover as its header chip (UI-VIEW-03)
    rows: ((sec.data?.rows || []) as { label: string; value: string }[]).map((r, k) => {
      const ch = sec.component === 'field_table' && objectType !== 'thesis' ? (sec.data?.items || [])[k] as FieldChipDTO | undefined : undefined
      return ch?.value ? { ...r, title: ch.label + (ch.provenance ? ' · ' + ch.provenance : ''), onClick: (e: Any) => openFieldPopover(c, e, objectType, objectId, ch) } : r
    }),
    empty: !(sec.data?.rows || []).length, emptyText: sec.data?.emptyText || 'Nothing captured yet. I’ll add it here when it appears.', label: sec.data?.label || '',
    onEdit: () => c.openCustomize(objectType, objectId, name)
  }))
}
function sectionTitle(s: SectionDTO): string {
  return ({ funding_table: 'Funding', related_companies: 'Competitors you track', people: 'People', field_table: 'Tracked for you', summary: 'Summary', evidence_list: 'Evidence', activity_timeline: 'Activity', investors: 'Investors', latest_round: 'Latest round' } as Any)[s.component] || 'Your layout'
}

function rvSources(c: Controller, V: Any) {
  const s = c.state
  const subs = (s.sources as SourceDTO[])
  V.srcSub = `You decide what enters your library. ${subs.filter(x => x.enabled && !x.muted).length} active · ${subs.filter(x => x.muted || !x.enabled).length} paused or muted.`
  V.srcTabs = c.tabs([['subscribed', 'Subscribed ' + subs.length], ['suggested', 'Suggested ' + (s.suggested || []).length], ['history', 'On-demand history']], s.sourcesTab, v => c.setState({ sourcesTab: v }, () => c.refreshScreen()))
  V.srcSubscribed = s.sourcesTab === 'subscribed'; V.srcSuggested = s.sourcesTab === 'suggested'; V.srcHistory = s.sourcesTab === 'history'
  const attention = (x: SourceDTO) => x.health !== 'ok' || ['expired', 'login_required', 'blocked'].includes(x.authState)
  const types = ['All', ...new Set(subs.map(x => x.typeLabel)), ...(subs.some(attention) ? ['Needs attention'] : [])]
  V.srcTypes = types.map(t => ({ label: t, bg: s.srcType === t ? 'var(--w120)' : 'var(--w30)', color: s.srcType === t ? 'var(--gf0f0f3)' : 'var(--g9a9aa4)', onClick: () => c.setState({ srcType: t }) }))
  V.srcEmpty = !subs.length
  V.srcRows = subs.filter(x => s.srcType === 'All' || x.typeLabel === s.srcType || (s.srcType === 'Needs attention' && attention(x))).map(x => {
    const ex = s.expandedSrc === x.id
    const set = async (patch: Any) => { c.setState((st: Any) => ({ sources: st.sources.map((y: SourceDTO) => (y.id === x.id ? { ...y, ...patch } : y)) })); await c.act('source.update', { id: x.id, patch }); c.refreshAll(false) }
    const pinT = c.pins('theses')
    const instrShort = x.mode === 'all' ? 'All updates' : x.mode === 'relevant' ? 'Only items relevant to my theses' : (x.instruction || 'Custom instruction')
    return {
      ...x, instr: x.mode === 'custom' ? x.instruction : instrShort, type: x.typeLabel, handle: x.locator.replace(/^https?:\/\//, ''), freq: FREQ_LABEL[x.freq], priority: PRIO_LABEL[x.priority],
      ...c.tg(x.enabled), tile: col(hueOf(x.id)), initial: initialOf(x.name), expanded: ex, chev: ex ? '▾' : '▸', rowBg: ex ? 'var(--w25)' : 'transparent', op: x.enabled && !x.muted ? 1 : 0.55,
      mutedLabel: x.label, hasError: !!x.lastError && x.health !== 'ok', errorLine: x.lastError || '', last: x.lastSuccessAt ? ago(x.lastSuccessAt, s.now) : x.lastAttemptAt ? 'tried ' + ago(x.lastAttemptAt, s.now) : 'not checked yet',
      checkedLine: (x.siteDomain || x.locator.replace(/^https?:\/\//, '').split('/')[0]) + ' · checked on this Mac',
      onExpand: () => c.setState({ expandedSrc: ex ? null : x.id }),
      onToggle: async (e: Any) => { e.stopPropagation(); if (await c.act('source.setEnabled', { id: x.id, enabled: !x.enabled })) { c.toast(x.enabled ? 'Paused ' + x.name : 'Resumed ' + x.name); c.refreshAll(false) } },
      onInstr: (e: Any) => { const v = e.target.value; c.setState((st: Any) => ({ sources: st.sources.map((y: SourceDTO) => (y.id === x.id ? { ...y, instruction: v, mode: 'custom' } : y)) })); clearTimeout((c as Any)['instr' + x.id]); (c as Any)['instr' + x.id] = setTimeout(() => c.act('source.update', { id: x.id, patch: { instruction: v, mode: 'custom' } }), 600) },
      modeSegs: c.seg([['all', 'Everything'], ['relevant', 'My theses'], ['custom', 'Custom']], x.mode, v => set({ mode: v })),
      freqSegs: c.seg(['Real-time', 'Hourly', 'Daily', 'Weekly'], FREQ_LABEL[x.freq], v => set({ freq: LABEL_FREQ[v] })),
      prioSegs: c.seg(['Low', 'Normal', 'High'], PRIO_LABEL[x.priority], v => set({ priority: v.toLowerCase() })),
      thChips: [...x.thesisIds.map(id => ({ id, on: true })), ...pinT.filter(id => !x.thesisIds.includes(id)).map(id => ({ id, on: false }))].filter(({ id }) => c.T(id)).map(({ id, on }) => ({ label: (on ? '◆ ' : '+ ') + c.T(id)!.title, bg: on ? 'oklch(0.62 0.15 258 / 0.2)' : 'var(--w40)', color: on ? 'var(--o86-08-258)' : 'var(--g8e8e98)', onClick: () => set({ thesisIds: on ? x.thesisIds.filter(t => t !== id) : [...x.thesisIds, id] }) })),
      recent: x.recent.slice(0, 5).map(i => ({ title: i.title, time: ago(i.at, s.now), onClick: () => c.openItem(i.itemId, i.documentId) })),
      noRecent: !x.recent.length,
      muteLabel: x.muted ? 'Unmute' : 'Mute for a week', onMute: () => c.muteSource(x.id, !x.muted),
      onBackfill: (e: Any) => c.menuAt(e, [{ head: true, label: 'Load older posts from' }, ...([7, 30, 90] as const).map(days => ({ label: `Last ${days} days`, act: async () => { if (await c.act('source.backfill', { id: x.id, days })) c.toast(`Loading ${x.name}’s posts from the last ${days} days on this Mac…`) } }))]),
      // say it at once; the result toast replaces it (a fast sync finishes before the call even returns)
      onSync: async () => { c.toast('Checking ' + x.name + ' on this Mac…'); await c.act('source.syncNow', { id: x.id }) },
      onReset: () => c.setState({ modal: 'reset', resetSrc: x }),
      onReprocess: () => reprocessV(c, 'source', x.id, x.name).onReprocess(),
      onRemove: async () => { if (await c.act('source.remove', { id: x.id })) { c.toast('Removed ' + x.name, 'Undo', async () => { await c.act('source.restore', { id: x.id }); c.refreshAll(false) }); c.refreshAll(false) } },
      showSignIn: x.authStrategy === 'app_browser_session' && ['login_required', 'expired', 'blocked'].includes(x.authState), signInLabel: x.authState === 'expired' ? 'Sign in again' : 'Sign in',
      onSignIn: () => c.signIn(x.id),
      showRetry: x.health !== 'ok', onRetry: async () => { if (await c.act('source.retry', { id: x.id })) c.toast('Retrying ' + x.name + '…') }
    }
  })
  V.sugRows = ((s.suggested || []) as Any[]).map(x => ({ ...x, type: x.typeLabel, tile: col(hueOf(x.id)), initial: initialOf(x.name), desc: x.reason, group: x.group,
    onAdd: async () => { const r = await c.act<SourceDTO>('source.create', { locator: x.locator, name: x.name, mode: x.mode || 'custom', instruction: x.instruction || '', freq: x.freq || 'daily', origin: x.origin || 'starter_pack', thesisIds: [] }); if (r) { c.toast('Subscribed to ' + x.name); c.refreshAll(false) } },
    onDismiss: async () => { if (await c.act('source.dismissSuggestion', { id: x.id })) c.refreshAll(false) } }))
  V.sugEmpty = !V.sugRows.length
  V.histRows = ((s.history || []) as Any[]).map(h => ({ ...h, date: shortDate(h.date), hasSignIn: !!h.signInDomain, onSignIn: async (e: Any) => { e.stopPropagation(); await c.act('source.signIn', { id: 'site:' + h.signInDomain }) }, onRetry: h.retryable ? async (e: Any) => { e.stopPropagation(); const r = await c.act<Any>('ingress.addUrl', { url: h.url }); if (r) { c.toast(r.pending ? r.message : 'Added to Today'); c.refreshAll(false) } } : null, hasRetry: !!h.retryable }))
  V.histEmpty = !V.histRows.length
}

/** Last send of a briefing: "Sent Thu 7:30", "Nothing new · no email sent", a delivery error, or not yet. */
function briefingLast(b: BriefingDTO): string {
  const r = b.lastRun
  if (!r) return 'Not sent yet'
  if (r.status === 'running') return 'Sending…'
  if (r.status === 'failed') return 'Couldn’t build it · Send now to retry'
  if (r.emailedAt) { const d = new Date(r.emailedAt); return 'Sent ' + d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
  if (r.deliveryError) return r.deliveryError === 'Nothing new · no email sent' ? r.deliveryError : 'Not sent · ' + r.deliveryError
  return 'Sending…'
}

function rvReports(c: Controller, V: Any) {
  const s = c.state
  const reports = s.reports as ReportDTO[]
  const sel = reports.find(r => r.id === s.repSel) || reports[0]
  V.repRef = c.ref('repEl'); V.repDraft = s.repDraft
  V.onRepDraft = (e: Any) => c.setState({ repDraft: e.target.value })
  V.onRepKey = (e: Any) => { if (e.key === 'Enter') { e.preventDefault(); c.createReport() } }
  V.onRepCreate = () => c.createReport(); V.repBtnBg = s.repDraft.trim() ? 'oklch(0.6 0.15 258)' : 'var(--w160)'
  V.repRows = reports.map(r => ({
    ...r, schedule: r.status === 'draft' ? 'Setting up…' : r.status === 'failed' ? 'Couldn’t set this up' : r.scheduleLabel, last: r.lastRunAt ? ago(r.lastRunAt, s.now) : 'never',
    ...c.tg(r.enabled && r.status === 'active'), channelsLabel: r.briefings.length ? 'Emailed in ' + r.briefings.map(b => '“' + b.name + '”' + (b.enabled ? '' : ' (off)')).join(', ') : 'In the app', bg: sel && r.id === sel.id ? 'var(--w60)' : 'transparent',
    failed: r.status === 'failed', draft: r.status === 'draft',
    onRetry: async (e: Any) => { e.stopPropagation(); if (await c.act('report.retry', { id: r.id })) c.refreshScreen() },
    onEditText: (e: Any) => { e.stopPropagation(); c.setState({ repDraft: r.promptText || '' }); c.act('report.delete', { id: r.id }).then(() => c.refreshScreen()); c.focusNext = 'repEl' },
    onClick: () => { c.setState({ repSel: r.id, refineDraft: r.pendingRefinement || '' }); c.loadPreview(r.id) },
    onCtx: (e: Any) => c.menuAt(e, [
      { label: 'Rename…', act: () => c.setState({ modal: 'rename', renameRep: { id: r.id, name: r.name } }) },
      { label: 'Briefings ▸', act: () => setTimeout(() => c.briefingMenu({ clientX: e.clientX + 10, clientY: e.clientY, type: 'contextmenu' }, r.id), 0) },
      { label: 'Delete', color: '#ff8a80', act: async () => { if (await c.act('report.delete', { id: r.id })) { c.toast('Deleted ' + r.name, 'Undo', async () => { await c.act('report.restore', { id: r.id }); c.refreshScreen() }); c.refreshScreen() } } }
    ]),
    onToggle: async (e: Any) => { e.stopPropagation(); if (r.status !== 'active') return; if (await c.act('report.setEnabled', { id: r.id, enabled: !r.enabled })) { c.toast(r.enabled ? 'Paused ' + r.name : 'Resumed ' + r.name); c.refreshScreen() } }
  }))
  V.repEmpty = !reports.length
  // Briefings (DEC-091): one email built from tagged reports
  const briefings = (s.briefings || []) as BriefingDTO[]
  const emailMissing = reports.length ? reports[0].emailNotSetUp : false
  V.brRows = briefings.map(b => ({
    id: b.id, name: b.name, scheduleText: b.enabled ? b.scheduleText : b.scheduleText + ' · Paused', reports: b.reports.map(r => r.name),
    // the Email switch (DEC-100): on = it sends on its schedule; off = nothing is emailed (Send now still works)
    emailOn: b.enabled && !emailMissing, emailDisabled: emailMissing, emailHint: emailMissing ? 'Set up email in Settings first' : b.enabled ? 'Email on' : 'Email off',
    ...c.tg(b.enabled && !emailMissing),
    onEmail: async () => {
      if (emailMissing) { c.toast('Set up email in Settings first', 'Settings', () => c.openSettings('Email')); return }
      if (await c.act('briefing.update', { id: b.id, patch: { enabled: !b.enabled } })) {
        c.toast((b.enabled ? 'Email off for ' : 'Email on for ') + b.name, 'Undo', async () => { if (await c.act('briefing.update', { id: b.id, patch: { enabled: b.enabled } })) c.refreshScreen() })
        c.refreshScreen()
      }
    },
    last: briefingLast(b), lastWarn: !!b.lastRun?.deliveryError && b.lastRun.deliveryError !== 'Nothing new · no email sent', op: b.enabled ? 1 : 0.6,
    onSend: () => c.sendBriefing(b), onEdit: () => c.openBriefingSheet(b),
    onMore: (e: Any) => c.menuAt(e, [
      { label: 'Send now', act: () => c.sendBriefing(b) },
      { label: 'Edit…', act: () => c.openBriefingSheet(b) },
      { label: b.enabled ? 'Pause (email off)' : 'Resume (email on)', act: async () => { if (await c.act('briefing.update', { id: b.id, patch: { enabled: !b.enabled } })) { c.toast((b.enabled ? 'Paused ' : 'Resumed ') + b.name); c.refreshScreen() } } },
      { div: true },
      { label: 'Delete', color: '#ff8a80', act: () => c.deleteBriefing(b) }
    ])
  }))
  V.brEmpty = !briefings.length
  V.brCanCreate = reports.length > 0
  V.onNewBriefing = () => (reports.length ? c.openBriefingSheet(null, sel ? [sel.id] : []) : c.toast('Create a report first. A briefing emails one or more reports together.'))
  V.alertRows = (s.alerts as AlertDTO[]).map(a => ({
    ...a, ...c.tg(a.enabled && a.status === 'active'), op: a.enabled && a.status === 'active' ? 1 : 0.6, channelsLabel: a.status === 'compiled' ? 'Needs confirmation' : a.status === 'draft' ? 'Setting up…' : a.status === 'failed' ? 'Couldn’t set this up' : a.channels.map(x => (x === 'in_app' ? 'In-app' : 'Email')).join(', '),
    onClick: () => c.openNotifyForAlert(a.id),
    onToggle: async (e: Any) => { e && e.stopPropagation && e.stopPropagation(); if (a.status !== 'active') return c.openNotifyForAlert(a.id); if (await c.act('alert.setEnabled', { id: a.id, enabled: !a.enabled })) c.refreshScreen() },
    onCtx: (e: Any) => c.menuAt(e, [
      { label: 'Edit…', act: () => c.openNotifyForAlert(a.id) },
      { label: 'Delete', color: '#ff8a80', act: async () => { if (await c.act('alert.delete', { id: a.id })) { c.toast('Deleted alert'); c.refreshScreen() } } }
    ])
  }))
  V.onNewAlert = () => c.openNotify(null)
  if (!sel) { V.pvOn = false; return }
  V.pvOn = true
  const run = s.preview?.[sel.id]
  const runs = (s.runs?.[sel.id] || []) as Any[]
  const content = run?.content
  V.pv = {
    name: sel.name, view: run?.view || null, meta: (sel.status === 'active' ? sel.scheduleLabel : sel.status === 'draft' ? 'Setting up…' : 'Couldn’t set this up') + ' · ' + (sel.briefings.length ? 'Emailed in ' + sel.briefings.map(b => '“' + b.name + '”').join(', ') : 'In the app') + ' · last run ' + (sel.lastRunAt ? ago(sel.lastRunAt, s.now) : 'never'),
    sections: (content?.sections || []).map((sec: Any) => ({ title: sec.title, empty: !sec.rows?.length && !sec.bullets?.length, rows: !sec.rows?.length && !sec.bullets?.length ? [{ text: 'Nothing new.', meta: '', onClick: () => {} }] : [...(sec.bullets || []).map((b: Any) => ({ text: b.text, meta: 'AI summary', onClick: () => {} })), ...(sec.rows || []).map((row: Any) => ({ text: row.text, meta: [row.removed ? 'Source removed' : row.source, row.date ? shortDate(row.date) : ''].filter(Boolean).join(' · '), onClick: () => (row.ref?.type === 'company' ? c.goCompany(row.ref.id) : row.ref?.type === 'thesis' ? c.goThesis(row.ref.id) : row.ref?.type === 'firm' ? c.goFirm(row.ref.id) : c.openItem(row.itemId || null, row.documentId)) }))] })),
    loading: sel.status === 'draft' || (!run && sel.status === 'active'), draft: sel.status === 'draft', failed: sel.status === 'failed', error: sel.lastError || '', canRefine: sel.status === 'active',
    onRun: async () => { const r = await c.act<Any>('report.runNow', { id: sel.id }); if (r) { c.toast('Running ' + sel.name + ' on this Mac…') } },
    onExport: (e: Any) => c.exportMenu(e, sel.name, 'report', sel.id),
    onRuns: (e: Any) => c.menuAt(e, [{ head: true, label: 'Past runs' }, ...(runs.length ? runs.map(r => ({ label: longDate(r.startedAt) + ' ' + new Date(r.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + (r.late ? ' (delayed)' : '') + (r.status === 'failed' ? ' · failed' : ''), act: async () => { const full = await c.act<Any>('report.run', { runId: r.id }); c.setState((st: Any) => ({ preview: { ...st.preview, [sel.id]: full || r } })) } })) : [{ label: 'No runs yet', color: 'var(--g8e8e98)' }])]),
    refineDraft: s.refineDraft ?? '', refineFailed: sel.refineFailed, refineBusy: !!sel.pendingRefinement && !sel.refineFailed,
    onRefineDraft: (e: Any) => c.setState({ refineDraft: e.target.value }),
    onRefineKey: async (e: Any) => { if (e.key === 'Enter' && (s.refineDraft || '').trim()) { e.preventDefault(); const t = s.refineDraft.trim(); if (await c.act('report.refine', { id: sel.id, text: t })) { c.setState({ refineDraft: '' }); c.refreshScreen() } } },
    onRefineRetry: async () => { if (await c.act('report.retry', { id: sel.id })) c.refreshScreen() },
    // Refine is the primary control (Backlog "Clearer report editing"): examples fill the box; the last change has Undo
    examples: ['weekly on Fridays at 8am', 'add Series A deals as a table', 'only my fintech thesis', 'shorter'].map(x => ({ label: x, onClick: () => { c.setState({ refineDraft: x }); c.focusNext = 'refineEl' } })),
    refineRef: c.ref('refineEl'),
    lastChange: sel.lastChange ? `Last change: ${sel.lastChange.summary}` : '',
    onUndo: async () => { if (await c.act('report.undo', { id: sel.id })) { c.toast('Undone'); c.refreshScreen(); c.loadPreview(sel.id) } },
    // the settings strip: the same definition the AI edits
    strip: stripV(c, sel),
    onExpand: () => c.setState({ reportFull: sel.id }),
    full: s.reportFull === sel.id,
    onCloseFull: () => c.setState({ reportFull: null })
  }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Schedule · layout · sections, editable in place (report.patch); Undo through the same history as Refine. */
function stripV(c: Controller, r: Any) {
  const d = r.definition
  if (!d || r.status !== 'active') return null
  const patch = async (p: Any) => { if (await c.act('report.patch', { id: r.id, patch: p }, 'Couldn’t change the report')) { c.refreshScreen(); c.loadPreview(r.id) } }
  const sc = d.schedule || { kind: 'none' }
  const secs = (d.sections || []) as Any[]
  const move = (i: number, by: number) => { const a = secs.map((x: Any) => ({ id: x.id, title: x.title })); const [it] = a.splice(i, 1); a.splice(i + by, 0, it); patch({ sections: a }) }
  return {
    summary: [r.scheduleLabel, (d.style || 'story').replace(/^./, (x: string) => x.toUpperCase()), `${secs.length} section${secs.length === 1 ? '' : 's'}`].join(' · '),
    schedKind: sc.kind, schedAt: sc.at || '08:00', schedDay: String(sc.weekday ?? 1), showTime: sc.kind !== 'none', showDay: sc.kind === 'weekly',
    kinds: [['none', 'Off'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly']].map(([v, l]) => ({ v, l })), days: DAY_NAMES.map((l, i) => ({ v: String(i), l })),
    onKind: (e: Any) => patch({ schedule: { kind: e.target.value, at: e.target.value === 'none' ? null : sc.at || '08:00', weekday: e.target.value === 'weekly' ? sc.weekday ?? 1 : null } }),
    onAt: (e: Any) => { if (/^\d\d:\d\d$/.test(e.target.value)) patch({ schedule: { kind: sc.kind, at: e.target.value, weekday: sc.weekday ?? null } }) },
    onDay: (e: Any) => patch({ schedule: { kind: 'weekly', at: sc.at || '08:00', weekday: Number(e.target.value) } }),
    layoutSegs: c.seg([['story', 'Story'], ['digest', 'Digest'], ['table', 'Table']], d.style || 'story', v => patch({ style: v })),
    sections: secs.map((x: Any, i: number) => ({
      title: x.title,
      onRename: (t: string) => { if (t.trim() && t.trim() !== x.title) patch({ sections: secs.map((y: Any) => ({ id: y.id, title: y.id === x.id ? t.trim() : y.title })) }) },
      onUp: i > 0 ? () => move(i, -1) : null, onDown: i < secs.length - 1 ? () => move(i, 1) : null,
      onRemove: secs.length > 1 ? () => patch({ sections: secs.filter((y: Any) => y.id !== x.id).map((y: Any) => ({ id: y.id, title: y.title })) }) : null
    }))
  }
}

/** Tier line and the page's sync button (DEC-096): a followed entity checks its sources; any other gets Pull latest —
 *  one lookup, nothing subscribed. */
function tierUi(c: Any, type: 'company' | 'firm', pg: { id: string; name: string; followed: boolean; tier?: string; connectedVia?: string[] }) {
  const via = (pg.connectedVia || []).slice(0, 2).join(' and ')
  return {
    tierText: pg.followed ? '' : pg.tier === 'connected' && via ? `Connected via ${via} · news checked daily` : 'Not followed · updated from your sources',
    checkLabel: pg.followed ? 'Check for updates' : 'Pull latest',
    // the same refresh as Check for updates: the sources that already cover it, or one lookup when none do — never a
    // subscription for something not followed
    onPull: async () => {
      const r: Any = await c.act('object.refresh', { type, id: pg.id }, 'Couldn’t pull the latest')
      if (r) c.toast(r.message + ' Follow to keep it current.')
    }
  }
}
