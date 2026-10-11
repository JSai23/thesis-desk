// RFC §1A.7 minimal UI additions (M1–M17), built only from prototype components: sheets, modals, menu rows,
// segmented controls, 24–28 px buttons, the orange status label slot and the dashed suggestion card.
import React from 'react'

type V = any
const btn: React.CSSProperties = { height: '24px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--w100)', background: 'var(--w50)', fontSize: '12px', cursor: 'default', whiteSpace: 'nowrap' }
const primary: React.CSSProperties = { height: '28px', padding: '0 14px', borderRadius: '7px', border: 'none', background: 'oklch(0.6 0.15 258)', color: '#fff', fontSize: '12.5px', fontWeight: 550, cursor: 'default' }
const input: React.CSSProperties = { width: '100%', height: '30px', borderRadius: '7px', border: '1px solid var(--w100)', background: 'var(--k250)', padding: '0 10px', fontSize: '12.5px', outline: 'none', userSelect: 'text' }
const label: React.CSSProperties = { fontSize: '13px', color: 'var(--gececf0)' }
const desc: React.CSSProperties = { fontSize: '11.5px', color: 'var(--g8a8a94)', marginTop: '2px', lineHeight: 1.4 }
const sheetWrap: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 66, background: 'var(--k300)', backdropFilter: 'blur(3px)', animation: 'fade .15s ease' }
const sheet = (bg: string, w = 560, top = '16%'): React.CSSProperties => ({ position: 'absolute', left: '50%', top, transform: 'translateX(-50%)', width: `min(${w}px,calc(100vw - 48px))`, borderRadius: '16px', background: bg, backdropFilter: 'blur(40px) saturate(1.8)', WebkitBackdropFilter: 'blur(40px) saturate(1.8)', border: '1px solid var(--w120)', boxShadow: '0 30px 90px var(--k600)', animation: 'pop .16s ease-out', padding: '20px 22px 18px' })
const dashed: React.CSSProperties = { padding: '9px 11px', borderRadius: '9px', border: '1px dashed var(--w160)', background: 'var(--w25)', fontSize: '12.5px', lineHeight: 1.45, display: 'flex', alignItems: 'center', gap: '10px' }

export function AccountsPane({ V }: { V: V }) {
  return (
    <div style={{ display: 'grid', gap: '0' }}>
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--w60)' }}>
        <div style={label}>Your name</div>
        <div style={desc}>Shown in the sidebar.</div>
        <input aria-label="Your name" value={V.acctName} onChange={V.onAcctName} placeholder="Your name" style={{ ...input, marginTop: '8px', maxWidth: '280px' }} />
      </div>
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--w60)', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={label}>ChatGPT</div>
          <div style={desc} data-testid="ai-status">{V.aiLine}</div>
          <div style={desc}>Detected automatically from the Codex sign-in on this Mac. No key to paste.</div>
        </div>
        <button onClick={V.onAiTest} style={btn} disabled={!V.aiFound}>{V.aiTestLabel}</button>
      </div>
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--w60)' }}>
        <div style={label}>Gmail</div>
        <div style={desc}>{V.emailStatus}. Newsletters are read from this inbox and reports are sent from it. Use an app password — create one at myaccount.google.com/apppasswords.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px' }}>
          <input aria-label="Gmail address" value={V.emailUser} onChange={V.onEmailUser} placeholder="you@gmail.com" style={input} />
          <input aria-label="App password" type="password" value={V.emailPass} onChange={V.onEmailPass} placeholder="16-character app password" style={input} />
          <input aria-label="Send reports to" value={V.emailRecipient} onChange={V.onEmailRecipient} placeholder="Send reports to (default: same address)" style={input} />
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={V.onEmailSave} style={btn}>Save</button>
            <button onClick={V.onEmailTest} style={btn} disabled={!V.emailConfigured}>Test</button>
            {V.emailConfigured ? <button onClick={V.onEmailRemove} style={{ ...btn, color: '#ff8a80' }}>Remove</button> : null}
          </div>
        </div>
        {V.emailMsg ? <div style={{ ...desc, marginTop: '8px', color: 'var(--gc8c8d0)' }} role="status">{V.emailMsg}</div> : null}
      </div>
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--w60)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={label}>Use my Chrome sign-ins</div>
            <div style={desc}>For links you send from X or LinkedIn, I open just that page with your Chrome sign-in for that site. Nothing is stored; macOS asks once per launch.</div>
            <div style={{ ...desc, color: 'var(--gc8c8d0)' }}>{V.bridgeLine}</div>
          </div>
          <button onClick={V.onBridgeAllow} style={btn}>Allow access</button>
        </div>
        {V.bridgeHasProfiles ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
            {V.bridgeProfiles.map((p: any, i: number) => <button key={i} onClick={p.onClick} style={{ ...btn, background: p.bg }}>{p.label}</button>)}
          </div>
        ) : null}
        {V.bridgeSites?.length ? <div style={{ ...desc, marginTop: '6px' }}>{V.bridgeSites.map((x: any) => x.label).join('  ·  ')}</div> : null}
      </div>
      <div style={{ padding: '12px 0' }}>
        <div style={label}>Signed-in sites</div>
        <div style={desc}>Sites you signed in to from a source window. Sessions stay on this Mac.</div>
        {V.hasSignedInSites ? V.signedInSites.map((x: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
            <span style={{ flex: 1, fontSize: '12.5px' }}>{x.domain}</span>
            <button onClick={x.onSignOut} style={btn}>Sign out</button>
          </div>
        )) : <div style={{ ...desc, marginTop: '6px' }}>None yet.</div>}
      </div>
    </div>
  )
}

