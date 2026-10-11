// Delivery and export (RFC §1B.19): SEND_EMAIL job for report runs, alert notifications and "Send by email" exports;
// PDF via a hidden window's printToPDF, Markdown via save dialog, Copy as Markdown via clipboard.
import { app, BrowserWindow, clipboard, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { one, run } from '../db'
import { now } from '../clock'
import { emit } from '../events'
import { AppError } from '../errors'
import { enqueue, registerJob, onJobFailure } from '../jobs'
import { TEST_MODE } from '../env'
import { send } from '../mail'
import { sendBriefingEmail } from './briefings'
import { thesisPage } from '../objects/pages'
import { getRun } from './index'
import type { ThesisPageDTO } from '../../shared/dto'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// ---------------------------------------------------------------- thesis export
export function thesisDoc(id: string): { name: string; markdown: string; html: string } {
  const p = thesisPage(id)
  if ('redirect' in p) return thesisDoc(p.redirect.id)
  const t = p.thesis
  const ev = (c: ThesisPageDTO['supporting'][number]) => ({ md: `- ${c.text} — “${c.quote}” (${c.src}${c.date ? ', ' + day(c.date) : ''})`, html: `<li style="margin:6px 0">${esc(c.text)}<br><span style="color:#888;font-size:12px">“${esc(c.quote)}” · ${esc(c.src)}${c.date ? ' · ' + day(c.date) : ''}</span></li>` })
  const md = [`# ${t.title}`, `Conviction ${t.conviction}/5`, '', '## Current view', t.currentView || '_No view written yet._', '',
    '## Supporting evidence', ...(p.supporting.length ? p.supporting.map(c => ev(c).md) : ['Nothing yet.']), '',
    '## Contradicting evidence', ...(p.contradicting.length ? p.contradicting.map(c => ev(c).md) : ['Nothing yet.']), '',
    ...(p.thoughts.length ? ['## My thoughts', ...p.thoughts.map(n => `- ${n.text}`), ''] : []),
    ...(p.questions.length ? ['## Open questions', ...p.questions.map(n => `- ${n.text}`), ''] : []),
    ...(p.companies.length ? ['## Companies', ...p.companies.map(c => `- ${c.name}${c.stage ? ' · ' + c.stage : ''}`), ''] : []),
    '---', 'Built on this Mac from your sources, theses and notes.'].join('\n')
  const sec = (title: string, body: string) => `<h2 style="font-size:15px;margin:22px 0 8px">${esc(title)}</h2>${body}`
  const list = (cs: typeof p.supporting) => cs.length ? `<ul style="padding-left:18px">${cs.map(c => ev(c).html).join('')}</ul>` : '<p style="color:#888">Nothing yet.</p>'
  const html = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;color:#222;background:#fff;max-width:680px;margin:0 auto;padding:24px"><h1 style="font-size:22px;margin:0">${esc(t.title)}</h1><p style="color:#888;margin:4px 0 0">Conviction ${t.conviction}/5</p>`
    + sec('Current view', `<p style="white-space:pre-wrap;line-height:1.5">${esc(t.currentView || 'No view written yet.')}</p>`)
    + sec('Supporting evidence', list(p.supporting)) + sec('Contradicting evidence', list(p.contradicting))
    + (p.thoughts.length ? sec('My thoughts', `<ul>${p.thoughts.map(n => `<li>${esc(n.text)}</li>`).join('')}</ul>`) : '')
    + (p.questions.length ? sec('Open questions', `<ul>${p.questions.map(n => `<li>${esc(n.text)}</li>`).join('')}</ul>`) : '')
    + `<hr style="border:none;border-top:1px solid #eee;margin:24px 0 10px"><p style="color:#999;font-size:12px">Built on this Mac from your sources, theses and notes.</p></body></html>`
  return { name: t.title, markdown: md, html }
}

function reportDoc(o: { id?: string; runId?: string }): { name: string; markdown: string; html: string; runId: string } {
  const runId = o.runId || one<{ id: string }>("SELECT id FROM report_runs WHERE report_id = ? AND status = 'succeeded' ORDER BY started_at DESC LIMIT 1", o.id)?.id
  if (!runId) throw new AppError('NOT_FOUND', 'Run this report first')
  const r = getRun(runId)
  return { name: r.content?.name || 'Report', markdown: r.markdown, html: r.html, runId }
}

const safeName = (s: string) => s.replace(/[\/\\:*?"<>|]+/g, '-').slice(0, 80).trim() || 'Export'

async function savePath(name: string, ext: 'pdf' | 'md', given?: string): Promise<string | null> {
  if (given) return given
  const def = join(app.getPath('downloads'), `${safeName(name)}.${ext}`)
  if (TEST_MODE) return def
  const win = BrowserWindow.getFocusedWindow()
  const opts = { defaultPath: def, filters: [ext === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Markdown', extensions: ['md'] }] }
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  return r.canceled || !r.filePath ? null : r.filePath
}

async function toPdf(html: string): Promise<Buffer> {
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    return await w.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' })
  } finally { w.destroy() }
}

export async function exportDoc(kind: 'thesis' | 'report', o: { id?: string; runId?: string; format: 'pdf' | 'markdown' | 'copy_markdown' | 'email'; path?: string }): Promise<{ path?: string; copied?: boolean; queued?: boolean; cancelled?: boolean }> {
  const d = kind === 'thesis' ? thesisDoc(o.id!) : reportDoc(o)
  if (o.format === 'copy_markdown') { clipboard.writeText(d.markdown); return { copied: true } }
  if (o.format === 'email') { emailExport(kind === 'thesis' ? 'thesis' : 'run', kind === 'thesis' ? o.id! : (d as any).runId); return { queued: true } }
  const p = await savePath(d.name, o.format === 'pdf' ? 'pdf' : 'md', o.path)
  if (!p) return { cancelled: true }
  writeFileSync(p, o.format === 'pdf' ? await toPdf(d.html) : d.markdown)
  return { path: p }
}

export function emailExport(kind: 'thesis' | 'report' | 'run', id: string): { queued: true } {
  const runId = kind === 'report' ? reportDoc({ id }).runId : id
  enqueue('SEND_EMAIL', kind === 'thesis' ? { kind: 'thesis', id } : { kind: 'export_run', runId }, { priority: 2 })
  return { queued: true }
}

// ---------------------------------------------------------------- SEND_EMAIL
async function sendEmail(p: any): Promise<unknown> {
  if (p.kind === 'run' || p.kind === 'export_run') {
    const r = getRun(p.runId)
    if (p.kind === 'run' && r.deliveredEmailAt) return { skipped: 'already delivered' }
    const at = r.content?.at || r.startedAt
    const subject = `${r.late ? '(Delayed) ' : ''}Research Workspace · ${r.content?.name || 'Report'} · ${new Date(at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
    const m = await send({ subject, text: r.markdown, html: r.html })
    if (p.kind === 'run') run('UPDATE report_runs SET delivered_email_at = ?, delivery_error = NULL WHERE id = ?', now(), r.id)
    emit('report.ready', { reportId: r.reportId, runId: r.id })
    return { messageId: m.messageId, subject }
  }
  if (p.kind === 'briefing') return sendBriefingEmail(p.briefingRunId)
  if (p.kind === 'thesis') {
    const d = thesisDoc(p.id)
    const m = await send({ subject: `Research Workspace · ${d.name} · ${new Date(now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, text: d.markdown, html: d.html })
    return { messageId: m.messageId }
  }
  if (p.kind === 'notification') {
    const n = one<any>('SELECT n.*, a.name rule_name FROM notifications n JOIN alert_rules a ON a.id = n.alert_rule_id WHERE n.id = ?', p.notificationId)
    if (!n) return { skipped: 'gone' }
    if (n.delivered_email_at) return { skipped: 'already delivered' }
    const url = n.document_id ? one<{ url: string }>('SELECT url FROM documents WHERE id = ?', n.document_id)?.url : null
    const text = `${n.title}\n\n${n.body}${url ? `\n\nSource: ${url}` : ''}\n\n—\nBuilt on this Mac from your sources, theses and notes.`
    const html = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;color:#222;max-width:600px;margin:0 auto;padding:24px"><p style="color:#888;font-size:12px;margin:0">Alert · ${esc(n.rule_name)}</p><h1 style="font-size:18px">${esc(n.title)}</h1><p style="line-height:1.5">${esc(n.body)}</p>${url ? `<p><a href="${esc(url)}" style="color:#3b6fd6">Source</a></p>` : ''}<hr style="border:none;border-top:1px solid #eee"><p style="color:#999;font-size:12px">Built on this Mac from your sources, theses and notes.</p></body></html>`
    const m = await send({ subject: `Alert · ${n.rule_name}`, text, html })
    run('UPDATE notifications SET delivered_email_at = ?, delivery_error = NULL WHERE id = ?', now(), n.id)
    return { messageId: m.messageId }
  }
  return { skipped: 'unknown kind' }
}

export function registerDelivery(): void {
  registerJob('SEND_EMAIL', job => sendEmail(job.payload))
  onJobFailure((job, _code, message) => {
    if (job.type !== 'SEND_EMAIL') return
    const p = job.payload as any
    if (p.kind === 'run') {
      run('UPDATE report_runs SET delivery_error = ? WHERE id = ?', message.slice(0, 300), p.runId)
      const rid = one<{ report_id: string }>('SELECT report_id FROM report_runs WHERE id = ?', p.runId)?.report_id
      if (rid) emit('report.ready', { reportId: rid, runId: p.runId, toast: 'Couldn’t send email · ' + message.slice(0, 120) })
    } else if (p.kind === 'notification') run('UPDATE notifications SET delivery_error = ? WHERE id = ?', message.slice(0, 300), p.notificationId)
  })
}

