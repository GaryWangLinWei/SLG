import { contextBridge, ipcRenderer } from 'electron';

type RunningSession = { running: boolean; accountId: string | null };

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAdbPath: () => ipcRenderer.invoke('get-adb-path'),
  getRunningIntent: () => ipcRenderer.invoke('get-running-intent'),
  setRunningIntent: (value: boolean) => ipcRenderer.invoke('set-running-intent', value),
  getRunningSession: () => ipcRenderer.invoke('get-running-session'),
  setRunningSession: (value: RunningSession) => ipcRenderer.invoke('set-running-session', value),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeApp: () => ipcRenderer.send('close-app'),
  onUpdateStatus: (callback: (data: { status: string; progress?: number; version?: string; releaseNotes?: string }) => void) => {
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
      getRunningIntent: () => Promise<boolean>;
      setRunningIntent: (value: boolean) => Promise<boolean>;
      getRunningSession: () => Promise<RunningSession>;
      setRunningSession: (value: RunningSession) => Promise<RunningSession>;
      minimizeWindow: () => void;
      closeApp: () => void;
      onUpdateStatus: (callback: (data: { status: string; progress?: number; version?: string; releaseNotes?: string }) => void) => () => void;
      installUpdate: () => Promise<void>;
      checkUpdate: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
