import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAdbPath: () => ipcRenderer.invoke('get-adb-path'),
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  closeApp: () => ipcRenderer.send('close-app')
});

declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      getAdbPath: () => Promise<string>;
      minimizeToTray: () => void;
      closeApp: () => void;
    };
  }
}
