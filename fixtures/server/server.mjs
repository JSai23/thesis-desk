// Deterministic fixture server (RFC Appendix A / DEC-047). Routes by Host header: <site>.test:4700
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
import { DOCS, D12, FILLER_POSTS, LEDGER } from '../corpus/corpus.mjs';
const DIR = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(DIR, '..');
const PORT = +(process.env.FIXTURE_PORT || 4700);
const USERS = JSON.parse(fs.readFileSync(path.join(DIR, 'ledger-users.json'), 'utf8'));
let state; const reset = () => { state = { epoch: 1, fail: {}, sessions: new Map(), loads: {}, x: { sessions: new Set(), challenge: false, postLoads: {}, clicks: 0 } }; }; reset();
const SKELETON = fs.existsSync(path.join(ROOT, 'social/x-skeleton.html')) ? fs.readFileSync(path.join(ROOT, 'social/x-skeleton.html'), 'utf8') : '<article data-testid="tweet"><div data-testid="User-Name"></div><div data-testid="tweetText"><span></span></div><a><time></time></a></article>';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const docById = id => DOCS.find(d => d.id === id);
const parasOf = d => d.sameBodyAs ? (d.sameBodyAs === 'D12' ? D12.paras : parasOf(docById(d.sameBodyAs))) : d.parasByEpoch ? d.parasByEpoch[state.epoch] : d.paras;
const live = d => d.epoch.includes(state.epoch);
const nav = site => site === 'northwind' ? '<nav><a href="/">Home</a> <a href="/portfolio">Portfolio</a> <a href="/investments">Investments</a> <a href="/blog/">Blog</a></nav>' : '<nav><a href="/">Home</a></nav>';
const page = (site, title, body, extraHead = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${extraHead}</head><body>${nav(site)}<main>${body}</main><footer><p>© 2026 ${esc(site)}</p></footer></body></html>`;
const article = (d, paras) => `<article><h1>${esc(d.title)}</h1><p class="meta">${d.byline ? 'By ' + esc(d.byline) + ' · ' : ''}<time datetime="${d.date}">${d.date}</time></p>${paras.map(p => `<p>${esc(p)}</p>`).join('')}</article>`;
const send = (res, code, body, type = 'text/html; charset=utf-8', headers = {}) => { res.writeHead(code, { 'Content-Type': type, ...headers }); res.end(body); };
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]));
const rss = (site, items) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${site}</title><link>http://${site}.test:${PORT}/</link>${items.map(i => `<item><title>${esc(i.title)}</title><link>${i.link}</link><guid>${i.guid || i.link}</guid><pubDate>${new Date(i.date + 'T09:00:00Z').toUTCString()}</pubDate><description>${esc(i.desc || '')}</description></item>`).join('')}</channel></rss>`;
function listing(site, base) {
  const posts = DOCS.filter(d => d.site === site && live(d) && d.path.startsWith(base === '/' ? '/' : base)).map(d => [d.path, d.title]).concat(FILLER_POSTS[site] || []);
  return page(site, `${site} — posts`, `<h1>Posts</h1><ul>${posts.map(([p, t]) => `<li><a href="${p}">${esc(t)}</a></li>`).join('')}</ul>`);
}
async function body(req) { let b = ''; for await (const c of req) b += c; return b; }
const server = http.createServer(async (req, res) => {
  const host = (req.headers.host || '').split(':')[0]; const site = host.endsWith('.test') ? host.slice(0, -5) : '__root'; const url = new URL(req.url, 'http://x'); const p = url.pathname;
  state.loads[site] = (state.loads[site] || 0) + 1;
  // control API (any host)
  if (p.startsWith('/__control/')) { const b = req.method === 'POST' ? JSON.parse((await body(req)) || '{}') : {};
    if (p === '/__control/epoch') state.epoch = +b.n; else if (p === '/__control/fail') { if (b.status === 'off') delete state.fail[b.route]; else state.fail[b.route] = +b.status; }
    else if (p === '/__control/ledger/expire-sessions') state.sessions.clear(); else if (p === '/__control/reset') reset();
    else if (p === '/__control/x/challenge') state.x.challenge = !!b.on;
    else if (p === '/__control/x/clicked') { state.x.clicks++; }
    else if (p === '/__control/x/state') return send(res, 200, JSON.stringify({ postLoads: state.x.postLoads, clicks: state.x.clicks, sessions: state.x.sessions.size }), 'application/json');
    else if (p === '/__control/state') return send(res, 200, JSON.stringify({ epoch: state.epoch, fail: state.fail, sessions: state.sessions.size, loads: state.loads }), 'application/json');
    return send(res, 200, JSON.stringify({ ok: true, epoch: state.epoch }), 'application/json'); }
  const key = `${site}${p}`;
  // /broken/feed.xml fails (500) until the control API marks it healthy with status 200
  if (site === 'broken' && p === '/feed.xml') return state.fail[key] === 200 ? send(res, 200, rss('broken', [{ title: 'Broken feed is back', link: `http://broken.test:${PORT}/post-1`, date: '2026-09-28', desc: 'Back online.' }]), 'application/rss+xml') : send(res, state.fail[key] ?? 500, 'server error');
  if (site === 'broken' && p === '/post-1') return send(res, 200, page('broken', 'Broken feed is back', article({ title: 'Broken feed is back', date: '2026-09-28' }, DOCS[0].paras.slice(3, 8))));
  if (state.fail[key]) return send(res, state.fail[key], 'fixture failure');
  if (site === 'gone') return send(res, 404, 'not found');
  if (site === 'robots-blocked') return p === '/robots.txt' ? send(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain') : send(res, 200, listing('robots-blocked', '/'));
  if (p === '/robots.txt') return send(res, 200, 'User-agent: *\nAllow: /\n', 'text/plain');
  if (site === 'hn') { const ids = state.epoch === 1 ? [9001, 9002] : [9003, 9001, 9002];
    const items = { 9001: { id: 9001, type: 'story', by: 'fx', score: 120, title: 'Introducing Forge Agents', url: `http://stackforge.test:${PORT}/blog/introducing-forge-agents`, time: 1790150400 },
      9002: { id: 9002, type: 'story', by: 'fx', score: 15, title: 'My sourdough starter journal', url: `http://misc.test:${PORT}/sourdough.html`, time: 1790160000 },
      9003: { id: 9003, type: 'story', by: 'fx', score: 88, title: 'Stackforge raises $30M Series B', url: `http://stackforge.test:${PORT}/blog/series-b`, time: 1790668800 } };
    if (p === '/v0/topstories.json' || p === '/v0/newstories.json') return send(res, 200, JSON.stringify(ids), 'application/json');
    const m = p.match(/^\/v0\/item\/(\d+)\.json$/); if (m && items[m[1]] && ids.includes(+m[1])) return send(res, 200, JSON.stringify(items[m[1]]), 'application/json');
    return send(res, 404, 'null', 'application/json'); }
const ARCHIVE_TEXT = [["Gardeners in coastal towns report that late tomatoes ripened unevenly this season after a cool August.", "Several allotment groups now share seed-saving notes through printed newsletters left at the library desk.", "Volunteers plan a compost workshop near the river path once the autumn rains begin."], ["A regional choir rehearsed a program of folk songs collected from fishing villages along the northern coast.", "The conductor asked singers to learn the harmonies by ear before reading any printed scores.", "Tickets for the winter concert will be offered at the town hall box office in November."], ["Cyclists mapped a quieter route between the market square and the old railway bridge using painted markers.", "The council agreed to trim hedges that narrowed the lane near the primary school entrance.", "Riders are asked to dismount on the cobbled section beside the cathedral steps."], ["Bakers at the Saturday market compared sourdough starters kept alive for more than a decade.", "One stall rotated rye and spelt loaves to match the changing flour harvest each month.", "Leftover bread is donated to the shelter kitchen on Sunday mornings."], ["The astronomy club observed Saturn's rings through a borrowed telescope during a clear spell last week.", "Members recorded sketches of the planet alongside notes on humidity and wind speed.", "A beginner evening on star charts is scheduled for the first moonless night of the month."], ["Beekeepers inspected hives before the cold weather and reduced entrances to keep out wasps.", "Honey from heather-rich slopes was darker and stronger than the clover harvest from the valley.", "The association will lend extraction equipment to new members next spring."], ["Walkers restored a dry-stone wall on the hill path using stones gathered from a collapsed section.", "An experienced waller showed how to set through-stones every metre for strength.", "The group meets on alternate Sundays and welcomes anyone with sturdy gloves."], ["The lending library extended evening hours so students can use the quiet reading room after school.", "Donated atlases and old encyclopedias were sorted into a new reference corner by the windows.", "Librarians are cataloguing a box of handwritten parish records found in the attic."], ["Swimmers in the lido reported the water staying unusually warm into early September.", "Lifeguards added a morning lane session for older residents who prefer calmer water.", "Repainting of the changing huts will finish before the pool closes for winter."], ["Potters fired a batch of stoneware mugs in the shared kiln behind the community workshop.", "Glazes made from local ash produced speckled grey and green surfaces on several pieces.", "A sale of seconds will raise money for a new pottery wheel."], ["Birdwatchers counted migrating swallows gathering on telegraph wires above the estuary.", "Volunteers logged numbers each dawn to compare with records kept since the 1970s.", "The hide near the reed beds will reopen after repairs to its wooden walkway."], ["The repair café fixed lamps, toasters and a vintage radio during its monthly session at the church hall.", "Visitors learned to replace fuses and re-solder loose connections under supervision.", "Organisers hope to add a bicycle repair table at the next gathering."]]
  // archive.test (DEC-085 first-sync window / backfill): 12 neutral posts, one every 3 days from Sep 29 back to Aug 27
  if (site === 'archive') {
    const posts = Array.from({ length: 12 }, (_, i) => ({ n: i + 1, date: new Date(Date.UTC(2026, 8, 29 - 3 * i)).toISOString().slice(0, 10) }))
    if (p === '/feed.xml') return send(res, 200, rss('archive', posts.map(x => ({ title: `Archive note ${x.n}`, link: `http://archive.test:${PORT}/post-${x.n}`, date: x.date, desc: 'A note from the archive.' }))), 'application/rss+xml');
    const m = p.match(/^\/post-(\d+)$/); const x = m && posts.find(y => y.n === Number(m[1]));
    if (x) return send(res, 200, page('archive', `Archive note ${x.n}`, article({ title: `Archive note ${x.n}`, date: x.date }, ARCHIVE_TEXT[x.n - 1])));
  }
  if (site === 'signalwire' && p === '/feed.xml') return send(res, 200, rss('signalwire', DOCS.filter(d => d.site === 'signalwire' && live(d)).map(d => ({ title: d.title, link: `http://signalwire.test:${PORT}${d.path}`, date: d.date, desc: parasOf(d)[0].split(',')[0] + '.' }))), 'application/rss+xml');
  if (site === 'news-search' && p === '/rss') { const items = [{ title: 'Lumen Legal raises $18M Series A - VLN', link: `http://news-search.test:${PORT}/articles/a1`, date: '2026-09-22' }, { title: 'Brightdesk moves to per-resolution pricing - VLN', link: `http://news-search.test:${PORT}/articles/a2`, date: '2026-09-24' }, { title: 'Unresolvable story - Somewhere', link: `http://news-search.test:${PORT}/articles/broken`, date: '2026-09-25', desc: 'A headline whose publisher link cannot be resolved.' }];
    if (state.epoch === 2) items.unshift({ title: 'Stackforge raises $30M Series B - Stackforge', link: `http://news-search.test:${PORT}/articles/a3`, date: '2026-09-29' });
    return send(res, 200, rss('news-search', items), 'application/rss+xml'); }
  if (site === 'news-search' && p.startsWith('/articles/')) { const map = { a1: `http://vln.test:${PORT}/2026/09/22/lumen-legal-series-a`, a2: `http://vln.test:${PORT}/2026/09/24/brightdesk-pricing`, a3: `http://stackforge.test:${PORT}/blog/series-b` }; const to = map[p.split('/')[2]];
    return to ? send(res, 302, '', 'text/plain', { Location: to }) : send(res, 404, 'not found'); }
  if (site === 'alerts') { const m = p.match(/^\/burst-(\d)$/); if (m) { const n = m[1]; return send(res, 200, page('alerts', `Burstco ${n} seed`, article({ title: `Burstco ${n} raises seed`, date: '2026-09-28' }, [`Northwind Ventures led a $${n} million seed round in Burstco ${n}.`, ...DOCS[0].paras.slice(3, 7)]))); } }
  if (site === 'live') { const f = path.join(ROOT, 'corpus/live', path.basename(p) + '.html'); return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f)) : send(res, 404, 'not found'); }
  if (site === 'ledger') {
    const sess = state.sessions.get(cookies(req).ledger_session); const user = sess && USERS.find(u => u.email === sess);
    if (p === '/login' && req.method === 'POST') { const f = new URLSearchParams(await body(req)); const u = USERS.find(x => x.email === f.get('email') && x.password === f.get('password'));
      if (!u) return send(res, 401, page('ledger', 'Sign in', '<p>Wrong email or password.</p>')); const sid = crypto.randomBytes(16).toString('hex'); state.sessions.set(sid, u.email);
      return send(res, 302, '', 'text/plain', { Location: '/', 'Set-Cookie': `ledger_session=${sid}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax` }); }
    if (p === '/login') return send(res, 200, page('ledger', 'Sign in to The Ledger', '<h1>Sign in</h1><form method="post" action="/login"><label>Email <input name="email" type="email"></label><label>Password <input name="password" type="password"></label><button type="submit">Sign in</button></form>'));
    if (p === '/' ) return send(res, 200, page('ledger', 'The Ledger', `<h1>The Ledger</h1>${user ? `<p>Signed in as ${esc(user.email)}</p>` : '<p><a href="/login">Sign in</a></p>'}<ul>${[LEDGER.d14, LEDGER.d14p, LEDGER.editors].map(a => `<li><a href="${a.path}">${esc(a.title)}</a></li>`).join('')}</ul>`));
    const doc = { [LEDGER.d14.path]: 'd14', [LEDGER.d14p.path]: 'd14p', [LEDGER.editors.path]: 'editors' }[p];
    if (doc === 'editors') return send(res, 200, page('ledger', LEDGER.editors.title, article({ title: LEDGER.editors.title, date: '2026-09-20' }, LEDGER.editors.paras)));
    if (doc === 'd14') { const a = LEDGER.d14; return send(res, 200, page('ledger', a.title, user?.entitled ? article({ title: a.title, date: '2026-09-28' }, [a.teaser, ...a.full]) : article({ title: a.title, date: '2026-09-28' }, [a.teaser]) + '<div class="paywall"><p>Sign in to keep reading.</p><a href="/login">Sign in</a></div>')); }
    if (doc === 'd14p') { const a = LEDGER.d14p; return send(res, 200, page('ledger', a.title, article({ title: a.title, date: '2026-09-28' }, [a.teaser]) + '<div class="paywall"><p>Upgrade to Ledger Pro to keep reading.</p></div>')); }
    return send(res, 404, 'not found'); }

  // ---------------------------------------------------------------- x.test / linkedin.test (user-sent posts only; DEC-063)
  if (site === 'x' || site === 'linkedin') {
    const sid = cookies(req)[site + '_session']
    const signedIn = sid && state.x.sessions.has(site + ':' + sid)
    if (p === '/login' && req.method === 'POST') { const f = new URLSearchParams(await body(req)); const tok = crypto.randomBytes(8).toString('hex'); state.x.sessions.add(site + ':' + tok)
      return send(res, 302, '', 'text/plain', { Location: '/home', 'Set-Cookie': `${site}_session=${tok}; Path=/; Max-Age=2592000; SameSite=Lax` }) }
    if (p === '/login') return send(res, 200, `<!doctype html><html><head><title>Log in to ${site.toUpperCase()}</title></head><body><main><h1>Log in to ${site === 'x' ? 'X' : 'LinkedIn'}</h1><form method="post" action="/login"><input name="user" placeholder="Phone, email or username"><input name="password" type="password"><button type="submit">Log in</button></form></main></body></html>`)
    const m = p.match(/^\/([^/]+)\/status\/(\d+)$/) || p.match(/^\/posts\/([^/]+)-(\d+)$/)
    if (m) {
      state.x.postLoads[p] = (state.x.postLoads[p] || 0) + 1
      if (!signedIn) return send(res, 200, `<!doctype html><html><head><title>Log in to ${site === 'x' ? 'X' : 'LinkedIn'}</title></head><body><main><h1>Sign in to see this post</h1><a href="/login">Log in</a></main></body></html>`)
      if (state.x.challenge) return send(res, 200, `<!doctype html><html><head><title>Verify</title></head><body><main><h1>Verify it’s you</h1><p>Solve the challenge to continue.</p></main></body></html>`)
      const handle = m[1], id = m[2]
      const POSTS = { 101: 'Legal buyers keep telling us they want one contract-review tool, but most of our customers now run Lumen Legal next to a second vendor for a year before choosing.', 102: 'Per-resolution pricing is eating the BPO playbook: Brightdesk says 60% of its new contracts are priced per resolved conversation.', 103: 'Claims intake is the next wedge for vertical AI; carriers want vendors who take the SLA, not just sell software.' }
      const text = POSTS[id] || `Post ${id} from ${handle}.`
      let post = SKELETON.replace(/data-testid="User-Name">/, `data-testid="User-Name"><span>Dana Okafor</span> <span>@${esc(handle)}</span>`)
        .replace(/(data-testid="tweetText"><span[^>]*>)(<\/span>)/, `$1${esc(text)}$2`)
      const ti = post.indexOf('<time'); const ai = post.lastIndexOf('<a', ti)
      if (ti > 0) { post = post.slice(0, ti) + `<time datetime="2026-09-28T15:00:00.000Z">Sep 28</time>` + post.slice(post.indexOf('</time>', ti) + 7); if (ai > 0) post = post.slice(0, ai) + `<a href="/${esc(handle)}/status/${id}"` + post.slice(ai + 2) }
      return send(res, 200, `<!doctype html><html><head><title>${esc(handle)} on X</title></head><body><nav><a href="/home">Home</a><span>Signed-in reader · reader@x.test</span></nav><main role="main"><div id="root">Loading…</div><template id="post">${post}</template></main>
<script>document.addEventListener('click', () => fetch('/__control/x/clicked', { method: 'POST' }));
if ((localStorage.getItem('${site}_token') || '').startsWith('tk_')) { document.getElementById('root').replaceWith(document.getElementById('post').content.cloneNode(true)) } else { document.getElementById('root').textContent = 'Sign in to see this post' }</script></body></html>`)
    }
    if (p === '/home') return send(res, 200, `<!doctype html><html><head><title>Home</title></head><body><main><h1>${signedIn ? 'Home timeline' : 'Log in to continue'}</h1></main>${signedIn ? `<script>localStorage.setItem('${site}_token','tk_${crypto.createHash('sha256').update(String(sid)).digest('hex').slice(0, 24)}')</script>` : ''}</body></html>`)
    if (p === '/' || /^\/[^/]+\/?$/.test(p) || p.startsWith('/in/')) return send(res, 200, `<!doctype html><html><head><title>${site}</title></head><body><main><h1>Profile</h1></main></body></html>`)
    return send(res, 404, 'not found')
  }
  // listings
  if ((site === 'northwind' || site === 'stackforge') && (p === '/blog/' || p === '/blog')) return send(res, 200, listing(site, '/blog/'));
  if (site === 'northwind' && p === '/') return send(res, 200, listing(site, '/blog/'));
  if (site === 'vln' && p === '/') return send(res, 200, listing('vln', '/'));
  if (site === 'stackforge' && p === '/') return send(res, 200, listing(site, '/blog/'));
  // filler posts
  const fp = (FILLER_POSTS[site] || []).find(([fpth]) => fpth === p); if (fp) return send(res, 200, page(site, fp[1], article({ title: fp[1], date: '2026-09-10' }, DOCS[0].paras.slice(3, 8))));
  // documents
  const d = DOCS.find(x => x.site === site && x.path === p && live(x)); if (d) return send(res, 200, page(site, d.title, article(d, parasOf(d))));
  return send(res, 404, page(site, 'Not found', '<p>Not found</p>'));
});
// parallel test workers each run their own server on FIXTURE_LISTEN_PORT; pages still say :4700 (the app maps *.test there)
const LISTEN = +(process.env.FIXTURE_LISTEN_PORT || PORT);
server.listen(LISTEN, '127.0.0.1', () => console.log(`fixtures on 127.0.0.1:${LISTEN} (sites: *.test:${PORT})`));
export default server;
