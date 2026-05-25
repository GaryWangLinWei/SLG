interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAdbPath: () => Promise<string>;
  minimizeWindow: () => void;
  closeApp: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
