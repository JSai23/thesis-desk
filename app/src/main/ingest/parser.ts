// Client for the parser utilityProcess. One long-lived child; restarted if it dies.
import { utilityProcess, type UtilityProcess } from 'electron'
import path from 'node:path'
import type { ParseResult } from './parse-html'
import { log } from '../log'

let child: UtilityProcess | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

function ensure(): UtilityProcess {
  if (child) return child
  const c = utilityProcess.fork(path.join(__dirname, 'parser.js'), [], { serviceName: 'Research Workspace Parser', stdio: 'ignore' })
  c.on('message', (m: { id: number; result?: any; error?: string }) => {
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    clearTimeout(p.timer)
    if (m.error) p.reject(new Error(m.error))
    else p.resolve(m.result)
  })
  c.on('exit', code => {
    log.warn('parser', `parser process exited (${code})`)
    child = null
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error('parser exited')); pending.delete(id) }
  })
  child = c
  return c
}

function send<T>(msg: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('parser timeout')) }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    ensure().postMessage({ id, ...msg })
  })
}

export const parsePage = (html: string, url: string, opts: { wallPhrases?: string[]; checkWall?: boolean } = {}) => send<ParseResult>({ kind: 'page', html, url, opts })
export const parseFragment = (html: string) => send<{ paragraphs: string[] }>({ kind: 'fragment', html, url: 'about:blank' }).then(r => r.paragraphs)
export function stopParser(): void { child?.kill(); child = null }
