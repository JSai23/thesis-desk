const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
let clicks = 0;
ipcMain.handle('rw:invoke', (_e, cmd, payload) => cmd === 'counter.inc' ? { ok: true, value: ++clicks } : { ok: false });
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 900, height: 600, titleBarStyle: 'hiddenInset', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
  w.loadFile('index.html');
});
app.on('window-all-closed', () => app.quit());
