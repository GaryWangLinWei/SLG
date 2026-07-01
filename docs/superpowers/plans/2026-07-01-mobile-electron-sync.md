# 手机端与 Electron 同步（缩减版）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机浏览器远程控制 Electron 客户端 —— 看日志、开始运行、停止运行。

**Architecture:** 保留前端 `Home.tsx` 的循环编排不搬后端。新增一条 SSE 通道 `/api/remote-control/stream` 把手机的 `start_loop`/`stop_loop` 命令桥接到前端。日志和循环状态通过现有 `logs.ts` + `RemoteClient.pushStatus` 通道同步回手机。

**Tech Stack:** Koa（Node/TS，`server/`）、React 18（`web/`）、Electron、`ws`、SSE、EventSource。

---

## 文件结构

**新增：**
- `server/routes/remoteControl.ts` — SSE 桥 + `POST /loop-state`。导出 `emit(action)`、`hasClients()`。

**修改：**
- `core/remote/messages.ts` + `server-auth/ws/messages.ts` — `CommandData.action` union 加 `start_loop | stop_loop`
- `core/remote/CommandHandler.ts` — `RemoteContext` 接口加两个方法，switch 加两个 case
- `server/services/RemoteContextService.ts` — 加 `startLoop`/`stopLoop`/`setLoopRunning`，改写 `getStatus`
- `server/index.ts` — 挂载新路由
- `server/routes/logs.ts` — `POST /append` 转发到 `remoteClient.pushLog`
- `web/src/pages/Home.tsx` — 订阅 SSE、日志同步、状态上报、连设备后续跑
- `web/src/pages/ControlPanel.tsx` — 重写：只留开始/停止
- `web/src/pages/Mobile.tsx` — 微调 ControlPanel props

---

## Task 1: 协议扩展 — CommandData.action 加两个字面量

**Files:**
- Modify: `core/remote/messages.ts:22`
- Modify: `server-auth/ws/messages.ts:22`

- [ ] **Step 1: 修改 core/remote/messages.ts 第 22 行**

把
```typescript
  action: 'start_task' | 'stop_task' | 'stop_all' | 'get_status' | 'get_logs';
```
改成
```typescript
  action: 'start_task' | 'stop_task' | 'stop_all' | 'get_status' | 'get_logs' | 'start_loop' | 'stop_loop';
```

- [ ] **Step 2: 同步修改 server-auth/ws/messages.ts 第 22 行**

改成同样的字面量 union（两个文件必须保持完全一致，见文件顶部注释）。

- [ ] **Step 3: TS 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit
```
预期：无新增错误。若报错，说明有其他地方用了 `CommandData.action` 且未覆盖新字面量，需修复。

- [ ] **Step 4: Commit**

```bash
cd D:/SLG && git add core/remote/messages.ts server-auth/ws/messages.ts
git commit -m "feat(remote): protocol adds start_loop/stop_loop actions"
```

---

## Task 2: CommandHandler 分发新命令 + RemoteContext 接口

**Files:**
- Modify: `core/remote/CommandHandler.ts`

- [ ] **Step 1: 扩展 RemoteContext 接口（第 12-19 行）**

把
```typescript
export interface RemoteContext {
  /** 启动任务，返回 success/error */
  startTask(name: string, params?: any): Promise<{ success: boolean; error?: string }>;
  /** 停止所有运行中任务 */
  stopAllTasks(): Promise<{ success: boolean; error?: string }>;
  /** 获取当前状态 */
  getStatus(): StatusData;
}
```
改成
```typescript
export interface RemoteContext {
  /** 启动任务，返回 success/error */
  startTask(name: string, params?: any): Promise<{ success: boolean; error?: string }>;
  /** 停止所有运行中任务 */
  stopAllTasks(): Promise<{ success: boolean; error?: string }>;
  /** 获取当前状态 */
  getStatus(): StatusData;
  /** 触发前端整体循环开始（Home.tsx handleStartAll） */
  startLoop(): Promise<{ success: boolean; error?: string }>;
  /** 触发前端整体循环停止（Home.tsx handleStop） */
  stopLoop(): Promise<{ success: boolean; error?: string }>;
}
```

- [ ] **Step 2: switch 加两个 case（第 31 行的 switch 内）**

在 `case 'get_logs'` 之前插入
```typescript
      case 'start_loop': {
        return await this.ctx.startLoop();
      }
      case 'stop_loop': {
        return await this.ctx.stopLoop();
      }
