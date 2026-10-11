const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('probe', { results: () => ipcRenderer.invoke('probe:results') });
