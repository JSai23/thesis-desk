// Port of the prototype's rvOverlays() plus the RFC §1A.7 additions (M1 cards, M2 Ask, M5 Notify, M7 popover, M10 reset sheet, M11 accounts).
import type { Controller } from '../Controller'
import { col, convColor, stanceColor, stanceLabel, hueOf, initialOf, shortDate, ago, itemTime } from '../util'
import { PRIVACY_COPY, OPEN_AT_LOGIN_COPY, NOTE_TYPES, KIND_TO_TYPE } from '../Controller'
import type { CompanyListDTO, FirmListDTO, ThesisDTO, SourceDTO } from '../../shared/dto'

type Any = any

export function rvOverlays(c: Controller, V: Any) {
  const s = c.state
  V.stop = (e: Any) => e.stopPropagation()
  V.stopMD = (e: Any) => { e.preventDefault(); e.stopPropagation() }
  V.closeModal = () => c.setState({ modal: null })
  V.selTbOn = !!s.selTb && s.screen === 'inbox'
  if (s.selTb) {
    V.selX = s.selTb.x + 'px'; V.selY = s.selTb.y + 'px'
    const sel = s.selTb; const it = c.item(s.selId)
    const pos = { clientX: sel.x - 100, clientY: sel.y + 4, type: 'contextmenu' }
    const ok = sel.start >= 0
    V.selActions = [
      { label: '★ Save as evidence', bg: 'oklch(0.6 0.15 258 / 0.35)', color: '#fff', onClick: () => ok && c.saveHighlight(sel) },
      { label: 'Add to thesis…', onClick: () => c.menuAt(pos, c.thesisMenuItems(t => ok && c.saveHighlight(sel, t), it && it.thesis)) },
      { label: 'Add note', onClick: () => { c.setState({ noteDraft: '“' + sel.text.slice(0, 120) + (sel.text.length > 120 ? '…' : '') + '” — ', selTb: null, inspector: true }); c.focusNext = 'noteEl' } },
      { label: 'Attach to company…', onClick: () => { const r = c.state.reader; const ids = new Set([...(r?.companies || []).map((x: Any) => x.id), ...(c.state.companies as CompanyListDTO[]).filter(x => x.followed).map(x => x.id)]); c.menuAt(pos, [{ head: true, label: 'Attach to company' }, ...[...ids].map(id => c.C(id)).filter(Boolean).map(co => ({ label: co!.name, act: () => ok && c.saveHighlight(sel, null, co!.id) }))]) } },
      { label: 'Ask', onClick: () => c.openPalette(sel.text.split(' ').slice(0, 12).join(' ')) }
    ].map(a => ({ bg: 'transparent', color: 'var(--ge8e8ec)', ...a }))
  }

  V.paletteOn = s.palette
  if (s.palette) {
    const rows = paletteRows(c); let k = 0
    c.pRowsCache = rows.filter(r => r.isRow)
    V.pRows = rows.map(r => { if (!r.isRow) return r; const idx = k++; return { ...r, bg: idx === s.pIdx ? 'var(--w90)' : 'transparent', onClick: () => r.act(), onEnter: () => s.pIdx !== idx && c.setState({ pIdx: idx }) } })
    V.pEmpty = !c.pRowsCache.length && !s.pAnswer && !s.pAsking; V.pq = s.pq
    V.pEmptyText = 'Nothing in your library matches “' + s.pq + '”.'
    V.onPq = (e: Any) => c.onPq(e.target.value)
    V.pScopeOn = !!s.pScope; V.pScopeLabel = s.pScope === 'company' ? 'Follow company' : s.pScope === 'firm' ? 'Follow firm' : s.pScope === 'attach' ? 'Attach evidence to ' + (c.T(s.thesisId)?.title || 'thesis') : ''
    V.paletteRef = c.ref('paletteEl')
    V.closePalette = () => c.setState({ palette: false })
    const nDocs = s.status?.counts?.documents
    V.pFooter = typeof nDocs === 'number' ? `Searching ${nDocs.toLocaleString('en-US')} document${nDocs === 1 ? '' : 's'} on this Mac` : ''
    // M2 answer panel
    V.pAnswerOn = !!s.pAnswer || s.pAsking
    V.pResultsOn = !V.pAnswerOn
    V.pAsking = s.pAsking
    V.pThinking = (s.pProgress as Any[]).map(p => ({ text: p.text || p.step }))
    V.pScopeLine = (s.pProgress as Any[]).find(p => p.step === 'scope')?.text || ''
    const a = s.pAnswer
    if (a) {
      V.pQ = a.question
      V.pBacklog = a.backlog > 0 ? `${a.backlog.toLocaleString('en-US')} article${a.backlog === 1 ? ' is' : 's are'} still being read — this answer may be incomplete.` : ''
      V.pErr = a.error || ''
      V.pHasErr = !!a.error
      // Display numbers are dense, in order of first use in the answer ([1][2][3], never [1][2][31]); each still opens
      // the document its original context number points to.
      const order: number[] = []
      const use = (ns: number[] | undefined) => (ns || []).forEach(n => { if (!order.includes(n)) order.push(n) })
      for (const type of ['fact', 'interpretation', 'user_note']) (a.items || []).filter((x: Any) => x.type === type).forEach((x: Any) => use(x.citations))
      use(((a.citations || []) as Any[]).map(x => x.n))
      const shown = new Map(order.map((n, i) => [n, i + 1]))
      const cites = ((a.citations || []) as Any[]).slice().sort((x, y) => (shown.get(x.n) || 0) - (shown.get(y.n) || 0))
      const cite = (ns: number[]) => [...new Set(ns || [])].filter(n => cites.some(x => x.n === n)).map(n => ({ label: '[' + shown.get(n) + ']', onClick: () => c.openCitation(cites.find(x => x.n === n)) }))
      V.pFacts = (a.items || []).filter((x: Any) => x.type === 'fact').map((x: Any) => ({ text: x.text, cites: cite(x.citations), quote: (x.quotes || [])[0] || '' }))
      V.pInterp = (a.items || []).filter((x: Any) => x.type === 'interpretation').map((x: Any) => ({ text: x.text, cites: cite(x.citations || []) }))
      V.pNotes = (a.items || []).filter((x: Any) => x.type === 'user_note').map((x: Any) => ({ text: x.text, cites: cite(x.citations || []) }))
      V.pHasFacts = V.pFacts.length > 0; V.pHasInterp = V.pInterp.length > 0; V.pHasNotes = V.pNotes.length > 0
      V.pInsufficient = !!a.insufficient
      V.pInsufficientText = 'I don’t have evidence for that in your library.'
      V.pCitations = cites.map(x => ({ n: '[' + shown.get(x.n) + ']', src: x.source, date: shortDate(x.date), quote: x.quote, title: x.title, onClick: () => c.openCitation(x) }))
      V.pHasCitations = V.pCitations.length > 0
      V.pFallback = (a.fallbackEvidence || []).map((x: Any) => ({ text: x.claim, src: x.source, onClick: () => c.openCitation(x) }))
      V.pHasFallback = V.pFallback.length > 0
      V.pFollowups = (a.followups || []).map((f: string) => ({ label: f, onClick: () => c.ask(f, true) }))
      V.pHistory = (a.history || []).map((h: Any) => ({ q: h.question }))
    }
    V.pFollow = s.pFollow || ''
    V.onPFollow = (e: Any) => c.setState({ pFollow: e.target.value })
    V.onPFollowKey = (e: Any) => { if (e.key === 'Enter' && (s.pFollow || '').trim()) { e.preventDefault(); e.stopPropagation(); c.ask(s.pFollow.trim(), true) } }
  }

  V.mAddSource = s.modal === 'addSource'
  if (V.mAddSource) {
    const a = s.add, setA = (o: Any) => c.setState((st: Any) => ({ add: { ...st.add, ...o } }))
    V.addRef = c.ref('addEl')
    V.addTitle = a.once ? 'Add a link to read' : 'Add a source'
    V.onceSegs = c.seg([[false, 'Keep watching'], [true, 'Read once']], a.once, v => { setA({ once: v }); if (a.q.trim()) setTimeout(() => c.onAddQ(c.state.add.q), 0) })
    V.addQ = a.q; V.onAddQ = (e: Any) => c.onAddQ(e.target.value)
    V.addPlaceholder = a.once ? 'Paste a link, or paste text to read once' : 'Paste a site, feed, newsletter address, or describe a search'
    V.addExamples = (a.once ? ['x.com/someone/status/123', 'techcrunch.com/2026/09/30/…', 'Paste an article’s text'] : ['@karpathy', 'a16z.com/news-content', 'techcrunch.com/category/startups/feed', 'newsletter@strictlyvc.com']).map(x => ({ label: x, onClick: () => c.onAddQ(x) }))
    V.addIdle = a.phase === 'idle'; V.addDetecting = a.phase === 'detecting'
    const d = a.det
    const st = d?.status
    // Read once takes any link: "can't watch" (X, LinkedIn, unsupported hosts) is about monitoring, not reading one page
    const linkish = /^\s*(https?:\/\/|www\.|[a-z0-9-]+(\.[a-z0-9-]+)+\/)/i.test(a.q)
    V.addFound = a.phase === 'found' && (st === 'found' || st === 'text' || (a.once && (st !== 'unsupported' || linkish)))
    V.addCard = a.phase === 'found' && !V.addFound
    V.addWatching = !a.once && st === 'found'
    if (d) {
      V.det = { ...d, name: d.name || a.q, type: d.typeLabel || (a.once ? 'Link' : ''), handle: (d.canonicalLocator || a.q).replace(/^https?:\/\//, '').replace(/^search:/, ''), tile: col(hueOf(d.name || a.q)), initial: initialOf(d.name || a.q),
        postCount: (d.recent || []).length, postsV: (d.recent || []).map((r: Any) => ({ t: r.title })), suggest: d.suggestedMode === 'all' ? 'All posts' : d.suggestedMode === 'custom' ? 'Custom instruction' : 'Only posts relevant to my theses', relatedV: (d.relatedThesisIds || []).map((id: string) => c.T(id)).filter(Boolean).map((t: ThesisDTO) => ({ t: t.title })),
        nothingRecent: !(d.recent || []).length,
        metaLine: a.once ? (d.status === 'text' ? 'Pasted text · will be read once' : (d.typeLabel && d.status === 'found' ? d.typeLabel + ' · ' : 'Link · ') + 'read once, not monitored') : `${d.typeLabel || 'Source'} · ${(d.recent || []).length ? (d.recent || []).length + ' recent posts' : 'Nothing captured in the last week.'} · suggested: ${d.suggestedMode === 'all' ? 'All posts' : d.suggestedMode === 'custom' ? 'Custom instruction' : 'Only posts relevant to my theses'}` }
      // M1 cards
      const cards: Record<string, Any> = {
        login_required: { glyph: '🔒', title: 'Sign-in needed', text: 'This source needs you to sign in before I can monitor it. Sign in once in the source window; your session stays on this Mac.', primary: 'Sign in', note: 'A sign-in window opens for this site. Your session stays on this Mac.' },
        unsupported: { glyph: '⊘', title: 'Can’t watch this', text: d.message || 'Research Workspace can’t monitor this kind of source yet. Paste a link with Read once instead.' },
        unreachable: { glyph: '!', title: 'Couldn’t reach this', text: d.message || 'The site didn’t respond. Check the address and try again.', retry: true },
        blocked: { glyph: '⊘', title: 'Blocked by the site', text: d.message || 'This site asks automated readers not to check it, so I won’t watch it. You can still use Read once.' },
        article: { glyph: '↗', title: 'This looks like a single article', text: d.message || 'This looks like a single article. Read it once instead?', readOnce: true }
      }
      const card = cards[st] || null
      V.addCardOn = V.addCard && !!card
      if (card) V.addCardV = { ...card, hasRetry: !!card.retry, hasReadOnce: !!card.readOnce, hasNote: !!card.note, onRetry: () => c.onAddQ(a.q), onReadOnce: () => { setA({ once: true }); setTimeout(() => c.onAddQ(c.state.add.q), 0) } }
      V.addLoginNeeded = st === 'login_required'
    }
    V.addError = a.error || ''; V.addHasError = !!a.error
    const opts: [string, string, string][] = [['all', 'All posts', 'Everything this source publishes'], ['relevant', 'Only posts relevant to my theses', 'I’ll check each item against your theses and followed companies'], ['portfolio', 'Only portfolio announcements', 'Funding, launches and hires from companies they back'], ['custom', 'Custom instruction', 'Describe what you want in your own words']]
    V.modeOpts = opts.map(([v, l, dd]) => { const on = a.mode === v; return { label: l, desc: dd, border: on ? 'oklch(0.7 0.14 258 / 0.6)' : 'var(--w70)', bg: on ? 'oklch(0.62 0.15 258 / 0.1)' : 'transparent', ring: on ? 'var(--o72-14-258)' : 'var(--w300)', dot: on ? 'var(--o75-14-258)' : 'transparent', onClick: () => setA({ mode: v }) } })
    V.addCustom = a.mode === 'custom' || a.mode === 'portfolio'; V.addInstr = a.instr; V.onAddInstr = (e: Any) => setA({ instr: e.target.value })
    V.addFreqSegs = c.seg(['Real-time', 'Hourly', 'Daily', 'Weekly'], a.freq, v => setA({ freq: v }))
    V.addThChips = [...new Set([...a.theses, ...c.pins('theses'), ...(c.state.theses as ThesisDTO[]).slice(0, 6).map(t => t.id)])].filter(id => c.T(id)).map(id => { const on = a.theses.includes(id); return { label: (on ? '◆ ' : '+ ') + c.T(id)!.title, bg: on ? 'oklch(0.62 0.15 258 / 0.2)' : 'var(--w40)', color: on ? 'var(--o86-08-258)' : 'var(--g8e8e98)', onClick: () => setA({ theses: on ? a.theses.filter((t: string) => t !== id) : [...a.theses, id] }) } })
    V.startLabel = a.busy ? 'Reading…' : a.once ? 'Read now' : V.addLoginNeeded ? 'Sign in' : 'Start watching' // M1(a): Sign in primary for sign-in-needed
    V.startBg = c.canStart() ? 'oklch(0.6 0.15 258)' : 'var(--w120)'
    V.startDisabled = !c.canStart()
    V.onStartWatching = () => c.startWatching()
  }

  V.mThought = s.modal === 'thought'
  if (V.mThought) {
    const ch = c.thoughtChoice()
    V.thoughtRef = c.ref('thoughtEl')
    V.thought = s.thought; V.onThought = (e: Any) => c.onThoughtText(e.target.value)
    V.thHas = s.thought.trim().length > 8
    V.thPath = s.thoughtNewThesis ? '＋ New thesis: ' + s.thoughtNewThesis.title : ch.thesis ? c.path(ch.thesis) : 'No thesis yet'
    const newTh = ch.newThesis ? [{ label: '＋ New thesis: ' + ch.newThesis.title, act: () => c.setState({ thoughtNewThesis: ch.newThesis, thoughtThesis: null }) }] : []
    V.onThChange = (e: Any) => c.menuAt(e, c.thesisMenuItems(t => c.setState({ thoughtThesis: t, thoughtNewThesis: null }), ch.thesis, newTh))
    V.thCosV = ch.cos.map(id => c.C(id)).filter(Boolean).map(co => ({ name: co!.name, tile: col(hueOf(co!.id)), onRemove: () => c.setState((st: Any) => ({ thoughtRemoved: { ...st.thoughtRemoved, [co!.id]: true } })) }))
    V.thNoCos = !V.thCosV.length
    V.thTypeSegs = c.seg(NOTE_TYPES, ch.type, v => c.setState({ thoughtType: v }))
    V.thHint = V.thHas ? 'Suggested from what you wrote. Change anything, or just save.' : 'Write freely. I’ll suggest where it belongs.'
    V.thSaveBg = V.thHas ? 'oklch(0.6 0.15 258)' : 'var(--w120)'
    V.saveThought = () => c.saveThought()
  }

  V.mCustomize = s.modal === 'customize'
  if (V.mCustomize && s.cuScope) {
    const sc = s.cuScope
    V.cuName = sc.objectType === 'feed' ? 'Today' : sc.name; V.cuDraft = s.cuDraft; V.cuRef = c.ref('cuEl')
    V.cuTitle = sc.objectType === 'feed' ? 'Customize Today' : 'Customize ' + sc.name + '’s page'
    V.onCuDraft = (e: Any) => c.setState({ cuDraft: e.target.value })
    const ex: Record<string, string[]> = {
      company: ['Show pricing changes at the top', 'Put funding history first', 'Compare with competitors I track', 'Show the founders'],
      firm: ['Show saved evidence first', 'Put recent writing first', 'Hide partner commentary', 'Show portfolio companies I track at the top'],
      thesis: ['Show contradicting evidence first', 'Put open questions at the top', 'On every thesis page, hide child theses', 'Show companies to watch first'],
      feed: ['Group by thesis', 'Put Legal AI first', 'Only show companies I follow', 'Newest first']
    }
    V.cuExamples = (ex[sc.objectType] || []).map(label => ({ label, onClick: () => c.setState({ cuDraft: label }) }))
    const isCustom = sc.objectType === 'feed' ? !!s.feedDef && !s.feedDef.isDefault : sc.objectType === 'company' ? !s.companyPage?.view?.isDefault : sc.objectType === 'firm' ? !s.firmPage?.view?.isDefault : !s.thesisPage?.view?.isDefault
    V.cuResetLabel = isCustom ? 'Reset to default layout' : ''
    V.onCuReset = async () => { if (await c.act('view.reset', { objectType: sc.objectType, objectId: sc.objectId })) { c.setState({ modal: null }); c.toast('Reset ' + (sc.objectType === 'feed' ? 'Today' : sc.name + '’s page')); c.refreshAll(false) } }
    V.onCuApply = () => c.applyCustomize()
    V.cuBusy = s.cuBusy; V.cuApplyLabel = s.cuBusy ? 'Applying…' : 'Apply'
    V.cuError = s.cuError || ''; V.cuHasError = !!s.cuError
  }

  V.mWhy = s.modal === 'why'
  if (V.mWhy) {
    const it = c.item(s.whyId); const why = s.why
    const co = it?.cos[0] ? c.C(it.cos[0]) : undefined
    V.whyTitle = it?.title || ''
    V.whyReasons = (why?.reasons || it?.reasons || []).map((r: Any) => ({ t: r.label }))
    V.whyActions = [
      co && co.followed ? { label: 'Unfollow ' + co.name, onClick: () => { c.setState({ modal: null }); c.follow('company', co.id) } } : null,
      it?.srcId && it.srcId !== 'src_manual' ? { label: 'Adjust source', onClick: () => c.go('sources', { expandedSrc: it.srcId, sourcesTab: 'subscribed', srcType: 'All' }) } : null,
      it?.thesis ? { label: 'Mute this topic', onClick: async () => { c.setState({ modal: null }); if (await c.act('feed.muteTopic', { id: it.id, thesisId: it.thesis })) c.toast('Muted “' + (c.T(it.thesis)?.title || '') + '” for items from ' + it.source) } } : null,
      { label: 'Show more like this', onClick: () => { c.setState({ modal: null }); if (it) c.feedback(it.id, 'more') } }
    ].filter(Boolean)
  }

  V.mSettings = s.modal === 'settings'
  if (V.mSettings) rvSettings(c, V)

  // "Describe it" (DEC-099): adding something starts with what the user knows — all optional, a name alone works
  V.mDescribe = s.modal === 'describe' && !!s.describe
  if (V.mDescribe) {
    const d = s.describe
    const set = (k: string) => (e: Any) => { const v = e.target.value; c.setState((st: Any) => ({ describe: { ...st.describe, [k]: v } })) }
    const kindLabel = d.kind === 'firm' ? 'firm' : 'company'
    if (d.mode === 'edit') {
      const setF = (k: string) => (e: Any) => { const v = e.target.value; c.setState((st: Any) => ({ describe: { ...st.describe, fields: { ...st.describe.fields, [k]: v } } })) }
      V.describe = {
        edit: true, title: `Describe ${d.name}`, sub: 'Your words — kept apart from what the agent finds, never overwritten. Reading and Ask use them.',
        about: d.about, onAbout: set('about'), aboutLabel: d.kind === 'person' ? 'Who they are' : 'What you want from it', busy: !!d.busy,
        fields: (d.fieldSet as Any[]).map(f => ({ key: f.key, label: f.label, value: d.fields[f.key] || '', onChange: setF(f.key) })),
        onSave: async () => {
          c.setState((st: Any) => ({ describe: { ...st.describe, busy: true } }))
          const r: Any = await c.act('object.describe', { type: d.kind, id: d.id, patch: { about: d.about, fields: d.fields } }, 'Couldn’t save your description')
          c.setState({ modal: null, describe: null })
          if (r) { c.toast(r.result?.rerunJobId ? `Saved — looking ${d.name} up again with your details` : 'Saved', 'Undo', async () => { if (await c.act('ontology.undo', { historyIds: r.undo.historyIds })) { c.toast('Undone'); c.refreshAll(false) } }); c.refreshAll(false) }
        }
      }
    } else if (d.kind === 'thesis' || d.kind === 'person') {
      // "Describe it" when adding a thesis or a person (DEC-099): the claim and what would prove it / who they are —
      // all optional, a title or name alone still works
      const setF = (k: string) => (e: Any) => { const v = e.target.value; c.setState((st: Any) => ({ describe: { ...st.describe, fields: { ...(st.describe.fields || {}), [k]: v } } })) }
      const th = d.kind === 'thesis'
      V.describe = {
        add: true, title: th ? 'New thesis' : `Add ${d.name || 'a person'}`, sub: th ? 'Say what you believe — matching uses your words to link facts already in your library. A title alone works too.' : 'Optional — who they are helps reading tell them apart from namesakes.',
        nameLabel: th ? 'Title' : 'Name', name: d.name, onName: set('name'), about: d.about, onAbout: set('about'),
        aboutLabel: th ? 'The claim' : 'Who they are', aboutPlaceholder: th ? 'One sentence: what you expect to happen' : 'A few words',
        fields: (th ? [{ key: 'proof', label: 'What would prove or disprove it' }] : [{ key: 'role', label: 'Role' }, { key: 'org', label: 'Where' }, { key: 'howKnown', label: 'How you know them' }])
          .map(f => ({ ...f, value: (d.fields || {})[f.key] || '', onChange: setF(f.key) })),
        busy: !!d.busy, createLabel: th ? 'Create thesis' : 'Add person',
        onCreate: async () => {
          const name = (d.name || '').trim()
          if (!name || d.busy) return
          c.setState((st: Any) => ({ describe: { ...st.describe, busy: true } }))
          const fields = Object.fromEntries(Object.entries(d.fields || {}).filter(([, v]) => String(v).trim()))
          if (th) {
            const t = await c.act<Any>('thesis.create', { title: name, parentId: d.parentId || null })
            if (t && d.about.trim()) await c.act('thesis.update', { id: t.id, patch: { description: d.about.trim() } })
            if (t && Object.keys(fields).length) await c.act('object.describe', { type: 'thesis', id: t.id, patch: { fields } })
            c.setState({ modal: null, describe: null })
            if (!t) return
            await c.refreshAll(false)
            c.goThesis(t.id)
          } else {
            const r = await c.act<Any>('object.create', { type: 'person', name, ...(d.about.trim() ? { about: d.about.trim() } : {}) })
            if (r && Object.keys(fields).length) await c.act('object.describe', { type: 'person', id: r.id, patch: { fields } })
            c.setState({ modal: null, describe: null })
            if (!r) return
            await c.act('object.follow', { type: 'person', id: r.id, follow: true })
            c.toast(r.existing ? r.name + ' is already in your library. Gathering more about them…' : 'Looking for ' + r.name + ' in your library and the news…')
            c.refreshAll(false)
          }
        }
      }
    } else V.describe = {
      title: `Start tracking ${d.name}`, sub: `Optional — what you know helps the lookup find the right ${kindLabel}. A name alone works too.`,
      name: d.name, onName: set('name'), website: d.website, onWebsite: set('website'), about: d.about, onAbout: set('about'),
      aboutLabel: d.kind === 'firm' ? 'What it invests in' : 'What it does', busy: !!d.busy,
      onCreate: async () => {
        const name = (d.name || '').trim()
        if (!name || d.busy) return
        c.setState((st: Any) => ({ describe: { ...st.describe, busy: true } }))
        const r = await c.act<Any>('object.create', { type: d.kind, name, ...(d.website.trim() ? { website: d.website.trim() } : {}), ...(d.about.trim() ? { about: d.about.trim() } : {}) })
        c.setState({ modal: null, describe: null })
        if (!r) return
        await c.act('object.follow', { type: d.kind, id: r.id, follow: true })
        c.toast(r.existing ? r.name + ' is already in your library. Gathering more about it…' : 'Looking for ' + r.name + ' in your library and the news…', 'Open', () => (d.kind === 'company' ? c.goCompany(r.id) : c.goFirm(r.id)))
        c.refreshAll(false)
      }
    }
  }

  V.mNotify = s.modal === 'notify' && !!s.notify
  if (V.mNotify) {
    const n = s.notify
    V.notifyRef = c.ref('notifyEl')
    V.notifyText = n.text; V.onNotifyText = (e: Any) => c.setState((st: Any) => ({ notify: { ...st.notify, text: e.target.value, phase: st.notify.phase === 'confirm' ? 'edit' : st.notify.phase } }))
    V.notifyTitle = n.anchor ? 'Notify me about ' + n.anchor.name : 'Notify me when…'
    V.notifyExamples = (n.anchor ? [`Tell me when ${n.anchor.name} raises a round`, `Tell me when ${n.anchor.name} hires an executive`, `Tell me when ${n.anchor.name} launches a product`] : ['Tell me when a company I follow announces a round', 'Notify me when new evidence challenges a pinned thesis', 'Alert me when Northwind Ventures leads a round']).map(x => ({ label: x, onClick: () => c.setState((st: Any) => ({ notify: { ...st.notify, text: x, phase: 'edit' } })) }))
    V.notifyCompiling = n.phase === 'compiling'
    V.notifyConfirm = n.phase === 'confirm' && !!n.alert
    V.notifySummary = n.alert?.summary || ''
    V.notifyBacktest = n.alert ? `Would have matched ${n.alert.backtestCount ?? 0} time${n.alert.backtestCount === 1 ? '' : 's'} in the last 30 days` : ''
    V.notifyError = n.error || ''; V.notifyHasError = !!n.error
    V.notifyChannels = c.seg([['in_app', 'In-app'], ['email', 'In-app + Email']], n.channels.includes('email') ? 'email' : 'in_app', v => c.setState((st: Any) => ({ notify: { ...st.notify, channels: v === 'email' ? ['in_app', 'email'] : ['in_app'] } })))
    V.notifyCapCopy = 'High-signal only. Email alerts are capped at three a day.'
    V.notifyPrimary = n.phase === 'confirm' ? 'Create alert' : n.phase === 'compiling' ? 'Checking…' : 'Continue'
    V.onNotifyPrimary = () => (n.phase === 'confirm' ? c.activateAlert() : n.phase === 'compiling' ? null : c.compileAlert())
    V.notifyBtnBg = n.text.trim() && n.phase !== 'compiling' ? 'oklch(0.6 0.15 258)' : 'var(--w120)'
  }

  V.mReset = s.modal === 'reset' && !!s.resetSrc
  if (V.mReset) {
    const x: SourceDTO = s.resetSrc
    V.resetName = x.name
    V.resetKept = ['Your notes and highlights', 'Saved, read and dismissed items', 'Evidence you kept and links you accepted or rejected', 'Your corrections to company and firm details']
    V.resetRebuilt = ['Summaries, extracted evidence and suggested links for every item from this source', 'Its check history, so older posts (up to 30 days) are fetched again']
    V.onResetConfirm = async () => { c.setState({ modal: null }); const r = await c.act<Any>('source.reset', { id: x.id }); if (r) c.toast('Rebuilding ' + x.name + '… your notes and saved evidence are kept') }
  }

  V.mMerge = s.modal === 'merge' && !!s.merge
  if (V.mMerge) {
    const m = s.merge
    V.mergeText = `Merge ${m.fromName} into ${m.intoName}?`
    V.mergeSub = `Notes, evidence and links move to ${m.intoName}. This can’t be undone.`
    V.onMergeConfirm = async () => {
      c.setState({ modal: null })
      const ok = m.type === 'thesis' ? await c.act('merge.theses', { fromId: m.fromId, intoId: m.intoId }) : await c.act('merge.entities', { type: m.type, fromId: m.fromId, intoId: m.intoId })
      if (ok) { c.toast('Merged into ' + m.intoName); if (m.type === 'company') c.goCompany(m.intoId); else if (m.type === 'firm') c.goFirm(m.intoId); else if (m.type === 'thesis') c.goThesis(m.intoId); c.refreshAll(false) }
    }
  }

  V.mBriefing = s.modal === 'briefing' && !!s.brSheet
  if (V.mBriefing) {
    const f = s.brSheet, setF = (o: Any) => c.setState((st: Any) => ({ brSheet: { ...st.brSheet, ...o, error: null } }))
    V.brTitle = f.id ? 'Edit briefing' : 'New briefing'
    V.brNameRef = c.ref('brNameEl')
    V.brName = f.name; V.onBrName = (e: Any) => setF({ name: e.target.value })
    V.onBrKey = (e: Any) => { if (e.key === 'Enter') { e.preventDefault(); c.saveBriefing() } }
    V.brReports = (s.reports as Any[]).filter(r => r.status !== 'failed').map(r => { const on = f.reportIds.includes(r.id); return { name: r.name, on, onToggle: () => setF({ reportIds: on ? f.reportIds.filter((x: string) => x !== r.id) : [...f.reportIds, r.id] }) } })
    V.brKinds = c.seg([['none', 'On demand'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly']], f.kind, v => setF({ kind: v }))
    V.brTimed = f.kind !== 'none'; V.brWeekly = f.kind === 'weekly'
    V.brAt = f.at; V.onBrAt = (e: Any) => setF({ at: e.target.value })
    V.brDays = c.seg([[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']], f.weekday, v => setF({ weekday: v }))
    V.brError = f.error || ''
    V.brSaveLabel = f.busy ? 'Saving…' : f.id ? 'Save' : 'Create briefing'
    V.brSaveBg = f.name.trim() && f.reportIds.length && !f.busy ? 'oklch(0.6 0.15 258)' : 'var(--w120)'
    V.onBrSave = () => c.saveBriefing()
  }

  V.mRename = s.modal === 'rename' && !!s.renameRep
  if (V.mRename) {
    V.renameValue = s.renameRep.name
    V.onRenameValue = (e: Any) => c.setState((st: Any) => ({ renameRep: { ...st.renameRep, name: e.target.value } }))
    V.onRenameSave = async () => { const r = s.renameRep; if (!r.name.trim()) return; if (await c.act('report.rename', { id: r.id, name: r.name.trim() })) { c.setState({ modal: null }); c.refreshScreen() } }
    V.onRenameKey = (e: Any) => { if (e.key === 'Enter') { e.preventDefault(); V.onRenameSave() } }
  }

  // M7 field popover
  V.popOn = !!s.popover
  if (s.popover) {
    const p = s.popover; const ch = p.chip
    V.popX = Math.min(p.x, window.innerWidth - 300) + 'px'; V.popY = p.y + 'px'
    V.popLabel = ch.label; V.popValue = ch.value || '—'
    V.popProvenance = ch.origin === 'user' ? 'Set by you' : ch.provenance || ''
    V.popEarlier = ch.earlier || ''; V.popHasEarlier = !!ch.earlier
    V.popDraft = p.draft; V.onPopDraft = (e: Any) => c.setState((st: Any) => ({ popover: { ...st.popover, draft: e.target.value } }))
    V.popEditing = p.editing; V.onPopChange = () => c.setState((st: Any) => ({ popover: { ...st.popover, editing: true, draft: ch.value || '' } }))
    V.onPopKey = async (e: Any) => { if (e.key === 'Enter' && p.draft.trim()) { e.preventDefault(); if (await c.act('field.set', { objectType: p.objectType, objectId: p.objectId, key: ch.key, value: p.draft.trim() })) { c.setState({ popover: null }); c.toast(ch.label + ' set to ' + p.draft.trim()); c.refreshAll(false) } } }
    V.popHistory = (p.history || []).map((h: Any) => ({ text: h.display, meta: (h.origin === 'user' ? 'You' : h.source || 'Source') + (h.date ? ' · ' + shortDate(h.date) : '') + (h.status === 'current' ? ' · current' : '') }))
    V.popHasHistory = V.popHistory.length > 0
    V.popCanRevert = ch.origin === 'user'
    V.onPopRevert = async () => { if (await c.act('field.revert', { objectType: p.objectType, objectId: p.objectId, key: ch.key })) { c.setState({ popover: null }); c.toast('Reverted ' + ch.label + ' to the source value'); c.refreshAll(false) } }
    V.closePopover = () => c.setState({ popover: null })
  }

  V.menuOn = !!s.menu
  if (s.menu) {
    V.menuX = s.menu.x + 'px'; V.menuY = s.menu.y + 'px'
    V.menuItems = s.menu.items.map((m: Any) => (m.div ? { div: true } : m.head ? { head: true, label: m.label } : { row: true, label: m.label, hint: m.hint || '', check: m.check || '', pad: m.pad || '0', color: m.color || 'var(--ge8e8ec)', onClick: (e: Any) => { e.stopPropagation(); c.setState({ menu: null }); m.act && m.act() } }))
    V.closeMenu = () => c.setState({ menu: null })
    V.closeMenuCtx = (e: Any) => { e.preventDefault(); c.setState({ menu: null }) }
  }
  V.toastOn = !!s.toast
  if (s.toast) { V.toastMsg = s.toast.msg; V.toastHasAct = !!s.toast.actLabel; V.toastActLabel = s.toast.actLabel; V.toastAct = () => { const a = s.toast.act; c.setState({ toast: null }); a && a() } }
}

function paletteRows(c: Controller): Any[] {
  const s = c.state, q = s.pq.trim().toLowerCase(), rows: Any[] = []
  const H = (label: string) => rows.push({ isHead: true, label })
  const R = (o: Any) => rows.push({ isRow: true, radius: '6px', tile: 'var(--w80)', iconColor: 'var(--gd8d8de)', kind: '', sub: '', ...o })
  const res = s.pResults
  if (s.pScope === 'company' || s.pScope === 'firm') {
    const isCo = s.pScope === 'company'
    const list = (isCo ? s.companies : s.firms) as (CompanyListDTO | FirmListDTO)[]
    H(isCo ? 'Companies you don’t follow yet' : 'Firms you don’t follow yet')
    list.filter(x => !x.followed && (!q || x.name.toLowerCase().includes(q))).forEach(x => R({ icon: initialOf(x.name), radius: isCo ? '6px' : '50%', tile: col(hueOf(x.id)), iconColor: '#15161a', title: 'Follow ' + x.name, sub: x.tagline, kind: '↵', act: () => { c.setState({ palette: false }); c.follow(isCo ? 'company' : 'firm', x.id, x.name, false) } }))
    if (q && !list.some(x => x.name.toLowerCase() === q)) R({ icon: '+', title: `Start tracking “${s.pq.trim()}”`, sub: 'I’ll look for it in your library and the news, find its site, and keep watching.', kind: '↵', act: () => c.setState({ palette: false, modal: 'describe', describe: { kind: s.pScope, name: s.pq.trim(), website: '', about: '', busy: false } }) })
    return rows
  }
  if (s.pScope === 'attach') {
    const th = c.T(s.thesisId)
    H('Evidence')
    for (const e of (res?.evidence || []) as Any[]) R({ icon: '❝', iconColor: stanceColor(e.stance || 'neutral'), title: e.claim, sub: e.source + ' · ' + shortDate(e.date), kind: '↵', act: async () => { c.setState({ palette: false }); if (await c.act('evidence.keep', { id: e.id, thesisId: th?.id })) { c.toast('Attached to ' + (th?.title || 'thesis')); c.refreshAll(false) } } })
    R({ icon: '+', title: 'Read a new link…', sub: 'Read once and attach it to ' + (th?.title || 'this thesis'), act: () => { c.setState({ palette: false }); c.openAddSource(true); c.setState((st: Any) => ({ add: { ...st.add, theses: th ? [th.id] : [] } })) } })
    return rows
  }
  const actions = [
    { icon: '✎', title: 'Add thought', sub: 'Capture an idea; I’ll suggest where it goes', kind: 'N', act: () => c.openThought() },
    { icon: '+', title: 'Add source', sub: 'Blog, newsletter, feed, or a saved search', act: () => c.openAddSource(false) },
    { icon: '↗', title: 'Read a link', sub: 'Read a page once, including X or LinkedIn posts', act: () => c.openAddSource(true) },
    { icon: '◇', title: 'Create thesis', act: () => c.openDescribeAdd('thesis') },
    { icon: '○', title: 'Add person…', act: () => c.openDescribeAdd('person') },
    { icon: '▢', title: 'Follow company…', act: () => c.setState({ pScope: 'company', pq: '', pIdx: 0, pResults: null }) },
    { icon: '◎', title: 'Follow venture firm…', act: () => c.setState({ pScope: 'firm', pq: '', pIdx: 0, pResults: null }) },
    { icon: '▦', title: 'Create report', sub: 'Describe it; I’ll schedule and deliver it', act: () => c.goReports(/report/.test(q) ? s.pq.trim() : '') },
    { icon: '◔', title: 'Create alert', sub: 'Describe when to notify you', act: () => { c.setState({ palette: false }); c.openNotify(null) } },
    ...(s.screen === 'company' || s.screen === 'firm' || s.screen === 'thesis' || s.screen === 'inbox' ? [{ icon: '⚙', title: 'Customize this page', sub: 'Describe the layout you want', act: () => { c.setState({ palette: false }); if (s.screen === 'company' && s.companyPage) c.openCustomize('company', s.companyId, s.companyPage.name); else if (s.screen === 'firm' && s.firmPage) c.openCustomize('firm', s.firmId, s.firmPage.name); else if (s.screen === 'thesis') c.openCustomize('thesis', s.thesisId, c.T(s.thesisId)?.title || 'thesis'); else c.openCustomize('feed', null, 'Today') } }] : []),
    { icon: '◍', title: 'Open settings', kind: '⌘,', act: () => c.openSettings() }
  ]
  if (!q) {
    const recent = (s.settings?.recent_queries || []) as string[]
    if (recent.length) { H('Recent searches'); recent.slice(0, 5).forEach(t => R({ icon: '↺', title: t, act: () => { c.onPq(t) } })) }
    H('Actions'); actions.forEach(R)
    const pins = [...c.pins('theses').slice(0, 2).map(id => c.T(id)).filter(Boolean).map(t => ({ icon: '◆', iconColor: convColor(t!.conviction), title: t!.title, sub: c.path(t!.id) + ' · ' + t!.evidenceCount + ' evidence', kind: 'Thesis', act: () => c.goThesis(t!.id) })), ...c.pins('companies').slice(0, 2).map(id => c.C(id)).filter(Boolean).map(co => ({ icon: initialOf(co!.name), tile: col(hueOf(co!.id)), iconColor: '#15161a', title: co!.name, sub: co!.tagline + (co!.stage ? ' · ' + co!.stage : ''), kind: 'Company', act: () => c.goCompany(co!.id) }))]
    if (pins.length) { H('Jump to'); pins.forEach(R) }
    return rows
  }
  // M2: Ask row first when the text reads like a question
  const words = s.pq.trim().split(/\s+/).length
  const askRow = () => { if (words >= 3 || /\?\s*$/.test(s.pq.trim())) R({ icon: '✦', iconColor: 'var(--o78-11-255)', title: 'Ask: ' + s.pq.trim(), sub: 'Answer from your library, with citations', kind: '⌘↵', act: () => c.ask(s.pq.trim()) }) }
  // FLOW-I: text that reads like a correction puts the correction rows first so ↵ confirms; otherwise Ask leads
  // ontology corrections (DEC-094): not / merge / actually, plus rename, split, delete, restore, move, archive, "is a firm", "X's stage is …"
  const CORRECTION_RE = /\b(is|are)\b.*\bnot\b|\b(merge|actually|rename|split|delete|restore|archive|unarchive|different)\b|\bmove\b.*\b(under|to)\b|\bis an? (vc |venture |investment )?(firm|company|fund|investor)\b|['’]s \w+( \w+)? is\b/i
  // the proposal for this exact text, kept apart from search results: a search that lands late — or fails — while the
  // correction model is still answering must not drop it (B1, acc-2026-10-07T17-11-52: answered in 64 s, never shown)
  const proposal = s.pCorrection && s.pCorrection.forQuery === s.pq.trim() ? s.pCorrection : null
  const correctionLike = !!proposal || CORRECTION_RE.test(s.pq)
  if (!correctionLike) askRow()
  // NL correction (FLOW-I)
  if (proposal) R({ icon: '✓', iconColor: 'var(--o78-12-155)', title: proposal.confirmText + ' ↵', sub: 'Correction', kind: '↵', act: async () => {
    c.setState({ palette: false })
    const { forQuery: _q, ...pr } = proposal
    const r = await c.act<Any>('correct.apply', { proposal: pr })
    if (!r) return
    const msg = 'Updated · ' + proposal.confirmText.replace(/\?$/, '')
    if (r.undo) c.toast(msg, 'Undo', async () => { if (await c.act('ontology.undo', { historyIds: r.undo.historyIds })) { c.toast('Undone'); c.refreshAll(false) } })
    else c.toast(msg)
    c.refreshAll(false)
  } })
  else if (CORRECTION_RE.test(s.pq)) R({ icon: '✎', title: 'Correct: ' + s.pq.trim(), sub: 'Turn this into a correction', act: async () => { const p = await c.act<Any>('correct.parse', { text: s.pq.trim() }, 'I couldn’t tell what to correct.'); if (p && p.action !== 'none') c.setState({ pCorrection: { ...p, forQuery: s.pq.trim() }, pIdx: 0 }); else if (p) c.toast('I couldn’t tell what to correct.') } })
  if (correctionLike) askRow()
  const act = actions.filter(a => a.title.toLowerCase().includes(q) || (/report/.test(q) && a.title === 'Create report'))
  if (act.length) { H('Actions'); act.forEach(R) }
  if (!res) return rows
  if (res.whatChanged?.rows?.length) { H('What changed · ' + res.whatChanged.thesis); res.whatChanged.rows.forEach((r: Any) => R({ icon: r.stance === 'contra' ? '↘' : '↗', iconColor: stanceColor(r.stance), title: r.text, sub: shortDate(r.date) + ' · ' + r.thesisTitle, kind: r.stance === 'contra' ? 'Challenges' : 'Supports', act: () => c.goThesis(r.thesisId) })) }
  if (res.companies?.length) { H('Companies'); res.companies.forEach((co: Any) => R({ icon: initialOf(co.name), tile: col(hueOf(co.id)), iconColor: '#15161a', title: co.name, sub: [co.tagline, co.stage].filter(Boolean).join(' · '), kind: 'Company', act: () => c.goCompany(co.id) })) }
  if (res.theses?.length) { H('Theses'); res.theses.forEach((t: Any) => R({ icon: '◆', iconColor: convColor(t.conviction), title: t.title, sub: (c.path(t.id) || t.title) + ' · ' + t.evidenceCount + ' evidence' + (t.archived ? ' · Archived' : ''), kind: t.archived ? 'Archived' : 'Thesis', act: t.archived ? async () => { c.setState({ palette: false }); if (await c.act('thesis.archive', { id: t.id, archived: false })) { c.toast('Unarchived ' + t.title); await c.refreshAll(false); c.goThesis(t.id) } } : () => c.goThesis(t.id) })) }
  if (res.people?.length) { H('People'); res.people.forEach((p: Any) => R({ icon: initialOf(p.name), radius: '50%', tile: col(hueOf(p.id)), iconColor: '#15161a', title: p.name, sub: [p.role, p.orgName].filter(Boolean).join(' · '), kind: 'Person', act: () => (p.orgType === 'firm' ? c.goFirm(p.orgId) : c.goCompany(p.orgId)) })) }
  if (res.firms?.length) { H('Venture firms'); res.firms.forEach((f: Any) => R({ icon: initialOf(f.name), radius: '50%', tile: col(hueOf(f.id)), iconColor: '#15161a', title: f.name, sub: f.tagline || '', kind: 'Firm', act: () => c.goFirm(f.id) })); (res.investments || []).forEach((i: Any) => R({ icon: initialOf(i.companyName), tile: col(hueOf(i.companyId)), iconColor: '#15161a', title: i.firmName + ' → ' + i.companyName, sub: [i.round, i.date].filter(Boolean).join(' · '), kind: 'Investment', act: () => c.goCompany(i.companyId) })) }
  if (res.evidence?.length) { H('Evidence'); res.evidence.forEach((e: Any) => R({ icon: '❝', iconColor: stanceColor(e.stance || 'neutral'), title: e.claim, sub: [e.source, shortDate(e.date), ...(e.theses || []).slice(0, 2)].filter(Boolean).join(' · '), kind: e.stance ? stanceLabel(e.stance) : 'Evidence', act: () => c.openCitation(e) })) }
  if (res.items?.length) { H('Inbox & saved'); res.items.forEach((i: Any) => R({ icon: initialOf(i.source), tile: col(hueOf(i.srcId + i.source)), iconColor: '#15161a', title: i.title, sub: i.source + ' · ' + itemTime(i.publishedAt, i.surfacedAt, s.now), kind: i.saved ? 'Saved' : '', act: () => c.openItem(i.id) })) }
  if (res.documents?.length) { H('Other documents in your library'); res.documents.forEach((d: Any) => R({ icon: initialOf(d.site || d.title), tile: col(hueOf(d.site || d.id)), iconColor: '#15161a', title: d.title, sub: (d.site || '') + (d.status === 'triaged_out' ? ' · not shown in Today' : d.status === 'duplicate' ? ' · duplicate' : ''), kind: '', act: () => { c.setState({ palette: false }); c.act('document.open', { id: d.id }) } })) }
  if (res.notes?.length) { H('Your notes'); res.notes.forEach((n: Any) => R({ icon: '✎', title: n.text, sub: (n.anchorName || 'Note') + ' · ' + shortDate(n.createdAt), kind: KIND_TO_TYPE[n.kind] || '', act: () => (n.anchorType === 'thesis' ? c.goThesis(n.anchorId) : n.anchorType === 'company' ? c.goCompany(n.anchorId) : n.anchorType === 'firm' ? c.goFirm(n.anchorId) : null) })) }
  return rows
}

/** Daily reading limit (DEC-101): how many articles the AI reads per day; no limit leaves the braking to the ChatGPT
 *  usage stop. Raising it (or No limit) reads the waiting articles at once. */
function dailyLimitRow(c: Controller, status: Any) {
  const p = status?.processing || { readToday: 0, limit: 0 }
  const opts: [number, string][] = [[0, 'No limit'], [150, '150'], [300, '300'], [600, '600']]
  const cur = opts.some(([v]) => v === p.limit) ? p.limit : p.limit
  return {
    label: 'Daily reading limit', isSeg: true,
    desc: `${p.readToday.toLocaleString('en-US')} article${p.readToday === 1 ? '' : 's'} read today · ${p.limit ? `stops at ${p.limit} a day` : 'no daily limit'}; the ChatGPT usage stop still pauses reading near your plan's limit`,
    segs: c.seg(opts, cur, async (v: number) => { const r: Any = await c.act('processing.setLimit', { limit: v }); if (r) { c.toast(v ? `Daily reading limit: ${v}` + (r.released ? ` — reading ${r.released} waiting articles` : '') : 'No daily reading limit' + (r.released ? ` — reading ${r.released} waiting articles` : '')); c.refreshAll(false) } })
  }
}

function rvSettings(c: Controller, V: Any) {
  const s = c.state
  const cats = ['Appearance', 'Notifications', 'Sources', 'AI Behavior', 'Accounts', 'Local Data', 'Keyboard Shortcuts']
  V.settingsTab = s.settingsTab
  V.setCats = cats.map(k => ({ label: k, bg: s.settingsTab === k ? 'var(--w100)' : 'transparent', color: s.settingsTab === k ? 'var(--gf4f4f6)' : 'var(--gc0c0c8)', onClick: () => { c.setState({ settingsTab: k }); if (k === 'Accounts') c.loadAccounts() } }))
  const st = s.settings || {}
  const T = (label: string, desc: string, key: string) => ({ label, desc, isToggle: true, ...c.tg(st[key] !== false), onClick: () => c.setSetting({ [key]: !(st[key] !== false) }) })
  const S = (label: string, desc: string, opts: Any[], cur: Any, key: string) => ({ label, desc, isSeg: true, segs: c.seg(opts, cur, v => c.setSetting({ [key]: v })) })
  const Vl = (label: string, desc: string, value: string) => ({ label, desc, isValue: true, value })
  const B = (label: string, desc: string, btn: string, fn: () => void) => ({ label, desc, isButton: true, btn, onClick: fn })
  const K = (label: string, key: string) => ({ label, desc: '', isKey: true, key })
  const acct = st['email.account'] as Any
  const status = s.status
  const sizeLabel = status?.librarySize != null ? (status.librarySize > 1e9 ? (status.librarySize / 1e9).toFixed(1) + ' GB' : (status.librarySize / 1e6).toFixed(1) + ' MB') : '—'
  const rows: Record<string, Any[]> = {
    Appearance: [S('Appearance', 'Auto follows your macOS setting', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']], st['appearance.theme'] || 'dark', 'appearance.theme'), { label: 'Glass and transparency', desc: 'How much of the desktop shows through the sidebar and sheets', isSlider: true, value: st['appearance.glass'] ?? 60, onChange: (e: Any) => c.setSetting({ 'appearance.glass': +e.target.value }) }, S('Density', 'Compact fits more items on screen', [['compact', 'Compact'], ['comfortable', 'Comfortable']], st['appearance.density'] || 'compact', 'appearance.density'), S('Reading font', 'Used for articles, evidence and your current view', [['serif', 'Serif'], ['sans', 'Sans']], st['appearance.reader_font'] || 'serif', 'appearance.reader_font'), S('Group Today by', '', [['section', 'Sections'], ['source', 'Source'], ['thesis', 'Thesis'], ['none', 'None']], c.groupBy(), 'appearance.group_today_by')],
    Notifications: [T('In-app', 'Badges and banners for high-signal updates', 'notify.in_app'), T('Email', acct?.user ? 'Scheduled reports and email alerts go to ' + (acct.recipient || acct.user) : 'Set up Gmail in Accounts to receive reports by email', 'notify.email'), Vl('Email alerts', 'High-signal only. Email alerts are capped at three a day.', 'Max 3 / day'), T('Highlight new activity', 'Show a dot on pinned items with unread updates', 'notify.highlight_new'), B('Reports and alerts', 'Choose what gets sent and when', 'Open', () => c.go('reports'))],
    Sources: [T('Pause all polling', 'Stop checking every source until you turn this back on', 'pause_polling'), { ...T('Open at login', OPEN_AT_LOGIN_COPY, 'open_at_login'), ...c.tg(!!st.open_at_login), onClick: () => c.setSetting({ open_at_login: !st.open_at_login }) }, Vl('Active sources', '', (s.sources as SourceDTO[]).filter(x => x.enabled).length + ' of ' + (s.sources as SourceDTO[]).length), B('Manage sources', 'Frequency, instructions and priority for each source', 'Open', () => c.go('sources')), { label: 'Send to Research Workspace', desc: 'Drag this button to your browser’s bookmarks bar. Click it on any page to send that page (and any text you selected) here.', isBookmarklet: true, href: "javascript:location='researchworkspace://add?url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent((getSelection()+'').slice(0,20000))" }],
    'AI Behavior': [dailyLimitRow(c, status), T('Suggest thesis connections', 'Propose which thesis an item or thought belongs to', 'ai.suggest'), T('Extract evidence automatically', 'Show candidate quotes from each article for you to keep', 'ai.extract'), T('Organize new thoughts', 'Suggest thesis, companies and type when you capture a thought. Ask can still include your notes when they help answer a question.', 'ai.organize'), T('Summarize long articles', 'Add a short summary above the original text', 'ai.summarize'), S('Default summary length', 'Applies to new articles', ['Short', 'Medium', 'Long'], st['ai.summary_len'] || 'Medium', 'ai.summary_len'), S('Pause background AI at', 'Leave room in your ChatGPT plan for your own Codex use', [[70, '70%'], [85, '85%'], [95, '95%']], st['ai.usage_ceiling'] ?? 85, 'ai.usage_ceiling')],
    Accounts: [],
    'Local Data': [Vl('Library location', '', (status?.dataDir || '').replace(/^\/Users\/[^/]+/, '~')), T('Keep dismissed items', 'Dismissed items stay searchable in your library', 'keep_dismissed'), Vl('Library size', `${(status?.counts?.documents ?? 0).toLocaleString()} documents · ${(status?.counts?.evidence ?? 0).toLocaleString()} evidence items`, sizeLabel), Vl('Last indexed', 'Indexing runs on this Mac', V.lastIndexed), B('Reindex library', '', 'Reindex', async () => { if (await c.act('library.reindex', {})) { c.toast('Library reindexed on this Mac'); c.refreshAll(false) } }), B('Export library', 'Markdown and JSON, readable without this app', 'Export…', async () => { const r = await c.act<Any>('library.export', {}); if (r) c.toast('Exported to ' + String(r.dir).replace(/^\/Users\/[^/]+/, '~')) }), B('Show in Finder', '', 'Reveal', () => c.act('library.reveal', {}))],
    'Keyboard Shortcuts': [K('Search and commands', '⌘K'), K('Ask a question', '⌘↵ in search'), K('Add thought', 'N'), K('Next / previous item', 'J  K'), K('Save item', 'S'), K('Dismiss item', 'E'), K('Mark unread', 'U'), K('Focus reading', '↵'), K('Toggle inspector', 'I'), K('Back / forward', '[  ]'), K('Multi-select', '⌘-click'), K('Settings', '⌘,')]
  }
  V.setRows = rows[s.settingsTab] || []
  V.setShowInstr = s.settingsTab === 'AI Behavior'
  V.setShowLocal = s.settingsTab === 'Local Data'
  V.privacyCopy = PRIVACY_COPY
  V.researchInstr = s.researchDraft ?? st.research_instruction ?? ''
  V.onResearch = (e: Any) => { const v = e.target.value; c.setState({ researchDraft: v }); clearTimeout((c as Any).riTimer); (c as Any).riTimer = setTimeout(() => c.setSetting({ research_instruction: v }), 500) }
  // M11 Accounts
  V.setShowAccounts = s.settingsTab === 'Accounts'
  if (V.setShowAccounts) {
    const ai = s.ai
    V.acctName = s.nameDraft ?? st.display_name ?? ''
    V.onAcctName = (e: Any) => { const v = e.target.value; c.setState({ nameDraft: v }); clearTimeout((c as Any).nmTimer); (c as Any).nmTimer = setTimeout(() => c.setSetting({ display_name: v }), 500) }
    V.aiFound = ai?.status === 'ok'
    V.aiLine = ai?.status === 'ok' ? `Signed in as ${ai.email || 'ChatGPT user'} · ${ai.plan || 'plan'}${ai.usedPercent != null ? ` · ${Math.round(ai.usedPercent)}% of weekly limit used` : ''}` : ai?.status === 'signed_out' ? 'Your ChatGPT sign-in expired. Run `codex login` in Terminal.' : 'Not found — install Codex and run `codex login` in Terminal'
    V.aiTestLabel = s.aiTesting ? 'Testing…' : 'Test'
    V.onAiTest = async () => { c.setState({ aiTesting: true }); try { const r = await c.act<Any>('ai.test', {}, 'I couldn’t reach the AI provider.'); if (r) c.toast(r.ok ? 'ChatGPT sign-in works · ' + r.latencyMs + ' ms' : r.message) } finally { c.setState({ aiTesting: false }); c.loadAccounts() } }
    V.aiMsg = ''
    const em = s.email
    V.emailUser = em.user; V.onEmailUser = (e: Any) => c.setState((x: Any) => ({ email: { ...x.email, user: e.target.value } }))
    V.emailPass = em.appPassword; V.onEmailPass = (e: Any) => c.setState((x: Any) => ({ email: { ...x.email, appPassword: e.target.value } }))
    V.emailRecipient = em.recipient; V.onEmailRecipient = (e: Any) => c.setState((x: Any) => ({ email: { ...x.email, recipient: e.target.value } }))
    V.emailConfigured = !!acct?.user
    V.emailStatus = acct?.user ? 'Connected as ' + acct.user + (acct.recipient && acct.recipient !== acct.user ? ' · reports go to ' + acct.recipient : '') : 'Not connected'
    V.emailMsg = s.emailMsg || ''
    V.onEmailSave = async () => { c.setState({ emailMsg: 'Checking…' }); const r = await c.act<Any>('email.configure', { user: em.user.trim(), appPassword: em.appPassword.trim(), recipient: (em.recipient || em.user).trim() }, 'Email login failed'); c.setState((x: Any) => ({ emailMsg: r ? (r.ok ? 'Connected. Newsletters can now be added as sources.' : r.message || 'Email login failed') : 'Email login failed', email: { ...x.email, appPassword: '' } })); c.refreshAll(false) }
    V.onEmailTest = async () => { c.setState({ emailMsg: 'Testing…' }); const r = await c.act<Any>('email.test', {}, 'Email login failed'); c.setState({ emailMsg: r ? r.message : 'Email login failed' }) }
    V.onEmailRemove = async () => { if (await c.act('email.remove', {})) { c.setState({ emailMsg: 'Removed', email: { user: '', appPassword: '', recipient: '' } }); c.refreshAll(false) } }
    const br = s.bridge
    V.bridgeProfiles = (br?.profiles || []).map((p: Any) => ({ label: p.name + (p.account ? ' · ' + p.account : ''), bg: br?.profile === p.dir ? 'var(--w100)' : 'var(--w40)', onClick: async () => { await c.act('bridge.allow', { profile: p.dir }); c.loadAccounts() } }))
    V.bridgeHasProfiles = V.bridgeProfiles.length > 0
    V.bridgeLine = !br ? 'Checking Chrome…' : !br.chromeInstalled ? 'Google Chrome isn’t installed on this Mac.' : br.allowed ? 'Using ' + (br.profileName || br.profile) + ' · allowed for this session' : br.profile ? 'Profile chosen: ' + (br.profileName || br.profile) + ' · press Allow access' : 'Pick the Chrome profile you use for X and LinkedIn'
    V.bridgeSites = (br?.sites || []).map((x: Any) => ({ label: x.site + (x.signedIn ? ' ✓' : ' ✗') }))
    V.onBridgeAllow = async () => { const r = await c.act<Any>('bridge.allow', { profile: br?.profile || (br?.profiles || [])[0]?.dir || '' }, 'Chrome access wasn’t allowed'); if (r) c.toast(r.message || 'Chrome sign-ins available'); c.loadAccounts() }
    V.signedInSites = (br?.partitions || []).map((d: Any) => ({ domain: d.domain, onSignOut: async () => { if (await c.act('source.signOutSite', { domain: d.domain })) { c.toast('Signed out of ' + d.domain); c.loadAccounts() } } }))
    V.hasSignedInSites = V.signedInSites.length > 0
  }
}

export function confirmMergeImpl(c: Controller, type: string, fromId: string, fromName: string, intoId: string, intoName: string) {
  c.setState({ modal: 'merge', menu: null, merge: { type, fromId, fromName, intoId, intoName } })
}
