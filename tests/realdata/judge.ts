// Independent judge for real-data suites: a fresh `claude -p` process with no tools in an empty temp dir; input and
// output are saved next to the run's results so every verdict can be audited.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function judge(outDir: string, name: string, prompt: string): any {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-rd-judge-'))
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `${name}.input.txt`), prompt)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = spawnSync('claude', ['-p', '--model', 'opus', '--output-format', 'json', '--tools', '', '--permission-mode', 'dontAsk', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence'],
      { cwd, input: prompt, encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 64 << 20 })
    fs.writeFileSync(path.join(outDir, `${name}.output-${attempt}.json`), r.stdout || r.stderr || '')
    try { const t = JSON.parse(r.stdout).result as string; return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) } catch { /* retry once */ }
  }
  throw new Error(`judge ${name}: no JSON verdict`)
}

/** Real Google News RSS headlines (title, publisher, date) for a query — read by the test, independent of the app. */
export async function newsHeadlines(query: string): Promise<{ title: string; publisher: string; date: string }[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
  const x = await (await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })).text()
  return [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const t = (m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    const parts = t.split(/\s[-–—]\s(?=[^-–—]+$)/)
    return { title: parts[0].trim(), publisher: (parts[1] || '').trim(), date: (m[1].match(/<pubDate>([^<]*)/)?.[1] || '').slice(0, 16) }
  })
}