```

- [ ] **Step 3: TS 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit
```
预期：`server/services/RemoteContextService.ts` 报错，因为 `RemoteContextService` 类还没实现 `startLoop`/`stopLoop`。这是**预期的**，Task 4 会修复。

- [ ] **Step 4: 暂不 commit**（Task 4 一起提交，保证中间不出现编译红线的 commit）

---

## Task 3: 新增 SSE 桥接路由 `remoteControl.ts`

**Files:**
- Create: `server/routes/remoteControl.ts`

- [ ] **Step 1: 写完整文件**

```typescript
import Router from 'koa-router';

const router = new Router({ prefix: '/api/remote-control' });

interface SseClient {
  id: number;
  ctx: any;
}

const clients: Map<number, SseClient> = new Map();
let clientIdCounter = 0;

/** 广播控制事件给所有 SSE 客户端（Electron 前端 Home 页） */
function broadcast(payload: { action: 'start_loop' | 'stop_loop' }) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((client, id) => {
    try {
      client.ctx.res.write(data);
    } catch {
      clients.delete(id);
    }
  });
}

/** 外部（RemoteContextService）调用：触发前端循环开始/停止 */
export function emit(action: 'start_loop' | 'stop_loop'): void {
  broadcast({ action });
}

/** 外部调用：Electron 前端是否至少有一个 SSE 客户端连接 */
export function hasClients(): boolean {
  return clients.size > 0;
}

// SSE 长连接（Electron 前端订阅）
router.get('/stream', async (ctx: any) => {
  ctx.req.setTimeout(0);
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const clientId = ++clientIdCounter;
  clients.set(clientId, { id: clientId, ctx });

  const heartbeat = setInterval(() => {
    try {
      ctx.res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      clients.delete(clientId);
    }
  }, 30000);

  ctx.req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(clientId);
  });

  ctx.res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  ctx.respond = false;
});

// 前端上报当前 loopRunning 状态
router.post('/loop-state', async (ctx: any) => {
  const { running } = ctx.request.body as any;
  if (typeof running !== 'boolean') {
    ctx.status = 400;
    ctx.body = { success: false, error: 'running must be boolean' };
    return;
  }
  // 延迟 require 避免循环依赖（RemoteContextService 导入本文件的 emit/hasClients）
  const { remoteContextService } = require('../services/RemoteContextService');
  remoteContextService.setLoopRunning(running);
  ctx.body = { success: true };
});

export default router;
```

- [ ] **Step 2: TS 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit
```
预期：`RemoteContextService` 上仍然报 startLoop/stopLoop/setLoopRunning 未实现。这是预期。

- [ ] **Step 3: 暂不 commit**

---

## Task 4: RemoteContextService 加 startLoop/stopLoop/setLoopRunning

**Files:**
- Modify: `server/services/RemoteContextService.ts`

- [ ] **Step 1: 顶部加 import**

在文件顶部（现有 imports 之后）添加：
```typescript
import { emit as emitRemoteControl, hasClients as hasRemoteControlClients } from '../routes/remoteControl';
```

- [ ] **Step 2: 类内加成员和方法**

在 `class RemoteContextService implements RemoteContext` 内、`private defaultAccountId = '';` 下面加：
```typescript
  private loopRunning = false;
```

在 `setDefaultAccount` 方法之后加三个方法：
```typescript
  /** 手机发来 start_loop：广播 SSE 让 Home.tsx 触发 handleStartAll */
  async startLoop(): Promise<{ success: boolean; error?: string }> {
    if (!hasRemoteControlClients()) {
      return { success: false, error: 'Electron 窗口未打开，请先打开 Electron' };
    }
    emitRemoteControl('start_loop');
    return { success: true };
  }

  /** 手机发来 stop_loop：广播 SSE 让 Home.tsx 触发 handleStop */
  async stopLoop(): Promise<{ success: boolean; error?: string }> {
    if (!hasRemoteControlClients()) {
      return { success: false, error: 'Electron 窗口未打开' };
    }
    emitRemoteControl('stop_loop');
    return { success: true };
  }

  /** 前端调用：上报当前 loopRunning 值。会立即推 status 给云端 */
  setLoopRunning(running: boolean): void {
    if (this.loopRunning === running) return;
    this.loopRunning = running;
    this.pushStatus();
  }
