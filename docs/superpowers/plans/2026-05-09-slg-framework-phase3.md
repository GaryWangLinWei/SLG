# SLG自动化框架 - Phase 3: Web管理界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建Web管理界面，支持通过浏览器管理设备、配置插件、运行自动化任务、查看执行日志

**Architecture:** Koa后端 + REST API + React前端，前后端分离架构

**Tech Stack:** Node.js 20+, TypeScript 5, Koa 2, React 18, Tailwind CSS 3

---

## Task 1: 初始化Koa后端服务

**Files:**
- Create: `server/index.ts`
- Create: `server/config.ts`
- Modify: `package.json` (add dependencies and scripts)

**Step 1: Add backend dependencies to package.json**

```json
"dependencies": {
  "koa": "^2.14.0",
  "koa-router": "^12.0.0",
  "koa-bodyparser": "^4.4.0",
  "koa-cors": "^0.0.16",
  "koa-static": "^5.0.0",
  "opencv4nodejs": "^5.6.0"
},
"devDependencies": {
  "@types/koa": "^2.13.0",
  "@types/koa-router": "^7.4.0",
  "@types/koa-bodyparser": "^4.3.0",
  "@types/koa-static": "^4.0.2"
},
"scripts": {
  "build": "tsc",
  "dev": "ts-node src/index.ts",
  "server": "ts-node server/index.ts",
  "server:dev": "nodemon --watch 'server/**/*.ts' --exec 'ts-node' server/index.ts",
  "test": "jest",
  "lint": "eslint src/**/*.ts server/**/*.ts"
}
```

**Step 2: Create server config**

```typescript
// server/config.ts
export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  HOST: process.env.HOST || '0.0.0.0',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  STATIC_DIR: process.env.STATIC_DIR || './web/build'
};
```

**Step 3: Create basic Koa server**

