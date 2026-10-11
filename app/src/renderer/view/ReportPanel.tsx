// The open report, reading first (Backlog "Reading first", "Clearer report editing", DEC-100): Refine is the primary
// control at the top — a larger box with example prompts and the last change with Undo; under it a compact settings
// strip (schedule · layout · sections) editing the same definition; Expand opens a full-window reader.
import React from 'react'

type V = any
const btn: React.CSSProperties = { height: '24px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--w100)', background: 'var(--w50)', fontSize: '12px', cursor: 'default', whiteSpace: 'nowrap' }
const chip: React.CSSProperties = { height: '22px', padding: '0 8px', borderRadius: '11px', border: '1px solid var(--w100)', background: 'var(--w40)', fontSize: '11.5px', color: 'var(--gc4c4cc)', cursor: 'default', whiteSpace: 'nowrap' }
const sel: React.CSSProperties = { height: '24px', borderRadius: '6px', border: '1px solid var(--w100)', background: 'var(--k250)', color: 'var(--gd8d8de)', fontSize: '12px', padding: '0 6px' }
const muted: React.CSSProperties = { fontSize: '11.5px', color: 'var(--g8a8a94)' }

export function ReportRefineTop({ V }: { V: V }) {
  const pv = V?.pv
  if (!pv) return null
  return (
    <div data-testid="report-refine" style={{ marginTop: '14px' }}>
      {pv.loading ? <div style={{ ...muted, marginBottom: '8px' }}>{pv.draft ? 'Setting up…' : 'Building preview…'}</div> : null}
      {pv.failed ? <div style={{ ...muted, color: 'oklch(0.75 0.15 60)', marginBottom: '8px' }}>Couldn’t set this up. {pv.error}</div> : null}
      {pv.canRefine ? (
        <>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input ref={pv.refineRef} aria-label="Refine this report" placeholder="Tell the AI what to change — “weekly on Fridays”, “add Series A deals as a table”…" value={pv.refineDraft} onChange={pv.onRefineDraft} onKeyDown={pv.onRefineKey} disabled={pv.refineBusy}
              style={{ flex: 1, height: '38px', borderRadius: '9px', border: '1px solid oklch(0.6 0.15 258 / 0.55)', background: 'var(--k250)', padding: '0 12px', fontSize: '13.5px', outline: 'none', userSelect: 'text', opacity: pv.refineBusy ? 0.6 : 1 }} />
            {pv.refineFailed ? <button onClick={pv.onRefineRetry} style={btn}>Retry</button> : null}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '7px', alignItems: 'center' }}>
            {(pv.examples || []).map((x: any, i: number) => <button key={i} onClick={x.onClick} style={chip}>{x.label}</button>)}
            <span style={{ flex: 1 }} />
            {pv.lastChange ? <span data-testid="report-last-change" style={muted}>{pv.lastChange} · <button onClick={pv.onUndo} style={{ ...btn, height: '20px', padding: '0 7px', fontSize: '11px' }}>Undo</button></span> : null}
          </div>
          {pv.refineFailed ? <div style={{ ...muted, color: 'oklch(0.75 0.15 60)', marginTop: '4px' }}>Couldn’t apply · Retry</div> : pv.refineBusy ? <div style={{ ...muted, marginTop: '4px' }}>Applying…</div> : null}
        </>
      ) : null}
    </div>
  )
}

