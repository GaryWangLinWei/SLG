interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAdbPath: () => Promise<string>;
  minimizeWindow: () => void;
  closeApp: () => void;
  onUpdateStatus: (callback: (data: { status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded'; progress?: number; version?: string }) => void) => () => void;
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
