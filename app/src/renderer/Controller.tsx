// Port of the prototype's Component logic (design/prototype/Research Workspace.dc.html, class Component).
// UI state and interaction rules are the prototype's; every data read/write goes through window.rw (IPC).
// rv*() methods compute the view-model V consumed by view/Template.tsx, exactly as in the prototype.
import React from 'react'
import { call, tryCall, on, ApiError } from './api'
import { Template } from './view/Template'
import { col, convColor, stanceColor, stanceLabel, hueOf, initialOf, ago, itemTime, shortDate, longDate, weekdayLong, monthYear } from './util'
import type { FeedItemDTO, FeedCountsDTO, ThesisDTO, CompanyListDTO, FirmListDTO, PersonListDTO, SourceDTO, ReaderDTO, ThesisPageDTO, CompanyPageDTO, FirmPageDTO, ReportDTO, AlertDTO, BriefingDTO, SuggestedSourceDTO, HistoryRowDTO, ReportRunDTO } from '../shared/dto'

type Any = any
// Today's sections (DEC-096): Following, Your theses (one group per thesis), Headlines. Items below the headline bar
// ('sources') show only outside Today, as "More from your sources". 'firms' is an older key, read as Following.
const GROUPS: [string, string][] = [['companies', 'Following'], ['theses', 'Your theses'], ['important', 'Headlines'], ['sources', 'More from your sources']]
const NOTE_TYPES = ['Personal observation', 'Open question', 'Counterpoint']
const KIND_TO_TYPE: Record<string, string> = { observation: 'Personal observation', question: 'Open question', counterpoint: 'Counterpoint', correction: 'Personal observation' }
const TYPE_TO_KIND: Record<string, string> = { 'Personal observation': 'observation', 'Open question': 'question', Counterpoint: 'counterpoint' }
const FREQ_LABEL: Record<string, string> = { realtime: 'Real-time', hourly: 'Hourly', daily: 'Daily', weekly: 'Weekly' }
const LABEL_FREQ: Record<string, string> = { 'Real-time': 'realtime', Hourly: 'hourly', Daily: 'daily', Weekly: 'weekly' }
const PRIO_LABEL: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High' }
const PRIVACY_COPY = 'Your library is stored on this Mac, in a folder you can open and back up. Research Workspace has no server of its own. Sources are fetched directly from this Mac. To summarize, organize and answer questions, article text, your notes, theses and questions are sent from this Mac to OpenAI using the ChatGPT sign-in you already have in Codex, and count toward your ChatGPT plan’s usage. Newsletters are read from, and reports and alerts are sent through, your Gmail account. When you send a link from a site like X or LinkedIn, Research Workspace opens just that page using your Chrome sign-in for that site; it never stores your passwords.'
const OPEN_AT_LOGIN_COPY = 'Research Workspace checks your sources only while it’s running. When you close the window it keeps running in the background.'

interface Snap { screen: string; view: string; thesisId: string | null; companyId: string | null; firmId: string | null; thesisFilter: string | null }

export class Controller extends React.Component<{}, Any> {
  hist: Snap[] = []
  fwd: Snap[] = []
  focusNext: string | null = null
  tt: any = null
  rs: { x: number; w: number } | null = null
  drag: { key: string; id: string } | null = null
  pRowsCache: Any[] = []
  unsub: (() => void)[] = []
  refreshTimer: any = null
  searchTimer: any = null
  suggestTimer: any = null
  noteSuggestTimer: any = null
  probeSeq = 0
  els: Record<string, HTMLElement | null> = {}

  state: Any = {
    ready: false, screen: 'inbox', view: 'today', thesisId: null, companyId: null, firmId: null,
    selId: null, multi: {}, hoverId: null, collapsed: {}, sort: 'relevance', thesisFilter: null,
    inspector: true, readerFull: false, progress: 0, selTb: null,
    noteDraft: '', noteThesis: null, noteType: null,
    thesisTab: 'overview', companyTab: 'Overview', expandedEv: {}, treeCollapsed: {}, listMode: 'following',
    sourcesTab: 'subscribed', expandedSrc: null, srcType: 'All',
    palette: false, pq: '', pIdx: 0, pScope: null, pResults: null, pCorrection: null, pAnswer: null, pAsking: false, pProgress: [],
    modal: null, whyId: null, why: null, menu: null, toast: null,
    thought: '', thoughtThesis: null, thoughtType: null, thoughtRemoved: {}, thoughtSuggest: null, thoughtNewThesis: null,
    add: { q: '', phase: 'idle', det: null, mode: 'relevant', instr: '', freq: 'Daily', once: false, theses: [], error: null },
    settingsTab: 'Appearance', repSel: null, repDraft: '', cuDraft: '', cuScope: null, cuBusy: false, cuError: null,
    sideW: 240, dragOver: null, childDraft: '', thDraft: '', qDraft: '', coDraft: '', actFilter: 'All',
    // backend data
    status: null, settings: {}, ai: null, theses: [], companies: [], firms: [], people: [], sources: [], suggested: [], history: [],
    items: [], counts: null, views: [], reader: null, thesisPage: null, companyPage: null, firmPage: null,
    reports: [], alerts: [], briefings: [], brSheet: null, runs: {}, preview: {}, email: { user: '', appPassword: '', recipient: '' }, emailMsg: null, bridge: null,
    feedDef: null, refineDraft: '', notify: null, popover: null, now: Date.now()
  }

  // ---------- lifecycle ----------
  componentDidMount() {
    this.unsub.push(on('*', ({ event, payload }) => this.onEvent(event, payload)))
    window.addEventListener('keydown', this.onKeyBound)
    if (window.innerWidth < 1180) this.setState({ inspector: false })
    this.refreshAll(true)
  }
  componentWillUnmount() { this.unsub.forEach(u => u()); window.removeEventListener('keydown', this.onKeyBound) }
  componentDidUpdate() {
    if (this.focusNext) {
      const el = this.els[this.focusNext] as HTMLInputElement | null
      const isTitle = this.focusNext === 'titleEl'
      this.focusNext = null
      if (el) setTimeout(() => { el.focus(); if (isTitle && el.select) el.select() }, 30)
    }
  }
  onKeyBound = (e: KeyboardEvent) => this.onKey(e)
  ref = (name: string) => (el: HTMLElement | null) => { this.els[name] = el }

