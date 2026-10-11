import React from 'react'
import { createRoot } from 'react-dom/client'
import './prototype.css'
import { Controller } from './Controller'

// ⌘R / Ctrl+R reloads the window from the renderer itself, so it works even when the app menu's accelerator doesn't
// reach us (synthetic key events, a crashed view) — the window always has a way back.
window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); location.reload() }
}, true)

/**
 * A render error must never leave a white window: show what happened and a way back. "Back to Today" remounts the
 * controller (fresh state, starts at Today); Reload reloads the window.
 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null; key: number }> {
  state = { error: null as Error | null, key: 0 }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('Render error', error, info.componentStack) }
  render() {
    const { error, key } = this.state
    if (!error) return <React.Fragment key={key}>{this.props.children}</React.Fragment>
    const btn: React.CSSProperties = { height: '28px', padding: '0 14px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#e8e8ec', fontSize: '12.5px', cursor: 'default' }
    return (
      <div role="alert" data-testid="render-error" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#16171c', color: '#e8e8ec', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
        <div style={{ maxWidth: '420px', textAlign: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>Something went wrong showing this screen</div>
          <div style={{ fontSize: '12.5px', color: '#8a8a94', marginTop: '8px', lineHeight: 1.5 }}>Your library is safe. Go back to Today, or reload the window (⌘R).</div>
          <div style={{ fontSize: '11px', color: '#6a6a74', marginTop: '8px', fontFamily: 'ui-monospace, monospace' }}>{error.message}</div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
            <button style={{ ...btn, background: 'oklch(0.6 0.15 258)', border: 'none', color: '#fff' }} onClick={() => this.setState({ error: null, key: key + 1 })}>Back to Today</button>
            <button style={btn} onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(<ErrorBoundary><Controller /></ErrorBoundary>)
