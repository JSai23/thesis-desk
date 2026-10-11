// Renderer side of the public boundary: window.rw.invoke / window.rw.on only (RFC §1B.3).
declare global {
  interface Window {
    rw: {
      invoke: (command: string, payload?: unknown) => Promise<{ ok: true; data: any } | { ok: false; code: string; message: string }>
      on: (event: string, handler: (payload: any) => void) => () => void
    }
  }
}

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

export async function call<T = any>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
  const r = await window.rw.invoke(command, payload)
  if (!r.ok) throw new ApiError(r.code, r.message)
  return r.data as T
}

/** Like call() but returns a fallback instead of throwing (used for list loads that may not exist yet). */
export async function tryCall<T = any>(command: string, payload: Record<string, unknown> = {}, fallback: T): Promise<T> {
  try { return await call<T>(command, payload) } catch { return fallback }
}

export const on = (event: string, handler: (payload: any) => void): (() => void) => window.rw.on(event, handler)
