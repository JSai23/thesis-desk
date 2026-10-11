// researchworkspace:// URL scheme (bookmarklet, RFC §1B.8.8). Handlers are attached by the ingress module.
import { log } from './log'

type DeepLinkHandler = (params: { url?: string; text?: string }) => void
let handler: DeepLinkHandler | null = null
const queue: { url?: string; text?: string }[] = []

export function setDeepLinkHandler(h: DeepLinkHandler): void {
  handler = h
  for (const q of queue.splice(0)) h(q)
}

export function handleDeepLink(link: string): void {
  try {
    const u = new URL(link)
    if (u.protocol !== 'researchworkspace:') return
    const action = u.hostname || u.pathname.replace(/^\/+/, '')
    if (action !== 'add') return
    const params = { url: u.searchParams.get('url') || undefined, text: u.searchParams.get('text') || undefined }
    if (handler) handler(params)
    else queue.push(params)
  } catch (e) {
    log.warn('deeplink', 'bad link', { err: String(e) })
  }
}
