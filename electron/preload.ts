import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAdbPath: () => ipcRenderer.invoke('get-adb-path'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeApp: () => ipcRenderer.send('close-app'),
  onUpdateStatus: (callback: (data: { status: string; progress?: number; version?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('update-status', handler);
    return () => { ipcRenderer.removeListener('update-status', handler); };
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
});

declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      getAdbPath: () => Promise<string>;
      minimizeWindow: () => void;
      closeApp: () => void;
      onUpdateStatus: (callback: (data: { status: string; progress?: number; version?: string }) => void) => () => void;
      installUpdate: () => Promise<void>;
      checkUpdate: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