function SectionChip({ x }: { x: V }) {
  const [edit, setEdit] = React.useState(false)
  const [t, setT] = React.useState(x.title)
  if (edit) return <input aria-label={'Rename section ' + x.title} autoFocus value={t} onChange={e => setT(e.target.value)} onBlur={() => setEdit(false)} onKeyDown={e => { if (e.key === 'Enter') { x.onRename(t); setEdit(false) } if (e.key === 'Escape') setEdit(false) }} style={{ ...sel, width: '160px' }} />
  return (
    <span data-testid="report-section" style={{ ...chip, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <span role="button" title="Double-click to rename" onDoubleClick={() => { setT(x.title); setEdit(true) }}>{x.title}</span>
      {x.onUp ? <span role="button" aria-label={'Move ' + x.title + ' up'} onClick={x.onUp} style={{ color: 'var(--g8a8a94)' }}>↑</span> : null}
      {x.onDown ? <span role="button" aria-label={'Move ' + x.title + ' down'} onClick={x.onDown} style={{ color: 'var(--g8a8a94)' }}>↓</span> : null}
      {x.onRemove ? <span role="button" aria-label={'Remove ' + x.title} onClick={x.onRemove} style={{ color: 'var(--g8a8a94)' }}>×</span> : null}
    </span>
  )
}

export function ReportSettingsStrip({ V }: { V: V }) {
  const st = V?.pv?.strip
  const [open, setOpen] = React.useState(false)
  if (!st) return null
  // one quiet line until the user wants to edit: the report stays the first thing to read
  if (!open) return (
    <div data-testid="report-strip-summary" style={{ ...muted, marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
      <span>{st.summary}</span>
      <button onClick={() => setOpen(true)} style={{ ...btn, height: '20px', padding: '0 7px', fontSize: '11px' }}>Edit settings</button>
    </div>
  )
  return (
    <div data-testid="report-strip" style={{ display: 'flex', gap: '8px 14px', flexWrap: 'wrap', alignItems: 'center', marginTop: '10px', padding: '8px 10px', borderRadius: '9px', border: '1px solid var(--w70)', background: 'var(--w25)', fontSize: '12px' }}>
      <span style={{ display: 'inline-flex', gap: '5px', alignItems: 'center' }}>
        <span style={muted}>Schedule</span>
        <select aria-label="Schedule" value={st.schedKind} onChange={st.onKind} style={sel}>{st.kinds.map((k: any) => <option key={k.v} value={k.v}>{k.l}</option>)}</select>
        {st.showDay ? <select aria-label="Day" value={st.schedDay} onChange={st.onDay} style={sel}>{st.days.map((k: any) => <option key={k.v} value={k.v}>{k.l}</option>)}</select> : null}
        {st.showTime ? <input aria-label="Time" type="time" defaultValue={st.schedAt} onBlur={st.onAt} style={{ ...sel, width: '92px' }} /> : null}
      </span>
      <span style={{ display: 'inline-flex', gap: '5px', alignItems: 'center' }}>
        <span style={muted}>Layout</span>
        {(st.layoutSegs || []).map((g: any, i: number) => <button key={i} onClick={g.onClick} aria-pressed={g.bg !== 'transparent'} style={{ ...btn, height: '22px', background: g.bg !== 'transparent' ? 'var(--w120)' : 'var(--w40)' }}>{g.label}</button>)}
      </span>
      <span style={{ display: 'inline-flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={muted}>Sections</span>
        {st.sections.map((x: any, i: number) => <SectionChip key={x.title + i} x={x} />)}
      </span>
      <button onClick={() => setOpen(false)} style={{ ...btn, height: '20px', padding: '0 7px', fontSize: '11px' }}>Done</button>
    </div>
  )
}

/** Full-window reader: comfortable width, the same rendering as the email; Esc or Close returns; Export stays at hand. */
export function ReportReader({ V }: { V: V }) {
  const pv = V?.pv
  if (!pv?.full || !pv.view) return null
  return (
    <div role="dialog" aria-label="Report reader" style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'var(--k600)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--w70)', background: 'var(--k250)' }}>
        <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 600 }}>{pv.name}</span>
        <button onClick={pv.onExport} style={btn}>Export ▾</button>
        <button onClick={pv.onCloseFull} aria-label="Close reader" style={btn}>Close (Esc)</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 16px' }}>
        <iframe title={'Report reader: ' + pv.name} data-testid="report-reader" srcDoc={pv.view} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
          style={{ display: 'block', width: 'min(760px, 100%)', minHeight: 'calc(100vh - 120px)', margin: '0 auto', border: 'none', borderRadius: '14px', background: '#ffffff', colorScheme: 'light' }} />
      </div>
    </div>
  )
}
