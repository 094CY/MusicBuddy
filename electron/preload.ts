import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  close: () => ipcRenderer.invoke('window-close'),
  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('window-set-always-on-top', flag),
  toggleFullscreen: () => ipcRenderer.invoke('window-toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window-is-fullscreen'),
  onFullscreenChanged: (callback: (isFs: boolean) => void) => {
    ipcRenderer.on('fullscreen-changed', (_event, isFs) => callback(isFs));
  },
  isElectron: true,
});
