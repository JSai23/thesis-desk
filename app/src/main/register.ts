// Registers domain IPC handlers, job handlers and schedule enqueuers. Each phase adds its module here.
import { registerJob, cleanupJobs } from './jobs'
import { fault } from './faults'
import { getSetting, setSetting } from './settings'
import { registerMaintenance, maintenanceTask } from './maintenance'
import { registerFeedHandlers } from './ipc/feed'
import { registerObjectHandlers } from './ipc/objects'
import { registerLinkHandlers } from './ipc/links'
import { registerSourceHandlers } from './ipc/sources'
import { registerProcess } from './ingest/process'
import { registerSources } from './sources'
import { registerEmail } from './sources/email'
import { registerAuth } from './sources/auth'
import { registerSearch } from './sources/search'
import { registerRestricted } from './sources/restricted'
import { registerNotes } from './notes'
import { registerRefresh } from './objects/refresh'
import { registerHydrate } from './objects/hydrate'
import { registerThinkHandlers } from './ipc/think'
import { registerOntologyHandlers } from './ipc/ontology'
import { registerCustomize } from './views/customize'
import { registerMailHandlers } from './ipc/mail'
import { registerReportHandlers } from './ipc/reports'
import { registerReports } from './reports'
import { registerDelivery } from './reports/delivery'
import { registerBriefings } from './reports/briefings'
import { registerAlerts } from './alerts'
import { registerTiers } from './objects/tiers'
import { registerThesisMatch } from './theses/match'

export { registerMaintenance }

export function registerAll(): void {
  registerFeedHandlers()
  registerObjectHandlers()
  registerLinkHandlers()
  registerSourceHandlers()
  registerProcess()
  registerSources()
  registerEmail()
  registerAuth()
  registerSearch()
  registerRestricted()
  registerNotes()
  registerRefresh()
  registerHydrate()
  registerTiers()
  registerThesisMatch()
  registerThinkHandlers()
  registerOntologyHandlers()
  registerCustomize()
  registerMailHandlers()
  registerReportHandlers()
  registerReports()
  registerDelivery()
  registerBriefings()
  registerAlerts()
  registerMaintenance('jobs_cleanup', () => cleanupJobs())
  registerJob('MAINTENANCE', async job => {
    if (fault('crash_during_job')) {
      // Simulated hard crash mid-job (SMK-01c): the job is left 'running' and must be requeued on next start.
      await new Promise(r => setTimeout(r, 500))
      process.kill(process.pid, 'SIGKILL')
    }
    const fn = maintenanceTask(String(job.payload.task))
    const result = fn ? await fn() : null
    const key = `test.maintenance_runs.${job.payload.task}`
    setSetting(key, Number(getSetting(key) || 0) + 1)
    return { task: job.payload.task, result: result ?? null }
  })
}
