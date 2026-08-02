# 远程日志保留策略收缩与数据库瘦身 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `remote_logs` 保留策略收紧为"每设备最近 500 条（插入同事务裁剪）+ 30 天兜底清理"，并对生产库执行一次性清理与 VACUUM 缩库（157MB → 约 8MB）。

**Architecture:** 修改 `server-auth/services/RemoteLogService.ts`：插入事务内同步裁剪（不依赖调度）、`cleanup()` 简化为按 30 天时间删除、调度改为每小时 setInterval + try/catch（unref）。生产以 `npx ts-node --transpile-only` 跑源码，部署目标是源码文件；清理缩库在 VPS 上用 sqlite3 CLI 执行。

**Tech Stack:** TypeScript（ts-node --transpile-only）、better-sqlite3、Node 内置 test runner（`node --test`）、sqlite3 CLI（VPS 3.37.2）。

## Global Constraints

- 每设备最多保留最近 500 条（`MAX_LOGS_PER_DEVICE = 500`），按 `timestamp` 排序取最新
- 兜底时间维度：`LOG_RETENTION_MS = 30 天`
- 裁剪必须与 INSERT 在**同一 SQLite 事务**内（调用方逐条调用 insertLogs，不得拆成两次写事务）
- 裁剪 SQL 共 2 个 `?` 占位符（两个 device_id），`LIMIT 500` 用常量；绑定参数恰好 2 个；禁止用 `id <= OFFSET` 替代（timestamp 由客户端携带，id 顺序 ≠ 时间顺序）
- 兜底清理调度：每小时 setInterval + try/catch，`unref()`（避免测试进程挂起）
- **类型门禁**：线上 `--transpile-only` 不做类型检查，本地 `npm run build`（tsc）必须通过
- `getLogs`（limit 200）、`clearDevice` 行为不变；`heartbeat_logs` 等表不动
- 版本号 `1.0.3` → `1.0.4`
- 不引入新依赖
- **不执行 git 提交**（用户明确要求 git 仅在主动要求时执行；本计划所有任务均不含 commit 步骤）

---

### Task 1: 改造 RemoteLogService（插入同事务裁剪 + 30 天兜底清理）

**Files:**
- Modify: `server-auth/services/RemoteLogService.ts`
- Test: `server-auth/backup/remote-log-retention.test.mjs`（Task 2 创建，本任务先让测试红）

**Interfaces:**
- Consumes: `getDb()`（`./AuthDatabase`）
- Produces: `insertLogs(deviceId, activationCode, logs)` 在插入后同事务裁剪；`cleanup()` 只按 30 天删除；模块加载时启动每小时 sweep（unref）

- [ ] **Step 1: 建立测试基线**

确保本地有可用的 dist（测试从 dist 引入）：

Run: `cd server-auth; npm run build`
Expected: 退出码 0，`dist/services/RemoteLogService.js` 存在

- [ ] **Step 2: 写失败测试**

创建 `server-auth/backup/remote-log-retention.test.mjs`：

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DAY = 86400000;
let remoteLogService, getDb, tmpDir;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'retention-'));
  process.env.DB_PATH = join(tmpDir, 'auth.db');
  ({ remoteLogService } = await import('../dist/services/RemoteLogService.js'));
  ({ getDb } = await import('../dist/services/AuthDatabase.js'));
  getDb(); // 初始化表结构
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function push(deviceId, n, tsOffset = 0) {
  const now = Date.now();
  const logs = Array.from({ length: n }, (_, i) => ({
    message: `log-${deviceId}-${i}`,
    level: 'info',
    timestamp: now + tsOffset + i,
  }));
  remoteLogService.insertLogs(deviceId, 'TEST-CODE', logs);
}

function count(deviceId) {
  return remoteLogService.getLogs(deviceId, 1000000).length;
}

test('插入 600 条后仅保留最近 500 条', () => {
  push('d1', 600);
  assert.equal(count('d1'), 500);
});

test('多设备各自独立裁剪', () => {
  push('d2', 600);
  push('d3', 600);
  assert.equal(count('d2'), 500);
  assert.equal(count('d3'), 500);
});