```typescript
// server/index.ts
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import serve from 'koa-static';
import { CONFIG } from './config';

const app = new Koa();
const router = new Router();

// Middleware
app.use(cors({ origin: CONFIG.CORS_ORIGIN }));
app.use(bodyParser());
app.use(serve(CONFIG.STATIC_DIR));

// Basic health check
router.get('/api/health', async (ctx) => {
  ctx.body = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'SLG Automation Framework API'
  };
});

// Root API info
router.get('/api', async (ctx) => {
  ctx.body = {
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      device: '/api/device',
      plugins: '/api/plugins',
      tasks: '/api/tasks'
    }
  };
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`========================================`);
  console.log(`   SLG 自动化框架 Web服务`);
  console.log(`========================================`);
  console.log(`服务运行在: http://${CONFIG.HOST}:${CONFIG.PORT}`);
  console.log(`API地址: http://${CONFIG.HOST}:${CONFIG.PORT}/api`);
  console.log(`健康检查: http://${CONFIG.HOST}:${CONFIG.PORT}/api/health`);
  console.log(`启动时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`========================================`);
});

export default app;
```

**Step 4: Install dependencies and test server**

Run: `npm install`
Run: `npm run server`
Expected: Server starts on port 3000, /api/health returns ok

**Step 5: Commit**

```bash
git add package.json server/config.ts server/index.ts
git commit -m "feat: initialize Koa backend server with health check"
```

---

## Task 2: 设备管理API

**Files:**
- Create: `server/services/DeviceService.ts`
- Create: `server/routes/device.ts`
- Modify: `server/index.ts`

**Step 1: Create DeviceService**

```typescript
// server/services/DeviceService.ts
import { AdbDevice } from '../../core/device';

class DeviceService {
  private device: AdbDevice | null = null;

  async connect(): Promise<{ connected: boolean; message: string }> {
    try {
      this.device = new AdbDevice();
      const connected = await this.device.connect();
      
      if (connected) {
        return { connected: true, message: '设备连接成功' };
      }
      return { connected: false, message: '未找到设备，请确保ADB已配置且设备已连接' };
    } catch (error) {
      return { connected: false, message: `连接失败: ${error}` };
    }
  }

  async disconnect(): Promise<{ success: boolean }> {
    if (this.device) {
      await this.device.disconnect();
      this.device = null;
    }
    return { success: true };
  }

  getStatus(): { connected: boolean; deviceInfo?: string } {
    if (this.device && this.device.isConnected()) {
      return { connected: true, deviceInfo: 'Android Device' };
    }
    return { connected: false };
  }

  async screenshot(): Promise<{ success: boolean; data?: string; error?: string }> {
    if (!this.device || !this.device.isConnected()) {
      return { success: false, error: '设备未连接' };
    }

    try {
      const buffer = await this.device.screenshot();
      return {
        success: true,
        data: `data:image/png;base64,${buffer.toString('base64')}`
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async tap(x: number, y: number): Promise<{ success: boolean; error?: string }> {
    if (!this.device || !this.device.isConnected()) {
      return { success: false, error: '设备未连接' };
    }

    try {
      await this.device.tap(x, y);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, duration: number): Promise<{ success: boolean; error?: string }> {
    if (!this.device || !this.device.isConnected()) {
      return { success: false, error: '设备未连接' };
    }

    try {
      await this.device.swipe(x1, y1, x2, y2, duration);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

export const deviceService = new DeviceService();
```

**Step 2: Create device routes**

```typescript
// server/routes/device.ts
import Router from 'koa-router';
import { deviceService } from '../services/DeviceService';

const router = new Router({ prefix: '/api/device' });

// Get device status
router.get('/status', async (ctx) => {
  ctx.body = deviceService.getStatus();
});

// Connect to device
router.post('/connect', async (ctx) => {
  ctx.body = await deviceService.connect();
});

// Disconnect device
router.post('/disconnect', async (ctx) => {
  ctx.body = await deviceService.disconnect();
});

// Get screenshot
router.get('/screenshot', async (ctx) => {
  ctx.body = await deviceService.screenshot();
});

// Tap at position
router.post('/tap', async (ctx) => {
  const { x, y } = ctx.request.body as { x: number; y: number };
  if (x === undefined || y === undefined) {
    ctx.status = 400;
    ctx.body = { error: 'x and y coordinates are required' };
    return;
  }
  ctx.body = await deviceService.tap(x, y);
});

// Swipe
router.post('/swipe', async (ctx) => {
  const { x1, y1, x2, y2, duration = 500 } = ctx.request.body as any;
  if ([x1, y1, x2, y2].some(v => v === undefined)) {
    ctx.status = 400;
    ctx.body = { error: 'x1, y1, x2, y2 coordinates are required' };
    return;
  }
  ctx.body = await deviceService.swipe(x1, y1, x2, y2, duration);
});

export default router;
```

**Step 3: Register routes in server/index.ts**

```typescript
// Add imports
import deviceRouter from './routes/device';

// After basic routes, before app.use(router.routes())
app.use(deviceRouter.routes()).use(deviceRouter.allowedMethods());
```

**Step 4: Test API endpoints**

Run: `npm run server`
Test endpoints with curl or browser:
- GET http://localhost:3000/api/device/status

**Step 5: Commit**

```bash
git add server/services/DeviceService.ts server/routes/device.ts server/index.ts
git commit -m "feat: add device management API endpoints"
```

---

## Task 3: 插件管理与任务运行API

**Files:**
- Create: `server/services/PluginService.ts`
- Create: `server/services/TaskService.ts`
- Create: `server/routes/plugins.ts`
- Create: `server/routes/tasks.ts`
- Modify: `server/index.ts`

**Step 1: Create PluginService**

```typescript
// server/services/PluginService.ts
import { PluginManager, Plugin } from '../../core/plugin';
import { AdbDevice } from '../../core/device';
import { Vision } from '../../core/vision';
import { SlgCommonPlugin } from '../../plugins/slg-common';

class PluginService {
  private pluginManager: PluginManager | null = null;
  private device: AdbDevice | null = null;
  private vision: Vision | null = null;

  initialize(device: AdbDevice, vision: Vision): void {
    this.device = device;
    this.vision = vision;
    this.pluginManager = new PluginManager(device, vision);
    this.pluginManager.register(SlgCommonPlugin);
  }

  ensureInitialized(): void {
    if (!this.pluginManager) {
      throw new Error('Plugin service not initialized. Please connect device first.');
    }
  }

  listPlugins(): Plugin[] {
    this.ensureInitialized();
    return this.pluginManager!.listPlugins();
  }

  getPluginConfigSchema(pluginId: string) {
    this.ensureInitialized();
    const plugin = this.pluginManager!.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    return plugin.config || {};
  }
}

export const pluginService = new PluginService();
```

**Step 2: Create TaskService**

```typescript
// server/services/TaskService.ts
import { PluginManager } from '../../core/plugin';

export interface Task {
  id: string;
  pluginId: string;
  actionId: string;
  config: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime?: Date;
  endTime?: Date;
  logs: string[];
  error?: string;
}

class TaskService {
  private tasks: Map<string, Task> = new Map();
  private pluginManager: PluginManager | null = null;

  initialize(pluginManager: PluginManager): void {
    this.pluginManager = pluginManager;
  }

  createTask(pluginId: string, actionId: string, config: Record<string, any> = {}): Task {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const task: Task = {
      id,
      pluginId,
      actionId,
      config,
      status: 'pending',
      logs: []
    };
    this.tasks.set(id, task);
    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  listTasks(): Task[] {
    return Array.from(this.tasks.values()).reverse();
  }

  async runTask(taskId: string): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (!this.pluginManager) {
      throw new Error('Plugin manager not initialized');
    }

    task.status = 'running';
    task.startTime = new Date();
    task.logs.push(`[${new Date().toLocaleTimeString()}] 任务开始执行`);

    try {
      // Create a context with log capture
      const logCapture = (message: string) => {
        task.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
      };

      await this.pluginManager.runAction(task.pluginId, task.actionId, task.config);

      task.status = 'completed';
      task.logs.push(`[${new Date().toLocaleTimeString()}] 任务执行完成`);
    } catch (error) {
      task.status = 'error';
      task.error = String(error);
      task.logs.push(`[${new Date().toLocaleTimeString()}] 任务失败: ${error}`);
    }

    task.endTime = new Date();
    return task;
  }
}

export const taskService = new TaskService();
```

**Step 3: Create plugins routes**

```typescript
// server/routes/plugins.ts
import Router from 'koa-router';
import { pluginService } from '../services/PluginService';

const router = new Router({ prefix: '/api/plugins' });

router.get('/', async (ctx) => {
  try {
    ctx.body = {
      success: true,
      plugins: pluginService.listPlugins()
    };
  } catch (error) {
    ctx.status = 500;
    ctx.body = { success: false, error: String(error) };
  }
});

router.get('/:id/config', async (ctx) => {
  try {
    const { id } = ctx.params;
    ctx.body = {
      success: true,
      config: pluginService.getPluginConfigSchema(id)
    };
  } catch (error) {
    ctx.status = 404;
    ctx.body = { success: false, error: String(error) };
  }
});

export default router;
```

**Step 4: Create tasks routes**

```typescript
// server/routes/tasks.ts
import Router from 'koa-router';
import { taskService } from '../services/TaskService';

const router = new Router({ prefix: '/api/tasks' });

router.get('/', async (ctx) => {
  ctx.body = {
    success: true,
    tasks: taskService.listTasks()
  };
});

router.get('/:id', async (ctx) => {
  const task = taskService.getTask(ctx.params.id);
  if (!task) {
    ctx.status = 404;
    ctx.body = { success: false, error: 'Task not found' };
    return;
  }
  ctx.body = { success: true, task };
});

router.post('/', async (ctx) => {
  const { pluginId, actionId, config = {} } = ctx.request.body as any;
  if (!pluginId || !actionId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'pluginId and actionId are required' };
    return;
  }

  const task = taskService.createTask(pluginId, actionId, config);
  ctx.body = { success: true, task };
});

router.post('/:id/run', async (ctx) => {
  try {
    const task = await taskService.runTask(ctx.params.id);
    ctx.body = { success: true, task };
  } catch (error) {
    ctx.status = 500;
    ctx.body = { success: false, error: String(error) };
  }
});

export default router;
```

**Step 5: Register routes and initialize services**

Update server/index.ts to initialize services when device is connected.

**Step 6: Commit**

```bash
git add server/services/PluginService.ts server/services/TaskService.ts server/routes/plugins.ts server/routes/tasks.ts
git commit -m "feat: add plugin management and task execution APIs"
```

---

## Task 4: 初始化React前端项目

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/tailwind.config.js`
- Create: `web/postcss.config.js`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`

**Step 1: Create web package.json**

```json
{
  "name": "slg-automation-web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.8.0"
  },
  "devDependencies": {
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.3.0",
    "typescript": "^5.0.0",
    "vite": "^4.3.0"
  }
}
```

**Step 2: Create vite config**

```typescript
// web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
```

**Step 3: Create tailwind config**

```javascript
// web/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

**Step 4: Create basic App component**

```typescript
// web/src/App.tsx
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-900 text-white">
        <nav className="bg-gray-800 p-4">
          <div className="container mx-auto flex gap-6">
            <Link to="/" className="text-xl font-bold text-blue-400">SLG 自动化框架</Link>
            <Link to="/device" className="hover:text-blue-400">设备管理</Link>
            <Link to="/plugins" className="hover:text-blue-400">插件管理</Link>
            <Link to="/tasks" className="hover:text-blue-400">任务中心</Link>
          </div>
        </nav>
        
        <main className="container mx-auto p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/device" element={<DevicePage />} />
            <Route path="/plugins" element={<PluginsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

function Dashboard() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">仪表盘</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-800 p-6 rounded-lg">
          <h3 className="text-lg font-semibold mb-2">设备状态</h3>
          <p className="text-gray-400">未连接</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg">
          <h3 className="text-lg font-semibold mb-2">可用插件</h3>
          <p className="text-gray-400">1 个</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg">
          <h3 className="text-lg font-semibold mb-2">运行任务</h3>
          <p className="text-gray-400">0 个</p>
        </div>
      </div>
    </div>
  );
}

