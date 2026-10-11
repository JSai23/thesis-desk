// One renderer, one look (See DEC-093): a report run's content → email-safe HTML (inline styles, table layout, no
// <style>, no SVG, no scripts) shown unchanged in the app's report view (sandboxed iframe) and in Gmail, plus the
// Markdown version. Pure functions of the stored run content: charts are computed here from the rows (no model).
import type { ReportStyle } from '../../shared/schemas/report-def'

export interface Deal { company: string; round: string | null; amountUsd: number | null; amountText: string | null; leads: string[] }
export interface RowOut {
  n?: number; text: string; quote: string; source: string; url: string | null; date: number | null; documentId: string | null; itemId: string | null; evidenceId: string | null
  citations: string[]; ref: { type: string; id: string } | null
  /** DEC-093: the article's title and lead image, and what charts need */
  title?: string; image?: string | null; kind?: string | null; deal?: Deal | null; stance?: 'support' | 'contra' | null; removed?: boolean
}
export interface Sentence { text: string; citations: number[] }
export interface RunSection { id: string; title: string; style?: ReportStyle; rows: RowOut[]; bullets?: { text: string; citations: number[] }[]; paragraph?: Sentence[]
  /** Backlog "Reports go deeper": a paragraph on a standout company from its other stored facts (`background`, numbered after the rows) */
  deepDives?: { subject: string; sentences: Sentence[] }[]; background?: RowOut[] }
export interface RunContent { name: string; at: number; style?: ReportStyle; lede?: Sentence[]; sections: RunSection[] }

export const FOOTER = 'Built on this Mac from your sources, theses and notes.'

// ---------------------------------------------------------------- palette (design/prototype light theme, as hex for mail)
const C = {
  page: '#eef0f4', paper: '#ffffff', ink: '#242421', body: '#41413a', muted: '#79796f', faint: '#9a9a92', line: '#e8e6de', wash: '#f7f7f4',
  accent: '#427fd8', accentSoft: '#e4efff', green: '#349d62', greenSoft: '#d7f4e0', amber: '#d28425', amberSoft: '#ffead3'
}
const TILES = [['#dae9ff', '#345687'], ['#d6efde', '#23643f'], ['#f9e4d0', '#774914'], ['#ebe3fc', '#5d4980'], ['#ceeff1', '#006469'], ['#f3e7ce', '#6c5005']]
const SANS = '-apple-system,Helvetica,Arial,sans-serif'
const SERIF = 'Georgia,serif'

