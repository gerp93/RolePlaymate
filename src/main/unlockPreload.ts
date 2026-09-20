import { contextBridge, ipcRenderer } from 'electron';

// The unlock window's entire API surface: try a password, or give up. Deliberately separate
// from preload.ts -- this window exists before the database, and so before any of the app's
// real IPC handlers, and must never be able to reach them.
contextBridge.exposeInMainWorld('unlock', {
  submit: (password: string) => ipcRenderer.invoke('unlock:submit', password) as Promise<boolean>,
  cancel: () => ipcRenderer.send('unlock:cancel'),
});
