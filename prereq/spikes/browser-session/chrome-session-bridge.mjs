// Decrypt this user's Chrome cookies for chosen domains (in memory only) and inject into a headless browser.
import { execFileSync } from 'node:child_process'; import crypto from 'node:crypto'; import os from 'node:os'; import fs from 'node:fs';
import { chromium } from 'playwright';
const [profile, domainsArg, url, out] = process.argv.slice(2);
const pass = execFileSync('security', ['find-generic-password','-w','-s','Chrome Safe Storage','-a','Chrome']).toString().trim();
const key = crypto.pbkdf2Sync(pass, 'saltysalt', 1003, 16, 'sha1');
const db = `${os.homedir()}/Library/Application Support/Google/Chrome/${profile}/Cookies`;
const tmp = `${os.tmpdir()}/rwc-${process.pid}.db`; fs.copyFileSync(db, tmp);
const likes = domainsArg.split(',').map(d => `host_key like '%${d}'`).join(' or ');
const rows = JSON.parse(execFileSync('sqlite3', ['-json', tmp, `select host_key,name,path,is_secure,is_httponly,expires_utc,samesite,hex(encrypted_value) ev from cookies where ${likes}`]).toString() || '[]');
fs.unlinkSync(tmp);
const cookies = [];
for (const r of rows) {
  const buf = Buffer.from(r.ev, 'hex'); if (buf.slice(0,3).toString() !== 'v10') continue;
  const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  let v = Buffer.concat([d.update(buf.slice(3)), d.final()]);
  if (v.length > 32) v = v.slice(32);            // Chrome ≥130 prefixes SHA-256(host)
  cookies.push({ name: r.name, value: v.toString('utf8'), domain: r.host_key, path: r.path, secure: !!r.is_secure, httpOnly: !!r.is_httponly,
    expires: r.expires_utc > 0 ? Math.floor(r.expires_utc/1e6 - 11644473600) : -1, sameSite: ['None','Lax','Strict'][r.samesite] || 'Lax' });
}
console.log('decrypted cookies:', cookies.length, '| session token present:', cookies.some(c => ['auth_token','li_at','SID','__Secure-1PSID'].includes(c.name)));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport:{width:1300,height:900}, userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36' });
await ctx.addCookies(cookies);
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForTimeout(8000);
console.log('landed:', new URL(page.url()).host + new URL(page.url()).pathname);
await page.screenshot({ path: out }); await browser.close();
