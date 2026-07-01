# 手机端与 Electron 同步（缩减版）

**日期：** 2026-07-01
**目标：** 手机浏览器通过验证码接入远程控制后，能做三件事：查看日志、开始运行、停止运行。

---

## 背景

当前远程控制已经打通：
- Electron 启动 → `RemoteClient` 连 VPS `ws://106.15.11.158:3456/ws/remote`
- 手机浏览器打开 `http://106.15.11.158:3456/remote-access?code=XXXXXX` → 输验证码 → 拿 sessionToken → 连同一 WS
- VPS `WebSocketHub` 双向透传消息

已经能工作的部分：手机端能触发单个 action（gem_gather/rally_join/…），这些是通过 `RemoteContextService.startTask()` 建 task 交给 `TaskService` 执行的。

**没打通的部分：** 桌面端"开始运行"按钮触发的是 `Home.tsx` 前端的 `handleStartAll()`，那里面有 15+ 个并行 IIFE async loop（`gatherLoop` / `helpLoop` / `collectLoop` / `rallyLoop` / `caveLoop` / `offlineLoop` / gem gather / OCR 主循环等），由模块级变量 `loopRunning` / `loopStopped` 控制。手机端目前无法触发这个"整体循环"，也看不到这个循环产生的日志（那些日志只写到 React state，没进 `/api/logs/*`）。

**用户核心场景：** 用户离开电脑前把 Electron 最小化到托盘，出门后想用手机开始/停止/看日志。**Electron 窗口保持运行**是前提。

---

## 需求范围

**做：**
1. 手机端"开始运行"按钮 → 触发 Electron 前端 `handleStartAll()`
2. 手机端"停止运行"按钮 → 触发 Electron 前端 `handleStop()`
3. Electron 循环的日志实时同步到手机
4. 手机端显示运行状态（运行中 / 已停止）
5. Electron 打开但设备未连接时，手机点开始 → 自动尝试连接设备并继续启动循环

**不做（明确排除）：**
- 手机端编辑 features（勾选任务）— 需要用户先在桌面配好
- 手机端管理账号 / 切换账号
- 手机端设备连接 UI（自动处理，无独立按钮）
- 循环搬到后端 —— 循环留在 `Home.tsx`，Electron 窗口必须开着

---

## 架构

三条数据通道：

**控制信号通道**（手机 → Electron 前端）

```
手机浏览器
  │ sendCommand('start_loop' | 'stop_loop')
  ▼
VPS WebSocketHub (透传)
  │
  ▼
Electron RemoteClient (device 角色)
  │ onCommand → CommandHandler.handle
  ▼
RemoteContextService.startLoop() / stopLoop()
  │ 通过 SSE 广播 {action: 'start_loop' | 'stop_loop'}
  ▼
server/routes/remoteControl.ts (SSE /api/remote-control/stream)
  │
  ▼
Home.tsx (EventSource 监听)
  │ 触发 handleStartAll() / handleStop()
```

**日志通道**（Electron 前端 → 手机）

```
Home.tsx setLogs(...)
  │ 附加 POST /api/logs/append（新增日志时，节流批量）
  ▼
server/routes/logs.ts POST /append
  ├─ 广播到 /api/logs/stream（本地 Mobile 页 SSE）
  └─ 若 remoteClient.isConnected() → remoteClient.pushLog(msg)
       │
       ▼
     VPS → 手机 (WebSocket log 消息)
```

**状态通道**（Electron 前端 → 手机）

```
Home.tsx loopRunning 变化
  │ POST /api/remote-control/loop-state {running: bool}
  ▼
RemoteContextService.setLoopRunning(bool)
  │ getStatus() 中 runningTasks 加/去 'home-loop:running' 标记
  │ remoteClient.pushStatus(...)
  ▼
VPS → 手机 (WebSocket status 消息)
```

---

## 组件与改动

### 新增文件

**`server/routes/remoteControl.ts`** — SSE 桥接（~80 行）
- `GET /api/remote-control/stream` — SSE，Electron 前端订阅。广播 `{action: 'start_loop' | 'stop_loop'}` 事件
- `POST /api/remote-control/loop-state` — 前端上报当前 `loopRunning`，body: `{running: boolean}`。调用 `remoteContextService.setLoopRunning(running)`
- 导出 `emit(action: 'start_loop' | 'stop_loop')` 供 `RemoteContextService` 调用
- 导出 `hasClients()` 供 `startLoop`/`stopLoop` 判断"Electron 窗口有没有开"
- 内部维护 `Map<clientId, koaCtx>`，客户端断开时清理
- 每 30 秒心跳

### 修改文件

**`server/index.ts`** — 挂载新路由（+1 行）