export function ThesesExtras({ V }: { V: V }) {
  return (
    <>
      {(V.thesisSuggestRows || []).map((x: any, i: number) => (
        <div key={i} style={{ ...dashed, margin: '8px 10px', borderRadius: '8px' }}>
          <span style={{ color: 'var(--o8-1-255)' }}>◇</span>
          <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 600 }}>Suggested · {x.title}</b> — {x.why}</span>
          <button onClick={x.onCreate} style={btn}>Create</button>
          <button onClick={x.onDismiss} style={btn}>Dismiss</button>
        </div>
      ))}
      {V.thesesEmpty ? <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--g8a8a94)', fontSize: '12.5px' }}>No theses yet. Create one or save a thought.</div> : null}
    </>
  )
}

/** M1: Add-source result cards for sign-in needed / unsupported / unreachable / blocked / single article. */
export function AddSourceCard({ V }: { V: V }) {
  const c = V.addCardV
  return (
    <div style={{ padding: '18px 22px 0', animation: 'fade .2s ease' }}>
      <div role="status" style={{ padding: '14px', borderRadius: '11px', background: 'var(--w40)', border: '1px dashed var(--w160)', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <span style={{ width: '38px', height: '38px', borderRadius: '9px', background: 'var(--w70)', display: 'grid', placeItems: 'center', fontSize: '16px', flexShrink: 0 }}>{c.glyph}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '11px', color: 'var(--o8-12-65)' }}>{c.title}</div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--gf0f0f3)' }}>{V.det?.name}</div>
          <div style={{ fontSize: '12.5px', color: 'var(--gc8c8d0)', marginTop: '6px', lineHeight: 1.5 }}>{c.text}</div>
          {c.hasNote ? <div style={{ fontSize: '11.5px', color: 'var(--g8a8a94)', marginTop: '6px' }}>{c.note}</div> : null}
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            {c.hasRetry ? <button onClick={c.onRetry} style={btn}>Retry</button> : null}
            {c.hasReadOnce ? <button onClick={c.onReadOnce} style={btn}>Read once</button> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/** M8: conflict proposals and possible-duplicate banners under the header chips. */
export function ObjectBanners({ proposals, merges, reading }: { proposals?: any[]; merges?: any[]; reading?: string }) {
  if (!proposals?.length && !merges?.length && !reading) return null
  return (
    <div style={{ display: 'grid', gap: '6px', marginTop: '12px' }}>
      {reading ? <div role="status" data-testid="still-reading" style={{ fontSize: '12px', color: 'var(--g8a8a94)' }}>{reading}</div> : null}
      {(proposals || []).map((p, i) => (
        <div key={'p' + i} role="status" style={dashed}>
          <span style={{ flex: 1, minWidth: 0 }}>{p.text}</span>
          <button onClick={p.onKeep} style={btn}>Keep yours</button>
          <button onClick={p.onUseNew} style={btn}>Use new</button>
        </div>
      ))}
      {(merges || []).map((m, i) => (
        <div key={'m' + i} role="status" style={dashed}>
          <span style={{ flex: 1, minWidth: 0 }}>{m.text}</span>
          <button onClick={m.onMerge} style={btn}>Merge</button>
          <button onClick={m.onNotSame} style={btn}>Not the same</button>
        </div>
      ))}
    </div>
  )
}

function Sheet({ V, children, w = 520, label: aria }: { V: V; children: React.ReactNode; w?: number; label: string }) {
  return (
    <div onClick={V.closeModal} style={sheetWrap}>
      <div role="dialog" aria-label={aria} onClick={V.stop} style={sheet(V.sheetBg, w)}>{children}</div>
    </div>
  )
}

/** Sheets and popovers added by RFC §1A.7: Reset… (M10), merge confirm, rename, Notify me (M5), field popover (M7). */
export function Overlays({ V }: { V: V }) {
  return (
    <>
      {V.mReset ? (
        <Sheet V={V} label="Reset source">
          <div style={{ fontSize: '15px', fontWeight: 650 }}>Reset and re-ingest {V.resetName}?</div>
          <div style={{ fontSize: '12.5px', color: 'var(--g8a8a94)', marginTop: '4px' }}>Use this if the source looks wrong. Nothing you created is lost.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '14px', fontSize: '12.5px', lineHeight: 1.5 }}>
            <div><div style={{ ...label, fontWeight: 600 }}>Kept</div>{V.resetKept.map((x: string, i: number) => <div key={i} style={{ color: 'var(--gc8c8d0)' }}>✓ {x}</div>)}</div>
            <div><div style={{ ...label, fontWeight: 600 }}>Rebuilt</div>{V.resetRebuilt.map((x: string, i: number) => <div key={i} style={{ color: 'var(--gc8c8d0)' }}>↻ {x}</div>)}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
            <button onClick={V.closeModal} style={{ ...btn, height: '28px' }}>Cancel</button>
            <button onClick={V.onResetConfirm} style={primary}>Reset and re-ingest</button>
          </div>
        </Sheet>
      ) : null}
      {V.mDescribe && V.describe.edit ? (
        <Sheet V={V} label="Describe it">
          <div style={{ fontSize: '15px', fontWeight: 650 }}>{V.describe.title}</div>
          <div style={{ fontSize: '12.5px', color: 'var(--g8a8a94)', marginTop: '4px' }}>{V.describe.sub}</div>
          <div style={{ display: 'grid', gap: '10px', marginTop: '14px' }}>
            <label style={{ display: 'grid', gap: '4px' }}><span style={desc}>{V.describe.aboutLabel}</span><input aria-label={V.describe.aboutLabel} value={V.describe.about} onChange={V.describe.onAbout} style={input} /></label>
            {V.describe.fields.map((f: any) => <label key={f.key} style={{ display: 'grid', gap: '4px' }}><span style={desc}>{f.label}</span><input aria-label={f.label} value={f.value} onChange={f.onChange} style={input} /></label>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
            <button onClick={V.closeModal} style={{ ...btn, height: '28px' }}>Cancel</button>
            <button onClick={V.describe.onSave} disabled={V.describe.busy} style={{ ...primary, opacity: V.describe.busy ? 0.6 : 1 }}>Save</button>
          </div>
        </Sheet>
      ) : V.mDescribe && V.describe.add ? (
        <Sheet V={V} label="Describe it">
          <div style={{ fontSize: '15px', fontWeight: 650 }}>{V.describe.title}</div>
          <div style={{ fontSize: '12.5px', color: 'var(--g8a8a94)', marginTop: '4px' }}>{V.describe.sub}</div>
          <div style={{ display: 'grid', gap: '10px', marginTop: '14px' }}>
            <label style={{ display: 'grid', gap: '4px' }}><span style={desc}>{V.describe.nameLabel}</span><input aria-label={V.describe.nameLabel} autoFocus value={V.describe.name} onChange={V.describe.onName} style={input} /></label>
            <label style={{ display: 'grid', gap: '4px' }}><span style={desc}>{V.describe.aboutLabel}</span><input aria-label={V.describe.aboutLabel} placeholder={V.describe.aboutPlaceholder} value={V.describe.about} onChange={V.describe.onAbout} style={input} /></label>
            {V.describe.fields.map((f: any) => <label key={f.key} style={{ display: 'grid', gap: '4px' }}><span style={desc}>{f.label}</span><input aria-label={f.label} value={f.value} onChange={f.onChange} onKeyDown={(e: any) => { if (e.key === 'Enter') V.describe.onCreate() }} style={input} /></label>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
            <button onClick={V.closeModal} style={{ ...btn, height: '28px' }}>Cancel</button>
            <button onClick={V.describe.onCreate} disabled={V.describe.busy} style={{ ...primary, opacity: V.describe.busy ? 0.6 : 1 }}>{V.describe.createLabel}</button>
          </div>
        </Sheet>
      ) : V.mDescribe ? (
        <Sheet V={V} label="Describe it">
          <div style={{ fontSize: '15px', fontWeight: 650 }}>{V.describe.title}</div>
          <div style={{ fontSize: '12.5px', color: 'var(--g8a8a94)', marginTop: '4px' }}>{V.describe.sub}</div>
          <div style={{ display: 'grid', gap: '10px', marginTop: '14px' }}>
            <label style={{ display: 'grid', gap: '4px' }}><span style={desc}>Name</span><input aria-label="Name" value={V.describe.name} onChange={V.describe.onName} style={input} /></label>
            <label style={{ display: 'grid', gap: '4px' }}><span style={desc}>Website</span><input aria-label="Website" placeholder="e.g. cua.ai" value={V.describe.website} onChange={V.describe.onWebsite} style={input} /></label>
            <label style={{ display: 'grid', gap: '4px' }}><span style={desc}>{V.describe.aboutLabel}</span><input aria-label={V.describe.aboutLabel} placeholder="A few words — the news search uses them" value={V.describe.about} onChange={V.describe.onAbout} onKeyDown={(e: any) => { if (e.key === 'Enter') V.describe.onCreate() }} style={input} /></label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
            <button onClick={V.closeModal} style={{ ...btn, height: '28px' }}>Cancel</button>
            <button onClick={V.describe.onCreate} disabled={V.describe.busy} style={{ ...primary, opacity: V.describe.busy ? 0.6 : 1 }}>Start tracking</button>
          </div>
        </Sheet>
      ) : null}
      {V.mMerge ? (
        <Sheet V={V} label="Merge">
          <div style={{ fontSize: '15px', fontWeight: 650 }}>{V.mergeText}</div>
          <div style={{ fontSize: '12.5px', color: 'var(--g8a8a94)', marginTop: '6px' }}>{V.mergeSub}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' }}>
            <button onClick={V.closeModal} style={{ ...btn, height: '28px' }}>Cancel</button>
            <button onClick={V.onMergeConfirm} style={primary}>Merge</button>
          </div>
        </Sheet>
      ) : null}
      {V.mBriefing ? (
        <Sheet V={V} label="Briefing" w={460}>
          <div style={{ fontSize: '15px', fontWeight: 650 }}>{V.brTitle}</div>
          <div style={{ fontSize: '12.5px', color: 'var(--g8a8a94)', marginTop: '3px' }}>One email with a part for each report you pick.</div>
          <input ref={V.brNameRef} aria-label="Briefing name" placeholder="Morning brief" value={V.brName} onChange={V.onBrName} onKeyDown={V.onBrKey} style={{ ...input, marginTop: '12px', height: '34px', fontSize: '13.5px' }} />
          <div style={{ ...label, fontSize: '12px', fontWeight: 600, marginTop: '14px' }}>Reports</div>
          <div style={{ maxHeight: '180px', overflow: 'auto', marginTop: '4px' }}>
            {V.brReports.map((r: any, i: number) => (
              <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '13px', color: 'var(--gececf0)' }}>
                <input type="checkbox" checked={r.on} onChange={r.onToggle} aria-label={r.name} />{r.name}
              </label>
            ))}
          </div>
          <div style={{ ...label, fontSize: '12px', fontWeight: 600, marginTop: '14px' }}>Send</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
            <div role="radiogroup" aria-label="Schedule" style={{ display: 'flex', gap: '2px', padding: '2px', background: 'var(--w50)', borderRadius: '7px' }}>
              {V.brKinds.map((g: any, i: number) => <button key={i} role="radio" aria-checked={g.bg !== 'transparent'} onClick={g.onClick} style={{ height: '22px', padding: '0 10px', border: 'none', borderRadius: '5px', background: g.bg, color: g.color, boxShadow: g.shadow, fontSize: '11.5px', cursor: 'default' }}>{g.label}</button>)}
            </div>
            {V.brTimed ? <input type="time" aria-label="Time" value={V.brAt} onChange={V.onBrAt} style={{ ...input, width: '96px', height: '26px' }} /> : null}
          </div>
          {V.brWeekly ? (
            <div role="radiogroup" aria-label="Day" style={{ display: 'flex', gap: '2px', padding: '2px', background: 'var(--w50)', borderRadius: '7px', marginTop: '8px', width: 'fit-content' }}>
              {V.brDays.map((g: any, i: number) => <button key={i} role="radio" aria-checked={g.bg !== 'transparent'} onClick={g.onClick} style={{ height: '22px', padding: '0 8px', border: 'none', borderRadius: '5px', background: g.bg, color: g.color, boxShadow: g.shadow, fontSize: '11.5px', cursor: 'default' }}>{g.label}</button>)}
            </div>
          ) : null}
          {V.brError ? <div role="alert" style={{ marginTop: '10px', fontSize: '12px', color: '#ff8a80' }}>{V.brError}</div> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
            <button onClick={V.closeModal} style={{ ...btn, height: '28px' }}>Cancel</button>
            <button onClick={V.onBrSave} style={{ ...primary, background: V.brSaveBg }}>{V.brSaveLabel}</button>
          </div>
        </Sheet>
      ) : null}
      {V.mRename ? (
        <Sheet V={V} label="Rename report" w={420}>
          <div style={{ fontSize: '15px', fontWeight: 650 }}>Rename report</div>
          <input aria-label="Report name" autoFocus value={V.renameValue} onChange={V.onRenameValue} onKeyDown={V.onRenameKey} style={{ ...input, marginTop: '12px', height: '34px', fontSize: '13.5px' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
            <button onClick={V.closeModal} style={{ ...btn, height: '28px' }}>Cancel</button>
            <button onClick={V.onRenameSave} style={primary}>Save</button>
          </div>
        </Sheet>
      ) : null}
      {V.mNotify ? (
        <Sheet V={V} label="Notify me" w={560}>
          <div style={{ fontSize: '15px', fontWeight: 650 }}>{V.notifyTitle}</div>
          <div style={{ fontSize: '12.5px', color: 'var(--g8a8a94)', marginTop: '3px' }}>Describe when you want to hear about it. {V.notifyCapCopy}</div>
          <textarea ref={V.notifyRef} aria-label="Alert condition" value={V.notifyText} onChange={V.onNotifyText} rows={2} style={{ width: '100%', marginTop: '12px', resize: 'none', borderRadius: '9px', border: '1px solid var(--w120)', background: 'var(--k250)', padding: '10px 12px', fontSize: '13.5px', lineHeight: 1.45, outline: 'none', userSelect: 'text' }} />
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
            {V.notifyExamples.map((x: any, i: number) => <span key={i} onClick={x.onClick} style={{ fontSize: '11.5px', color: 'var(--g9a9aa4)', padding: '3px 8px', borderRadius: '5px', background: 'var(--w50)', cursor: 'default' }}>{x.label}</span>)}
          </div>
          {V.notifyCompiling ? <div style={{ marginTop: '12px', fontSize: '12.5px', color: 'var(--g8a8a94)', animation: 'pulse 1.4s infinite' }}>Setting up the alert…</div> : null}
          {V.notifyConfirm ? (
            <div style={{ ...dashed, marginTop: '12px', display: 'block' }} role="status">
              <div style={{ color: 'var(--gececf0)' }}>{V.notifySummary}</div>
              <div style={{ color: 'var(--g9a9aa4)', marginTop: '4px' }} data-testid="backtest">{V.notifyBacktest}</div>
            </div>
          ) : null}
          {V.notifyHasError ? <div role="alert" style={{ marginTop: '10px', fontSize: '12px', color: '#ff8a80' }}>{V.notifyError}</div> : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
            <div style={{ display: 'flex', gap: '2px', padding: '2px', background: 'var(--w50)', borderRadius: '7px' }}>
              {V.notifyChannels.map((g: any, i: number) => <button key={i} onClick={g.onClick} style={{ height: '22px', padding: '0 10px', border: 'none', borderRadius: '5px', background: g.bg, color: g.color, boxShadow: g.shadow, fontSize: '11.5px', cursor: 'default' }}>{g.label}</button>)}
            </div>
            <span style={{ flex: 1 }} />
            <button onClick={V.closeModal} style={{ ...btn, height: '28px' }}>Cancel</button>
            <button onClick={V.onNotifyPrimary} style={{ ...primary, background: V.notifyBtnBg }}>{V.notifyPrimary}</button>
          </div>
        </Sheet>
      ) : null}
      {V.popOn ? (
        <div onClick={V.closePopover} style={{ position: 'fixed', inset: 0, zIndex: 70 }}>
          <div role="dialog" aria-label={V.popLabel} onClick={V.stop} style={{ position: 'fixed', left: V.popX, top: V.popY, width: '290px', borderRadius: '10px', background: V.sheetBg, backdropFilter: 'blur(30px)', border: '1px solid var(--w120)', boxShadow: '0 16px 50px var(--k500)', padding: '12px 13px', fontSize: '12.5px', animation: 'pop .14s ease-out' }}>
            <div style={{ fontSize: '11px', color: 'var(--g80808a)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{V.popLabel}</div>
            <div style={{ fontSize: '15px', fontWeight: 600, marginTop: '3px' }}>{V.popValue}</div>
            <div style={{ color: 'var(--g9a9aa4)', marginTop: '2px' }}>{V.popProvenance}</div>
            {V.popHasEarlier ? <div style={{ color: 'var(--o8-12-65)', marginTop: '2px' }}>{V.popEarlier}</div> : null}
            {V.popEditing
              ? <input autoFocus aria-label={'New ' + V.popLabel} value={V.popDraft} onChange={V.onPopDraft} onKeyDown={V.onPopKey} placeholder="Type and press ↵" style={{ ...input, marginTop: '10px' }} />
              : <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}><button onClick={V.onPopChange} style={btn}>Change…</button>{V.popCanRevert ? <button onClick={V.onPopRevert} style={btn}>Revert to source</button> : null}</div>}
            {V.popHasHistory ? (
              <div style={{ marginTop: '10px', borderTop: '1px solid var(--w70)', paddingTop: '8px' }}>
                <div style={{ fontSize: '11px', color: 'var(--g80808a)', fontWeight: 600 }}>History</div>
                {V.popHistory.map((h: any, i: number) => <div key={i} style={{ display: 'flex', gap: '8px', marginTop: '4px' }}><span style={{ flex: 1 }}>{h.text}</span><span style={{ color: 'var(--g80808a)' }}>{h.meta}</span></div>)}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}

/** The asked question, clamped to two lines so a long question never pushes the answer out of view. */
function QuestionEcho({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false)
  const long = (text || '').length > 160
  return (
    <div data-testid="ask-question" style={{ fontSize: '13px', color: 'var(--gececf0)', fontWeight: 600 }}>
      <div style={open || !long ? undefined : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>{text}</div>
      {long ? <span role="button" onClick={() => setOpen(!open)} style={{ fontSize: '11.5px', fontWeight: 400, color: 'var(--o78-11-255)', cursor: 'default' }}>{open ? 'Show less' : 'Show full question'}</span> : null}
    </div>
  )
}

/** DEC-091: Reports ▸ Briefings group — rows styled like the reports list. */
export function BriefingsGroup({ V }: { V: V }) {
  const head: React.CSSProperties = { fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--g80808a)', marginBottom: '8px', display: 'flex', alignItems: 'center' }
  return (
    <div data-testid="briefings">
      <div style={head}>
        <span style={{ flex: 1 }}>Briefings</span>
        <button aria-label="New briefing" onClick={V.onNewBriefing} style={{ border: 'none', background: 'transparent', color: 'var(--g80808a)', fontSize: '12px', cursor: 'default', padding: '0 4px', textTransform: 'none', letterSpacing: 0 }}>+ New briefing</button>
      </div>
      <div style={{ fontSize: '12px', color: 'var(--g8a8a94)', margin: '-2px 0 8px' }}>One email built from the reports you pick — the only thing that emails you.</div>
      <div style={{ borderRadius: '10px', border: '1px solid var(--w70)', overflow: 'hidden' }}>
        {V.brEmpty ? <div style={{ padding: '14px', fontSize: '12.5px', color: 'var(--g8a8a94)' }}>No briefings yet.</div> : null}
        {(V.brRows || []).map((b: any) => (
          <div key={b.id} data-briefing={b.name} onContextMenu={b.onMore} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '11px 14px', borderBottom: '1px solid var(--w45)', opacity: b.op }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', color: 'var(--gececf0)' }}>{b.name}</div>
              <div style={{ fontSize: '11.5px', color: 'var(--g8a8a94)', marginTop: '2px' }}>{b.scheduleText} · <span data-testid="briefing-last" style={{ color: b.lastWarn ? 'var(--o8-12-65)' : undefined }}>{b.last}</span></div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                {b.reports.map((n: string, i: number) => <span key={i} style={{ fontSize: '11px', color: 'var(--gc8c8d0)', padding: '1px 7px', borderRadius: '5px', background: 'var(--w50)' }}>{n}</span>)}
              </div>
            </div>
            <button role="switch" aria-checked={b.emailOn} aria-label={'Email for ' + b.name} title={b.emailHint} onClick={b.onEmail} style={{ display: 'flex', alignItems: 'center', gap: '6px', border: 'none', background: 'transparent', padding: 0, cursor: 'default', opacity: b.emailDisabled ? 0.5 : 1 }}>
              <span style={{ fontSize: '11.5px', color: 'var(--ga6a6b0)' }}>Email</span>
              <span style={{ width: '26px', height: '14px', borderRadius: '7px', background: b.tgBg, position: 'relative', display: 'inline-block' }}><span style={{ position: 'absolute', left: '1px', top: '1px', width: '12px', height: '12px', borderRadius: '50%', background: '#fff', transform: b.tgKnob, transition: 'transform .15s' }} /></span>
            </button>
            <button onClick={b.onSend} style={btn}>Send now</button>
            <button onClick={b.onEdit} style={btn}>Edit</button>
            <button aria-label={'More for ' + b.name} onClick={b.onMore} style={{ ...btn, padding: '0 7px' }}>⋯</button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** M2: grounded answer inside the palette. Facts (with [n] citations), AI interpretation and the user's notes are
 * visibly separate (LAW-04); nothing is shown before the grounding check (the answer arrives whole). */
export function AskPanel({ V }: { V: V }) {
  const H = (t: string, color = 'var(--g80808a)') => <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color, margin: '14px 0 6px' }}>{t}</div>
  const Cites = ({ cs }: { cs: any[] }) => <>{cs.map((c: any, i: number) => <span key={i} role="link" onClick={c.onClick} style={{ marginLeft: '3px', color: 'var(--o78-11-255)', fontSize: '11.5px', cursor: 'default' }}>{c.label}</span>)}</>
  return (
    <div data-testid="answer" style={{ padding: '8px 12px 12px', fontSize: '13.5px', lineHeight: 1.55 }}>
      {(V.pHistory || []).map((h: any, i: number) => <div key={i} style={{ fontSize: '12px', color: 'var(--g80808a)' }}>↳ {h.q}</div>)}
      <QuestionEcho text={V.pAsking ? (V.pAnswerQ || V.pq) : V.pQ} />
      {V.pAsking ? (
        <div style={{ marginTop: '8px', color: 'var(--g8a8a94)', fontSize: '12.5px' }}>
          <div style={{ animation: 'pulse 1.4s infinite' }}>Thinking…</div>
          {V.pScopeLine ? <div style={{ marginTop: '4px' }}>{V.pScopeLine}</div> : null}
          {(V.pThinking || []).filter((t: any) => t.text && t.text !== V.pScopeLine).map((t: any, i: number) => <div key={i} style={{ fontSize: '11.5px' }}>· {t.text}</div>)}
        </div>
      ) : (
        <>
          {V.pBacklog ? <div role="status" data-testid="ask-backlog" style={{ marginTop: '6px', color: 'var(--g8a8a94)', fontSize: '12px' }}>{V.pBacklog}</div> : null}
          {V.pHasErr ? <div role="alert" style={{ marginTop: '8px', color: 'var(--o8-12-65)', fontSize: '12.5px' }}>{V.pErr}</div> : null}
          {V.pHasFacts ? <>{H('From your sources', 'var(--o78-12-155)')}{V.pFacts.map((f: any, i: number) => <div key={i} title={f.quote} style={{ marginBottom: '6px' }}>{f.text}<Cites cs={f.cites} /></div>)}</> : null}
          {V.pInsufficient ? <div style={{ marginTop: '10px', color: 'var(--gc8c8d0)' }}>{V.pInsufficientText}</div> : null}
          {V.pHasInterp ? <>{H('Interpretation · AI')}{V.pInterp.map((f: any, i: number) => <div key={i} style={{ marginBottom: '6px', color: 'var(--gc8c8d0)', fontStyle: 'italic' }}>{f.text}<Cites cs={f.cites} /></div>)}</> : null}
          {V.pHasNotes ? <>{H('Your notes', 'var(--o82-13-85)')}{V.pNotes.map((f: any, i: number) => <div key={i} style={{ marginBottom: '6px' }}>{f.text}<Cites cs={f.cites} /></div>)}</> : null}
          {V.pHasFallback ? <>{H(V.pInsufficient ? 'Closest items in your library' : 'Matching evidence')}{V.pFallback.map((f: any, i: number) => <div key={i} role="link" onClick={f.onClick} style={{ marginBottom: '6px', cursor: 'default' }}>❝ {f.text} <span style={{ color: 'var(--g80808a)', fontSize: '11.5px' }}>{f.src}</span></div>)}</> : null}
          {V.pHasCitations ? (
            <>
              {H('Sources')}
              {V.pCitations.map((c: any, i: number) => (
                <div key={i} role="link" onClick={c.onClick} style={{ display: 'flex', gap: '8px', fontSize: '12px', padding: '3px 0', cursor: 'default' }}>
                  <span style={{ color: 'var(--o78-11-255)' }}>{c.n}</span>
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--gc8c8d0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{c.quote}”</span>
                  <span style={{ color: 'var(--g80808a)', whiteSpace: 'nowrap' }}>{c.src}{c.date ? ' · ' + c.date : ''} · open</span>
                </div>
              ))}
            </>
          ) : null}
          {(V.pFollowups || []).length ? <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>{V.pFollowups.map((f: any, i: number) => <span key={i} onClick={f.onClick} style={{ fontSize: '11.5px', color: 'var(--g9a9aa4)', padding: '3px 8px', borderRadius: '5px', background: 'var(--w50)', cursor: 'default' }}>{f.label}</span>)}</div> : null}
          <input aria-label="Ask a follow-up" data-followup="1" value={V.pFollow} onChange={V.onPFollow} onKeyDown={V.onPFollowKey} placeholder="Ask a follow-up…" style={{ ...input, marginTop: '12px' }} />
        </>
      )}
    </div>
  )
}

export { btn, primary, input, label, desc, sheetWrap, sheet, dashed }

/** §1A.7-M6: Runs ▾ menu next to Run now. */
export function ReportRunsButton({ V }: { V: V }) {
  return <button aria-label="Runs" onClick={V?.pv?.onRuns} style={{ height: '26px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--w100)', background: 'var(--w40)', fontSize: '12px', cursor: 'default' }}>Runs ▾</button>
}

/** §1A.7-M6: "Refine this report…" input under the preview; status line for setup/refine states. */
export function ReportRefine({ V }: { V: V }) {
  const pv = V?.pv
  if (!pv) return null
  return (
    <div style={{ marginTop: '14px' }}>
      {pv.loading ? <div style={{ ...desc, marginBottom: '8px' }}>{pv.draft ? 'Setting up…' : 'Building preview…'}</div> : null}
      {pv.failed ? <div style={{ ...desc, color: 'oklch(0.75 0.15 60)', marginBottom: '8px' }}>Couldn’t set this up. {pv.error}</div> : null}
      {pv.canRefine ? (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input aria-label="Refine this report" placeholder="Refine this report…" value={pv.refineDraft} onChange={pv.onRefineDraft} onKeyDown={pv.onRefineKey} disabled={pv.refineBusy} style={{ ...input, opacity: pv.refineBusy ? 0.6 : 1 }} />
          {pv.refineFailed ? <button onClick={pv.onRefineRetry} style={btn}>Retry</button> : null}
        </div>
      ) : null}
      {pv.refineFailed ? <div style={{ ...desc, color: 'oklch(0.75 0.15 60)' }}>Couldn’t apply · Retry</div> : pv.refineBusy ? <div style={desc}>Applying…</div> : null}
    </div>
  )
}

/** DEC-093: the run as the user will receive it — the main process's email HTML (embed variant) in a sandboxed iframe:
 * no scripts; links (target=_blank) leave through the window-open handler to the system browser; images load with no
 * referrer. The parent sizes the frame to its content (same-origin read, allowed without allow-scripts). */
export function ReportView({ V }: { V: V }) {
  const pv = V?.pv
  const ref = React.useRef<HTMLIFrameElement | null>(null)
  const [h, setH] = React.useState(480)
  const expandRef = React.useRef<(() => void) | null>(null)
  expandRef.current = pv?.onExpand || null
  React.useEffect(() => {
    const f = ref.current
    if (!f) return
    let ro: ResizeObserver | null = null
    const fit = () => { const d = f.contentDocument; if (d?.body) setH(Math.max(120, d.documentElement.scrollHeight)) }
    // double-click anywhere in the run opens the full-window reader (Backlog "Reading first"); the frame's document is
    // same-origin, so the parent can listen on it without allowing scripts inside it
    const open = () => expandRef.current && expandRef.current()
    const onLoad = () => { fit(); const d = f.contentDocument; if (d?.body) { ro?.disconnect(); ro = new ResizeObserver(fit); ro.observe(d.body); d.addEventListener('dblclick', open) } }
    f.addEventListener('load', onLoad)
    return () => { f.removeEventListener('load', onLoad); ro?.disconnect(); f.contentDocument?.removeEventListener('dblclick', open) }
  }, [pv?.view])
  if (!pv?.view) return null
  return <iframe ref={ref} title={'Report: ' + (pv.name || '') + ' — double-click to read full window'} data-testid="report-view" srcDoc={pv.view} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
    style={{ display: 'block', width: '100%', height: h + 'px', border: 'none', marginTop: '16px', borderRadius: '14px', background: '#ffffff', colorScheme: 'light' }} />
}
