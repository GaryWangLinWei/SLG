import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
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

// Close preference: null = not set yet, 'tray' = minimize to tray, 'quit' = exit
let closeAction: 'tray' | 'quit' | null = null;
const closePrefPath = path.join(app.getPath('userData'), 'close-preference.json');

function loadClosePreference(): void {
  try {
    if (fs.existsSync(closePrefPath)) {
      const data = JSON.parse(fs.readFileSync(closePrefPath, 'utf8'));
      if (data.action === 'tray' || data.action === 'quit') {
        closeAction = data.action;
      }
    }
  } catch { /* ignore */ }
}

function saveClosePreference(action: 'tray' | 'quit'): void {
  try {
    fs.writeFileSync(closePrefPath, JSON.stringify({ action }), 'utf8');
    closeAction = action;
  } catch { /* ignore */ }
}

async function handleCloseWindow(): Promise<void> {
  if (isQuiting || closeAction === 'quit') {
    isQuiting = true;
    app.quit();
    return;
  }

  if (closeAction === 'tray') {
    mainWindow?.hide();
    return;
  }

  // First time close — ask
  const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    title: '关闭窗口',
    message: '关闭窗口时你希望怎么做？',
    detail: '选择"最小化到托盘"后，程序将在后台继续运行。\n你随时可以通过系统托盘图标恢复窗口。',
    buttons: ['最小化到托盘', '退出程序', '取消'],
    defaultId: 0,
    cancelId: 2,
    checkboxLabel: '记住我的选择，不再询问',
    checkboxChecked: false,
  });

  if (response === 0) {
    // 最小化到托盘
    if (checkboxChecked) saveClosePreference('tray');
    mainWindow?.hide();
  } else if (response === 1) {
    // 退出
    if (checkboxChecked) saveClosePreference('quit');
    isQuiting = true;
    app.quit();
  }
  // response === 2 → 取消，什么都不做
}

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

  // Handle window close — delegate to close dialog logic
  mainWindow.on('close', (event) => {
    if (!isQuiting && closeAction !== 'quit') {
      event.preventDefault();
      handleCloseWindow();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../assets/icon-tray.png');

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

ipcMain.on('minimize-window', () => {
  mainWindow?.minimize();
});

ipcMain.on('close-app', () => {
  handleCloseWindow();
});

ipcMain.handle('check-update', () => {
  autoUpdater.checkForUpdatesAndNotify();
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // App events — only registered for the primary instance
  app.on('ready', async () => {
    app.setName(APP_NAME);
    app.setAppUserModelId('com.rok.automation');
    loadClosePreference();
    await startServer();
    createWindow();
    createTray();

    // 自动更新：仅生产环境下生效
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // 事件转发到渲染进程
    autoUpdater.on('checking-for-update', () => {
      mainWindow?.webContents.send('update-status', { status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update-status', { status: 'available', version: info.version });
    });

    autoUpdater.on('update-not-available', () => {
      mainWindow?.webContents.send('update-status', { status: 'idle' });
    });

    autoUpdater.on('download-progress', (progress) => {
      mainWindow?.webContents.send('update-status', {
        status: 'downloading',
        progress: Math.round(progress.percent),
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update-status', {
        status: 'downloaded',
        version: info.version,
      });
    });

    autoUpdater.on('error', (_err) => {
      mainWindow?.webContents.send('update-status', { status: 'idle' });
    });

    // 启动时检查 + 每 4 小时定时检查（仅生产环境）
    if (!isDev) {
      autoUpdater.checkForUpdatesAndNotify();
      setInterval(() => {
        autoUpdater.checkForUpdatesAndNotify();
      }, 4 * 3600 * 1000);
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
}