**`server/services/RemoteContextService.ts`** — 补三个方法（~40 行）
```typescript
async startLoop(): Promise<{success: boolean; error?: string}> {
  if (!remoteControlRoute.hasClients()) {
    return { success: false, error: 'Electron 窗口未打开，请先打开 Electron' };
  }
  remoteControlRoute.emit('start_loop');
  return { success: true };
}

async stopLoop(): Promise<{success: boolean; error?: string}> {
  if (!remoteControlRoute.hasClients()) {
    return { success: false, error: 'Electron 窗口未打开' };
  }
  remoteControlRoute.emit('stop_loop');
  return { success: true };
}

private loopRunning = false;
setLoopRunning(running: boolean): void {
  this.loopRunning = running;
  this.pushStatus();
}

getStatus(): StatusData {
  const tasks = taskService.listTasks().filter(t => t.status === 'running');
  const runningTasks = tasks.map(t => `${t.pluginId}:${t.actionId}`);
  if (this.loopRunning) runningTasks.push('home-loop:running');
  return { online: true, runningTasks };
}
```

**`core/remote/CommandHandler.ts`** — switch 加两个 case
```typescript
case 'start_loop':
  return await this.ctx.startLoop();
case 'stop_loop':
  return await this.ctx.stopLoop();
```
`RemoteContext` 接口加两个方法签名。

**`core/remote/messages.ts` + `server-auth/ws/messages.ts`** — `CommandData.action` union 加 `'start_loop' | 'stop_loop'` 字面量。运行时协议本来就是任意 string，改动仅为 TS 类型对齐；VPS 侧无需重新部署。

**`web/src/pages/Home.tsx`** — 四块改动（~50 行）

1. **订阅 SSE**：`useEffect` 挂 `new EventSource('/api/remote-control/stream')`，收 `start_loop` → 调 `handleStartAll()`，收 `stop_loop` → 调 `handleStop()`。组件卸载时关闭 EventSource。

2. **未连接分支改造**：`handleStartAll` 里 `if (!deviceConnected)` 分支从"连完 return"改成"连完继续跑"（详见下方边界处理）。

3. **日志同步（useEffect 监听 logs state）**：
   ```typescript
   const lastPostedRef = useRef(0);
   useEffect(() => {
     if (logs.length <= lastPostedRef.current) {
       lastPostedRef.current = logs.length;  // 应对 clearLoopState 截断
       return;
     }
     const newEntries = logs.slice(lastPostedRef.current);
     lastPostedRef.current = logs.length;
     // 100ms 节流批量 POST
     scheduleLogFlush(newEntries);
   }, [logs]);
   ```
   `scheduleLogFlush` 用 debounce timer 累积 entries，触发后 `Promise.all(entries.map(e => fetch('/api/logs/append', ...)))`。避免在每个 `setLogs` 调用点手动埋点（Home.tsx 有几十个 `setLogs` 调用，逐个改易漏）。

4. **循环状态同步（useEffect 监听 loopRunning）**：
   由于 `loopRunning` 是**模块级变量**不是 React state，useEffect 无法直接监听。方案：新增一个 React state `loopRunningState` 与模块级 `loopRunning` 同步。在 `handleStartAll` / `handleStop` / `handleConnectDevice`（该函数末尾会重置 `loopRunning=false`）等**所有修改 `loopRunning` 的地方**追加 `setLoopRunningState(loopRunning)`。然后 `useEffect(() => { fetch('/api/remote-control/loop-state', {method:'POST', body: JSON.stringify({running: loopRunningState})}) }, [loopRunningState])` 统一上报。

5. **F5 保护**：Home 组件 mount 时 useEffect 里 POST 一次当前 `loopRunning`（初值 `false`），确保刷新后手机看到"已停止"。

**`server/routes/logs.ts`** — `POST /append` 处理里追加（+5 行）
```typescript
try {
  const { remoteClient } = require('../../core/remote/RemoteClient');
  if (remoteClient.isConnected()) remoteClient.pushLog(message, 'info');
} catch { /* Remote 未初始化 */ }
```

**`web/src/pages/ControlPanel.tsx`** — 重写（~60 行）
- 去掉原 4 个 task 按钮（gem_gather/rally_join/cave_explore/research_tech）
- 只留两个按钮：**开始运行** / **停止运行**
- 顶部状态胶囊：设备状态 + 循环状态（"运行中" / "已停止"）
- 循环状态从 `runningTasks.includes('home-loop:running')` 派生
- 开始按钮 disabled 条件：`!deviceOnline || busy`（已运行时按钮变灰但仍可点，交给幂等）
- 停止按钮 disabled 条件：`!running || busy`

**`web/src/pages/Mobile.tsx`** — 微调
- `ControlPanel` 组件 props 简化：不再传 `runningTasks` 全量，改成传单个 `loopRunning: boolean` 派生值
- `Tab = 'logs' | 'control' | 'status'` 不变

---

## 协议扩展