// ---------------------------------------------------------------- helpers
export const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
/** http(s) links only; anything else renders as plain text */
const safeUrl = (u: string | null | undefined): string | null => (u && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null)
const safeImg = (u: string | null | undefined): string | null => (u && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null)
export const fmtDate = (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
const longDate = (t: number) => new Date(t).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const clip = (s: string, n: number) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' }
const a = (url: string | null, inner: string, style: string) => { const u = safeUrl(url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" style="${style}">${inner}</a>` : inner }
const img = (src: string, alt: string, style: string, width?: number) => `<img src="${esc(src)}" alt="${esc(alt)}"${width ? ` width="${width}"` : ''} referrerpolicy="no-referrer" style="display:block;border:0;outline:none;${style}">`
const hash = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h }
const headline = (r: RowOut) => clip(r.title || r.text, 110)
const meta = (r: RowOut) => esc([r.removed ? 'Source removed' : r.source, fmtDate(r.date)].filter(Boolean).join(' · '))
export const money = (n: number) => n >= 1e9 ? `$${+(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : n >= 1e6 ? `$${+(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`
const rowUrl = (r: RowOut) => (r.removed ? null : r.url)
const styleOf = (s: RunSection, c: RunContent): ReportStyle => s.style || c.style || 'digest'

/** Typographic placeholder for a row without a picture: the source's initial on a tile from the prototype palette. */
function monogram(r: RowOut, height: number, big = false): string {
  const [bg, fg] = TILES[hash(r.source || '?') % TILES.length]
  const letter = esc(((r.source || '?').replace(/^the\s+/i, '').match(/[\p{L}\p{N}]/u)?.[0] || '•').toUpperCase())
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td align="center" valign="middle" height="${height}" style="height:${height}px;background:${bg};color:${fg};font-family:${SERIF};font-size:${big ? 64 : 40}px;line-height:1;text-align:center">${letter}${big ? `<div style="font-family:${SANS};font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-top:10px;opacity:.8">${esc(clip(r.source, 40))}</div>` : ''}</td></tr></table>`
}

/** [n] markers after a sentence, each linking to its row's article */
function cites(ns: number[], byN: Map<number, RowOut>): string {
  const ks = ns.filter(n => byN.has(n))
  return ks.length ? `<sup style="font-size:10px;line-height:0;font-family:${SANS};color:${C.accent}">[${ks.map(n => a(rowUrl(byN.get(n)!), String(n), `color:${C.accent};text-decoration:none`)).join(', ')}]</sup>` : ''
}
const prose = (ss: Sentence[], byN: Map<number, RowOut>) => ss.map(s => `${esc(s.text)}${cites(s.citations, byN)}`).join(' ')

// ---------------------------------------------------------------- blocks
const H2 = (title: string, count: number) => `<tr><td style="padding:34px 24px 4px"><div style="font-family:${SANS};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${C.accent};font-weight:600">${esc(title)}</div><div style="height:1px;line-height:1px;background:${C.line};margin-top:8px;font-size:0">&nbsp;</div>${count ? '' : `<p style="margin:14px 0 0;font-family:${SANS};font-size:14px;color:${C.faint}">Nothing new.</p>`}</td></tr>`
const pad = (inner: string, p = '14px 24px 0') => `<tr><td style="padding:${p}">${inner}</td></tr>`

function hero(r: RowOut): string {
  // capped at 300px: wide press photos show whole, tall portraits/logos are cropped (overflow) rather than dominating
  const pic = safeImg(r.image) ? `<div style="max-height:300px;overflow:hidden;border-radius:12px 12px 0 0;background:${C.wash}">${a(rowUrl(r), img(r.image!, headline(r), 'width:100%;max-width:592px;height:auto', 592), 'text-decoration:none;display:block')}</div>` : monogram(r, 200, true)
  const quote = r.quote && r.quote !== r.text ? `<div style="margin:14px 0 0;padding:2px 0 2px 14px;border-left:3px solid ${C.accentSoft};font-family:${SERIF};font-style:italic;font-size:15px;line-height:1.55;color:${C.muted}">“${esc(clip(r.quote, 240))}”</div>` : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid ${C.line};border-radius:12px;background:${C.paper}" data-rw="hero"><tr><td style="padding:0;border-radius:12px 12px 0 0;overflow:hidden">${pic}</td></tr>
<tr><td style="padding:18px 20px 20px"><div style="font-family:${SANS};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${C.faint}">${r.n ? `${r.n} · ` : ''}${meta(r)}</div>
<div style="margin-top:6px;font-family:${SERIF};font-size:22px;line-height:1.3;color:${C.ink};font-weight:600">${a(rowUrl(r), esc(headline(r)), `color:${C.ink};text-decoration:none`)}</div>
<div style="margin-top:10px;font-family:${SANS};font-size:15px;line-height:1.55;color:${C.body}">${esc(clip(r.text, 260))}</div>${quote}</td></tr></table>`
}

function card(r: RowOut): string {
  const pic = safeImg(r.image) ? `<div style="height:132px;overflow:hidden;background:${C.wash}">${a(rowUrl(r), img(r.image!, headline(r), 'width:100%;height:auto;min-height:132px', 280), 'text-decoration:none;display:block')}</div>` : monogram(r, 132)
  return `<div style="display:inline-block;width:100%;max-width:290px;vertical-align:top;font-size:14px;text-align:left" data-rw="card"><div style="margin:0 6px 14px;border:1px solid ${C.line};border-radius:10px;overflow:hidden;background:${C.paper}">${pic}
<div style="padding:12px 14px 14px"><div style="font-family:${SERIF};font-size:16px;line-height:1.3;color:${C.ink};font-weight:600">${a(rowUrl(r), esc(clip(headline(r), 90)), `color:${C.ink};text-decoration:none`)}</div>
<div style="margin-top:6px;font-family:${SANS};font-size:13px;line-height:1.45;color:${C.body}">${esc(clip(r.text, 120))}</div>
<div style="margin-top:8px;font-family:${SANS};font-size:11.5px;color:${C.faint}">${r.n ? `${r.n} · ` : ''}${meta(r)}</div></div></div></div>`
}
const grid = (rows: RowOut[]) => rows.length ? pad(`<div style="font-size:0;margin:0 -6px;text-align:center">${rows.map(card).join('')}</div>`, '16px 18px 0') : ''

function alsoList(rows: RowOut[], label = 'Also'): string {
  if (!rows.length) return ''
  return pad(`<div style="font-family:${SANS};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${C.faint};margin-bottom:4px">${label}</div>` + rows.map(r =>
    `<div style="padding:9px 0;border-top:1px solid ${C.line};font-family:${SANS};font-size:14px;line-height:1.45;color:${C.body}">${r.n ? `<span style="color:${C.faint};font-size:12px">${r.n}&nbsp;&nbsp;</span>` : ''}${a(rowUrl(r), esc(clip(r.text, 160)), `color:${C.ink};text-decoration:none`)} <span style="color:${C.faint};font-size:12px;white-space:nowrap">— ${meta(r)}</span></div>`).join(''), '10px 24px 0')
}

// ---------------------------------------------------------------- charts (deterministic, from the rows)
export function dealBars(rows: RowOut[]): { company: string; amountUsd: number; n?: number; url: string | null }[] {
  const by = new Map<string, { company: string; amountUsd: number; n?: number; url: string | null }>()
  for (const r of rows) {
    const d = r.deal
    if (!d?.amountUsd || !d.company) continue
    const k = d.company.toLowerCase()
    if (!by.has(k) || by.get(k)!.amountUsd < d.amountUsd) by.set(k, { company: d.company, amountUsd: d.amountUsd, n: r.n, url: rowUrl(r) })
  }
  return [...by.values()].sort((x, y) => y.amountUsd - x.amountUsd).slice(0, 8)
}
export function stageMix(rows: RowOut[]): { stage: string; count: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) { const s = (r.deal?.round || '').trim(); if (s) { const k = s.replace(/\b\w/g, x => x.toUpperCase()).replace(/\bRound$/i, '').trim(); m.set(k, (m.get(k) || 0) + 1) } }
  return [...m.entries()].map(([stage, count]) => ({ stage, count })).sort((x, y) => y.count - x.count)
}
const chartTitle = (t: string, sub = '') => `<div style="font-family:${SANS};font-size:12px;font-weight:600;color:${C.ink}">${esc(t)}${sub ? ` <span style="font-weight:400;color:${C.faint}">${esc(sub)}</span>` : ''}</div>`
const chartBox = (inner: string, kind: string) => pad(`<div style="border:1px solid ${C.line};border-radius:10px;padding:14px 16px;background:${C.wash}" data-rw="${kind}">${inner}</div>`, '16px 24px 0')

function capitalChart(rows: RowOut[]): string {
  const bars = dealBars(rows)
  if (bars.length < 2) return ''
  const max = bars[0].amountUsd
  const body = bars.map(b => {
    const pct = Math.max(2, Math.round((b.amountUsd / max) * 100))
    return `<tr data-rw="bar" data-company="${esc(b.company)}" data-amount="${b.amountUsd}"><td style="padding:5px 10px 5px 0;font-family:${SANS};font-size:13px;color:${C.body};width:34%;vertical-align:middle">${a(b.url, esc(clip(b.company, 28)), `color:${C.body};text-decoration:none`)}</td>
<td style="padding:5px 0;vertical-align:middle"><table role="presentation" width="${pct}%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:${pct}%"><tr><td height="12" style="height:12px;line-height:12px;font-size:0;background:${C.accent};border-radius:3px">&nbsp;</td></tr></table></td>
<td style="padding:5px 0 5px 10px;font-family:${SANS};font-size:13px;font-weight:600;color:${C.ink};text-align:right;white-space:nowrap;width:64px;vertical-align:middle">${money(b.amountUsd)}</td></tr>`
  }).join('')
  return chartBox(`${chartTitle('Capital raised', 'by company, as reported')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:8px">${body}</table>`, 'capital')
}

function stageChips(rows: RowOut[]): string {
  const mix = stageMix(rows)
  if (!mix.length) return ''
  return pad(`<div data-rw="stages">${chartTitle('Round mix')}<div style="margin-top:6px">${mix.map(m => `<span style="display:inline-block;margin:4px 6px 0 0;padding:4px 10px;border-radius:999px;background:${C.accentSoft};color:#345687;font-family:${SANS};font-size:12px">${esc(m.stage)} <b style="font-weight:600">${m.count}</b></span>`).join('')}</div></div>`, '12px 24px 0')
}

function stanceBar(rows: RowOut[]): string {
  const f = rows.filter(r => r.stance === 'support').length, g = rows.filter(r => r.stance === 'contra').length
  if (!f && !g) return ''
  const pf = Math.round((f / (f + g)) * 100)
  const cell = (pct: number, bg: string) => (pct ? `<td width="${pct}%" height="12" style="width:${pct}%;height:12px;font-size:0;line-height:12px;background:${bg}">&nbsp;</td>` : '')
  return chartBox(`${chartTitle('For vs against', 'evidence on your theses')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:10px;border-radius:3px"><tr>${cell(pf, C.green)}${cell(100 - pf, C.amber)}</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px"><tr><td style="font-family:${SANS};font-size:12px;color:${C.green}" data-rw="for" data-count="${f}">For ${f}</td><td align="right" style="text-align:right;font-family:${SANS};font-size:12px;color:${C.amber}" data-rw="against" data-count="${g}">Against ${g}</td></tr></table>`, 'stance')
}

// ---------------------------------------------------------------- tables
function table(s: RunSection): string {
  const deals = s.rows.filter(r => r.deal)
  const th = (t: string, al = 'left') => `<th align="${al}" style="text-align:${al};padding:8px 8px 8px 0;font-family:${SANS};font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:${C.faint};font-weight:600;border-bottom:1px solid ${C.line}">${t}</th>`
  const td = (inner: string, extra = '') => `<td style="padding:10px 8px 10px 0;font-family:${SANS};font-size:13px;line-height:1.4;word-break:break-word;color:${C.body};border-bottom:1px solid ${C.line};vertical-align:top;${extra}">${inner}</td>`
  const src = (r: RowOut) => a(rowUrl(r), esc(r.removed ? 'Source removed' : r.source), `color:${C.accent};text-decoration:none`) + (r.date ? `<div style="color:${C.faint};font-size:12px">${fmtDate(r.date)}</div>` : '')
  if (deals.length) {
    const body = deals.map(r => `<tr data-rw="deal-row">${td(`<b style="color:${C.ink};font-weight:600">${esc(r.deal!.company)}</b>`)}${td(esc(r.deal!.round || '—'))}${td(r.deal!.amountUsd ? money(r.deal!.amountUsd) : esc(r.deal!.amountText || '—'), 'text-align:right')}${td(esc(r.deal!.leads.join(', ') || '—'))}${td(src(r))}</tr>`).join('')
    return pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse" data-rw="deal-table"><tr>${th('Company')}${th('Round')}${th('Amount', 'right')}${th('Lead investors')}${th('Source')}</tr>${body}</table>`, '14px 24px 0') + alsoList(s.rows.filter(r => !r.deal), 'Other items')
  }
  const body = s.rows.map(r => `<tr>${td(`${a(rowUrl(r), `<b style="color:${C.ink};font-weight:600">${esc(clip(headline(r), 100))}</b>`, 'text-decoration:none')}<div style="margin-top:3px">${esc(clip(r.text, 180))}</div>`)}${td(src(r), 'width:120px')}</tr>`).join('')
  return pad(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse" data-rw="item-table"><tr>${th('Item')}${th('Source')}</tr>${body}</table>`, '14px 24px 0')
}

// ---------------------------------------------------------------- sections and reports
/** The section's most important row: the largest grounded round in a deal section, else the first row (the query's
 * order); a row with a picture wins a tie among the top three. */
export function heroOf(rows: RowOut[]): RowOut | null {
  if (!rows.length) return null
  const bars = dealBars(rows)
  if (bars.length) { const r = rows.find(x => x.n === bars[0].n); if (r) return r }
  return rows.slice(0, 3).find(r => safeImg(r.image)) || rows[0]
}

function sectionHtml(s: RunSection, c: RunContent, byN: Map<number, RowOut>): string {
  const st = styleOf(s, c)
  const out = [H2(s.title, s.rows.length)]
  if (!s.rows.length) return out.join('')
  if (st === 'table') return out.join('') + table(s)
  if (st === 'digest') {
    if (s.bullets?.length) out.push(pad(`<ul style="margin:0;padding-left:18px;font-family:${SANS};font-size:14px;line-height:1.55;color:${C.body}">${s.bullets.map(b => `<li style="margin:3px 0">${esc(b.text)}</li>`).join('')}</ul>`))
    return out.join('') + grid(s.rows)
  }
  if (s.paragraph?.length) out.push(pad(`<p style="margin:0;font-family:${SERIF};font-size:16.5px;line-height:1.6;color:${C.body}" data-rw="paragraph">${prose(s.paragraph, byN)}</p>`, '16px 24px 0'))
  out.push(capitalChart(s.rows), stageChips(s.rows), stanceBar(s.rows))
  // one picture per article: the hero and the cards show distinct documents; further facts from the same articles
  // (a round's funding fact and its investors' facts, several numbers from one post) go to "Also"
  const h = heroOf(s.rows)!
  const seen = new Set([h.documentId || h.url])
  const cards: RowOut[] = [], also: RowOut[] = []
  for (const r of s.rows) {
    if (r === h) continue
    const k = r.documentId || r.url
    if (cards.length < 4 && !seen.has(k)) { seen.add(k); cards.push(r) } else also.push(r)
  }
  out.push(pad(hero(h), '18px 24px 0'), grid(cards), alsoList(also))
  // deep dives: the standout companies in context, from their other stored facts (every sentence cited)
  for (const d of s.deepDives || []) if (d.sentences.length) out.push(pad(`<div style="border-left:3px solid ${C.line};padding-left:14px"><div style="font-family:${SANS};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.faint};font-weight:600">Deep dive · ${esc(d.subject)}</div><p style="margin:6px 0 0;font-family:${SERIF};font-size:16px;line-height:1.6;color:${C.body}" data-rw="deep-dive">${prose(d.sentences, byN)}</p></div>`, '18px 24px 0'))
  return out.join('')
}

/** One report's body rows (<tr>s for the document table): optional title, lede, sections. Used by runs and briefings. */
export function reportBlock(c: RunContent, o: { title?: boolean } = {}): string {
  const byN = new Map<number, RowOut>()
  for (const s of c.sections) for (const r of [...s.rows, ...(s.background || [])]) if (r.n) byN.set(r.n, r)
  const rows = c.sections.flatMap(s => s.rows)
  const sources = new Set(rows.map(r => r.source)).size
  const out: string[] = []
  if (o.title) out.push(`<tr><td style="padding:40px 24px 0"><div style="font-family:${SANS};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${C.faint}">Report</div><div style="margin-top:4px;font-family:${SERIF};font-size:24px;line-height:1.25;color:${C.ink};font-weight:600">${esc(c.name)}</div></td></tr>`)
  if (c.lede?.length) out.push(`<tr><td style="padding:${o.title ? 14 : 26}px 24px 0"><div style="font-family:${SANS};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${C.accent};font-weight:600">The story</div><p style="margin:8px 0 0;font-family:${SERIF};font-size:19px;line-height:1.55;color:${C.ink}" data-rw="lede">${prose(c.lede, byN)}</p>${rows.length ? `<p style="margin:12px 0 0;font-family:${SANS};font-size:12px;color:${C.faint}">${rows.length} item${rows.length === 1 ? '' : 's'} from ${sources} source${sources === 1 ? '' : 's'}</p>` : ''}</td></tr>`)
  out.push(...c.sections.map(s => sectionHtml(s, c, byN)))
  return out.join('')
}

/** The full email-safe document: masthead, body rows, quiet footer. `embed` = shown inside the app (no outer page tint). */
export function documentHtml(m: { kicker: string; title: string; at: number }, body: string, o: { embed?: boolean } = {}): string {
  const bg = o.embed ? 'transparent' : C.page
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light"><title>${esc(m.title)}</title></head>
<body style="margin:0;padding:0;background:${bg};-webkit-text-size-adjust:100%"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:${bg}"><tr><td align="center" style="padding:${o.embed ? '0' : '24px 8px'}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;width:100%;max-width:640px;background:${C.paper};border-radius:14px;${o.embed ? '' : `border:1px solid ${C.line};`}text-align:left">
<tr><td style="padding:28px 24px 0"><div style="font-family:${SANS};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${C.accent};font-weight:600">Research Workspace · ${esc(m.kicker)}</div>
<h1 style="margin:8px 0 0;font-family:${SERIF};font-size:30px;line-height:1.2;color:${C.ink};font-weight:600">${esc(m.title)}</h1>
<div style="margin-top:6px;font-family:${SANS};font-size:13px;color:${C.muted}">${esc(longDate(m.at))}</div><div style="height:2px;line-height:2px;background:${C.ink};margin-top:18px;font-size:0;width:48px">&nbsp;</div></td></tr>
${body}
<tr><td style="padding:40px 24px 28px"><div style="height:1px;line-height:1px;background:${C.line};font-size:0">&nbsp;</div><p style="margin:14px 0 0;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.faint}">${FOOTER} Pictures come from the original articles; every link opens the source.</p></td></tr>
</table></td></tr></table></body></html>`
}

export function renderHtml(c: RunContent, o: { embed?: boolean } = {}): string {
  return documentHtml({ kicker: 'Report', title: c.name, at: c.at }, reportBlock(c), o)
}

// ---------------------------------------------------------------- Markdown
const mdCites = (ns: number[]) => ns.map(n => `[${n}]`).join('')
export function renderMarkdown(c: RunContent, o: { level?: number; footer?: boolean } = {}): string {
  const h = (k: number) => '#'.repeat(Math.min(6, (o.level ?? 1) + k - 1))
  const out = [`${h(1)} ${c.name}`, `_${new Date(c.at).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}_`, '']
  if (c.lede?.length) out.push('**The story.** ' + c.lede.map(s => `${s.text} ${mdCites(s.citations)}`).join(' '), '')
  for (const s of c.sections) {
    out.push(`${h(2)} ${s.title}`)
    if (s.paragraph?.length) out.push(s.paragraph.map(x => `${x.text} ${mdCites(x.citations)}`).join(' '), '')
    for (const d of s.deepDives || []) if (d.sentences.length) out.push(`**Deep dive · ${d.subject}.** ` + d.sentences.map(x => `${x.text} ${mdCites(x.citations)}`).join(' '), '')
    if (s.bullets?.length) { out.push('_AI summary:_'); for (const b of s.bullets) out.push(`- ${b.text} ${mdCites(b.citations)}`) }
    if (!s.rows.length) out.push('Nothing new.')
    const bars = styleOf(s, c) === 'story' ? dealBars(s.rows) : []
    if (bars.length >= 2) out.push('Capital raised: ' + bars.map(b => `${b.company} ${money(b.amountUsd)}`).join(' · '), '')
    if (styleOf(s, c) === 'table' && s.rows.some(r => r.deal)) {
      out.push('| Company | Round | Amount | Lead investors | Source |', '|---|---|---|---|---|')
      for (const r of s.rows.filter(x => x.deal)) out.push(`| ${r.deal!.company} | ${r.deal!.round || '—'} | ${r.deal!.amountUsd ? money(r.deal!.amountUsd) : r.deal!.amountText || '—'} | ${r.deal!.leads.join(', ') || '—'} | ${r.url ? `[${r.source}](${r.url})` : r.source} |`)
      out.push('')
    }
    s.rows.filter(r => !(styleOf(s, c) === 'table' && r.deal)).forEach((r, i) => out.push(`- ${r.n ? `[${r.n}] ` : s.bullets?.length ? `[${i + 1}] ` : ''}${r.text} — ${r.removed ? 'Source removed' : r.source}${r.date ? ', ' + fmtDate(r.date) : ''}${r.url && !r.removed ? ` ([source](${r.url}))` : ''}${safeImg(r.image) ? ` ([image](${r.image}))` : ''}`))
    out.push('')
  }
  if (o.footer !== false) out.push('---', FOOTER)
  return out.join('\n')
}
