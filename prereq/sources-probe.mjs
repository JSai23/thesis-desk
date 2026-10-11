import { XMLParser } from 'fast-xml-parser'; import { JSDOM, VirtualConsole } from 'jsdom'; import { Readability } from '@mozilla/readability';
import robotsParser from 'robots-parser'; import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const vc = new VirtualConsole();
// Some sites (news.ycombinator.com since 2026-10-01) refuse Node's fetch client but serve curl and Chromium (the app's
// network stack); a refused fetch is retried with curl so the probe measures the site, not the HTTP client (MEM-036).
const curlGet = (u, accept) => { const r = spawnSync('curl', ['-sL', '--max-time', '20', '-A', UA, ...(accept ? ['-H', `Accept: ${accept}`] : []), '-w', '\n%{http_code} %{url_effective}', u], { encoding: 'utf8', maxBuffer: 32 << 20 }); const out = r.stdout || ''; const k = out.lastIndexOf('\n'); const [code, url] = out.slice(k + 1).split(' '); return { status: Number(code) || 0, url: url || u, text: out.slice(0, k) }; };
const get = async (u, accept) => { const r = await fetch(u, { headers: { 'User-Agent': UA, ...(accept ? { Accept: accept } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(20000) }); if ([403, 419, 429].includes(r.status)) return curlGet(u, accept); return { status: r.status, url: r.url, text: await r.text() }; };
const xml = new XMLParser({ ignoreAttributes: false });
const robotsCache = {};
async function allowed(u) { const o = new URL(u).origin; if (!robotsCache[o]) { try { const r = await get(o + '/robots.txt'); robotsCache[o] = robotsParser(o + '/robots.txt', r.status === 200 ? r.text : ''); } catch { robotsCache[o] = robotsParser(o + '/robots.txt', ''); } } return robotsCache[o].isAllowed(u, 'ResearchWorkspace') !== false; }
function readable(html, url) { const dom = new JSDOM(html, { url, virtualConsole: vc }); const a = new Readability(dom.window.document).parse(); return a ? { title: a.title, chars: (a.textContent || '').replace(/\s+/g, ' ').trim().length, text: a.textContent } : { chars: 0 }; }
function feedItems(text) { const d = xml.parse(text); const ch = d.rss?.channel; const it = ch ? [].concat(ch.item || []) : [].concat(d.feed?.entry || []);
  return it.map(i => ({ title: typeof i.title === 'object' ? i.title['#text'] : i.title, link: i.link?.['@_href'] || (Array.isArray(i.link) ? i.link.find(l => l['@_rel'] !== 'self')?.['@_href'] : i.link), date: i.pubDate || i.updated || i.published })); }
function listingLinks(html, base, prefix) { const dom = new JSDOM(html, { url: base, virtualConsole: vc }); const host = new URL(base).host; const seen = new Set();
  for (const a of dom.window.document.querySelectorAll('a[href]')) { try { const u = new URL(a.href, base); u.hash = ''; if (u.host !== host) continue; const segs = u.pathname.split('/').filter(Boolean);
    if (prefix ? u.pathname.startsWith(prefix) && u.pathname !== prefix : segs.length >= 1) seen.add(u.toString()); } catch {} } return [...seen]; }
const P = JSON.parse(fs.readFileSync('sources.json', 'utf8')); const results = []; const snapshots = [];
fs.mkdirSync('../fixtures/corpus/live', { recursive: true });
for (const s of P) {
  const r = { name: s.name, group: s.group, kind: s.kind, locator: s.locator };
  try {
    if (s.kind === 'rss') { const g = await get(s.locator); const items = feedItems(g.text); r.status = g.status; r.items = items.length; r.latest = items[0]?.date;
      if (s.readArticle && items[0]?.link) { const art = await get(items[0].link); const rd = readable(art.text, art.url); r.articleChars = rd.chars; r.articleUrl = art.url; r.robotsAllowed = await allowed(art.url); if (s.snapshot && rd.chars >= 800) snapshots.push({ name: s.snapshot, url: art.url, html: art.text }); }
      r.ok = g.status === 200 && items.length >= 3; }
    else if (s.kind === 'web') { const g = await get(s.locator); const links = listingLinks(g.text, g.url, s.prefix).filter(u => !s.exclude || !new RegExp(s.exclude).test(u)); r.status = g.status; r.links = links.length; r.robotsListingAllowed = await allowed(s.locator);
      if (links[0] && s.readArticle) { const art = await get(links[s.articleIndex || 0]); const rd = readable(art.text, art.url); r.articleChars = rd.chars; r.articleUrl = art.url; r.robotsAllowed = await allowed(art.url); if (s.snapshot && rd.chars >= 800) snapshots.push({ name: s.snapshot, url: art.url, html: art.text }); }
      r.ok = g.status === 200 && links.length >= 3 && r.robotsListingAllowed; }
    else if (s.kind === 'hn_api') { const ids = JSON.parse((await get(s.locator + '/topstories.json')).text); const item = JSON.parse((await get(`${s.locator}/item/${ids[0]}.json`)).text); r.items = ids.length; r.sample = item.title; r.ok = ids.length >= 10 && !!item.title; }
    else if (s.kind === 'search_google_news') { const g = await get(s.locator); const items = feedItems(g.text); r.status = g.status; r.items = items.length; r.sampleLink = items[0]?.link;
      if (items[0]?.link) { const res = await get(items[0].link); r.redirectResolvedTo = new URL(res.url).host; r.resolvedToPublisher = !/news\.google\.com/.test(res.url); }
      r.ok = g.status === 200 && items.length >= 5; }
    else if (s.kind === 'search_hn') { const j = JSON.parse((await get(s.locator)).text); r.items = j.hits?.length; r.sample = j.hits?.[0]?.title; r.ok = (j.hits?.length || 0) >= 5; }
  } catch (e) { r.ok = false; r.error = String(e.message || e).slice(0, 140); }
  results.push(r); console.log(`${r.ok ? '✅' : '❌'} ${r.group.padEnd(10)} ${r.name.padEnd(32)} ${JSON.stringify({ items: r.items, links: r.links, art: r.articleChars, robots: r.robotsAllowed ?? r.robotsListingAllowed, latest: r.latest, gn: r.redirectResolvedTo, err: r.error })}`);
}
for (const sn of snapshots) fs.writeFileSync(`../fixtures/corpus/live/${sn.name}.html`, sn.html);
fs.writeFileSync('.out-sources.json', JSON.stringify(results, null, 1));
console.log('snapshots saved:', snapshots.map(s => s.name).join(', '));
