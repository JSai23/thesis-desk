// The user's own layer on a page (DEC-099): "From you" (what they say about it, kept apart from what the agent
// maintains), the lookup line (what the agent found and keeps watching) and the hint card when it found nothing.
// Built from the prototype's pieces: 24–28 px buttons, 30 px inputs, the dashed suggestion card, muted status text.
import React from 'react'

type V = any
const btn: React.CSSProperties = { height: '24px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--w100)', background: 'var(--w50)', fontSize: '12px', cursor: 'default', whiteSpace: 'nowrap' }
const primary: React.CSSProperties = { ...btn, border: 'none', background: 'oklch(0.6 0.15 258)', color: '#fff', fontWeight: 550 }
const input: React.CSSProperties = { width: '100%', height: '30px', borderRadius: '7px', border: '1px solid var(--w100)', background: 'var(--k250)', padding: '0 10px', fontSize: '12.5px', outline: 'none', userSelect: 'text' }
const area: React.CSSProperties = { ...input, height: '54px', padding: '7px 10px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.4 }
const muted: React.CSSProperties = { fontSize: '12px', color: 'var(--g8a8a94)', lineHeight: 1.45 }
const dashed: React.CSSProperties = { padding: '10px 12px', borderRadius: '9px', border: '1px dashed var(--w160)', background: 'var(--w25)', fontSize: '12.5px', lineHeight: 1.45 }

/** d: { fields: [{ key, label, value, long? }], emptyText, saveHint, onSave(values) → Promise<boolean> }; r: Re-process
 *  (the agent redoes its work with these words) — a rail card next to Your notes, the prototype's card style. */
export function FromYou({ d, r }: { d: V; r?: V }) {
  const [editing, setEditing] = React.useState(false)
  const [vals, setVals] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  if (!d) return null
  const filled = (d.fields as V[]).filter(f => (f.value || '').trim())
  const start = () => { setVals(Object.fromEntries((d.fields as V[]).map(f => [f.key, f.value || '']))); setEditing(true) }
  const save = async () => { setBusy(true); const ok = await d.onSave(vals); setBusy(false); if (ok) setEditing(false) }
  return (
    <section data-testid="from-you" aria-label="From you" style={{ padding: '14px', borderRadius: '11px', border: '1px solid var(--w80)', background: 'var(--w35)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--g80808a)' }}>From you</span>
        <span style={{ flex: 1 }} />
        {!editing ? <button onClick={start} style={btn}>{filled.length ? 'Edit' : 'Describe it'}</button> : null}
        {!editing && r ? <button onClick={r.onReprocess} title="Redo the agent's work on this with what you've said about it" style={btn}>Re-process</button> : null}
      </div>
      {!editing ? (
        filled.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 10px', marginTop: '8px', fontSize: '12.5px' }}>
            {filled.map((f: V) => (
              <React.Fragment key={f.key}>
                <span style={{ color: 'var(--g8a8a94)' }}>{f.label}</span>
                <span data-testid={`from-you-${f.key}`} style={{ color: 'var(--gd8d8de)', userSelect: 'text', whiteSpace: 'pre-wrap' }}>{f.value}</span>
              </React.Fragment>
            ))}
          </div>
        ) : <div style={{ ...muted, marginTop: '6px' }}>{d.emptyText}</div>
      ) : (
        <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
          {(d.fields as V[]).map(f => (
            <label key={f.key} style={{ display: 'grid', gap: '3px' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--g8a8a94)' }}>{f.label}</span>
              {f.long
                ? <textarea aria-label={f.label} value={vals[f.key] || ''} placeholder={f.placeholder || ''} onChange={e => setVals({ ...vals, [f.key]: e.target.value })} style={area} />
                : <input aria-label={f.label} value={vals[f.key] || ''} placeholder={f.placeholder || ''} onChange={e => setVals({ ...vals, [f.key]: e.target.value })} style={input} />}
            </label>
          ))}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={muted}>{d.saveHint}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setEditing(false)} style={btn}>Cancel</button>
            <button onClick={save} disabled={busy} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>Save</button>
          </div>
        </div>
      )}
    </section>
  )
}

/** l: { text, watchQuery, onSaveQuery(q) → Promise<boolean> } — what the lookup found and the search that keeps watching. */
export function LookupLine({ l }: { l: V }) {
  const [editing, setEditing] = React.useState(false)
  const [q, setQ] = React.useState('')
  if (!l || (!l.text && !l.watchQuery)) return null
  return (
    <div data-testid="lookup-line" role="status" style={{ ...muted, marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' }}>
      {l.text ? <span>{l.text}</span> : null}
      {l.watchQuery && !editing ? (
        <span>· News search: <span data-testid="watch-query" style={{ color: 'var(--gc4c4cc)', userSelect: 'text' }}>{l.watchQuery}</span>{' '}
          <button onClick={() => { setQ(l.watchQuery); setEditing(true) }} style={{ ...btn, height: '20px', padding: '0 7px', fontSize: '11px' }}>Edit search</button></span>
      ) : null}
      {editing ? (
        <span style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: '1 1 320px' }}>
          <input aria-label="News search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={async e => { if (e.key === 'Enter' && q.trim() && await l.onSaveQuery(q.trim())) setEditing(false) }} style={{ ...input, height: '26px' }} />
          <button onClick={async () => { if (q.trim() && await l.onSaveQuery(q.trim())) setEditing(false) }} style={primary}>Save</button>
          <button onClick={() => setEditing(false)} style={btn}>Cancel</button>
        </span>
      ) : null}
    </div>
  )
}

/** h: { text, onLookAgain(website, about) → Promise<boolean> } — the lookup found nothing to go on: ask for one hint. */
export function HintCard({ h }: { h: V }) {
  const [site, setSite] = React.useState('')
  const [about, setAbout] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  if (!h) return null
  const go = async () => { if (!site.trim() && !about.trim()) return; setBusy(true); await h.onLookAgain(site.trim(), about.trim()); setBusy(false) }
  return (
    <div data-testid="hint-card" role="status" style={{ ...dashed, marginTop: '12px', display: 'grid', gap: '8px' }}>
      <span>{h.text}</span>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input aria-label="Website" placeholder="Website (e.g. cua.ai)" value={site} onChange={e => setSite(e.target.value)} style={{ ...input, flex: '1 1 160px', width: 'auto' }} />
        <input aria-label="What it does" placeholder="What it does, in a few words" value={about} onChange={e => setAbout(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} style={{ ...input, flex: '2 1 240px', width: 'auto' }} />
        <button onClick={go} disabled={busy} style={{ ...primary, height: '30px', opacity: busy ? 0.6 : 1 }}>Look again</button>
      </div>
    </div>
  )
}

/** r: { text, onKeep } — what the last Re-process changed; Keep restores links the re-read removed. */
export function ReprocessLine({ r }: { r: V }) {
  if (!r?.text) return null
  return (
    <div data-testid="reprocess-line" role="status" style={{ ...muted, marginTop: '8px', display: 'flex', gap: '10px', alignItems: 'center' }}>
      <span>{r.text}</span>
      {r.onKeep ? <button onClick={r.onKeep} style={btn}>Keep those links</button> : null}
    </div>
  )
}

/** The header's Re-process button (24 px, prototype style). */
export function ReprocessButton({ r }: { r: V }) {
  if (!r) return null
  return <button onClick={r.onReprocess} title="Redo the agent's work on this with what you've said about it" style={{ height: '28px', padding: '0 11px', borderRadius: '7px', border: '1px solid var(--w100)', background: 'var(--w40)', fontSize: '12.5px', cursor: 'default' }}>Re-process</button>
}
