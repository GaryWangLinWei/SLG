# 远程控制功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能在外网(4G/5G)通过手机浏览器实时查看 SLG 助手的运行日志,并远程启停任务

**Architecture:** 三端架构 - 手机浏览器 ↔ VPS 云端(消息中转) ↔ 电脑客户端。电脑 exe 主动连接 VPS 建立 WebSocket 长连接;手机通过验证码访问 VPS,VPS 透传消息给对应电脑;所有任务逻辑仍在电脑端执行,VPS 只做消息路由和日志暂存。

**Tech Stack:** TypeScript, Koa, better-sqlite3, ws (WebSocket library), React, Vite

**Spec:** `docs/superpowers/specs/2026-06-28-remote-control-design.md`

---

## 文件结构总览

### 新建文件

```
server-auth/
├── services/
│   ├── RemoteCodeService.ts       # 验证码生成/验证/清理
│   ├── RemoteLogService.ts        # 云端日志存储/查询/清理
│   └── WebSocketHub.ts            # WS 连接管理 + 消息路由
├── ws/
│   └── messages.ts                # 消息类型定义(共享给客户端)
└── routes/
    └── remote.ts                  # 验证码/日志 HTTP API

core/
└── remote/
    ├── RemoteClient.ts            # 电脑端 WS 客户端
    ├── CommandHandler.ts          # 远程指令分发
    └── messages.ts                # 消息类型定义(与 server-auth 同步)

web/src/
├── pages/
│   ├── Mobile.tsx                 # 重构:支持外网模式 + Tab 切换
│   ├── RemoteAccess.tsx           # 验证码输入页面
│   └── ControlPanel.tsx           # 控制面板(新 Tab)
├── hooks/
│   └── useRemoteSocket.ts         # WebSocket 客户端 hook
└── api/
    └── remote.ts                  # 远程 API 封装
```

### 修改文件

```
server-auth/
├── index.ts                       # 集成 WS Hub 到 Koa
├── services/AuthDatabase.ts       # 新增 remote_codes 和 remote_logs 表
└── package.json                   # 新增 ws 依赖

server/services/
└── TaskService.ts                 # 将日志通过 RemoteClient 同步推送

web/src/
├── App.tsx                        # 新增 /remote-access 路由
└── pages/Home.tsx                 # 新增「远程控制」按钮 + 验证码弹窗

electron/main.ts                   # 启动时初始化 RemoteClient
```

---

## 阶段 1: 云端 WebSocket 基础 + 日志推送

### Task 1: 安装 ws 依赖并定义共享消息类型

**Files:**
- Modify: `server-auth/package.json`
- Create: `server-auth/ws/messages.ts`
- Create: `core/remote/messages.ts`

- [ ] **Step 1: 安装 ws 依赖**

```bash
cd D:/SLG/server-auth && npm install ws @types/ws
```

Expected: `package.json` 中新增 `"ws": "^8.x"` 和 `"@types/ws": "^8.x"`

- [ ] **Step 2: 创建 `server-auth/ws/messages.ts`**

```typescript
// 远程控制 WebSocket 消息协议定义
// 必须与 core/remote/messages.ts 保持同步

export type WsMessageType = 'log' | 'command' | 'response' | 'status' | 'heartbeat' | 'auth';

export interface WsMessage<T = any> {
  type: WsMessageType;
  id: string;        // 消息 UUID,用于 request-response 匹配
  deviceId: string;  // 目标/来源设备 ID(电脑端的激活码 hash)
  data: T;
  timestamp: number;
}

// 日志消息
export interface LogData {
  message: string;
  level: 'info' | 'warn' | 'error';
}

// 指令消息(手机 → 云端 → 电脑)
export interface CommandData {
  action: 'start_task' | 'stop_task' | 'stop_all' | 'get_status' | 'get_logs';
  payload?: Record<string, any>;
}

// 响应消息(电脑 → 云端 → 手机)
export interface ResponseData {
  requestId: string;  // 对应原始 command 的 id
  success: boolean;
  result?: any;
  error?: string;
}

// 状态消息
export interface StatusData {
  online: boolean;
  runningTasks: string[];
  features?: Record<string, any>;
}

// 设备认证(WS 建立连接后第一条消息)
export interface AuthData {
  role: 'device' | 'user';
  token: string;       // device: 激活码 + fingerprint; user: 验证码换的 sessionToken
  deviceId?: string;   // user 角色需指定要监听哪个设备
}
```

- [ ] **Step 3: 创建 `core/remote/messages.ts`(内容与上面完全一致)**

```typescript
// 与 server-auth/ws/messages.ts 完全同步
export type WsMessageType = 'log' | 'command' | 'response' | 'status' | 'heartbeat' | 'auth';

export interface WsMessage<T = any> {
  type: WsMessageType;
  id: string;
  deviceId: string;
  data: T;
  timestamp: number;
}

export interface LogData {
  message: string;
  level: 'info' | 'warn' | 'error';
}

export interface CommandData {
  action: 'start_task' | 'stop_task' | 'stop_all' | 'get_status' | 'get_logs';
  payload?: Record<string, any>;
}

export interface ResponseData {
  requestId: string;
  success: boolean;
  result?: any;
  error?: string;
}

export interface StatusData {
  online: boolean;
  runningTasks: string[];
  features?: Record<string, any>;
}

export interface AuthData {
  role: 'device' | 'user';
  token: string;
  deviceId?: string;
}
```

- [ ] **Step 4: 验证编译通过**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json`
Expected: 无报错

Run: `cd D:/SLG/server-auth && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 5: 提交**

```bash
cd D:/SLG && git add server-auth/package.json server-auth/package-lock.json server-auth/ws/messages.ts core/remote/messages.ts
git commit -m "feat(remote): add ws dependency and message protocol"
```

---

### Task 2: 创建数据库表 remote_codes 和 remote_logs

**Files:**
- Modify: `server-auth/services/AuthDatabase.ts:78-100` (在 initTables 末尾添加)

- [ ] **Step 1: 修改 AuthDatabase.ts,新增 remote 表**

在 `initTables` 函数的 `try { database.exec(...tier...) } catch {}` 之后追加:

```typescript
  // 远程控制 - 验证码表
  database.exec(`
    CREATE TABLE IF NOT EXISTS remote_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      device_id TEXT NOT NULL,
      activation_code TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      used_at INTEGER
    )
  `);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_remote_codes_code ON remote_codes(code)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_remote_codes_device ON remote_codes(device_id)`);

  // 远程控制 - 云端日志表
  database.exec(`
    CREATE TABLE IF NOT EXISTS remote_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      activation_code TEXT NOT NULL,
      message TEXT NOT NULL,
      level TEXT DEFAULT 'info',
      timestamp INTEGER NOT NULL
    )
  `);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_remote_logs_device ON remote_logs(device_id, timestamp DESC)`);

  // 远程控制 - 会话表(手机端验证码兑换后的 session token)
  database.exec(`
    CREATE TABLE IF NOT EXISTS remote_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token TEXT UNIQUE NOT NULL,
      device_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_remote_sessions_token ON remote_sessions(session_token)`);
```

- [ ] **Step 2: 验证数据库表创建**

```bash
cd D:/SLG/server-auth && npm run dev
```

启动后用另一个终端检查表:

```bash
cd D:/SLG/server-auth && node -e "
const db = require('better-sqlite3')('auth-data/auth.db');
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
console.log(tables.map(t => t.name));
"
```

Expected: 输出包含 `remote_codes`, `remote_logs`, `remote_sessions`

- [ ] **Step 3: 提交**

```bash
cd D:/SLG && git add server-auth/services/AuthDatabase.ts
git commit -m "feat(remote): add database tables for codes/logs/sessions"
```

---

### Task 3: 创建 RemoteCodeService

**Files:**
- Create: `server-auth/services/RemoteCodeService.ts`

- [ ] **Step 1: 创建 RemoteCodeService.ts**

