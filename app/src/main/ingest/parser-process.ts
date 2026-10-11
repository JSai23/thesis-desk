// Parser utilityProcess (RFC §1B.2): receives HTML, returns normalized text + metadata so jsdom/Readability
// never block the main process loop.
import { parseHtml, paragraphsOf } from './parse-html'

process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const { id, kind, html, url, opts } = e.data as { id: number; kind: 'page' | 'fragment'; html: string; url: string; opts?: any }
  try {
    const result = kind === 'fragment' ? { paragraphs: paragraphsOf(html) } : parseHtml(html, url, opts || {})
    process.parentPort.postMessage({ id, result })
  } catch (err) {
    process.parentPort.postMessage({ id, error: String((err as Error)?.message || err) })
  }
})