function DevicePage() {
  return <h1 className="text-2xl font-bold">设备管理 - 开发中</h1>;
}

function PluginsPage() {
  return <h1 className="text-2xl font-bold">插件管理 - 开发中</h1>;
}

function TasksPage() {
  return <h1 className="text-2xl font-bold">任务中心 - 开发中</h1>;
}

export default App;
```

**Step 5: Install and test frontend**

Run from web directory: `npm install && npm run dev`
Expected: Vite dev server starts on port 5173, basic navigation works

**Step 6: Commit**

```bash
git add web/package.json web/vite.config.ts web/tsconfig.json web/tailwind.config.js web/postcss.config.js web/index.html web/src/main.tsx web/src/App.tsx
git commit -m "feat: initialize React frontend with Vite and Tailwind CSS"
```

---

## Phase 3 完成检查（Part 1）

- [ ] Koa后端服务初始化，健康检查API
- [ ] 设备管理API（连接、断开、截图、点击、滑动）
- [ ] 插件管理与任务运行API
- [ ] React前端项目初始化，基础路由和导航

---

## Task 5: 设备管理页面

**Files:**
- Create: `web/src/pages/Device.tsx`
- Create: `web/src/api/client.ts`

**Step 1: Create API client**

```typescript
// web/src/api/client.ts
const API_BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  device: {
    status: () => request<{ connected: boolean; deviceInfo?: string }>('/device/status'),
    connect: () => request<{ connected: boolean; message: string }>('/device/connect', { method: 'POST' }),
    disconnect: () => request<{ success: boolean }>('/device/disconnect', { method: 'POST' }),
    screenshot: () => request<{ success: boolean; data?: string; error?: string }>('/device/screenshot'),
    tap: (x: number, y: number) => request('/device/tap', { method: 'POST', body: JSON.stringify({ x, y }) }),
    swipe: (x1: number, y1: number, x2: number, y2: number, duration?: number) => 
      request('/device/swipe', { method: 'POST', body: JSON.stringify({ x1, y1, x2, y2, duration }) })
  }
};
```

**Step 2: Create Device page**

```typescript
// web/src/pages/Device.tsx
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export function DevicePage() {
  const [connected, setConnected] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const checkStatus = useCallback(async () => {
    try {
      const status = await api.device.status();
      setConnected(status.connected);
    } catch (e) {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const result = await api.device.connect();
      setMessage(result.message);
      setConnected(result.connected);
    } catch (e) {
      setMessage('连接失败');
    }
    setLoading(false);
  };

  const handleDisconnect = async () => {
    setLoading(true);
    await api.device.disconnect();
    setConnected(false);
    setScreenshot(null);
    setLoading(false);
  };

  const handleScreenshot = async () => {
    setLoading(true);
    try {
      const result = await api.device.screenshot();
      if (result.success && result.data) {
        setScreenshot(result.data);
      }
    } catch (e) {
      setMessage('截图失败');
    }
    setLoading(false);
  };

  const handleScreenshotClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (1080 / rect.width));
    const y = Math.round((e.clientY - rect.top) * (1920 / rect.height));
    api.device.tap(x, y);
    setMessage(`点击: (${x}, ${y})`);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">设备管理</h1>
      
      {message && (
        <div className="mb-4 p-3 bg-blue-900 text-blue-200 rounded">
          {message}
        </div>
      )}

      <div className="flex gap-4 mb-6">
        {!connected ? (
          <button
            onClick={handleConnect}
            disabled={loading}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded disabled:opacity-50"
          >
            连接设备
          </button>
        ) : (
          <>
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded disabled:opacity-50"
            >
              断开连接
            </button>
            <button
              onClick={handleScreenshot}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
            >
              刷新截图
            </button>
          </>
        )}
      </div>

      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></span>
          <span>{connected ? '已连接' : '未连接'}</span>
        </div>

        {screenshot && (
          <div className="mt-4">
            <p className="text-sm text-gray-400 mb-2">点击截图可发送点击指令</p>
            <img
              src={screenshot}
              alt="Device screenshot"
              className="max-w-md border border-gray-600 rounded cursor-crosshair"
              onClick={handleScreenshotClick}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add web/src/api/client.ts web/src/pages/Device.tsx
git commit -m "feat: add device management page with screenshot and tap"
```

---

## Task 6: 插件管理与任务运行页面

**Files:**
- Create: `web/src/pages/Plugins.tsx`
- Create: `web/src/pages/Tasks.tsx`
- Update: `web/src/api/client.ts`

**Step 1: Extend API client**

```typescript
// Add to web/src/api/client.ts

export interface PluginAction {
  id: string;
  name: string;
  description: string;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  actions: PluginAction[];
  config?: Record<string, any>;
}

export interface Task {
  id: string;
  pluginId: string;
  actionId: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime?: string;
  endTime?: string;
  logs: string[];
  error?: string;
}

// Extend api object:
plugins: {
  list: () => request<{ success: boolean; plugins: Plugin[] }>('/plugins')
},
tasks: {
  list: () => request<{ success: boolean; tasks: Task[] }>('/tasks'),
  get: (id: string) => request<{ success: boolean; task: Task }>(`/tasks/${id}`),
  create: (pluginId: string, actionId: string, config: Record<string, any> = {}) =>
    request<{ success: boolean; task: Task }>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ pluginId, actionId, config })
    }),
  run: (id: string) =>
    request<{ success: boolean; task: Task }>(`/tasks/${id}/run`, { method: 'POST' })
}
```

**Step 2: Plugins page**

```typescript
// web/src/pages/Plugins.tsx
import { useState, useEffect } from 'react';
import { api, Plugin } from '../api/client';
import { useNavigate } from 'react-router-dom';

