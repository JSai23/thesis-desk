// PRQ-EMAIL-01/02 probe. Reads prereq/.env.local (setup/test only — the app never reads this file).
import { ImapFlow } from 'imapflow'; import nodemailer from 'nodemailer'; import fs from 'node:fs'; import crypto from 'node:crypto';
const env = Object.fromEntries(fs.readFileSync(new URL('./.env.local', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const user = env.RW_EMAIL_USER, pass = env.RW_EMAIL_PASS.replace(/\s/g, ''), to = env.RW_EMAIL_RECIPIENT || user;
const out = { ok: false, steps: {} }; const step = (k, v) => { out.steps[k] = v; console.log(`${v ? '✅' : '❌'} ${k}`); };
const imap = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
await imap.connect(); step('imap login', true);
const boxes = await imap.list(); const trash = boxes.find(b => b.specialUse === '\\Trash')?.path; step(`trash folder found (${trash})`, !!trash);
if (!boxes.some(b => b.path === 'RW-Fixtures')) await imap.mailboxCreate('RW-Fixtures'); step('label RW-Fixtures exists', true);
const token = crypto.randomBytes(6).toString('hex'); const mid = `<rw-probe-${token}@fixtures.research-workspace.test>`;
const raw = `From: RW Probe <probe@fixtures.research-workspace.test>\r\nTo: ${user}\r\nSubject: RW probe ${token}\r\nMessage-ID: ${mid}\r\nDate: ${new Date().toUTCString()}\r\n\r\nProbe ${token}\r\n`;
const app = await imap.append('RW-Fixtures', raw, ['\\Seen']); step(`APPEND into RW-Fixtures (uid ${app.uid})`, !!app.uid);
let lock = await imap.getMailboxLock('RW-Fixtures'); try { const found = await imap.search({ header: { 'message-id': mid } }, { uid: true }); step('SEARCH finds appended message by Message-ID', found.includes(app.uid));
  await imap.messageMove(String(app.uid), trash, { uid: true }); step('moved appended message to Trash by its UID', true); } finally { lock.release(); }
const smtp = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
const smid = `<rw-probe-send-${token}@research-workspace.local>`; await smtp.sendMail({ from: user, to, subject: `Research Workspace setup check ${token}`, text: 'Automated setup check. This message is moved to Trash automatically.', messageId: smid }); step('SMTP send to yourself', true);
let uid = null; for (let i = 0; i < 24 && !uid; i++) { await new Promise(r => setTimeout(r, 5000)); lock = await imap.getMailboxLock('INBOX'); try { const r = await imap.search({ header: { 'message-id': smid } }, { uid: true }); if (r.length) { uid = r[0]; await imap.messageMove(String(uid), trash, { uid: true }); } } finally { lock.release(); } }
step('sent message arrived in INBOX and moved to Trash by UID', !!uid);
lock = await imap.getMailboxLock('INBOX'); let svc = []; try { const since = new Date(Date.now() - 30 * 864e5); svc = await imap.search({ from: 'strictlyvc', since }, { uid: true });
  // only real issues count: subscription confirmations and welcome mails carry no newsletter content (DEC-080)
  const issues = []; for (const u of svc) { const m = await imap.fetchOne(String(u), { envelope: true }, { uid: true }); if (!/confirm|verify|welcome|subscription/i.test(m.envelope.subject || '')) issues.push(u) } svc = issues } finally { lock.release(); }
step(`StrictlyVC issues in last 30 days: ${svc.length}`, svc.length > 0);
if (svc.length) { lock = await imap.getMailboxLock('INBOX'); try { const m = await imap.fetchOne(String(svc[svc.length - 1]), { source: true, envelope: true }, { uid: true }); fs.mkdirSync('../fixtures/email', { recursive: true }); fs.writeFileSync('../fixtures/email/strictlyvc-live.eml', m.source); console.log('   saved latest StrictlyVC issue from', m.envelope.from?.[0]?.address); out.strictlyvcSender = m.envelope.from?.[0]?.address; } finally { lock.release(); } }
await imap.logout(); out.ok = Object.entries(out.steps).filter(([k]) => !k.startsWith('StrictlyVC')).every(([, v]) => v); out.strictlyvc = svc.length > 0;
fs.writeFileSync('.out-email.json', JSON.stringify(out, null, 1));
