// PRQ-AUTH-01: read ONE user-sent X post headless through the Chrome session bridge (cookies for x.com only, in memory).
import { execFileSync } from 'node:child_process'; import crypto from 'node:crypto'; import os from 'node:os'; import fs from 'node:fs';
import { chromium } from 'playwright';
const [profile, url] = process.argv.slice(2);
const pass = execFileSync('security', ['find-generic-password','-w','-s','Chrome Safe Storage','-a','Chrome']).toString().trim();
const key = crypto.pbkdf2Sync(pass, 'saltysalt', 1003, 16, 'sha1');
const tmp = `${os.tmpdir()}/rwc-${process.pid}.db`; fs.copyFileSync(`${os.homedir()}/Library/Application Support/Google/Chrome/${profile}/Cookies`, tmp);
const rows = JSON.parse(execFileSync('sqlite3', ['-json', tmp, "select host_key,name,path,is_secure,is_httponly,expires_utc,samesite,hex(encrypted_value) ev from cookies where host_key like '%x.com'"]).toString() || '[]'); fs.unlinkSync(tmp);
const cookies = rows.filter(r => Buffer.from(r.ev,'hex').slice(0,3).toString()==='v10').map(r => { const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16,0x20)); let v = Buffer.concat([d.update(Buffer.from(r.ev,'hex').slice(3)), d.final()]); if (v.length>32) v=v.slice(32);
  return { name:r.name, value:v.toString('utf8'), domain:r.host_key, path:r.path, secure:!!r.is_secure, httpOnly:!!r.is_httponly, expires: r.expires_utc>0?Math.floor(r.expires_utc/1e6-11644473600):-1, sameSite:['None','Lax','Strict'][r.samesite]||'Lax' }; });
const b = await chromium.launch({ channel:'chrome', headless:true }); const ctx = await b.newContext({ userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36' });
await ctx.addCookies(cookies); const p = await ctx.newPage(); let loads = 0; p.on('framenavigated', f => { if (f === p.mainFrame()) loads++; });
await p.goto(url, { waitUntil:'domcontentloaded', timeout:45000 }); await p.waitForSelector('article[data-testid="tweet"]', { timeout:20000 });
const art = p.locator('article[data-testid="tweet"]').first();
const post = { authorFound: !!(await art.locator('[data-testid="User-Name"]').innerText().catch(()=>'')), textChars: (await art.locator('[data-testid="tweetText"]').innerText().catch(()=>'')).length, time: await art.locator('time').getAttribute('datetime').catch(()=>null), permalink: await art.locator('a[href*="/status/"]:has(time)').getAttribute('href').catch(()=>null) };
const res = { url, topLevelPageLoads: loads, signedIn: !/login/.test(p.url()), ...post, ok: post.authorFound && post.textChars > 0 && !!post.time && !!post.permalink };
if (res.ok) { const skel = await art.evaluate(el => { const c = el.cloneNode(true); const walk = n => { for (const k of [...n.childNodes]) { if (k.nodeType === 3) k.remove(); else if (k.nodeType === 1) { if (['SCRIPT','STYLE','IMG','VIDEO','SVG','svg'].includes(k.tagName)) { k.remove(); continue; } for (const a of [...k.attributes]) if (!['class','role','data-testid'].includes(a.name)) k.removeAttribute(a.name); walk(k); } else k.remove(); } }; walk(c); return '<!doctype html><html><body><main>' + c.outerHTML + '</main></body></html>'; });
  const ident = (process.env.RW_X_IDENTITY || '').split(',').map(w => w.trim()).filter(Boolean).some(w => skel.toLowerCase().includes(w.toLowerCase())) // the signed-in handle(s), from the harness env; res.skeletonBytes = skel.length; res.skeletonHasIdentity = ident;
  if (!ident) { fs.mkdirSync('../fixtures/social', { recursive: true }); fs.writeFileSync('../fixtures/social/x-skeleton.html', skel); } }
console.log(JSON.stringify(res, null, 1)); fs.writeFileSync('.out-x.json', JSON.stringify(res));
fs.mkdirSync('../app/resources/platforms', { recursive:true }); fs.writeFileSync('../app/resources/platforms/x.json', JSON.stringify({ platform:'x', verified:new Date().toISOString(), post:'article[data-testid="tweet"]', author:'[data-testid="User-Name"]', text:'[data-testid="tweetText"]', time:'time[datetime]', permalink:'a[href*="/status/"]:has(time)' }, null, 2));
await b.close();