export function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadPlugins();
  }, []);

  const loadPlugins = async () => {
    try {
      const result = await api.plugins.list();
      if (result.success) {
        setPlugins(result.plugins);
      }
    } catch (e) {
      console.error('Failed to load plugins');
    }
    setLoading(false);
  };

  const handleRunAction = async (pluginId: string, actionId: string) => {
    try {
      const result = await api.tasks.create(pluginId, actionId);
      if (result.success) {
        await api.tasks.run(result.task.id);
        navigate('/tasks');
      }
    } catch (e) {
      console.error('Failed to run action');
    }
  };

  if (loading) {
    return <div className="text-xl">加载中...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">插件管理</h1>

      <div className="space-y-6">
        {plugins.map(plugin => (
          <div key={plugin.id} className="bg-gray-800 rounded-lg p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">{plugin.name}</h2>
                <p className="text-sm text-gray-400">v{plugin.version}</p>
                <p className="mt-2 text-gray-300">{plugin.description}</p>
              </div>
            </div>

            <h3 className="text-lg font-semibold mb-3">可用操作</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {plugin.actions.map(action => (
                <div key={action.id} className="bg-gray-700 p-4 rounded flex justify-between items-center">
                  <div>
                    <p className="font-medium">{action.name}</p>
                    <p className="text-sm text-gray-400">{action.description}</p>
                  </div>
                  <button
                    onClick={() => handleRunAction(plugin.id, action.id)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
                  >
                    运行
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 3: Tasks page**

```typescript
// web/src/pages/Tasks.tsx
import { useState, useEffect } from 'react';
import { api, Task } from '../api/client';

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadTasks = async () => {
    try {
      const result = await api.tasks.list();
      if (result.success) {
        setTasks(result.tasks);
      }
    } catch (e) {
      console.error('Failed to load tasks');
    }
    setLoading(false);
  };

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'running': return 'bg-blue-500 animate-pulse';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = (status: Task['status']) => {
    switch (status) {
      case 'completed': return '已完成';
      case 'running': return '运行中';
      case 'error': return '错误';
      default: return '等待中';
    }
  };

  if (loading) {
    return <div className="text-xl">加载中...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">任务中心</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <h2 className="text-lg font-semibold mb-4">任务列表</h2>
          <div className="space-y-2">
            {tasks.length === 0 ? (
              <p className="text-gray-400">暂无任务</p>
            ) : (
              tasks.map(task => (
                <div
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className={`p-3 rounded cursor-pointer transition-colors ${
                    selectedTask?.id === task.id ? 'bg-blue-900' : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${getStatusColor(task.status)}`}></span>
                    <span className="font-medium truncate">{task.actionId}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {task.startTime ? new Date(task.startTime).toLocaleString('zh-CN') : '-'}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          {selectedTask ? (
            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">{selectedTask.actionId}</h2>
                <span className={`px-3 py-1 rounded text-sm ${getStatusColor(selectedTask.status)}`}>
                  {getStatusText(selectedTask.status)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                <div>
                  <p className="text-gray-400">任务ID</p>
                  <p className="font-mono">{selectedTask.id}</p>
                </div>
                <div>
                  <p className="text-gray-400">插件</p>
                  <p>{selectedTask.pluginId}</p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">执行日志</h3>
                <div className="bg-gray-900 rounded p-4 max-h-96 overflow-y-auto font-mono text-sm">
                  {selectedTask.logs.map((log, i) => (
                    <p key={i} className="py-1">{log}</p>
                  ))}
                </div>
              </div>

              {selectedTask.error && (
                <div className="mt-4 p-3 bg-red-900 text-red-200 rounded">
                  <p className="font-semibold">错误信息</p>
                  <p className="font-mono text-sm mt-1">{selectedTask.error}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-800 rounded-lg p-6 text-center text-gray-400">
              选择一个任务查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Update App routes**

Import and use the new page components in App.tsx.

**Step 5: Commit**

```bash
git add web/src/api/client.ts web/src/pages/Plugins.tsx web/src/pages/Tasks.tsx web/src/App.tsx
git commit -m "feat: add plugins and tasks management pages"
```

---

## Phase 3 完成检查

- [ ] Koa后端服务初始化
- [ ] 设备管理API（连接、断开、截图、点击、滑动）
- [ ] 插件管理API
- [ ] 任务执行API
- [ ] React前端项目初始化
- [ ] 设备管理页面（截图、点击）
- [ ] 插件管理页面（动作列表）
- [ ] 任务中心页面（任务列表、日志查看）
