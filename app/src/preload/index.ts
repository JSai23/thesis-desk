// The only renderer bridge: window.rw.invoke(command, payload) and window.rw.on(event, handler) (RFC §1B.3).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('rw', {
  invoke: (command: string, payload?: unknown) => ipcRenderer.invoke('rw:invoke', command, payload ?? {}),
  on: (event: string, handler: (payload: unknown) => void) => {
    const fn = (_e: IpcRendererEvent, name: string, payload: unknown) => { if (name === event || event === '*') handler(event === '*' ? { event: name, payload } : payload) }
    ipcRenderer.on('rw:event', fn)
    return () => { ipcRenderer.removeListener('rw:event', fn) }
  }
})
