// Handlers: reports, alerts, export (RFC FLOW-G, FLOW-H, §1B.19).
import { handle } from './registry'
import * as reports from '../reports'
import * as alerts from '../alerts'
import * as briefings from '../reports/briefings'
import { exportDoc, emailExport } from '../reports/delivery'

export function registerReportHandlers(): void {
  handle('report.list', () => reports.listReports())
  handle('report.createFromPrompt', ({ text }) => reports.createFromPrompt(text))
  handle('report.retry', ({ id }) => { reports.retry(id); return { ok: true } })
  handle('report.refine', ({ id, text }) => { reports.refine(id, text); return { ok: true } })
  handle('report.undo', ({ id }) => { reports.undo(id); return { ok: true } })
  handle('report.patch', ({ id, patch }) => { reports.patchDefinition(id, patch as any); return { ok: true } })
  handle('report.preview', ({ id }) => reports.preview(id))
  handle('report.runNow', ({ id }) => reports.runNow(id))
  handle('report.runs', ({ id }) => reports.runs(id))
  handle('report.run', ({ runId }) => reports.getRun(runId))
  handle('report.setEnabled', ({ id, enabled }) => { reports.setEnabled(id, enabled); return { ok: true } })
  handle('report.rename', ({ id, name }) => { reports.rename(id, name); return { ok: true } })
  handle('report.delete', ({ id }) => { reports.remove(id); return { ok: true } })
  handle('report.restore', ({ id }) => { reports.restore(id); return { ok: true } })
  handle('report.export', ({ id, runId, format, path }) => exportDoc('report', { id, runId, format, path }))
  handle('briefing.list', () => briefings.listBriefings())
  handle('briefing.create', ({ name, reportIds, schedule }) => briefings.createBriefing({ name, reportIds, schedule }))
  handle('briefing.update', ({ id, patch }) => briefings.updateBriefing(id, patch))
  handle('briefing.setReport', ({ id, reportId, on }) => briefings.setReportInBriefing(id, reportId, on))
  handle('briefing.delete', ({ id }) => { briefings.removeBriefing(id); return { ok: true } })
  handle('briefing.sendNow', ({ id }) => briefings.sendNow(id))
  handle('briefing.runs', ({ id }) => briefings.briefingRuns(id))
  handle('alert.compile', ({ text, anchor }) => alerts.compileAlert(text, anchor))
  handle('alert.retry', ({ id }) => { alerts.retry(id); return { alertId: id } })
  handle('alert.activate', ({ id, channels }) => alerts.activate(id, channels))
  handle('alert.update', ({ id, text }) => { alerts.update(id, text); return { alertId: id } })
  handle('alert.setEnabled', ({ id, enabled }) => { alerts.setEnabled(id, enabled); return { ok: true } })
  handle('alert.delete', ({ id }) => { alerts.remove(id); return { ok: true } })
  handle('alert.list', () => alerts.listAlerts())
  handle('test.alerts.setCooldown', ({ id, minutes }) => { alerts.setCooldown(id, minutes); return { ok: true } })
  handle('export.thesis', ({ id, format, path }) => exportDoc('thesis', { id, format, path }))
  handle('export.email', ({ kind, id }) => emailExport(kind, id))
}