**`CommandData.action` union 加两个字面量：**
```typescript
type Action = 'start_task' | 'stop_task' | 'stop_all' | 'get_status' | 'get_logs'
            | 'start_loop' | 'stop_loop';   // 新增
```

**`StatusData.runningTasks` 新语义：** 值中若包含 `'home-loop:running'` 表示前端整体循环在跑。这是一个约定标记，不是真实的 taskId。手机端据此显示状态胶囊。

---

## 边界情况与处理

| 场景 | 处理 |
|------|------|
| Electron 窗口未打开 | SSE 无客户端 → `startLoop()`/`stopLoop()` 返回 `{success:false, error:'Electron 窗口未打开'}` → 手机 toast |
| Electron 打开但设备未连接 | 手机点开始 → SSE → `handleStartAll` → 检测未连接 → **自动调 `api.device.connect`** → 连上继续启动，连不上 log 一条错误并 return（**改现有代码**） |
| 循环已在跑再点开始 | `handleStartAll` 内已有 `if (loopRunning) return`，天然幂等 |
| 手机连接时循环已在跑 | WS 认证成功后 `WebSocketHub` 立即 send 当前 status（含 `home-loop:running`），手机初始渲染就正确 |
| 日志 POST 洪泛 | 100ms 节流批量合并；只 POST 新增的那几条（比对 prev/next 长度差） |
| 多手机同时连接 | SSE / VPS 天然广播，无需特殊处理 |
| VPS 断线 | `RemoteClient` 已有 3 秒自动重连 |
| Electron 前端 F5 刷新 | `loopRunning` 模块级变量被清零 → 循环真的停了（子任务的 abort 依赖 `loopStopped` 但 F5 后组件销毁不会主动 stop 各子 task；这些子 task 会自然跑完当前 action。设计上认为"F5 后视为循环停止"是可接受的） → mount 时 useEffect POST 上报 `false` → 手机状态胶囊切回"已停止" |
| 连接过程中手机重复点开始 | `handleStartAll` 加 `if (deviceLoading) return` 防止并发触发 `api.device.connect` |
| 无账号（`currentAccountId` 为空） | `handleStartAll` 首行 `if (!currentAccountId) return` 之前追加一行 log "❌ 未选择账号" 让手机能看见 |
| 命令下发到设备连接失败 | `handleStartAll` 里 `api.device.connect` 失败时 log 一条 "❌ 设备连接失败: {message}" 并 return，手机能通过日志看到 |

---

## 破坏性影响评估

- **现有用户老版本 exe**：零影响。新命令 `start_loop`/`stop_loop` 老客户端根本不会发；新 SSE 路由老客户端不订阅。
- **VPS 服务器**：**零改动**。协议里 `CommandData.action` 是 string，加字面量只影响 TS 类型不影响运行时透传。
- **数据库**：零改动。
- **升级后可见变化**：Mobile 页面控制 Tab 从 4 个 task 按钮变成 2 个统一按钮 — 这是刻意想要的。

---

## 验证清单

1. Electron 打开、设备已连、循环未跑 → 手机点"开始运行" → 前端弹出运行日志 → 手机看到日志流 → 手机点"停止" → 前端循环停 → 状态胶囊切回"已停止"
2. Electron 打开、设备**未**连、循环未跑 → 手机点"开始运行" → 前端自动连接设备 → 连上后循环启动 → 手机看到"设备连接成功" + "第 1 轮" 日志
3. Electron 打开、设备连接失败 → 手机点"开始运行" → 手机看到 "❌ 设备连接失败: xxx" → 循环未启动，状态"已停止"
4. Electron 打开、循环已在跑 → 手机进入 Mobile 页 → 状态胶囊显示"运行中"
5. Electron **未打开** → 手机点"开始运行" → 收到 toast "Electron 窗口未打开"
6. Electron 前端 F5 刷新 → 循环真停止 → 手机状态在 5 秒内切回"已停止"
7. 两个手机同时连接 → 一台点开始 → 另一台的状态胶囊也变"运行中"

---

## 关键文件路径

| 用途 | 路径 |
|------|------|
| SSE 桥接（新增） | `server/routes/remoteControl.ts` |
| 后端入口（挂路由） | `server/index.ts` |
| 远程上下文（补方法） | `server/services/RemoteContextService.ts` |
| 命令分发（加 case） | `core/remote/CommandHandler.ts` |
| 消息协议（加字面量 x2） | `core/remote/messages.ts` + `server-auth/ws/messages.ts` |
| Home 页（订阅+上报+日志） | `web/src/pages/Home.tsx` |
| 本地日志路由（转发到远程） | `server/routes/logs.ts` |
| 移动控制面板（重写） | `web/src/pages/ControlPanel.tsx` |
| 移动页面（微调） | `web/src/pages/Mobile.tsx` |