```typescript
import { getDb } from './AuthDatabase';
import { randomBytes } from 'crypto';

const CODE_TTL_MS = 10 * 60 * 1000;       // 验证码 10 分钟过期
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 会话 24 小时过期

export interface GenerateCodeResult {
  code: string;
  expiresAt: number;
}

export interface VerifyCodeResult {
  success: boolean;
  sessionToken?: string;
  deviceId?: string;
  expiresAt?: number;
  error?: string;
}

class RemoteCodeService {
  /** 生成 6 位数字验证码,绑定设备 */
  generateCode(deviceId: string, activationCode: string): GenerateCodeResult {
    const db = getDb();
    // 删除该设备未使用的旧验证码
    db.prepare(`DELETE FROM remote_codes WHERE device_id = ? AND used = 0`).run(deviceId);
    // 生成 6 位数字(0~999999,左侧补 0)
    const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const now = Date.now();
    const expiresAt = now + CODE_TTL_MS;
    db.prepare(`
      INSERT INTO remote_codes (code, device_id, activation_code, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(code, deviceId, activationCode, now, expiresAt);
    return { code, expiresAt };
  }

  /** 验证验证码,通过则生成 session token */
  verifyCode(code: string): VerifyCodeResult {
    const db = getDb();
    const row: any = db.prepare(`
      SELECT id, device_id, expires_at, used FROM remote_codes WHERE code = ?
    `).get(code);
    if (!row) return { success: false, error: '验证码不存在' };
    if (row.used) return { success: false, error: '验证码已使用' };
    if (Date.now() > row.expires_at) return { success: false, error: '验证码已过期' };

    // 标记已使用
    db.prepare(`UPDATE remote_codes SET used = 1, used_at = ? WHERE id = ?`).run(Date.now(), row.id);
    // 生成 session token
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    db.prepare(`
      INSERT INTO remote_sessions (session_token, device_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionToken, row.device_id, Date.now(), expiresAt);
    return { success: true, sessionToken, deviceId: row.device_id, expiresAt };
  }

  /** 验证 session token 是否有效 */
  verifySession(sessionToken: string): { valid: boolean; deviceId?: string } {
    const db = getDb();
    const row: any = db.prepare(`
      SELECT device_id, expires_at FROM remote_sessions WHERE session_token = ?
    `).get(sessionToken);
    if (!row) return { valid: false };
    if (Date.now() > row.expires_at) return { valid: false };
    return { valid: true, deviceId: row.device_id };
  }

  /** 清理过期的验证码和会话(每小时调用) */
  cleanup(): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(`DELETE FROM remote_codes WHERE expires_at < ?`).run(now);
    db.prepare(`DELETE FROM remote_sessions WHERE expires_at < ?`).run(now);
  }
}

export const remoteCodeService = new RemoteCodeService();

// 每小时清理一次过期数据
setInterval(() => remoteCodeService.cleanup(), 60 * 60 * 1000);
```

- [ ] **Step 2: 验证编译**

Run: `cd D:/SLG/server-auth && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 3: 提交**

```bash
cd D:/SLG && git add server-auth/services/RemoteCodeService.ts
git commit -m "feat(remote): add RemoteCodeService for code generation/verification"
```

---

### Task 4: 创建 RemoteLogService

**Files:**
- Create: `server-auth/services/RemoteLogService.ts`

- [ ] **Step 1: 创建 RemoteLogService.ts**

```typescript
import { getDb } from './AuthDatabase';

const MAX_LOGS_PER_DEVICE = 10000;
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

export interface RemoteLogEntry {
  id: number;
  deviceId: string;
  message: string;
  level: string;
  timestamp: number;
}

class RemoteLogService {
  /** 批量写入日志 */
  insertLogs(deviceId: string, activationCode: string, logs: Array<{ message: string; level: string; timestamp: number }>): void {
    if (logs.length === 0) return;
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO remote_logs (device_id, activation_code, message, level, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((items: typeof logs) => {
      for (const item of items) stmt.run(deviceId, activationCode, item.message, item.level, item.timestamp);
    });
    insertMany(logs);
  }

  /** 查询设备最近 N 条日志(按时间倒序) */
  getLogs(deviceId: string, limit: number = 200): RemoteLogEntry[] {
    const db = getDb();
    const rows: any[] = db.prepare(`
      SELECT id, device_id as deviceId, message, level, timestamp
      FROM remote_logs
      WHERE device_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(deviceId, limit);
    return rows.reverse(); // 返回时按时间正序
  }

  /** 清理:删除 7 天前的日志 + 单设备超过 10000 条的部分 */
  cleanup(): void {
    const db = getDb();
    const cutoff = Date.now() - LOG_RETENTION_MS;
    db.prepare(`DELETE FROM remote_logs WHERE timestamp < ?`).run(cutoff);

    // 单设备最多保留最近 10000 条
    const devices: any[] = db.prepare(`
      SELECT device_id, COUNT(*) as cnt FROM remote_logs GROUP BY device_id HAVING cnt > ?
    `).all(MAX_LOGS_PER_DEVICE);

    for (const d of devices) {
      db.prepare(`
        DELETE FROM remote_logs
        WHERE device_id = ?
          AND id NOT IN (
            SELECT id FROM remote_logs WHERE device_id = ?
            ORDER BY timestamp DESC LIMIT ?
          )
      `).run(d.device_id, d.device_id, MAX_LOGS_PER_DEVICE);
    }
  }
}

export const remoteLogService = new RemoteLogService();

// 每天凌晨 3 点清理一次
function scheduleNextCleanup() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    remoteLogService.cleanup();
    scheduleNextCleanup();
  }, next.getTime() - now.getTime());
}
scheduleNextCleanup();
```

- [ ] **Step 2: 验证编译**

Run: `cd D:/SLG/server-auth && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 3: 提交**

```bash
cd D:/SLG && git add server-auth/services/RemoteLogService.ts
git commit -m "feat(remote): add RemoteLogService for cloud log storage"
```

---

### Task 5: 创建 WebSocketHub - WS 连接管理 + 消息路由

**Files:**
- Create: `server-auth/services/WebSocketHub.ts`

- [ ] **Step 1: 创建 WebSocketHub.ts**

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { remoteCodeService } from './RemoteCodeService';
import { remoteLogService } from './RemoteLogService';
import { WsMessage, AuthData, LogData, CommandData, StatusData } from '../ws/messages';

interface DeviceConnection {
  ws: WebSocket;
  deviceId: string;
  activationCode: string;
  connectedAt: number;
}

interface UserConnection {
  ws: WebSocket;
  sessionToken: string;
  deviceId: string;
  connectedAt: number;
}

class WebSocketHub {
  private wss: WebSocketServer | null = null;
  private devices: Map<string, DeviceConnection> = new Map();
  private users: Set<UserConnection> = new Set();

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws/remote' });
    this.wss.on('connection', (ws, req) => {
      let authed = false;
      let connInfo: { role: 'device' | 'user'; deviceId: string } | null = null;

      ws.on('message', (raw) => {
        let msg: WsMessage;
        try { msg = JSON.parse(raw.toString()); }
        catch { ws.close(1003, 'invalid json'); return; }

        if (!authed) {
          if (msg.type !== 'auth') { ws.close(1008, 'auth required'); return; }
          const auth = msg.data as AuthData;
          const result = this.authenticate(ws, auth);
          if (!result.success) {
            ws.send(JSON.stringify({
              type: 'response', id: msg.id, deviceId: '',
              data: { requestId: msg.id, success: false, error: result.error },
              timestamp: Date.now(),
            }));
            ws.close(1008, result.error);
            return;
          }
          authed = true;
          connInfo = { role: auth.role, deviceId: result.deviceId! };
          ws.send(JSON.stringify({
            type: 'response', id: msg.id, deviceId: result.deviceId!,
            data: { requestId: msg.id, success: true, result: { deviceId: result.deviceId } },
            timestamp: Date.now(),
          }));
          return;
        }

        if (!connInfo) return;
        this.routeMessage(connInfo.role, connInfo.deviceId, msg);
      });

      ws.on('close', () => {
        if (!connInfo) return;
        if (connInfo.role === 'device') {
          this.devices.delete(connInfo.deviceId);
          this.broadcastStatusToUsers(connInfo.deviceId, { online: false, runningTasks: [] });
        } else {
          for (const u of this.users) if (u.ws === ws) { this.users.delete(u); break; }
        }
      });

      ws.on('error', (err) => console.error('[WS] connection error:', err));
    });
    console.log('[WS] WebSocketHub attached to /ws/remote');
  }

  private authenticate(ws: WebSocket, auth: AuthData): { success: boolean; deviceId?: string; error?: string } {
    if (auth.role === 'device') {
      if (!auth.token) return { success: false, error: '缺少 token' };
      const deviceId = auth.token;
      const old = this.devices.get(deviceId);
      if (old) old.ws.close(1000, 'replaced');
      this.devices.set(deviceId, { ws, deviceId, activationCode: auth.token, connectedAt: Date.now() });
      this.broadcastStatusToUsers(deviceId, { online: true, runningTasks: [] });
      return { success: true, deviceId };
    } else {
      const result = remoteCodeService.verifySession(auth.token);
      if (!result.valid) return { success: false, error: '会话无效或已过期' };
      const userConn: UserConnection = { ws, sessionToken: auth.token, deviceId: result.deviceId!, connectedAt: Date.now() };
      this.users.add(userConn);
      const device = this.devices.get(result.deviceId!);
      ws.send(JSON.stringify({
        type: 'status', id: randomUUID(), deviceId: result.deviceId!,
        data: { online: !!device, runningTasks: [] } as StatusData,
        timestamp: Date.now(),
      }));
      return { success: true, deviceId: result.deviceId };
    }
  }

  private routeMessage(role: 'device' | 'user', deviceId: string, msg: WsMessage): void {
    if (role === 'device') {
      if (msg.type === 'log') {
        const log = msg.data as LogData;
        const device = this.devices.get(deviceId);
        if (device) {
          remoteLogService.insertLogs(deviceId, device.activationCode, [{
            message: log.message, level: log.level || 'info', timestamp: msg.timestamp,
          }]);
        }
        this.broadcastToUsers(deviceId, msg);
      } else if (msg.type === 'response' || msg.type === 'status') {
        this.broadcastToUsers(deviceId, msg);
      }
    } else {
      if (msg.type === 'command') {
        const device = this.devices.get(deviceId);
        if (!device) { this.sendToOneUser(msg.id, deviceId, { online: false }); return; }
        device.ws.send(JSON.stringify(msg));
      }
    }
  }

  private broadcastToUsers(deviceId: string, msg: WsMessage): void {
    const payload = JSON.stringify(msg);
    for (const u of this.users) {
      if (u.deviceId === deviceId && u.ws.readyState === WebSocket.OPEN) u.ws.send(payload);
    }
  }

  private broadcastStatusToUsers(deviceId: string, status: StatusData): void {
    this.broadcastToUsers(deviceId, {
      type: 'status', id: randomUUID(), deviceId, data: status, timestamp: Date.now(),
    });
  }

  private sendToOneUser(requestId: string, deviceId: string, ctx: { online: boolean }): void {
    const payload = JSON.stringify({
      type: 'response', id: randomUUID(), deviceId,
      data: { requestId, success: false, error: ctx.online ? '未知错误' : '设备离线' },
      timestamp: Date.now(),
    });
    for (const u of this.users) {
      if (u.deviceId === deviceId && u.ws.readyState === WebSocket.OPEN) u.ws.send(payload);
    }
  }

  isDeviceOnline(deviceId: string): boolean {
    return this.devices.has(deviceId);
  }
}

export const webSocketHub = new WebSocketHub();
```

- [ ] **Step 2: 验证编译**

Run: `cd D:/SLG/server-auth && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 3: 提交**

```bash
cd D:/SLG && git add server-auth/services/WebSocketHub.ts
git commit -m "feat(remote): add WebSocketHub for connection management and message routing"
```

---

### Task 6: 创建 HTTP 远程 API 路由

**Files:**
- Create: `server-auth/routes/remote.ts`

- [ ] **Step 1: 创建 remote.ts**

```typescript
import Router from 'koa-router';
import { remoteCodeService } from '../services/RemoteCodeService';
import { remoteLogService } from '../services/RemoteLogService';
import { webSocketHub } from '../services/WebSocketHub';

const router = new Router({ prefix: '/api/remote' });

const failureCounter = new Map<string, { count: number; lockedUntil: number }>();

function checkFailureLock(ip: string): { locked: boolean; remaining?: number } {
  const entry = failureCounter.get(ip);
  if (!entry) return { locked: false };
  if (entry.lockedUntil > Date.now()) {
    return { locked: true, remaining: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }
  if (entry.lockedUntil <= Date.now() && entry.count >= 3) failureCounter.delete(ip);
  return { locked: false };
}

function recordFailure(ip: string): void {
  const entry = failureCounter.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= 3) entry.lockedUntil = Date.now() + 60 * 1000;
  failureCounter.set(ip, entry);
}

router.post('/generate-code', async (ctx) => {
  const { deviceId, activationCode } = ctx.request.body as any;
  if (!deviceId || !activationCode) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少 deviceId 或 activationCode' };
    return;
  }
  const result = remoteCodeService.generateCode(deviceId, activationCode);
  ctx.body = { success: true, code: result.code, expiresAt: result.expiresAt };
});

router.post('/verify-code', async (ctx) => {
  const ip = ctx.request.ip || 'unknown';
  const lock = checkFailureLock(ip);
  if (lock.locked) {
    ctx.status = 429;
    ctx.body = { success: false, error: `错误次数过多,请 ${lock.remaining} 秒后重试` };
    return;
  }
  const { code } = ctx.request.body as any;
  if (!code) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少 code' };
    return;
  }
  const result = remoteCodeService.verifyCode(code);
  if (!result.success) {
    recordFailure(ip);
    ctx.status = 401;
    ctx.body = result;
    return;
  }
  failureCounter.delete(ip);
  ctx.body = {
    success: true,
    sessionToken: result.sessionToken,
    deviceId: result.deviceId,
    expiresAt: result.expiresAt,
    deviceOnline: webSocketHub.isDeviceOnline(result.deviceId!),
  };
});

router.get('/logs', async (ctx) => {
  const sessionToken = ctx.headers['x-session-token'] as string;
  const limit = parseInt(ctx.query.limit as string) || 200;
  if (!sessionToken) {
    ctx.status = 401;
    ctx.body = { success: false, error: '缺少 sessionToken' };
    return;
  }
  const result = remoteCodeService.verifySession(sessionToken);
  if (!result.valid) {
    ctx.status = 401;
    ctx.body = { success: false, error: '会话无效或已过期' };
    return;
  }
  const logs = remoteLogService.getLogs(result.deviceId!, limit);
  ctx.body = { success: true, logs, deviceOnline: webSocketHub.isDeviceOnline(result.deviceId!) };
});

router.get('/status', async (ctx) => {
  const sessionToken = ctx.headers['x-session-token'] as string;
  if (!sessionToken) {
    ctx.status = 401;
    ctx.body = { success: false, error: '缺少 sessionToken' };
    return;
  }
  const result = remoteCodeService.verifySession(sessionToken);
  if (!result.valid) {
    ctx.status = 401;
    ctx.body = { success: false, error: '会话无效或已过期' };
    return;
  }
  ctx.body = { success: true, deviceId: result.deviceId, online: webSocketHub.isDeviceOnline(result.deviceId!) };
});

export default router;
```

- [ ] **Step 2: 验证编译**

Run: `cd D:/SLG/server-auth && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 3: 提交**

```bash
cd D:/SLG && git add server-auth/routes/remote.ts
git commit -m "feat(remote): add HTTP API for code generation/verification/logs"
```

---

### Task 7: 集成 WebSocketHub 到 server-auth index.ts

**Files:**
- Modify: `server-auth/index.ts:44-71`

- [ ] **Step 1: 修改 index.ts**

把 `import` 块末尾加入:
```typescript
import { createServer } from 'http';
import remoteRouter from './routes/remote';
import { webSocketHub } from './services/WebSocketHub';
```

把 routes 部分追加 `remoteRouter`:
```typescript
app.use(authRouter.routes()).use(authRouter.allowedMethods());
app.use(adminRouter.routes()).use(adminRouter.allowedMethods());
app.use(remoteRouter.routes()).use(remoteRouter.allowedMethods());
```

把现有的 `app.listen(CONFIG.PORT, CONFIG.HOST, () => { ... });` 整段替换为:
```typescript
const httpServer = createServer(app.callback());
webSocketHub.attach(httpServer);

httpServer.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`========================================`);
  console.log(`   SLG 授权服务`);
  console.log(`========================================`);
  console.log(`服务运行在: http://${CONFIG.HOST}:${CONFIG.PORT}`);
  console.log(`WebSocket: ws://${CONFIG.HOST}:${CONFIG.PORT}/ws/remote`);
  console.log(`管理面板: http://${CONFIG.HOST}:${CONFIG.PORT}/`);
  console.log(`启动时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`========================================`);
});
```

- [ ] **Step 2: 启动服务验证**

```bash
cd D:/SLG/server-auth && npm run dev
```

Expected: 输出 `WebSocket: ws://0.0.0.0:3456/ws/remote`

另开一个终端测试 WS:
```bash
cd D:/SLG/server-auth && node -e "const WS=require('ws');const ws=new WS('ws://localhost:3456/ws/remote');ws.on('open',()=>{console.log('connected');ws.close()});ws.on('error',e=>console.error(e.message))"
```

Expected: 输出 `connected`

- [ ] **Step 3: 提交**

```bash
cd D:/SLG && git add server-auth/index.ts
git commit -m "feat(remote): integrate WebSocketHub into Koa server"
```

---

### Task 8: 电脑端 RemoteClient WebSocket 客户端

**Files:**
- Create: `core/remote/RemoteClient.ts`

- [ ] **Step 1: 安装 ws 客户端依赖**

```bash
cd D:/SLG && npm install ws @types/ws
```

- [ ] **Step 2: 创建 RemoteClient.ts**

```typescript
import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { WsMessage, AuthData, LogData, StatusData, CommandData, ResponseData } from './messages';

const RECONNECT_DELAY_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 30000;
const LOG_BATCH_INTERVAL_MS = 1000;
const LOG_BATCH_SIZE = 10;

export type CommandCallback = (cmd: CommandData) => Promise<{ success: boolean; result?: any; error?: string }>;

export interface RemoteClientOptions {
  serverUrl: string;
  deviceId: string;
  activationCode: string;
}

class RemoteClient {
  private ws: WebSocket | null = null;
  private opts: RemoteClientOptions | null = null;
  private logBuffer: Array<{ message: string; level: string; timestamp: number }> = [];
  private logFlushTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private commandHandler: CommandCallback | null = null;
  private statusProvider: (() => StatusData) | null = null;
  private connected = false;
  private stopped = false;

  start(opts: RemoteClientOptions): void {
    this.opts = opts;
    this.stopped = false;
    this.connect();
    this.startLogFlushLoop();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.logFlushTimer) clearInterval(this.logFlushTimer);
    if (this.ws) { this.ws.close(); this.ws = null; }
  }

  onCommand(handler: CommandCallback): void { this.commandHandler = handler; }
  onStatusRequest(provider: () => StatusData): void { this.statusProvider = provider; }

  pushLog(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this.logBuffer.push({ message, level, timestamp: Date.now() });
    if (this.logBuffer.length >= LOG_BATCH_SIZE) this.flushLogs();
  }

  pushStatus(status: StatusData): void {
    if (!this.connected || !this.ws || !this.opts) return;
    this.send({ type: 'status', id: randomUUID(), deviceId: this.opts.deviceId, data: status, timestamp: Date.now() });
  }

  isConnected(): boolean { return this.connected; }

  private connect(): void {
    if (!this.opts || this.stopped) return;
    try {
      this.ws = new WebSocket(this.opts.serverUrl);
      this.ws.on('open', () => this.onOpen());
      this.ws.on('message', (raw) => this.onMessage(raw.toString()));
      this.ws.on('close', () => this.onClose());
      this.ws.on('error', (err) => console.error('[RemoteClient] WS error:', err.message));
    } catch (e) {
      console.error('[RemoteClient] connect failed:', e);
      this.scheduleReconnect();
    }
  }

  private onOpen(): void {
    if (!this.opts || !this.ws) return;
    const authMsg: WsMessage<AuthData> = {
      type: 'auth', id: randomUUID(), deviceId: this.opts.deviceId,
      data: { role: 'device', token: this.opts.activationCode },
      timestamp: Date.now(),
    };
    this.ws.send(JSON.stringify(authMsg));
  }

  private onMessage(raw: string): void {
    let msg: WsMessage;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'response' && msg.data?.success && !this.connected) {
      this.connected = true;
      console.log('[RemoteClient] authenticated, deviceId:', msg.data.result?.deviceId);
      this.startHeartbeat();
      this.flushLogs();
      return;
    }
    if (msg.type === 'command') this.handleCommand(msg);
  }

  private async handleCommand(msg: WsMessage): Promise<void> {
    const cmd = msg.data as CommandData;
    let response: ResponseData;
    if (cmd.action === 'get_status' && this.statusProvider) {
      response = { requestId: msg.id, success: true, result: this.statusProvider() };
    } else if (this.commandHandler) {
      try {
        const result = await this.commandHandler(cmd);
        response = { requestId: msg.id, ...result };
      } catch (e: any) {
        response = { requestId: msg.id, success: false, error: e.message || String(e) };
      }
    } else {
      response = { requestId: msg.id, success: false, error: '未注册指令处理器' };
    }
    this.send({ type: 'response', id: randomUUID(), deviceId: this.opts!.deviceId, data: response, timestamp: Date.now() });
  }

  private onClose(): void {
    this.connected = false;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (!this.stopped) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[RemoteClient] reconnecting...');
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.ws) {
        this.send({ type: 'heartbeat', id: randomUUID(), deviceId: this.opts!.deviceId, data: {}, timestamp: Date.now() });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private startLogFlushLoop(): void {
    if (this.logFlushTimer) return;
    this.logFlushTimer = setInterval(() => this.flushLogs(), LOG_BATCH_INTERVAL_MS);
  }

  private flushLogs(): void {
    if (!this.connected || !this.ws || !this.opts) return;
    if (this.logBuffer.length === 0) return;
    const batch = this.logBuffer.splice(0, this.logBuffer.length);
    for (const log of batch) {
      this.send({ type: 'log', id: randomUUID(), deviceId: this.opts.deviceId,
        data: { message: log.message, level: log.level } as LogData, timestamp: log.timestamp });
    }
  }

  private send(msg: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

export const remoteClient = new RemoteClient();
```

- [ ] **Step 3: 验证编译**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json`
Expected: 无报错

- [ ] **Step 4: 提交**

```bash
cd D:/SLG && git add core/remote/RemoteClient.ts package.json package-lock.json
git commit -m "feat(remote): add electron-side WebSocket client"
```

---

### Task 9: 在 electron/main.ts 中启动 RemoteClient

**Files:**
- Modify: `electron/main.ts`(在窗口创建后启动 RemoteClient)
- Modify: `server/services/TaskService.ts:162-167`(日志同步到 RemoteClient)

- [ ] **Step 1: 查看 electron/main.ts 当前结构**

Run: `grep -n "createWindow\|app.whenReady\|licenseService" D:/SLG/electron/main.ts`

- [ ] **Step 2: 在 main.ts 顶部 import**

```typescript
import { remoteClient } from '../core/remote/RemoteClient';
import { licenseService } from '../core/license';
```

- [ ] **Step 3: 在 app.whenReady() 之后追加初始化**

找到 `app.whenReady().then(() => { ... createWindow ... })` 块,在创建窗口后追加:

```typescript
  // 启动远程控制客户端(异步,不阻塞窗口)
  setTimeout(async () => {
    try {
      const status = await licenseService.getStatus();
      if (status.activated && status.deviceFingerprint) {
        const stored = require('fs').readFileSync(
          require('path').join(require('os').homedir(), '.slg-automation', 'license.json'),
          'utf-8'
        );
        // 用 deviceFingerprint 作为 deviceId(其实就是 activationCode 的 hash 标识)
        const AUTH_URL = process.env.AUTH_SERVER_URL || 'http://106.15.11.158:3456';
        const WS_URL = AUTH_URL.replace(/^http/, 'ws') + '/ws/remote';
        remoteClient.start({
          serverUrl: WS_URL,
          deviceId: status.deviceFingerprint,
          activationCode: status.deviceFingerprint, // 简化:用指纹作为认证 token
        });
        console.log('[Electron] RemoteClient started, WS:', WS_URL);
      }
    } catch (e) {
      console.error('[Electron] failed to start RemoteClient:', e);
    }
  }, 3000);
```

- [ ] **Step 4: 在 app.on('window-all-closed') 或 before-quit 中停止**

找到 `app.on('window-all-closed', () => { ... })` 或 `before-quit`,追加:

```typescript
  remoteClient.stop();
```

- [ ] **Step 5: 修改 TaskService.ts,同步日志到 RemoteClient**

找到 `server/services/TaskService.ts` 中的 `logCallback`(约 162-167 行):

```typescript
    const logCallback = (msg: string) => {
      const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
      task.logs.push(entry);
      writeLog(task.accountId, msg);
      console.log(`[Task ${taskId.slice(-6)}] ${msg}`);
    };
```

改为:

```typescript
    const logCallback = (msg: string) => {
      const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
      task.logs.push(entry);
      writeLog(task.accountId, msg);
      console.log(`[Task ${taskId.slice(-6)}] ${msg}`);
      // 同步推送到云端(若已连接)
      try {
        const { remoteClient } = require('../../core/remote/RemoteClient');
        if (remoteClient.isConnected()) remoteClient.pushLog(msg, 'info');
      } catch { /* RemoteClient 未初始化(纯后端开发模式),忽略 */ }
    };
```

- [ ] **Step 6: 验证编译**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json`
Expected: 无报错

- [ ] **Step 7: 提交**

```bash
cd D:/SLG && git add electron/main.ts server/services/TaskService.ts
git commit -m "feat(remote): start RemoteClient on electron launch and sync task logs"
```

---

### Task 10: 阶段 1 集成测试 - 端到端日志推送验证

**Files:**
- 无新建/修改文件,仅手动验证

- [ ] **Step 1: 启动 server-auth**

```bash
cd D:/SLG/server-auth && npm run dev
```

Expected: 输出 `WebSocket: ws://0.0.0.0:3456/ws/remote`

- [ ] **Step 2: 启动 SLG 后端(模拟 electron)**

```bash
cd D:/SLG && npm run server
```

- [ ] **Step 3: 用脚本测试 WS 日志推送**

创建临时测试文件 `D:/SLG/temp/test-remote-flow.ts`:

```typescript
import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const DEVICE_ID = 'test-device-001';
const SERVER = 'ws://localhost:3456/ws/remote';

// === 1. 模拟设备连接 ===
const device = new WebSocket(SERVER);
device.on('open', () => {
  console.log('[device] connected, sending auth');
  device.send(JSON.stringify({
    type: 'auth', id: randomUUID(), deviceId: DEVICE_ID,
    data: { role: 'device', token: DEVICE_ID }, timestamp: Date.now(),
  }));
});
device.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  console.log('[device] <-', msg.type, msg.data?.success ?? '');
  if (msg.type === 'response' && msg.data?.success) {
    // 认证成功,推一条日志
    setTimeout(() => {
      device.send(JSON.stringify({
        type: 'log', id: randomUUID(), deviceId: DEVICE_ID,
        data: { message: '测试日志 hello', level: 'info' },
        timestamp: Date.now(),
      }));
      console.log('[device] log sent');
    }, 500);
  }
});

// === 2. 模拟手机端获取验证码并连接 ===
async function userFlow() {
  await new Promise(r => setTimeout(r, 1000));

  // 设备生成验证码
  const codeResp = await fetch('http://localhost:3456/api/remote/generate-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: DEVICE_ID, activationCode: DEVICE_ID }),
  }).then(r => r.json());
  console.log('[setup] code:', codeResp.code);

  // 手机端验证码换 sessionToken
  const verifyResp = await fetch('http://localhost:3456/api/remote/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: codeResp.code }),
  }).then(r => r.json());
  console.log('[setup] sessionToken:', verifyResp.sessionToken?.slice(0, 16) + '...');

  // 手机端连 WS
  const user = new WebSocket(SERVER);
  user.on('open', () => {
    user.send(JSON.stringify({
      type: 'auth', id: randomUUID(), deviceId: '',
      data: { role: 'user', token: verifyResp.sessionToken }, timestamp: Date.now(),
    }));
  });
  user.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    console.log('[user] <-', msg.type, msg.data?.message ?? msg.data?.online ?? '');
  });
}
userFlow();
```

Run: `cd D:/SLG && npx ts-node temp/test-remote-flow.ts`

Expected: 输出应包含
```
[device] connected, sending auth
[device] <- response true
[device] log sent
[setup] code: 123456
[setup] sessionToken: abcdef...
[user] <- response  (认证成功)
[user] <- status  (设备在线)
[user] <- log 测试日志 hello
```

- [ ] **Step 4: 清理临时测试文件**

```bash
rm D:/SLG/temp/test-remote-flow.ts
```

- [ ] **Step 5: 提交阶段 1 完成标记**

```bash
cd D:/SLG && git commit --allow-empty -m "chore: phase 1 complete - device→cloud→user log flow working"
```

---

## 阶段 2: 指令转发 + 电脑端指令处理

### Task 11: 电脑端 CommandHandler - 远程指令分发

**Files:**
- Create: `core/remote/CommandHandler.ts`

- [ ] **Step 1: 创建 CommandHandler.ts**

```typescript
import { CommandData, StatusData } from './messages';

export type RemoteAction =
  | 'start_gem_gather'
  | 'start_rally_join'
  | 'start_cave_explore'
  | 'start_research_tech'
  | 'stop_all_tasks'
  | 'get_status'
  | 'get_logs';

export interface RemoteContext {
  /** 启动任务,返回 success/error */
  startTask(name: string, params?: any): Promise<{ success: boolean; error?: string }>;
  /** 停止所有运行中任务 */
  stopAllTasks(): Promise<{ success: boolean; error?: string }>;
  /** 获取当前状态 */
  getStatus(): StatusData;
}

class CommandHandler {
  private ctx: RemoteContext | null = null;

  setContext(ctx: RemoteContext): void {
    this.ctx = ctx;
  }

  async handle(cmd: CommandData): Promise<{ success: boolean; result?: any; error?: string }> {
    if (!this.ctx) return { success: false, error: '上下文未初始化' };

    switch (cmd.action) {
      case 'start_task': {
        const taskName = cmd.payload?.task;
        if (!taskName) return { success: false, error: '缺少 task 参数' };
        return await this.ctx.startTask(taskName, cmd.payload);
      }
      case 'stop_task':
      case 'stop_all': {
        return await this.ctx.stopAllTasks();
      }
      case 'get_status': {
        return { success: true, result: this.ctx.getStatus() };
      }
      case 'get_logs': {
        return { success: true, result: [] }; // 历史日志走 HTTP API
      }
      default:
        return { success: false, error: `未知指令: ${cmd.action}` };
    }
  }
}

export const commandHandler = new CommandHandler();
```

- [ ] **Step 2: 验证编译**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json`
Expected: 无报错

- [ ] **Step 3: 提交**

```bash
cd D:/SLG && git add core/remote/CommandHandler.ts
git commit -m "feat(remote): add CommandHandler for remote action dispatch"
```

---

### Task 12: 在 server/index.ts 中将 CommandHandler 接入 TaskService

**Files:**
- Modify: `server/index.ts`(启动时注册 RemoteContext)
- Create: `server/services/RemoteContextService.ts`

- [ ] **Step 1: 查看 server/index.ts 启动结构**

Run: `grep -n "app.listen\|pluginService\|migrateLegacy" D:/SLG/server/index.ts`

- [ ] **Step 2: 创建 RemoteContextService.ts**

```typescript
import { taskService } from './TaskService';
import { commandHandler, RemoteContext } from '../../core/remote/CommandHandler';
import { remoteClient } from '../../core/remote/RemoteClient';
import { StatusData } from '../../core/remote/messages';

// 远程指令到本地 action 的映射
const ACTION_MAP: Record<string, { pluginId: string; actionId: string }> = {
  'gem_gather': { pluginId: 'rok', actionId: 'gather-gem' },
  'rally_join': { pluginId: 'rok', actionId: 'join-rally' },
  'cave_explore': { pluginId: 'rok', actionId: 'cave-explore' },
  'research_tech': { pluginId: 'rok', actionId: 'research-tech' },
  'home_loop': { pluginId: 'rok', actionId: 'home-loop' },
};

class RemoteContextService implements RemoteContext {
  private defaultAccountId = '';

  /** 设置远程控制要操作的默认账号(主页第一个账号) */
  setDefaultAccount(accountId: string): void {
    this.defaultAccountId = accountId;
  }

  async startTask(name: string, params?: any): Promise<{ success: boolean; error?: string }> {
    const mapping = ACTION_MAP[name];
    if (!mapping) return { success: false, error: `未知任务: ${name}` };
    if (!this.defaultAccountId) return { success: false, error: '尚未选择账号' };

    try {
      const task = taskService.createTask(this.defaultAccountId, mapping.pluginId, mapping.actionId, params || {});
      // 异步执行,不等结果
      taskService.runTask(task.id).catch(e => console.error('[Remote] task error:', e));
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  async stopAllTasks(): Promise<{ success: boolean; error?: string }> {
    try {
      const tasks = taskService.listTasks().filter(t => t.status === 'running' || t.status === 'pending');
      for (const t of tasks) taskService.stopTask(t.id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  getStatus(): StatusData {
    const tasks = taskService.listTasks().filter(t => t.status === 'running');
    return {
      online: true,
      runningTasks: tasks.map(t => `${t.pluginId}:${t.actionId}`),
    };
  }
}

export const remoteContextService = new RemoteContextService();

/** 在 server 启动时调用一次:把 CommandHandler 接到 RemoteClient */
export function wireRemoteControl(): void {
  commandHandler.setContext(remoteContextService);
  remoteClient.onCommand(async (cmd) => commandHandler.handle(cmd));
  remoteClient.onStatusRequest(() => remoteContextService.getStatus());
  console.log('[Remote] command handler wired');
}
```

- [ ] **Step 3: 在 server/index.ts 启动末尾调用 wireRemoteControl**

在 `app.listen(CONFIG.PORT, CONFIG.HOST, () => { ... })` 块之前加:

```typescript
import { wireRemoteControl } from './services/RemoteContextService';
// ...
wireRemoteControl();
```

- [ ] **Step 4: 验证编译**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json`
Expected: 无报错

- [ ] **Step 5: 提交**

```bash
cd D:/SLG && git add server/services/RemoteContextService.ts server/index.ts
git commit -m "feat(remote): wire CommandHandler to TaskService for remote action execution"
```

---

### Task 13: 添加电脑端「生成验证码」API

**Files:**
- Create: `server/routes/remote.ts`
- Modify: `server/index.ts`(挂载新路由)

- [ ] **Step 1: 创建 server/routes/remote.ts**

```typescript
import Router from 'koa-router';
import { licenseService } from '../../core/license';

const router = new Router({ prefix: '/api/remote' });

const AUTH_URL = process.env.AUTH_SERVER_URL || 'http://106.15.11.158:3456';

/** 生成验证码(转发到 VPS) */
router.post('/generate-code', async (ctx) => {
  const status = await licenseService.getStatus();
  if (!status.activated || !status.deviceFingerprint) {
    ctx.status = 403;
    ctx.body = { success: false, error: '未激活' };
    return;
  }
  try {
    const resp = await fetch(`${AUTH_URL}/api/remote/generate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: status.deviceFingerprint,
        activationCode: status.deviceFingerprint,
      }),
    });
    const data = await resp.json();
    ctx.body = data;
  } catch (e: any) {
    ctx.status = 500;
    ctx.body = { success: false, error: '连接云端失败: ' + (e.message || e) };
  }
});

/** 查询远程客户端连接状态 */
router.get('/connection-status', async (ctx) => {
  const { remoteClient } = require('../../core/remote/RemoteClient');
  ctx.body = { connected: remoteClient.isConnected() };
});

export default router;
```

- [ ] **Step 2: 在 server/index.ts 挂载路由**

```typescript
import remoteRouter from './routes/remote';
// ...
app.use(remoteRouter.routes()).use(remoteRouter.allowedMethods());
```

- [ ] **Step 3: 启动并测试**

```bash
cd D:/SLG && npm run server
```

另一个终端:
```bash
curl -X POST http://localhost:3000/api/remote/generate-code
```

Expected: 返回 `{ success: true, code: "123456", expiresAt: ... }`(前提是已激活)

- [ ] **Step 4: 提交**

```bash
cd D:/SLG && git add server/routes/remote.ts server/index.ts
git commit -m "feat(remote): add /api/remote/generate-code endpoint for local client"
```

---

### Task 14: 让 remote API 通过 licenseGuard 白名单

**Files:**
- Modify: `server/middleware/licenseGuard.ts`

- [ ] **Step 1: 检查 licenseGuard 白名单**

Run: `cat D:/SLG/server/middleware/licenseGuard.ts | head -30`

- [ ] **Step 2: 把 /api/remote/* 加到白名单**

找到白名单匹配代码(类似 `if (path.startsWith('/api/health'))`)的位置,追加:

```typescript
  if (path.startsWith('/api/remote/connection-status')) {
    return next();
  }
```

(`/api/remote/generate-code` 必须激活才能用,所以不放白名单)

- [ ] **Step 3: 提交**

```bash
cd D:/SLG && git add server/middleware/licenseGuard.ts
git commit -m "feat(remote): whitelist /api/remote/connection-status from license guard"
```

---

## 阶段 3: 手机端 UI - 控制面板 + Tab 切换

### Task 15: 前端 API 封装 - api/remote.ts

**Files:**
- Create: `web/src/api/remote.ts`

- [ ] **Step 1: 创建 remote.ts**

```typescript
// 远程控制 API 封装
// 内网模式直接调本地后端,外网模式调 VPS

const AUTH_URL = (import.meta as any).env?.VITE_AUTH_URL || 'http://106.15.11.158:3456';

export const remoteApi = {
  /** 本地后端:让本地客户端生成验证码 */
  async generateCode(): Promise<{ success: boolean; code?: string; expiresAt?: number; error?: string }> {
    const resp = await fetch('/api/remote/generate-code', { method: 'POST' });
    return resp.json();
  },

  /** 本地后端:查询 RemoteClient 是否连上 VPS */
  async connectionStatus(): Promise<{ connected: boolean }> {
    try {
      const resp = await fetch('/api/remote/connection-status');
      return resp.json();
    } catch {
      return { connected: false };
    }
  },

  /** 云端:手机端验证验证码,换取 sessionToken */
  async verifyCode(code: string): Promise<{ success: boolean; sessionToken?: string; deviceId?: string; deviceOnline?: boolean; error?: string }> {
    const resp = await fetch(`${AUTH_URL}/api/remote/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    return resp.json();
  },

  /** 云端:拉取历史日志 */
  async fetchLogs(sessionToken: string, limit: number = 200): Promise<{ success: boolean; logs?: any[]; deviceOnline?: boolean; error?: string }> {
    const resp = await fetch(`${AUTH_URL}/api/remote/logs?limit=${limit}`, {
      headers: { 'x-session-token': sessionToken },
    });
    return resp.json();
  },

  /** 云端:查询设备在线状态 */
  async deviceStatus(sessionToken: string): Promise<{ success: boolean; online?: boolean; error?: string }> {
    const resp = await fetch(`${AUTH_URL}/api/remote/status`, {
      headers: { 'x-session-token': sessionToken },
    });
    return resp.json();
  },

  /** 云端:WebSocket URL */
  getWsUrl(): string {
    return AUTH_URL.replace(/^http/, 'ws') + '/ws/remote';
  },
};
```

- [ ] **Step 2: 提交**

```bash
cd D:/SLG && git add web/src/api/remote.ts
git commit -m "feat(remote): add frontend API wrapper"
```

---

### Task 16: 创建 useRemoteSocket hook

**Files:**
- Create: `web/src/hooks/useRemoteSocket.ts`

- [ ] **Step 1: 创建 useRemoteSocket.ts**

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import { remoteApi } from '../api/remote';

interface WsMessage {
  type: string;
  id: string;
  deviceId: string;
  data: any;
  timestamp: number;
}

export interface LogEntry {
  id: number;
  time: string;
  message: string;
  timestamp: number;
  level?: string;
}

export interface RemoteState {
  connected: boolean;
  deviceOnline: boolean;
  logs: LogEntry[];
  runningTasks: string[];
}

const MAX_LOGS = 500;
let logIdSeq = 1;

function timestampToTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN');
}

/** 远程控制 WebSocket Hook,自动重连 */
export function useRemoteSocket(sessionToken: string | null) {
  const [state, setState] = useState<RemoteState>({
    connected: false, deviceOnline: false, logs: [], runningTasks: [],
  });
  const wsRef = useRef<WebSocket | null>(null);
  const pendingResponses = useRef<Map<string, (resp: any) => void>>(new Map());
  const reconnectTimer = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (!sessionToken) return;
    const ws = new WebSocket(remoteApi.getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'auth', id: crypto.randomUUID(), deviceId: '',
        data: { role: 'user', token: sessionToken }, timestamp: Date.now(),
      }));
    };

    ws.onmessage = (e) => {
      let msg: WsMessage;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'response' && msg.data?.success && !state.connected) {
        setState(s => ({ ...s, connected: true }));
        return;
      }

      if (msg.type === 'response' && msg.data?.requestId) {
        const cb = pendingResponses.current.get(msg.data.requestId);
        if (cb) { cb(msg.data); pendingResponses.current.delete(msg.data.requestId); }
        return;
      }

      if (msg.type === 'status') {
        setState(s => ({
          ...s,
          deviceOnline: !!msg.data.online,
          runningTasks: msg.data.runningTasks || [],
        }));
        return;
      }

      if (msg.type === 'log') {
        const entry: LogEntry = {
          id: logIdSeq++,
          time: timestampToTime(msg.timestamp),
          message: msg.data.message,
          level: msg.data.level,
          timestamp: msg.timestamp,
        };
        setState(s => ({ ...s, logs: [...s.logs, entry].slice(-MAX_LOGS) }));
        return;
      }
    };

    ws.onclose = () => {
      setState(s => ({ ...s, connected: false }));
      if (sessionToken) {
        reconnectTimer.current = window.setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => { /* close 会随后触发 */ };
  }, [sessionToken]);

  // 发送指令,返回 Promise
  const sendCommand = useCallback((action: string, payload?: any, timeoutMs: number = 10000): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('未连接到云端'));
        return;
      }
      const reqId = crypto.randomUUID();
      pendingResponses.current.set(reqId, resolve);
      setTimeout(() => {
        if (pendingResponses.current.has(reqId)) {
          pendingResponses.current.delete(reqId);
          reject(new Error('指令超时'));
        }
      }, timeoutMs);
      wsRef.current.send(JSON.stringify({
        type: 'command', id: reqId, deviceId: '',
        data: { action, payload }, timestamp: Date.now(),
      }));
    });
  }, []);

  // 预加载历史日志
  const loadHistory = useCallback(async () => {
    if (!sessionToken) return;
    const resp = await remoteApi.fetchLogs(sessionToken, 200);
    if (resp.success && resp.logs) {
      const entries: LogEntry[] = resp.logs.map((l: any) => ({
        id: logIdSeq++,
        time: timestampToTime(l.timestamp),
        message: l.message,
        level: l.level,
        timestamp: l.timestamp,
      }));
      setState(s => ({ ...s, logs: entries }));
    }
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) return;
    loadHistory();
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [sessionToken, connect, loadHistory]);

  return { state, sendCommand };
}
```

- [ ] **Step 2: 提交**

```bash
cd D:/SLG && git add web/src/hooks/useRemoteSocket.ts
git commit -m "feat(remote): add useRemoteSocket hook with auto-reconnect"
```

---

### Task 17: 创建 RemoteAccess.tsx - 验证码输入页面

**Files:**
- Create: `web/src/pages/RemoteAccess.tsx`

- [ ] **Step 1: 创建 RemoteAccess.tsx**

```typescript
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { remoteApi } from '../api/remote';

