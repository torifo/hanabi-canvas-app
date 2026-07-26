import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('hanabiDesktop', { platform: process.platform });

ipcRenderer.on('hanabi:set-muted', (_event, muted: unknown) => {
  if (typeof muted === 'boolean') {
    window.dispatchEvent(new CustomEvent('hanabi:mute', { detail: muted }));
  }
});
