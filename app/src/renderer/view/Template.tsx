// GENERATED ONCE by app/scripts/convert-prototype.mjs from the approved prototype, then maintained by hand.
// Every binding reads from the view-model V computed by the controller (port of the prototype's rv*() methods).
/* eslint-disable */
import React from 'react'
import { FromYou, LookupLine, HintCard, ReprocessLine } from './FromYou'
import { ReportRefineTop, ReportSettingsStrip, ReportReader } from './ReportPanel'
import { AccountsPane, ThesesExtras, AddSourceCard, ObjectBanners, Overlays, AskPanel, ReportRunsButton, ReportRefine, ReportView, BriefingsGroup } from './Additions'

export function Template({ V }: { V: any }) {
  return (
    <>
      <div data-theme={V?.themeAttr} onMouseMove={V?.onRootMove} onMouseUp={V?.onRootUp} onClick={V?.onRootClick} style={{ "position": "fixed", "inset": "0", "fontFamily": "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Helvetica,sans-serif", "fontSize": "13px", "color": "var(--ge8e8ec)", "WebkitFontSmoothing": "antialiased", "display": "flex", "userSelect": "none" }}>
        <div style={{ "flex": "1", "display": "flex", "minWidth": "0", "overflow": "hidden", "position": "relative" }}>
          <aside style={{ "width": V?.sideW, "flexShrink": "0", "position": "relative", "display": "flex", "flexDirection": "column", "background": V?.sideBg, "backdropFilter": V?.sideBlur, "WebkitBackdropFilter": V?.sideBlur, "borderRight": "1px solid var(--w70)" }}>
            <div style={{ "height": "50px", "display": "flex", "alignItems": "center", "gap": "8px", "padding": "0 16px", "flexShrink": "0", "WebkitAppRegion": "drag" } as any}>
              {/* DEC-032: native traffic lights sit here (trafficLightPosition 16,18) */}
            </div>
            <div style={{ "padding": "0 10px 10px" }}>
              {' '}
              <button onClick={V?.openPalette} style={{ "width": "100%", "height": "28px", "display": "flex", "alignItems": "center", "gap": "8px", "padding": "0 9px", "borderRadius": "7px", "border": "1px solid var(--w80)", "background": "var(--w50)", "color": "var(--g8e8e98)", "fontSize": "12.5px", "cursor": "default" }} className="dch0">
                <span style={{ "fontSize": "13px" }}>
                  {"⌕"}
                </span>
                <span style={{ "flex": "1", "textAlign": "left" }}>
                  {"Search research"}
                </span>
                <span style={{ "fontSize": "11px", "color": "var(--g6f6f79)" }}>
                  {"⌘K"}
                </span>
              </button>
              {' '}
            </div>
            <div style={{ "flex": "1", "overflow": "auto", "padding": "0 10px 10px", "display": "grid", "alignContent": "start", "gap": "1px" }}>
              {((V?.navMain) || []).map((n: any, n_i0: number) => (
                <React.Fragment key={n_i0}>
                  <div role="button" aria-label={n?.label} onClick={n?.onClick} style={{ "height": "28px", "display": "flex", "alignItems": "center", "gap": "9px", "padding": "0 8px", "borderRadius": "6px", "background": n?.bg, "color": n?.color, "cursor": "default" }}>
                    <span style={{ "width": "16px", "textAlign": "center", "color": n?.iconColor, "fontSize": "13px" }}>
                      {n?.icon}
                    </span>
                    <span style={{ "flex": "1" }}>
                      {n?.label}
                    </span>
                    <span style={{ "fontSize": "11px", "color": "var(--g8a8a94)", "fontVariantNumeric": "tabular-nums" }}>
                      {n?.count}
                    </span>
                  </div>
                </React.Fragment>
              ))}
              <div style={{ "fontSize": "11px", "fontWeight": "600", "color": "var(--g7c7c86)", "padding": "14px 8px 5px" }}>
                {"Research"}
              </div>
              {((V?.navResearch) || []).map((n: any, n_i1: number) => (
                <React.Fragment key={n_i1}>
                  <div role="button" aria-label={n?.label} onClick={n?.onClick} style={{ "height": "28px", "display": "flex", "alignItems": "center", "gap": "9px", "padding": "0 8px", "borderRadius": "6px", "background": n?.bg, "color": n?.color, "cursor": "default" }}>
                    <span style={{ "width": "16px", "textAlign": "center", "color": n?.iconColor, "fontSize": "13px" }}>
                      {n?.icon}
                    </span>
                    <span style={{ "flex": "1" }}>
                      {n?.label}
                    </span>
                    <span style={{ "fontSize": "11px", "color": "var(--g8a8a94)", "fontVariantNumeric": "tabular-nums" }}>
                      {n?.count}
                    </span>
                  </div>
                </React.Fragment>
              ))}
              {V?.hasViews ? (
              <>
                <div style={{ "fontSize": "11px", "fontWeight": "600", "color": "var(--g7c7c86)", "padding": "14px 8px 5px" }}>{"Views"}</div>
                {((V?.viewsNav) || []).map((n: any, i: number) => (
                  <div key={i} role="button" aria-label={n?.label} onClick={n?.onClick} onContextMenu={n?.onCtx} style={{ "height": "28px", "display": "flex", "alignItems": "center", "gap": "9px", "padding": "0 8px", "borderRadius": "6px", "background": n?.bg, "color": n?.color, "cursor": "default" }}>
                    <span style={{ "width": "16px", "textAlign": "center", "color": n?.iconColor, "fontSize": "12px" }}>{"▤"}</span>
                    <span style={{ "flex": "1", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>{n?.label}</span>
                  </div>
                ))}
              </>
            ) : null}
            <div style={{ "display": "flex", "alignItems": "center", "padding": "14px 8px 5px" }}>
                <span style={{ "flex": "1", "fontSize": "11px", "fontWeight": "600", "color": "var(--g7c7c86)" }}>
                  {"Pinned theses"}
                </span>
                <span onClick={V?.newThesis} title="New thesis" style={{ "fontSize": "14px", "color": "var(--g7c7c86)", "cursor": "default", "width": "16px", "textAlign": "center" }} className="dch1">
                  {"+"}
                </span>
              </div>
              {((V?.pinnedT) || []).map((n: any, n_i2: number) => (
                <React.Fragment key={n_i2}>
                  <div draggable="true" onDragStart={n?.onDragStart} onDragOver={n?.onDragOver} onDrop={n?.onDrop} role="button" aria-label={n?.label} onClick={n?.onClick} onContextMenu={n?.onCtx} style={{ "height": "28px", "display": "flex", "alignItems": "center", "gap": "9px", "padding": "0 8px", "borderRadius": "6px", "background": n?.bg, "color": n?.color, "cursor": "default", "borderTop": n?.dropLine }}>
                    <span style={{ "width": "16px", "textAlign": "center", "color": n?.dot, "fontSize": "11px" }}>
                      {"◆"}
                    </span>
                    <span style={{ "flex": "1", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                      {n?.label}
                    </span>
                    <span style={{ "fontSize": "10.5px", "color": "var(--o8-1-255)", "fontVariantNumeric": "tabular-nums" }}>
                      {n?.count}
                    </span>
                  </div>
                </React.Fragment>
              ))}
              <div style={{ "fontSize": "11px", "fontWeight": "600", "color": "var(--g7c7c86)", "padding": "14px 8px 5px" }}>
                {"Pinned companies"}
              </div>
              {((V?.pinnedC) || []).map((n: any, n_i3: number) => (
                <React.Fragment key={n_i3}>
                  <div draggable="true" onDragStart={n?.onDragStart} onDragOver={n?.onDragOver} onDrop={n?.onDrop} role="button" aria-label={n?.label} onClick={n?.onClick} onContextMenu={n?.onCtx} style={{ "height": "28px", "display": "flex", "alignItems": "center", "gap": "9px", "padding": "0 8px", "borderRadius": "6px", "background": n?.bg, "color": n?.color, "cursor": "default", "borderTop": n?.dropLine }}>
                    <span style={{ "width": "16px", "height": "16px", "borderRadius": "4px", "background": n?.tile, "color": "#15161a", "fontSize": "9.5px", "fontWeight": "700", "display": "grid", "placeItems": "center" }}>
                      {n?.initial}
                    </span>
                    <span style={{ "flex": "1" }}>
                      {n?.label}
                    </span>
                    <span style={{ "width": "5px", "height": "5px", "borderRadius": "50%", "background": n?.fresh }} />
                  </div>
                </React.Fragment>
              ))}
            </div>
            <div style={{ "padding": "8px 10px 10px", "borderTop": "1px solid var(--w60)", "display": "grid", "gap": "1px", "flexShrink": "0" }}>
              <div role="button" aria-label="Sources" onClick={V?.navSources?.onClick} style={{ "height": "28px", "display": "flex", "alignItems": "center", "gap": "9px", "padding": "0 8px", "borderRadius": "6px", "background": V?.navSources?.bg, "color": V?.navSources?.color, "cursor": "default" }}>
                <span style={{ "width": "16px", "textAlign": "center", "color": V?.navSources?.iconColor }}>
                  {"≋"}
                </span>
                <span style={{ "flex": "1" }}>
                  {"Sources"}
                </span>
                <span style={{ "fontSize": "11px", "color": "var(--g8a8a94)" }}>
                  {V?.navSources?.count}
                </span>
              </div>
              <div role="button" aria-label="Add source" onClick={V?.openAddSource} style={{ "height": "28px", "display": "flex", "alignItems": "center", "gap": "9px", "padding": "0 8px", "borderRadius": "6px", "color": "var(--gc8c8d0)", "cursor": "default" }} className="dch2">
                <span style={{ "width": "16px", "textAlign": "center", "color": "var(--g8c8c96)" }}>
                  {"+"}
                </span>
                <span>
                  {"Add source"}
                </span>
              </div>
              <div role="button" aria-label="Settings" onClick={V?.openSettings} style={{ "height": "28px", "display": "flex", "alignItems": "center", "gap": "9px", "padding": "0 8px", "borderRadius": "6px", "color": "var(--gc8c8d0)", "cursor": "default" }} className="dch3">
                <span style={{ "width": "16px", "textAlign": "center", "color": "var(--g8c8c96)" }}>
                  {"◍"}
                </span>
                <span style={{ "flex": "1" }}>
                  {"Settings"}
                </span>
                <span style={{ "fontSize": "11px", "color": "var(--g6f6f79)" }}>
                  {"⌘,"}
                </span>
              </div>
              <div style={{ "display": "flex", "alignItems": "center", "gap": "9px", "padding": "8px 6px 0", "marginTop": "4px" }}>
                <span style={{ "width": "26px", "height": "26px", "borderRadius": "50%", "background": "oklch(0.72 0.08 60)", "color": "#1a1a1a", "fontSize": "11px", "fontWeight": "700", "display": "grid", "placeItems": "center" }}>
                  {V?.userInitials}
                </span>
                <div style={{ "flex": "1", "minWidth": "0", "lineHeight": "1.25" }}>
                  {' '}
                  <div style={{ "fontSize": "12.5px", "color": "var(--ge8e8ec)" }}>
                    {V?.userName}
                  </div>
                  {' '}
                  <div onClick={V?.openLocal} title="Your library is stored and indexed on this Mac" style={{ "fontSize": "11px", "color": "var(--g8a8a94)", "display": "flex", "alignItems": "center", "gap": "5px", "cursor": "default" }}>
                    <span style={{ "width": "6px", "height": "6px", "borderRadius": "50%", "background": "var(--o76-12-155)" }} />
                    <span style={{ "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                      {"Local · indexed "}{V?.lastIndexed}
                    </span>
                  </div>
                  {' '}
                </div>
              </div>
            </div>
            <div onMouseDown={V?.startResize} style={{ "position": "absolute", "top": "0", "right": "-3px", "bottom": "0", "width": "6px", "cursor": "col-resize", "zIndex": "5" }} />
          </aside>
          <main style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "background": "var(--main)" }}>
            <div style={{ "height": "50px", "flexShrink": "0", "display": "flex", "alignItems": "center", "gap": "10px", "padding": "0 14px 0 12px", "borderBottom": "1px solid var(--w60)" }}>
              <div style={{ "display": "flex", "gap": "2px" }}>
                <button onClick={V?.onBack} title="Back  [" style={{ "width": "28px", "height": "26px", "border": "none", "borderRadius": "6px", "background": "transparent", "color": V?.backColor, "fontSize": "15px", "cursor": "default" }} className="dch4">
                  {"‹"}
                </button>
                <button onClick={V?.onFwd} title="Forward  ]" style={{ "width": "28px", "height": "26px", "border": "none", "borderRadius": "6px", "background": "transparent", "color": V?.fwdColor, "fontSize": "15px", "cursor": "default" }} className="dch5">
                  {"›"}
                </button>
              </div>
              <div style={{ "minWidth": "0", "flex": "1", "display": "flex", "alignItems": "baseline", "gap": "8px", "overflow": "hidden" }}>
                <span style={{ "fontSize": "13.5px", "fontWeight": "600", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                  {V?.tbTitle}
                </span>
                <span style={{ "fontSize": "12px", "color": "var(--g8a8a94)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                  {V?.tbSub}
                </span>
              </div>
              {V?.isInbox ? (
                <>
                  <div style={{ "display": "flex", "gap": "6px", "alignItems": "center" }}>
                    <button onClick={V?.onFilterMenu} style={{ "height": "26px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": V?.filterBtnBg, "color": "var(--gd8d8de)", "fontSize": "12px", "cursor": "default", "display": "flex", "alignItems": "center", "gap": "6px" }}>
                      {"Filter"}
                      <span style={{ "color": "var(--g8a8a94)" }}>
                        {"▾"}
                      </span>
                    </button>
                    <button onClick={V?.onGroupMenu} style={{ "height": "26px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": "var(--w40)", "color": "var(--gd8d8de)", "fontSize": "12px", "cursor": "default", "display": "flex", "alignItems": "center", "gap": "6px" }}>
                      {V?.groupLabel}
                      <span style={{ "color": "var(--g8a8a94)" }}>
                        {"▾"}
                      </span>
                    </button>
                    <button onClick={V?.toggleInspector} title="Toggle inspector  I" style={{ "width": "30px", "height": "26px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": V?.inspBtnBg, "color": "var(--gd8d8de)", "fontSize": "13px", "cursor": "default" }}>
                      {"◧"}
                    </button>
                  </div>
                </>
              ) : null}
              <button onClick={V?.onCreate} title="Create  N" style={{ "height": "26px", "padding": "0 11px 0 9px", "borderRadius": "6px", "border": "none", "background": "oklch(0.6 0.15 258)", "color": "#fff", "fontSize": "12px", "fontWeight": "500", "cursor": "default", "display": "flex", "alignItems": "center", "gap": "6px", "boxShadow": "inset 0 0.5px 0 var(--w300)" }} className="dch6">
                <span style={{ "fontSize": "14px", "lineHeight": "1" }}>
                  {"+"}
                </span>
                {"New"}
              </button>
            </div>
            {V?.loading ? (
              <>
                <div style={{ "flex": "1", "padding": "24px", "display": "flex", "flexDirection": "column", "gap": "10px" }}>
                  <div style={{ "height": "14px", "width": "30%", "borderRadius": "4px", "background": "var(--w70)", "animation": "pulse 1.2s infinite" }} />
                  <div style={{ "height": "60px", "borderRadius": "8px", "background": "var(--w50)", "animation": "pulse 1.2s infinite" }} />
                  <div style={{ "height": "60px", "borderRadius": "8px", "background": "var(--w50)", "animation": "pulse 1.2s infinite" }} />
                </div>
              </>
            ) : null}
            {V?.isInbox ? (
              <>
                <div style={{ "flex": "1", "minHeight": "0", "display": "flex" }}>
                  <div style={{ "width": "clamp(330px,31vw,420px)", "flexShrink": "0", "display": V?.listDisplay, "flexDirection": "column", "borderRight": "1px solid var(--w60)", "minHeight": "0" }}>
                    {V?.bannerOn ? (
                      <div role="status" aria-label="Notice" style={{ "margin": "10px 12px 0", "padding": "7px 8px 7px 11px", "borderRadius": "8px", "border": "1px dashed oklch(0.75 0.12 65 / 0.45)", "background": "oklch(0.75 0.12 65 / 0.10)", "display": "flex", "alignItems": "center", "gap": "8px", "fontSize": "12px", "color": "var(--ge8e8ec)" }}>
                        <span style={{ "color": "var(--o8-12-65)" }}>{"!"}</span>
                        <span style={{ "flex": "1", "minWidth": "0", "lineHeight": "1.4" }}>{V?.bannerText}</span>
                        {V?.bannerHasAction ? (<button onClick={V?.onBannerAction} style={{ "height": "22px", "padding": "0 9px", "borderRadius": "5px", "border": "1px solid var(--w120)", "background": "var(--w60)", "fontSize": "11.5px", "cursor": "default", "whiteSpace": "nowrap" }}>{V?.bannerAction}</button>) : null}
                        {V?.bannerHasAction2 ? (<button onClick={V?.onBannerAction2} style={{ "height": "22px", "padding": "0 9px", "borderRadius": "5px", "border": "1px solid var(--w120)", "background": "transparent", "fontSize": "11.5px", "cursor": "default", "whiteSpace": "nowrap" }}>{V?.bannerAction2}</button>) : null}
                        {V?.bannerDismissable ? (<button onClick={V?.onBannerDismiss} aria-label="Dismiss" title="Dismiss" style={{ "width": "20px", "height": "20px", "border": "none", "background": "transparent", "color": "var(--g8e8e98)", "cursor": "default" }}>{"✕"}</button>) : null}
                      </div>
                    ) : null}
                    {' '}
                    <div style={{ "padding": "14px 16px 12px", "borderBottom": "1px solid var(--w50)" }}>
                      {' '}
                      <div style={{ "display": "flex", "alignItems": "baseline", "justifyContent": "space-between", "gap": "8px" }}>
                        <div style={{ "fontSize": "21px", "fontWeight": "650", "letterSpacing": "-0.015em" }}>
                          {V?.inboxTitle}
                        </div>
                        <div style={{ "fontSize": "11.5px", "color": "var(--g9a9aa4)", "fontVariantNumeric": "tabular-nums" }}>
                          {V?.remainingLabel}
                        </div>
                      </div>
                      {' '}
                      <div style={{ "fontSize": "12px", "color": "var(--g8a8a94)", "marginTop": "3px" }}>
                        {V?.inboxSub}
                      </div>
                      {' '}
                      <div style={{ "height": "3px", "background": "var(--w60)", "borderRadius": "2px", "marginTop": "10px", "overflow": "hidden" }}>
                        <div role="progressbar" aria-label="Today progress" aria-valuetext={V?.doneW} style={{ "height": "100%", "width": V?.doneW, "background": "var(--o72-11-255)", "borderRadius": "2px", "transition": "width .35s ease" }} />
                      </div>
                      {' '}
                      <div style={{ "display": "flex", "gap": "2px", "marginTop": "12px", "padding": "2px", "background": "var(--w50)", "borderRadius": "7px" }}>
                        {((V?.segs) || []).map((g: any, g_i4: number) => (
                          <React.Fragment key={g_i4}>
                            <button onClick={g?.onClick} style={{ "flex": "1", "height": "24px", "border": "none", "borderRadius": "5px", "background": g?.bg, "color": g?.color, "fontSize": "11.5px", "boxShadow": g?.shadow, "cursor": "default", "display": "flex", "alignItems": "center", "justifyContent": "center", "gap": "4px", "whiteSpace": "nowrap", "padding": "0 4px" }}>
                              {g?.label}
                              <span style={{ "fontSize": "10.5px", "color": "var(--g80808a)", "fontVariantNumeric": "tabular-nums" }}>
                                {g?.count}
                              </span>
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                      {' '}
                      {V?.hasFilter ? (
                        <>
                          {' '}
                          <div style={{ "display": "flex", "alignItems": "center", "gap": "6px", "marginTop": "10px" }}>
                            <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "6px", "height": "22px", "padding": "0 4px 0 8px", "borderRadius": "5px", "background": "oklch(0.62 0.15 258 / 0.2)", "color": "var(--o85-09-258)", "fontSize": "11.5px" }}>
                              {"◆ "}{V?.filterLabel}
                              <span role="button" aria-label="Clear filter" onClick={V?.clearFilter} style={{ "padding": "0 4px", "cursor": "default" }}>
                                {"✕"}
                              </span>
                            </span>
                            <span role="button" onClick={V?.saveView} style={{ "fontSize": "11.5px", "color": "var(--g9a9aa4)", "cursor": "default" }} className="dch7">
                              {V?.saveViewLabel}
                            </span>
                          </div>
                          {' '}
                        </>
                      ) : null}
                      {' '}
                    </div>
                    {' '}
                    {V?.hasMulti ? (
                      <>
                        {' '}
                        <div style={{ "display": "flex", "alignItems": "center", "gap": "6px", "padding": "8px 12px", "background": "oklch(0.62 0.15 258 / 0.14)", "borderBottom": "1px solid var(--w60)", "fontSize": "12px" }}>
                          <span style={{ "flex": "1", "color": "var(--gdcdce2)" }}>
                            {V?.multiCount}{" selected"}
                          </span>
                          <button onClick={V?.bulkSave} style={{ "height": "22px", "padding": "0 8px", "borderRadius": "5px", "border": "1px solid var(--w120)", "background": "var(--w60)", "fontSize": "11.5px", "cursor": "default" }}>
                            {"Save"}
                          </button>
                          <button onClick={V?.bulkRead} style={{ "height": "22px", "padding": "0 8px", "borderRadius": "5px", "border": "1px solid var(--w120)", "background": "var(--w60)", "fontSize": "11.5px", "cursor": "default" }}>
                            {"Mark read"}
                          </button>
                          <button onClick={V?.bulkDismiss} style={{ "height": "22px", "padding": "0 8px", "borderRadius": "5px", "border": "1px solid var(--w120)", "background": "var(--w60)", "fontSize": "11.5px", "cursor": "default" }}>
                            {"Dismiss"}
                          </button>
                          <span onClick={V?.bulkClear} style={{ "color": "var(--g9a9aa4)", "padding": "0 4px", "cursor": "default" }}>
                            {"✕"}
                          </span>
                        </div>
                        {' '}
                      </>
                    ) : null}
                    {' '}
                    <div ref={V?.listRef} style={{ "flex": "1", "overflow": "auto", "padding": "4px 0 24px" }}>
                      {' '}
                      {((V?.groups) || []).map((grp: any, grp_i5: number) => (
                        <React.Fragment key={grp_i5}>
                          {' '}
                          <div onClick={grp?.onToggle} role="heading" aria-level={3} aria-label={grp?.label} style={{ "display": "flex", "alignItems": "center", "gap": "6px", "padding": "12px 18px 6px", "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.04em", "textTransform": "uppercase", "color": "var(--g80808a)", "cursor": "default" }}>
                            <span style={{ "width": "10px", "fontSize": "9px" }}>
                              {grp?.chev}
                            </span>
                            <span>
                              {grp?.label}
                            </span>
                            <span style={{ "fontWeight": "500", "color": "var(--g65656e)" }}>
                              {grp?.count}
                            </span>
                          </div>
                          {grp?.hint ? (
                            <div style={{ "display": "flex", "alignItems": "center", "gap": "8px", "padding": "2px 26px 12px", "fontSize": "12px", "color": "var(--g868690)" }}>
                              <span>{grp?.hint}</span>
                              <button onClick={grp?.onHint} style={{ "height": "22px", "padding": "0 8px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "color": "var(--gc8c8d0)", "fontSize": "11.5px", "cursor": "default" }}>{"Add a thesis"}</button>
                            </div>
                          ) : null}
                          {' '}
                          {((grp?.items) || []).map((it: any, it_i6: number) => (
                            <React.Fragment key={it_i6}>
                              {' '}
                              <div data-item={it?.id} onClick={it?.onClick} onContextMenu={it?.onCtx} onMouseEnter={it?.onEnter} onMouseLeave={V?.hoverOff} style={{ "position": "relative", "padding": V?.cardPad, "margin": "0 8px 2px", "borderRadius": "8px", "background": it?.bg, "boxShadow": it?.ring, "cursor": "default", "transition": "background .12s ease" }}>
                                {' '}
                                <div style={{ "display": "flex", "alignItems": "center", "gap": "6px", "fontSize": "11.5px", "color": "var(--g868690)", "paddingRight": it?.metaPad }}>
                                  <span style={{ "width": "6px", "height": "6px", "borderRadius": "50%", "background": it?.dotColor, "marginLeft": "-10px", "flexShrink": "0" }} />
                                  <span style={{ "width": "14px", "height": "14px", "borderRadius": "3.5px", "background": it?.srcColor, "color": "#15161a", "fontSize": "8.5px", "fontWeight": "700", "display": "grid", "placeItems": "center", "flexShrink": "0" }}>
                                    {it?.srcInitial}
                                  </span>
                                  <span style={{ "color": "var(--gb8b8c0)", "whiteSpace": "nowrap" }}>
                                    {it?.source}
                                  </span>
                                  <span>
                                    {"·"}
                                  </span>
                                  <span style={{ "whiteSpace": "nowrap" }}>
                                    {it?.time}
                                  </span>
                                  <span>
                                    {"·"}
                                  </span>
                                  <span style={{ "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                    {it?.srcType}
                                  </span>
                                  <span style={{ "marginLeft": "auto", "color": "var(--o82-13-85)", "fontSize": "11px" }}>
                                    {it?.savedGlyph}
                                  </span>
                                </div>
                                {' '}
                                <div style={{ "fontSize": "13.5px", "fontWeight": it?.titleWeight, "color": it?.titleColor, "marginTop": "5px", "lineHeight": "1.32", "letterSpacing": "-0.005em", "textWrap": "pretty" }}>
                                  {it?.title}
                                </div>
                                {' '}
                                {it?.full ? (
                                <>
<div style={{ "fontSize": "12.5px", "color": "var(--g9d9da7)", "marginTop": "3px", "lineHeight": "1.42", "display": "-webkit-box", "WebkitLineClamp": "2", "WebkitBoxOrient": "vertical", "overflow": "hidden" }}>
                                  {it?.summary}
                                </div>
                                {' '}
                                <div style={{ "display": "flex", "alignItems": "center", "gap": "5px", "marginTop": "7px", "flexWrap": "wrap" }}>
{it?.hasStance ? (
                                  <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "5px", "height": "19px", "padding": "0 7px", "borderRadius": "5px", "background": it?.stanceBg, "color": it?.stanceColor, "fontSize": "11px", "whiteSpace": "nowrap" }}>
                                    {it?.stanceLabel}{" · "}{it?.thesisName}
                                  </span>
                                  ) : null}
                                  {((it?.chips) || []).map((ch: any, ch_i7: number) => (
                                    <React.Fragment key={ch_i7}>
                                      <span onClick={ch?.onClick} onContextMenu={ch?.onCtx} style={{ "display": "inline-flex", "alignItems": "center", "gap": "4px", "height": "19px", "padding": "0 6px", "borderRadius": "5px", "background": "var(--w60)", "color": "var(--gc4c4cc)", "fontSize": "11px", "cursor": "default" }} className="dch8">
                                        <span style={{ "width": "9px", "height": "9px", "borderRadius": "2.5px", "background": ch?.tile }} />
                                        {ch?.label}
                                      </span>
                                    </React.Fragment>
                                  ))}
                                  {it?.review ? (
                                    <>
                                      <span style={{ "height": "19px", "padding": "0 6px", "borderRadius": "5px", "border": "1px dashed var(--w180)", "color": "var(--ga6a6b0)", "fontSize": "10.5px", "display": "inline-flex", "alignItems": "center" }}>
                                        {"Needs review"}
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                                {' '}
                                <div style={{ "fontSize": "11px", "color": "var(--g74747e)", "marginTop": "6px", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                  {it?.reason}
                                </div>
                                </>
                                ) : null}
                                {' '}
                                <div style={{ "position": "absolute", "top": "7px", "right": "8px", "display": "flex", "gap": "1px", "padding": "2px", "borderRadius": "7px", "background": "var(--pop)", "border": "1px solid var(--w80)", "boxShadow": "0 4px 12px var(--k300)", "opacity": it?.actOp, "pointerEvents": it?.actPe, "transition": "opacity .12s" }}>
                                  <button onClick={it?.onSave} title={it?.saveTitle} style={{ "width": "24px", "height": "22px", "border": "none", "borderRadius": "5px", "background": "transparent", "color": it?.saveColor, "fontSize": "12px", "cursor": "default" }} className="dch9">
                                    {it?.saveIcon}
                                  </button>
                                  <button onClick={it?.onThought} title="Add thought" style={{ "width": "24px", "height": "22px", "border": "none", "borderRadius": "5px", "background": "transparent", "color": "var(--gc8c8d0)", "fontSize": "12px", "cursor": "default" }} className="dch10">
                                    {"✎"}
                                  </button>
                                  <button onClick={it?.onDismiss} title="Dismiss  E" style={{ "width": "24px", "height": "22px", "border": "none", "borderRadius": "5px", "background": "transparent", "color": "var(--gc8c8d0)", "fontSize": "11px", "cursor": "default" }} className="dch11">
                                    {"✕"}
                                  </button>
                                  <button onClick={it?.onMore} title="More" style={{ "width": "24px", "height": "22px", "border": "none", "borderRadius": "5px", "background": "transparent", "color": "var(--gc8c8d0)", "fontSize": "12px", "cursor": "default" }} className="dch12">
                                    {"⋯"}
                                  </button>
                                </div>
                                {' '}
                              </div>
                              {' '}
                            </React.Fragment>
                          ))}
                          {' '}
                        </React.Fragment>
                      ))}
                      {' '}
                      {V?.listEmpty ? (
                        <>
                          {' '}
                          <div style={{ "padding": "60px 28px", "textAlign": "center", "color": "var(--g8a8a94)" }}>
                            {' '}
                            <div style={{ "fontSize": "22px", "color": "var(--g5c5c66)" }}>
                              {"◇"}
                            </div>
                            {' '}
                            <div style={{ "fontSize": "14px", "color": "var(--gd0d0d6)", "marginTop": "10px" }}>
                              {V?.emptyTitle}
                            </div>
                            {' '}
                            <div style={{ "fontSize": "12.5px", "marginTop": "6px", "lineHeight": "1.5", "textWrap": "pretty" }}>
                              {V?.emptySub}
                            </div>
                            {V?.emptyShowAdd ? (<button onClick={V?.emptyAddSource} style={{ "marginTop": "14px", "height": "28px", "padding": "0 12px", "borderRadius": "7px", "border": "none", "background": "oklch(0.6 0.15 258)", "color": "#fff", "fontSize": "12.5px", "cursor": "default" }}>{"Add a source"}</button>) : null}
                            {' '}
                          </div>
                          {' '}
                        </>
                      ) : null}
                      {' '}
                    </div>
                    {' '}
                    <div style={{ "padding": "7px 16px", "borderTop": "1px solid var(--w50)", "fontSize": "11px", "color": "var(--g6f6f79)", "display": "flex", "gap": "12px", "whiteSpace": "nowrap", "overflow": "hidden" }}>
                      <span>
                        {"J K move"}
                      </span>
                      <span>
                        {"S save"}
                      </span>
                      <span>
                        {"E dismiss"}
                      </span>
                      <span>
                        {"↵ focus"}
                      </span>
                      <span>
                        {"⌘-click select"}
                      </span>
                    </div>
                    {' '}
                  </div>
                  {V?.hasSel ? (
                    <>
                      <div style={{ "flex": "1", "minWidth": "0", "display": "flex", "flexDirection": "column", "position": "relative" }}>
                        <div style={{ "height": "42px", "flexShrink": "0", "display": "flex", "alignItems": "center", "gap": "6px", "padding": "0 12px", "borderBottom": "1px solid var(--w50)", "minWidth": "0", "overflow": "hidden" }}>
                          <span style={{ "width": "16px", "height": "16px", "borderRadius": "4px", "background": V?.r?.srcColor, "color": "#15161a", "fontSize": "9px", "fontWeight": "700", "display": "grid", "placeItems": "center" }}>
                            {V?.r?.srcInitial}
                          </span>
                          <span style={{ "fontSize": "12.5px", "color": "var(--gc8c8d0)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis", "minWidth": "0" }}>
                            {V?.r?.source}
                          </span>
                          {V?.r?.hasUrl ? (<a href="#" onClick={V?.r?.onOriginal} title="Open original" aria-label="Open original" style={{ "fontSize": "12px", "whiteSpace": "nowrap", "flexShrink": "0" }}>
                            {"↗"}
                          </a>) : null}
                          <span style={{ "flex": "1" }} />
                          <button onClick={V?.r?.onSave} style={{ "height": "24px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": V?.r?.saveBg, "color": V?.r?.saveColor, "fontSize": "12px", "cursor": "default", "whiteSpace": "nowrap", "flexShrink": "0" }}>
                            {V?.r?.saveIcon}{" "}{V?.r?.saveLabel}
                          </button>
                          <button onClick={V?.r?.onAttach} style={{ "height": "24px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": "var(--w40)", "color": "var(--gd8d8de)", "fontSize": "12px", "cursor": "default", "whiteSpace": "nowrap", "flexShrink": "0" }}>
                            {"Attach ▾"}
                          </button>
                          <button onClick={V?.r?.onDismiss} title="Dismiss  E" style={{ "width": "28px", "height": "24px", "flexShrink": "0", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": "var(--w40)", "color": "var(--gd8d8de)", "fontSize": "11px", "cursor": "default" }}>
                            {"✕"}
                          </button>
                          <button onClick={V?.toggleFull} title="Focus reading  ↵" style={{ "flexShrink": "0", "width": "28px", "height": "24px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": "var(--w40)", "color": "var(--gd8d8de)", "fontSize": "12px", "cursor": "default" }}>
                            {V?.fullIcon}
                          </button>
                        </div>
                        <div style={{ "height": "2px", "background": "transparent", "flexShrink": "0" }}>
                          <div style={{ "height": "2px", "width": V?.progW, "background": "var(--o72-11-255)", "transition": "width .1s" }} />
                        </div>
                        <div style={{ "flex": "1", "minHeight": "0", "display": "flex" }}>
                          <div ref={V?.readerRef} onScroll={V?.onReaderScroll} onMouseUp={V?.onArticleUp} style={{ "flex": "1", "minWidth": "0", "overflow": "auto", "userSelect": "text" }}>
                            {' '}
                            <article style={{ "maxWidth": "660px", "margin": "0 auto", "padding": "34px 44px 80px" }}>
                              {' '}
                              <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.07em", "textTransform": "uppercase", "color": "var(--g868690)" }}>
                                {V?.r?.srcType}{" · "}{V?.r?.source}
                              </div>
                              {' '}
                              <h1 style={{ "fontFamily": V?.readerFamily, "fontSize": "29px", "lineHeight": "1.18", "fontWeight": "600", "letterSpacing": "-0.012em", "margin": "10px 0 10px", "color": "var(--gf2f2f5)", "textWrap": "pretty" }}>
                                {V?.r?.title}
                              </h1>
                              {' '}
                              <div style={{ "fontSize": "12px", "color": "var(--g8a8a94)", "display": "flex", "gap": "8px", "flexWrap": "wrap" }}>
                                <span>
                                  {V?.r?.time}
                                </span>
                                <span>
                                  {"·"}
                                </span>
                                <span>
                                  {V?.r?.mins}{" min read"}
                                </span>
                                <span>
                                  {"·"}
                                </span>
                                <span>
                                  {V?.r?.url}
                                </span>
                              </div>
                              {' '}
                              {V?.r?.partial ? (<div style={{ "marginTop": "10px", "fontSize": "11.5px", "color": "var(--o8-12-65)" }}>{V?.r?.accessLabel}</div>) : null}
                              {V?.r?.failed ? (
                                <div role="alert" style={{ "margin": "22px 0 0", "padding": "12px 14px", "borderRadius": "10px", "border": "1px dashed oklch(0.75 0.12 65 / 0.45)", "background": "oklch(0.75 0.12 65 / 0.08)", "fontSize": "13px", "display": "flex", "alignItems": "center", "gap": "10px" }}>
                                  <span style={{ "flex": "1" }}>{V?.r?.failedMsg}</span>
                                  <button onClick={V?.r?.onRetry} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w50)", "fontSize": "12px", "cursor": "default" }}>{"Retry"}</button>
                                </div>
                              ) : null}
                              {V?.r?.pending ? (<div style={{ "margin": "22px 0 0", "fontSize": "12.5px", "color": "var(--g8a8a94)", "animation": "pulse 1.6s infinite" }}>{V?.r?.pendingMsg}</div>) : null}
                              {V?.r?.summaryOn ? (
                              <div style={{ "margin": "22px 0 26px", "padding": "14px 16px", "borderRadius": "10px", "background": "var(--w35)", "border": "1px solid var(--w70)" }}>
                                {' '}
                                <div style={{ "fontSize": "11px", "fontWeight": "600", "color": "var(--g868690)", "letterSpacing": "0.04em", "textTransform": "uppercase" }}>
                                  {"Summary"}
                                </div>
                                {' '}
                                <div style={{ "fontSize": "13.5px", "lineHeight": "1.55", "color": "var(--gd6d6dc)", "marginTop": "6px" }}>
                                  {V?.r?.aiSummary}
                                </div>
                                {' '}
                              </div>
                              ) : (<div style={{ "height": "26px" }} />)}
                              {' '}
                              {((V?.r?.paras) || []).map((p: any, p_i8: number) => (
                                <React.Fragment key={p_i8}>
                                  {' '}
                                  <p data-pstart={p?.start} style={{ "fontFamily": V?.readerFamily, "fontSize": "17px", "lineHeight": "1.68", "color": "var(--gd9d9df)", "margin": "0 0 18px", "textWrap": "pretty" }}>
                                    {((p?.segs) || []).map((sg: any, sg_i9: number) => (
                                      <React.Fragment key={sg_i9}>
                                        <span style={{ "background": sg?.bg, "borderRadius": "3px", "boxShadow": sg?.sh }}>
                                          {sg?.t}
                                        </span>
                                      </React.Fragment>
                                    ))}
                                  </p>
                                  {' '}
                                </React.Fragment>
                              ))}
                              {' '}
                              {V?.r?.hasOrphaned ? (
                                <div style={{ "marginTop": "22px", "fontSize": "12.5px", "color": "var(--g9a9aa4)" }}>
                                  <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.04em", "textTransform": "uppercase" }}>{"Your highlights (no longer in source)"}</div>
                                  {(V?.r?.orphanedV || []).map((o: any, i: number) => (<div key={i} style={{ "marginTop": "6px", "fontFamily": V?.readerFamily }}>{"“"}{o?.text}{"”"}</div>))}
                                </div>
                              ) : null}
                              <div style={{ "marginTop": "30px", "paddingTop": "16px", "borderTop": "1px solid var(--w70)", "fontSize": "12px", "color": "var(--g7c7c86)" }}>
                                {"End of article · Select any passage to save it as evidence"}
                              </div>
                              {' '}
                            </article>
                            {' '}
                          </div>
                          {V?.inspOn ? (
                            <>
                              <div style={{ "width": "clamp(270px,23vw,330px)", "flexShrink": "0", "borderLeft": "1px solid var(--w60)", "background": "var(--w20)", "overflow": "auto", "padding": "16px 16px 40px", "display": "flex", "flexDirection": "column", "gap": "20px" }}>
                                <div>
                                  {' '}
                                  <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>
                                    {"Why this matters"}
                                  </div>
                                  {' '}
                                  <div style={{ "fontSize": "13px", "lineHeight": "1.52", "color": "var(--gdcdce2)", "marginTop": "7px", "textWrap": "pretty" }}>
                                    {V?.r?.why}
                                  </div>
                                  {' '}
                                  <div style={{ "marginTop": "10px", "padding": "9px 10px", "borderRadius": "8px", "background": "var(--w35)", "fontSize": "11.5px", "color": "var(--g9a9aa4)", "lineHeight": "1.45" }}>
                                    {' '}
                                    <div>
                                      {V?.r?.reason}
                                    </div>
                                    {' '}
                                    <div style={{ "display": "flex", "gap": "10px", "marginTop": "6px" }}>
                                      <span onClick={V?.r?.onMore} style={{ "color": "var(--gc8c8d0)", "cursor": "default" }} className="dch13">
                                        {"More like this"}
                                      </span>
                                      <span onClick={V?.r?.onLess} style={{ "color": "var(--gc8c8d0)", "cursor": "default" }} className="dch14">
                                        {"Less"}
                                      </span>
                                      <span onClick={V?.r?.onWhy} style={{ "color": "var(--o8-1-255)", "cursor": "default" }}>
                                        {"Why am I seeing this?"}
                                      </span>
                                    </div>
                                    {' '}
                                  </div>
                                  {' '}
                                </div>
                                {V?.r?.showSuggest ? (
                                  <>
                                    <div style={{ "padding": "11px 12px", "borderRadius": "9px", "border": "1px dashed var(--w180)", "background": "var(--w20)" }}>
                                      {' '}
                                      <div style={{ "fontSize": "11px", "color": "var(--g9a9aa4)" }}>
                                        {"Suggested connection"}
                                      </div>
                                      {' '}
                                      <div style={{ "fontSize": "13px", "color": "var(--gececf0)", "marginTop": "4px" }}>
                                        {V?.r?.sugPath}
                                      </div>
                                      {' '}
                                      <div style={{ "fontSize": "11.5px", "color": V?.r?.sugColor, "marginTop": "2px" }}>
                                        {"as "}{V?.r?.sugStance}{" evidence"}
                                      </div>
                                      {' '}
                                      <div style={{ "display": "flex", "gap": "6px", "marginTop": "9px" }}>
                                        <button onClick={V?.r?.sugConfirm} style={{ "height": "23px", "padding": "0 10px", "border": "none", "borderRadius": "5px", "background": "oklch(0.6 0.15 258)", "color": "#fff", "fontSize": "11.5px", "cursor": "default" }}>
                                          {"Confirm"}
                                        </button>
                                        <button onClick={V?.r?.sugChange} style={{ "height": "23px", "padding": "0 9px", "borderRadius": "5px", "border": "1px solid var(--w120)", "background": "transparent", "fontSize": "11.5px", "cursor": "default" }}>
                                          {"Change…"}
                                        </button>
                                        <button onClick={V?.r?.sugDismiss} style={{ "height": "23px", "padding": "0 9px", "borderRadius": "5px", "border": "none", "background": "transparent", "color": "var(--g9a9aa4)", "fontSize": "11.5px", "cursor": "default" }}>
                                          {"Not related"}
                                        </button>
                                      </div>
                                      {' '}
                                    </div>
                                  </>
                                ) : null}
                                <div>
                                  {' '}
                                  <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "6px" }}>
                                    {"Related theses"}
                                  </div>
                                  {' '}
                                  {((V?.r?.thesesV) || []).map((t: any, t_i10: number) => (
                                    <React.Fragment key={t_i10}>
                                      {' '}
                                      <div onClick={t?.onClick} onContextMenu={t?.onCtx} style={{ "display": "flex", "alignItems": "flex-start", "gap": "8px", "padding": "6px 6px", "margin": "0 -6px", "borderRadius": "6px", "cursor": "default", "border": t?.dashed ? "1px dashed var(--w120)" : "1px solid transparent" }} className="dch15">
                                        <span style={{ "color": t?.color, "fontSize": "10px", "marginTop": "3px" }}>
                                          {"◆"}
                                        </span>
                                        <div style={{ "flex": "1", "minWidth": "0" }}>
                                          <div style={{ "fontSize": "12.5px", "color": "var(--ge4e4e8)" }}>
                                            {t?.name}
                                          </div>
                                          <div style={{ "fontSize": "11px", "color": "var(--g80808a)" }}>
                                            {t?.sub}
                                          </div>
                                        </div>
                                        <span role="button" aria-label="Not related" title="Not related" onClick={t?.onNotRelated} style={{ "fontSize": "11px", "color": "var(--g80808a)", "padding": "0 2px" }} className="dch15">{"Not related"}</span>
                                      </div>
                                      {' '}
                                    </React.Fragment>
                                  ))}
                                  {' '}
                                </div>
                                <div>
                                  {' '}
                                  <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "6px" }}>
                                    {"Companies"}
                                  </div>
                                  {' '}
                                  {((V?.r?.cosV) || []).map((c: any, c_i11: number) => (
                                    <React.Fragment key={c_i11}>
                                      {' '}
                                      <div style={{ "display": "flex", "alignItems": "center", "gap": "8px", "padding": "5px 0" }}>
                                        <span onClick={c?.onClick} style={{ "width": "20px", "height": "20px", "borderRadius": "5px", "background": c?.tile, "color": "#15161a", "fontSize": "10px", "fontWeight": "700", "display": "grid", "placeItems": "center", "cursor": "default" }}>
                                          {c?.initial}
                                        </span>
                                        <div onClick={c?.onClick} style={{ "flex": "1", "minWidth": "0", "cursor": "default" }}>
                                          <div style={{ "fontSize": "12.5px", "color": "var(--ge4e4e8)" }}>
                                            {c?.name}
                                          </div>
                                          <div style={{ "fontSize": "11px", "color": "var(--g80808a)" }}>
                                            {c?.stage}
                                          </div>
                                        </div>
                                        <button onClick={c?.onFollow} style={{ "height": "21px", "padding": "0 8px", "borderRadius": "5px", "border": "1px solid var(--w100)", "background": c?.followBg, "color": c?.followColor, "fontSize": "11px", "cursor": "default" }}>
                                          {c?.followLabel}
                                        </button>
                                      </div>
                                      {' '}
                                    </React.Fragment>
                                  ))}
                                  {' '}
                                  {((V?.r?.firmsV) || []).map((c: any, c_i12: number) => (
                                    <React.Fragment key={c_i12}>
                                      {' '}
                                      <div onClick={c?.onClick} style={{ "display": "flex", "alignItems": "center", "gap": "8px", "padding": "5px 0", "cursor": "default" }}>
                                        <span style={{ "width": "20px", "height": "20px", "borderRadius": "50%", "background": c?.tile, "color": "#15161a", "fontSize": "10px", "fontWeight": "700", "display": "grid", "placeItems": "center" }}>
                                          {c?.initial}
                                        </span>
                                        <div style={{ "flex": "1" }}>
                                          <div style={{ "fontSize": "12.5px", "color": "var(--ge4e4e8)" }}>
                                            {c?.name}
                                          </div>
                                          <div style={{ "fontSize": "11px", "color": "var(--g80808a)" }}>
                                            {"Venture firm"}
                                          </div>
                                        </div>
                                        <button onClick={c?.onFollow} style={{ "height": "21px", "padding": "0 8px", "borderRadius": "5px", "border": "1px solid var(--w100)", "background": c?.followBg, "color": c?.followColor, "fontSize": "11px", "cursor": "default" }}>
                                          {c?.followLabel}
                                        </button>
                                      </div>
                                      {' '}
                                    </React.Fragment>
                                  ))}
                                  {((V?.r?.peopleV) || []).map((c: any, c_i12p: number) => (
                                    <React.Fragment key={'p' + c_i12p}>
                                      <div style={{ "display": "flex", "alignItems": "center", "gap": "8px", "padding": "5px 0" }}>
                                        <span onClick={c?.onClick} style={{ "width": "20px", "height": "20px", "borderRadius": "50%", "background": c?.tile, "color": "#15161a", "fontSize": "10px", "fontWeight": "700", "display": "grid", "placeItems": "center", "cursor": "default" }}>
                                          {c?.initial}
                                        </span>
                                        <div onClick={c?.onClick} style={{ "flex": "1", "minWidth": "0", "cursor": "default" }}>
                                          <div style={{ "fontSize": "12.5px", "color": "var(--ge4e4e8)" }}>{c?.name}</div>
                                          <div style={{ "fontSize": "11px", "color": "var(--g80808a)" }}>{c?.sub}</div>
                                        </div>
                                        <button onClick={c?.onFollow} style={{ "height": "21px", "padding": "0 8px", "borderRadius": "5px", "border": "1px solid var(--w100)", "background": c?.followBg, "color": c?.followColor, "fontSize": "11px", "cursor": "default" }}>
                                          {c?.followLabel}
                                        </button>
                                      </div>
                                    </React.Fragment>
                                  ))}
                                  {' '}
                                </div>
                                <div>
                                  {' '}
                                  <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "6px" }}>
                                    {"Evidence extracted · "}{V?.r?.extractCount}
                                  </div>
                                  {' '}
                                  {((V?.r?.extractsV) || []).map((x: any, x_i13: number) => (
                                    <React.Fragment key={x_i13}>
                                      {' '}
                                      <div style={{ "padding": "9px 10px", "marginBottom": "6px", "borderRadius": "8px", "background": x?.bg, "border": `1px solid ${x?.border ?? ""}` }}>
                                        {' '}
                                        <div style={{ "fontFamily": V?.readerFamily, "fontSize": "13px", "lineHeight": "1.45", "color": "var(--gdcdce2)" }}>
                                          {"“"}{x?.text}{"”"}
                                        </div>
                                        {' '}
                                        <div style={{ "display": "flex", "alignItems": "center", "gap": "6px", "marginTop": "6px", "fontSize": "11px", "color": "var(--g868690)" }}>
                                          <span style={{ "flex": "1" }}>
                                            {x?.where}
                                          </span>
                                          <span onClick={x?.onKeep} style={{ "color": x?.keepColor, "cursor": "default" }}>
                                            {x?.keepLabel}
                                          </span>
                                        </div>
                                        {' '}
                                      </div>
                                      {' '}
                                    </React.Fragment>
                                  ))}
                                  {' '}
                                </div>
                                <div>
                                  {' '}
                                  <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "6px" }}>
                                    {"Your notes"}
                                  </div>
                                  {' '}
                                  {((V?.r?.notesV) || []).map((n: any, n_i14: number) => (
                                    <React.Fragment key={n_i14}>
                                      {' '}
                                      <div style={{ "padding": "8px 10px", "marginBottom": "6px", "borderRadius": "8px", "background": "rgba(255,214,120,0.06)", "border": "1px solid rgba(255,214,120,0.12)" }}>
                                        {' '}
                                        <div style={{ "fontSize": "12.5px", "lineHeight": "1.45", "color": "var(--ge8e6de)" }}>
                                          {n?.text}
                                        </div>
                                        {' '}
                                        <div style={{ "fontSize": "11px", "color": "var(--g8e8a80)", "marginTop": "4px" }}>
                                          {n?.type}{" · "}{n?.where}
                                        </div>
                                        {' '}
                                      </div>
                                      {' '}
                                    </React.Fragment>
                                  ))}
                                  {' '}
                                  <textarea ref={V?.noteRef} value={V?.noteDraft} onChange={V?.onNote} placeholder="Type a thought while reading…" rows={3} style={{ "width": "100%", "resize": "none", "borderRadius": "8px", "border": "1px solid var(--w90)", "background": "var(--k180)", "padding": "9px 10px", "fontSize": "12.5px", "lineHeight": "1.45", "outline": "none", "userSelect": "text" }} />
                                  {' '}
                                  {V?.noteHas ? (
                                    <>
                                      {' '}
                                      <div style={{ "marginTop": "8px", "padding": "10px 11px", "borderRadius": "9px", "background": "var(--w40)", "border": "1px solid var(--w80)", "animation": "fade .2s ease" }}>
                                        {' '}
                                        <div style={{ "display": "grid", "gridTemplateColumns": "auto 1fr", "gap": "5px 10px", "fontSize": "12px", "alignItems": "center" }}>
                                          <span style={{ "color": "var(--g868690)" }}>
                                            {"Attach to"}
                                          </span>
                                          <span onClick={V?.noteChange} style={{ "color": "var(--gececf0)", "cursor": "default", "borderBottom": "1px dotted var(--w300)", "justifySelf": "start" }}>
                                            {V?.notePath}{" ▾"}
                                          </span>
                                          <span style={{ "color": "var(--g868690)" }}>
                                            {"Save as"}
                                          </span>
                                          <span onClick={V?.noteTypeCycle} style={{ "color": "var(--gececf0)", "cursor": "default", "borderBottom": "1px dotted var(--w300)", "justifySelf": "start" }}>
                                            {V?.noteType}
                                          </span>
                                        </div>
                                        {' '}
                                        <div style={{ "display": "flex", "gap": "6px", "marginTop": "10px" }}>
                                          <button onClick={V?.noteAccept} style={{ "height": "23px", "padding": "0 10px", "border": "none", "borderRadius": "5px", "background": "oklch(0.6 0.15 258)", "color": "#fff", "fontSize": "11.5px", "cursor": "default" }}>
                                            {"Accept"}
                                          </button>
                                          <button onClick={V?.noteDismiss} style={{ "height": "23px", "padding": "0 9px", "border": "none", "borderRadius": "5px", "background": "transparent", "color": "var(--g9a9aa4)", "fontSize": "11.5px", "cursor": "default" }}>
                                            {"Dismiss"}
                                          </button>
                                        </div>
                                        {' '}
                                      </div>
                                      {' '}
                                    </>
                                  ) : null}
                                  {' '}
                                </div>
                              </div>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : null}
                  {V?.noSel ? (
                    <>
                      <div style={{ "flex": "1", "display": "grid", "placeItems": "center", "color": "var(--g8a8a94)", "textAlign": "center" }}>
                        <div>
                          <div style={{ "fontSize": "14px", "color": "var(--gc8c8d0)" }}>
                            {"Nothing selected"}
                          </div>
                          <div style={{ "fontSize": "12.5px", "marginTop": "6px" }}>
                            {"Pick an item, or press J to start from the top."}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
            {V?.isThesis ? (
              <>
                <div style={{ "flex": "1", "overflow": "auto" }}>
                  {' '}
                  <div style={{ "maxWidth": "900px", "margin": "0 auto", "padding": "26px 44px 90px" }}>
                    {' '}
                    <div style={{ "display": "flex", "alignItems": "center", "gap": "6px", "fontSize": "12px", "color": "var(--g8a8a94)", "flexWrap": "wrap" }}>
                      {((V?.crumbs) || []).map((c: any, c_i15: number) => (
                        <React.Fragment key={c_i15}>
                          <span onClick={c?.onClick} style={{ "cursor": "default" }} className="dch16">
                            {c?.name}
                          </span>
                          <span style={{ "color": "var(--g5c5c66)" }}>
                            {"/"}
                          </span>
                        </React.Fragment>
                      ))}
                      <span style={{ "color": "var(--gc8c8d0)" }}>
                        {V?.th?.name}
                      </span>
                    </div>
                    {' '}
                    <input ref={V?.titleRef} aria-label="Thesis title" value={V?.th?.name} onChange={V?.onThName} style={{ "display": "block", "width": "100%", "marginTop": "10px", "background": "transparent", "border": "none", "outline": "none", "fontSize": "30px", "fontWeight": "680", "letterSpacing": "-0.02em", "color": "var(--gf4f4f6)", "padding": "0", "userSelect": "text" }} />
                    {' '}
                    <textarea aria-label="Thesis description" value={V?.th?.desc} onChange={V?.onThDesc} rows={2} placeholder="One or two sentences on what you believe…" style={{ "display": "block", "width": "100%", "marginTop": "6px", "background": "transparent", "border": "none", "outline": "none", "resize": "none", "fontSize": "15px", "lineHeight": "1.5", "color": "var(--gb4b4bd)", "padding": "0", "userSelect": "text" }} />
                    {V?.thNeedsDesc ? <div data-testid="thesis-desc-nudge" role="status" style={{ "fontSize": "12px", "color": "var(--o76-12-155)", "marginTop": "4px" }}>{"Add a sentence describing this thesis — matching against your library uses it."}</div> : null}
                    {V?.thMatch ? <div data-testid="thesis-match" role="status" style={{ "fontSize": "12px", "color": "var(--g8a8a94)", "marginTop": "6px" }}>{V?.thMatch}</div> : null}

                    {(V?.thSourceSugs || []).length ? (
                      <div data-testid="thesis-source-suggestions" style={{ "marginTop": "10px", "padding": "9px 11px", "borderRadius": "9px", "border": "1px dashed var(--w160)", "background": "var(--w25)", "fontSize": "12.5px", "display": "grid", "gap": "6px" }}>
                        <span style={{ "color": "var(--g8a8a94)" }}>{"No source covers this thesis yet. Suggested:"}</span>
                        {(V?.thSourceSugs || []).map((x: any, i: number) => (
                          <div key={i} style={{ "display": "flex", "alignItems": "center", "gap": "10px" }}>
                            <span style={{ "flex": "1", "minWidth": "0" }}>{x.label}</span>
                            <button onClick={x.onAdd} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w50)", "fontSize": "12px", "cursor": "default" }}>{"Add…"}</button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {' '}
                    <div style={{ "display": "flex", "alignItems": "center", "gap": "14px", "marginTop": "14px", "flexWrap": "wrap", "fontSize": "12px", "color": "var(--g8a8a94)" }}>
                      <div style={{ "display": "flex", "alignItems": "center", "gap": "8px" }}>
                        <div style={{ "display": "flex", "gap": "3px" }}>
                          {((V?.convDots) || []).map((d: any, d_i16: number) => (
                            <React.Fragment key={d_i16}>
                              <span onClick={d?.onClick} title="Set conviction" role="button" aria-label={"Set conviction " + (d_i16 + 1)} style={{ "width": "14px", "height": "6px", "borderRadius": "2px", "background": d?.bg, "cursor": "default" }} />
                            </React.Fragment>
                          ))}
                        </div>
                        <span style={{ "color": "var(--gd0d0d6)" }}>
                          {V?.convLabel}
                        </span>
                      </div>
                      <span>
                        {"Updated "}{V?.th?.updated}
                      </span>
                      <span>
                        {"Created "}{V?.th?.created}
                      </span>
                      <span>
                        {V?.thEvCount}{" pieces of evidence"}
                      </span>
                      <span style={{ "flex": "1" }} />
                      <button onClick={V?.thInbox} style={{ "height": "24px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": "var(--w40)", "color": "var(--gd8d8de)", "fontSize": "12px", "cursor": "default" }}>
                        {"View in inbox"}
                      </button>
                      <button onClick={V?.thFollow} style={{ "height": "24px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": V?.thFollowBg, "color": "var(--gd8d8de)", "fontSize": "12px", "cursor": "default" }}>
                        {V?.thFollowLabel}
                      </button>
                      <button onClick={V?.thExport} style={{ "height": "24px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": "var(--w40)", "color": "var(--gd8d8de)", "fontSize": "12px", "cursor": "default" }}>
                        {"Export ▾"}
                      </button>
                      <button onClick={V?.thPin} style={{ "height": "24px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": V?.thPinBg, "color": "var(--gd8d8de)", "fontSize": "12px", "cursor": "default" }}>
                        {V?.thPinLabel}
                      </button>
                      <button onClick={V?.thCustomize} style={{ "height": "24px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": "var(--w40)", "color": "var(--gd8d8de)", "fontSize": "12px", "cursor": "default" }}>{"Customize"}</button>
                      <button onClick={V?.thNotify} style={{ "height": "24px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w90)", "background": "var(--w40)", "color": "var(--gd8d8de)", "fontSize": "12px", "cursor": "default" }}>{"Notify me…"}</button>
                    </div>
                    {' '}
                    <div style={{ "display": "flex", "gap": "18px", "marginTop": "22px", "borderBottom": "1px solid var(--w70)" }}>
                      {((V?.thTabs) || []).map((t: any, t_i17: number) => (
                        <React.Fragment key={t_i17}>
                          <div onClick={t?.onClick} style={{ "padding": "0 0 9px", "fontSize": "13px", "color": t?.color, "borderBottom": `2px solid ${t?.line ?? ""}`, "marginBottom": "-1px", "cursor": "default" }}>
                            {t?.label}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                    {' '}
                    {V?.thOverview ? (
                      <>
                        {' '}
                        <div style={{ "display": "grid", "gridTemplateColumns": "minmax(0,1fr) 250px", "gap": "36px", "marginTop": "24px" }}>
                          <div style={{ "display": "flex", "flexDirection": "column", "minWidth": "0" }}>
                            {((V?.thCustoms) || []).map((cc: any, ci: number) => (
                              <div key={'tc' + ci} data-section="custom" style={{ "order": cc?.order, "marginBottom": "24px", "padding": "12px 14px", "borderRadius": "10px", "border": "1px solid var(--w70)", "background": "var(--w25)" }}>
                                <div style={{ "display": "flex", "alignItems": "baseline", "gap": "8px", "marginBottom": "8px" }}>
                                  <span style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>{cc?.title}</span>
                                  <span style={{ "flex": "1", "fontSize": "11px", "color": "var(--g74747e)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>{"Your layout · “"}{cc?.instr}{"”"}</span>
                                  <span onClick={cc?.onEdit} style={{ "fontSize": "11.5px", "color": "var(--o78-11-255)", "cursor": "default" }}>{"Edit"}</span>
                                </div>
                                {((cc?.rows) || []).map((r: any, ri: number) => (
                                  <div key={ri} role={r?.onClick ? "button" : undefined} title={r?.title} onClick={r?.onClick} style={{ "display": "grid", "gridTemplateColumns": "110px minmax(0,1fr)", "gap": "12px", "padding": "6px 0", "borderTop": "1px solid var(--w45)", "fontSize": "12.5px" }}>
                                    <span style={{ "color": "var(--g8a8a94)" }}>{r?.label}</span>
                                    <span style={{ "color": "var(--gdcdce2)", "lineHeight": "1.4" }}>{r?.value}</span>
                                  </div>
                                ))}
                                {cc?.empty ? (<div style={{ "fontSize": "12.5px", "color": "var(--g8a8a94)", "padding": "6px 0", "borderTop": "1px solid var(--w45)" }}>{cc?.emptyText}</div>) : null}
                              </div>
                            ))}
                            <div data-section="current_view" style={{ "order": V?.thL?.oView, "display": V?.thL?.showView ? "block" : "none" }}>
                            <div style={{ "display": "flex", "alignItems": "baseline", "justifyContent": "space-between" }}>
                              <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>
                                {"Current view"}
                              </div>
                              <div style={{ "fontSize": "11px", "color": "var(--g6f6f79)" }}>
                                {"Click to edit · revisions are kept in Evolution"}
                              </div>
                            </div>
                            {' '}
                            <div contentEditable="true" role="textbox" aria-label="Current view" suppressContentEditableWarning={true} onBlur={V?.onThView} style={{ "marginTop": "9px", "fontFamily": V?.readerFamily, "fontSize": "16px", "lineHeight": "1.66", "color": "var(--gdedee4)", "whiteSpace": "pre-wrap", "outline": "none", "padding": "12px 14px", "marginLeft": "-14px", "marginRight": "-14px", "borderRadius": "9px", "userSelect": "text", "textWrap": "pretty" }} className="dch17 dch18">
                              {V?.th?.view}
                            </div>
                            {' '}
                            {V?.thNoView ? (
                              <>
                                <div style={{ "fontSize": "13px", "color": "var(--g7c7c86)", "marginTop": "-4px" }}>
                                  {"No narrative yet. Click above and write what you currently believe."}
                                </div>
                              </>
                            ) : null}
                            </div>
                            {' '}
                            <div data-section="evidence_columns" style={{ "display": V?.thL?.showCols ? "grid" : "none", "order": V?.thL?.oCols, "gridTemplateColumns": "minmax(0,1fr) minmax(0,1fr)", "gap": "18px", "marginTop": "30px" }}>
                              <div data-column="supporting" style={{ "order": V?.thL?.contraFirst ? 1 : 0 }}>
                                {' '}
                                <div style={{ "display": "flex", "alignItems": "center", "gap": "6px", "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--o78-12-155)" }}>
                                  <span>
                                    {"Supporting"}
                                  </span>
                                  <span style={{ "color": "var(--g6f6f79)" }}>
                                    {V?.supCount}
                                  </span>
                                </div>
                                {' '}
                                <div style={{ "display": "flex", "flexDirection": "column", "gap": "6px", "marginTop": "8px" }}>
                                  {((V?.supV) || []).map((e: any, e_i18: number) => (
                                    <React.Fragment key={e_i18}>
                                      <div onClick={e?.onToggle} onContextMenu={e?.onCtx} style={{ "padding": "10px 11px", "borderRadius": "8px", "background": "var(--w30)", "border": "1px solid var(--w60)", "borderLeft": "2px solid oklch(0.72 0.12 155 / 0.7)", "cursor": "default" }} className="dch19">
                                        {' '}
                                        <div style={{ "fontSize": "12.5px", "lineHeight": "1.48", "color": "var(--gdcdce2)", "display": "-webkit-box", "WebkitLineClamp": e?.clamp, "WebkitBoxOrient": "vertical", "overflow": "hidden" }}>
                                          {e?.text}
                                        </div>
                                        {' '}
                                        <div style={{ "display": "flex", "gap": "6px", "alignItems": "center", "marginTop": "6px", "fontSize": "11px", "color": "var(--g80808a)" }}>
                                          <span style={{ "width": "10px", "height": "10px", "borderRadius": "3px", "background": e?.tile }} />
                                          {e?.src}{" · "}{e?.date}
                                        </div>
                                        {' '}
                                        {e?.showNote ? (
                                          <>
                                            <div style={{ "fontSize": "12px", "color": "#e0dccf", "marginTop": "7px", "paddingTop": "7px", "borderTop": "1px solid var(--w60)" }}>
                                              {"✎ "}{e?.note}
                                            </div>
                                          </>
                                        ) : null}
                                        {' '}
                                      </div>
                                    </React.Fragment>
                                  ))}
                                  <div onClick={V?.addEvidence} style={{ "fontSize": "12px", "color": "var(--g8a8a94)", "padding": "6px 2px", "cursor": "default" }} className="dch20">
                                    {"+ Add evidence"}
                                  </div>
                                </div>
                                {' '}
                              </div>
                              <div data-column="contradicting" style={{ "order": V?.thL?.contraFirst ? 0 : 1 }}>
                                {' '}
                                <div style={{ "display": "flex", "alignItems": "center", "gap": "6px", "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--o8-12-65)" }}>
                                  <span>
                                    {"Contradicting"}
                                  </span>
                                  <span style={{ "color": "var(--g6f6f79)" }}>
                                    {V?.conCount}
                                  </span>
                                </div>
                                {' '}
                                <div style={{ "display": "flex", "flexDirection": "column", "gap": "6px", "marginTop": "8px" }}>
                                  {((V?.conV) || []).map((e: any, e_i19: number) => (
                                    <React.Fragment key={e_i19}>
                                      <div onClick={e?.onToggle} onContextMenu={e?.onCtx} style={{ "padding": "10px 11px", "borderRadius": "8px", "background": "var(--w30)", "border": "1px solid var(--w60)", "borderLeft": "2px solid oklch(0.75 0.12 65 / 0.7)", "cursor": "default" }} className="dch21">
                                        {' '}
                                        <div style={{ "fontSize": "12.5px", "lineHeight": "1.48", "color": "var(--gdcdce2)", "display": "-webkit-box", "WebkitLineClamp": e?.clamp, "WebkitBoxOrient": "vertical", "overflow": "hidden" }}>
                                          {e?.text}
                                        </div>
                                        {' '}
                                        <div style={{ "display": "flex", "gap": "6px", "alignItems": "center", "marginTop": "6px", "fontSize": "11px", "color": "var(--g80808a)" }}>
                                          <span style={{ "width": "10px", "height": "10px", "borderRadius": "3px", "background": e?.tile }} />
                                          {e?.src}{" · "}{e?.date}
                                        </div>
                                        {' '}
                                        {e?.showNote ? (
                                          <>
                                            <div style={{ "fontSize": "12px", "color": "#e0dccf", "marginTop": "7px", "paddingTop": "7px", "borderTop": "1px solid var(--w60)" }}>
                                              {"✎ "}{e?.note}
                                            </div>
                                          </>
                                        ) : null}
                                        {' '}
                                      </div>
                                    </React.Fragment>
                                  ))}
                                  {V?.thNoCon ? (
                                    <>
                                      <div style={{ "fontSize": "12px", "color": "var(--g7c7c86)", "lineHeight": "1.45", "padding": "10px 11px", "borderRadius": "8px", "border": "1px dashed var(--w100)" }}>
                                        {"Nothing contradicts this yet. Worth looking for."}
                                      </div>
                                    </>
                                  ) : null}
                                </div>
                                {' '}
                              </div>
                            </div>
                            {' '}
                            <div data-section="thoughts" style={{ "marginTop": "32px", "order": V?.thL?.oThoughts, "display": V?.thL?.showThoughts ? "block" : "none" }}>
                              {' '}
                              <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>
                                {"Your thoughts"}
                              </div>
                              {' '}
                              <div style={{ "display": "flex", "flexDirection": "column", "gap": "6px", "marginTop": "9px" }}>
                                {((V?.thoughtsV) || []).map((t: any, t_i20: number) => (
                                  <React.Fragment key={t_i20}>
                                    <div style={{ "padding": "10px 12px", "borderRadius": "8px", "background": "rgba(255,214,120,0.05)", "border": "1px solid rgba(255,214,120,0.1)" }}>
                                      {' '}
                                      <div style={{ "fontSize": "13px", "lineHeight": "1.5", "color": "var(--ge8e6de)" }}>
                                        {t?.text}
                                      </div>
                                      {' '}
                                      <div style={{ "fontSize": "11px", "color": "var(--g8e8a80)", "marginTop": "4px" }}>
                                        {t?.type}{" · "}{t?.date}{t?.notOrganized ? (<span style={{ "marginLeft": "6px", "color": "var(--o8-12-65)" }}>{"· Not organized yet "}<span role="button" onClick={t?.onRetry} style={{ "color": "var(--o8-1-255)" }}>{"Retry"}</span></span>) : null}
                                      </div>
                                      {' '}
                                    </div>
                                  </React.Fragment>
                                ))}
                                <input value={V?.thDraft} onChange={V?.onThDraft} onKeyDown={V?.onThDraftKey} placeholder="+ Add thought…  (↵ to save)" style={{ "height": "34px", "borderRadius": "8px", "border": "1px solid var(--w80)", "background": "var(--k150)", "padding": "0 12px", "fontSize": "13px", "outline": "none", "userSelect": "text" }} />
                              </div>
                              {' '}
                            </div>
                            {' '}
                            <div data-section="thesis_children" style={{ "marginTop": "30px", "order": V?.thL?.oChildren, "display": V?.thL?.showChildren ? "block" : "none" }}>
                              {' '}
                              <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>
                                {"Child theses"}
                              </div>
                              {' '}
                              <div style={{ "marginTop": "8px", "borderRadius": "9px", "border": "1px solid var(--w70)", "overflow": "hidden" }}>
                                {' '}
                                {((V?.childrenV) || []).map((c: any, c_i21: number) => (
                                  <React.Fragment key={c_i21}>
                                    {' '}
                                    <div onClick={c?.onClick} style={{ "display": "flex", "alignItems": "center", "gap": "10px", "padding": "10px 12px", "borderBottom": "1px solid var(--w50)", "cursor": "default" }} className="dch22">
                                      <span style={{ "color": c?.color, "fontSize": "10px" }}>
                                        {"◆"}
                                      </span>
                                      <div style={{ "flex": "1", "minWidth": "0" }}>
                                        <div style={{ "fontSize": "13px", "color": "var(--ge8e8ec)" }}>
                                          {c?.name}
                                        </div>
                                        <div style={{ "fontSize": "11.5px", "color": "var(--g80808a)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                          {c?.desc}
                                        </div>
                                      </div>
                                      <span style={{ "fontSize": "11px", "color": "var(--g80808a)", "whiteSpace": "nowrap" }}>
                                        {c?.count}{" evidence"}
                                      </span>
                                      <span style={{ "color": "var(--g5c5c66)" }}>
                                        {"›"}
                                      </span>
                                    </div>
                                    {' '}
                                  </React.Fragment>
                                ))}
                                {' '}
                                <div style={{ "display": "flex", "alignItems": "center", "gap": "8px", "padding": "6px 12px" }}>
                                  <span style={{ "color": "var(--g6f6f79)" }}>
                                    {"+"}
                                  </span>
                                  <input value={V?.childDraft} onChange={V?.onChildDraft} onKeyDown={V?.onChildKey} placeholder="Create child thesis…" style={{ "flex": "1", "height": "28px", "border": "none", "background": "transparent", "outline": "none", "fontSize": "13px", "userSelect": "text" }} />
                                </div>
                                {' '}
                              </div>
                              {' '}
                            </div>
                            {' '}
                          </div>
                          <div style={{ "display": "flex", "flexDirection": "column", "gap": "24px" }}>
                            <FromYou d={V?.thFromYou} r={V?.thRe} />
                            <div>
                              {' '}
                              <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>
                                {"Recent changes"}
                              </div>
                              {' '}
                              <div style={{ "marginTop": "10px", "display": "flex", "flexDirection": "column" }}>
                                {((V?.changesV) || []).map((c: any, c_i22: number) => (
                                  <React.Fragment key={c_i22}>
                                    <div style={{ "display": "flex", "gap": "10px", "paddingBottom": "12px" }}>
                                      <div style={{ "display": "flex", "flexDirection": "column", "alignItems": "center" }}>
                                        <span style={{ "width": "7px", "height": "7px", "borderRadius": "50%", "background": c?.color, "marginTop": "4px" }} />
                                        <span style={{ "flex": "1", "width": "1px", "background": "var(--w80)", "marginTop": "4px" }} />
                                      </div>
                                      <div style={{ "flex": "1" }}>
                                        <div style={{ "fontSize": "11px", "color": "var(--g80808a)" }}>
                                          {c?.date}{" · "}{c?.label}
                                        </div>
                                        <div style={{ "fontSize": "12.5px", "lineHeight": "1.42", "color": "var(--gdcdce2)", "marginTop": "2px" }}>
                                          {c?.text}
                                        </div>
                                      </div>
                                    </div>
                                  </React.Fragment>
                                ))}
                                {V?.thNoChanges ? (
                                  <>
                                    <div style={{ "fontSize": "12px", "color": "var(--g7c7c86)" }}>
                                      {"No changes this month."}
                                    </div>
                                  </>
                                ) : null}
                              </div>
                              {' '}
                            </div>
                            <div>
                              {' '}
                              <div style={{ "display": "flex", "justifyContent": "space-between", "alignItems": "center" }}>
                                <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>
                                  {"Companies to watch"}
                                </div>
                                <span onClick={V?.addCompany} style={{ "fontSize": "14px", "color": "var(--g80808a)", "cursor": "default" }}>
                                  {"+"}
                                </span>
                              </div>
                              {' '}
                              <div style={{ "marginTop": "8px", "display": "flex", "flexDirection": "column", "gap": "2px" }}>
                                {((V?.thCos) || []).map((c: any, c_i23: number) => (
                                  <React.Fragment key={c_i23}>
                                    <div onClick={c?.onClick} style={{ "display": "flex", "alignItems": "center", "gap": "9px", "padding": "6px 6px", "margin": "0 -6px", "borderRadius": "6px", "cursor": "default" }} className="dch23">
                                      <span style={{ "width": "22px", "height": "22px", "borderRadius": "6px", "background": c?.tile, "color": "#15161a", "fontSize": "10.5px", "fontWeight": "700", "display": "grid", "placeItems": "center", "flexShrink": "0" }}>
                                        {c?.initial}
                                      </span>
                                      <div style={{ "flex": "1", "minWidth": "0" }}>
                                        <div style={{ "fontSize": "12.5px", "color": "var(--ge8e8ec)" }}>
                                          {c?.name}{" "}
                                          <span style={{ "color": "var(--g80808a)", "fontSize": "11px" }}>
                                            {c?.stage}
                                          </span>
                                        </div>
                                        <div style={{ "fontSize": "11px", "color": "var(--g80808a)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                          {c?.last}
                                        </div>
                                      </div>
                                    </div>
                                  </React.Fragment>
                                ))}
                              </div>
                              {' '}
                            </div>
                            <div>
                              {' '}
                              <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>
                                {"Related firms"}
                              </div>
                              {' '}
                              <div style={{ "marginTop": "8px", "display": "flex", "flexWrap": "wrap", "gap": "5px" }}>
                                {((V?.thFirms) || []).map((f: any, f_i24: number) => (
                                  <React.Fragment key={f_i24}>
                                    <span onClick={f?.onClick} style={{ "display": "inline-flex", "alignItems": "center", "gap": "6px", "height": "24px", "padding": "0 9px 0 5px", "borderRadius": "12px", "background": "var(--w50)", "fontSize": "12px", "color": "var(--gd0d0d6)", "cursor": "default" }} className="dch24">
                                      <span style={{ "width": "14px", "height": "14px", "borderRadius": "50%", "background": f?.tile }} />
                                      {f?.name}
                                    </span>
                                  </React.Fragment>
                                ))}
                              </div>
                              {' '}
                            </div>
                            <div>
                              {' '}
                              <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>
                                {"Open questions"}
                              </div>
                              {' '}
                              <div style={{ "marginTop": "8px", "display": "flex", "flexDirection": "column", "gap": "7px" }}>
                                {((V?.thQs) || []).map((q: any, q_i25: number) => (
                                  <React.Fragment key={q_i25}>
                                    <div style={{ "display": "flex", "gap": "8px", "fontSize": "12.5px", "lineHeight": "1.45", "color": "var(--gd6d6dc)" }}>
                                      <span style={{ "color": "var(--g80808a)" }}>
                                        {"?"}
                                      </span>
                                      <span>
                                        {q?.text}
                                      </span>
                                    </div>
                                  </React.Fragment>
                                ))}
                                <input value={V?.qDraft} onChange={V?.onQDraft} onKeyDown={V?.onQKey} placeholder="+ Add question" style={{ "height": "26px", "border": "none", "borderBottom": "1px solid var(--w80)", "background": "transparent", "outline": "none", "fontSize": "12.5px", "userSelect": "text" }} />
                              </div>
                              {' '}
                            </div>
                          </div>
                        </div>
                        {' '}
                      </>
                    ) : null}
                    {' '}
                    {V?.thEvolution ? (
                      <>
                        {' '}
                        <div style={{ "marginTop": "24px" }}>
                          {' '}
                          <div style={{ "display": "flex", "gap": "2px", "padding": "14px", "borderRadius": "10px", "background": "var(--w30)", "border": "1px solid var(--w60)" }}>
                            {((V?.evoV) || []).map((m: any, m_i26: number) => (
                              <React.Fragment key={m_i26}>
                                <div style={{ "flex": "1", "minWidth": "0" }}>
                                  {' '}
                                  <div style={{ "fontSize": "11px", "color": "var(--g80808a)" }}>
                                    {m?.short}
                                  </div>
                                  {' '}
                                  <div style={{ "display": "flex", "gap": "2px", "marginTop": "6px" }}>
                                    {((m?.dots) || []).map((d: any, d_i27: number) => (
                                      <React.Fragment key={d_i27}>
                                        <span style={{ "flex": "1", "maxWidth": "14px", "height": "5px", "borderRadius": "2px", "background": d?.bg }} />
                                      </React.Fragment>
                                    ))}
                                  </div>
                                  {' '}
                                  <div style={{ "fontSize": "11px", "color": "var(--gb8b8c0)", "marginTop": "6px" }}>
                                    {m?.evCount}{" events"}
                                  </div>
                                  {' '}
                                </div>
                              </React.Fragment>
                            ))}
                          </div>
                          {' '}
                          <div style={{ "marginTop": "26px" }}>
                            {' '}
                            {((V?.evoV) || []).map((m: any, m_i28: number) => (
                              <React.Fragment key={m_i28}>
                                {' '}
                                <div style={{ "display": "grid", "gridTemplateColumns": "130px minmax(0,1fr)", "gap": "20px", "paddingBottom": "22px" }}>
                                  <div style={{ "fontSize": "13px", "fontWeight": "600", "color": "var(--ge8e8ec)", "paddingTop": "1px" }}>
                                    {m?.month}
                                    <div style={{ "fontSize": "11px", "fontWeight": "400", "color": "var(--g80808a)", "marginTop": "3px" }}>
                                      {"Conviction "}{m?.conv}{"/5"}
                                    </div>
                                  </div>
                                  <div style={{ "borderLeft": "1px solid var(--w80)", "paddingLeft": "18px", "display": "flex", "flexDirection": "column", "gap": "14px" }}>
                                    {((m?.events) || []).map((e: any, e_i29: number) => (
                                      <React.Fragment key={e_i29}>
                                        <div style={{ "position": "relative" }}>
                                          {' '}
                                          <span style={{ "position": "absolute", "left": "-22px", "top": "4px", "width": "7px", "height": "7px", "borderRadius": "50%", "background": e?.color, "boxShadow": "0 0 0 3px var(--main)" }} />
                                          {' '}
                                          <div style={{ "fontSize": "11px", "color": "var(--g80808a)" }}>
                                            {e?.date}{" · "}
                                            <span style={{ "color": e?.color }}>
                                              {e?.kind}
                                            </span>
                                          </div>
                                          {' '}
                                          <div style={{ "fontSize": "13px", "lineHeight": "1.5", "color": "var(--gdcdce2)", "marginTop": "2px" }}>
                                            {e?.text}
                                          </div>
                                          {' '}
                                          {e?.isRev ? (
                                            <>
                                              {' '}
                                              <div style={{ "marginTop": "8px", "padding": "10px 12px", "borderRadius": "8px", "background": "var(--w30)", "border": "1px solid var(--w60)", "fontFamily": V?.readerFamily, "fontSize": "14px", "lineHeight": "1.5" }}>
                                                {' '}
                                                <div style={{ "color": "var(--g7c7c86)", "textDecoration": "line-through" }}>
                                                  {e?.before}
                                                </div>
                                                {' '}
                                                <div style={{ "color": "var(--gf0f0f3)", "marginTop": "4px" }}>
                                                  {e?.after}
                                                </div>
                                                {' '}
                                              </div>
                                              {' '}
                                            </>
                                          ) : null}
                                          {' '}
                                        </div>
                                      </React.Fragment>
                                    ))}
                                  </div>
                                </div>
                                {' '}
                              </React.Fragment>
                            ))}
                            {' '}
                            {V?.thNoEvo ? (
                              <>
                                <div style={{ "fontSize": "13px", "color": "var(--g7c7c86)" }}>
                                  {"This thesis is new. Its history will build up here as you add evidence, revise your view and change conviction."}
                                </div>
                              </>
                            ) : null}
                            {' '}
                          </div>
                          {' '}
                        </div>
                        {' '}
                      </>
                    ) : null}
                    {' '}
                  </div>
                  {' '}
                </div>
              </>
            ) : null}
            {V?.isTheses ? (
              <>
                <div style={{ "flex": "1", "overflow": "auto" }}>
                  {' '}
                  <div style={{ "maxWidth": "960px", "margin": "0 auto", "padding": "26px 36px 80px" }}>
                    {' '}
                    <div style={{ "display": "flex", "alignItems": "flex-end", "gap": "12px" }}>
                      <div style={{ "flex": "1" }}>
                        <div style={{ "fontSize": "24px", "fontWeight": "680", "letterSpacing": "-0.02em" }}>
                          {"Theses"}
                        </div>
                        <div style={{ "fontSize": "12.5px", "color": "var(--g8a8a94)", "marginTop": "4px" }}>
                          {"Your own structure. Drag to nest, right-click to pin."}
                        </div>
                      </div>
                      <button onClick={V?.newThesis} style={{ "height": "28px", "padding": "0 12px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": "var(--w50)", "fontSize": "12.5px", "cursor": "default" }}>
                        {"+ New thesis"}
                      </button>
                    </div>
                    {' '}
                    <div style={{ "marginTop": "18px", "borderRadius": "10px", "border": "1px solid var(--w70)", "overflow": "hidden" }}>
                      {' '}
                      <div style={{ "display": "grid", "gridTemplateColumns": "minmax(0,1fr) 110px 90px 90px", "gap": "10px", "padding": "8px 14px", "fontSize": "11px", "color": "var(--g74747e)", "borderBottom": "1px solid var(--w60)", "background": "var(--w20)" }}>
                        <span>
                          {"Thesis"}
                        </span>
                        <span>
                          {"Conviction"}
                        </span>
                        <span>
                          {"Evidence"}
                        </span>
                        <span>
                          {"Updated"}
                        </span>
                      </div>
                      {' '}
                      <ThesesExtras V={V} />
{((V?.thesisRows) || []).map((t: any, t_i30: number) => (
                        <React.Fragment key={t_i30}>
                          {' '}
                          <div onClick={t?.onClick} onContextMenu={t?.onCtx} draggable={t?.draggable} onDragStart={t?.onDragStart} onDragOver={t?.onDragOver} onDrop={t?.onDrop} data-thesis={t?.id} style={{ "display": "grid", "gridTemplateColumns": "minmax(0,1fr) 110px 90px 90px", "gap": "10px", "alignItems": "center", "padding": "0 14px", "height": "38px", "borderBottom": "1px solid var(--w40)", "cursor": "default" }} className="dch25">
                            <div style={{ "display": "flex", "alignItems": "center", "gap": "7px", "paddingLeft": t?.pad, "minWidth": "0" }}>
                              <span onClick={t?.onChev} style={{ "width": "14px", "fontSize": "9px", "color": "var(--g80808a)", "textAlign": "center" }}>
                                {t?.chev}
                              </span>
                              <span style={{ "color": t?.color, "fontSize": "9px" }}>
                                {"◆"}
                              </span>
                              <span style={{ "fontSize": "13px", "color": "var(--ge8e8ec)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                {t?.name}
                              </span>
                              <span style={{ "fontSize": "10.5px", "color": "var(--o8-1-255)" }}>
                                {t?.fresh}
                              </span>
                            </div>
                            <div style={{ "display": "flex", "gap": "2px" }}>
                              {((t?.dots) || []).map((d: any, d_i31: number) => (
                                <React.Fragment key={d_i31}>
                                  <span style={{ "width": "12px", "height": "5px", "borderRadius": "2px", "background": d?.bg }} />
                                </React.Fragment>
                              ))}
                            </div>
                            <span style={{ "fontSize": "12px", "color": "var(--ga6a6b0)", "fontVariantNumeric": "tabular-nums" }}>
                              {t?.count}
                            </span>
                            <span style={{ "fontSize": "12px", "color": "var(--g80808a)" }}>
                              {t?.updated}
                            </span>
                          </div>
                          {' '}
                        </React.Fragment>
                      ))}
                      {' '}
                    </div>
                    {' '}
                  </div>
                  {' '}
                </div>
              </>
            ) : null}
            {V?.isCompany ? (
              <>
                <div style={{ "flex": "1", "overflow": "auto" }}>
                  {' '}
                  <div style={{ "maxWidth": "1000px", "margin": "0 auto", "padding": "26px 40px 90px" }}>
                    {' '}
                    <div style={{ "display": "flex", "alignItems": "center", "gap": "10px 16px", "flexWrap": "wrap" }}>
                      <div style={{ "width": "54px", "height": "54px", "borderRadius": "13px", "background": V?.c?.tile, "color": "#15161a", "fontSize": "24px", "fontWeight": "700", "display": "grid", "placeItems": "center", "boxShadow": "inset 0 0 0 1px var(--w200),0 6px 20px var(--k300)" }}>
                        {V?.c?.initial}
                      </div>
                      <div style={{ "flex": "1", "minWidth": "220px" }}>
                        {' '}
                        <div style={{ "fontSize": "26px", "fontWeight": "680", "letterSpacing": "-0.02em" }}>
                          {V?.c?.name}
                        </div>
                        {' '}
                        <div style={{ "fontSize": "13.5px", "color": "var(--ga6a6b0)", "marginTop": "2px" }}>
                          {V?.c?.tagline}
                        </div>
                        {V?.c?.tierText ? <div data-testid="tier-line" style={{ "fontSize": "12px", "color": "var(--g80808a)", "marginTop": "3px" }}>{V?.c?.tierText}</div> : null}
                        {' '}
                      </div>
                      <button onClick={V?.c?.followed ? V?.c?.onCheck : V?.c?.onPull} style={{ "height": "28px", "padding": "0 11px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12.5px", "cursor": "default" }}>
                        {V?.c?.checkLabel}
                      </button>
                      <button onClick={V?.c?.onCustomize} style={{ "height": "28px", "padding": "0 11px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12.5px", "cursor": "default" }}>
                        {"Customize"}
                      </button>
                      <button onClick={V?.c?.onNotify} style={{ "height": "28px", "padding": "0 11px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12.5px", "cursor": "default" }}>
                        {"Notify me…"}
                      </button>
                      <button onClick={V?.c?.onPin} style={{ "height": "28px", "padding": "0 11px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12.5px", "cursor": "default" }}>
                        {V?.c?.pinLabel}
                      </button>
                      <button onClick={V?.c?.onFollow} style={{ "height": "28px", "padding": "0 12px", "borderRadius": "7px", "border": `1px solid ${V?.c?.followBorder ?? ""}`, "background": V?.c?.followBg, "color": V?.c?.followColor, "fontSize": "12.5px", "cursor": "default" }}>
                        {V?.c?.followLabel}
                      </button>
                    </div>
                    {' '}
                    <div style={{ "display": "flex", "gap": "8px", "marginTop": "14px", "flexWrap": "wrap", "fontSize": "12px" }}>
                      {(V?.c?.chipsV || []).map((ch: any, i: number) => (
                        <span key={i} role="button" title={ch?.title} onClick={ch?.onClick} style={{ "height": "22px", "padding": "0 8px", "borderRadius": "5px", "background": i === 0 && ch?.key === 'stage' ? "oklch(0.62 0.15 258 / 0.2)" : "var(--w50)", "color": i === 0 && ch?.key === 'stage' ? "var(--o86-08-258)" : ch?.key === 'website' ? "var(--o78-11-255)" : "var(--gc4c4cc)", "display": "inline-flex", "alignItems": "center", "cursor": "default" }}>
                          {ch?.label}{ch?.key === 'website' ? " ↗" : ""}
                        </span>
                      ))}
                    </div>
                    <ObjectBanners proposals={V?.coProposals} merges={V?.coMerges} reading={V?.coReading} />
                    <HintCard h={V?.coHint} />
                    <LookupLine l={V?.coLookup} />
                    <ReprocessLine r={V?.coRe} />
                    {' '}
                    <div style={{ "display": "flex", "gap": "18px", "marginTop": "20px", "borderBottom": "1px solid var(--w70)" }}>
                      {((V?.coTabs) || []).map((t: any, t_i32: number) => (
                        <React.Fragment key={t_i32}>
                          <div onClick={t?.onClick} style={{ "padding": "0 0 9px", "fontSize": "13px", "color": t?.color, "borderBottom": `2px solid ${t?.line ?? ""}`, "marginBottom": "-1px", "cursor": "default" }}>
                            {t?.label}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                    {' '}
                    <div style={{ "display": "grid", "gridTemplateColumns": "minmax(0,1fr) 280px", "gap": "34px", "marginTop": "22px" }}>
                      <div style={{ "display": "flex", "flexDirection": "column", "minWidth": "0" }}>
                        {' '}
                        {V?.coShowOverview ? ((V?.coCustoms) || []).map((cc: any, ci: number) => (
                          <div key={'cc' + ci} data-section="custom" style={{ "order": cc?.order, "marginBottom": "24px", "padding": "12px 14px", "borderRadius": "10px", "border": "1px solid var(--w70)", "background": "var(--w25)" }}>
                            <div style={{ "display": "flex", "alignItems": "baseline", "gap": "8px", "marginBottom": "8px" }}>
                              <span style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>{cc?.title}</span>
                              <span style={{ "flex": "1", "fontSize": "11px", "color": "var(--g74747e)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>{"Your layout · “"}{cc?.instr}{"”"}</span>
                              <span onClick={cc?.onEdit} style={{ "fontSize": "11.5px", "color": "var(--o78-11-255)", "cursor": "default" }}>{"Edit"}</span>
                            </div>
                            {((cc?.rows) || []).map((r: any, ri: number) => (
                              <div key={ri} role={r?.onClick ? "button" : undefined} title={r?.title} onClick={r?.onClick} style={{ "display": "grid", "gridTemplateColumns": "110px minmax(0,1fr)", "gap": "12px", "padding": "6px 0", "borderTop": "1px solid var(--w45)", "fontSize": "12.5px" }}>
                                <span style={{ "color": "var(--g8a8a94)" }}>{r?.label}</span>
                                <span style={{ "color": "var(--gdcdce2)", "lineHeight": "1.4" }}>{r?.value}</span>
                              </div>
                            ))}
                            {cc?.empty ? (<div style={{ "fontSize": "12.5px", "color": "var(--g8a8a94)", "padding": "6px 0", "borderTop": "1px solid var(--w45)" }}>{cc?.emptyText}</div>) : null}
                          </div>
                        )) : null}
                        <div style={{ "order": V?.coL?.oActivity, "display": V?.coL?.activity ? "block" : "none" }}>
                        {V?.coShowActivity ? (
                          <>
                            {' '}
                            <div style={{ "display": "flex", "alignItems": "center", "gap": "6px", "marginBottom": "12px" }}>
                              <div style={{ "flex": "1", "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>
                                {"Recent activity"}
                              </div>
                              {((V?.actFilters) || []).map((f: any, f_i34: number) => (
                                <React.Fragment key={f_i34}>
                                  <span onClick={f?.onClick} style={{ "height": "21px", "padding": "0 8px", "borderRadius": "5px", "background": f?.bg, "color": f?.color, "fontSize": "11px", "display": "inline-flex", "alignItems": "center", "cursor": "default" }}>
                                    {f?.label}
                                  </span>
                                </React.Fragment>
                              ))}
                            </div>
                            {' '}
                            {((V?.activityV) || []).map((a: any, a_i35: number) => (
                              <React.Fragment key={a_i35}>
                                {' '}
                                <div onClick={a?.onClick} style={{ "display": "grid", "gridTemplateColumns": "86px 14px minmax(0,1fr)", "gap": "10px", "cursor": "default" }}>
                                  <div style={{ "fontSize": "11.5px", "color": "var(--g80808a)", "paddingTop": "2px", "textAlign": "right" }}>
                                    {a?.date}
                                  </div>
                                  <div style={{ "display": "flex", "flexDirection": "column", "alignItems": "center" }}>
                                    <span style={{ "width": "8px", "height": "8px", "borderRadius": "50%", "background": a?.color, "marginTop": "5px", "flexShrink": "0" }} />
                                    <span style={{ "flex": "1", "width": "1px", "background": "var(--w80)", "marginTop": "4px" }} />
                                  </div>
                                  <div style={{ "paddingBottom": "18px" }}>
                                    {' '}
                                    <div style={{ "fontSize": "11px", "color": a?.color }}>
                                      {a?.kind}{" "}
                                      <span style={{ "color": "var(--g74747e)" }}>
                                        {"· "}{a?.src}
                                      </span>
                                    </div>
                                    {' '}
                                    <div style={{ "fontSize": "13.5px", "lineHeight": "1.4", "color": "var(--gececf0)", "marginTop": "2px" }}>
                                      {a?.title}
                                    </div>
                                    {' '}
                                    {a?.hasWhy ? (
                                      <>
                                        <div style={{ "fontSize": "12.5px", "lineHeight": "1.45", "color": "var(--ga6a6b0)", "marginTop": "4px" }}>
                                          {a?.why}
                                        </div>
                                      </>
                                    ) : null}
                                    {' '}
                                  </div>
                                </div>
                                {' '}
                              </React.Fragment>
                            ))}
                            {' '}
                          </>
                        ) : null}
                        {' '}
                        </div>
                        {V?.coShowEvidence ? (
                          <>
                            {' '}
                            <div style={{ "display": "flex", "flexDirection": "column", "gap": "7px" }}>
                              {((V?.coEvidence) || []).map((e: any, e_i36: number) => (
                                <React.Fragment key={e_i36}>
                                  <div style={{ "padding": "11px 12px", "borderRadius": "8px", "background": "var(--w30)", "border": "1px solid var(--w60)", "borderLeft": `2px solid ${e?.color ?? ""}` }}>
                                    {' '}
                                    <div style={{ "fontFamily": V?.readerFamily, "fontSize": "14px", "lineHeight": "1.5", "color": "var(--gdcdce2)" }}>
                                      {"“"}{e?.text}{"”"}
                                    </div>
                                    {' '}
                                    <div style={{ "fontSize": "11px", "color": "var(--g80808a)", "marginTop": "6px" }}>
                                      {e?.src}{" · "}{e?.date}{" · "}{e?.theses}
                                    </div>
                                    {' '}
                                  </div>
                                </React.Fragment>
                              ))}
                              {V?.coNoEvidence ? (
                                <>
                                  <div style={{ "fontSize": "13px", "color": "var(--g7c7c86)" }}>
                                    {"No saved evidence yet. Highlight a passage while reading to save it here."}
                                  </div>
                                </>
                              ) : null}
                            </div>
                            {' '}
                          </>
                        ) : null}
                        {' '}
                        {V?.coShowTheses ? (
                          <>
                            {' '}
                            {((V?.coTheses) || []).map((t: any, t_i37: number) => (
                              <React.Fragment key={t_i37}>
                                {' '}
                                <div onClick={t?.onClick} style={{ "display": "flex", "alignItems": "center", "gap": "10px", "padding": "12px", "borderRadius": "8px", "border": "1px solid var(--w60)", "marginBottom": "6px", "cursor": "default" }} className="dch26">
                                  <span style={{ "color": t?.color, "fontSize": "10px" }}>
                                    {"◆"}
                                  </span>
                                  <div style={{ "flex": "1" }}>
                                    <div style={{ "fontSize": "13.5px", "color": "var(--gececf0)" }}>
                                      {t?.name}
                                    </div>
                                    <div style={{ "fontSize": "12px", "color": "var(--g8a8a94)", "marginTop": "2px" }}>
                                      {t?.desc}
                                    </div>
                                  </div>
                                </div>
                                {' '}
                              </React.Fragment>
                            ))}
                            {' '}
                          </>
                        ) : null}
                        {' '}
                        {V?.coShowInvestors ? (
                          <>
                            {' '}
                            <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "8px" }}>
                              {"Funding history"}
                            </div>
                            {' '}
                            <div style={{ "borderRadius": "9px", "border": "1px solid var(--w70)", "overflow": "hidden", "marginBottom": "22px" }}>
                              {' '}
                              {((V?.coFunding) || []).map((f: any, f_i38: number) => (
                                <React.Fragment key={f_i38}>
                                  {' '}
                                  <div style={{ "display": "grid", "gridTemplateColumns": "100px 90px 80px minmax(0,1fr)", "gap": "10px", "padding": "10px 14px", "borderBottom": "1px solid var(--w50)", "fontSize": "12.5px" }}>
                                    <span style={{ "color": "var(--gececf0)" }}>
                                      {f?.round}
                                    </span>
                                    <span style={{ "color": "var(--g8a8a94)" }}>
                                      {f?.date}
                                    </span>
                                    <span style={{ "color": "var(--gc8c8d0)", "fontVariantNumeric": "tabular-nums" }}>
                                      {f?.amount}
                                    </span>
                                    <span style={{ "color": "var(--ga6a6b0)" }}>
                                      {f?.lead}
                                    </span>
                                  </div>
                                  {' '}
                                </React.Fragment>
                              ))}
                              {' '}
                            </div>
                            {' '}
                            <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "8px" }}>
                              {"Investors"}
                            </div>
                            {' '}
                            <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "6px" }}>
                              {((V?.coInvestors) || []).map((f: any, f_i39: number) => (
                                <React.Fragment key={f_i39}>
                                  <span onClick={f?.onClick} style={{ "height": "26px", "padding": "0 10px", "borderRadius": "13px", "background": "var(--w50)", "color": f?.color, "fontSize": "12.5px", "display": "inline-flex", "alignItems": "center", "gap": "6px", "cursor": "default" }}>
                                    {f?.name}
                                    <span style={{ "fontSize": "10.5px", "color": "var(--o78-11-255)" }}>
                                      {f?.tag}
                                    </span>
                                  </span>
                                </React.Fragment>
                              ))}
                            </div>
                            {' '}
                          </>
                        ) : null}
                        {' '}
                        {V?.coShowNotes ? (
                          <>
                            {' '}
                            {((V?.coNotes) || []).map((n: any, n_i40: number) => (
                              <React.Fragment key={n_i40}>
                                {' '}
                                <div style={{ "padding": "12px 14px", "borderRadius": "9px", "background": "rgba(255,214,120,0.05)", "border": "1px solid rgba(255,214,120,0.1)", "marginBottom": "7px" }}>
                                  <div style={{ "fontSize": "13.5px", "lineHeight": "1.55", "color": "var(--ge8e6de)" }}>
                                    {n?.text}
                                  </div>
                                  <div style={{ "fontSize": "11px", "color": "var(--g8e8a80)", "marginTop": "5px" }}>
                                    {n?.date}
                                  </div>
                                </div>
                                {' '}
                              </React.Fragment>
                            ))}
                            {' '}
                          </>
                        ) : null}
                        {' '}
                      </div>
                      <div style={{ "display": "flex", "flexDirection": "column", "gap": "22px" }}>
                        <div style={{ "order": V?.coL?.oRailNotes }}><FromYou d={V?.coFromYou} r={V?.coRe} /></div>
                        <div style={{ "order": V?.coL?.oRailNotes, "display": V?.coL?.railNotes ? "block" : "none", "padding": "14px", "borderRadius": "11px", "background": "var(--w35)", "border": "1px solid var(--w80)", "backdropFilter": "blur(20px)" }}>
                          {' '}
                          <div style={{ "display": "flex", "alignItems": "center", "gap": "6px" }}>
                            <span style={{ "flex": "1", "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>
                              {"Your notes"}
                            </span>
                            <span style={{ "fontSize": "10.5px", "color": "var(--g74747e)" }}>
                              {"Private · on this Mac"}
                            </span>
                          </div>
                          {' '}
                          <div style={{ "display": "flex", "flexDirection": "column", "gap": "10px", "marginTop": "10px" }}>
                            {((V?.coNotesTop) || []).map((n: any, n_i41: number) => (
                              <React.Fragment key={n_i41}>
                                <div>
                                  <div style={{ "fontSize": "12.5px", "lineHeight": "1.5", "color": "var(--ge8e6de)" }}>
                                    {n?.text}
                                  </div>
                                  <div style={{ "fontSize": "11px", "color": "var(--g8e8a80)", "marginTop": "3px" }}>
                                    {n?.date}
                                  </div>
                                </div>
                              </React.Fragment>
                            ))}
                          </div>
                          {' '}
                          <textarea value={V?.coDraft} onChange={V?.onCoDraft} onKeyDown={V?.onCoKey} rows={2} placeholder="Add a note…  (⌘↵)" style={{ "width": "100%", "marginTop": "10px", "resize": "none", "borderRadius": "7px", "border": "1px solid var(--w80)", "background": "var(--k180)", "padding": "8px 10px", "fontSize": "12.5px", "outline": "none", "userSelect": "text" }} />
                          {' '}
                        </div>
                        <div style={{ "order": V?.coL?.oRailTheses, "display": V?.coL?.railTheses ? "block" : "none" }}>
                          {' '}
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "7px" }}>
                            {"Related theses"}
                          </div>
                          {' '}
                          {((V?.coTheses) || []).map((t: any, t_i42: number) => (
                            <React.Fragment key={t_i42}>
                              {' '}
                              <div onClick={t?.onClick} style={{ "display": "flex", "alignItems": "center", "gap": "8px", "padding": "5px 6px", "margin": "0 -6px", "borderRadius": "6px", "cursor": "default" }} className="dch27">
                                <span style={{ "color": t?.color, "fontSize": "9px" }}>
                                  {"◆"}
                                </span>
                                <span style={{ "fontSize": "12.5px", "color": "var(--ge4e4e8)" }}>
                                  {t?.name}
                                </span>
                              </div>
                              {' '}
                            </React.Fragment>
                          ))}
                          {' '}
                        </div>
                        <div style={{ "order": V?.coL?.oRailPeople, "display": V?.coL?.railPeople ? "block" : "none" }}>
                          {' '}
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "7px" }}>
                            {"Founders"}
                          </div>
                          {' '}
                          {((V?.coFounders) || []).map((f: any, f_i43: number) => (
                            <React.Fragment key={f_i43}>
                              {' '}
                              <div style={{ "display": "flex", "justifyContent": "space-between", "fontSize": "12.5px", "padding": "3px 0" }}>
                                <span style={{ "color": "var(--ge4e4e8)" }}>
                                  {f?.name}
                                </span>
                                <span style={{ "color": "var(--g80808a)" }}>
                                  {f?.role}
                                </span>
                              </div>
                              {' '}
                            </React.Fragment>
                          ))}
                          {' '}
                        </div>
                        <div style={{ "order": V?.coL?.oRailRound, "display": V?.coL?.railRound ? "block" : "none" }}>
                          {' '}
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "7px" }}>
                            {"Latest round"}
                          </div>
                          {' '}
                          <div style={{ "fontSize": "12.5px", "color": "var(--ge4e4e8)" }}>
                            {V?.c?.lastRound}
                          </div>
                          {' '}
                        </div>
                      </div>
                    </div>
                    {' '}
                  </div>
                  {' '}
                </div>
              </>
            ) : null}
            {V?.isFirm ? (
              <>
                <div style={{ "flex": "1", "overflow": "auto" }}>
                  {' '}
                  <div style={{ "maxWidth": "1000px", "margin": "0 auto", "padding": "26px 40px 90px" }}>
                    {' '}
                    <div style={{ "display": "flex", "alignItems": "center", "gap": "16px" }}>
                      <div style={{ "width": "54px", "height": "54px", "borderRadius": "50%", "background": V?.f?.tile, "color": "#15161a", "fontSize": "22px", "fontWeight": "700", "display": "grid", "placeItems": "center", "boxShadow": "inset 0 0 0 1px var(--w200)" }}>
                        {V?.f?.initial}
                      </div>
                      <div style={{ "flex": "1", "minWidth": "0" }}>
                        {' '}
                        <div style={{ "fontSize": "26px", "fontWeight": "680", "letterSpacing": "-0.02em" }}>
                          {V?.f?.name}
                        </div>
                        {' '}
                        <div style={{ "fontSize": "13.5px", "color": "var(--ga6a6b0)", "marginTop": "2px" }}>
                          {V?.f?.tagline}{" · "}{V?.f?.hq}
                        </div>
                        {V?.f?.tierText ? <div data-testid="tier-line" style={{ "fontSize": "12px", "color": "var(--g80808a)", "marginTop": "3px" }}>{V?.f?.tierText}</div> : null}
                        {' '}
                      </div>
                      {V?.f?.followed ? null : (
                        <button onClick={V?.f?.onPull} style={{ "height": "28px", "padding": "0 11px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12.5px", "cursor": "default" }}>
                          {V?.f?.checkLabel}
                        </button>
                      )}
                      <button onClick={V?.f?.onCustomize} style={{ "height": "28px", "padding": "0 11px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12.5px", "cursor": "default" }}>{"Customize"}</button>
                      <button onClick={V?.f?.onNotify} style={{ "height": "28px", "padding": "0 11px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12.5px", "cursor": "default" }}>{"Notify me…"}</button>
                      <button onClick={V?.f?.onFollow} style={{ "height": "28px", "padding": "0 12px", "borderRadius": "7px", "border": `1px solid ${V?.f?.followBorder ?? ""}`, "background": V?.f?.followBg, "color": V?.f?.followColor, "fontSize": "12.5px", "cursor": "default" }}>
                        {V?.f?.followLabel}
                      </button>
                    </div>
                    {' '}
                    <div style={{ "marginTop": "14px", "fontSize": "12px", "color": "var(--g8a8a94)", "display": "flex", "alignItems": "center", "gap": "8px" }}>
                      <span style={{ "width": "6px", "height": "6px", "borderRadius": "50%", "background": V?.f?.watchDot }} />
                      <span>
                        {V?.f?.watchLabel}
                      </span>
                      <span role="button" onClick={V?.goSources} style={{ "color": "var(--o8-1-255)", "cursor": "default" }}>
                        {"Edit sources"}
                      </span>
                    </div>
                    <ObjectBanners proposals={V?.fProposals} merges={V?.fMerges} reading={V?.fReading} />
                    <HintCard h={V?.fHint} />
                    <LookupLine l={V?.fLookup} />
                    <ReprocessLine r={V?.fRe} />
                    {' '}
                    <div style={{ "display": "grid", "gridTemplateColumns": "minmax(0,1fr) 280px", "gap": "34px", "marginTop": "26px" }}>
                      <div style={{ "display": "flex", "flexDirection": "column", "gap": "28px" }}>
                        {((V?.fCustoms) || []).map((cc: any, ci: number) => (
                          <div key={'fc' + ci} data-section="custom" style={{ "order": cc?.order, "padding": "12px 14px", "borderRadius": "10px", "border": "1px solid var(--w70)", "background": "var(--w25)" }}>
                            <div style={{ "display": "flex", "alignItems": "baseline", "gap": "8px", "marginBottom": "8px" }}>
                              <span style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>{cc?.title}</span>
                              <span style={{ "flex": "1", "fontSize": "11px", "color": "var(--g74747e)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>{"Your layout · “"}{cc?.instr}{"”"}</span>
                              <span onClick={cc?.onEdit} style={{ "fontSize": "11.5px", "color": "var(--o78-11-255)", "cursor": "default" }}>{"Edit"}</span>
                            </div>
                            {((cc?.rows) || []).map((r: any, ri: number) => (
                              <div key={ri} role={r?.onClick ? "button" : undefined} title={r?.title} onClick={r?.onClick} style={{ "display": "grid", "gridTemplateColumns": "110px minmax(0,1fr)", "gap": "12px", "padding": "6px 0", "borderTop": "1px solid var(--w45)", "fontSize": "12.5px" }}>
                                <span style={{ "color": "var(--g8a8a94)" }}>{r?.label}</span>
                                <span style={{ "color": "var(--gdcdce2)", "lineHeight": "1.4" }}>{r?.value}</span>
                              </div>
                            ))}
                            {cc?.empty ? (<div style={{ "fontSize": "12.5px", "color": "var(--g8a8a94)", "padding": "6px 0", "borderTop": "1px solid var(--w45)" }}>{cc?.emptyText}</div>) : null}
                          </div>
                        ))}
                        {V?.fL?.evidenceMain ? (
                          <div data-section="evidence_list" style={{ "order": V?.fL?.oEvidenceMain }}>
                            <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "8px" }}>{"Saved evidence"}</div>
                            {((V?.fEvidence) || []).map((e: any, ei: number) => (
                              <div key={ei} style={{ "padding": "8px 0", "borderTop": "1px solid var(--w45)", "fontSize": "12.5px", "lineHeight": "1.45" }}>
                                <div style={{ "color": "var(--gdcdce2)" }}>{e?.text}</div>
                                <div style={{ "fontSize": "11px", "color": "var(--g74747e)", "marginTop": "2px" }}>{e?.src}{e?.date ? ' · ' + e.date : ''}</div>
                              </div>
                            ))}
                            {!((V?.fEvidence) || []).length ? (<div style={{ "fontSize": "12.5px", "color": "var(--g7c7c86)" }}>{"No saved evidence yet."}</div>) : null}
                          </div>
                        ) : null}
                        <div style={{ "order": V?.fL?.oInvest, "display": V?.fL?.invest ? "block" : "none" }}>
                          {' '}
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "8px" }}>
                            {"Recent public investments"}
                          </div>
                          {' '}
                          <div style={{ "borderRadius": "10px", "border": "1px solid var(--w70)", "overflow": "hidden" }}>
                            {' '}
                            {((V?.fInvest) || []).map((i: any, i_i44: number) => (
                              <React.Fragment key={i_i44}>
                                {' '}
                                <div onClick={i?.onClick} style={{ "display": "flex", "alignItems": "center", "gap": "12px", "padding": "11px 14px", "borderBottom": "1px solid var(--w50)", "cursor": "default" }} className="dch28">
                                  <span style={{ "width": "26px", "height": "26px", "borderRadius": "7px", "background": i?.tile, "color": "#15161a", "fontSize": "11px", "fontWeight": "700", "display": "grid", "placeItems": "center", "flexShrink": "0" }}>
                                    {i?.initial}
                                  </span>
                                  <div style={{ "flex": "1", "minWidth": "0" }}>
                                    <div style={{ "fontSize": "13px", "color": "var(--gececf0)" }}>
                                      {i?.name}{" "}
                                      <span style={{ "fontSize": "11.5px", "color": "var(--g8a8a94)" }}>
                                        {"· "}{i?.round}
                                      </span>
                                    </div>
                                    <div style={{ "fontSize": "12px", "color": "var(--ga6a6b0)", "marginTop": "1px" }}>
                                      {i?.note}
                                    </div>
                                  </div>
                                  <span style={{ "fontSize": "11.5px", "color": "var(--g80808a)", "whiteSpace": "nowrap" }}>
                                    {i?.date}
                                  </span>
                                  <span style={{ "fontSize": "10.5px", "color": "var(--o8-1-255)", "whiteSpace": "nowrap" }}>
                                    {i?.tracked}
                                  </span>
                                </div>
                                {' '}
                              </React.Fragment>
                            ))}
                            {' '}
                          </div>
                          {' '}
                        </div>
                        <div style={{ "order": V?.fL?.oWriting, "display": V?.fL?.writing ? "block" : "none" }}>
                          {' '}
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "8px" }}>
                            {"Recent writing"}
                          </div>
                          {' '}
                          {((V?.fWriting) || []).map((w: any, w_i45: number) => (
                            <React.Fragment key={w_i45}>
                              {' '}
                              <div onClick={w?.onClick} style={{ "padding": "10px 0", "borderBottom": "1px solid var(--w50)", "cursor": "default" }}>
                                {' '}
                                <div style={{ "fontSize": "11px", "color": "var(--g80808a)" }}>
                                  {w?.kind}{" · "}{w?.date}
                                </div>
                                {' '}
                                <div style={{ "fontFamily": V?.readerFamily, "fontSize": "16px", "color": "var(--gececf0)", "marginTop": "3px" }}>
                                  {w?.title}
                                </div>
                                {' '}
                              </div>
                              {' '}
                            </React.Fragment>
                          ))}
                          {' '}
                          {V?.fNoWriting ? (
                            <>
                              <div style={{ "fontSize": "12.5px", "color": "var(--g7c7c86)" }}>
                                {"No public writing captured yet."}
                              </div>
                            </>
                          ) : null}
                          {' '}
                        </div>
                        <div style={{ "order": V?.fL?.oComm, "display": V?.fL?.comm ? "block" : "none" }}>
                          {' '}
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "8px" }}>
                            {"Partner commentary"}
                          </div>
                          {' '}
                          {((V?.fComm) || []).map((q: any, q_i46: number) => (
                            <React.Fragment key={q_i46}>
                              {' '}
                              <div style={{ "padding": "12px 14px", "borderRadius": "9px", "background": "var(--w30)", "border": "1px solid var(--w60)", "marginBottom": "7px" }}>
                                {' '}
                                <div style={{ "fontFamily": V?.readerFamily, "fontSize": "15px", "lineHeight": "1.5", "color": "var(--ge4e4e8)" }}>
                                  {"“"}{q?.quote}{"”"}
                                </div>
                                {' '}
                                <div style={{ "fontSize": "11.5px", "color": "var(--g80808a)", "marginTop": "6px" }}>
                                  {q?.who}{" · "}{q?.where}{" · "}{q?.date}
                                </div>
                                {' '}
                              </div>
                              {' '}
                            </React.Fragment>
                          ))}
                          {' '}
                          {V?.fNoComm ? (
                            <>
                              <div style={{ "fontSize": "12.5px", "color": "var(--g7c7c86)" }}>
                                {"No partner commentary captured yet."}
                              </div>
                            </>
                          ) : null}
                          {' '}
                        </div>
                      </div>
                      <div style={{ "display": "flex", "flexDirection": "column", "gap": "22px" }}>
                        <div style={{ "order": V?.fL?.oRailNotes }}><FromYou d={V?.fFromYou} r={V?.fRe} /></div>
                        <div style={{ "padding": "14px", "borderRadius": "11px", "background": "var(--w35)", "border": "1px solid var(--w80)", "order": V?.fL?.oRailNotes, "display": V?.fL?.railNotes ? "block" : "none" }}>
                          {' '}
                          <div style={{ "display": "flex", "alignItems": "center" }}>
                            <span style={{ "flex": "1", "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)" }}>
                              {"Your notes"}
                            </span>
                            <span style={{ "fontSize": "10.5px", "color": "var(--g74747e)" }}>
                              {"Private"}
                            </span>
                          </div>
                          {' '}
                          {((V?.fNotes) || []).map((n: any, n_i47: number) => (
                            <React.Fragment key={n_i47}>
                              {' '}
                              <div style={{ "marginTop": "10px" }}>
                                <div style={{ "fontSize": "12.5px", "lineHeight": "1.5", "color": "var(--ge8e6de)" }}>
                                  {n?.text}
                                </div>
                                <div style={{ "fontSize": "11px", "color": "var(--g8e8a80)", "marginTop": "3px" }}>
                                  {n?.date}
                                </div>
                              </div>
                              {' '}
                            </React.Fragment>
                          ))}
                          {' '}
                          <textarea value={V?.coDraft} onChange={V?.onCoDraft} onKeyDown={V?.onFirmKey} rows={2} placeholder="Add a note…  (⌘↵)" style={{ "width": "100%", "marginTop": "10px", "resize": "none", "borderRadius": "7px", "border": "1px solid var(--w80)", "background": "var(--k180)", "padding": "8px 10px", "fontSize": "12.5px", "outline": "none", "userSelect": "text" }} />
                          {' '}
                        </div>
                        <div style={{ "order": V?.fL?.oRailPortfolio, "display": V?.fL?.railPortfolio ? "block" : "none" }}>
                          {' '}
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "7px" }}>
                            {"Portfolio you track"}
                          </div>
                          {' '}
                          {((V?.fPortfolio) || []).map((p: any, p_i48: number) => (
                            <React.Fragment key={p_i48}>
                              {' '}
                              <div onClick={p?.onClick} style={{ "display": "flex", "alignItems": "center", "gap": "8px", "padding": "5px 6px", "margin": "0 -6px", "borderRadius": "6px", "cursor": "default" }} className="dch29">
                                <span style={{ "width": "18px", "height": "18px", "borderRadius": "5px", "background": p?.tile, "color": "#15161a", "fontSize": "9.5px", "fontWeight": "700", "display": "grid", "placeItems": "center" }}>
                                  {p?.initial}
                                </span>
                                <span style={{ "flex": "1", "fontSize": "12.5px", "color": "var(--ge4e4e8)" }}>
                                  {p?.name}
                                </span>
                                <span style={{ "fontSize": "11px", "color": "var(--g80808a)" }}>
                                  {p?.stage}
                                </span>
                              </div>
                              {' '}
                            </React.Fragment>
                          ))}
                          {' '}
                        </div>
                        <div style={{ "order": V?.fL?.oRailTheses, "display": V?.fL?.railTheses ? "block" : "none" }}>
                          {' '}
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "7px" }}>
                            {"Related theses"}
                          </div>
                          {' '}
                          {((V?.fTheses) || []).map((t: any, t_i49: number) => (
                            <React.Fragment key={t_i49}>
                              {' '}
                              <div onClick={t?.onClick} style={{ "display": "flex", "alignItems": "center", "gap": "8px", "padding": "5px 6px", "margin": "0 -6px", "borderRadius": "6px", "cursor": "default" }} className="dch30">
                                <span style={{ "color": t?.color, "fontSize": "9px" }}>
                                  {"◆"}
                                </span>
                                <span style={{ "fontSize": "12.5px", "color": "var(--ge4e4e8)" }}>
                                  {t?.name}
                                </span>
                              </div>
                              {' '}
                            </React.Fragment>
                          ))}
                          {' '}
                        </div>
                        <div style={{ "order": V?.fL?.oRailEvidence, "display": V?.fL?.railEvidence ? "block" : "none" }}>
                          {' '}
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "7px" }}>
                            {"Saved evidence"}
                          </div>
                          {' '}
                          {((V?.fEvidence) || []).map((e: any, e_i50: number) => (
                            <React.Fragment key={e_i50}>
                              {' '}
                              <div style={{ "fontSize": "12px", "lineHeight": "1.45", "color": "var(--gc8c8d0)", "padding": "8px 0", "borderBottom": "1px solid var(--w50)" }}>
                                {"“"}{e?.text}{"”"}
                                <div style={{ "fontSize": "11px", "color": "var(--g80808a)", "marginTop": "3px" }}>
                                  {e?.src}{" · "}{e?.date}
                                </div>
                              </div>
                              {' '}
                            </React.Fragment>
                          ))}
                          {' '}
                          {V?.fNoEvidence ? (
                            <>
                              <div style={{ "fontSize": "12px", "color": "var(--g7c7c86)" }}>
                                {"None yet."}
                              </div>
                            </>
                          ) : null}
                          {' '}
                        </div>
                      </div>
                    </div>
                    {' '}
                  </div>
                  {' '}
                </div>
              </>
            ) : null}
            {V?.isEntityList ? (
              <>
                <div style={{ "flex": "1", "overflow": "auto" }}>
                  {' '}
                  <div style={{ "maxWidth": "1000px", "margin": "0 auto", "padding": "26px 36px 80px" }}>
                    {' '}
                    <div style={{ "display": "flex", "alignItems": "flex-end", "gap": "12px" }}>
                      <div style={{ "flex": "1" }}>
                        <div style={{ "fontSize": "24px", "fontWeight": "680", "letterSpacing": "-0.02em" }}>
                          {V?.listTitle}
                        </div>
                        <div style={{ "fontSize": "12.5px", "color": "var(--g8a8a94)", "marginTop": "4px" }}>
                          {V?.listSub}
                        </div>
                      </div>
                      <div style={{ "display": "flex", "gap": "2px", "padding": "2px", "background": "var(--w50)", "borderRadius": "7px" }}>
                        {((V?.listSegs) || []).map((g: any, g_i51: number) => (
                          <React.Fragment key={g_i51}>
                            <button onClick={g?.onClick} style={{ "height": "24px", "padding": "0 12px", "border": "none", "borderRadius": "5px", "background": g?.bg, "color": g?.color, "boxShadow": g?.shadow, "fontSize": "12px", "cursor": "default" }}>
                              {g?.label}
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                    {' '}
                    <div style={{ "marginTop": "18px", "borderRadius": "10px", "border": "1px solid var(--w70)", "overflow": "hidden" }}>
                      {' '}
                      {V?.entityEmpty ? (<div style={{ "padding": "40px 20px", "textAlign": "center", "fontSize": "12.5px", "color": "var(--g8a8a94)" }}>{V?.listEmptyText}</div>) : null}
                      {((V?.entityRows) || []).map((e: any, e_i52: number) => (
                        <React.Fragment key={e_i52}>
                          {' '}
                          <div onClick={e?.onClick} style={{ "display": "grid", "gridTemplateColumns": "minmax(0,1.3fr) 100px minmax(0,1.6fr) 96px", "gap": "14px", "alignItems": "center", "padding": "10px 14px", "borderBottom": "1px solid var(--w45)", "cursor": "default" }} className="dch31">
                            <div style={{ "display": "flex", "alignItems": "center", "gap": "10px", "minWidth": "0" }}>
                              <span style={{ "width": "26px", "height": "26px", "borderRadius": e?.radius, "background": e?.tile, "color": "#15161a", "fontSize": "11px", "fontWeight": "700", "display": "grid", "placeItems": "center", "flexShrink": "0" }}>
                                {e?.initial}
                              </span>
                              <div style={{ "minWidth": "0" }}>
                                <div style={{ "fontSize": "13px", "color": "var(--gececf0)" }}>
                                  {e?.name}
                                </div>
                                <div style={{ "fontSize": "11.5px", "color": "var(--g80808a)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                  {e?.tagline}
                                </div>
                              </div>
                            </div>
                            <span style={{ "fontSize": "11.5px", "color": "var(--gc4c4cc)" }}>
                              {e?.stage}
                            </span>
                            <div style={{ "minWidth": "0" }}>
                              <div style={{ "fontSize": "12px", "color": "var(--gc8c8d0)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                {e?.last}
                              </div>
                              <div style={{ "fontSize": "11px", "color": "var(--g74747e)" }}>
                                {e?.lastDate}
                              </div>
                            </div>
                            {e?.onDescribe ? (
                            <button onClick={e?.onDescribe} title="What you know about them — the agent uses it, never overwrites it" style={{ "height": "23px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "color": "var(--gc8c8d0)", "fontSize": "11.5px", "cursor": "default", "marginRight": "6px" }}>
                              {"Describe…"}
                            </button>
                            ) : null}
                            {e?.onReprocess ? (
                            <button onClick={e?.onReprocess} title="Look them up again and re-read their articles" style={{ "height": "23px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "color": "var(--gc8c8d0)", "fontSize": "11.5px", "cursor": "default", "marginRight": "6px" }}>
                              {"Re-process"}
                            </button>
                            ) : null}
                            {e?.onPull ? (
                            <button onClick={e?.onPull} title="One lookup for the latest news; nothing is subscribed" style={{ "height": "23px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "color": "var(--gc8c8d0)", "fontSize": "11.5px", "cursor": "default", "marginRight": "6px" }}>
                              {"Pull latest"}
                            </button>
                            ) : null}
                            <button onClick={e?.onFollow} style={{ "height": "23px", "padding": "0 9px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": e?.followBg, "color": e?.followColor, "fontSize": "11.5px", "cursor": "default", "justifySelf": "end" }}>
                              {e?.followLabel}
                            </button>
                          </div>
                          {' '}
                        </React.Fragment>
                      ))}
                      {' '}
                    </div>
                    {' '}
                  </div>
                  {' '}
                </div>
              </>
            ) : null}
            {V?.isSources ? (
              <>
                <div style={{ "flex": "1", "overflow": "auto" }}>
                  {' '}
                  <div style={{ "maxWidth": "980px", "margin": "0 auto", "padding": "26px 36px 80px" }}>
                    {' '}
                    <div style={{ "display": "flex", "alignItems": "flex-end", "gap": "12px" }}>
                      <div style={{ "flex": "1" }}>
                        <div style={{ "fontSize": "24px", "fontWeight": "680", "letterSpacing": "-0.02em" }}>
                          {"Sources"}
                        </div>
                        <div style={{ "fontSize": "12.5px", "color": "var(--g8a8a94)", "marginTop": "4px" }}>
                          {V?.srcSub}
                        </div>
                      </div>
                      <button onClick={V?.openAddSource} style={{ "height": "28px", "padding": "0 12px", "borderRadius": "7px", "border": "none", "background": "oklch(0.6 0.15 258)", "color": "#fff", "fontSize": "12.5px", "cursor": "default" }}>
                        {"+ Add source"}
                      </button>
                    </div>
                    {' '}
                    <div style={{ "display": "flex", "gap": "18px", "marginTop": "18px", "borderBottom": "1px solid var(--w70)" }}>
                      {((V?.srcTabs) || []).map((t: any, t_i53: number) => (
                        <React.Fragment key={t_i53}>
                          <div onClick={t?.onClick} style={{ "padding": "0 0 9px", "fontSize": "13px", "color": t?.color, "borderBottom": `2px solid ${t?.line ?? ""}`, "marginBottom": "-1px", "cursor": "default" }}>
                            {t?.label}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                    {' '}
                    {V?.srcSubscribed ? (
                      <>
                        {' '}
                        <div style={{ "display": "flex", "gap": "5px", "marginTop": "14px", "flexWrap": "wrap" }}>
                          {((V?.srcTypes) || []).map((f: any, f_i54: number) => (
                            <React.Fragment key={f_i54}>
                              <span onClick={f?.onClick} style={{ "height": "23px", "padding": "0 9px", "borderRadius": "6px", "background": f?.bg, "color": f?.color, "fontSize": "11.5px", "display": "inline-flex", "alignItems": "center", "cursor": "default" }}>
                                {f?.label}
                              </span>
                            </React.Fragment>
                          ))}
                        </div>
                        {' '}
                        <div style={{ "marginTop": "12px", "borderRadius": "10px", "border": "1px solid var(--w70)", "overflow": "hidden" }}>
                          {' '}
                          {((V?.srcRows) || []).map((x: any, x_i55: number) => (
                            <React.Fragment key={x_i55}>
                              {' '}
                              <div style={{ "borderBottom": "1px solid var(--w50)", "background": x?.rowBg }}>
                                {' '}
                                <div onClick={x?.onExpand} style={{ "display": "flex", "alignItems": "center", "gap": "12px", "padding": "10px 14px", "cursor": "default", "opacity": x?.op }}>
                                  <span style={{ "width": "9px", "fontSize": "9px", "color": "var(--g80808a)" }}>
                                    {x?.chev}
                                  </span>
                                  <span style={{ "width": "24px", "height": "24px", "borderRadius": "6px", "background": x?.tile, "color": "#15161a", "fontSize": "10.5px", "fontWeight": "700", "display": "grid", "placeItems": "center", "flexShrink": "0" }}>
                                    {x?.initial}
                                  </span>
                                  <div style={{ "flex": "1", "minWidth": "0" }}>
                                    {' '}
                                    <div style={{ "display": "flex", "alignItems": "center", "gap": "7px" }}>
                                      <span style={{ "fontSize": "13px", "color": "var(--gececf0)" }}>
                                        {x?.name}
                                      </span>
                                      <span style={{ "fontSize": "10.5px", "color": "var(--g9a9aa4)", "padding": "1px 6px", "borderRadius": "4px", "background": "var(--w60)" }}>
                                        {x?.type}
                                      </span>
                                      <span style={{ "fontSize": "10.5px", "color": "var(--o8-12-65)" }}>
                                        {x?.mutedLabel}
                                      </span>
                                    </div>
                                    {' '}
                                    <div style={{ "fontSize": "12px", "color": "var(--g9a9aa4)", "marginTop": "2px", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                      {x?.instr}
                                    </div>
                                    {x?.hasError ? (<div role="alert" style={{ "fontSize": "11.5px", "color": "#ff8a80", "marginTop": "2px", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>{x?.errorLine}</div>) : null}
                                    {' '}
                                  </div>
                                  <div style={{ "textAlign": "right", "fontSize": "11px", "color": "var(--g80808a)", "whiteSpace": "nowrap", "lineHeight": "1.4" }}>
                                    <div>
                                      {x?.freq}{" · "}{x?.priority}
                                    </div>
                                    <div>
                                      {x?.count}{x?.count === 1 ? " item this month · " : " items this month · "}{x?.last}
                                    </div>
                                  </div>
                                  <div onClick={x?.onToggle} title="Enabled" role="switch" aria-checked={!!x?.enabled} aria-label={"Enabled " + (x?.name ?? "")} style={{ "width": "30px", "height": "18px", "borderRadius": "9px", "background": x?.tgBg, "position": "relative", "flexShrink": "0", "transition": "background .15s" }}>
                                    <span style={{ "position": "absolute", "top": "2px", "left": "2px", "width": "14px", "height": "14px", "borderRadius": "50%", "background": "#fff", "boxShadow": "0 1px 2px var(--k350)", "transform": x?.tgKnob, "transition": "transform .15s" }} />
                                  </div>
                                </div>
                                {' '}
                                {x?.expanded ? (
                                  <>
                                    {' '}
                                    <div style={{ "padding": "4px 14px 16px 59px", "display": "grid", "gridTemplateColumns": "minmax(0,1fr) 250px", "gap": "26px", "animation": "fade .18s ease" }}>
                                      <div>
                                        {' '}
                                        <div style={{ "fontSize": "11.5px", "color": "var(--g9a9aa4)", "marginBottom": "6px" }}>
                                          {"What should I capture from this source?"}
                                        </div>
                                        {' '}
                                        <div style={{ "display": "flex", "gap": "2px", "padding": "2px", "background": "var(--w50)", "borderRadius": "7px", "marginBottom": "8px" }}>
                                          {((x?.modeSegs) || []).map((g: any, g_i56: number) => (
                                            <React.Fragment key={g_i56}>
                                              <button onClick={g?.onClick} style={{ "flex": "1", "height": "24px", "border": "none", "borderRadius": "5px", "background": g?.bg, "color": g?.color, "boxShadow": g?.shadow, "fontSize": "11.5px", "cursor": "default" }}>
                                                {g?.label}
                                              </button>
                                            </React.Fragment>
                                          ))}
                                        </div>
                                        {' '}
                                        <textarea value={x?.instr} onChange={x?.onInstr} rows={2} style={{ "width": "100%", "resize": "none", "borderRadius": "8px", "border": "1px solid var(--w90)", "background": "var(--k200)", "padding": "9px 11px", "fontSize": "13px", "lineHeight": "1.45", "outline": "none", "userSelect": "text" }} />
                                        {' '}
                                        <div style={{ "fontSize": "11.5px", "color": "var(--g9a9aa4)", "margin": "12px 0 6px" }}>
                                          {"Connected theses"}
                                        </div>
                                        {' '}
                                        <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "5px" }}>
                                          {((x?.thChips) || []).map((t: any, t_i57: number) => (
                                            <React.Fragment key={t_i57}>
                                              <span onClick={t?.onClick} style={{ "height": "22px", "padding": "0 8px", "borderRadius": "5px", "background": t?.bg, "color": t?.color, "fontSize": "11.5px", "display": "inline-flex", "alignItems": "center", "cursor": "default" }}>
                                                {t?.label}
                                              </span>
                                            </React.Fragment>
                                          ))}
                                        </div>
                                        {' '}
                                        <div style={{ "fontSize": "11.5px", "color": "var(--g9a9aa4)", "margin": "14px 0 6px" }}>
                                          {"Recently captured"}
                                        </div>
                                        {' '}
                                        {((x?.recent) || []).map((i: any, i_i58: number) => (
                                          <React.Fragment key={i_i58}>
                                            <div onClick={i?.onClick} style={{ "fontSize": "12.5px", "color": "var(--gd0d0d6)", "padding": "3px 0", "cursor": "default" }} className="dch32">
                                              {i?.title}{" "}
                                              <span style={{ "color": "var(--g74747e)" }}>
                                                {"· "}{i?.time}
                                              </span>
                                            </div>
                                          </React.Fragment>
                                        ))}
                                        {' '}
                                        {x?.noRecent ? (
                                          <>
                                            <div style={{ "fontSize": "12px", "color": "var(--g74747e)" }}>
                                              {"Nothing captured in the last week."}
                                            </div>
                                          </>
                                        ) : null}
                                        <button aria-label="Load older posts" onClick={x?.onBackfill} style={{ "marginTop": "6px", "height": "22px", "padding": "0 8px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "11.5px", "color": "var(--g9a9aa4)", "cursor": "default" }}>{"Load older posts ▾"}</button>
                                        {' '}
                                      </div>
                                      <div style={{ "display": "flex", "flexDirection": "column", "gap": "12px" }}>
                                        <div>
                                          <div style={{ "fontSize": "11.5px", "color": "var(--g9a9aa4)", "marginBottom": "6px" }}>
                                            {"Check frequency"}
                                          </div>
                                          <div style={{ "display": "flex", "gap": "2px", "padding": "2px", "background": "var(--w50)", "borderRadius": "7px" }}>
                                            {((x?.freqSegs) || []).map((g: any, g_i59: number) => (
                                              <React.Fragment key={g_i59}>
                                                <button onClick={g?.onClick} style={{ "flex": "1", "height": "23px", "border": "none", "borderRadius": "5px", "background": g?.bg, "color": g?.color, "boxShadow": g?.shadow, "fontSize": "11px", "cursor": "default" }}>
                                                  {g?.label}
                                                </button>
                                              </React.Fragment>
                                            ))}
                                          </div>
                                        </div>
                                        <div>
                                          <div style={{ "fontSize": "11.5px", "color": "var(--g9a9aa4)", "marginBottom": "6px" }}>
                                            {"Priority in Today"}
                                          </div>
                                          <div style={{ "display": "flex", "gap": "2px", "padding": "2px", "background": "var(--w50)", "borderRadius": "7px" }}>
                                            {((x?.prioSegs) || []).map((g: any, g_i60: number) => (
                                              <React.Fragment key={g_i60}>
                                                <button onClick={g?.onClick} style={{ "flex": "1", "height": "23px", "border": "none", "borderRadius": "5px", "background": g?.bg, "color": g?.color, "boxShadow": g?.shadow, "fontSize": "11px", "cursor": "default" }}>
                                                  {g?.label}
                                                </button>
                                              </React.Fragment>
                                            ))}
                                          </div>
                                        </div>
                                        <div style={{ "fontSize": "11px", "color": "var(--g74747e)", "lineHeight": "1.45" }}>
                                          {x?.checkedLine}
                                        </div>
                                        <div style={{ "display": "flex", "gap": "6px", "marginTop": "auto", "flexWrap": "wrap" }}>
                                          {x?.showSignIn ? (<button onClick={x?.onSignIn} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "none", "background": "oklch(0.6 0.15 258)", "color": "#fff", "fontSize": "11.5px", "cursor": "default" }}>{x?.signInLabel}</button>) : null}
                                          {x?.showRetry ? (<button onClick={x?.onRetry} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "11.5px", "cursor": "default" }}>{"Retry"}</button>) : null}
                                          <button onClick={x?.onSync} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "11.5px", "cursor": "default" }}>
                                            {"Sync now"}
                                          </button>
                                          <button onClick={x?.onMute} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "11.5px", "cursor": "default" }}>
                                            {x?.muteLabel}
                                          </button>
                                          <button onClick={x?.onReprocess} title="Fetch again and re-read its last 30 days with its current settings" style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "11.5px", "cursor": "default" }}>
                                            {"Re-process"}
                                          </button>
                                          <button onClick={x?.onReset} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "11.5px", "cursor": "default" }}>
                                            {"Reset…"}
                                          </button>
                                          <button onClick={x?.onRemove} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid rgba(255,120,110,0.25)", "background": "transparent", "color": "#ff8a80", "fontSize": "11.5px", "cursor": "default" }}>
                                            {"Remove"}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                    {' '}
                                  </>
                                ) : null}
                                {' '}
                              </div>
                              {' '}
                            </React.Fragment>
                          ))}
                          {' '}
                        </div>
                        {' '}
                      </>
                    ) : null}
                    {' '}
                    {V?.srcSuggested ? (
                      <>
                        {' '}
                        <div style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fill,minmax(280px,1fr))", "gap": "10px", "marginTop": "16px" }}>
                          {((V?.sugRows) || []).map((x: any, x_i61: number) => (
                            <React.Fragment key={x_i61}>
                              <div style={{ "padding": "14px", "borderRadius": "10px", "border": "1px solid var(--w70)", "background": "var(--w25)" }}>
                                {' '}
                                <div style={{ "display": "flex", "alignItems": "center", "gap": "10px" }}>
                                  <span style={{ "width": "26px", "height": "26px", "borderRadius": "7px", "background": x?.tile, "color": "#15161a", "fontSize": "11px", "fontWeight": "700", "display": "grid", "placeItems": "center" }}>
                                    {x?.initial}
                                  </span>
                                  <div>
                                    <div style={{ "fontSize": "13px", "color": "var(--gececf0)" }}>
                                      {x?.name}
                                    </div>
                                    <div style={{ "fontSize": "11px", "color": "var(--g80808a)" }}>
                                      {x?.type}
                                    </div>
                                  </div>
                                </div>
                                {' '}
                                <div style={{ "fontSize": "12.5px", "color": "var(--ga6a6b0)", "lineHeight": "1.45", "marginTop": "10px" }}>
                                  {x?.reason}
                                </div>
                                {' '}
                                <div style={{ "display": "flex", "gap": "6px", "marginTop": "12px" }}>
                                  <button onClick={x?.onAdd} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "none", "background": "oklch(0.6 0.15 258)", "color": "#fff", "fontSize": "11.5px", "cursor": "default" }}>
                                    {"Subscribe"}
                                  </button>
                                  <button onClick={x?.onDismiss} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "none", "background": "transparent", "color": "var(--g9a9aa4)", "fontSize": "11.5px", "cursor": "default" }}>
                                    {"Not interested"}
                                  </button>
                                </div>
                                {' '}
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                        {' '}
                        {V?.sugEmpty ? (
                          <>
                            <div style={{ "fontSize": "13px", "color": "var(--g7c7c86)", "marginTop": "20px" }}>
                              {"No suggestions right now. They appear when something you track has no source covering it."}
                            </div>
                          </>
                        ) : null}
                        {' '}
                      </>
                    ) : null}
                    {' '}
                    {V?.srcHistory ? (
                      <>
                        {' '}
                        <div style={{ "marginTop": "16px", "borderRadius": "10px", "border": "1px solid var(--w70)", "overflow": "hidden" }}>
                          {' '}
                          {((V?.histRows) || []).map((h: any, h_i62: number) => (
                            <React.Fragment key={h_i62}>
                              {' '}
                              <div style={{ "display": "grid", "gridTemplateColumns": "60px minmax(0,1fr) minmax(0,1fr) 60px", "gap": "12px", "alignItems": "center", "padding": "11px 14px", "borderBottom": "1px solid var(--w50)", "fontSize": "12.5px" }}>
                                <span style={{ "fontSize": "10.5px", "color": "var(--g9a9aa4)", "padding": "2px 6px", "borderRadius": "4px", "background": "var(--w60)", "justifySelf": "start" }}>
                                  {h?.type}
                                </span>
                                <span style={{ "color": "var(--gececf0)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                  {h?.title}
                                </span>
                                <span style={{ "color": "var(--g9a9aa4)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                  {h?.outcome}{h?.hasSignIn ? (<button onClick={h?.onSignIn} style={{ "marginLeft": "8px", "height": "20px", "padding": "0 8px", "borderRadius": "5px", "border": "none", "background": "oklch(0.6 0.15 258)", "color": "#fff", "fontSize": "11px", "cursor": "default" }}>{"Sign in"}</button>) : null}{h?.hasRetry ? (<button onClick={h?.onRetry} style={{ "marginLeft": "8px", "height": "20px", "padding": "0 8px", "borderRadius": "5px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "11px", "cursor": "default" }}>{"Retry"}</button>) : null}
                                </span>
                                <span style={{ "color": "var(--g74747e)", "textAlign": "right" }}>
                                  {h?.date}
                                </span>
                              </div>
                              {' '}
                            </React.Fragment>
                          ))}
                          {' '}
                        </div>
                        {' '}
                      </>
                    ) : null}
                    {' '}
                  </div>
                  {' '}
                </div>
              </>
            ) : null}
            {V?.isReports ? (
              <>
                <div style={{ "flex": "1", "overflow": "auto" }}>
                  {' '}
                  <div style={{ "maxWidth": "1080px", "margin": "0 auto", "padding": "26px 36px 80px" }}>
                    {' '}
                    <div style={{ "fontSize": "24px", "fontWeight": "680", "letterSpacing": "-0.02em" }}>
                      {"Reports"}
                    </div>
                    {' '}
                    <div style={{ "fontSize": "12.5px", "color": "var(--g8a8a94)", "marginTop": "4px" }}>
                      {"Summaries of your research, on a schedule or on demand. Delivered in the app."}
                    </div>
                    <div data-testid="reports-roles" style={{ "fontSize": "12.5px", "color": "var(--g8a8a94)", "marginTop": "2px" }}>{"Reports are deep dives you read here; briefings are what gets emailed to you."}</div>
                    {' '}
                    <div style={{ "display": "flex", "gap": "8px", "marginTop": "18px" }}>
                      <input ref={V?.repRef} value={V?.repDraft} onChange={V?.onRepDraft} onKeyDown={V?.onRepKey} placeholder="Describe a report: “Every Monday, seed deals in vertical AI”" style={{ "flex": "1", "minWidth": "0", "height": "36px", "borderRadius": "9px", "border": "1px solid var(--w100)", "background": "var(--k200)", "padding": "0 12px", "fontSize": "13px", "outline": "none", "userSelect": "text" }} />
                      <button onClick={V?.onRepCreate} style={{ "height": "36px", "padding": "0 14px", "borderRadius": "9px", "border": "none", "background": V?.repBtnBg, "color": "#fff", "fontSize": "12.5px", "cursor": "default", "whiteSpace": "nowrap" }}>
                        {"Create report"}
                      </button>
                    </div>
                    {' '}
                    <div style={{ "display": "grid", "gridTemplateColumns": "repeat(auto-fit,minmax(320px,1fr))", "gap": "28px", "marginTop": "24px", "alignItems": "start" }}>
                      <div style={{ "display": "flex", "flexDirection": "column", "gap": "24px" }}>
                        <div>
                          {' '}
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "8px" }}>
                            {"Your reports"}
                          </div>
                          {' '}
                          <div style={{ "borderRadius": "10px", "border": "1px solid var(--w70)", "overflow": "hidden" }}>
                            {' '}
                            {V?.repEmpty ? (<div style={{ "padding": "28px 4px", "fontSize": "13px", "color": "var(--g8a8a94)" }}>{"No reports yet. Describe one above."}</div>) : null}
{((V?.repRows) || []).map((r: any, r_i63: number) => (
                              <React.Fragment key={r_i63}>
                                {' '}
                                <div onClick={r?.onClick} onContextMenu={r?.onCtx} style={{ "display": "flex", "alignItems": "center", "gap": "12px", "padding": "11px 14px", "borderBottom": "1px solid var(--w45)", "background": r?.bg, "cursor": "default" }}>
                                  <div style={{ "flex": "1", "minWidth": "0" }}>
                                    {' '}
                                    <div style={{ "fontSize": "13px", "color": "var(--gececf0)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                      {r?.name}
                                    </div>
                                    {' '}
                                    <div style={{ "fontSize": "11.5px", "color": "var(--g8a8a94)", "marginTop": "2px" }}>
                                      {r?.schedule}{" · "}{r?.channelsLabel}
                                    </div>
                                    {' '}
                                  </div>
                                  <div onClick={r?.onToggle} role="switch" aria-checked={r?.tgKnob !== "none"} aria-label={"Enabled " + (r?.name ?? "")} style={{ "width": "30px", "height": "18px", "borderRadius": "9px", "background": r?.tgBg, "position": "relative", "flexShrink": "0", "transition": "background .15s" }}>
                                    <span style={{ "position": "absolute", "top": "2px", "left": "2px", "width": "14px", "height": "14px", "borderRadius": "50%", "background": "#fff", "boxShadow": "0 1px 2px var(--k350)", "transform": r?.tgKnob, "transition": "transform .15s" }} />
                                  </div>
                                </div>
                                {' '}
                              </React.Fragment>
                            ))}
                            {' '}
                          </div>
                          {' '}
                        </div>
                        <BriefingsGroup V={V} />
                        <div>
                          {' '}
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "letterSpacing": "0.05em", "textTransform": "uppercase", "color": "var(--g80808a)", "marginBottom": "8px", "display": "flex", "alignItems": "center" }}>
                            <span style={{ "flex": "1" }}>{"Alerts"}</span>
                            <button aria-label="New alert" onClick={V?.onNewAlert} style={{ "border": "none", "background": "transparent", "color": "var(--g80808a)", "fontSize": "15px", "lineHeight": "1", "cursor": "default", "padding": "0 4px" }}>{"+"}</button>
                          </div>
                          {' '}
                          <div style={{ "fontSize": "12px", "color": "var(--g8a8a94)", "margin": "-2px 0 8px" }}>
                            {"High-signal only. Email alerts are capped at three a day."}
                          </div>
                          {' '}
                          <div style={{ "borderRadius": "10px", "border": "1px solid var(--w70)", "overflow": "hidden" }}>
                            {' '}
                            {((V?.alertRows) || []).map((a: any, a_i64: number) => (
                              <React.Fragment key={a_i64}>
                                {' '}
                                <div onClick={a?.onClick} onContextMenu={a?.onCtx} style={{ "display": "flex", "alignItems": "center", "gap": "12px", "padding": "10px 14px", "borderBottom": "1px solid var(--w45)", "opacity": a?.op, "cursor": "default" }}>
                                  <div style={{ "flex": "1", "minWidth": "0" }}>
                                    <div style={{ "fontSize": "13px", "color": "var(--gececf0)" }}>
                                      {a?.text}
                                    </div>
                                    <div style={{ "fontSize": "11.5px", "color": "var(--g8a8a94)", "marginTop": "2px" }}>
                                      {a?.channelsLabel}
                                    </div>
                                  </div>
                                  <div onClick={a?.onToggle} role="switch" aria-checked={a?.tgKnob !== "none"} aria-label={"Enabled " + (a?.text ?? "")} style={{ "width": "30px", "height": "18px", "borderRadius": "9px", "background": a?.tgBg, "position": "relative", "flexShrink": "0", "transition": "background .15s" }}>
                                    <span style={{ "position": "absolute", "top": "2px", "left": "2px", "width": "14px", "height": "14px", "borderRadius": "50%", "background": "#fff", "boxShadow": "0 1px 2px var(--k350)", "transform": a?.tgKnob, "transition": "transform .15s" }} />
                                  </div>
                                </div>
                                {' '}
                              </React.Fragment>
                            ))}
                            {' '}
                          </div>
                          {' '}
                        </div>
                      </div>
                      <div style={{ "borderRadius": "12px", "border": "1px solid var(--w80)", "background": "var(--w25)", "padding": "18px 20px" }}>
                        {' '}
                        <div style={{ "display": "flex", "alignItems": "flex-start", "gap": "10px" }}>
                          <div style={{ "flex": "1", "minWidth": "0" }}>
                            <div style={{ "fontSize": "16px", "fontWeight": "650" }}>
                              {V?.pv?.name}
                            </div>
                            <div style={{ "fontSize": "11.5px", "color": "var(--g8a8a94)", "marginTop": "3px" }}>
                              {V?.pv?.meta}
                            </div>
                          </div>
                          <button onClick={V?.pv?.onRun} style={{ "height": "26px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12px", "cursor": "default" }}>
                            {"Run now"}
                          </button>
                          <button onClick={V?.pv?.onExpand} title="Read full screen (⌘↩)" style={{ "height": "26px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12px", "cursor": "default" }}>
                            {"Expand"}
                          </button>
                          <ReportRunsButton V={V} />
                          <button onClick={V?.pv?.onExport} style={{ "height": "26px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12px", "cursor": "default" }}>
                            {"Export ▾"}
                          </button>
                        </div>
                        {' '}
                        {/* Reading first: Refine on top, the settings strip, then the report itself (DEC-093 renderer) */}
                        <ReportRefineTop V={V} />
                        <ReportSettingsStrip V={V} />
                        <div onDoubleClick={V?.pv?.onExpand} title="Double-click to read full screen">
                          <ReportView V={V} />
                        </div>
                        <ReportReader V={V} />
                        {V?.pv?.view ? null : ((V?.pv?.sections) || []).map((sec: any, sec_i65: number) => (
                          <div key={sec_i65} style={{ "marginTop": "18px" }}>
                            <div style={{ "fontSize": "12px", "fontWeight": "600", "color": "var(--gc8c8d0)", "marginBottom": "4px" }}>{sec?.title}</div>
                            {((sec?.rows) || []).map((row: any, row_i66: number) => (
                              <div key={row_i66} onClick={row?.onClick} style={{ "display": "flex", "gap": "10px", "padding": "5px 0", "fontSize": "12.5px", "lineHeight": "1.4", "cursor": "default" }} className="dch33">
                                <span style={{ "color": "var(--g5c5c66)" }}>{"—"}</span>
                                <span style={{ "flex": "1", "color": "var(--gdcdce2)" }}>{row?.text}</span>
                                <span style={{ "color": "var(--g74747e)", "whiteSpace": "nowrap" }}>{row?.meta}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                        {' '}
                      </div>
                    </div>
                    {' '}
                  </div>
                  {' '}
                </div>
              </>
            ) : null}
          </main>
        </div>
        {V?.selTbOn ? (
          <>
            <div onMouseDown={V?.stopMD} style={{ "position": "fixed", "left": V?.selX, "top": V?.selY, "transform": "translate(-50%,-100%)", "zIndex": "60", "display": "flex", "gap": "1px", "padding": "3px", "borderRadius": "9px", "background": "var(--pop)", "backdropFilter": "blur(24px) saturate(1.6)", "WebkitBackdropFilter": "blur(24px) saturate(1.6)", "border": "1px solid var(--w120)", "boxShadow": "0 10px 30px var(--k500)", "animation": "pop .14s ease-out" }}>
              {((V?.selActions) || []).map((a: any, a_i67: number) => (
                <React.Fragment key={a_i67}>
                  <button onClick={a?.onClick} style={{ "height": "26px", "padding": "0 9px", "border": "none", "borderRadius": "6px", "background": a?.bg, "color": a?.color, "fontSize": "12px", "whiteSpace": "nowrap", "cursor": "default" }} className="dch34">
                    {a?.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </>
        ) : null}
        {V?.paletteOn ? (
          <>
            <div onClick={V?.closePalette} style={{ "position": "fixed", "inset": "0", "zIndex": "70", "background": "var(--k250)", "animation": "fade .12s ease" }}>
              {' '}
              <div role="dialog" aria-label="Command palette" onClick={V?.stop} style={{ "position": "absolute", "left": "50%", "top": "14%", "transform": "translateX(-50%)", "width": "min(640px,calc(100vw - 60px))", "borderRadius": "14px", "background": V?.sheetBg, "backdropFilter": "blur(40px) saturate(1.8)", "WebkitBackdropFilter": "blur(40px) saturate(1.8)", "border": "1px solid var(--w120)", "boxShadow": "0 30px 80px var(--k600)", "overflow": "hidden", "animation": "pop .15s ease-out" }}>
                {' '}
                <div style={{ "display": "flex", "alignItems": "center", "gap": "10px", "padding": "0 16px", "height": "52px", "borderBottom": "1px solid var(--w70)" }}>
                  <span style={{ "fontSize": "16px", "color": "var(--g8a8a94)" }}>
                    {"⌕"}
                  </span>
                  {V?.pScopeOn ? (
                    <>
                      <span style={{ "fontSize": "11.5px", "padding": "2px 7px", "borderRadius": "5px", "background": "oklch(0.62 0.15 258 / 0.25)", "color": "var(--o86-08-258)" }}>
                        {V?.pScopeLabel}
                      </span>
                    </>
                  ) : null}
                  <input ref={V?.paletteRef} aria-label="Search" value={V?.pq} onChange={V?.onPq} placeholder="Search companies, theses, evidence, firms — or ask a question" style={{ "flex": "1", "height": "100%", "border": "none", "background": "transparent", "outline": "none", "fontSize": "16px", "userSelect": "text" }} />
                  <span style={{ "fontSize": "11px", "color": "var(--g6f6f79)" }}>
                    {"esc"}
                  </span>
                </div>
                {' '}
                <div style={{ "maxHeight": "min(430px,60vh)", "overflow": "auto", "padding": "6px" }}>
                  {' '}
                  {V?.pAnswerOn ? (<AskPanel V={V} />) : null}
                  {((V?.pResultsOn ? V?.pRows : null) || []).map((p: any, p_i68: number) => (
                    <React.Fragment key={p_i68}>
                      {' '}
                      {p?.isHead ? (
                        <>
                          <div style={{ "fontSize": "11px", "fontWeight": "600", "color": "var(--g7c7c86)", "padding": "10px 10px 4px" }}>
                            {p?.label}
                          </div>
                        </>
                      ) : null}
                      {' '}
                      {p?.isRow ? (
                        <>
                          {' '}
                          <div role="option" aria-label={p?.title} onClick={p?.onClick} onMouseEnter={p?.onEnter} style={{ "display": "flex", "alignItems": "center", "gap": "10px", "padding": "7px 10px", "borderRadius": "8px", "background": p?.bg, "cursor": "default" }}>
                            <span style={{ "width": "22px", "height": "22px", "borderRadius": p?.radius, "background": p?.tile, "color": p?.iconColor, "fontSize": "11px", "fontWeight": "700", "display": "grid", "placeItems": "center", "flexShrink": "0" }}>
                              {p?.icon}
                            </span>
                            <div style={{ "flex": "1", "minWidth": "0" }}>
                              <div style={{ "fontSize": "13px", "color": "var(--gececf0)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                {p?.title}
                              </div>
                              <div style={{ "fontSize": "11.5px", "color": "var(--g8a8a94)", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis" }}>
                                {p?.sub}
                              </div>
                            </div>
                            <span style={{ "fontSize": "11px", "color": "var(--g74747e)" }}>
                              {p?.kind}
                            </span>
                          </div>
                          {' '}
                        </>
                      ) : null}
                      {' '}
                    </React.Fragment>
                  ))}
                  {' '}
                  {V?.pEmpty ? (
                    <>
                      <div style={{ "padding": "30px", "textAlign": "center", "fontSize": "13px", "color": "var(--g8a8a94)" }}>
                        {"Nothing in your library matches “"}{V?.pq}{"”."}
                      </div>
                    </>
                  ) : null}
                  {' '}
                </div>
                {' '}
                <div style={{ "display": "flex", "gap": "14px", "padding": "8px 14px", "borderTop": "1px solid var(--w60)", "fontSize": "11px", "color": "var(--g74747e)" }}>
                  <span>
                    {"↑↓ navigate"}
                  </span>
                  <span>
                    {"↵ open"}
                  </span>
                  <span style={{ "flex": "1" }} />
                  <span>
                    {V?.pFooter}
                  </span>
                </div>
                {' '}
              </div>
              {' '}
            </div>
          </>
        ) : null}
        {V?.mAddSource ? (
          <>
            <div onClick={V?.closeModal} style={{ "position": "fixed", "inset": "0", "zIndex": "65", "background": "var(--k350)", "backdropFilter": "blur(3px)", "animation": "fade .15s ease", "display": "grid", "placeItems": "center", "padding": "24px" }}>
              <div role="dialog" aria-label="Add source" onClick={V?.stop} style={{ "width": "min(620px,100%)", "maxHeight": "calc(100vh - 48px)", "overflow": "auto", "borderRadius": "16px", "background": V?.sheetBg, "backdropFilter": "blur(40px) saturate(1.8)", "WebkitBackdropFilter": "blur(40px) saturate(1.8)", "border": "1px solid var(--w120)", "boxShadow": "0 30px 90px var(--k600)", "animation": "pop .18s ease-out" }}>
                {' '}
                <div style={{ "padding": "20px 22px 0" }}>
                  {' '}
                  <div style={{ "display": "flex", "alignItems": "center", "gap": "10px" }}>
                    <div style={{ "flex": "1", "fontSize": "16px", "fontWeight": "650" }}>
                      {V?.addTitle}
                    </div>
                    <div style={{ "display": "flex", "gap": "2px", "padding": "2px", "background": "var(--w60)", "borderRadius": "7px" }}>
                      {((V?.onceSegs) || []).map((g: any, g_i69: number) => (
                        <React.Fragment key={g_i69}>
                          <button onClick={g?.onClick} style={{ "height": "22px", "padding": "0 10px", "border": "none", "borderRadius": "5px", "background": g?.bg, "color": g?.color, "boxShadow": g?.shadow, "fontSize": "11.5px", "cursor": "default" }}>
                            {g?.label}
                          </button>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  {' '}
                  <input ref={V?.addRef} value={V?.addQ} onChange={V?.onAddQ} aria-label="Source or link" placeholder={V?.addPlaceholder} style={{ "width": "100%", "height": "46px", "marginTop": "14px", "borderRadius": "10px", "border": "1px solid rgba(140,165,255,0.45)", "background": "var(--k250)", "padding": "0 14px", "fontSize": "15px", "outline": "none", "boxShadow": "0 0 0 3px oklch(0.62 0.15 258 / 0.18)", "userSelect": "text" }} />
                  {' '}
                  <div style={{ "display": "flex", "gap": "6px", "marginTop": "9px", "flexWrap": "wrap" }}>
                    {((V?.addExamples) || []).map((x: any, x_i70: number) => (
                      <React.Fragment key={x_i70}>
                        <span onClick={x?.onClick} style={{ "fontFamily": "ui-monospace,'SF Mono',Menlo,monospace", "fontSize": "11px", "color": "var(--g9a9aa4)", "padding": "3px 7px", "borderRadius": "5px", "background": "var(--w50)", "cursor": "default" }} className="dch35">
                          {x?.label}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                  {' '}
                </div>
                {' '}
                {V?.addIdle ? (
                  <>
                    {' '}
                    <div style={{ "padding": "26px 22px 22px", "fontSize": "12.5px", "color": "var(--g8a8a94)", "lineHeight": "1.55" }}>
                      {"I’ll work out what it is, show you what it has published recently, and suggest what to watch. You decide the rest. Checks run from this Mac."}
                    </div>
                    {' '}
                  </>
                ) : null}
                {' '}
                {V?.addDetecting ? (
                  <>
                    {' '}
                    <div style={{ "padding": "20px 22px 24px", "display": "flex", "flexDirection": "column", "gap": "10px" }}>
                      <div style={{ "fontSize": "12px", "color": "var(--g9a9aa4)" }}>
                        {"Detecting source…"}
                      </div>
                      <div style={{ "display": "flex", "gap": "12px", "alignItems": "center" }}>
                        <div style={{ "width": "38px", "height": "38px", "borderRadius": "9px", "background": "var(--w70)", "animation": "pulse 1s infinite" }} />
                        <div style={{ "flex": "1", "display": "flex", "flexDirection": "column", "gap": "6px" }}>
                          <div style={{ "height": "12px", "width": "40%", "borderRadius": "4px", "background": "var(--w70)", "animation": "pulse 1s infinite" }} />
                          <div style={{ "height": "10px", "width": "25%", "borderRadius": "4px", "background": "var(--w50)", "animation": "pulse 1s infinite" }} />
                        </div>
                      </div>
                      <div style={{ "height": "10px", "width": "80%", "borderRadius": "4px", "background": "var(--w50)", "animation": "pulse 1s infinite" }} />
                      <div style={{ "height": "10px", "width": "65%", "borderRadius": "4px", "background": "var(--w50)", "animation": "pulse 1s infinite" }} />
                    </div>
                    {' '}
                  </>
                ) : null}
                {' '}
                {V?.addFound ? (
                  <>
                    {' '}
                    <div style={{ "padding": "18px 22px 0", "animation": "fade .2s ease" }}>
                      {' '}
                      <div style={{ "padding": "14px", "borderRadius": "11px", "background": "var(--w40)", "border": "1px solid var(--w80)" }}>
                        {' '}
                        <div style={{ "display": "flex", "gap": "12px", "alignItems": "center" }}>
                          <span style={{ "width": "38px", "height": "38px", "borderRadius": "9px", "background": V?.det?.tile, "color": "#15161a", "fontSize": "16px", "fontWeight": "700", "display": "grid", "placeItems": "center" }}>
                            {V?.det?.initial}
                          </span>
                          <div style={{ "flex": "1", "minWidth": "0" }}>
                            <div style={{ "fontSize": "11px", "color": "var(--o78-12-155)" }}>
                              {"✓ Detected"}
                            </div>
                            <div style={{ "fontSize": "15px", "fontWeight": "600", "color": "var(--gf0f0f3)" }}>
                              {V?.det?.name}
                            </div>
                            <div style={{ "fontSize": "12px", "color": "var(--g9a9aa4)" }}>
                              {V?.det?.metaLine}
                            </div>
                          </div>
                        </div>
                        {' '}
                        <div style={{ "marginTop": "12px", "display": "flex", "flexDirection": "column", "gap": "4px" }}>
                          {((V?.det?.postsV) || []).map((p: any, p_i71: number) => (
                            <React.Fragment key={p_i71}>
                              <div style={{ "fontSize": "12.5px", "color": "var(--gc8c8d0)", "display": "flex", "gap": "8px" }}>
                                <span style={{ "color": "var(--g5c5c66)" }}>
                                  {"—"}
                                </span>
                                {p?.t}
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                        {' '}
                        <div style={{ "display": "flex", "gap": "5px", "marginTop": "12px", "flexWrap": "wrap" }}>
                          {((V?.det?.relatedV) || []).map((t: any, t_i72: number) => (
                            <React.Fragment key={t_i72}>
                              <span style={{ "height": "20px", "padding": "0 7px", "borderRadius": "5px", "background": "var(--w60)", "color": "var(--gb8b8c0)", "fontSize": "11px", "display": "inline-flex", "alignItems": "center" }}>
                                {t?.t}
                              </span>
                            </React.Fragment>
                          ))}
                        </div>
                        {' '}
                      </div>
                      {' '}
                      {V?.addWatching ? (
                        <>
                          {' '}
                          <div style={{ "fontSize": "13px", "fontWeight": "600", "margin": "18px 0 8px" }}>
                            {"What should I watch?"}
                          </div>
                          {' '}
                          <div style={{ "display": "flex", "flexDirection": "column", "gap": "5px" }}>
                            {((V?.modeOpts) || []).map((o: any, o_i73: number) => (
                              <React.Fragment key={o_i73}>
                                <div onClick={o?.onClick} style={{ "display": "flex", "gap": "10px", "alignItems": "flex-start", "padding": "9px 11px", "borderRadius": "9px", "border": `1px solid ${o?.border ?? ""}`, "background": o?.bg, "cursor": "default" }}>
                                  <span style={{ "width": "14px", "height": "14px", "borderRadius": "50%", "border": `1.5px solid ${o?.ring ?? ""}`, "marginTop": "1px", "display": "grid", "placeItems": "center", "flexShrink": "0" }}>
                                    <span style={{ "width": "6px", "height": "6px", "borderRadius": "50%", "background": o?.dot }} />
                                  </span>
                                  <div>
                                    <div style={{ "fontSize": "13px", "color": "var(--gececf0)" }}>
                                      {o?.label}
                                    </div>
                                    <div style={{ "fontSize": "11.5px", "color": "var(--g8a8a94)", "marginTop": "1px" }}>
                                      {o?.desc}
                                    </div>
                                  </div>
                                </div>
                              </React.Fragment>
                            ))}
                          </div>
                          {' '}
                          {V?.addCustom ? (
                            <>
                              {' '}
                              <textarea value={V?.addInstr} onChange={V?.onAddInstr} rows={2} placeholder="Only show me posts about infrastructure, developer tooling, and AI applications." style={{ "width": "100%", "marginTop": "8px", "resize": "none", "borderRadius": "9px", "border": "1px solid var(--w120)", "background": "var(--k250)", "padding": "10px 12px", "fontSize": "13px", "lineHeight": "1.45", "outline": "none", "userSelect": "text" }} />
                              {' '}
                            </>
                          ) : null}
                          {' '}
                          <div style={{ "display": "grid", "gridTemplateColumns": "auto minmax(0,1fr)", "gap": "10px 14px", "alignItems": "center", "marginTop": "16px", "fontSize": "12px" }}>
                            <span style={{ "color": "var(--g9a9aa4)" }}>
                              {"Check"}
                            </span>
                            <div style={{ "display": "flex", "gap": "2px", "padding": "2px", "background": "var(--w50)", "borderRadius": "7px", "justifySelf": "start" }}>
                              {((V?.addFreqSegs) || []).map((g: any, g_i74: number) => (
                                <React.Fragment key={g_i74}>
                                  <button onClick={g?.onClick} style={{ "height": "22px", "padding": "0 10px", "border": "none", "borderRadius": "5px", "background": g?.bg, "color": g?.color, "boxShadow": g?.shadow, "fontSize": "11.5px", "cursor": "default" }}>
                                    {g?.label}
                                  </button>
                                </React.Fragment>
                              ))}
                            </div>
                            <span style={{ "color": "var(--g9a9aa4)" }}>
                              {"Connect to"}
                            </span>
                            <div style={{ "display": "flex", "gap": "5px", "flexWrap": "wrap" }}>
                              {((V?.addThChips) || []).map((t: any, t_i75: number) => (
                                <React.Fragment key={t_i75}>
                                  <span onClick={t?.onClick} style={{ "height": "22px", "padding": "0 8px", "borderRadius": "5px", "background": t?.bg, "color": t?.color, "fontSize": "11.5px", "display": "inline-flex", "alignItems": "center", "cursor": "default" }}>
                                    {t?.label}
                                  </span>
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                          {' '}
                        </>
                      ) : null}
                      {' '}
                    </div>
                    {' '}
                  </>
                ) : null}
                {' '}
                {V?.addCardOn ? (<AddSourceCard V={V} />) : null}
                {V?.addHasError ? (<div role="alert" style={{ "padding": "12px 22px 0", "fontSize": "12px", "color": "#ff8a80" }}>{V?.addError}</div>) : null}
                <div style={{ "display": "flex", "alignItems": "center", "gap": "8px", "padding": "16px 22px 18px", "marginTop": "10px" }}>
                  <span style={{ "flex": "1", "fontSize": "11px", "color": "var(--g74747e)" }}>
                    {"Stored in your local library"}
                  </span>
                  <button onClick={V?.closeModal} style={{ "height": "28px", "padding": "0 12px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12.5px", "cursor": "default" }}>
                    {"Cancel"}
                  </button>
                  <button onClick={V?.onStartWatching} disabled={V?.startDisabled} style={{ "height": "28px", "padding": "0 14px", "borderRadius": "7px", "border": "none", "background": V?.startBg, "color": "#fff", "fontSize": "12.5px", "fontWeight": "500", "cursor": "default" }}>
                    {V?.startLabel}
                  </button>
                </div>
                {' '}
              </div>
            </div>
          </>
        ) : null}
        {V?.mThought ? (
          <>
            <div onClick={V?.closeModal} style={{ "position": "fixed", "inset": "0", "zIndex": "65", "background": "var(--k300)", "backdropFilter": "blur(3px)", "animation": "fade .15s ease" }}>
              {' '}
              <div role="dialog" aria-label="Add thought" onClick={V?.stop} style={{ "position": "absolute", "left": "50%", "top": "16%", "transform": "translateX(-50%)", "width": "min(600px,calc(100vw - 48px))", "borderRadius": "16px", "background": V?.sheetBg, "backdropFilter": "blur(40px) saturate(1.8)", "WebkitBackdropFilter": "blur(40px) saturate(1.8)", "border": "1px solid var(--w120)", "boxShadow": "0 30px 90px var(--k600)", "animation": "pop .16s ease-out", "overflow": "hidden" }}>
                {' '}
                <textarea ref={V?.thoughtRef} value={V?.thought} onChange={V?.onThought} placeholder="What are you thinking?" rows={4} style={{ "display": "block", "width": "100%", "border": "none", "background": "transparent", "outline": "none", "resize": "none", "padding": "22px 24px 10px", "fontSize": "19px", "lineHeight": "1.45", "letterSpacing": "-0.005em", "userSelect": "text" }} />
                {' '}
                {V?.thHas ? (
                  <>
                    {' '}
                    <div style={{ "margin": "0 16px", "padding": "12px 14px", "borderRadius": "11px", "background": "var(--w40)", "border": "1px solid var(--w70)", "animation": "fade .2s ease" }}>
                      {' '}
                      <div style={{ "display": "grid", "gridTemplateColumns": "118px minmax(0,1fr)", "gap": "9px 12px", "alignItems": "center", "fontSize": "12.5px" }}>
                        <span style={{ "color": "var(--g8a8a94)" }}>
                          {"Add to thesis"}
                        </span>
                        <span onClick={V?.onThChange} role="button" aria-label={"Thesis: " + (V?.thPath ?? "")} style={{ "justifySelf": "start", "display": "inline-flex", "alignItems": "center", "gap": "6px", "height": "24px", "padding": "0 9px", "borderRadius": "6px", "background": "oklch(0.62 0.15 258 / 0.2)", "color": "var(--o88-07-258)", "cursor": "default" }}>
                          <span style={{ "fontSize": "9px" }}>
                            {"◆"}
                          </span>
                          {V?.thPath}{" "}
                          <span style={{ "color": "var(--o75-08-258)" }}>
                            {"▾"}
                          </span>
                        </span>
                        <span style={{ "color": "var(--g8a8a94)" }}>
                          {"Related companies"}
                        </span>
                        <div style={{ "display": "flex", "gap": "5px", "flexWrap": "wrap" }}>
                          {((V?.thCosV) || []).map((c: any, c_i76: number) => (
                            <React.Fragment key={c_i76}>
                              <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "5px", "height": "24px", "padding": "0 4px 0 6px", "borderRadius": "6px", "background": "var(--w60)", "color": "var(--gd8d8de)" }}>
                                <span style={{ "width": "12px", "height": "12px", "borderRadius": "3px", "background": c?.tile }} />
                                {c?.name}
                                <span onClick={c?.onRemove} style={{ "color": "var(--g80808a)", "padding": "0 3px", "cursor": "default" }}>
                                  {"✕"}
                                </span>
                              </span>
                            </React.Fragment>
                          ))}
                          {V?.thNoCos ? (
                            <>
                              <span style={{ "color": "var(--g74747e)" }}>
                                {"None detected"}
                              </span>
                            </>
                          ) : null}
                        </div>
                        <span style={{ "color": "var(--g8a8a94)" }}>
                          {"Create as"}
                        </span>
                        <div style={{ "display": "flex", "gap": "2px", "padding": "2px", "background": "var(--w50)", "borderRadius": "7px", "justifySelf": "start" }}>
                          {((V?.thTypeSegs) || []).map((g: any, g_i77: number) => (
                            <React.Fragment key={g_i77}>
                              <button onClick={g?.onClick} style={{ "height": "22px", "padding": "0 9px", "border": "none", "borderRadius": "5px", "background": g?.bg, "color": g?.color, "boxShadow": g?.shadow, "fontSize": "11.5px", "cursor": "default" }}>
                                {g?.label}
                              </button>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                      {' '}
                    </div>
                    {' '}
                  </>
                ) : null}
                {' '}
                <div style={{ "display": "flex", "alignItems": "center", "gap": "8px", "padding": "14px 18px 16px" }}>
                  <button onClick={V?.onDictate} title="Dictate" style={{ "height": "28px", "padding": "0 10px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": V?.dictBg, "fontSize": "12px", "cursor": "default", "display": "flex", "alignItems": "center", "gap": "6px" }}>
                    <span style={{ "width": "7px", "height": "7px", "borderRadius": "50%", "background": V?.dictDot }} />
                    {V?.dictLabel}
                  </button>
                  <span style={{ "flex": "1", "fontSize": "11.5px", "color": "var(--g74747e)" }}>
                    {V?.thHint}
                  </span>
                  <button onClick={V?.closeModal} style={{ "height": "28px", "padding": "0 12px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12.5px", "cursor": "default" }}>
                    {"Cancel"}
                  </button>
                  <button onClick={V?.saveThought} style={{ "height": "28px", "padding": "0 14px", "borderRadius": "7px", "border": "none", "background": V?.thSaveBg, "color": "#fff", "fontSize": "12.5px", "fontWeight": "500", "cursor": "default" }}>
                    {"Save thought ⌘↵"}
                  </button>
                </div>
                {' '}
              </div>
              {' '}
            </div>
          </>
        ) : null}
        {V?.mWhy ? (
          <>
            <div onClick={V?.closeModal} style={{ "position": "fixed", "inset": "0", "zIndex": "65", "background": "var(--k300)", "animation": "fade .15s ease", "display": "grid", "placeItems": "center" }}>
              <div role="dialog" aria-label="Why you’re seeing this" onClick={V?.stop} style={{ "width": "420px", "borderRadius": "14px", "background": V?.sheetBg, "backdropFilter": "blur(40px)", "WebkitBackdropFilter": "blur(40px)", "border": "1px solid var(--w120)", "boxShadow": "0 30px 80px var(--k600)", "padding": "20px", "animation": "pop .16s ease-out" }}>
                {' '}
                <div style={{ "fontSize": "15px", "fontWeight": "650" }}>
                  {"Why you’re seeing this"}
                </div>
                {' '}
                <div style={{ "fontSize": "12.5px", "color": "var(--g9a9aa4)", "marginTop": "4px" }}>
                  {V?.whyTitle}
                </div>
                {' '}
                <div style={{ "display": "flex", "flexDirection": "column", "gap": "8px", "marginTop": "14px" }}>
                  {((V?.whyReasons) || []).map((w: any, w_i78: number) => (
                    <React.Fragment key={w_i78}>
                      <div style={{ "display": "flex", "gap": "9px", "fontSize": "13px", "color": "var(--gdcdce2)", "lineHeight": "1.4" }}>
                        <span style={{ "color": "var(--o78-12-155)" }}>
                          {"✓"}
                        </span>
                        {w?.t}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
                {' '}
                <div style={{ "display": "flex", "gap": "6px", "marginTop": "18px", "flexWrap": "wrap" }}>
                  {((V?.whyActions) || []).map((a: any, a_i79: number) => (
                    <React.Fragment key={a_i79}>
                      <button onClick={a?.onClick} style={{ "height": "26px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12px", "cursor": "default" }}>
                        {a?.label}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
                {' '}
              </div>
            </div>
          </>
        ) : null}
        {V?.mSettings ? (
          <>
            <div onClick={V?.closeModal} style={{ "position": "fixed", "inset": "0", "zIndex": "65", "background": "var(--k350)", "backdropFilter": "blur(3px)", "animation": "fade .15s ease", "display": "grid", "placeItems": "center", "padding": "24px" }}>
              <div role="dialog" aria-label="Settings" onClick={V?.stop} style={{ "width": "min(820px,100%)", "height": "min(580px,calc(100vh - 48px))", "display": "flex", "borderRadius": "14px", "overflow": "hidden", "background": V?.sheetBg, "backdropFilter": "blur(40px) saturate(1.8)", "WebkitBackdropFilter": "blur(40px) saturate(1.8)", "border": "1px solid var(--w120)", "boxShadow": "0 30px 90px var(--k600)", "animation": "pop .18s ease-out" }}>
                <div style={{ "width": "200px", "flexShrink": "0", "padding": "16px 10px", "borderRight": "1px solid var(--w70)", "background": "var(--w20)", "display": "flex", "flexDirection": "column", "gap": "1px" }}>
                  <div style={{ "fontSize": "11px", "fontWeight": "600", "color": "var(--g7c7c86)", "padding": "0 8px 8px" }}>
                    {"Settings"}
                  </div>
                  {((V?.setCats) || []).map((c: any, c_i80: number) => (
                    <React.Fragment key={c_i80}>
                      <div onClick={c?.onClick} style={{ "height": "28px", "display": "flex", "alignItems": "center", "padding": "0 9px", "borderRadius": "6px", "background": c?.bg, "color": c?.color, "fontSize": "13px", "cursor": "default" }}>
                        {c?.label}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ "flex": "1", "minWidth": "0", "overflow": "auto", "padding": "22px 26px" }}>
                  {' '}
                  <div style={{ "fontSize": "18px", "fontWeight": "650", "marginBottom": "16px" }}>
                    {V?.settingsTab}
                  </div>
                  {' '}
                  {((V?.setRows) || []).map((row: any, row_i81: number) => (
                    <React.Fragment key={row_i81}>
                      {' '}
                      <div style={{ "display": "flex", "alignItems": "center", "gap": "16px", "padding": "12px 0", "borderBottom": "1px solid var(--w60)" }}>
                        <div style={{ "flex": "1", "minWidth": "0" }}>
                          <div style={{ "fontSize": "13px", "color": "var(--gececf0)" }}>
                            {row?.label}
                          </div>
                          <div style={{ "fontSize": "11.5px", "color": "var(--g8a8a94)", "marginTop": "2px", "lineHeight": "1.4" }}>
                            {row?.desc}
                          </div>
                        </div>
                        {row?.isToggle ? (
                          <>
                            <div onClick={row?.onClick} role="switch" aria-checked={row?.tgKnob !== "none"} aria-label={row?.label} style={{ "width": "30px", "height": "18px", "borderRadius": "9px", "background": row?.tgBg, "position": "relative", "flexShrink": "0", "cursor": "default" }}>
                              <span style={{ "position": "absolute", "top": "2px", "left": "2px", "width": "14px", "height": "14px", "borderRadius": "50%", "background": "#fff", "transform": row?.tgKnob, "transition": "transform .15s" }} />
                            </div>
                          </>
                        ) : null}
                        {row?.isSeg ? (
                          <>
                            <div style={{ "display": "flex", "gap": "2px", "padding": "2px", "background": "var(--w50)", "borderRadius": "7px", "flexShrink": "0" }}>
                              {((row?.segs) || []).map((g: any, g_i82: number) => (
                                <React.Fragment key={g_i82}>
                                  <button onClick={g?.onClick} style={{ "height": "22px", "padding": "0 10px", "border": "none", "borderRadius": "5px", "background": g?.bg, "color": g?.color, "boxShadow": g?.shadow, "fontSize": "11.5px", "cursor": "default" }}>
                                    {g?.label}
                                  </button>
                                </React.Fragment>
                              ))}
                            </div>
                          </>
                        ) : null}
                        {row?.isSlider ? (
                          <>
                            <input type="range" min={0} max={100} value={row?.value} onChange={row?.onChange} style={{ "width": "160px", "accentColor": "oklch(0.62 0.15 258)" }} />
                          </>
                        ) : null}
                        {row?.isKey ? (
                          <>
                            <span style={{ "fontFamily": "ui-monospace,'SF Mono',Menlo,monospace", "fontSize": "11.5px", "padding": "3px 8px", "borderRadius": "5px", "background": "var(--w70)", "color": "var(--gd8d8de)" }}>
                              {row?.key}
                            </span>
                          </>
                        ) : null}
                        {row?.isValue ? (
                          <>
                            <span style={{ "fontSize": "12.5px", "color": "var(--gc8c8d0)", "fontVariantNumeric": "tabular-nums" }}>
                              {row?.value}
                            </span>
                          </>
                        ) : null}
                        {row?.isButton ? (
                          <>
                            <button onClick={row?.onClick} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w50)", "fontSize": "12px", "cursor": "default" }}>
                              {row?.btn}
                            </button>
                          </>
                        ) : null}
                        {row?.isBookmarklet ? (
                          <a href={row?.href} onClick={(e: any) => e.preventDefault()} draggable={true} title="Drag to your bookmarks bar" style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "1px solid var(--w100)", "background": "var(--w50)", "fontSize": "12px", "display": "inline-flex", "alignItems": "center", "color": "var(--ge8e8ec)", "whiteSpace": "nowrap" }}>{"Send to Research Workspace"}</a>
                        ) : null}
                      </div>
                      {' '}
                    </React.Fragment>
                  ))}
                  {' '}
                  {V?.setShowInstr ? (
                    <>
                      {' '}
                      <div style={{ "marginTop": "4px" }}>
                        {' '}
                        <div style={{ "fontSize": "13px", "color": "var(--gececf0)" }}>
                          {"General research instruction"}
                        </div>
                        {' '}
                        <div style={{ "fontSize": "11.5px", "color": "var(--g8a8a94)", "marginTop": "2px" }}>
                          {"Shapes what gets captured, how it’s ranked, and which connections are suggested."}
                        </div>
                        {' '}
                        <textarea value={V?.researchInstr} onChange={V?.onResearch} rows={5} style={{ "width": "100%", "marginTop": "10px", "resize": "vertical", "borderRadius": "9px", "border": "1px solid var(--w100)", "background": "var(--k250)", "padding": "11px 13px", "fontSize": "13px", "lineHeight": "1.55", "outline": "none", "userSelect": "text" }} />
                        {' '}
                      </div>
                      {' '}
                    </>
                  ) : null}
                  {' '}
                  {V?.setShowAccounts ? (
                    <>
                      <AccountsPane V={V} />
                    </>
                  ) : null}
                  {V?.setShowLocal ? (
                    <>
                      {' '}
                      <div style={{ "marginTop": "18px", "padding": "14px", "borderRadius": "10px", "background": "var(--w35)", "border": "1px solid var(--w70)", "fontSize": "12.5px", "color": "var(--ga6a6b0)", "lineHeight": "1.55" }}>
                        {V?.privacyCopy}
                      </div>
                      {' '}
                    </>
                  ) : null}
                  {' '}
                </div>
              </div>
            </div>
          </>
        ) : null}
        {V?.mCustomize ? (
          <>
            <div onClick={V?.closeModal} style={{ "position": "fixed", "inset": "0", "zIndex": "65", "background": "var(--k300)", "backdropFilter": "blur(3px)", "animation": "fade .15s ease" }}>
              {' '}
              <div role="dialog" aria-label="Customize" onClick={V?.stop} style={{ "position": "absolute", "left": "50%", "top": "18%", "transform": "translateX(-50%)", "width": "min(560px,calc(100vw - 48px))", "borderRadius": "16px", "background": V?.sheetBg, "backdropFilter": "blur(40px) saturate(1.8)", "WebkitBackdropFilter": "blur(40px) saturate(1.8)", "border": "1px solid var(--w120)", "boxShadow": "0 30px 90px var(--k600)", "animation": "pop .16s ease-out", "padding": "20px 22px 18px" }}>
                {' '}
                <div style={{ "fontSize": "15px", "fontWeight": "650" }}>
                  {V?.cuTitle}
                </div>
                {' '}
                <div style={{ "fontSize": "12.5px", "color": "var(--g8a8a94)", "marginTop": "3px" }}>
                  {"Say what you want to see first. Only the layout changes; your data stays the same."}
                </div>
                {' '}
                <textarea ref={V?.cuRef} aria-label="Describe the layout" value={V?.cuDraft} onChange={V?.onCuDraft} rows={2} placeholder="Show pricing changes at the top" style={{ "width": "100%", "marginTop": "14px", "resize": "none", "borderRadius": "10px", "border": "1px solid var(--w120)", "background": "var(--k250)", "padding": "11px 13px", "fontSize": "14px", "lineHeight": "1.45", "outline": "none", "userSelect": "text" }} />
                {' '}
                <div style={{ "display": "flex", "gap": "6px", "flexWrap": "wrap", "marginTop": "8px" }}>
                  {((V?.cuExamples) || []).map((x: any, x_i83: number) => (
                    <React.Fragment key={x_i83}>
                      <span onClick={x?.onClick} style={{ "fontSize": "11.5px", "color": "var(--g9a9aa4)", "padding": "3px 8px", "borderRadius": "5px", "background": "var(--w50)", "cursor": "default" }} className="dch36">
                        {x?.label}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
                {' '}
                <div style={{ "display": "flex", "alignItems": "center", "gap": "8px", "marginTop": "18px" }}>
                  <span onClick={V?.onCuReset} style={{ "flex": "1", "fontSize": "12px", "color": "var(--g8a8a94)", "cursor": "default" }}>
                    {V?.cuResetLabel}
                  </span>
                  <button onClick={V?.closeModal} style={{ "height": "28px", "padding": "0 12px", "borderRadius": "7px", "border": "1px solid var(--w100)", "background": "var(--w40)", "fontSize": "12.5px", "cursor": "default" }}>
                    {"Cancel"}
                  </button>
                  <button onClick={V?.onCuApply} disabled={V?.cuBusy} style={{ "height": "28px", "padding": "0 14px", "borderRadius": "7px", "border": "none", "background": "oklch(0.6 0.15 258)", "color": "#fff", "fontSize": "12.5px", "fontWeight": "500", "cursor": "default" }}>
                    {V?.cuApplyLabel}
                  </button>
                </div>
                {V?.cuHasError ? (<div role="alert" style={{ "marginTop": "10px", "fontSize": "12px", "color": "#ff8a80" }}>{V?.cuError}</div>) : null}
                {' '}
              </div>
              {' '}
            </div>
          </>
        ) : null}
        {V?.menuOn ? (
          <>
            <div onClick={V?.closeMenu} onContextMenu={V?.closeMenuCtx} style={{ "position": "fixed", "inset": "0", "zIndex": "80" }}>
              {' '}
              <div role="menu" onClick={V?.stop} style={{ "position": "fixed", "left": V?.menuX, "top": V?.menuY, "minWidth": "220px", "maxWidth": "300px", "padding": "5px", "borderRadius": "10px", "background": "var(--pop)", "backdropFilter": "blur(30px) saturate(1.7)", "WebkitBackdropFilter": "blur(30px) saturate(1.7)", "border": "1px solid var(--w120)", "boxShadow": "0 14px 40px var(--k550)", "animation": "pop .12s ease-out" }}>
                {' '}
                {((V?.menuItems) || []).map((m: any, m_i84: number) => (
                  <React.Fragment key={m_i84}>
                    {' '}
                    {m?.div ? (
                      <>
                        <div style={{ "height": "1px", "background": "var(--w80)", "margin": "4px 6px" }} />
                      </>
                    ) : null}
                    {' '}
                    {m?.head ? (
                      <>
                        <div style={{ "fontSize": "11px", "color": "var(--g7c7c86)", "padding": "5px 9px 3px" }}>
                          {m?.label}
                        </div>
                      </>
                    ) : null}
                    {' '}
                    {m?.row ? (
                      <>
                        {' '}
                        <div role="menuitem" aria-label={m?.label} onClick={m?.onClick} style={{ "display": "flex", "alignItems": "center", "gap": "8px", "height": "26px", "padding": "0 9px", "borderRadius": "5px", "fontSize": "13px", "color": m?.color, "cursor": "default" }} className="dch37">
                          <span style={{ "width": "12px", "fontSize": "11px" }}>
                            {m?.check}
                          </span>
                          <span style={{ "flex": "1", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis", "paddingLeft": m?.pad }}>
                            {m?.label}
                          </span>
                          <span style={{ "fontSize": "11px", "opacity": "0.6" }}>
                            {m?.hint}
                          </span>
                        </div>
                        {' '}
                      </>
                    ) : null}
                    {' '}
                  </React.Fragment>
                ))}
                {' '}
              </div>
              {' '}
            </div>
          </>
        ) : null}
        <Overlays V={V} />
        {V?.toastOn ? (
          <>
            <div role="status" aria-label="Notification" style={{ "position": "fixed", "left": "50%", "bottom": "28px", "transform": "translateX(-50%)", "zIndex": "90", "display": "flex", "alignItems": "center", "gap": "14px", "padding": "9px 10px 9px 16px", "borderRadius": "11px", "background": "var(--pop)", "backdropFilter": "blur(30px)", "WebkitBackdropFilter": "blur(30px)", "border": "1px solid var(--w120)", "boxShadow": "0 14px 40px var(--k500)", "animation": "rise .2s ease-out", "fontSize": "13px", "whiteSpace": "nowrap" }}>
              <span style={{ "color": "var(--gececf0)" }}>
                {V?.toastMsg}
              </span>
              {V?.toastHasAct ? (
                <>
                  <button onClick={V?.toastAct} style={{ "height": "24px", "padding": "0 10px", "borderRadius": "6px", "border": "none", "background": "var(--w100)", "color": "var(--o86-09-258)", "fontSize": "12.5px", "cursor": "default" }}>
                    {V?.toastActLabel}
                  </button>
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
