// Test-mode fault injection (RW_FAULTS / test.faults.set). Spec: comma-separated "name[:arg]" entries, e.g.
// "invalid_always:EXTRACT_DOCUMENT,provider_error:ORGANIZE_NOTE,fabricate:ANSWER_QUERY,usage:90,crash_during_job".
import { FAULTS_ENV, TEST_MODE } from './env'

let faults: { name: string; arg: string }[] = []

export function setFaults(spec: string): void {
  faults = TEST_MODE ? spec.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf(':')
    return i < 0 ? { name: s, arg: '' } : { name: s.slice(0, i), arg: s.slice(i + 1) }
  }) : []
}
setFaults(FAULTS_ENV)

export const fault = (name: string, arg?: string): boolean => faults.some(f => f.name === name && (arg === undefined || f.arg === arg || f.arg === '*'))
export const faultArg = (name: string): string | undefined => faults.find(f => f.name === name)?.arg
export const faultSpec = (): string => faults.map(f => (f.arg ? `${f.name}:${f.arg}` : f.name)).join(',')
