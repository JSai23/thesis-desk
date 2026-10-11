import { chromium } from 'playwright'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('design/prototype'); const vend = path.resolve('design/prototype-vendor');
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(4711);
const b = await chromium.launch({ channel: 'chrome', headless: true }); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
let external = 0;
await ctx.route('**/*', async route => { const u = route.request().url();
  if (u.startsWith('https://unpkg.com/')) { const name = u.includes('react-dom') ? 'react-dom.production.min.js' : u.includes('babel') ? 'babel.min.js' : 'react.production.min.js';
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(vend, name)), headers: { 'Access-Control-Allow-Origin': '*' } }); }
  if (u.startsWith('http://127.0.0.1:4711/') || u.startsWith('data:')) return route.continue();
  external++; return route.abort(); });
const p = await ctx.newPage(); await p.goto('http://127.0.0.1:4711/Research%20Workspace.dc.html');
await p.getByText('Today', { exact: true }).first().waitFor({ timeout: 20000 });
await p.screenshot({ path: 'prereq/.out-prototype.png' }); console.log('prototype rendered offline; blocked external requests:', external);
await b.close(); srv.close();
