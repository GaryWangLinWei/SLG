# Auto Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ROK助手 Electron 应用实现自动更新：启动+定时检查、后台静默下载、下载完成提示重启安装。

**Architecture:** electron-builder 构建产物 FTP 上传到 VPS，server-auth Koa 通过 `koa-static` 托管 `/updates` 目录，客户端 `electron-updater`（generic provider）拉取，IPC 推送状态到 React 渲染进程显示进度 UI。

**Tech Stack:** electron-updater, electron-builder generic provider, koa-static, React (context-free state)

---

### Task 1: server-auth — 新增 /updates 静态路由

**Files:**
- Modify: `server-auth/index.ts`

- [ ] **Step 1: 在 Koa 中间件栈中添加 updates 静态目录**

在 `app.use(serve(adminPath));` 之后新增一行：

```typescript
// 托管更新包（electron-updater generic provider）
app.use(serve(path.join(__dirname, 'updates')));
```

- [ ] **Step 2: 创建 updates 目录占位文件**

```bash
mkdir -p D:/SLG/server-auth/updates
# 放一个 .gitkeep 占位，确保目录被 git 跟踪
```

Run: `echo "" > D:/SLG/server-auth/updates/.gitkeep`

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd D:/SLG/server-auth && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add server-auth/index.ts server-auth/updates/.gitkeep
git commit -m "feat: add /updates static route for auto-update package hosting"
```

---

### Task 2: package.json — publish 配置改为 generic provider

**Files:**
- Modify: `package.json:64-68`

- [ ] **Step 1: 替换 publish 配置**

当前：
```json
"publish": {
  "provider": "github",
  "owner": "your-github-user",
  "repo": "your-repo-name"
}
```

替换为：
```json
"publish": {
  "provider": "generic",
  "url": "http://localhost:3456/updates"
}
```

> **注意:** `url` 先用 localhost 占位符。部署到 VPS 后改为实际 IP:端口。开发阶段可以用 `http://localhost:3456/updates` 本地测试更新流程。

- [ ] **Step 2: 验证 package.json 结构合法**

Run: `cd D:/SLG && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: switch publish provider to generic for VPS-hosted updates"
```

---

### Task 3: electron/main.ts — autoUpdater 事件处理 + 定时检查 + IPC

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: 替换 app.on('ready') 中的 autoUpdater 调用**

当前（约第 261-265 行）：
```typescript
if (!isDev) {
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch { /* update server not configured yet */ }
}
```

替换为：
```typescript
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
    version: progress.bytesPerSecond ? undefined : undefined,
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
```

- [ ] **Step 2: 注册新的 IPC handler**

在现有 IPC handler 区域（`ipcMain.handle('close-app', ...)` 之后）新增：

```typescript
ipcMain.handle('check-update', () => {
  autoUpdater.checkForUpdatesAndNotify();
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd D:/SLG && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat: add autoUpdater event handling, 4h interval check, and IPC handlers for update flow"
```

---

### Task 4: electron/preload.ts — 暴露更新状态到渲染进程

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: 在 exposeInMainWorld 和 declare global 中添加新方法**

当前 `electronAPI` 有 4 个方法。新增 `onUpdateStatus`、`installUpdate`、`checkUpdate`：

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAdbPath: () => ipcRenderer.invoke('get-adb-path'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeApp: () => ipcRenderer.send('close-app'),
  onUpdateStatus: (callback: (data: { status: string; progress?: number; version?: string }) => void) => {
    ipcRenderer.on('update-status', (_event, data) => callback(data));
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
});

declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      getAdbPath: () => Promise<string>;
      minimizeWindow: () => void;
      closeApp: () => void;
      onUpdateStatus: (callback: (data: { status: string; progress?: number; version?: string }) => void) => void;
      installUpdate: () => void;
      checkUpdate: () => void;
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/preload.ts
git commit -m "feat: expose update status listener, installUpdate, and checkUpdate via preload bridge"
```

---

### Task 5: web/src/types/electron.d.ts — 新增类型声明

**Files:**
- Modify: `web/src/types/electron.d.ts`

- [ ] **Step 1: 在 ElectronAPI interface 和 Window augment 中添加类型**

```typescript
interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAdbPath: () => Promise<string>;
  minimizeWindow: () => void;
  closeApp: () => void;
  onUpdateStatus: (callback: (data: { status: string; progress?: number; version?: string }) => void) => void;
  installUpdate: () => void;
  checkUpdate: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd D:/SLG/web && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add web/src/types/electron.d.ts
git commit -m "feat: add update-related type declarations to ElectronAPI interface"
```

---

### Task 6: web/src/App.tsx — 更新状态 UI 横幅

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 在 AppContent 组件内添加更新状态 state 和 IPC 监听**

在 `AppContent` 函数开头添加：

```typescript
const [updateStatus, setUpdateStatus] = useState<{
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded';
  progress?: number;
  version?: string;
}>({ status: 'idle' });

useEffect(() => {
  const isElectron = typeof window !== 'undefined' && 'electronAPI' in window;
  if (!isElectron) return;
  window.electronAPI!.onUpdateStatus((data: any) => {
    setUpdateStatus({
      status: data.status,
      progress: data.progress,
      version: data.version,
    });
  });
}, []);
```

- [ ] **Step 2: 在 NavBar 下方添加更新状态横幅 UI**

在 `NavBar` 和 `<div className="flex-1 overflow-y-auto">` 之间插入：

```typescript
{updateStatus.status === 'downloading' && (
  <div className="bg-slate-900 h-1 relative">
    <div
      className="h-full bg-emerald-500 transition-all duration-300"
      style={{ width: `${updateStatus.progress || 0}%` }}
    />
  </div>
)}
{updateStatus.status === 'downloaded' && (
  <div className="bg-emerald-50 border-b border-emerald-300 px-6 py-2 flex items-center justify-between">
    <span className="text-sm text-emerald-700">
      v{updateStatus.version} 已就绪，重启后生效
    </span>
    <button
      onClick={() => window.electronAPI!.installUpdate()}
      className="px-4 py-1 bg-emerald-500 text-white rounded-full text-sm font-medium hover:bg-emerald-600 transition-colors"
    >
      重启安装
    </button>
  </div>
)}
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd D:/SLG/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: add update download progress bar and install banner UI"
```

---

### Task 7: 最终验证

- [ ] **Step 1: 全局 TypeScript 检查**

```bash
cd D:/SLG && npx tsc --noEmit && cd web && npx tsc --noEmit
```
Expected: 无错误。

- [ ] **Step 2: 本地模拟更新测试**

```bash
# 1. 启动 server-auth（本地模拟 VPS）
cd D:/SLG/server-auth && npm run dev
# 预期: 服务运行在 http://localhost:3456

# 2. 确认 /updates 可访问
curl http://localhost:3456/updates/latest.yml
# 预期: 404（目录为空，正常），确认路由生效
```

- [ ] **Step 3: 确认构建流水线**

```bash
cd D:/SLG && npm run electron:build:win
# 预期: 输出 latest.yml + .exe 到 release/ 目录
# 确认 latest.yml 的 url 字段指向 generic provider
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: final verification of auto-update feature"
```