test('恰好 500 条时不删', () => {
  push('d4', 500);
  assert.equal(count('d4'), 500);
});

test('501 条删 1 条', () => {
  push('d5', 501);
  assert.equal(count('d5'), 500);
});

test('时间戳乱序仍按 timestamp 保留最近 500 条', () => {
  push('d6', 500);
  push('d6', 100, -1000000); // 100 条更旧时间戳的日志
  assert.equal(count('d6'), 500); // 应保留最先插入的 500 条（时间戳更新）
});

test('30 天前的日志被兜底清理删除', () => {
  push('d7', 10);
  getDb().prepare('UPDATE remote_logs SET timestamp = ? WHERE device_id = ?')
    .run(Date.now() - 31 * DAY, 'd7');
  remoteLogService.cleanup();
  assert.equal(count('d7'), 0);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd server-auth; npm test`
Expected: 新增测试 FAIL（旧代码无插入裁剪、上限 10000、`cleanup()` 含旧逻辑）

- [ ] **Step 4: 实现**

将 `server-auth/services/RemoteLogService.ts` 改为：

```ts
import { getDb } from './AuthDatabase';

const MAX_LOGS_PER_DEVICE = 500;
const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

export interface RemoteLogEntry {
  id: number;
  deviceId: string;
  message: string;
  level: string;
  timestamp: number;
}

class RemoteLogService {
  /** 批量写入日志，并在同一事务内裁剪到每设备最近 500 条 */
  insertLogs(deviceId: string, activationCode: string, logs: Array<{ message: string; level: string; timestamp: number }>): void {
    if (logs.length === 0) return;
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO remote_logs (device_id, activation_code, message, level, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    const trim = db.prepare(`
      DELETE FROM remote_logs
      WHERE device_id = ?
        AND id NOT IN (
          SELECT id FROM remote_logs WHERE device_id = ?
          ORDER BY timestamp DESC LIMIT 500
        )
    `);
    const insertAndTrim = db.transaction((items: typeof logs) => {
      for (const item of items) stmt.run(deviceId, activationCode, item.message, item.level, item.timestamp);
      trim.run(deviceId, deviceId);
    });
    insertAndTrim(logs);
  }

  /** 查询设备最近 N 条日志（按时间倒序） */
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

  /** 清空指定设备的所有历史日志（点击"开始"时电脑端触发） */
  clearDevice(deviceId: string): void {
    const db = getDb();
    db.prepare(`DELETE FROM remote_logs WHERE device_id = ?`).run(deviceId);
  }

  /** 兜底清理：删除 30 天前的日志（覆盖不再上线的陈旧设备） */
  cleanup(): void {
    const db = getDb();
    const cutoff = Date.now() - LOG_RETENTION_MS;
    db.prepare(`DELETE FROM remote_logs WHERE timestamp < ?`).run(cutoff);
  }
}

export const remoteLogService = new RemoteLogService();

// 每小时兜底清理一次；unref() 避免阻塞进程退出（测试进程不会因此挂起）。
// 与旧的"凌晨 3 点 setTimeout"相比：重启最多延迟 1 小时；try/catch 保证异常不会杀死调度。
const sweepTimer = setInterval(() => {
  try {
    remoteLogService.cleanup();
  } catch (e) {
    console.error('[RemoteLogService] 定时清理失败:', e);
  }
}, 60 * 60 * 1000);
sweepTimer.unref();
```

- [ ] **Step 5: 重新构建并运行测试确认通过**

Run: `cd server-auth; npm run build; npm test`
Expected: tsc 退出码 0；全部 backup 测试 PASS（原测试 + 新增 7 个）

---

### Task 2: 版本号与本地一次性清理演练

**Files:**
- Modify: `server-auth/package.json`

- [ ] **Step 1: 升版本号**

`server-auth/package.json` 中 `"version": "1.0.3"` → `"version": "1.0.4"`

- [ ] **Step 2: 本地演练一次性清理 SQL + VACUUM（在备份副本上，不动原文件）**

用项目自带 better-sqlite3 执行（本地 Windows 无 sqlite3 CLI 也能跑）：

```powershell
Copy-Item "D:\SLG\backups\auth-20260802.db" "$env:TEMP\retention-dryrun.db"
@'
const Database = require('D:/SLG/server-auth/node_modules/better-sqlite3');
const db = new Database(process.env.TEMP + '\\retention-dryrun.db');
db.exec(`
  DELETE FROM remote_logs WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY timestamp DESC) AS rn
      FROM remote_logs
    ) WHERE rn <= 500
  )
`);
console.log('rows after trim:', db.prepare('SELECT COUNT(*) n FROM remote_logs').get().n);
db.exec('VACUUM');
db.close();
'@ | node -
Get-Item "$env:TEMP\retention-dryrun.db" | Select-Object Length
Remove-Item "$env:TEMP\retention-dryrun.db" -Force
```

Expected: `rows after trim: 33530`（479,062 → 约 33,530）；文件大小 157,335,552 → 8,708,096 字节（约 8.3MB，已实测复核）

---

### Task 3: 部署到 VPS（需逐条批准）

**Files:**
- 部署：`server-auth/services/RemoteLogService.ts`、`server-auth/package.json`

> 生产以 `npx ts-node --transpile-only index.ts` 运行源码（`start.sh`，已核实），部署目标为源码文件，不是 dist。

- [ ] **Step 1: 部署前再备份一次生产库**

```powershell
ssh root@106.15.11.158 "sqlite3 /root/server-auth/auth.db '.backup /tmp/auth-pre-clean-20260802.db'"
scp root@106.15.11.158:/tmp/auth-pre-clean-20260802.db "D:\SLG\backups\auth-pre-clean-20260802.db"
```

- [ ] **Step 2: 上传源码与版本号**

```powershell
scp "D:\SLG\server-auth\services\RemoteLogService.ts" root@106.15.11.158:/root/server-auth/services/
scp "D:\SLG\server-auth\package.json" root@106.15.11.158:/root/server-auth/
```

- [ ] **Step 3: 停服 → 一次性清理 → VACUUM → 启动**

```powershell
ssh root@106.15.11.158 "pm2 stop slg-auth"
ssh root@106.15.11.158 "sqlite3 /root/server-auth/auth.db \"DELETE FROM remote_logs WHERE id NOT IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY timestamp DESC) AS rn FROM remote_logs) WHERE rn <= 500); VACUUM;\""
ssh root@106.15.11.158 "ls -la /root/server-auth/auth.db"
ssh root@106.15.11.158 "pm2 start slg-auth"
```

Expected: `auth.db` 约 8MB 量级（8,708,096 字节量级）；`pm2 status` online

- [ ] **Step 4: 核对健康与清理临时文件**

```powershell
ssh root@106.15.11.158 "pm2 status; curl -s http://127.0.0.1:3456/health"
ssh root@106.15.11.158 "rm -f /tmp/auth-pre-clean-20260802.db"
```

Expected: `online`；health 接口正常；临时备份已清理

- [ ] **Step 5: 次日观察（可选）**

Run: `ssh root@106.15.11.158 "ls -la /root/server-auth/auth.db"`
Expected: 库大小保持 ~8MB 量级（插入裁剪生效，不再膨胀）

---

## Self-Review（写完后由主代理执行）

1. **Spec coverage**：每设备 500 条同事务裁剪（Task 1）、30 天兜底清理（Task 1）、一次性清理 + VACUUM（Task 2 演练 + Task 3 执行）、类型门禁（Task 1 Step 5）、版本号（Task 2）、部署目标为源码（Task 3）全部覆盖。
2. **Placeholder scan**：所有步骤含具体代码/命令，无 TBD/TODO。
3. **Type consistency**：`MAX_LOGS_PER_DEVICE=500`、`LOG_RETENTION_MS=30天`、`insertLogs`/`cleanup`/`getLogs`/`clearDevice` 签名在各任务间一致；裁剪 SQL 2 个 `?` + 2 个绑定参数全文一致。