  onEvent(event: string, payload: Any) {
    if (event === 'query.progress') { this.setState((s: Any) => ({ pProgress: [...s.pProgress, payload] })); return }
    if (event === 'source.syncCompleted' && payload?.toast) this.toast(payload.toast)
    if (event === 'alert.needsConfirmation' && payload?.alertId) this.openNotifyForAlert(payload.alertId)
    if (event === 'notification.triggered' && payload?.title && this.state.settings['notify.in_app'] !== false) this.toast(payload.title)
    if (event === 'app.deeplink' && payload?.toast) this.toast(payload.toast)
    if (event === 'app.deeplink' && payload?.select?.kind === 'item') this.openItem(payload.select.id)
    if (event === 'report.ready' && payload?.toast) {
      const rid = payload.reportId
      if (payload.undo) this.toast(payload.toast, 'Undo', async () => { await this.act('report.undo', { id: rid }); this.refreshScreen() })
      else this.toast(payload.toast)
      if (rid && this.state.screen === 'reports' && /^Report created/.test(payload.toast)) this.setState({ repSel: rid })
    }
    if (event === 'job.failed' && payload?.toast) this.toast(payload.toast)
    clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => this.refreshAll(false), 150)
  }

  // ---------- data loading ----------
  feedSpec(s = this.state): Any {
    return { segment: s.view, thesisFilter: s.thesisFilter || undefined, sort: s.sort }
  }

  async refreshAll(first = false) {
    const s = this.state
    const [status, settings, ai, theses, companies, firms, people, sources, feed, counts, views, feedDef] = await Promise.all([
      tryCall('app.status', {}, null), tryCall('settings.get', {}, {}), tryCall('ai.status', {}, null),
      tryCall<ThesisDTO[]>('thesis.tree', {}, []), tryCall<CompanyListDTO[]>('object.list', { type: 'company', mode: 'all' }, []),
      tryCall<FirmListDTO[]>('object.list', { type: 'firm', mode: 'all' }, []), tryCall<PersonListDTO[]>('object.list', { type: 'person', mode: 'all' }, []),
      tryCall<SourceDTO[]>('source.list', {}, []), tryCall<{ items: FeedItemDTO[] }>('feed.list', { viewSpec: this.feedSpec(s) }, { items: [] }),
      tryCall<FeedCountsDTO | null>('feed.counts', { viewSpec: this.feedSpec(s) }, null), tryCall('view.listFeedViews', {}, []),
      tryCall('view.get', { objectType: 'feed' }, null)
    ])
    const next: Any = { status, settings, ai, theses, companies, firms, people, sources, items: feed.items, counts, views, feedDef, now: (status as any)?.now || Date.now() }
    if (first) next.ready = true
    if (first && settings) next.sideW = 240
    this.setState(next, () => this.refreshScreen())
  }

  async refreshScreen() {
    const s = this.state
    if (s.screen === 'inbox') {
      let selId = s.selId
      const pinned = s.docReader && readerKey(s.docReader) === selId
      if (selId && !pinned && !s.items.some((i: FeedItemDTO) => i.id === selId)) selId = null
      if (!selId && s.items.length && !s.readerCleared) selId = this.visibleItems()[0]?.id ?? null
      if (selId !== s.selId) this.setState({ selId })
      if (selId) this.loadReader(selId)
      else this.setState({ reader: null })
    }
    if (s.screen === 'thesis' && s.thesisId) await this.loadPage('thesis', s.thesisId)
    if (s.screen === 'company' && s.companyId) await this.loadPage('company', s.companyId)
    if (s.screen === 'firm' && s.firmId) await this.loadPage('firm', s.firmId)
    if (s.screen === 'sources') {
      const [suggested, history] = await Promise.all([tryCall<SuggestedSourceDTO[]>('source.suggestions', {}, []), tryCall<HistoryRowDTO[]>('source.history', {}, [])])
      this.setState({ suggested, history })
    }
    if (s.screen === 'reports') {
      const [reports, alerts, briefings] = await Promise.all([tryCall<ReportDTO[]>('report.list', {}, []), tryCall<AlertDTO[]>('alert.list', {}, []), tryCall<BriefingDTO[]>('briefing.list', {}, [])])
      const repSel = s.repSel && reports.some(r => r.id === s.repSel) ? s.repSel : reports.find(r => r.enabled)?.id ?? reports[0]?.id ?? null
      this.setState({ reports, alerts, briefings, repSel })
      if (repSel) this.loadPreview(repSel)
    }
  }

  /**
   * Load a company/firm/thesis page. object.get answers a merged (or retyped) id with { redirect } to the surviving
   * object: follow it in place (replacing this history entry) instead of rendering the redirect as a page. A page that
   * no longer exists goes back to its list.
   */
  async loadPage(type: 'company' | 'firm' | 'thesis', id: string) {
    const key = type === 'company' ? 'companyId' : type === 'firm' ? 'firmId' : 'thesisId'
    const pageKey = type === 'company' ? 'companyPage' : type === 'firm' ? 'firmPage' : 'thesisPage'
    let r: Any
    try { r = await call('object.get', { type, id }) } catch (e) {
      if (this.state.screen !== type || this.state[key] !== id) return
      if (e instanceof ApiError && e.code === 'NOT_FOUND') {
        this.toast(type === 'thesis' ? 'That thesis no longer exists.' : 'That ' + type + ' is no longer in your library.')
        this.setState({ [pageKey]: null, screen: type === 'company' ? 'companies' : type === 'firm' ? 'firms' : 'theses' }, () => this.refreshScreen())
      }
      return
    }
    if (this.state.screen !== type || this.state[key] !== id) return // navigated away meanwhile
    const red = r && r.redirect
    if (red && red.id) {
      const screen = red.type === 'person' ? type : red.type
      const params: Any = { screen, companyPage: null, firmPage: null, thesisPage: null, companyTab: 'Overview' }
      params[screen === 'company' ? 'companyId' : screen === 'firm' ? 'firmId' : 'thesisId'] = red.id
      this.setState(params, () => this.afterNav())
      return
    }
    this.setState({ [pageKey]: r })
  }

  async loadReader(itemId: string) {
    const doc = this.state.docReader as ReaderDTO | null
    if (doc && readerKey(doc) === itemId) {
      const r = await tryCall<ReaderDTO | null>('document.reader', { id: doc.document.id }, null)
      if (r && this.state.selId === itemId) this.setState({ reader: r, docReader: r })
      return
    }
    const r = await tryCall<ReaderDTO | null>('feed.get', { itemId }, null)
    if (this.state.selId === itemId) this.setState({ reader: r })
  }

  /**
   * Open any library document in the reader — also one without a visible feed item (triaged out, dismissed, hidden,
   * hydration-fetched, or a duplicate whose original is shown). The document's reader DTO is pinned so the inbox can
   * show it even though it isn't in the current list.
   */
  async openDocument(documentId: string, quote?: string | null) {
    let r: ReaderDTO
    try { r = await call<ReaderDTO>('document.reader', { id: documentId }) } catch (e) {
      this.toast(e instanceof ApiError && e.message ? e.message : 'Couldn’t open that document.'); return
    }
    this.setState({ palette: false })
    this.go('inbox', { view: 'all', thesisFilter: null, selId: readerKey(r), docReader: r, reader: r, readerCleared: false, scrollToQuote: quote || null })
  }

  async loadPreview(reportId: string) {
    const [prev, runs] = await Promise.all([tryCall<ReportRunDTO | null>('report.preview', { id: reportId }, null), tryCall<ReportRunDTO[]>('report.runs', { id: reportId }, [])])
    this.setState((s: Any) => ({ preview: { ...s.preview, [reportId]: prev }, runs: { ...s.runs, [reportId]: runs } }))
  }

  /** Call a command; on failure show the FLOW-B failure toast and refresh to revert optimistic state. */
  async act<T = any>(command: string, payload: Record<string, unknown>, failMsg = 'Couldn’t save that change. Try again.'): Promise<T | null> {
    try { return await call<T>(command, payload) } catch (e) {
      this.toast(e instanceof ApiError && e.code !== 'INTERNAL' && e.message ? e.message : failMsg)
      this.refreshAll(false)
      return null
    }
  }

  // ---------- lookups ----------
  T(id: string | null | undefined): ThesisDTO | undefined { return (this.state.theses as ThesisDTO[]).find(t => t.id === id) }
  C(id: string | null | undefined): CompanyListDTO | undefined { return (this.state.companies as CompanyListDTO[]).find(c => c.id === id) }
  F(id: string | null | undefined): FirmListDTO | undefined { return (this.state.firms as FirmListDTO[]).find(f => f.id === id) }
  item(id: string | null | undefined): FeedItemDTO | undefined {
    const it = (this.state.items as FeedItemDTO[]).find(i => i.id === id)
    if (it || !id) return it
    const d = this.state.docReader as ReaderDTO | null
    return d && readerKey(d) === id ? readerItem(d) : undefined
  }
  path(id: string | null | undefined): string { const t = this.T(id); if (!t) return ''; const p = t.parentId ? this.T(t.parentId) : undefined; return p ? p.title + ' → ' + t.title : t.title }
  ancestors(id: string): ThesisDTO[] { const out: ThesisDTO[] = []; let t = this.T(id); while (t && t.parentId) { t = this.T(t.parentId); if (t) out.unshift(t) } return out }
  isDesc(id: string, anc: string): boolean { let t = this.T(id); const seen = new Set<string>(); while (t && !seen.has(t.id)) { if (t.id === anc) return true; seen.add(t.id); t = t.parentId ? this.T(t.parentId) : undefined } return false }
  pins(kind: 'theses' | 'companies'): string[] { return (this.state.settings?.['pins.' + kind] as string[]) || [] }
  setting(k: string): Any { return this.state.settings?.[k] }

  // ---------- navigation ----------
  snap(): Snap { const s = this.state; return { screen: s.screen, view: s.view, thesisId: s.thesisId, companyId: s.companyId, firmId: s.firmId, thesisFilter: s.thesisFilter } }
  go(screen: string, params: Any = {}) {
    this.hist.push(this.snap()); this.fwd = []
    this.setState({ screen, docReader: null, ...params, menu: null, selTb: null, palette: false, modal: null, readerFull: false, coDraft: '', popover: null }, () => this.afterNav())
  }
  afterNav() {
    const s = this.state
    if (s.screen === 'inbox') this.refreshAll(false)
    else this.refreshScreen()
    if (s.screen === 'thesis' && s.thesisId) tryCall('object.markViewed', { type: 'thesis', id: s.thesisId }, null)
    if (s.screen === 'company' && s.companyId) tryCall('object.markViewed', { type: 'company', id: s.companyId }, null)
    if (s.screen === 'firm' && s.firmId) tryCall('object.markViewed', { type: 'firm', id: s.firmId }, null)
  }
  back() { if (!this.hist.length) return; this.fwd.push(this.snap()); this.setState({ ...this.hist.pop(), menu: null }, () => this.afterNav()) }
  forward() { if (!this.fwd.length) return; this.hist.push(this.snap()); this.setState({ ...this.fwd.pop(), menu: null }, () => this.afterNav()) }
  goThesis(id: string) { this.go('thesis', { thesisId: id, thesisTab: 'overview', thDraft: '', qDraft: '', childDraft: '', thesisPage: null }) }
  goCompany(id: string) { this.go('company', { companyId: id, companyTab: 'Overview', actFilter: 'All', companyPage: null }) }
  goFirm(id: string) { this.go('firm', { firmId: id, firmPage: null }) }
  goPerson(p: PersonListDTO) { p.orgType === 'firm' ? this.goFirm(p.orgId) : this.goCompany(p.orgId) }
  goReports(q?: string) { this.go('reports', { repDraft: q || '' }); this.focusNext = 'repEl' }
  openItem(itemId: string | null, documentId?: string) {
    if (documentId) { this.openDocument(documentId); return } // works whether or not the item is in the current list
    if (!itemId) return
    this.go('inbox', { view: 'all', thesisFilter: null, selId: itemId, docReader: null })
  }

  exportMenu(e: Any, what: string, kind: 'thesis' | 'report', id: string) {
    const fmt: [string, string][] = [['PDF', 'pdf'], ['Markdown', 'markdown'], ['Copy as Markdown', 'copy_markdown'], ['Send by email', 'email']]
    this.menuAt(e, [{ head: true, label: 'Export ' + what }, ...fmt.map(([label, f]) => ({
      label, act: async () => {
        const r = await this.act<Any>(kind === 'thesis' ? 'export.thesis' : 'report.export', { id, format: f })
        if (!r) return
        this.toast(f === 'copy_markdown' ? 'Copied as Markdown' : f === 'email' ? 'Sending ' + what + ' to your email' : 'Exported ' + what + ' as ' + label + (r.path ? ' to ' + r.path.replace(/^\/Users\/[^/]+/, '~') : ''))
      }
    }))])
  }

  toast(msg: string, actLabel?: string, act?: () => void) { clearTimeout(this.tt); this.setState({ toast: { msg, actLabel, act } }); this.tt = setTimeout(() => this.setState({ toast: null }), 4500) }
  menuAt(e: Any, items: Any[]) {
    e.preventDefault && e.preventDefault(); e.stopPropagation && e.stopPropagation()
    let x: number, y: number
    if (e.type === 'contextmenu' || !e.currentTarget || !e.currentTarget.getBoundingClientRect) { x = e.clientX; y = e.clientY }
    else { const r = e.currentTarget.getBoundingClientRect(); x = r.left; y = r.bottom + 4 }
    const h = items.length * 27 + 12
    x = Math.min(x, window.innerWidth - 240); y = Math.min(y, window.innerHeight - h - 10)
    this.setState({ menu: { x: Math.max(8, x), y: Math.max(8, y), items } })
  }
  thesisMenuItems(onPick: (id: string) => void, current?: string | null, extraTop: Any[] = []) {
    const out: Any[] = [{ head: true, label: 'Choose thesis' }, ...extraTop]
    const all = this.state.theses as ThesisDTO[]
    const walk = (pid: string | null, d: number) => all.filter(t => (t.parentId || null) === pid).forEach(t => { out.push({ label: t.title, pad: d * 12 + 'px', check: t.id === current ? '✓' : '', act: () => onPick(t.id) }); walk(t.id, d + 1) })
    walk(null, 0)
    if (out.length === 1 + extraTop.length) out.push({ label: 'No theses yet', color: 'var(--g8e8e98)' })
    return out
  }

  // ---------- feed ----------
  groupedItems(): { key: string; label: string; items: FeedItemDTO[]; compact?: boolean; hint?: string }[] {
    const s = this.state
    const arr = (s.items as FeedItemDTO[]).filter(i => !i.dismissed)
    const groupBy = this.groupBy()
    if (groupBy === 'none') return [{ key: 'all', label: s.sort === 'newest' ? 'Newest first' : 'By relevance', items: arr }]
    if (groupBy === 'source') { const m: Record<string, FeedItemDTO[]> = {}; arr.forEach(i => (m[i.source] = m[i.source] || []).push(i)); return Object.keys(m).map(k => ({ key: 'src:' + k, label: k, items: m[k] })) }
    if (groupBy === 'thesis') {
      const m = new Map<string, FeedItemDTO[]>()
      for (const i of arr) { const k = i.thesis || ''; if (!m.has(k)) m.set(k, []); m.get(k)!.push(i) }
      const order = (this.state.feedDef?.definition?.spec?.thesisOrder as string[] | undefined) || []
      const keys = [...m.keys()].sort((a, b) => { if (!a) return 1; if (!b) return -1; const ta = this.T(a)?.title || '', tb = this.T(b)?.title || ''; const ia = order.findIndex(o => o === a || o === ta), ib = order.findIndex(o => o === b || o === tb); if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); return ta.localeCompare(tb) })
      return keys.map(k => ({ key: 'th:' + k, label: k ? this.path(k) || 'Thesis' : 'No thesis', items: m.get(k)! }))
    }
    const order = (this.state.feedDef?.definition?.spec?.sectionOrder as string[] | undefined)
    const today = s.view === 'today'
    const keyOf = (i: FeedItemDTO) => (i.group === 'firms' ? 'companies' : i.group)
    const groups = (order && order.length ? [...order.map(k => GROUPS.find(g => g[0] === k)!).filter(Boolean), ...GROUPS.filter(g => !order.includes(g[0]))] : GROUPS)
      .filter(g => !(today && g[0] === 'sources'))
    const out: { key: string; label: string; items: FeedItemDTO[]; compact?: boolean; hint?: string }[] = []
    for (const [key, label] of groups) {
      const items = arr.filter(i => keyOf(i) === key)
      if (key === 'theses') {
        // one group per thesis, supports before challenges; with no theses yet, an invitation instead
        if (!(s.theses as ThesisDTO[]).length) { if (today) out.push({ key: 'theses', label, items: [], hint: 'Add your first thesis to see evidence for and against it here.' }); continue }
        const by = new Map<string, FeedItemDTO[]>()
        for (const i of items) { const k = i.thesis || ''; if (!by.has(k)) by.set(k, []); by.get(k)!.push(i) }
        const rank = (i: FeedItemDTO) => (i.stance === 'support' ? 0 : i.stance === 'contra' ? 1 : 2)
        for (const [tid, list] of by) out.push({ key: 'theses:' + tid, label: `${label} · ${tid ? this.path(tid) || 'Thesis' : 'Other'}`, items: [...list].sort((a, b) => rank(a) - rank(b)) })
        continue
      }
      if (items.length) out.push({ key, label, items, compact: key === 'important' })
    }
    return out
  }
  groupBy(): string {
    const def = this.state.feedDef?.definition?.spec
    return this.state.groupOverride || def?.groupBy || 'section'
  }
  visibleItems(): FeedItemDTO[] { const c = this.state.collapsed; return this.groupedItems().flatMap(g => (c[g.key] ? [] : g.items)) }

  select(id: string, scroll?: boolean) {
    const it = this.item(id)
    if (it && it.unread) { this.setState((s: Any) => ({ items: s.items.map((i: FeedItemDTO) => (i.id === id ? { ...i, unread: false } : i)) })); call('feed.markRead', { ids: [id], read: true }).catch(() => {}) }
    const keepDoc = this.state.docReader && readerKey(this.state.docReader) === id
    this.setState({ selId: id, progress: 0, selTb: null, noteDraft: '', noteThesis: null, noteType: null, reader: this.state.reader?.item?.id === id ? this.state.reader : null, readerCleared: false, ...(keepDoc ? {} : { docReader: null }) })
    if (this.els.readerEl) this.els.readerEl.scrollTop = 0
    this.loadReader(id)
    if (scroll && this.els.listEl) setTimeout(() => { const L = this.els.listEl!; const el = L.querySelector(`[data-item="${id}"]`) as HTMLElement | null; if (!el) return; const top = el.offsetTop, b = top + el.offsetHeight; if (top < L.scrollTop + 40) L.scrollTop = top - 40; else if (b > L.scrollTop + L.clientHeight) L.scrollTop = b - L.clientHeight + 10 }, 0)
  }
  clickItem(e: Any, id: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) { this.setState((s: Any) => { const m = { ...s.multi }; if (m[id]) delete m[id]; else m[id] = true; if (s.selId && !Object.keys(s.multi).length) m[s.selId] = true; return { multi: m } }); return }
    this.setState({ multi: {} }); this.select(id)
  }
  /** A document opened from Ask or a page that has no feed item: feed actions don't apply to it. */
  docOnly(id: string): boolean {
    if (!id.startsWith('doc:')) return false
    this.toast('This document isn’t in your feed. You can still keep its evidence or attach it to a thesis.')
    return true
  }
  patchItems(ids: string[], patch: Partial<FeedItemDTO>) { this.setState((s: Any) => ({ items: s.items.map((i: FeedItemDTO) => (ids.includes(i.id) ? { ...i, ...patch } : i)) })) }
  async toggleSave(id: string) {
    if (this.docOnly(id)) return
    const it = this.item(id); if (!it) return
    this.patchItems([id], { saved: !it.saved })
    if (!(await this.act('feed.save', { ids: [id], saved: !it.saved }))) return
    if (!it.saved) this.toast('Saved to your library', 'View saved', () => this.go('inbox', { view: 'saved', thesisFilter: null }))
    else this.toast('Removed from saved')
  }
  async dismiss(id: string, reason?: string, toastMsg?: string) {
    if (this.docOnly(id)) return
    const list = this.visibleItems(); const idx = list.findIndex(x => x.id === id); const next = list[idx + 1] || list[idx - 1]
    const it = this.item(id); if (!it) return
    this.patchItems([id], { dismissed: true })
    if (this.state.selId === id) { if (next) this.select(next.id, true); else this.setState({ selId: null, reader: null, readerCleared: true }) }
    if (!(await this.act('feed.dismiss', { ids: [id], reason }))) return
    this.toast(toastMsg || ('Dismissed “' + (it.title.length > 38 ? it.title.slice(0, 38) + '…' : it.title) + '”'), 'Undo', async () => { await this.act('feed.undismiss', { ids: [id] }); this.patchItems([id], { dismissed: false }); this.select(id); this.refreshAll(false) })
  }
  async markRead(id: string, read: boolean) { if (this.docOnly(id)) return; this.patchItems([id], { unread: !read }); await this.act('feed.markRead', { ids: [id], read }); this.refreshAll(false) }
  async feedback(id: string, value: 'more' | 'less') {
    if (this.docOnly(id)) return
    const it = this.item(id); if (!it) return
    if (!(await this.act('feed.feedback', { id, value }))) return
    const t = this.T(it.thesis)
    this.toast(value === 'more' ? 'Got it. More like this from ' + it.source + (t ? ' and ' + t.title : '') + '.' : 'Got it. Fewer items like this.')
  }
  itemMenu(e: Any, id: string) {
    const it = this.item(id); if (!it) return
    const co = it.cos[0] ? this.C(it.cos[0]) : undefined
    const items = [
      { label: 'Open', hint: '↵', act: () => this.select(id) },
      { label: it.saved ? 'Unsave' : 'Save', hint: 'S', act: () => this.toggleSave(id) },
      { label: 'Add thought…', hint: 'N', act: () => this.openThought(it.thesis) },
      { label: 'Attach to thesis…', act: () => setTimeout(() => this.menuAt({ clientX: e.clientX + 10, clientY: e.clientY, type: 'contextmenu' }, this.thesisMenuItems(t => this.attach(id, t), it.thesis)), 0) },
      { label: it.unread ? 'Mark as read' : 'Mark as unread', hint: 'U', act: () => this.markRead(id, it.unread) },
      { div: true },
      { label: 'More like this', act: () => this.feedback(id, 'more') },
      { label: 'Less like this', act: () => this.feedback(id, 'less') },
      { label: 'Why am I seeing this?', act: () => this.openWhy(id) },
      { label: 'Notify me when…', act: () => this.openNotify(co ? { type: 'company', id: co.id, name: co.name } : null) },
      { div: true },
      it.srcId && it.srcId !== 'src_manual' ? { label: 'Stop showing updates from ' + it.source, act: () => this.muteSource(it.srcId, true) } : null,
      co && co.followed ? { label: 'Unfollow ' + co.name, act: () => this.follow('company', co.id) } : null,
      { label: 'Not relevant', hint: 'E', color: '#ff8a80', act: async () => { await this.act('feed.feedback', { id, value: 'less' }); this.dismiss(id, 'not_relevant', 'Marked not relevant. I’ll learn from this.') } }
    ].filter(Boolean)
    this.menuAt(e, items)
  }
  async attach(itemId: string, thesisId: string, stance?: string) {
    const it = this.item(itemId)
    const docOnly = itemId.startsWith('doc:')
    const r = await this.act<Any>('link.attach', { fromType: docOnly ? 'document' : 'feed_item', fromId: docOnly ? itemId.slice(4) : itemId, thesisId, ...(stance ? { stance } : {}) })
    if (!r) return
    if (it) this.patchItems([itemId], { review: false, thesis: thesisId })
    this.toast('Attached to ' + this.path(thesisId), 'Open thesis', () => this.goThesis(thesisId))
    this.refreshAll(false)
  }
  /** Save a highlighted passage (selection offsets in the document text) as user evidence. */
  async saveHighlight(sel: { start: number; end: number; text: string }, thesisId?: string | null, coId?: string | null) {
    const s = this.state; const r = s.reader as ReaderDTO | null; if (!r) return
    const th = thesisId === undefined ? r.item?.thesis : thesisId
    const res = await this.act<Any>('evidence.highlight', { documentId: r.document.id, start: sel.start, end: sel.end, ...(th ? { thesisId: th } : {}), ...(coId ? { companyId: coId } : {}) })
    this.setState({ selTb: null })
    window.getSelection && window.getSelection()!.removeAllRanges()
    if (!res) return
    const co = coId ? this.C(coId) : null
    this.toast(co ? 'Saved as evidence on ' + co.name : th ? 'Saved as evidence · ' + this.path(th) : 'Saved as evidence', 'Open', () => (co ? this.goCompany(co.id) : th ? this.goThesis(th) : undefined))
    if (s.selId) this.loadReader(s.selId)
    this.refreshAll(false)
  }
  async keepEvidence(evId: string) {
    const r = this.state.reader as ReaderDTO | null
    const th = r?.item?.thesis || undefined
    if (!(await this.act('evidence.keep', { id: evId, ...(th ? { thesisId: th } : {}) }))) return
    this.toast(th ? 'Saved as evidence · ' + this.path(th) : 'Saved as evidence')
    if (this.state.selId) this.loadReader(this.state.selId)
    this.refreshAll(false)
  }
  async follow(type: 'company' | 'firm' | 'person', id: string, name?: string, current?: boolean) {
    const x: Any = type === 'company' ? this.C(id) : type === 'firm' ? this.F(id) : (this.state.people as PersonListDTO[]).find(p => p.id === id)
    const followed = current ?? !!x?.followed
    const nm = name || x?.name || ''
    if (!(await this.act('object.follow', { type, id, follow: !followed }))) return
    if (type === 'company') {
      if (!followed) this.toast('Following ' + nm + '. New activity will appear in Today.', 'Open', () => this.goCompany(id))
      else this.toast('Unfollowed ' + nm, 'Undo', () => this.act('object.follow', { type, id, follow: true }).then(() => this.refreshAll(false)))
    } else if (type === 'firm') this.toast(followed ? 'Unfollowed ' + nm : 'Following ' + nm + '. Investments and writing will appear in Today.', followed ? 'Undo' : 'Open', () => (followed ? this.act('object.follow', { type, id, follow: true }).then(() => this.refreshAll(false)) : this.goFirm(id)))
    else this.toast(followed ? 'Unfollowed ' + nm : 'Following ' + nm + '. Their interviews and posts will appear in Today.')
    this.refreshAll(false)
  }
  async muteSource(sid: string, on: boolean) {
    const src = (this.state.sources as SourceDTO[]).find(x => x.id === sid)
    if (!(await this.act('source.mute', { id: sid, muted: on }))) return
    if (on) this.toast('Muted ' + (src?.name || 'source'), 'Undo', () => this.act('source.mute', { id: sid, muted: false }).then(() => this.refreshAll(false)))
    this.refreshAll(false)
  }

  /** Deterministic suggestion shown while ORGANIZE_NOTE is pending: keyword match to thesis names and company names. */
  propose(text: string, fallback?: string | null): { thesis: string | null; type: string; cos: string[] } {
    const l = text.toLowerCase()
    const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3)
    let best: { id: string; n: number } | null = null
    for (const t of this.state.theses as ThesisDTO[]) { const n = words(t.title + ' ' + t.description).filter(w => l.includes(w)).length; if (n > 0 && (!best || n > best.n)) best = { id: t.id, n } }
    let type = 'Personal observation'
    if (/\?\s*$/.test(text.trim()) || /^(what|why|how|does|is|will|can|should)\b/.test(l)) type = 'Open question'
    else if (/\b(but|however|contradict|wrong|skeptic|not sure|doubt|shaky)\b/.test(l)) type = 'Counterpoint'
    const cos = (this.state.companies as CompanyListDTO[]).filter(c => c.name.length > 2 && l.includes(c.name.toLowerCase())).map(c => c.id)
    return { thesis: best?.id ?? fallback ?? null, type, cos }
  }
  /** "Describe…" for something with no page of its own (people): the Describe sheet in edit mode (DEC-099). */
  async openDescribeEdit(type: 'person' | 'source', id: string, name: string) {
    const d = await this.act<Any>('object.details', { type, id }, 'Couldn’t open the description')
    if (d) this.setState({ modal: 'describe', menu: null, palette: false, describe: { mode: 'edit', kind: type, id, name, about: d.about || '', fields: d.fields || {}, fieldSet: d.fieldSet || [], busy: false } })
  }
  openThought(thesisId?: string | null) { this.focusNext = 'thoughtEl'; this.setState({ modal: 'thought', thought: '', thoughtThesis: thesisId || null, thoughtType: null, thoughtRemoved: {}, thoughtSuggest: null, thoughtNewThesis: null, menu: null, palette: false }) }
  onThoughtText(v: string) {
    this.setState({ thought: v })
    clearTimeout(this.suggestTimer)
    if (v.trim().length > 8 && this.setting('ai.organize') !== false) this.suggestTimer = setTimeout(async () => {
      const r = await tryCall<Any>('note.suggest', { text: v }, null)
      if (r && this.state.thought === v) this.setState({ thoughtSuggest: r })
    }, 1500)
  }
  thoughtChoice() {
    const s = this.state; const p = this.propose(s.thought, s.thoughtThesis)
    const sug = s.thoughtSuggest
    const thesis = s.thoughtNewThesis ? null : s.thoughtThesis || sug?.thesisId || p.thesis
    const type = s.thoughtType || (sug?.kind ? KIND_TO_TYPE[sug.kind] : null) || p.type
    const cos = [...new Set([...(sug?.companyIds || []), ...p.cos])].filter((c: string) => !s.thoughtRemoved[c])
    return { thesis, type, cos, firms: (sug?.firmIds || []) as string[], newThesis: sug?.newThesis || null }
  }
  async saveThought() {
    const s = this.state; const text = s.thought.trim(); if (!text) return
    const ch = this.thoughtChoice()
    let thesisId = ch.thesis
    if (s.thoughtNewThesis) {
      const t = await this.act<ThesisDTO>('thesis.create', { title: s.thoughtNewThesis.title })
      if (!t) return
      if (s.thoughtNewThesis.description) await this.act('thesis.update', { id: t.id, patch: { description: s.thoughtNewThesis.description } })
      thesisId = t.id
    }
    const decided = !!(s.thoughtThesis || s.thoughtNewThesis || s.thoughtSuggest)
    const r = await this.act<Any>('note.create', { text, kind: TYPE_TO_KIND[ch.type], kindDecided: !!s.thoughtType, thesisId: decided || thesisId ? thesisId : null, companyIds: ch.cos, firmIds: ch.firms, anchor: thesisId ? { type: 'thesis', id: thesisId } : { type: 'none' } } as Any)
    if (!r) return
    this.setState({ modal: null, thought: '' })
    if (r.aiFailed) this.toast('Saved. I couldn’t suggest where it belongs.')
    else if (thesisId) this.toast('Thought added to ' + this.path(thesisId), 'Open thesis', () => this.goThesis(thesisId!))
    else this.toast('Thought saved. I’ll suggest where it belongs.')
    this.refreshAll(false)
  }
  /** "Describe it" when adding a thesis or a person (DEC-099). */
  openDescribeAdd(kind: 'thesis' | 'person', parentId: string | null = null, name = '') {
    this.setState({ modal: 'describe', menu: null, palette: false, describe: { mode: 'add', kind, name, about: '', fields: {}, parentId, busy: false } })
  }
  async newThesis(parent: string | null) {
    const t = await this.act<ThesisDTO>('thesis.create', { parentId: parent })
    if (!t) return
    await this.refreshAll(false)
    this.focusNext = 'titleEl'
    this.goThesis(t.id)
  }
  openAddSource(once: boolean, preset?: string) {
    this.focusNext = 'addEl'
    this.setState({ modal: 'addSource', menu: null, palette: false, add: { q: '', phase: 'idle', det: null, mode: 'relevant', instr: '', freq: 'Daily', once: !!once, theses: [], error: null } }, () => { if (preset) this.onAddQ(preset) })
  }
  onAddQ(v: string) {
    clearTimeout(this.suggestTimer)
    const once = this.state.add.once
    const seq = ++this.probeSeq
    this.setState((s: Any) => ({ add: { ...s.add, q: v, phase: v.trim().length > 2 ? 'detecting' : 'idle', det: null, error: null } }))
    if (v.trim().length <= 2) return
    this.suggestTimer = setTimeout(async () => {
      if (once && !/^\s*(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})/i.test(v) && v.trim().length >= 200) {
        if (seq === this.probeSeq) this.setState((s: Any) => ({ add: { ...s.add, phase: 'found', det: { status: 'text', name: v.trim().split('\n')[0].slice(0, 80), typeLabel: 'Pasted text', recent: [], canonicalLocator: '', relatedThesisIds: [] } } }))
        return
      }
      try {
        const det = await call<Any>('source.probe', { locator: v, once })
        if (seq !== this.probeSeq) return
        this.setState((s: Any) => ({ add: { ...s.add, phase: 'found', det, mode: det.suggestedMode || s.add.mode, freq: FREQ_LABEL[det.suggestedFreq] || s.add.freq, theses: det.relatedThesisIds || [] } }))
      } catch (e) {
        if (seq !== this.probeSeq) return
        this.setState((s: Any) => ({ add: { ...s.add, phase: 'found', det: { status: 'unreachable', name: v, typeLabel: '', recent: [], message: (e as Error).message } } }))
      }
    }, 450)
  }
  canStart(): boolean {
    const a = this.state.add; const d = a.det
    if (a.phase !== 'found' || !d) return false
    if (a.busy) return false
    if (a.once) return d.status !== 'unsupported_once' && (d.status !== 'unreachable' || /^https?:/i.test(a.q.trim()) || a.q.includes('.') || d.status === 'text')
    return d.status === 'found' || d.status === 'login_required'
  }
  async startWatching() {
    const a = this.state.add; if (!this.canStart()) return
    const d = a.det
    if (a.once) {
      const q = a.q.trim()
      const isText = d.status === 'text' || (!/^(https?:\/\/|www\.)/i.test(q) && !/^[\w-]+(\.[\w-]+)+(\/|$)/.test(q))
      // Keep the sheet open while reading: a dead link or a page without readable text is reported here, never as success
      if (a.busy) return
      this.setState((st: Any) => ({ add: { ...st.add, busy: true, error: null } }))
      let r: Any
      try { r = await call<Any>(isText ? 'ingress.addText' : 'ingress.addUrl', isText ? { text: q, thesisIds: a.theses } : { url: q, thesisIds: a.theses }) } catch (e) {
        const msg = e instanceof ApiError && e.code !== 'INTERNAL' && e.message ? e.message : 'Couldn’t read this page.'
        this.setState((st: Any) => ({ add: { ...st.add, busy: false, error: 'Couldn’t read this page. ' + (msg === 'Couldn’t read this page.' ? '' : msg) } }))
        this.refreshAll(false)
        return
      }
      this.hist.push(this.snap())
      this.setState((st: Any) => ({ modal: null, add: { ...st.add, busy: false }, screen: 'inbox', view: 'today', thesisFilter: null, selId: r.itemId || this.state.selId }), () => this.refreshAll(false))
      this.toast(r.pending ? (r.message || 'Saved. Sign in, then Retry from Sources ▸ On-demand history.') : 'Added to Today as a one-time read')
      return
    }
    const mode = a.mode === 'portfolio' ? 'custom' : a.mode
    const instruction = a.mode === 'portfolio' ? 'Only portfolio announcements: funding, launches and hires from companies they back.' + (a.instr ? ' ' + a.instr : '') : a.mode === 'custom' ? a.instr : ''
    try {
      const src = await call<SourceDTO>('source.create', { locator: d.canonicalLocator || a.q.trim(), name: d.name, mode, instruction, freq: LABEL_FREQ[a.freq] || 'daily', thesisIds: a.theses, probe: d })
      this.hist.push(this.snap())
      this.setState({ modal: null, screen: 'sources', sourcesTab: 'subscribed', expandedSrc: src.id, srcType: 'All' }, () => this.refreshAll(false))
      if (d.status === 'login_required') this.signIn(src.id) // M1(a): Sign in opens the site's sign-in window right away
      else this.toast('Watching ' + src.name + ' · first check running on this Mac')
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') {
        const ex = (this.state.sources as SourceDTO[]).find(x => x.locator === (d.canonicalLocator || a.q.trim()))
        this.setState({ modal: null, screen: 'sources', sourcesTab: 'subscribed', expandedSrc: ex?.id || null }, () => this.refreshAll(false))
        this.toast('You already watch this source')
      } else this.setState((s: Any) => ({ add: { ...s.add, error: (e as Error).message } }))
    }
  }

  // ---------- keyboard ----------
  onKey(e: KeyboardEvent) {
    const s = this.state; if (!s.ready) return
    const tgt = e.target as HTMLElement
    const tag = (tgt.tagName || '').toLowerCase()
    // A field counts as focused whether the key event targets it or focus sits in it (e.g. events retargeted to body).
    const isField = (el: Element | null) => !!el && (/^(input|textarea|select)$/i.test(el.tagName) || (el as HTMLElement).isContentEditable || !!el.closest?.('[contenteditable=""],[contenteditable="true"],[role="textbox"]'))
    const typing = isField(tgt) || isField(document.activeElement)
    const k = e.key
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'k') { e.preventDefault(); if (s.palette) this.setState({ palette: false }); else this.openPalette(); return }
    if ((e.metaKey || e.ctrlKey) && k === ',') { e.preventDefault(); this.openSettings(); return }
    if (k === 'Escape') { if (s.popover) return this.setState({ popover: null }); if (s.menu) return this.setState({ menu: null }); if (s.palette) return this.setState({ palette: false }); if (s.modal) return this.setState({ modal: null }); if (s.selTb) return this.setState({ selTb: null }); if (Object.keys(s.multi).length) return this.setState({ multi: {} }); if (s.readerFull) return this.setState({ readerFull: false }); if (s.reportFull) return this.setState({ reportFull: null }); return }
    if (s.palette) {
      const rows = this.pRowsCache || []
      if (k === 'ArrowDown') { e.preventDefault(); this.setState({ pIdx: Math.min(rows.length - 1, s.pIdx + 1) }) }
      else if (k === 'ArrowUp') { e.preventDefault(); this.setState({ pIdx: Math.max(0, s.pIdx - 1) }) }
      else if (k === 'Enter' && (e.metaKey || e.ctrlKey) && s.pq.trim()) { e.preventDefault(); this.ask(s.pq.trim()) }
      else if (k === 'Enter' && tag !== 'textarea') { if ((tgt as HTMLElement).dataset?.followup) return; e.preventDefault(); const r = rows[s.pIdx]; r && r.act() }
      return
    }
    if (s.modal === 'thought' && (e.metaKey || e.ctrlKey) && k === 'Enter') { e.preventDefault(); this.saveThought(); return }
    // ⌘↩ on Reports opens the selected report full screen (Backlog "Reading first")
    if (s.screen === 'reports' && !s.modal && !s.palette && (e.metaKey || e.ctrlKey) && k === 'Enter' && tag !== 'input' && tag !== 'textarea') { const id = s.repSel || (s.reports?.[0]?.id); if (id) { e.preventDefault(); this.setState({ reportFull: id }); return } }
    if (s.modal === 'addSource' && k === 'Enter' && s.add.phase === 'found' && tag !== 'textarea') { e.preventDefault(); this.startWatching(); return }
    // Single-key shortcuts never fire while typing, over a sheet/menu/popover, with a selection toolbar open, or on key repeat of a destructive key.
    if (typing || s.modal || s.menu || s.popover || s.selTb || e.isComposing) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.repeat && (k === 'e' || k === 'Backspace' || k === 'Delete' || k === 'n' || k === 'N')) return
    if (k === 'n' || k === 'N') { e.preventDefault(); this.openThought(); return }
    if (k === '[') return this.back()
    if (k === ']') return this.forward()
    if (s.screen === 'inbox') {
      const list = this.visibleItems(); const i = list.findIndex(x => x.id === s.selId)
      if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); const n = list[Math.min(list.length - 1, i + 1)]; n && this.select(n.id, true) }
      else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); const n = list[Math.max(0, i - 1)]; n && this.select(n.id, true) }
      else if (k === 's' && s.selId) this.toggleSave(s.selId)
      else if ((k === 'e' || k === 'Backspace' || k === 'Delete') && s.selId) { e.preventDefault(); this.dismiss(s.selId) }
      else if (k === 'Enter' || k === 'o') this.setState({ readerFull: !s.readerFull })
      else if (k === 'i') this.setState({ inspector: !s.inspector })
      else if (k === 'u' && s.selId) { const it = this.item(s.selId); if (it) this.markRead(s.selId, it.unread) }
    }
  }

  // ---------- small view helpers (prototype) ----------
  segsByOffsets(p: { text: string; start: number }, hls: { start: number; end: number }[]) {
    const out: Any[] = []; const pEnd = p.start + p.text.length
    const ranges = hls.filter(h => h.end > p.start && h.start < pEnd).map(h => [Math.max(h.start, p.start) - p.start, Math.min(h.end, pEnd) - p.start]).sort((a, b) => a[0] - b[0])
    let pos = 0
    for (const [a, b] of ranges) {
      if (a > pos) out.push({ t: p.text.slice(pos, a), bg: 'transparent', sh: 'none' })
      if (b > Math.max(a, pos)) out.push({ t: p.text.slice(Math.max(a, pos), b), bg: 'rgba(255,205,90,0.2)', sh: 'inset 0 -1.5px 0 rgba(255,205,90,0.6)', hl: true })
      pos = Math.max(pos, b)
    }
    if (pos < p.text.length) out.push({ t: p.text.slice(pos), bg: 'transparent', sh: 'none' })
    return out
  }
  seg(opts: Any[], cur: Any, pick: (v: Any) => void) { return opts.map(o => { const [v, l, c] = Array.isArray(o) ? o : [o, o]; const on = v === cur; return { label: l, count: c ?? '', bg: on ? 'var(--seg-on)' : 'transparent', color: on ? 'var(--seg-on-text)' : 'var(--seg-text)', shadow: on ? 'var(--seg-shadow)' : 'none', onClick: (e: Any) => { e && e.stopPropagation && e.stopPropagation(); pick(v) } } }) }
  tabs(opts: Any[], cur: Any, pick: (v: Any) => void) { return opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; const on = v === cur; return { label: l, color: on ? 'var(--gf4f4f6)' : 'var(--g8e8e98)', line: on ? 'var(--o72-12-258)' : 'transparent', onClick: () => pick(v) } }) }
  tg(on: boolean) { return { tgBg: on ? 'oklch(0.6 0.15 258)' : 'var(--w160)', tgKnob: on ? 'translateX(12px)' : 'none' } }
  isLight() { const t = this.setting('appearance.theme') || 'dark'; return t === 'light' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) }
  setSetting(patch: Record<string, unknown>) {
    this.setState((s: Any) => ({ settings: { ...s.settings, ...patch } }))
    this.act('settings.update', { patch }).then(r => r && this.setState({ settings: r }))
  }

  // ---------- palette, ask ----------
  openPalette(prefill = '', scope: string | null = null) {
    this.focusNext = 'paletteEl'
    this.setState({ palette: true, pq: prefill, pIdx: 0, pScope: scope, menu: null, pResults: null, pCorrection: null, pAnswer: null, pAsking: false, pProgress: [], selTb: null }, () => { if (prefill) this.runSearch(prefill) })
  }
  onPq(v: string) {
    this.setState({ pq: v, pIdx: 0, pAnswer: null })
    clearTimeout(this.searchTimer)
    this.searchTimer = setTimeout(() => this.runSearch(v), 80)
  }
  async runSearch(q: string) {
    const s = this.state
    if (!q.trim()) { this.setState({ pResults: null }); return }
    const scope = s.pScope === 'company' ? 'company' : s.pScope === 'firm' ? 'firm' : s.pScope === 'attach' ? 'evidence' : 'all'
    const r = await tryCall<Any>('search.query', { text: q, scope }, null)
    // a correction proposal lives in pCorrection (keyed by its text), so a late or failed search can't drop it
    if (this.state.pq === q) this.setState({ pResults: r })
  }
  async ask(question: string, followup = false) {
    const conv = followup ? this.state.pAnswer?.conversationId : undefined
    this.setState({ pAsking: true, pProgress: [], pAnswerQ: question, ...(followup ? {} : { pAnswer: null }), pFollow: '' })
    try {
      const a = await call<Any>('query.ask', { question, ...(conv ? { conversationId: conv } : {}) })
      this.setState((s: Any) => ({ pAsking: false, pAnswer: { ...a, question, history: followup && s.pAnswer ? [...(s.pAnswer.history || []), { question: s.pAnswer.question, answer: s.pAnswer }] : [] } }))
    } catch (e) {
      this.setState({ pAsking: false, pAnswer: { error: 'I couldn’t reach the AI provider. Showing matching evidence instead.', fallback: true, items: [], citations: [], question } })
    }
  }
  async openCitation(c: Any) {
    if (!c) return
    if (c.documentId) this.openDocument(c.documentId, c.quote)
    else if (c.itemId) { this.setState({ palette: false }); this.go('inbox', { view: 'all', thesisFilter: null, selId: c.itemId, docReader: null, scrollToQuote: c.quote || null }) }
    else if (c.kind === 'note') this.toast('That citation is one of your notes.')
    else this.toast('This source document is no longer in your library.')
  }

  // ---------- notify / alerts ----------
  openNotify(anchor: { type: string; id: string; name: string } | null, text?: string) {
    this.focusNext = 'notifyEl'
    this.setState({ modal: 'notify', menu: null, notify: { anchor, text: text ?? (anchor ? 'Tell me when ' + anchor.name + ' ' : ''), alertId: null, phase: 'edit', alert: null, error: null, channels: ['in_app'] } })
  }
  async openNotifyForAlert(alertId: string) {
    const alerts = await tryCall<AlertDTO[]>('alert.list', {}, [])
    const a = alerts.find(x => x.id === alertId)
    this.setState({ alerts, modal: 'notify', notify: { anchor: null, text: a?.text || '', alertId, phase: a?.status === 'compiled' ? 'confirm' : a?.status === 'failed' ? 'edit' : 'compiling', alert: a || null, error: a?.status === 'failed' ? a.lastError : null, channels: a?.channels?.length ? a.channels : ['in_app'] } })
    if (a && a.status === 'draft') this.waitAlert(alertId)
  }
  async compileAlert() {
    const n = this.state.notify; if (!n || !n.text.trim()) return
    let alertId = n.alertId
    const res = alertId ? await this.act<Any>('alert.update', { id: alertId, text: n.text.trim() }) : await this.act<Any>('alert.compile', { text: n.text.trim(), ...(n.anchor ? { anchor: { type: n.anchor.type, id: n.anchor.id } } : {}) })
    if (!res) return
    alertId = res.alertId || alertId
    this.setState((s: Any) => ({ notify: { ...s.notify, alertId, phase: 'compiling', error: null } }))
    this.waitAlert(alertId!)
  }
  async waitAlert(alertId: string) {
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 500))
      const n = this.state.notify; if (!n || n.alertId !== alertId || this.state.modal !== 'notify') return
      const alerts = await tryCall<AlertDTO[]>('alert.list', {}, [])
      const a = alerts.find(x => x.id === alertId)
      if (a && a.status === 'compiled') { this.setState((s: Any) => ({ alerts, notify: { ...s.notify, phase: 'confirm', alert: a } })); return }
      if (a && a.status === 'failed') { this.setState((s: Any) => ({ alerts, notify: { ...s.notify, phase: 'edit', alert: a, error: 'I couldn’t set this up. ' + (a.lastError || '') } })); return }
    }
  }
  async activateAlert() {
    const n = this.state.notify; if (!n?.alertId) return
    if (!(await this.act('alert.activate', { id: n.alertId, channels: n.channels }))) return
    this.setState({ modal: null, notify: null })
    this.toast('Alert on · ' + (n.alert?.name || 'new alert'))
    this.refreshScreen()
  }

  // ---------- briefings (DEC-091) ----------
  /** "+ New briefing" / Edit: a small sheet with name, report checklist and schedule. */
  openBriefingSheet(b?: BriefingDTO | null, reportIds?: string[]) {
    const sc = b?.schedule || { kind: 'weekdays', at: '07:30', weekday: 1 }
    this.focusNext = 'brNameEl'
    this.setState({ modal: 'briefing', menu: null, brSheet: { id: b?.id || null, name: b?.name || '', reportIds: b ? b.reports.map(r => r.id) : reportIds || [], kind: sc.kind, at: sc.at || '07:30', weekday: sc.weekday ?? 1, error: null, busy: false } })
  }
  async saveBriefing() {
    const f = this.state.brSheet; if (!f || f.busy) return
    if (!f.name.trim()) return this.setState({ brSheet: { ...f, error: 'Name the briefing' } })
    if (!f.reportIds.length) return this.setState({ brSheet: { ...f, error: 'Pick at least one report' } })
    const schedule = f.kind === 'none' ? { kind: 'none' } : { kind: f.kind, at: f.at, ...(f.kind === 'weekly' ? { weekday: f.weekday } : {}) }
    this.setState({ brSheet: { ...f, busy: true, error: null } })
    try {
      const b = f.id ? await call<BriefingDTO>('briefing.update', { id: f.id, patch: { name: f.name.trim(), reportIds: f.reportIds, schedule } })
        : await call<BriefingDTO>('briefing.create', { name: f.name.trim(), reportIds: f.reportIds, schedule })
      this.setState({ modal: null, brSheet: null })
      this.toast((f.id ? 'Updated ' : 'Created briefing ') + b.name + ' · ' + b.scheduleText)
      this.refreshScreen()
    } catch (e) { this.setState((st: Any) => ({ brSheet: { ...st.brSheet, busy: false, error: (e as Error).message || 'Couldn’t save the briefing' } })) }
  }
  async sendBriefing(b: BriefingDTO) {
    if (await this.act('briefing.sendNow', { id: b.id })) this.toast('Building ' + b.name + ' on this Mac…')
  }
  async deleteBriefing(b: BriefingDTO) {
    if (!(await this.act('briefing.delete', { id: b.id }))) return
    this.toast('Deleted ' + b.name, 'Undo', async () => {
      if (await this.act('briefing.create', { name: b.name, reportIds: b.reports.map(r => r.id), schedule: b.schedule })) { if (!b.enabled) { const l = await tryCall<BriefingDTO[]>('briefing.list', {}, []); const n = l.find(x => x.name === b.name); if (n) await this.act('briefing.update', { id: n.id, patch: { enabled: false } }) } this.refreshScreen() }
    })
    this.refreshScreen()
  }
  /** Report row ▸ "Briefings ▸": tag the report in/out of each briefing, or start a new one with it. */
  briefingMenu(e: Any, reportId: string) {
    const bs = this.state.briefings as BriefingDTO[]
    this.menuAt(e, [{ head: true, label: 'Briefings' },
      ...bs.map(b => { const on = b.reports.some(r => r.id === reportId); return { label: b.name, check: on ? '✓' : '', act: async () => { if (await this.act('briefing.setReport', { id: b.id, reportId, on: !on })) { this.toast((on ? 'Removed from ' : 'Added to ') + b.name); this.refreshScreen() } } } }),
      ...(bs.length ? [{ div: true }] : []),
      { label: 'New briefing with this report…', act: () => this.openBriefingSheet(null, [reportId]) }])
  }

  // ---------- reports ----------
  async createReport() {
    const t = this.state.repDraft.trim(); if (!t) return
    const r = await this.act<Any>('report.createFromPrompt', { text: t })
    if (!r) return
    this.setState({ repDraft: '', repSel: r.reportId || this.state.repSel })
    this.refreshScreen()
  }

  // ---------- render ----------
  render() {
    const V = this.state.ready ? this.rv() : { loading: true, sideW: '240px', sideBg: 'transparent', themeAttr: this.isLight() ? 'light' : 'dark' }
    return <Template V={V} />
  }
  rv() {
    const V: Any = {}
    this.rvShell(V); this.rvInbox(V); this.rvScreens(V); this.rvOverlays(V)
    return V
  }

  rvShell(V: Any) {
    const s = this.state, A = 'var(--o78-11-255)'
    const glass = Number(this.setting('appearance.glass') ?? 60), density = this.setting('appearance.density') || 'compact', readerFont = this.setting('appearance.reader_font') || 'serif'
    V.loading = false
    V.sideW = s.sideW + 'px'
    const LT = this.isLight(); V.themeAttr = LT ? 'light' : 'dark'
    V.sideBg = LT ? `rgba(232,233,238,${(0.9 - glass * 0.0055).toFixed(3)})` : `rgba(34,35,42,${(0.86 - glass * 0.0058).toFixed(3)})`
    V.sideBlur = `blur(${Math.round(8 + glass * 0.42)}px) saturate(1.7)`
    V.sheetBg = LT ? `rgba(248,248,250,${(0.97 - glass * 0.003).toFixed(3)})` : `rgba(34,35,41,${(0.95 - glass * 0.0035).toFixed(3)})`
    V.cardPad = density === 'compact' ? '10px 12px 10px 16px' : '15px 14px 15px 18px'
    V.readerFamily = readerFont === 'serif' ? "'New York', ui-serif, 'Iowan Old Style', Charter, Georgia, serif" : "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    const lastIdx = s.status?.lastIndexedAt
    V.lastIndexed = lastIdx ? ago(lastIdx, s.now) + (/\d$/.test(ago(lastIdx, s.now)) ? ' ago' : '') : 'just now'
    V.userName = this.setting('display_name') || 'You'
    V.userInitials = (this.setting('display_name') || 'You').split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    const c: FeedCountsDTO | null = s.counts
    const row = (active: boolean, x: Any) => ({ bg: active ? 'var(--w100)' : 'transparent', color: active ? 'var(--gf4f4f6)' : 'var(--gc8c8d0)', iconColor: active ? A : 'var(--g8c8c96)', count: '', ...x })
    const inb = s.screen === 'inbox' && !s.thesisFilter
    V.navMain = [
      row(inb && s.view !== 'saved', { icon: '◐', label: 'Today', count: c?.remaining || '', onClick: () => this.go('inbox', { view: 'today', thesisFilter: null }) }),
      row(inb && s.view === 'saved', { icon: '☆', label: 'Saved', count: c?.saved || '', onClick: () => this.go('inbox', { view: 'saved', thesisFilter: null }) }),
      row(s.screen === 'reports', { icon: '▦', label: 'Reports', count: '', onClick: () => this.go('reports') })
    ]
    V.navResearch = [
      row(s.screen === 'theses' || s.screen === 'thesis', { icon: '◇', label: 'Theses', count: (s.theses as ThesisDTO[]).length, onClick: () => this.go('theses') }),
      row(s.screen === 'companies' || s.screen === 'company', { icon: '▢', label: 'Companies', count: (s.companies as CompanyListDTO[]).filter(x => x.followed).length, onClick: () => this.go('companies', { listMode: 'following' }) }),
      row(s.screen === 'firms' || s.screen === 'firm', { icon: '◎', label: 'Venture Firms', count: (s.firms as FirmListDTO[]).filter(x => x.followed).length, onClick: () => this.go('firms', { listMode: 'following' }) }),
      row(s.screen === 'people', { icon: '○', label: 'People', count: (s.people as PersonListDTO[]).filter(x => x.followed).length, onClick: () => this.go('people', { listMode: 'following' }) })
    ]
    const dnd = (key: 'theses' | 'companies', id: string) => ({
      onDragStart: (e: Any) => { this.drag = { key, id }; try { e.dataTransfer.effectAllowed = 'move' } catch { /* noop */ } },
      onDragOver: (e: Any) => { e.preventDefault(); if (this.drag && this.drag.key === key && s.dragOver !== id) this.setState({ dragOver: id }) },
      onDrop: (e: Any) => {
        e.preventDefault(); const d = this.drag; this.drag = null
        if (!d || d.key !== key || d.id === id) return this.setState({ dragOver: null })
        const arr = this.pins(key).filter(x => x !== d.id); arr.splice(arr.indexOf(id), 0, d.id)
        this.setState((st: Any) => ({ dragOver: null, settings: { ...st.settings, ['pins.' + key]: arr } }))
        this.act('object.reorderPins', { type: key === 'theses' ? 'thesis' : 'company', ids: arr })
      },
      dropLine: s.dragOver === id ? '1.5px solid var(--o7-14-258)' : '1.5px solid transparent'
    })
    const highlightNew = this.setting('notify.highlight_new') !== false
    V.pinnedT = this.pins('theses').map(id => this.T(id)).filter(Boolean).map(t => row(s.screen === 'thesis' && s.thesisId === t!.id, { label: t!.title, dot: convColor(t!.conviction), count: (highlightNew && t!.fresh) || '', onClick: () => this.goThesis(t!.id), onCtx: (e: Any) => this.menuAt(e, [{ label: 'Open', act: () => this.goThesis(t!.id) }, { label: 'Filter inbox by this thesis', act: () => this.go('inbox', { view: 'all', thesisFilter: t!.id }) }, { div: true }, { label: 'Unpin', act: () => this.pin('thesis', t!.id, false) }]), ...dnd('theses', t!.id) }))
    V.pinnedC = this.pins('companies').map(id => this.C(id)).filter(Boolean).map(co => row(s.screen === 'company' && s.companyId === co!.id, { label: co!.name, tile: col(hueOf(co!.id)), initial: initialOf(co!.name), fresh: highlightNew && co!.hasUnread ? 'var(--o72-12-258)' : 'transparent', onClick: () => this.goCompany(co!.id), onCtx: (e: Any) => this.menuAt(e, [{ label: 'Open', act: () => this.goCompany(co!.id) }, { label: 'Unpin', act: () => this.pin('company', co!.id, false) }]), ...dnd('companies', co!.id) }))
    V.hasPinnedT = V.pinnedT.length > 0; V.hasPinnedC = V.pinnedC.length > 0
    V.hasViews = (s.views as Any[]).length > 0
    V.viewsNav = (s.views as Any[]).map(v => row(s.screen === 'inbox' && s.activeViewId === v.id, { label: v.name, onClick: () => this.go('inbox', { view: v.spec?.segment || 'all', thesisFilter: v.spec?.thesisFilter || null, activeViewId: v.id }), onCtx: (e: Any) => this.menuAt(e, [{ label: 'Delete view', color: '#ff8a80', act: async () => { if (await this.act('view.deleteFeedView', { id: v.id })) { this.toast('Deleted view “' + v.name + '”'); this.refreshAll(false) } } }]) }))
    V.navSources = row(s.screen === 'sources', { count: (s.sources as SourceDTO[]).filter(x => x.enabled && !x.muted).length || '', onClick: () => this.go('sources') })
    V.openPalette = () => this.openPalette()
    V.openAddSource = () => this.openAddSource(false)
    V.openSettings = () => this.openSettings()
    V.openLocal = () => this.openSettings('Local Data')
    V.newThesis = () => this.openDescribeAdd('thesis')
    V.startResize = (e: Any) => { e.preventDefault(); this.rs = { x: e.clientX, w: s.sideW } }
    V.onRootMove = (e: Any) => { if (this.rs) this.setState({ sideW: Math.max(200, Math.min(330, this.rs.w + e.clientX - this.rs.x)) }) }
    V.onRootUp = () => { this.rs = null }
    V.onRootClick = () => {}
    V.backColor = this.hist.length ? 'var(--gc8c8d0)' : 'var(--g4e4e56)'; V.fwdColor = this.fwd.length ? 'var(--gc8c8d0)' : 'var(--g4e4e56)'
    V.onBack = () => this.back(); V.onFwd = () => this.forward()
    V.onCreate = (e: Any) => this.menuAt(e, [
      { label: 'Add thought', hint: 'N', act: () => this.openThought() },
      { label: 'Add link to read', act: () => this.openAddSource(true) },
      { div: true },
      { label: 'Create thesis', act: () => this.openDescribeAdd('thesis') },
      { label: 'Add person…', act: () => this.openDescribeAdd('person') },
      { label: 'Follow company…', act: () => this.openPalette('', 'company') },
      { label: 'Follow venture firm…', act: () => this.openPalette('', 'firm') },
      { label: 'Add source', act: () => this.openAddSource(false) },
      { div: true },
      { label: 'Create report…', act: () => this.goReports() }
    ])
    const titles: Record<string, string> = { theses: 'Theses', companies: 'Companies', firms: 'Venture Firms', people: 'People', sources: 'Sources', reports: 'Reports' }
    V.tbTitle = ''; V.tbSub = ''
    if (s.screen === 'thesis') { const t = s.thesisPage?.thesis || this.T(s.thesisId); V.tbTitle = t ? t.title : ''; V.tbSub = t ? (t.archived ? 'Archived' : ['', 'Skeptical', 'Exploring', 'Forming', 'Conviction rising', 'High conviction'][t.conviction] || '') : '' }
    else if (s.screen === 'company') { const co = s.companyPage || this.C(s.companyId); V.tbTitle = co?.name || ''; V.tbSub = co?.followed ? 'Following' : '' }
    else if (s.screen === 'firm') { const f = s.firmPage || this.F(s.firmId); V.tbTitle = f?.name || ''; V.tbSub = 'Venture firm' }
    else if (titles[s.screen]) V.tbTitle = titles[s.screen]
    V.isInbox = s.screen === 'inbox'
    // M1 / M14 banner slot (top of Today list)
    const banners: Any[] = s.status?.banners || []
    const b = banners.find(x => x.kind === 'auth_expired') || banners.find(x => x.kind === 'source_attention') || banners.find(x => x.kind === 'no_ai_key') || banners.find(x => x.kind === 'daily_cap') || banners.find(x => x.kind === 'ai_usage') || banners.find(x => x.kind === 'email_auth') || banners.find(x => x.kind === 'open_at_login')
    V.bannerOn = !!b && s.screen === 'inbox'
    if (b) {
      V.bannerText = b.text; V.bannerAction = b.action || ''; V.bannerHasAction = !!b.action; V.bannerDismissable = b.kind === 'open_at_login'
      V.bannerAction2 = b.action2 || ''; V.bannerHasAction2 = !!b.action2
      V.onBannerAction2 = () => { if (b.kind === 'daily_cap') { this.setState({ modal: 'settings', settingsTab: 'AI Behavior' }) } }
      V.onBannerAction = () => {
        if (b.kind === 'auth_expired') this.signIn(b.sourceIds[0])
        else if (b.kind === 'source_attention') this.go('sources', { sourcesTab: 'subscribed', srcType: 'Needs attention' })
        else if (b.kind === 'no_ai_key' || b.kind === 'email_auth') this.openSettings('Accounts')
        else if (b.kind === 'open_at_login') this.setSetting({ open_at_login: true })
        else if (b.kind === 'daily_cap') this.act<Any>('processing.readRest', {}).then(r => { if (r) { this.toast(`Reading ${r.released} waiting article${r.released === 1 ? '' : 's'} now — the limit is lifted for today`); this.refreshAll(false) } })
      }
      V.onBannerDismiss = () => this.setSetting({ 'banners.dismissed': [...(this.setting('banners.dismissed') || []), b.kind] })
    }
  }

  pin(type: 'thesis' | 'company', id: string, pin: boolean) {
    const key = type === 'thesis' ? 'pins.theses' : 'pins.companies'
    const arr = (this.setting(key) as string[]) || []
    this.setState((st: Any) => ({ settings: { ...st.settings, [key]: pin ? [...arr.filter(x => x !== id), id] : arr.filter(x => x !== id) } }))
    this.act('object.pin', { type, id, pin }).then(() => this.refreshAll(false))
  }
  openSettings(tab?: string) { this.setState({ modal: 'settings', palette: false, menu: null, ...(tab ? { settingsTab: tab } : {}) }); this.loadAccounts() }
  async loadAccounts() {
    const [ai, bridge] = await Promise.all([tryCall('ai.status', {}, null), tryCall('bridge.status', {}, null)])
    const acct = this.setting('email.account')
    this.setState((s: Any) => ({ ai, bridge, email: { ...s.email, user: s.email.user || acct?.user || '', recipient: s.email.recipient || acct?.recipient || '' } }))
  }
  async signIn(sourceId: string) {
    const r = await this.act<Any>('source.signIn', { id: sourceId })
    if (r?.toast) this.toast(r.toast)
    this.refreshAll(false)
  }
  async openWhy(id: string) {
    if (this.docOnly(id)) return
    this.setState({ modal: 'why', whyId: id, why: null })
    const why = await tryCall<Any>('feed.why', { id }, null)
    if (this.state.whyId === id) this.setState({ why })
  }

  rvInbox(V: Any) {
    const s = this.state; if (s.screen !== 'inbox') return
    const A = 'var(--o72-12-258)'
    const c: FeedCountsDTO = s.counts || { today: 0, all: 0, unread: 0, saved: 0, review: 0, remaining: 0, done: 0, totalToday: 0, sourcesToday: 0 }
    const vt: Record<string, string> = { today: 'Today', all: 'Inbox', unread: 'Unread', saved: 'Saved', review: 'Needs review' }
    const activeView = (s.views as Any[]).find(v => v.id === s.activeViewId)
    V.inboxTitle = activeView ? activeView.name : vt[s.view]
    V.inboxSub = s.view === 'today' ? `${weekdayLong(s.now)} · from ${c.sourcesToday} source${c.sourcesToday === 1 ? '' : 's'} you chose` : s.view === 'review' ? 'Connections I suggested that need your call' : s.view === 'saved' ? 'Everything you kept, newest first' : 'Everything captured, including read items'
    V.remainingLabel = c.remaining ? c.remaining + ' remaining' : 'All caught up'
    V.doneW = Math.round(c.done / Math.max(1, c.totalToday) * 100) + '%'
    V.segs = this.seg([['today', 'Today', c.today], ['all', 'All', c.all], ['unread', 'Unread', c.unread], ['saved', 'Saved', c.saved], ['review', 'Review', c.review]], s.view, v => this.setState({ view: v, activeViewId: null, selId: null }, () => this.refreshAll(false)))
    V.hasFilter = !!s.thesisFilter
    V.filterLabel = s.thesisFilter ? this.T(s.thesisFilter)?.title || '' : ''
    V.clearFilter = () => this.setState({ thesisFilter: null, activeViewId: null }, () => this.refreshAll(false))
    const hasView = (s.views as Any[]).some(v => v.spec?.thesisFilter === s.thesisFilter && (v.spec?.segment || 'all') === s.view)
    V.saveViewLabel = hasView ? 'Saved view' : 'Save as view'
    V.saveView = async () => {
      if (hasView) return
      const t = this.T(s.thesisFilter); const name = t ? t.title : vt[s.view]
      const r = await this.act<Any>('view.saveFeedView', { name, spec: { segment: s.view, thesisFilter: s.thesisFilter, sort: s.sort } })
      if (r) { this.toast('Saved view “' + name + '” to the sidebar'); this.refreshAll(false) }
    }
    V.filterBtnBg = s.thesisFilter ? 'oklch(0.62 0.15 258 / 0.22)' : 'var(--w40)'
    V.onFilterMenu = (e: Any) => this.menuAt(e, [{ label: 'All theses', check: s.thesisFilter ? '' : '✓', act: () => this.setState({ thesisFilter: null }, () => this.refreshAll(false)) }, { div: true }, ...this.thesisMenuItems(t => this.setState({ thesisFilter: t }, () => this.refreshAll(false)), s.thesisFilter).slice(1)])
    const gb = this.groupBy()
    V.groupLabel = ({ section: 'Group: Sections', source: 'Group: Source', thesis: 'Group: Thesis', none: s.sort === 'newest' ? 'Newest' : 'Relevance' } as Any)[gb]
    const setGroup = (g: string) => this.setSetting({ 'appearance.group_today_by': g })
    const setSort = (o: string) => this.setState({ sort: o }, () => this.refreshAll(false))
    V.onGroupMenu = (e: Any) => this.menuAt(e, [{ head: true, label: 'Group by' }, { label: 'Sections', check: gb === 'section' ? '✓' : '', act: () => setGroup('section') }, { label: 'Source', check: gb === 'source' ? '✓' : '', act: () => setGroup('source') }, { label: 'Thesis', check: gb === 'thesis' ? '✓' : '', act: () => setGroup('thesis') }, { label: 'No grouping', check: gb === 'none' ? '✓' : '', act: () => setGroup('none') }, { div: true }, { head: true, label: 'Sort' }, { label: 'Relevance', check: s.sort === 'relevance' ? '✓' : '', act: () => setSort('relevance') }, { label: 'Newest first', check: s.sort === 'newest' ? '✓' : '', act: () => setSort('newest') }, { div: true }, { label: 'Customize…', act: () => this.openCustomize('feed', null, 'Today') }])
    V.inspBtnBg = s.inspector ? 'var(--w120)' : 'var(--w40)'
    V.toggleInspector = () => this.setState({ inspector: !s.inspector })
    const ids = Object.keys(s.multi)
    V.hasMulti = ids.length > 0; V.multiCount = ids.length
    V.bulkSave = async () => { this.patchItems(ids, { saved: true }); this.setState({ multi: {} }); if (await this.act('feed.save', { ids, saved: true })) this.toast(ids.length + ' items saved'); this.refreshAll(false) }
    V.bulkRead = async () => { this.patchItems(ids, { unread: false }); this.setState({ multi: {} }); await this.act('feed.markRead', { ids, read: true }); this.refreshAll(false) }
    V.bulkDismiss = async () => {
      this.patchItems(ids, { dismissed: true }); this.setState((st: Any) => ({ multi: {}, selId: st.multi[st.selId] ? null : st.selId }))
      if (await this.act('feed.dismiss', { ids })) this.toast(ids.length + ' items dismissed', 'Undo', async () => { await this.act('feed.undismiss', { ids }); this.refreshAll(false) })
      this.refreshAll(false)
    }
    V.bulkClear = () => this.setState({ multi: {} })
    V.listRef = this.ref('listEl')
    V.hoverOff = () => this.setState({ hoverId: null })
    const groups = this.groupedItems()
    V.groups = groups.map(g => {
      const colp = !!s.collapsed[g.key]
      return { label: g.label, count: g.items.length || '', chev: colp ? '▸' : '▾', hint: g.hint || '', onHint: () => this.go('theses', {}), onToggle: () => this.setState((st: Any) => ({ collapsed: { ...st.collapsed, [g.key]: !colp } })), items: colp ? [] : g.items.map(it => {
        const sel = it.id === s.selId, multi = !!s.multi[it.id], hov = s.hoverId === it.id, t = this.T(it.thesis)
        return { id: it.id, compact: !!g.compact, full: !g.compact, source: it.source, time: itemTime(it.publishedAt, it.surfacedAt, s.now), srcType: it.srcType, title: it.title, summary: it.summary, reason: it.reason, review: it.review,
          bg: multi ? 'oklch(0.62 0.15 258 / 0.16)' : sel ? 'var(--w75)' : hov ? 'var(--w35)' : 'transparent',
          ring: multi ? 'inset 0 0 0 1px oklch(0.7 0.14 258 / 0.5)' : sel ? 'inset 0 0 0 1px var(--w100), 0 1px 2px var(--k200)' : 'none',
          dotColor: it.unread ? A : 'transparent', titleColor: it.unread ? 'var(--gf4f4f6)' : 'var(--gc4c4cc)', titleWeight: it.unread ? 600 : 500,
          actOp: hov ? 1 : 0, actPe: hov ? 'auto' : 'none', metaPad: hov ? '100px' : '0',
          srcColor: col(hueOf(it.srcId + it.source)), srcInitial: initialOf(it.source),
          hasStance: !!it.stance && !!t,
          stanceColor: stanceColor(it.stance || 'neutral'), stanceBg: it.stance === 'support' ? 'oklch(0.72 0.12 155 / 0.12)' : it.stance === 'contra' ? 'oklch(0.75 0.12 65 / 0.13)' : 'oklch(0.72 0.1 255 / 0.12)',
          stanceLabel: stanceLabel(it.stance || 'neutral'), thesisName: t ? t.title : '',
          chips: it.cos.slice(0, 2).map(cid => { const co = this.C(cid); return co ? { label: co.name, tile: col(hueOf(co.id)), onClick: (e: Any) => { e.stopPropagation(); this.goCompany(cid) }, onCtx: (e: Any) => this.menuAt(e, [{ label: 'Open ' + co.name, act: () => this.goCompany(cid) }, { label: 'Not about ' + co.name, act: async () => { if (await this.act('link.rejectEntity', { documentId: it.documentId, entityType: 'company', entityId: cid })) { this.toast('Okay. Not about ' + co.name + '.'); this.refreshAll(false) } } }]) } : null }).filter(Boolean),
          savedGlyph: it.saved && !hov ? '★' : '', saveIcon: it.saved ? '★' : '☆', saveColor: it.saved ? 'var(--o82-13-85)' : 'var(--gc8c8d0)', saveTitle: it.saved ? 'Unsave  S' : 'Save  S',
          onClick: (e: Any) => this.clickItem(e, it.id), onCtx: (e: Any) => this.itemMenu(e, it.id), onEnter: () => s.hoverId !== it.id && this.setState({ hoverId: it.id }),
          onSave: (e: Any) => { e.stopPropagation(); this.toggleSave(it.id) }, onDismiss: (e: Any) => { e.stopPropagation(); this.dismiss(it.id) },
          onThought: (e: Any) => { e.stopPropagation(); this.openThought(it.thesis) }, onMore: (e: Any) => this.itemMenu(e, it.id) }
      }) }
    })
    V.listEmpty = !groups.some(g => g.items.length)
    V.emptyTitle = s.view === 'saved' ? 'Nothing saved yet' : s.view === 'review' ? 'Nothing to review' : 'You’re caught up'
    V.emptySub = s.view === 'saved' ? 'Press S on any item, or select a passage while reading, to keep it.' : s.view === 'review' ? 'When I’m unsure how something connects to your theses, it will wait here for you.' : 'New items arrive only from sources, companies, firms and theses you chose. Add a source to widen what comes in.'
    V.emptyShowAdd = s.view === 'today' || s.view === 'all'
    V.emptyAddSource = () => this.openAddSource(false)
    V.listDisplay = s.readerFull ? 'none' : 'flex'
    V.fullIcon = s.readerFull ? '⇥' : '⤢'
    V.toggleFull = () => this.setState({ readerFull: !s.readerFull })
    const rd: ReaderDTO | null = s.reader && readerKey(s.reader) === s.selId ? s.reader : null
    const it = this.item(s.selId)
    const pinnedDoc = !!s.docReader && readerKey(s.docReader) === s.selId
    const r = it && (!it.dismissed || pinnedDoc) ? it : null
    V.hasSel = !!r; V.noSel = !r
    V.inspOn = s.inspector && !!r
    V.progW = Math.round(s.progress * 100) + '%'
    V.readerRef = this.ref('readerEl')
    V.noteRef = this.ref('noteEl')
    V.onReaderScroll = (e: Any) => { const el = e.currentTarget; const p = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight); if (Math.abs(p - s.progress) > 0.01) this.setState({ progress: Math.min(1, p) }); if (s.selTb) this.setState({ selTb: null }) }
    V.onArticleUp = () => setTimeout(() => {
      const sel = window.getSelection(); const t = sel ? sel.toString().trim().replace(/\s+/g, ' ') : ''
      if (!sel || t.length < 6 || !sel.rangeCount) { if (this.state.selTb) this.setState({ selTb: null }); return }
      const range = sel.getRangeAt(0)
      const off = this.selectionOffsets(range)
      const rc = range.getBoundingClientRect()
      this.setState({ selTb: { x: rc.left + rc.width / 2, y: rc.top - 8, text: t, start: off?.start ?? -1, end: off?.end ?? -1 } })
    }, 0)
    if (!r) return
    const main = this.T(r.thesis)
    const doc = rd?.document
    const hl = doc?.highlights || []
    V.r = {
      ...r, time: itemTime(r.publishedAt ?? doc?.publishedAt, r.surfacedAt, s.now), mins: doc?.minutes ?? r.minutes ?? 1, url: r.url || '', srcColor: col(hueOf(r.srcId + r.source)), srcInitial: initialOf(r.source),
      hasUrl: !!r.url, summaryOn: !!doc?.summary && this.setting('ai.summarize') !== false, aiSummary: doc?.summary || '',
      accessLabel: doc?.accessLabel || '', partial: doc?.access === 'partial',
      failed: doc?.status === 'failed', failedMsg: 'This document failed to process.', onRetry: async () => { if (await this.act('document.retry', { id: doc!.id })) { this.toast('Retrying…'); this.loadReader(r.id) } },
      pending: doc?.status === 'pending_capture' || doc?.status === 'fetched' || doc?.status === 'processing', pendingMsg: doc?.status === 'pending_capture' ? (doc.processingError || 'Waiting for sign-in. Retry from Sources ▸ On-demand history.') : 'Reading… summary and evidence will appear here.',
      paras: (doc?.paragraphs || []).map(p => ({ start: p.start, segs: this.segsByOffsets(p, hl) })),
      orphanedV: (doc?.orphaned || []).map(o => ({ text: o.quote })), hasOrphaned: !!doc?.orphaned?.length,
      saveIcon: r.saved ? '★' : '☆', saveLabel: r.saved ? 'Saved' : 'Save', saveBg: r.saved ? 'oklch(0.8 0.13 85 / 0.14)' : 'var(--w40)', saveColor: r.saved ? 'var(--o86-12-85)' : 'var(--gd8d8de)',
      onSave: () => this.toggleSave(r.id), onDismiss: () => this.dismiss(r.id),
      onOriginal: (e: Any) => { e.preventDefault(); if (doc) this.act('document.open', { id: doc.id }) },
      onAttach: (e: Any) => this.menuAt(e, this.thesisMenuItems(t => this.attach(r.id, t), r.thesis)),
      onMore: () => this.feedback(r.id, 'more'),
      onLess: () => this.feedback(r.id, 'less'),
      onWhy: () => this.openWhy(r.id),
      why: r.why, hasWhy: !!r.why,
      showSuggest: r.review && !!r.suggest,
      sugPath: r.suggest ? this.path(r.suggest.thesis) : '', sugStance: r.suggest ? (r.suggest.stance === 'contra' ? 'contradicting' : 'supporting') : '', sugColor: r.suggest ? stanceColor(r.suggest.stance) : '',
      sugConfirm: async () => { if (!r.suggest) return; if (await this.act('link.confirm', { relId: r.suggest.relId })) { this.toast('Attached to ' + this.path(r.suggest.thesis), 'Open thesis', () => this.goThesis(r.suggest!.thesis)); this.refreshAll(false) } },
      sugChange: (e: Any) => this.menuAt(e, this.thesisMenuItems(t => this.changeLink(r, t), r.suggest?.thesis)),
      sugDismiss: async () => { if (!r.suggest) return; if (await this.act('link.reject', { relId: r.suggest.relId })) { this.toast('Okay. I won’t connect these.'); this.refreshAll(false) } },
      thesesV: (rd?.theses || []).map(t => ({ name: this.path(t.id) || t.title, sub: (t.status === 'accepted' ? stanceLabel(t.stance) : stanceLabel(t.stance) + ' (suggested)') + ' · ' + t.evidenceCount + ' evidence', color: t.id === r.thesis ? stanceColor(t.stance) : 'var(--g80808a)', dashed: t.status !== 'accepted', onClick: () => this.goThesis(t.id),
        onCtx: (e: Any) => this.menuAt(e, [{ label: 'Open thesis', act: () => this.goThesis(t.id) }, { label: 'Not related', color: '#ff8a80', act: async () => { if (await this.act('link.reject', { relId: t.relId })) { this.toast('Okay. Not related.'); this.refreshAll(false) } } }]),
        onNotRelated: async (e: Any) => { e.stopPropagation(); if (await this.act('link.reject', { relId: t.relId })) { this.toast('Okay. Not related.'); this.refreshAll(false) } } })),
      cosV: (rd?.companies || []).map(co => ({ name: co.name, stage: [co.stage, co.hq].filter(Boolean).join(' · '), tile: col(hueOf(co.id)), initial: initialOf(co.name), followLabel: co.followed ? 'Following' : 'Follow', followBg: co.followed ? 'transparent' : 'oklch(0.6 0.15 258)', followColor: co.followed ? 'var(--ga6a6b0)' : '#fff', onFollow: () => this.follow('company', co.id, co.name, co.followed), onClick: () => this.goCompany(co.id) })),
      // Follow on firms and people too, like companies (DEC-096)
      firmsV: (rd?.firms || []).map(f => ({ name: f.name, tile: col(hueOf(f.id)), initial: initialOf(f.name), onClick: () => this.goFirm(f.id), followLabel: f.followed ? 'Following' : 'Follow', followBg: f.followed ? 'transparent' : 'oklch(0.6 0.15 258)', followColor: f.followed ? 'var(--ga6a6b0)' : '#fff', onFollow: (e: Any) => { e.stopPropagation(); this.follow('firm', f.id, f.name, f.followed) } })),
      peopleV: (rd?.people || []).map(p => ({ name: p.name, tile: col(hueOf(p.id)), initial: initialOf(p.name), sub: p.role || 'Person', onClick: () => {}, followLabel: p.followed ? 'Following' : 'Follow', followBg: p.followed ? 'transparent' : 'oklch(0.6 0.15 258)', followColor: p.followed ? 'var(--ga6a6b0)' : '#fff', onFollow: (e: Any) => { e.stopPropagation(); this.follow('person', p.id, p.name, p.followed) } })),
      extractOn: this.setting('ai.extract') !== false,
      extractCount: (rd?.evidence || []).length,
      extractsV: (rd?.evidence || []).map(x => ({ text: x.assertion === 'attributed_opinion' && x.attributedTo ? x.attributedTo + ' argues: ' + x.claim : x.claim, where: x.kept ? 'Saved' + (main ? ' · ' + main.title : '') : x.origin === 'user_highlight' ? 'Your highlight' : 'Suggested', keepLabel: x.kept ? '✓ Saved' : '+ Keep', keepColor: x.kept ? 'var(--o78-12-155)' : 'var(--o8-1-255)', bg: x.kept ? 'rgba(255,205,90,0.06)' : 'var(--w30)', border: x.kept ? 'rgba(255,205,90,0.16)' : 'var(--w60)', onKeep: () => !x.kept && this.keepEvidence(x.id) })),
      notesV: (rd?.notes || []).map(n => ({ text: n.text, type: KIND_TO_TYPE[n.kind] || 'Personal observation', where: n.thesisId ? this.path(n.thesisId) : n.aiState === 'failed' ? 'Not organized yet' : '' }))
    }
    V.noteDraft = s.noteDraft
    V.onNote = (e: Any) => this.setState({ noteDraft: e.target.value })
    V.noteHas = s.noteDraft.trim().length > 10
    const p = this.propose(s.noteDraft, r.thesis)
    const nth = s.noteThesis || p.thesis, nty = s.noteType || p.type
    V.notePath = nth ? this.path(nth) : 'No thesis'; V.noteType = nty
    V.noteChange = (e: Any) => this.menuAt(e, this.thesisMenuItems(t => this.setState({ noteThesis: t }), nth))
    V.noteTypeCycle = () => this.setState({ noteType: NOTE_TYPES[(NOTE_TYPES.indexOf(nty) + 1) % 3] })
    V.noteAccept = async () => {
      const text = s.noteDraft.trim()
      const res = await this.act<Any>('note.create', { text, kind: TYPE_TO_KIND[nty], kindDecided: true, documentId: rd?.document.id, thesisId: nth, anchor: nth ? { type: 'thesis', id: nth } : { type: 'none' } } as Any)
      if (!res) return
      this.setState({ noteDraft: '', noteThesis: null, noteType: null })
      this.toast(nth ? 'Saved to ' + this.path(nth) : 'Note saved', nth ? 'View' : undefined, nth ? () => this.goThesis(nth) : undefined)
      this.loadReader(r.id)
    }
    V.noteDismiss = () => this.setState({ noteDraft: '', noteThesis: null, noteType: null })
  }

  async changeLink(r: FeedItemDTO, thesisId: string) {
    if (!r.suggest) return this.attach(r.id, thesisId)
    if (await this.act('link.change', { relId: r.suggest.relId, thesisId, stance: r.suggest.stance })) { this.toast('Attached to ' + this.path(thesisId), 'Open thesis', () => this.goThesis(thesisId)); this.refreshAll(false) }
  }

  /** Map a DOM selection to [start,end) offsets in the document text using paragraph data-pstart anchors. */
  selectionOffsets(range: Range): { start: number; end: number } | null {
    const pos = (node: Node, offset: number): number | null => {
      let el: HTMLElement | null = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement | null
      while (el && !el.dataset?.pstart) el = el.parentElement
      if (!el) return null
      const pre = document.createRange()
      pre.setStart(el, 0)
      try { pre.setEnd(node, offset) } catch { return null }
      return Number(el.dataset.pstart) + pre.toString().length
    }
    const a = pos(range.startContainer, range.startOffset), b = pos(range.endContainer, range.endOffset)
    if (a == null || b == null || b <= a) return null
    const text = (this.state.reader as ReaderDTO | null)?.document.text || ''
    let start = a, end = b
    while (start < end && /\s/.test(text[start])) start++
    while (end > start && /\s/.test(text[end - 1])) end--
    return { start, end }
  }

  // ---------- customize ----------
  openCustomize(objectType: 'company' | 'firm' | 'thesis' | 'feed', objectId: string | null, name: string) {
    this.focusNext = 'cuEl'
    this.setState({ modal: 'customize', menu: null, cuScope: { objectType, objectId, name }, cuDraft: '', cuBusy: false, cuError: null })
  }
  async applyCustomize() {
    const s = this.state; const sc = s.cuScope; const t = s.cuDraft.trim(); if (!t || !sc || s.cuBusy) return
    this.setState({ cuBusy: true, cuError: null })
    try {
      const r = await call<Any>('view.customize', { objectType: sc.objectType, objectId: sc.objectId, instruction: t })
      this.setState({ modal: null, cuBusy: false, cuDraft: '', ...(sc.objectType === 'company' ? { companyTab: 'Overview' } : {}) })
      const scopeText = sc.objectType === 'feed' ? 'Today' : r.scope === 'type' ? ({ company: 'all company pages', firm: 'all firm pages', thesis: 'all thesis pages' } as Any)[sc.objectType] : sc.name + '’s page'
      this.toast('Updated ' + scopeText, 'Undo', async () => { if (await this.act('view.undo', { viewId: r.viewId })) { this.toast('Restored the previous layout'); this.refreshAll(false) } })
      this.refreshAll(false)
    } catch (e) {
      this.setState({ cuBusy: false, cuError: e instanceof ApiError && e.code === 'AI_UNAVAILABLE' ? e.message : 'I couldn’t turn that into a layout change. Try naming a section, field or order.' })
    }
  }

  confirmMerge(type: string, fromId: string, fromName: string, intoId: string, intoName: string) { confirmMergeImpl(this, type, fromId, fromName, intoId, intoName) }

  // Remaining screens and overlays live in viewmodel modules to keep this file readable.
  rvScreens(V: Any) { rvScreens(this, V) }
  rvOverlays(V: Any) { rvOverlays(this, V) }
}

