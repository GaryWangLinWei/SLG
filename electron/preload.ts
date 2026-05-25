import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAdbPath: () => ipcRenderer.invoke('get-adb-path'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeApp: () => ipcRenderer.send('close-app'),
  onUpdateStatus: (callback: (data: { status: string; progress?: number; version?: string }) => void) => {
    ipcRenderer.on('update-status', (_event, data) => callback(data));
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
});

declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      getAdbPath: () => Promise<string>;
      minimizeWindow: () => void;
      closeApp: () => void;
      onUpdateStatus: (callback: (data: { status: string; progress?: number; version?: string }) => void) => void;
      installUpdate: () => void;
      checkUpdate: () => void;
    };
  }
}
