interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAdbPath: () => Promise<string>;
  minimizeToTray: () => void;
  closeApp: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