```

- [ ] **Step 3: 改 getStatus 加入循环标记**

把现有的（约在第 77-83 行）
```typescript
  getStatus(): StatusData {
    const tasks = taskService.listTasks().filter(t => t.status === 'running');
    return {
      online: true,
      runningTasks: tasks.map(t => `${t.pluginId}:${t.actionId}`),
    };
  }
```
改成
```typescript
  getStatus(): StatusData {
    const tasks = taskService.listTasks().filter(t => t.status === 'running');
    const runningTasks = tasks.map(t => `${t.pluginId}:${t.actionId}`);
    if (this.loopRunning) runningTasks.push('home-loop:running');
    return {
      online: true,
      runningTasks,
    };
  }
```

- [ ] **Step 4: TS 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit
```
预期：无错误。

- [ ] **Step 5: Commit Task 2 + 3 + 4**

```bash
cd D:/SLG && git add core/remote/CommandHandler.ts server/routes/remoteControl.ts server/services/RemoteContextService.ts
git commit -m "feat(remote): SSE bridge for start_loop/stop_loop + loop state relay"
```

---

## Task 5: server/index.ts 挂载新路由

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: 加 import（第 15 行附近）**

在 `import remoteRouter from './routes/remote';` 下面加：
```typescript
import remoteControlRouter from './routes/remoteControl';
```

- [ ] **Step 2: 挂载路由**

在 `app.use(remoteRouter.routes()).use(remoteRouter.allowedMethods());`（第 70 行）之后加：
```typescript
app.use(remoteControlRouter.routes()).use(remoteControlRouter.allowedMethods());
```

- [ ] **Step 3: 检查 licenseGuard 白名单**

打开 `server/middleware/licenseGuard.ts`，确认 `/api/remote-control/*` 不被 license guard 拦截。如果被拦截，把 `/api/remote-control` 加进白名单。

先看有哪些放行规则：

```bash
cd D:/SLG && grep -n "startsWith\|allowlist\|whitelist" server/middleware/licenseGuard.ts
```

若发现规则形如 `path.startsWith('/api/license')`，则在同处追加 `|| path.startsWith('/api/remote-control')`。

**注意：** SSE 端点必须放行，否则未激活状态下 Home.tsx 无法订阅。POST `/loop-state` 也一起放行。

- [ ] **Step 4: 启动后端手动验证**

```bash
cd D:/SLG && npm run server
```
另开一个终端：
```bash
curl -N http://localhost:3000/api/remote-control/stream
```
预期：立刻收到 `data: {"type":"connected"}`，然后每 30 秒一次 heartbeat。Ctrl+C 断开。

再测 POST：
```bash
curl -X POST http://localhost:3000/api/remote-control/loop-state -H "Content-Type: application/json" -d '{"running":true}'
```
预期：`{"success":true}`。后端日志无异常。

停掉 `npm run server`。

- [ ] **Step 5: Commit**

```bash
cd D:/SLG && git add server/index.ts server/middleware/licenseGuard.ts
git commit -m "feat(remote): mount /api/remote-control routes + license guard passthrough"
```

---

## Task 6: logs.ts POST /append 转发到 remoteClient

**Files:**
- Modify: `server/routes/logs.ts:38-61`

- [ ] **Step 1: 定位 POST /append 处理器**

打开 `server/routes/logs.ts`，找到 `router.post('/append', ...)`（第 38 行）。

- [ ] **Step 2: 在 broadcast(entry) 之后加转发**

把
```typescript
  broadcast(entry);

  ctx.body = { success: true };
```
改成
```typescript
  broadcast(entry);

  // 转发到云端 RemoteClient（若连接）
  try {
    const { remoteClient } = require('../../core/remote/RemoteClient');
    if (remoteClient.isConnected()) {
      remoteClient.pushLog(message, 'info');
    }
  } catch {
    // RemoteClient 未初始化（例如仅 server 独立启动），忽略
  }

  ctx.body = { success: true };
```

