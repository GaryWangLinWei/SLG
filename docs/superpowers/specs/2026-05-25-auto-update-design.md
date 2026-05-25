# Auto Update — Design Spec

**Date:** 2026-05-25
**Status:** Approved

## Goal

为 ROK助手 Electron 桌面应用实现自动更新功能，用户端静默发现新版本、后台下载，下载完后提示重启安装，不打断当前任务。

## Architecture

```
本地 electron-builder 构建
       ↓ FTP 上传
 VPS (Windows, server-auth Koa)
       ↓ HTTP GET /updates/
 客户端 electron-updater (generic provider)
       ↓ IPC 事件
   前端渲染进程 (进度 UI + 重启按钮)
```

VPS 上的 `server-auth` 已内置 `koa-static`，在 `/updates/` 路由下暴露一个静态目录即可。不需要 Nginx / IIS。

## Components

### 1. VPS — 更新包托管（server-auth）

**文件:** `server-auth/index.ts`

已有 `koa-static` 依赖，在 app 中间件中添加一行：

```typescript
import serve from 'koa-static';
// 托管更新包
app.use(serve(path.join(__dirname, 'updates')));
```

Koa 的 `serve` 按前缀匹配 URL 路径，所以 `/updates/latest.yml` 会映射到 `server-auth/updates/latest.yml`。

**目录结构（VPS 端）:**

```
server-auth/
├── updates/
│   ├── latest.yml                  # electron-builder 自动生成
│   └── ROK助手-Setup-1.0.1.exe     # NSIS 安装包
├── index.ts
├── routes/
├── services/
└── ...
```

**安全组:** 阿里云控制台开放 server-auth 端口（默认 3456）。

### 2. 构建流水线

**文件:** `package.json`

publish 配置从 GitHub 占位符改为 generic：

```json
"publish": {
  "provider": "generic",
  "url": "http://<VPS_IP>:3456/updates"
}
```

新增上传脚本：

```json
"scripts": {
  "electron:upload": "electron-builder --win --publish always"
}
```

构建后手动 FTP 上传 `release/` 目录下的 `latest.yml` 和 `ROK助手-Setup-*.exe` 到 VPS 的 `server-auth/updates/` 目录。

### 3. 客户端 — Electron 主进程

**文件:** `electron/main.ts`

现有代码已导入 `electron-updater` 和有 `checkForUpdatesAndNotify()` 调用。需增强为：

- 导入 `autoUpdater` 事件
- 定时器：启动后检查 + 每 4 小时
- 注册 4 个事件处理：
  - `checking-for-update` → 日志
  - `update-available` → 通知渲染进程
  - `download-progress` → 推送进度百分比到渲染进程
  - `update-downloaded` → 通知渲染进程"重启安装"
  - `error` → 静默忽略，下次定时器重试
- 新增 IPC handler: `install-update`（调用 `autoUpdater.quitAndInstall()`）
- 新增 IPC handler: `check-update`（用户手动触发）

```typescript
import { autoUpdater } from 'electron-updater';

// 配置
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// 事件转发到渲染进程
autoUpdater.on('download-progress', (progress) => {
  mainWindow?.webContents.send('update-status', {
    status: 'downloading',
    progress: Math.round(progress.percent)
  });
});

autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('update-status', {
    status: 'downloaded',
    version: info.version
  });
});

// 定时检查
let updateCheckTimer: ReturnType<typeof setInterval> | null = null;
function startUpdateChecks() {
  autoUpdater.checkForUpdatesAndNotify();
  updateCheckTimer = setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 3600 * 1000);
}

// IPC
ipcMain.handle('check-update', () => autoUpdater.checkForUpdatesAndNotify());
ipcMain.handle('install-update', () => autoUpdater.quitAndInstall());
```

### 4. 客户端 — Preload 桥接

**文件:** `electron/preload.ts`

新增 3 个 IPC 方法：

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing
  onUpdateStatus: (callback: (data: {status: string; progress?: number; version?: string}) => void) => {
    ipcRenderer.on('update-status', (_e, data) => callback(data));
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
});
```

### 5. 类型声明

**文件:** `web/src/types/electron.d.ts`

```typescript
interface ElectronAPI {
  // ... existing
  onUpdateStatus: (callback: (data: {status: string; progress?: number; version?: string}) => void) => void;
  installUpdate: () => void;
  checkUpdate: () => void;
}
```

### 6. 前端 UI — 更新状态栏

**文件:** `web/src/App.tsx`

在 NavBar 下方或顶部加一条状态栏。组件逻辑：

```typescript
const [updateStatus, setUpdateStatus] = useState<{
  status: 'idle' | 'checking' | 'downloading' | 'downloaded';
  progress?: number;
  version?: string;
}>({ status: 'idle' });

useEffect(() => {
  window.electronAPI?.onUpdateStatus((data) => {
    setUpdateStatus({
      status: data.status,
      progress: data.progress,
      version: data.version,
    });
  });
}, []);
```

**UI 表现：**

- `downloading` — 顶部细进度条（emerald），不遮内容
- `downloaded` — 绿底横幅 "v1.0.1 已就绪" + "重启安装" 按钮
- 其他状态 — 不渲染任何内容

### 7. Electron-Builder 配置

**文件:** `package.json` → `build`

已有 NSIS 配置保持不变。确认：
- `publish.provider` 改为 `"generic"`
- `win.icon` 已有 `"icon.png"`
- NSIS `oneClick: false`（已设置，用户可选安装路径）

## Error Handling

- VPS 不可达 / 网络超时 → 静默忽略，下次 4h 检查重试
- `latest.yml` 格式异常 → `electron-updater` 内部处理，外部不干预
- 下载中途断网 → `electron-updater` 内部断点续传
- 安装包校验失败 → 丢弃，不提示
- 用户点击"取消"关闭提示 → 不影响，重启时正常退出

## 涉及文件总览

| 文件 | 改动 |
|------|------|
| `package.json` | publish 改 generic provider |
| `electron/main.ts` | autoUpdater 事件处理、定时器、新 IPC handler |
| `electron/preload.ts` | 新增 IPC 桥接 |
| `web/src/types/electron.d.ts` | 新增类型 |
| `web/src/App.tsx` | 新增更新状态 UI 组件 |
| `server-auth/index.ts` | 新增 `/updates` 静态路由 |

## 非代码事项

- 阿里云 ECS 购买后：安全组开放 3456 端口
- 本地构建 → FTP 上传 `latest.yml` + `.exe` 到 VPS
- 第一次部署前确认 `publish.url` 填入正确的 IP:端口