/** Selection key of a reader opened by document: its feed item when it has one, else "doc:<documentId>". */
function readerKey(r: ReaderDTO): string { return r.item?.id || 'doc:' + r.document.id }
/** The feed-item shape the reader needs, for a document that has no feed item. Actions on it are no-ops or document-level. */
function readerItem(r: ReaderDTO): FeedItemDTO {
  if (r.item) return r.item
  const d = r.document
  return {
    id: 'doc:' + d.id, documentId: d.id, group: 'sources', surfacedAt: d.fetchedAt, publishedAt: d.publishedAt, source: d.siteName || (d.url ? d.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : 'Your library'),
    srcId: 'library', srcType: 'In your library', url: d.url, title: d.title, summary: d.summary || '', why: '', reason: 'In your library · not in your feed', reasons: [],
    thesis: r.theses.find(t => t.status === 'accepted')?.id || null, stance: null, theses: r.theses.map(t => t.id), cos: r.companies.map(c => c.id), firms: r.firms.map(f => f.id),
    unread: false, saved: false, dismissed: false, review: false, suggest: null, novel: false, alert: false, docStatus: d.status, minutes: d.minutes, access: d.access, hidden: null
  }
}

// Late imports to avoid a cycle at module-evaluation time.
import { rvScreens } from './vm/screens'
import { rvOverlays, confirmMergeImpl } from './vm/overlays'
export { PRIVACY_COPY, OPEN_AT_LOGIN_COPY, FREQ_LABEL, LABEL_FREQ, PRIO_LABEL, KIND_TO_TYPE, TYPE_TO_KIND, NOTE_TYPES, monthYear, longDate, shortDate }