- [ ] **Step 3: TS 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit
```
预期：无错误。

- [ ] **Step 4: Commit**

```bash
cd D:/SLG && git add server/routes/logs.ts
git commit -m "feat(remote): logs.ts /append forwards to VPS via RemoteClient"
```

---

## Task 7: Home.tsx 订阅 SSE 并处理命令

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 找一个合适的 useEffect 挂载点**

打开 `web/src/pages/Home.tsx`，跳到组件函数体内部（`export default function Home()` 内）。找到已有的最外层 `useEffect(() => { ... }, [currentAccountId])` 区块（约在 300-330 行）。**在 `handleStartAll` 和 `handleStop` 都定义完之后**（约第 1400 行之前），新增一个 useEffect：

```typescript
  // 订阅远程控制 SSE：手机发 start_loop/stop_loop 时触发对应处理
  useEffect(() => {
    const es = new EventSource('/api/remote-control/stream');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.action === 'start_loop') {
          handleStartAll();
        } else if (data.action === 'stop_loop') {
          handleStop();
        }
      } catch { /* connected/heartbeat 帧，忽略 */ }
    };
    es.onerror = () => {
      // EventSource 会自动重连，不需要处理
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

**注意 deps：** 空数组，只在组件 mount 一次。`handleStartAll`/`handleStop` 是每次渲染重新创建的闭包，但它们操作的是模块级变量 `loopRunning`/`loopStopped`，不依赖 React state 快照，因此空 deps 不会有 stale closure 问题（模块级变量总是最新）。

- [ ] **Step 2: 前端手动测试**

启动后端：
```bash
cd D:/SLG && npm run server
```
另开终端启动前端：
```bash
cd D:/SLG/web && npm run dev
```
浏览器打开 http://localhost:5173（登录激活后进入 Home 页）。打开 DevTools → Network → 应看到 `/api/remote-control/stream` 长连接。

在第三个终端触发 SSE 广播（模拟手机命令）：
```bash
curl -X POST http://localhost:3000/api/remote-control/loop-state -H "Content-Type: application/json" -d '{"running":false}'
```

再模拟直接调 `emit` —— 需要走完整链路，暂时先跳过。直接测 Home 页收到广播的情况会在 Task 13 端到端验证时验证。此步只需确认 SSE 连接成功建立（Network 面板显示 pending + `data: {"type":"connected"}`）。

- [ ] **Step 3: Commit**

```bash
cd D:/SLG && git add web/src/pages/Home.tsx
git commit -m "feat(remote): Home subscribes to /api/remote-control/stream"
```

---

## Task 8: Home.tsx handleStartAll 未连接分支改造

**Files:**
- Modify: `web/src/pages/Home.tsx:443-448`

- [ ] **Step 1: 定位并改写未连接分支**

打开 `web/src/pages/Home.tsx`，找到 `const handleStartAll = async () => {`（约第 443 行）。前几行：
```typescript
  const handleStartAll = async () => {
    if (!currentAccountId) return;
    if (!deviceConnected) {
      await handleConnectDevice();
      return;
    }
```

改成：
```typescript
  const handleStartAll = async () => {
    if (!currentAccountId) {
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 未选择账号`]);
      return;
    }
    if (deviceLoading) return;  // 连接过程中重复触发防抖
    if (!deviceConnected) {
      setDeviceLoading(true);
      try {
        const result = await api.device.connect(currentAccountId);
        setDeviceConnected(result.connected);
        if (!result.connected) {
          setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 设备连接失败: ${result.message}`]);
          setDeviceLoading(false);
          return;
        }
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ 设备已连接`]);
      } catch (e: any) {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 设备连接异常: ${e.message || e}`]);
        setDeviceLoading(false);
        return;
      }
      setDeviceLoading(false);
    }
```

**注意：** 保留后续 `const hasAnyFeature = ...` 及其后所有代码不动。上面这段代码把"连完 return"改成"连完继续走"。

- [ ] **Step 2: 桌面端手动回归**

启动前后端，桌面浏览器打开 Home，不点连接直接点"开始运行"。桌面 UI 上按钮实际是 `!deviceConnected ? '连接设备按钮' : '开始运行按钮'`（约第 1417 行），走的是 `handleConnectDevice`，不会走到 `handleStartAll` 的新分支。所以此改动对桌面 UX 无影响 —— 仅对 SSE 触发的场景生效。

若要精确验证新分支能跑通：临时在 DevTools Console 里执行：
```javascript
// 手动模拟 SSE 触发（假设 handleStartAll 在闭包中不可直接访问，此步跳过，Task 13 端到端验证）
```

- [ ] **Step 3: Commit**

```bash
cd D:/SLG && git add web/src/pages/Home.tsx
git commit -m "feat(home): handleStartAll auto-connects device when triggered remotely"
```

---

## Task 9: Home.tsx 日志同步到 /api/logs/append

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 在文件顶部（组件外或组件顶部）加日志上报工具**

在 `export default function Home()` 内、其他 `useRef` 附近，加：
```typescript
  const lastPostedLogIndexRef = useRef(0);
  const pendingLogBatchRef = useRef<string[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  const scheduleLogFlush = () => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      const batch = pendingLogBatchRef.current;
      pendingLogBatchRef.current = [];
      batch.forEach(msg => {
        fetch('/api/logs/append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg }),
        }).catch(() => { /* best effort */ });
      });
    }, 100);
  };
```

- [ ] **Step 2: 加 useEffect 监听 logs state**

在同一个组件内、其他 useEffect 之后加：
```typescript
  // 同步日志到 /api/logs/append，供 Mobile 页 SSE + 手机远程可见
  useEffect(() => {
    if (logs.length < lastPostedLogIndexRef.current) {
      // logs 被截断（clearLoopState 之类）→ 重置游标
      lastPostedLogIndexRef.current = logs.length;
      return;
    }
    if (logs.length === lastPostedLogIndexRef.current) return;
    const newEntries = logs.slice(lastPostedLogIndexRef.current);
    lastPostedLogIndexRef.current = logs.length;
    pendingLogBatchRef.current.push(...newEntries);
    scheduleLogFlush();
  }, [logs]);
```

**注意：**
- `logs` 是 `string[]`（每条已经带了 `[HH:MM:SS]` 前缀）。POST body 里的 `message` 直接传原始字符串，后端会附加自己的 time 字段。
- 100ms 节流 + 只 POST 新增部分，避免瞬间数十条 setLogs 打爆后端。

- [ ] **Step 3: 前端手动验证**

前后端启动，浏览器打开 Home。点几次"新增测试日志"（或触发任意会产生日志的操作，如切换配置）。

Devtools → Network → 应看到 `POST /api/logs/append` 请求（合并成 ~100ms 一批的多个请求）。

另开一个浏览器 tab 访问 http://localhost:5173/mobile，切到"日志"tab，应看到 Home 产生的日志被 SSE 推过来。

- [ ] **Step 4: Commit**

```bash
cd D:/SLG && git add web/src/pages/Home.tsx
git commit -m "feat(home): mirror logs state to /api/logs/append with 100ms throttle"
```

---

## Task 10: Home.tsx loopRunning 状态上报

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 新增 loopRunningState React state**

在组件内、其他 `useState` 附近加：
```typescript
  const [loopRunningState, setLoopRunningState] = useState(false);
```

- [ ] **Step 2: 在所有修改模块级 loopRunning 的地方追加 setLoopRunningState**

用 Grep 找出所有赋值点：
```bash
cd D:/SLG && grep -n "loopRunning\s*=" web/src/pages/Home.tsx
```

**预期赋值点：**
- `handleStartAll` 内：`loopRunning = true` → 后面加 `setLoopRunningState(true);`
- `handleStop` 内：`loopRunning = false` → 后面加 `setLoopRunningState(false);`
- `handleConnectDevice` 内：`loopRunning = false` → 后面加 `setLoopRunningState(false);`
- 循环结束处：`loopRunning = false`（在 `Promise.all([...]).then(...)` 里，约 1348-1356 行）→ 加 `setLoopRunningState(false);`

**规则：每一处 `loopRunning = <value>` 后面必须紧跟 `setLoopRunningState(<value>);`。**

- [ ] **Step 3: 加 useEffect 上报**

在其他 useEffect 之后加：
```typescript
  // 循环状态变化时上报到后端（→ RemoteContextService → push 到手机）
  useEffect(() => {
    fetch('/api/remote-control/loop-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ running: loopRunningState }),
    }).catch(() => { /* best effort */ });
  }, [loopRunningState]);
```

**注意：** mount 时 `loopRunningState` 初值 `false`，会自动 POST 一次，同时应对 F5 刷新场景（前端刷新后循环真停了，此上报把手机的状态胶囊切回"已停止"）。

- [ ] **Step 4: 前端手动验证**

启动前后端 + Home 页。DevTools → Network → 应看到 mount 时立即 `POST /api/remote-control/loop-state`（body `{"running":false}`）。

Devtools → Console 触发（模拟循环开始）：先手动连设备，再点"开始运行"。应看到 `POST /api/remote-control/loop-state` `{"running":true}`。

点"停止"后应看到 `{"running":false}`。

- [ ] **Step 5: Commit**

```bash
cd D:/SLG && git add web/src/pages/Home.tsx
git commit -m "feat(home): report loopRunning state to server on change"
```

---

## Task 11: ControlPanel 重写

**Files:**
- Modify: `web/src/pages/ControlPanel.tsx`

- [ ] **Step 1: 全文覆盖**

覆盖 `web/src/pages/ControlPanel.tsx` 为：
```typescript
import { useState } from 'react';

interface ControlPanelProps {
  deviceOnline: boolean;
  loopRunning: boolean;
  onSendCommand: (action: string, payload?: any) => Promise<any>;
}

export default function ControlPanel({ deviceOnline, loopRunning, onSendCommand }: ControlPanelProps) {
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const [toast, setToast] = useState('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handleStart() {
    setBusy('start');
    try {
      const result = await onSendCommand('start_loop');
      if (result.success) showToast('已发送启动指令');
      else showToast(`启动失败：${result.error || '未知错误'}`);
    } catch (e: any) {
      showToast(`错误：${e.message || e}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleStop() {
    if (!confirm('确定停止运行？')) return;
    setBusy('stop');
    try {
      const result = await onSendCommand('stop_loop');
      if (result.success) showToast('已发送停止指令');
      else showToast(`停止失败：${result.error || '未知错误'}`);
    } catch (e: any) {
      showToast(`错误：${e.message || e}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 space-y-4">
      {!deviceOnline && (
        <div className="bg-amber-900/30 border border-amber-600 rounded-xl p-3 text-amber-200 text-sm">
          ⚠️ 电脑端离线，无法发送指令。请确认电脑已开机且 SLG 助手在运行。
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div className="text-sm text-slate-400">当前状态</div>
        <div className="text-2xl font-bold mt-1">
          {loopRunning ? '🟢 运行中' : '⚪ 已停止'}
        </div>
      </div>

      <button
        onClick={handleStart}
        disabled={!deviceOnline || busy !== null || loopRunning}
        className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl text-lg font-medium transition-colors"
      >
        {busy === 'start' ? '发送中...' : loopRunning ? '已在运行' : '▶️ 开始运行'}
      </button>

      <button
        onClick={handleStop}
        disabled={!deviceOnline || busy !== null || !loopRunning}
        className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl text-lg font-medium transition-colors"
      >
        {busy === 'stop' ? '发送中...' : '⏹️ 停止运行'}
      </button>

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 bg-slate-700 text-white rounded-lg px-4 py-3 text-sm text-center shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TS 编译检查**

```bash
cd D:/SLG/web && npx tsc --noEmit
```
预期：`Mobile.tsx` 报错（旧的传参 `runningTasks` 不匹配新 props）。Task 12 修复。

- [ ] **Step 3: 暂不 commit**

---

## Task 12: Mobile.tsx 微调 ControlPanel 传参

**Files:**
- Modify: `web/src/pages/Mobile.tsx:176-182`

- [ ] **Step 1: 派生 loopRunning 并传递**

找到（约第 176 行）：
```typescript
      {tab === 'control' && isRemoteMode && (
        <ControlPanel
          deviceOnline={remote.state.deviceOnline}
          runningTasks={remote.state.runningTasks}
          onSendCommand={remote.sendCommand}
        />
      )}
```
改成：
```typescript
      {tab === 'control' && isRemoteMode && (
        <ControlPanel
          deviceOnline={remote.state.deviceOnline}
          loopRunning={remote.state.runningTasks.includes('home-loop:running')}
          onSendCommand={remote.sendCommand}
        />
      )}
```

- [ ] **Step 2: TS 编译检查**

```bash
cd D:/SLG/web && npx tsc --noEmit
```
预期：无错误。

- [ ] **Step 3: Commit Task 11 + 12**

```bash
cd D:/SLG && git add web/src/pages/ControlPanel.tsx web/src/pages/Mobile.tsx
git commit -m "feat(mobile): ControlPanel simplified to start/stop loop"
```

---

## Task 13: 端到端手动验证

**Files:** 无代码改动，只跑验证。

**前置准备：**
- 后端起：`cd D:/SLG && npm run server`
- 前端起：`cd D:/SLG/web && npm run dev`
- Electron 打开、已激活、Home 页保持打开
- 手机浏览器打开 http://<桌面 IP>:5173/remote-access（或走 VPS 路径 http://106.15.11.158:3456/remote-access）
- 桌面 Home 页点"📱 远程控制"生成验证码，手机输入进入 Mobile 页

若走 VPS 端到端：`RemoteClient` 已在 Electron 启动时连 VPS，`WebSocketHub` 会透传所有消息。

- [ ] **验证 1: 正常启动/停止**

前提：Electron 打开，设备已连接，循环未跑。

步骤：手机切到"控制"tab → 点"▶️ 开始运行"。

预期：
1. Toast "已发送启动指令"
2. 桌面 Home 页开始执行 `handleStartAll`，产生"第 1 轮"等日志
3. 手机"日志"tab 在 1-2 秒内看到日志流
4. 手机"控制"tab 状态胶囊变"🟢 运行中"，开始按钮变灰"已在运行"

步骤：手机点"⏹️ 停止运行" → 确认。

预期：
1. Toast "已发送停止指令"
2. 桌面循环停止
3. 手机状态胶囊变"⚪ 已停止"

- [ ] **验证 2: 设备未连接自动连接**

前提：Electron 打开，**设备未连接**，循环未跑。

步骤：手机"控制"tab 点"▶️ 开始运行"。

预期：
1. 手机日志 tab 依次看到"✅ 设备已连接" + "第 1 轮" 或类似
2. 循环成功启动
3. 状态胶囊变"🟢 运行中"

- [ ] **验证 3: 设备连接失败**

前提：Electron 打开，但模拟器未启动（设备连不上）。

步骤：手机点"▶️ 开始运行"。

预期：
1. 手机日志 tab 看到 "❌ 设备连接失败: xxx"
2. 循环未启动
3. 状态胶囊保持"⚪ 已停止"

- [ ] **验证 4: Electron 未打开**

前提：关掉 Electron（或关闭 Home 页 tab 让 SSE 断开）。

步骤：手机点"▶️ 开始运行"。

预期：
1. Toast "启动失败：Electron 窗口未打开，请先打开 Electron"
2. 状态胶囊保持"⚪ 已停止"

- [ ] **验证 5: 循环已跑时手机接入**

前提：Electron 打开，循环已在运行（在桌面点了"开始运行"）。

步骤：手机新开 Mobile 页 → 输验证码进入。

预期：
1. 进入即可看到状态胶囊显示"🟢 运行中"
2. 日志 tab 有当前循环的日志流

- [ ] **验证 6: F5 刷新桌面 Home 页**

前提：循环运行中。

步骤：桌面 Home 页按 F5 刷新。

预期：
1. 循环真的停了（前端组件销毁，loopStopped 检查随组件消失，子任务跑完当前 action 后自然结束）
2. 5 秒内手机状态胶囊切回"⚪ 已停止"

- [ ] **验证 7: 循环运行中重复点开始（幂等）**

前提：循环运行中。

步骤：手机点"▶️ 开始运行"（按钮此时应该 disabled，需临时开 devtools 打开）。

预期：如果被 disabled 挡住则通过；若绕过 disabled 触发了，桌面 `handleStartAll` 内的 `if (loopRunning) return` 直接短路，无副作用。

- [ ] **完成后 commit 一份验证记录（可选）**

```bash
cd D:/SLG && git commit --allow-empty -m "chore: mobile-Electron sync end-to-end verified"
```

---

## 完成后总检查

- [ ] `npx tsc --noEmit` 全项目通过
- [ ] `cd web && npx tsc --noEmit` 前端通过
- [ ] `npm test` 无新增失败（本次改动不涉及测试文件）
- [ ] 手机端 Mobile 页控制 Tab 显示的是"开始运行"/"停止运行"两个大按钮
- [ ] 日志、状态在手机可实时同步
- [ ] 现有单个 task 命令（如原来的 `start_task { task: 'gem_gather' }`）行为不变（未删除，只是新版 ControlPanel 不再用）
