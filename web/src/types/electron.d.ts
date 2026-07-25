interface RunningSession {
  running: boolean;
  accountId: string | null;
}

interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAdbPath: () => Promise<string>;
  getRunningIntent: () => Promise<boolean>;
  setRunningIntent: (value: boolean) => Promise<boolean>;
  getRunningSession: () => Promise<RunningSession>;
  setRunningSession: (value: RunningSession) => Promise<RunningSession>;
  minimizeWindow: () => void;
  closeApp: () => void;
  onUpdateStatus: (callback: (data: { status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded'; progress?: number; version?: string; releaseNotes?: string }) => void) => () => void;
  installUpdate: () => Promise<void>;
  checkUpdate: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
