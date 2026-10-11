// Section 0 prerequisite runner: node prereq/run.mjs  → prereq/status.json
import { execSync, spawnSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import net from 'node:net';
const S = {}; const set = (id, ok, evidence, blocking = true, checkpoint = null) => { S[id] = { status: ok ? 'GREEN' : 'RED', blocking, checkpoint, evidence, checkedAt: new Date().toISOString() }; console.log(`${ok ? '🟢' : '🔴'} ${id.padEnd(15)} ${evidence}`); };
const sh = (c, o = {}) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o }).trim(); } catch (e) { return 'ERR:' + (e.stderr || e.message).toString().slice(0, 200); } };
const v = sh('sw_vers -productVersion'); set('PRQ-ENV-01', parseFloat(v) >= 14 && sh('launchctl managername') === 'Aqua', `macOS ${v}, Aqua`);
set('PRQ-ENV-02', !sh('xcode-select -p').startsWith('ERR') && !sh('clang --version').startsWith('ERR'), sh('xcode-select -p'));
set('PRQ-ENV-03', /^v24\./.test(process.version) && +sh('npm -v').split('.')[0] >= 11, `node ${process.version}, npm ${sh('npm -v')}`);
set('PRQ-ENV-04', sh('git -C .. rev-parse --is-inside-work-tree') === 'true' && sh('git -C .. check-ignore prereq/.env.local') === 'prereq/.env.local', 'git repo; .env.local ignored');
const el = sh('node checks-electron.mjs', { timeout: 180000 }); let ej = {}; try { ej = JSON.parse(el); } catch {}
set('PRQ-ENV-05', ej.run1?.status === 'clicked' && ej.run1?.shotBytes > 1000, 'Playwright drove Electron window (click + screenshot)');
set('PRQ-ENV-06', ej.run1?.fts5 === 1 && ej.run1?.walMode === 'wal', 'better-sqlite3 in Electron: FTS5 + WAL');
set('PRQ-ENV-07', ej.run2?.safeStorageRoundTrip && ej.run2?.safeStoragePrevRun === 'rw-probe-secret', 'safeStorage round-trip across relaunch, no prompt');
set('PRQ-ENV-08', !!ej.run1?.notificationsSupported, 'Notification.isSupported()', false);
set('PRQ-ENV-09', +sh("df -k ~ | tail -1 | awk '{print $4}'") > 10 * 1048576, sh("df -h ~ | tail -1 | awk '{print $4}'") + ' free');
const free = await new Promise(r => { const s = net.createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true))).listen(4700, '127.0.0.1'); }); set('PRQ-ENV-10', free, 'port 4700 free');
const reach = u => sh(`curl -s -o /dev/null -w "%{http_code}" -m 15 ${u}`) === '200'; set('PRQ-ENV-11', reach('https://registry.npmjs.org/') && reach('https://unpkg.com/react@18.3.1/umd/react.production.min.js'), 'npm registry + unpkg reachable');
const luna = sh('node ../prereq/spikes/luna/luna-probe.mjs', { timeout: 120000 }); const auth = JSON.parse(fs.readFileSync(os.homedir() + '/.codex/auth.json', 'utf8'));
set('PRQ-AI-01', /\[text\] HTTP 200[^\n]*LUNA-OK/.test(luna) && /\[json_schema\] HTTP 200/.test(luna) && /\[effort-none\] HTTP 200/.test(luna) && /"reason":0/.test(luna) && /chatgpt/i.test(auth.auth_mode), 'gpt-6-luna via Codex ChatGPT sign-in: text, json_schema, effort none');
const lim = sh('node ../prereq/spikes/luna/luna-parallel-and-limits.mjs', { timeout: 180000 }); const used = +(lim.match(/x-codex-primary-used-percent=(\d+)/) || [])[1];
set('PRQ-AI-02', /8 parallel: (200,){7}200/.test(lim) && used < 70, `8 parallel OK; weekly used ${used}%`);
const ref = sh('node codex-refresh-probe.mjs', { timeout: 60000 }); set('PRQ-AI-03', /refresh HTTP 200/.test(ref) && /Logged in using ChatGPT/.test(sh('codex login status 2>&1')), ref.replace(/\n/g, ' ').slice(0, 120));
const T = fs.mkdtempSync(os.tmpdir() + '/rw-eval-'); const ev = sh(`claude -p "Reply exactly PRQ-EVAL-OK" --model opus --output-format json`, { cwd: T, timeout: 180000 }); const ev2 = spawnSync('codex', ['exec', '--skip-git-repo-check', '-m', 'gpt-6-luna', '-s', 'read-only', '--output-last-message', T + '/m.txt', 'Reply exactly PRQ-EVAL-OK'], { cwd: T, timeout: 240000 });
const evOk = /"result":"PRQ-EVAL-OK"/.test(ev); const ev2Ok = fs.existsSync(T + '/m.txt') && fs.readFileSync(T + '/m.txt', 'utf8').trim() === 'PRQ-EVAL-OK';
set('PRQ-EVAL-01', evOk || ev2Ok, `claude -p: ${evOk ? 'OK' : 'FAIL'}; codex exec fallback: ${ev2Ok ? 'OK' : 'FAIL'}`);
const sp = sh('node sources-probe.mjs', { timeout: 600000 }); const rs = JSON.parse(fs.readFileSync('.out-sources.json', 'utf8')); const okN = n => rs.find(x => x.name === n)?.ok;
const blogsOk = rs.filter(x => x.group === 'blogs' && x.ok).length, vcOk = rs.filter(x => x.group === 'vc' && x.ok).length;
set('PRQ-NET-01', ['Hacker News API', 'HN front page RSS', 'Y Combinator blog', 'TechCrunch Startups', 'Crunchbase News', 'Google News: Series A', 'HN Algolia: Show HN'].every(okN) && blogsOk >= 10 && vcOk >= 2 && (okN('Vercel blog') || okN('Linear changelog')), `${rs.filter(x => x.ok).length}/${rs.length} sources OK (blogs ${blogsOk}, VC ${vcOk})`);
const man = JSON.parse(fs.readFileSync('../fixtures/corpus/live/manifest.json', 'utf8')); set('PRQ-FIX-01', Object.keys(man.files).length >= 5, `${Object.keys(man.files).length} live article snapshots with sha256`);
const ft = sh('node fixtures-selftest.mjs', { timeout: 180000 }); set('PRQ-FIX-02', /0 failed/.test(ft), (ft.match(/fixtures selftest: .*/) || [ft])[0]);
const H = f => sh(`shasum -a 256 "${f}" | cut -d' ' -f1`); set('PRQ-DESIGN-01', H('../design/prototype/Research Workspace.dc.html') === '18de5923246521c1105fd80e733a1bbc33d2dc2df316b5f7a478a04f97355e93' && H('../Research workspace prototype.zip') === 'de39eebba436f2312788dbd04dfd456dbd60d30cf0a214650e5f78412d7683aa', 'prototype hashes match');
set('PRQ-DESIGN-02', /blocked external requests: 0/.test(sh('cd .. && node prereq/design-probe.mjs', { timeout: 120000 })), 'prototype renders offline from vendored scripts');
const spike = sh('cd spike-check && npx electron-builder --mac dir --publish never >/dev/null 2>&1 && rm -rf ~/Applications/"RW Spike.app" && cp -R "dist/mac-arm64/RW Spike.app" ~/Applications/ && node drive.mjs packaged "$HOME/Applications/RW Spike.app/Contents/MacOS/RW Spike"; rm -rf ~/Applications/"RW Spike.app"', { timeout: 600000 });
set('PRQ-SPIKE-01', /\[packaged\] status: Saved #1/.test(spike) && /isPackaged: true/.test(spike), 'packaged .app installed, driven via Playwright, removed');
const tracked = sh('git -C .. ls-files'); set('PRQ-DOC-01', ['docs/RFC.md', 'docs/Decisions.md', 'docs/Memory.md', 'design/prototype/Research Workspace.dc.html', 'design/prototype-vendor/react.production.min.js'].every(f => tracked.split('\n').includes(f)), 'inputs + docs tracked in git');
const em = sh('node email-probe.mjs', { timeout: 240000 }); let ej2 = {}; try { ej2 = JSON.parse(fs.readFileSync('.out-email.json', 'utf8')); } catch {}
set('PRQ-EMAIL-01', !!ej2.ok, 'Gmail IMAP login, RW-Fixtures append/search/trash-by-UID, SMTP round trip', true, 'CP-EMAIL');
set('PRQ-EMAIL-02', !!ej2.strictlyvc && fs.existsSync('../fixtures/email/strictlyvc-live.eml'), `StrictlyVC issue in Gmail (${ej2.strictlyvcSender || 'none'})`, true, 'CP-EMAIL');
let xj = {}; try { xj = JSON.parse(fs.readFileSync('.out-x.json', 'utf8')); } catch {}
set('PRQ-AUTH-01', !!xj.ok && fs.existsSync('../fixtures/social/x-skeleton.html') && xj.skeletonHasIdentity === false, `X post via Chrome bridge (verified once at CP-BROWSER; re-run: node x-post-probe.mjs "<Chrome profile>" <url>)`, true, 'CP-BROWSER');
set('PRQ-AUTH-02', false, 'LinkedIn: not signed in to LinkedIn in Chrome (optional)', false, 'CP-BROWSER');
fs.writeFileSync('status.json', JSON.stringify(S, null, 1));
const gate = Object.values(S).every(x => x.status === 'GREEN' || !x.blocking || x.checkpoint);
console.log(`\nBUILD_GATE = ${gate ? 'GREEN' : 'RED'}  (checkpoint items excluded per RFC §0.5)`);
