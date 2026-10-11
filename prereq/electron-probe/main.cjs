const { app, BrowserWindow, safeStorage, Notification, ipcMain } = require('electron');
const path = require('path'); const fs = require('fs'); const os = require('os');
app.setPath('userData', path.join(os.tmpdir(), 'rw-electron-probe'));
const results = {};
ipcMain.handle('probe:results', () => results);
app.whenReady().then(() => {
  try { const Database = require('better-sqlite3'); const db = new Database(':memory:');
    const wal = new Database(path.join(os.tmpdir(), 'rw-probe.sqlite')); results.walMode = wal.pragma('journal_mode = WAL', { simple: true }); wal.close();
    db.exec("CREATE VIRTUAL TABLE t USING fts5(x); INSERT INTO t VALUES ('legal ai startup raises');");
    results.fts5 = db.prepare("SELECT count(*) c FROM t WHERE t MATCH 'startup'").get().c; } catch (e) { results.sqliteError = e.message; }
  try { results.safeStorageAvailable = safeStorage.isEncryptionAvailable();
    const enc = safeStorage.encryptString('rw-probe-secret'); const f = path.join(app.getPath('userData'), 'probe.bin');
    const prev = fs.existsSync(f) ? safeStorage.decryptString(fs.readFileSync(f)) : null; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, enc);
    results.safeStorageRoundTrip = safeStorage.decryptString(enc) === 'rw-probe-secret'; results.safeStoragePrevRun = prev; } catch (e) { results.safeStorageError = e.message; }
  results.notificationsSupported = Notification.isSupported();
  const w = new BrowserWindow({ width: 600, height: 400, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true } });
  w.loadURL('data:text/html,<body style="background:%23224;color:%23fff;font-family:sans-serif"><h1>Probe</h1><button id=b>Go</button><p id=o role=status>idle</p><script>b.onclick=()=>o.textContent="clicked"</script></body>');
});