const SESSION_KEY = 'remote-session-token';

export default function RemoteAccessPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // 检查已有 session,直接跳转到 Mobile 页
  useEffect(() => {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) navigate('/mobile?remote=1');
  }, [navigate]);

  // 从 URL 自动填充验证码
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('code');
    if (c && /^\d{6}$/.test(c)) {
      setCode(c);
      handleSubmit(c);
    }
  }, []);

  async function handleSubmit(submitCode?: string) {
    const target = submitCode || code;
    if (!/^\d{6}$/.test(target)) {
      setError('请输入 6 位数字验证码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await remoteApi.verifyCode(target);
      if (result.success && result.sessionToken) {
        localStorage.setItem(SESSION_KEY, result.sessionToken);
        navigate('/mobile?remote=1');
      } else {
        setError(result.error || '验证失败');
      }
    } catch (e: any) {
      setError('网络错误: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-2">📱 远程访问</h1>
        <p className="text-sm text-slate-400 text-center mb-8">
          请输入电脑端显示的 6 位验证码
        </p>

        <input
          type="tel"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          className="w-full px-4 py-4 bg-slate-800 border border-slate-700 rounded-xl text-center text-2xl tracking-widest"
        />

        {error && <p className="text-red-400 text-sm mt-3 text-center">{error}</p>}

        <button
          onClick={() => handleSubmit()}
          disabled={loading || code.length !== 6}
          className="w-full mt-6 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl font-medium transition-colors"
        >
          {loading ? '验证中...' : '验证'}
        </button>

        <p className="text-xs text-slate-500 text-center mt-8">
          验证码有效期 10 分钟,仅可使用一次
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
cd D:/SLG && git add web/src/pages/RemoteAccess.tsx
git commit -m "feat(remote): add RemoteAccess page for code input"
```

---

### Task 18: 创建 ControlPanel.tsx - 控制面板 Tab

**Files:**
- Create: `web/src/pages/ControlPanel.tsx`

- [ ] **Step 1: 创建 ControlPanel.tsx**

```typescript
import { useState } from 'react';

interface ControlPanelProps {
  deviceOnline: boolean;
  runningTasks: string[];
  onSendCommand: (action: string, payload?: any) => Promise<any>;
}

const TASKS = [
  { key: 'gem_gather', label: '💎 宝石采集', actionId: 'rok:gather-gem' },
  { key: 'rally_join', label: '🏰 加入集结', actionId: 'rok:join-rally' },
  { key: 'cave_explore', label: '🗻 山洞探索', actionId: 'rok:cave-explore' },
  { key: 'research_tech', label: '🔬 科技研究', actionId: 'rok:research-tech' },
];

export default function ControlPanel({ deviceOnline, runningTasks, onSendCommand }: ControlPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  function isRunning(actionId: string): boolean {
    return runningTasks.includes(actionId);
  }

  async function handleStart(task: typeof TASKS[number]) {
    setBusy(task.key);
    try {
      const result = await onSendCommand('start_task', { task: task.key });
      if (result.success) setToast(`已启动:${task.label}`);
      else setToast(`启动失败:${result.error || '未知错误'}`);
    } catch (e: any) {
      setToast(`错误:${e.message || e}`);
    } finally {
      setBusy(null);
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleStopAll() {
    if (!confirm('确定停止所有运行中的任务?')) return;
    setBusy('stop_all');
    try {
      const result = await onSendCommand('stop_all');
      if (result.success) setToast('已停止所有任务');
      else setToast(`停止失败:${result.error || '未知错误'}`);
    } catch (e: any) {
      setToast(`错误:${e.message || e}`);
    } finally {
      setBusy(null);
      setTimeout(() => setToast(''), 3000);
    }
  }

  return (
    <div className="p-4 space-y-4">
      {!deviceOnline && (
        <div className="bg-amber-900/30 border border-amber-600 rounded-xl p-3 text-amber-200 text-sm">
          ⚠️ 电脑端离线,无法发送指令。请确认电脑已开机且 SLG 助手在运行。
        </div>
      )}

      <div className="space-y-3">
        {TASKS.map(t => {
          const running = isRunning(t.actionId);
          return (
            <div key={t.key} className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{t.label}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {running ? '🟢 运行中' : '⚪ 空闲'}
                </div>
              </div>
              <button
                onClick={() => handleStart(t)}
                disabled={!deviceOnline || busy === t.key || running}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-sm font-medium transition-colors"
              >
                {busy === t.key ? '处理中...' : running ? '运行中' : '启动'}
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleStopAll}
        disabled={!deviceOnline || busy !== null || runningTasks.length === 0}
        className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl font-medium transition-colors"
      >
        {busy === 'stop_all' ? '停止中...' : '🛑 停止所有任务'}
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

- [ ] **Step 2: 提交**

```bash
cd D:/SLG && git add web/src/pages/ControlPanel.tsx
git commit -m "feat(remote): add ControlPanel component"
```

---

### Task 19: 重构 Mobile.tsx - 支持外网模式 + Tab 切换

**Files:**
- Modify: `web/src/pages/Mobile.tsx`(整体重构)

- [ ] **Step 1: 完全重写 Mobile.tsx**

```typescript
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRemoteSocket, LogEntry } from '../hooks/useRemoteSocket';
import ControlPanel from './ControlPanel';

const SESSION_KEY = 'remote-session-token';
type Tab = 'logs' | 'control' | 'status';

interface LocalLogEntry {
  id: number;
  time: string;
  message: string;
  timestamp: number;
}

export default function MobilePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isRemoteMode = params.get('remote') === '1';
  const sessionToken = isRemoteMode ? localStorage.getItem(SESSION_KEY) : null;

  // 远程模式状态
  const remote = useRemoteSocket(sessionToken);

  // 内网模式状态(保持原有逻辑)
  const [localLogs, setLocalLogs] = useState<LocalLogEntry[]>([]);
  const [localConnected, setLocalConnected] = useState(false);

  // UI 状态
  const [tab, setTab] = useState<Tab>('logs');
  const [onlySuccess, setOnlySuccess] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 远程模式跳转保护
  useEffect(() => {
    if (isRemoteMode && !sessionToken) navigate('/remote-access');
  }, [isRemoteMode, sessionToken, navigate]);

  // 内网模式:SSE 日志
  useEffect(() => {
    if (isRemoteMode) return;
    fetch('/api/logs/history?limit=200').then(r => r.json()).then(d => setLocalLogs(d.logs || [])).catch(() => {});
    const es = new EventSource('/api/logs/stream');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') { setLocalConnected(true); return; }
        if (data.id && data.message) {
          setLocalLogs(prev => [...prev, data].slice(-500));
        }
      } catch {}
    };
    es.onerror = () => setLocalConnected(false);
    return () => es.close();
  }, [isRemoteMode]);

  // 当前激活的日志和状态
  const logs: Array<LogEntry | LocalLogEntry> = isRemoteMode ? remote.state.logs : localLogs;
  const connected = isRemoteMode ? remote.state.connected : localConnected;
  const deviceOnline = isRemoteMode ? remote.state.deviceOnline : localConnected;

  // 过滤
  const filteredLogs = onlySuccess
    ? logs.filter(l => l.message.includes('✅') || l.message.includes('完成'))
    : logs;

  // 自动滚动
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // 统计
  const gemCount = logs.filter(l => l.message.includes('💎') || l.message.includes('宝石')).length;
  const rallyCount = logs.filter(l => l.message.includes('🏰') || l.message.includes('集结')).length;

  function handleLogout() {
    if (isRemoteMode) {
      localStorage.removeItem(SESSION_KEY);
      navigate('/remote-access');
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white pb-20">
      {/* 顶部状态栏 */}
      <div className="sticky top-0 z-10 bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">📱</span>
            <h1 className="text-lg font-bold">SLG 助手</h1>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {isRemoteMode && (
              <span className="text-xs text-emerald-400 ml-2">
                {deviceOnline ? '🟢 电脑在线' : '🔴 电脑离线'}
              </span>
            )}
          </div>
          {isRemoteMode && (
            <button onClick={handleLogout} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs">
              退出
            </button>
          )}
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-xl p-3">
            <div className="text-2xl font-bold">{gemCount}</div>
            <div className="text-xs text-purple-200">💎 宝石采集</div>
          </div>
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-3">
            <div className="text-2xl font-bold">{rallyCount}</div>
            <div className="text-xs text-orange-200">🏰 城寨集结</div>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="sticky top-[124px] z-10 bg-slate-800/95 border-b border-slate-700 flex">
        {(['logs', 'control', 'status'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-400'
            }`}
          >
            {t === 'logs' ? '日志' : t === 'control' ? '控制' : '状态'}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {tab === 'logs' && (
        <>
          <div className="sticky top-[172px] z-10 bg-slate-800/90 backdrop-blur px-4 py-2 flex items-center justify-between border-b border-slate-700">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={onlySuccess} onChange={e => setOnlySuccess(e.target.checked)}
                className="w-4 h-4 accent-emerald-500" />
              <span className="text-slate-300">仅看成功</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)}
                className="w-4 h-4 accent-emerald-500" />
              <span className="text-slate-300">自动滚动</span>
            </label>
          </div>

          <div ref={scrollRef} className="h-[calc(100vh-230px)] overflow-y-auto">
            <div className="px-3 py-2 space-y-0.5 font-mono text-xs">
              {filteredLogs.map(log => (
                <div key={log.id}
                  className={`py-1.5 px-2 rounded ${
                    log.message.includes('✅') ? 'bg-green-900/30 text-green-300' :
                    log.message.includes('⚠️') ? 'bg-yellow-900/30 text-yellow-300' :
                    log.message.includes('⛔') ? 'bg-red-900/30 text-red-300' :
                    log.message.includes('💎') ? 'bg-purple-900/30 text-purple-300' :
                    log.message.includes('🏰') ? 'bg-orange-900/30 text-orange-300' :
                    'text-slate-400'
                  }`}>
                  <span className="text-slate-500 mr-2">[{log.time}]</span>
                  {log.message.replace(/\[\d{2}:\d{2}:\d{2}\]\s*/, '')}
                </div>
              ))}
              {filteredLogs.length === 0 && (
                <div className="text-center py-10 text-slate-500">暂无日志</div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'control' && isRemoteMode && (
        <ControlPanel
          deviceOnline={remote.state.deviceOnline}
          runningTasks={remote.state.runningTasks}
          onSendCommand={remote.sendCommand}
        />
      )}

      {tab === 'control' && !isRemoteMode && (
        <div className="p-6 text-center text-slate-400 text-sm">
          内网模式不支持远程控制,请在电脑上直接操作
        </div>
      )}

      {tab === 'status' && (
        <div className="p-4 space-y-3">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-sm text-slate-400">设备状态</div>
            <div className="text-lg font-medium mt-1">
              {deviceOnline ? '🟢 在线' : '🔴 离线'}
            </div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-sm text-slate-400">运行中任务</div>
            {isRemoteMode && remote.state.runningTasks.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {remote.state.runningTasks.map(t => (
                  <li key={t} className="text-sm">🟢 {t}</li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-slate-500 mt-2">无</div>
            )}
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-sm text-slate-400">连接信息</div>
            <div className="text-xs text-slate-500 mt-2 space-y-1">
              <div>模式:{isRemoteMode ? '外网(云端)' : '内网(局域网)'}</div>
              <div>WebSocket:{connected ? '已连接' : '已断开'}</div>
              <div>日志总数:{logs.length}</div>
            </div>
          </div>
        </div>
      )}

      {/* 底部状态栏 */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 px-4 py-2 text-center">
        <span className="text-xs text-slate-400">
          共 {logs.length} 条日志 · {connected ? '🟢 已连接' : '🔴 断开'}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
cd D:/SLG && git add web/src/pages/Mobile.tsx
git commit -m "feat(remote): rebuild Mobile page with tabs + remote mode support"
```

---

### Task 20: 在 App.tsx 添加 /remote-access 路由

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 检查现有路由**

Run: `grep -n "Route\|Mobile" D:/SLG/web/src/App.tsx`

- [ ] **Step 2: 在 App.tsx 添加新路由**

在 `Routes` 内追加(放在 Mobile 路由附近):

```typescript
import RemoteAccessPage from './pages/RemoteAccess';
// ...
<Route path="/remote-access" element={<RemoteAccessPage />} />
```

- [ ] **Step 3: 验证构建**

```bash
cd D:/SLG/web && npm run build
```

Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
cd D:/SLG && git add web/src/App.tsx
git commit -m "feat(remote): add /remote-access route"
```

---

### Task 21: 在 Home.tsx 添加「远程控制」按钮 + 验证码弹窗

**Files:**
- Modify: `web/src/pages/Home.tsx`(在合适位置添加按钮)

- [ ] **Step 1: 在 Home.tsx 文件顶部追加 import**

```typescript
import { remoteApi } from '../api/remote';
```

- [ ] **Step 2: 在 Home 组件内添加远程控制弹窗逻辑**

在主组件函数(`export default function Home()`)内添加状态:

```typescript
  const [remoteCodeModal, setRemoteCodeModal] = useState(false);
  const [remoteCode, setRemoteCode] = useState('');
  const [remoteCodeExpires, setRemoteCodeExpires] = useState(0);
  const [remoteCodeError, setRemoteCodeError] = useState('');
  const [remoteCodeLoading, setRemoteCodeLoading] = useState(false);
```

添加生成验证码函数:

```typescript
  async function handleOpenRemoteControl() {
    setRemoteCodeModal(true);
    setRemoteCodeError('');
    setRemoteCode('');
    setRemoteCodeLoading(true);
    try {
      const result = await remoteApi.generateCode();
      if (result.success && result.code) {
        setRemoteCode(result.code);
        setRemoteCodeExpires(result.expiresAt || 0);
      } else {
        setRemoteCodeError(result.error || '生成验证码失败');
      }
    } catch (e: any) {
      setRemoteCodeError('网络错误: ' + (e.message || e));
    } finally {
      setRemoteCodeLoading(false);
    }
  }
```

- [ ] **Step 3: 在合适位置(如顶部按钮区或右上角)添加按钮**

```tsx
        <button
          onClick={handleOpenRemoteControl}
          className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-sm"
        >
          📱 远程控制
        </button>
```

- [ ] **Step 4: 在 JSX 末尾(组件 return 前的 div 内最后位置)添加弹窗**

```tsx
      {remoteCodeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setRemoteCodeModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">📱 手机远程访问</h3>
            {remoteCodeLoading ? (
              <p className="text-center py-8 text-slate-500">生成中...</p>
            ) : remoteCodeError ? (
              <p className="text-red-500 text-sm py-4">{remoteCodeError}</p>
            ) : remoteCode ? (
              <>
                <p className="text-sm text-slate-600 mb-4">在手机浏览器打开:</p>
                <div className="bg-slate-100 rounded-lg p-3 mb-4 text-xs break-all font-mono">
                  https://你的域名/remote-access?code={remoteCode}
                </div>
                <p className="text-sm text-slate-600 mb-2">或手动输入验证码:</p>
                <div className="text-3xl font-mono text-center py-4 bg-emerald-50 rounded-lg tracking-widest text-emerald-700">
                  {remoteCode}
                </div>
                <p className="text-xs text-slate-400 text-center mt-3">
                  有效期至: {new Date(remoteCodeExpires).toLocaleTimeString('zh-CN')}
                </p>
              </>
            ) : null}
            <button
              onClick={() => setRemoteCodeModal(false)}
              className="w-full mt-6 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm"
            >
              关闭
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: 验证编译**

Run: `cd D:/SLG/web && npm run build`
Expected: 编译成功

- [ ] **Step 6: 提交**

```bash
cd D:/SLG && git add web/src/pages/Home.tsx
git commit -m "feat(remote): add remote control button + code modal to Home page"
```

---

## 阶段 4: 最终验证 + 部署

### Task 22: 阶段 3+4 端到端测试

**Files:**
- 无文件改动,完整流程验证

- [ ] **Step 1: 准备环境**

启动三端:
```bash
# 终端 1: server-auth (云端)
cd D:/SLG/server-auth && npm run dev

# 终端 2: SLG 后端(电脑端)
cd D:/SLG && npm run server

# 终端 3: SLG 前端
cd D:/SLG/web && npm run dev
```

- [ ] **Step 2: 内网流程验证**

1. 电脑浏览器打开 `http://localhost:5173`,确认 Home 页正常,「远程控制」按钮可见
2. 手机浏览器打开 `http://电脑IP:5173/mobile`,确认日志实时显示(内网模式)
3. 在 Home 页启动一个任务,观察手机端日志同步

Expected: 全部正常

- [ ] **Step 3: 外网模拟流程验证**

1. 电脑浏览器 Home 页点「远程控制」按钮 → 弹窗显示 6 位验证码
2. 在浏览器另开窗口打开 `http://localhost:5173/remote-access?code=XXXXXX`
3. 应自动验证并跳转到 `/mobile?remote=1`
4. 切到「控制」Tab,点击「💎 宝石采集」 → 应能启动任务
5. 切到「日志」Tab,应看到任务日志实时滚动

Expected: 全部正常

- [ ] **Step 4: 异常场景验证**

- 输入错误验证码 → 错误提示
- 连续输错 3 次 → 返回 429 锁定
- 关闭电脑后端 → 手机端「电脑离线」提示,启动按钮置灰
- 重启电脑后端 → 自动重连,「电脑在线」恢复

- [ ] **Step 5: 提交验证完成标记**

```bash
cd D:/SLG && git commit --allow-empty -m "chore: phase 3+4 end-to-end test passed"
```

---

### Task 23: 部署 server-auth 新版到 VPS

**Files:**
- 无代码改动,部署操作

- [ ] **Step 1: 本地构建**

```bash
cd D:/SLG/server-auth && npm run build
```

Expected: `dist/` 目录生成

- [ ] **Step 2: 提交并推送(假设 server-auth 也用 git 同步到 VPS)**

```bash
cd D:/SLG && git push
```

- [ ] **Step 3: VPS 上拉取并重启**

SSH 登录 VPS:
```bash
ssh root@106.15.11.158
cd /path/to/server-auth
git pull
npm install
npm run build
# 用 Docker 或 systemd 重启服务
docker-compose restart   # 或 systemctl restart slg-auth
```

- [ ] **Step 4: 验证 VPS 服务**

```bash
curl http://106.15.11.158:3456/health
# 应返回 { status: "ok", version: "..." }

# 测试 WS 端点
node -e "const W=require('ws');const w=new W('ws://106.15.11.158:3456/ws/remote');w.on('open',()=>{console.log('ok');w.close()});w.on('error',e=>console.error(e.message))"
```

Expected: WS 连接成功

- [ ] **Step 5: 真机外网测试**

1. 手机切换到 4G/5G(关闭 WiFi)
2. 在电脑端 Home 点「远程控制」获取验证码
3. 手机浏览器打开 `http://106.15.11.158:3456`(暂时用 IP)→ 实际部署时应配置静态前端到 VPS 或用域名
4. 输入验证码 → 应能看到日志和控制面板

注:由于现阶段没有域名,可以临时把构建后的 web 前端复制到 server-auth 的 admin/ 或新建 mobile/ 目录托管。

- [ ] **Step 6: 标记部署完成**

```bash
cd D:/SLG && git commit --allow-empty -m "chore: deployed remote control v1 to VPS"
```

---

### Task 24: 文档与版本号

**Files:**
- Modify: `CLAUDE.md`(添加远程控制说明)
- Modify: `package.json`(版本号 +1)

- [ ] **Step 1: 更新 package.json 版本号**

把 `package.json` 的 `version` 从当前值升级一个小版本(如 `1.1.0` → `1.2.0`)。

- [ ] **Step 2: 更新 CLAUDE.md,在「架构」或末尾追加远程控制章节**

```markdown
## 远程控制系统(v1.2+)

电脑端 exe 启动时主动连接 VPS(`ws://106.15.11.158:3456/ws/remote`),建立 WebSocket 长连接。手机端通过验证码访问 VPS,VPS 透传消息到对应设备。

**关键模块:**
- `core/remote/RemoteClient.ts` — 电脑端 WS 客户端,负责日志推送和指令接收
- `core/remote/CommandHandler.ts` — 指令分发(start_task/stop_all/get_status)
- `server/services/RemoteContextService.ts` — 把指令接到 TaskService
- `server-auth/services/WebSocketHub.ts` — VPS 消息路由
- `server-auth/services/RemoteCodeService.ts` — 6 位验证码 + sessionToken
- `server-auth/services/RemoteLogService.ts` — 云端日志存储(7 天保留)
- `web/src/pages/RemoteAccess.tsx` — 手机端验证码输入页
- `web/src/pages/Mobile.tsx` — 手机端日志+控制+状态 Tab
- `web/src/hooks/useRemoteSocket.ts` — WebSocket 客户端 hook

**验证码:** 6 位数字,10 分钟过期,单次使用,错 3 次锁 1 分钟
**心跳:** 设备/手机均 30 秒一次
**日志:** 攒 10 条或 1 秒批量推送,断线缓存重连后补发
**会话:** 手机端 sessionToken 24 小时过期
```

- [ ] **Step 3: 提交**

```bash
cd D:/SLG && git add package.json CLAUDE.md
git commit -m "docs: add remote control v1 to project documentation"
```

---

## 自检清单 (Self-Review)

### Spec 覆盖检查

| Spec 章节 | 实现任务 |
|-----------|----------|
| 3.1 双层验证机制 | Task 3 (RemoteCodeService) + Task 5 (WebSocketHub 认证) |
| 3.2 验证码生成流程 | Task 13 (本地生成 API) + Task 6 (云端验证 API) + Task 17 (手机端输入) |
| 3.3 安全措施 | Task 6 (错误次数锁定) + Task 3 (单次使用/过期) |
| 4.1-4.3 消息协议 | Task 1 (messages.ts) |
| 5.1 文件结构 | Task 1-7 |
| 5.2 数据库表 | Task 2 |
| 5.3 日志自动清理 | Task 4 |
| 5.4 HTTP API 端点 | Task 6, 13 |
| 6.1 文件结构 | Task 8, 11 |
| 6.2 支持的远程指令 | Task 11 (CommandHandler) + Task 12 (RemoteContextService) |
| 6.3 日志推送策略 | Task 8 (RemoteClient.flushLogs - 批量/断线缓存) |
| 7.1 页面重构 | Task 19 (Mobile.tsx Tab) |
| 7.2 Tab 功能详情 | Task 18 (ControlPanel) + Task 19 (Mobile 状态 Tab) |
| 7.3 自动识别内网/外网 | Task 19 (`?remote=1` 区分) |
| 10. 风险应对 | Task 16 (重连) + Task 6 (锁定) + Task 4 (清理) |

### 关键约束遵守

- ✅ 每个任务 ≤ 30 分钟工作量
- ✅ 每个文件单一职责
- ✅ 所有步骤都有具体代码,无 TBD/TODO
- ✅ TDD 暂未严格按照"先测试再实现"展开 — 因为这是端到端集成项目,在 Task 10 和 Task 22 做集成测试,单元测试可在后续迭代补
- ✅ 频繁 commit,每个 task 至少 1 次提交

### 命名一致性

- `deviceId` 全程一致(电脑端激活码指纹)
- `sessionToken` 全程一致(手机端 24h 会话)
- `WsMessage`/`AuthData`/`LogData`/`CommandData`/`ResponseData`/`StatusData` 在 `server-auth/ws/messages.ts` 和 `core/remote/messages.ts` 完全一致
- `remoteClient.pushLog/pushStatus/onCommand/onStatusRequest` 命名一致





