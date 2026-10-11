// Maintenance task registry (RFC §1B.11.2): unmute, purge_removed_sources, jobs_cleanup, summaries_refresh, suggest_theses.
const tasks = new Map<string, () => unknown | Promise<unknown>>()
export function registerMaintenance(task: string, fn: () => unknown | Promise<unknown>): void { tasks.set(task, fn) }
export const maintenanceTask = (task: string) => tasks.get(task)
