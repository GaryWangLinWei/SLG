import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAdbPath: () => ipcRenderer.invoke('get-adb-path'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeApp: () => ipcRenderer.send('close-app')
});

declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      getAdbPath: () => Promise<string>;
      minimizeWindow: () => void;
      closeApp: () => void;
    };
  }
}
