import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } from 'electron';
import * as path from 'path';
import { setAdbPath } from '../core/device/AdbDevice';
import { initResourcePaths } from '../core/resourcePath';
import { autoUpdater } from 'electron-updater';

const isDev = !app.isPackaged;

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: any = null;
let isQuiting = false;

const APP_NAME = 'ROK助手';

// Fix for __dirname in Electron with TypeScript
const getResourcePath = (resourceName: string) => {
  if (isDev) {
    return path.join(__dirname, '..', resourceName);
  }
  return path.join(process.resourcesPath, 'app', resourceName);
};

// Start Koa backend server
async function startServer() {
  try {
    // Set ADB path before any backend code uses it
    const adbPath = isDev
      ? path.join(__dirname, '../tools/platform-tools/platform-tools/adb.exe')
      : path.join(process.resourcesPath, 'adb/adb.exe');
    setAdbPath(adbPath);
    console.log('ADB path set to:', adbPath);

    // In production, set resource paths for templates & traineddata outside asar
    if (!isDev) {
      initResourcePaths(path.join(process.resourcesPath));
    }

    // In production, start the backend server from compiled JS
    if (!isDev) {
      await import('../server/index');
    }
    // In dev, backend runs separately via "npm run server"
    console.log('Backend server ready');
  } catch (e: any) {
    console.error('Failed to start backend:', e);
    dialog.showErrorBox('后端启动失败', String(e?.stack || e?.message || e));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: APP_NAME,
    icon: path.join(__dirname, '../icon.png'),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    backgroundColor: '#111827',
    show: false
  });
  mainWindow.setMenu(null);

  // Load app
  if (isDev) {
    // Development: load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools in dev mode
    mainWindow.webContents.openDevTools();
  } else {
    // Production: load built React app, no DevTools
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools();
    });
    mainWindow.loadFile(path.join(__dirname, '../../web/dist/index.html'));
  }

  // Log page load failures
  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('Page load failed:', { code, desc, url });
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle window close
  mainWindow.on('close', (event) => {
    if (!isQuiting) {
      event.preventDefault();
      mainWindow?.hide();
    }
    return false;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = isDev
    ? path.join(__dirname, '../assets/icon-tray.png')
    : path.join(__dirname, '../assets/icon-tray.png');

  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow?.show();
      }
    },
    {
      label: '最小化到托盘',
      click: () => {
        mainWindow?.hide();
      }
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked
        });
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuiting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
  });
}

// IPC handlers
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-adb-path', () => {
  if (isDev) {
    return path.join(__dirname, '../tools/platform-tools/platform-tools/adb.exe');
  }
  return path.join(process.resourcesPath, 'adb/adb.exe');
});

ipcMain.on('minimize-to-tray', () => {
  mainWindow?.hide();
});

ipcMain.on('close-app', () => {
  isQuiting = true;
  app.quit();
});

// App events
app.on('ready', async () => {
  app.setName(APP_NAME);
  app.setAppUserModelId('com.rok.automation');
  await startServer();
  createWindow();
  createTray();

  // Auto-update check (silent, no notification on failure)
  if (!isDev) {
    try {
      autoUpdater.checkForUpdatesAndNotify();
    } catch { /* update server not configured yet */ }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
