// Typed errors that cross the IPC boundary as { ok:false, code, message } (RFC §1B.3)
// and drive job retry policy (RFC §1B.10).
export type ErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'AI_UNAVAILABLE' | 'AI_INVALID' | 'FETCH_FAILED' | 'AUTH_REQUIRED' | 'INTERNAL'
  | 'AUTH_EXPIRED' | 'ROBOTS_BLOCKED' | 'PROVIDER_ERROR' | 'LEASE_EXPIRED' | `HTTP_${number}`

export class AppError extends Error {
  constructor(public code: ErrorCode | string, message: string, public extra: Record<string, unknown> = {}) {
    super(message)
  }
}

/** Thrown by a job handler to put the job back in the queue until `until` without consuming an attempt. */
export class ParkJob extends Error {
  constructor(public until: number, public reason: string) {
    super(reason)
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError
