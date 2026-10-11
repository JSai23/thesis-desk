// Public application boundary: every command validates its request with the zod contract in shared/ipc.ts.
import { ipcMain } from 'electron'
import { commands, type CommandName } from '../../shared/ipc'
import { AppError } from '../errors'
import { log } from '../log'
import { TEST_MODE } from '../env'

type Handler = (payload: any) => unknown | Promise<unknown>
const handlers = new Map<string, Handler>()

export function handle<C extends CommandName>(name: C, fn: Handler): void {
  if (!(name in commands)) throw new Error(`Unknown command ${name}`)
  handlers.set(name, fn)
}

export async function invoke(name: string, payload: unknown): Promise<{ ok: true; data: unknown } | { ok: false; code: string; message: string }> {
  const contract = (commands as Record<string, { req: any; test?: boolean }>)[name]
  const fn = handlers.get(name)
  if (!contract || !fn) return { ok: false, code: 'NOT_FOUND', message: `Unknown command ${name}` }
  if (contract.test && !TEST_MODE) return { ok: false, code: 'NOT_FOUND', message: `Unknown command ${name}` }
  const parsed = contract.req.safeParse(payload ?? {})
  if (!parsed.success) return { ok: false, code: 'VALIDATION', message: parsed.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  try {
    const data = await fn(parsed.data)
    return { ok: true, data: data ?? null }
  } catch (e) {
    if (e instanceof AppError) return { ok: false, code: e.code, message: e.message }
    log.error('ipc', `command ${name} failed`, { error: String((e as Error)?.stack || e) })
    return { ok: false, code: 'INTERNAL', message: (e as Error)?.message || 'Internal error' }
  }
}

export function registerIpc(): void {
  ipcMain.handle('rw:invoke', (_e, name: string, payload: unknown) => invoke(name, payload))
}
