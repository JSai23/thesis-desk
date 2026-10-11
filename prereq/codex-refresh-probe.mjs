import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'); const f = path.join(home, 'auth.json'); const lock = f + '.rw-lock';
const fd = fs.openSync(lock, 'wx');                         // cross-process exclusive lock (fails if held)
try {
  const before = JSON.parse(fs.readFileSync(f, 'utf8')); const mode = fs.statSync(f).mode & 0o777;
  const r = await fetch('https://auth.openai.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'app_EMoamEEZ73f0CkXaXp7hrann', grant_type: 'refresh_token', refresh_token: before.tokens.refresh_token, scope: 'openid profile email' }) });
  const j = await r.json();
  if (!r.ok) { console.log('refresh HTTP', r.status, j.error || ''); process.exit(2); }
  const after = { ...before, tokens: { ...before.tokens, id_token: j.id_token ?? before.tokens.id_token, access_token: j.access_token ?? before.tokens.access_token, refresh_token: j.refresh_token ?? before.tokens.refresh_token }, last_refresh: new Date().toISOString() };
  const tmp = f + '.rw-tmp-' + process.pid; fs.writeFileSync(tmp, JSON.stringify(after, null, 2), { mode }); fs.renameSync(tmp, f);
  console.log('refresh HTTP', r.status, '| rotated refresh token:', !!j.refresh_token && j.refresh_token !== before.tokens.refresh_token, '| new access token:', j.access_token !== before.tokens.access_token, '| keys preserved:', Object.keys(after).join(','));
} finally { fs.closeSync(fd); fs.unlinkSync(lock); }
