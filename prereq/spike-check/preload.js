const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rw', { invoke: (c, p) => ipcRenderer.invoke('rw:invoke', c, p) });
