# 用户自助解绑/换机 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已激活用户在旧设备上每 30 天自助解绑一次，解绑后原码保留到期时间在新设备重绑；同时清理远程数据、踢断 WS，并修复管理员删绑定后码变砖问题。

**Architecture:** 云端 server-auth 新增 `POST /api/auth/unbind`（JWT + 指纹鉴权），在 `activation_codes` 加 `last_unbound_at` 作为可重绑闸门与冷却依据；`useCode` 对"used 无绑定"码按该字段决定是否允许重绑。本地 Koa 路由层在解绑成功后 `remoteClient.stop()` + 清 license。前端复用 Pro/基础版徽章弹 popover + 二次确认。

**Tech Stack:** TypeScript、better-sqlite3、Koa/koa-router、jsonwebtoken、ws、React、Jest + ts-jest。

**Spec:** `docs/superpowers/specs/2026-08-13-user-self-unbind-design.md`

**关键约束（来自 spec）：**
- 重绑只允许 `last_unbound_at IS NOT NULL` 的码；续费切绑旧码（NULL）维持砖码。
- 重绑显式 INSERT，新设备已有任何绑定 → 409。
- 解绑后保留原 `expires_at`，不清空 `last_unbound_at`。
- trial 码不可解绑。
- 幂等：码已无绑定 → 200 `alreadyUnbound`；指纹不匹配 → 403。
- `remoteClient.stop()` 放本地**路由层**，不进 core/license。
- 本地路由原样透传云端 status/body；网络错误 502；本地无 license 400。

---

## File Structure

**server-auth（云端）**
- Modify `services/AuthDatabase.ts` — 加列、审计表、唯一索引（try/catch）。
- Modify `services/ActivationCodeService.ts` — `useCode` 重绑分支 + 错误 `code`；新增 `unbindCode`、`markCodeRebindable`；`ActivationCode` 接口加字段。
- Modify `services/HeartbeatService.ts` — `HeartbeatResult` 加 `lastUnboundAt`；`verifyAndHeartbeat` 返回它；`deleteDevice` 改写真实条数 + 写 `last_unbound_at`/审计 + kick。
- Modify `services/WebSocketHub.ts` — 新增 `kick(deviceId)`；device 认证加绑定/状态/过期校验。
- Modify `routes/auth.ts` — 新增 `/unbind`；`/activate` 按 `code` 映射 HTTP 状态；activate/heartbeat 响应带 `lastUnboundAt`。
- Modify `routes/admin.ts` — PATCH 支持 `markRebindable`（仅 used + 无绑定）。
- Create `jest.config.js`、Modify `package.json` — 接入 jest。
- Create `services/unbind.test.ts`，Modify `services/ActivationCodeService.test.ts` — 用例。

**core/license（本地共享）**
- Modify `core/license/types.ts` — 三处加 `lastUnboundAt`。
- Modify `core/license/LicenseService.ts` — 新增 `unbind()`；activate/heartbeat 存取 `lastUnboundAt`；getStatus 透传。

**server（本地 API）**
- Modify `server/routes/license.ts` — 追加 `/unbind`；`/unbind` 与 `/deactivate` 里 `remoteClient.stop()`；错误透传。

**web（前端）**
- Modify `web/src/api/client.ts` — `license.unbind()` + status 类型加 `lastUnboundAt`。
- Modify `web/src/contexts/LicenseContext.tsx` — 暴露 `unbind`、类型加字段。
- Create `web/src/components/UnbindMenu.tsx` — 徽章 popover + 二次确认。
- Modify `web/src/App.tsx` — 用 `<UnbindMenu>` 替换徽章。
- Modify `web/src/pages/Activation.tsx:202` — 文案。

---

## Task 1: server-auth 接入 jest

**Files:**
- Create: `server-auth/jest.config.js`
- Modify: `server-auth/package.json:9`
- Modify: `server-auth/services/ActivationCodeService.test.ts`（从 node:test 改写为 jest）

- [ ] **Step 1: 安装 ts-jest 依赖**

Run:
```bash
cd server-auth && npm install -D jest@29 ts-jest@29 @types/jest@29
```
Expected: 安装成功，package.json devDependencies 出现 jest/ts-jest/@types/jest。

- [ ] **Step 2: 创建 jest.config.js**

Create `server-auth/jest.config.js`:
```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/services', '<rootDir>/routes'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.tsx?$': 'ts-jest' },
};
```

- [ ] **Step 3: 修改 test 脚本**

In `server-auth/package.json` change line 9 to:
```json
    "test": "jest",
```
（保留 backup/*.test.mjs 不纳入 jest；它仍可单独用 node --test 运行，本期不动。）

- [ ] **Step 4: 改写现有测试为 jest 风格**

Replace the contents of `server-auth/services/ActivationCodeService.test.ts` with:
```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-trial-'));
process.env.DB_PATH = path.join(tempDir, 'auth.db');

import { getDb, closeDb } from './AuthDatabase';
import { useCode } from './ActivationCodeService';

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('TRIAL-3DAYS still grants three days of Basic access', () => {
  const before = Date.now();
  const result = useCode('TRIAL-3DAYS', 'new-basic-device');
  const after = Date.now();

  expect(result.success).toBe(true);
  expect(result.tier).toBe('basic');
  expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3 * 86400000);
  expect(result.expiresAt).toBeLessThanOrEqual(after + 3 * 86400000);
});

test('TRIAL-PRO-1DAY grants one day of Pro access only once per device', () => {
  const before = Date.now();
  const first = useCode('TRIAL-PRO-1DAY', 'new-pro-device');
  const after = Date.now();

  expect(first.success).toBe(true);
  expect(first.tier).toBe('pro');
  expect(first.expiresAt).toBeGreaterThanOrEqual(before + 86400000);
  expect(first.expiresAt).toBeLessThanOrEqual(after + 86400000);

  const row = getDb().prepare(`
    SELECT ac.duration_days, ac.type, ac.tier
    FROM activation_codes ac
    JOIN device_bindings db ON db.activation_code_id = ac.id
    WHERE db.device_fingerprint = ?
  `).get('new-pro-device') as { duration_days: number; type: string; tier: string };
  expect(row).toEqual({ duration_days: 1, type: 'trial', tier: 'pro' });

  const again = useCode('TRIAL-PRO-1DAY', 'new-pro-device');
  expect(again.success).toBe(false);
  expect(again.error).toBe('试用码仅限新用户使用');
});
```

- [ ] **Step 5: 运行测试确认通过**

Run:
```bash
cd server-auth && npx jest
```
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add server-auth/jest.config.js server-auth/package.json server-auth/package-lock.json server-auth/services/ActivationCodeService.test.ts
git commit -m "test(auth): add jest+ts-jest for server-auth, convert existing test"
```

---

## Task 2: Schema 迁移

**Files:**
- Modify: `server-auth/services/AuthDatabase.ts`（在现有迁移区，约 73-80 行后追加）

- [ ] **Step 1: 写失败测试（建表幂等）**

Create `server-auth/services/schema.test.ts`:
```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-'));
process.env.DB_PATH = path.join(tempDir, 'auth.db');

import { getDb, closeDb } from './AuthDatabase';

afterAll(() => { closeDb(); fs.rmSync(tempDir, { recursive: true, force: true }); });

test('adds last_unbound_at column and unbind_logs table', () => {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(activation_codes)").all() as { name: string }[];
  expect(cols.some(c => c.name === 'last_unbound_at')).toBe(true);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  expect(tables.some(t => t.name === 'unbind_logs')).toBe(true);
});

test('initTables is idempotent (can re-init without throwing)', () => {
  expect(() => { (getDb() as any).pragma('user_version'); }).not.toThrow();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server-auth && npx jest services/schema.test.ts`
Expected: FAIL（`last_unbound_at` 不存在）。

- [ ] **Step 3: 实现迁移**

在 `server-auth/services/AuthDatabase.ts` 的 `initTables()` 内，紧接 tier 列迁移块（约第 80 行 `} catch { /* 字段已存在 */ }`）之后追加：

```ts
  // 自助换机：记录码最近一次解绑时间（NULL = 从未解绑/续费砖码）
  try {
    database.exec(`ALTER TABLE activation_codes ADD COLUMN last_unbound_at INTEGER`);
  } catch { /* 字段已存在，忽略 */ }

  // 解绑审计表（source: user 用户自助 / admin 管理员操作）
  database.exec(`
    CREATE TABLE IF NOT EXISTS unbind_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activation_code_id INTEGER NOT NULL,
      device_fingerprint TEXT NOT NULL,
      source TEXT NOT NULL,
      ip_address TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (activation_code_id) REFERENCES activation_codes(id)
    )
  `);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_unbind_logs_code ON unbind_logs(activation_code_id)`);

  // 兜底：一个激活码至多一行绑定。套 try/catch，若生产库存在历史重复绑定，
  // 打印明确提示但不让启动崩溃；部署前需先跑查重 SQL 清理。
  try {
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_single_code ON device_bindings(activation_code_id)`);
  } catch (e) {
    console.error('[DB] 无法建立 idx_bindings_single_code：可能存在历史重复绑定，请先执行\n' +
      'SELECT activation_code_id, COUNT(*) FROM device_bindings GROUP BY activation_code_id HAVING COUNT(*)>1;\n' +
      '清理后重启。错误:', (e as Error).message);
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd server-auth && npx jest`
Expected: all passed（含 schema 与试用码用例）。

- [ ] **Step 5: Commit**

```bash
git add server-auth/services/AuthDatabase.ts server-auth/services/schema.test.ts
git commit -m "feat(auth): add last_unbound_at, unbind_logs, single-binding index"
```

---

## Task 3: useCode 重绑分支 + 错误码

**Files:**
- Modify: `server-auth/services/ActivationCodeService.ts`（接口第 4-15 行，返回类型第 100 行，失败分支第 150-186 行）

- [ ] **Step 1: 写失败测试**

Append to `server-auth/services/unbind.test.ts`（本任务先写 useCode 重绑部分，Task 4 继续加 unbindCode）:
```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbind-'));
process.env.DB_PATH = path.join(tempDir, 'auth.db');

import { getDb, closeDb } from './AuthDatabase';
import { useCode, generateCodes } from './ActivationCodeService';

afterAll(() => { closeDb(); fs.rmSync(tempDir, { recursive: true, force: true }); });

function makeUsedCode(fingerprint: string, expiresAt: number): { id: number; code: string } {
  const [c] = generateCodes(1, 30, 'basic');
  const now = Date.now();
  const db = getDb();
  db.prepare("UPDATE activation_codes SET status='used', used_at=?, expires_at=? WHERE id=?")
    .run(now, expiresAt, c.id);
  db.prepare('INSERT INTO device_bindings (activation_code_id, device_fingerprint, bound_at, last_heartbeat_at) VALUES (?,?,?,?)')
    .run(c.id, fingerprint, now, now);
  return { id: c.id, code: c.code };
}

test('rebind allowed after last_unbound_at set, keeps expires_at/tier', () => {
  const future = Date.now() + 10 * 86400000;
  const { id, code } = makeUsedCode('old-device', future);
  // 模拟解绑：删绑定 + 写 last_unbound_at
  getDb().prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id);
  getDb().prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), id);

  const res = useCode(code, 'new-device');
  expect(res.success).toBe(true);
  expect(res.expiresAt).toBe(future); // 剩余时间不补
  const binding = getDb().prepare('SELECT device_fingerprint FROM device_bindings WHERE activation_code_id=?').get(id) as any;
  expect(binding.device_fingerprint).toBe('new-device');
});

test('rebind rejected when last_unbound_at is NULL (renewal brick)', () => {
  const future = Date.now() + 10 * 86400000;
  const { id, code } = makeUsedCode('old-device', future);
  getDb().prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id);
  // 故意不写 last_unbound_at

  const res = useCode(code, 'new-device');
  expect(res.success).toBe(false);
  expect(res.code).toBe('CODE_NOT_REBINDABLE');
});

test('rebind rejected when new device already has another binding', () => {
  const future = Date.now() + 10 * 86400000;
  makeUsedCode('busy-device', future); // 让新设备先占一个绑定
  const { id, code } = makeUsedCode('old-device-2', future);
  getDb().prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id);
  getDb().prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), id);

  const res = useCode(code, 'busy-device');
  expect(res.success).toBe(false);
  expect(res.code).toBe('DEVICE_ALREADY_BOUND');
});

test('rebind rejected when code expired', () => {
  const past = Date.now() - 86400000;
  const { id, code } = makeUsedCode('old-device-3', past);
  getDb().prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id);
  getDb().prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), id);

  const res = useCode(code, 'new-device-3');
  expect(res.success).toBe(false);
  expect(res.code).toBe('CODE_EXPIRED');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server-auth && npx jest services/unbind.test.ts`
Expected: FAIL（重绑走到通用错误，code 为 undefined）。

- [ ] **Step 3: 给 ActivationCode 接口加字段**

In `ActivationCodeService.ts`, extend the interface (around line 4-15):
```ts
export interface ActivationCode {
  id: number;
  code: string;
  duration_days: number;
  status: 'unused' | 'used' | 'revoked' | 'exported';
  type?: 'normal' | 'invite' | 'trial';
  tier?: 'basic' | 'pro';
  created_at: number;
  used_at?: number;
  expires_at?: number;
  created_by: string;
  last_unbound_at?: number;
}
```

- [ ] **Step 4: useCode 返回类型加 code，失败路径补 code**

Change the `useCode` return type at line 100 to include `code?: string`:
```ts
export function useCode(code: string, deviceFingerprint: string): { success: boolean; expiresAt?: number; error?: string; renewType?: string; tier?: 'basic' | 'pro'; code?: string } {
```
Then update these failure returns:
- line 151 (激活码不存在): `return { success: false, code: 'CODE_NOT_FOUND', error: '激活码不存在' };`
- line 155 (邀请码): `return { success: false, code: 'CODE_INVITE', error: '邀请码不能直接激活，请使用购买的激活码' };`
- line 159 (吊销): `return { success: false, code: 'CODE_REVOKED', error: '激活码已被吊销' };`
- line 180 (已绑其他设备):
```ts
        return {
          success: false,
          code: 'CODE_BOUND_OTHER_DEVICE',
          error: '该激活码已绑定到其他设备，一个激活码只能用于一台设备。如需更换设备请联系客服处理。'
        };
```

- [ ] **Step 5: 替换"used 无绑定"分支为重绑闸门**

Replace lines 185-186 (the generic error) with:
```ts
    // status=used 且无绑定：只有 last_unbound_at 非空（用户/管理员解绑过）才允许在新设备重绑。
    // 续费切绑产生的旧码 last_unbound_at 为 NULL，维持砖码，防止绕过一码一机。
    if (activationCode.last_unbound_at == null) {
      return { success: false, code: 'CODE_NOT_REBINDABLE', error: '激活码无效或已失效，请联系客服' };
    }
    if (activationCode.expires_at && activationCode.expires_at <= now) {
      return { success: false, code: 'CODE_EXPIRED', error: '许可证已过期，请续费后再换机' };
    }
    // 新设备必须没有任何绑定，防止把另一台设备的现役码冲成砖码连锁扩散
    const deviceBinding = db.prepare(
      'SELECT 1 FROM device_bindings WHERE device_fingerprint = ?'
    ).get(deviceFingerprint);
    if (deviceBinding) {
      return { success: false, code: 'DEVICE_ALREADY_BOUND', error: '该设备已绑定其他激活码' };
    }
    db.prepare(`
      INSERT INTO device_bindings (activation_code_id, device_fingerprint, bound_at, last_heartbeat_at)
      VALUES (?, ?, ?, ?)
    `).run(activationCode.id, deviceFingerprint, now, now);
    return {
      success: true,
      expiresAt: activationCode.expires_at,
      tier: activationCode.tier || 'basic'
    };
```

Also give trial-branch failures codes for consistency:
- line 112: `return { success: false, code: 'TRIAL_NOT_NEW', error: '试用码仅限新用户使用' };`
- line 121: `return { success: false, code: 'TRIAL_ALREADY_USED', error: '该设备已领取过试用' };`

- [ ] **Step 6: 运行测试**

Run: `cd server-auth && npx jest`
Expected: all passed.

- [ ] **Step 7: Commit**

```bash
git add server-auth/services/ActivationCodeService.ts server-auth/services/unbind.test.ts
git commit -m "feat(auth): rebind branch gated on last_unbound_at with explicit INSERT"
```

---

## Task 4: unbindCode 服务 + /unbind 路由 + 状态映射

**Files:**
- Modify: `server-auth/services/ActivationCodeService.ts`（追加 `unbindCode`）
- Modify: `server-auth/routes/auth.ts`
- Modify: `server-auth/services/HeartbeatService.ts`（heartbeat 返回 lastUnboundAt）
- Test: `server-auth/services/unbind.test.ts`

- [ ] **Step 1: 写失败测试**

Append to `server-auth/services/unbind.test.ts`:
```ts
import { generateToken } from './HeartbeatService';
import { unbindCode } from './ActivationCodeService';

test('unbindCode deletes binding, sets last_unbound_at, writes audit, clears remote_*', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('unbind-dev', future);
  const db = getDb();
  db.prepare('INSERT INTO remote_devices (device_id, password_hash, salt, activation_code, created_at) VALUES (?,?,?,?,?)')
    .run('unbind-dev', 'h', 's', 'unbind-dev', Date.now());

  const token = generateToken(id);
  const res = unbindCode(token, 'unbind-dev', '1.2.3.4');
  expect(res.success).toBe(true);

  const code = db.prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(id) as any;
  expect(code.last_unbound_at).not.toBeNull();
  expect(db.prepare('SELECT COUNT(*) n FROM device_bindings WHERE activation_code_id=?').get(id)).toEqual({ n: 0 });
  expect(db.prepare('SELECT COUNT(*) n FROM remote_devices WHERE device_id=?').get('unbind-dev')).toEqual({ n: 0 });
  const log = db.prepare('SELECT source, ip_address FROM unbind_logs WHERE activation_code_id=?').get(id) as any;
  expect(log.source).toBe('user');
  expect(log.ip_address).toBe('1.2.3.4');
});

test('unbindCode enforces 30-day cooldown', () => {
  const future = Date.now() + 10 * 86400000;
  const { id, code } = makeUsedCode('cd-dev', future);
  const db = getDb();
  const token = generateToken(id);
  unbindCode(token, 'cd-dev');
  // 重新绑定到原设备以模拟"解绑→重绑"
  db.prepare('INSERT INTO device_bindings (activation_code_id, device_fingerprint, bound_at, last_heartbeat_at) VALUES (?,?,?,?)')
    .run(id, 'cd-dev', Date.now(), Date.now());

  const res = unbindCode(token, 'cd-dev');
  expect(res.success).toBe(false);
  expect(res.code).toBe('COOLDOWN_ACTIVE');
  expect(res.retryAfterMs).toBeGreaterThan(29 * 86400000);
  void code;
});

test('unbindCode is idempotent when already unbound', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('idem-dev', future);
  const token = generateToken(id);
  unbindCode(token, 'idem-dev');
  const again = unbindCode(token, 'idem-dev');
  expect(again.success).toBe(true);
  expect(again.alreadyUnbound).toBe(true);
});

test('unbindCode rejects fingerprint mismatch with 403 code', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('real-dev', future);
  const token = generateToken(id);
  const res = unbindCode(token, 'attacker-dev');
  expect(res.success).toBe(false);
  expect(res.code).toBe('FINGERPRINT_MISMATCH');
});

test('unbindCode rejects trial code', () => {
  const now = Date.now();
  const db = getDb();
  const r = db.prepare("INSERT INTO activation_codes (code, duration_days, status, type, tier, created_at, used_at, expires_at) VALUES ('TX1',1,'used','trial','basic',?,?,?)")
    .run(now, now, now + 86400000);
  const id = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO device_bindings (activation_code_id, device_fingerprint, bound_at, last_heartbeat_at) VALUES (?,?,?,?)')
    .run(id, 'trial-dev', now, now);
  const res = unbindCode(generateToken(id), 'trial-dev');
  expect(res.success).toBe(false);
  expect(res.code).toBe('TRIAL_CODE');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server-auth && npx jest services/unbind.test.ts`
Expected: FAIL（`unbindCode is not a function`）。

- [ ] **Step 3: 实现 unbindCode**

At top of `ActivationCodeService.ts` add imports:
```ts
import { verifyTokenWithRotation } from './HeartbeatService';
import { CONFIG } from '../config';
```

Append this function before the closing of the file (before `processInviteCode` or after `useCode`):
```ts
const UNBIND_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export interface UnbindResult {
  success: boolean;
  alreadyUnbound?: boolean;
  lastUnboundAt?: number;
  code?: string;
  error?: string;
  retryAfterMs?: number;
  httpStatus?: number;
}

export function unbindCode(token: string, deviceFingerprint: string, ip?: string): UnbindResult {
  const db = getDb();

  let codeId: number;
  try {
    const decoded = verifyTokenWithRotation(token, CONFIG.JWT_SECRET, CONFIG.JWT_SECRET_LEGACY || undefined) as { codeId: number };
    codeId = decoded.codeId;
  } catch {
    return { success: false, code: 'INVALID_TOKEN', error: '登录状态无效，请重新激活', httpStatus: 401 };
  }

  const code = db.prepare('SELECT * FROM activation_codes WHERE id = ?').get(codeId) as ActivationCode | undefined;
  if (!code) return { success: false, code: 'CODE_NOT_FOUND', error: '激活码不存在', httpStatus: 404 };
  if (code.status !== 'used') return { success: false, code: 'CODE_NOT_USED', error: '激活码未处于使用状态', httpStatus: 409 };
  if (code.type === 'trial') return { success: false, code: 'TRIAL_CODE', error: '试用码不可解绑换机', httpStatus: 409 };
  if (code.expires_at && code.expires_at <= Date.now()) {
    return { success: false, code: 'CODE_EXPIRED', error: '许可证已过期', httpStatus: 409 };
  }

  const binding = db.prepare(
    'SELECT * FROM device_bindings WHERE activation_code_id = ? AND device_fingerprint = ?'
  ).get(codeId, deviceFingerprint) as any;

  if (!binding) {
    // 该码已无绑定：幂等成功；若该码仍绑定着别的指纹则是身份不匹配
    const anyBinding = db.prepare('SELECT 1 FROM device_bindings WHERE activation_code_id = ?').get(codeId);
    if (!anyBinding) {
      return { success: true, alreadyUnbound: true, lastUnboundAt: code.last_unbound_at };
    }
    return { success: false, code: 'FINGERPRINT_MISMATCH', error: '设备与绑定不匹配', httpStatus: 403 };
  }

  // 冷却检查放事务内
  const now = Date.now();
  if (code.last_unbound_at && now - code.last_unbound_at < UNBIND_COOLDOWN_MS) {
    return {
      success: false, code: 'COOLDOWN_ACTIVE', error: '30 天内只能解绑一次', httpStatus: 429,
      retryAfterMs: UNBIND_COOLDOWN_MS - (now - code.last_unbound_at),
    };
  }

  const transaction = db.transaction(() => {
    const del = db.prepare('DELETE FROM device_bindings WHERE activation_code_id = ?').run(codeId);
    if (del.changes === 0) throw new Error('NO_BINDING');
    db.prepare('UPDATE activation_codes SET last_unbound_at = ? WHERE id = ?').run(now, codeId);
    for (const table of ['remote_devices', 'remote_sessions', 'remote_logs', 'remote_codes']) {
      db.prepare(`DELETE FROM ${table} WHERE device_id = ?`).run(deviceFingerprint);
    }
    db.prepare(`
      INSERT INTO unbind_logs (activation_code_id, device_fingerprint, source, ip_address, created_at)
      VALUES (?, ?, 'user', ?, ?)
    `).run(codeId, deviceFingerprint, ip || null, now);
  });

  try {
    transaction();
  } catch (e) {
    return { success: false, code: 'UNBIND_FAILED', error: (e as Error).message, httpStatus: 409 };
  }

  return { success: true, lastUnboundAt: now };
}
```

- [ ] **Step 4: 新增 /unbind 路由并按 code 映射状态**

In `server-auth/routes/auth.ts`:
- Change line 1 import to add `unbindCode`:
```ts
import { useCode, unbindCode, processInviteCode } from '../services/ActivationCodeService';
```
- Add import at top:
```ts
import { webSocketHub } from '../services/WebSocketHub';
```
- Replace the activate failure block (lines 17-21):
```ts
  const result = useCode(code, fingerprint);
  if (!result.success) {
    const STATUS_BY_CODE: Record<string, number> = {
      CODE_NOT_FOUND: 404,
      CODE_REVOKED: 409,
      CODE_BOUND_OTHER_DEVICE: 409,
      CODE_NOT_REBINDABLE: 409,
      DEVICE_ALREADY_BOUND: 409,
      CODE_EXPIRED: 409,
    };
    ctx.status = result.code ? (STATUS_BY_CODE[result.code] ?? 400) : 400;
    ctx.body = result;
    return;
  }
```
- Change line 26 select to include `last_unbound_at`:
```ts
  const codeRow = db.prepare('SELECT id, last_unbound_at FROM activation_codes WHERE code = ?').get(lookupCode) as any;
```
- In the success body (line 48-56), add `lastUnboundAt: codeRow?.last_unbound_at ?? null`:
```ts
  ctx.body = {
    success: true,
    token,
    expiresAt: inviteeBonusDays ? (result.expiresAt || 0) + inviteeBonusDays * 86400000 : result.expiresAt,
    serverNow: Date.now(),
    tier: result.tier || 'basic',
    lastUnboundAt: codeRow?.last_unbound_at ?? null,
    ...(inviteBonus ? { inviteBonus, inviterBonusDays, inviteeBonusDays } : {}),
    ...(inviteError ? { inviteError } : {})
  };
```
- Append the unbind route before `export default router`:
```ts
router.post('/unbind', async (ctx) => {
  const authHeader = ctx.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ctx.status = 401;
    ctx.body = { success: false, code: 'INVALID_TOKEN', error: '未授权' };
    return;
  }
  const token = authHeader.substring(7);
  const { fingerprint } = ctx.request.body as { fingerprint?: string };
  if (!fingerprint) {
    ctx.status = 400;
    ctx.body = { success: false, code: 'BAD_REQUEST', error: '缺少设备指纹' };
    return;
  }

  const result = unbindCode(token, fingerprint, ctx.ip || ctx.request.ip);
  if (result.success) {
    if (!result.alreadyUnbound) {
      // 提交成功后踢断该设备的 device 连接与所有手机端连接
      try { webSocketHub.kick(fingerprint); } catch (e) { console.error('[unbind] kick failed:', e); }
    }
    ctx.body = result;
    return;
  }
  ctx.status = result.httpStatus || 400;
  ctx.body = result;
});
```

- [ ] **Step 5: heartbeat 返回 lastUnboundAt**

In `server-auth/services/HeartbeatService.ts`:
- Add `lastUnboundAt?: number;` to `HeartbeatResult` interface (around line 5-12).
- In success return (line 60) add:
```ts
    return { success: true, valid: true, expiresAt: code.expires_at, serverNow: now, tier: code.tier || 'basic', lastUnboundAt: code.last_unbound_at ?? null };
```
- In `routes/auth.ts` heartbeat success body (line 91) currently returns `result` directly, which now includes `lastUnboundAt` — no extra change needed.

- [ ] **Step 6: 运行所有 server-auth 测试 + 编译**

Run:
```bash
cd server-auth && npx jest && npx tsc --noEmit
```
Expected: all tests pass; tsc 无错误（可能提示 webSocketHub 循环引用，运行时无环即可）。

- [ ] **Step 7: Commit**

```bash
git add server-auth/services/ActivationCodeService.ts server-auth/services/HeartbeatService.ts server-auth/routes/auth.ts server-auth/services/unbind.test.ts
git commit -m "feat(auth): unbind endpoint with cooldown, idempotency, WS kick; activate status mapping"
```

---

## Task 5: WebSocketHub kick + 设备认证加固

**Files:**
- Modify: `server-auth/services/WebSocketHub.ts`

- [ ] **Step 1: 实现 kick 方法**

In `WebSocketHub.ts`, add a public method after `isDeviceOnline` (around line 196):
```ts
  /**
   * 解绑/管理员删除设备后调用：关闭该设备的 device 连接和所有关联手机端连接，
   * 并广播离线。WS close 事件会异步清理 map/set，但这里主动删除+广播保证及时。
   */
  kick(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      try { device.ws.close(1000, 'device unbound'); } catch { /* ignore */ }
      this.devices.delete(deviceId);
      this.broadcastStatusToUsers(deviceId, { online: false, runningTasks: [] });
    }
    for (const u of [...this.users]) {
      if (u.deviceId === deviceId) {
        try { u.ws.close(1000, 'device unbound'); } catch { /* ignore */ }
        this.users.delete(u);
      }
    }
  }
```

- [ ] **Step 2: device 认证加绑定/状态/过期校验**

Replace the `role === 'device'` branch of `authenticate` (lines 120-127) with:
```ts
    if (auth.role === 'device') {
      if (!auth.token) return { success: false, error: '缺少 token' };
      const deviceId = auth.token;
      // 校验该指纹仍是有效绑定（未解绑、码 used、未过期）。
      // 解绑后 kick 掉旧连接；即使本地 stop 失败或旧客户端硬连，也进不来。
      const { getDb } = require('./AuthDatabase') as typeof import('./AuthDatabase');
      const row = getDb().prepare(`
        SELECT ac.status, ac.expires_at
        FROM device_bindings db
        JOIN activation_codes ac ON ac.id = db.activation_code_id
        WHERE db.device_fingerprint = ?
        LIMIT 1
      `).get(deviceId) as { status: string; expires_at: number } | undefined;
      if (!row || row.status !== 'used' || !row.expires_at || row.expires_at <= Date.now()) {
        return { success: false, error: '设备未授权或已解绑' };
      }
      const old = this.devices.get(deviceId);
      if (old) old.ws.close(1000, 'replaced');
      this.devices.set(deviceId, { ws, deviceId, activationCode: auth.token, connectedAt: Date.now(), lastSeen: Date.now() });
      this.broadcastStatusToUsers(deviceId, { online: true, runningTasks: [] });
      return { success: true, deviceId };
    }
```
Note: `require` 在这里用于避免 WebSocketHub → AuthDatabase 顶层循环依赖；AuthDatabase 不反向依赖 WebSocketHub，实际无环，但运行期懒加载最稳妥。

- [ ] **Step 3: 编译**

Run: `cd server-auth && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add server-auth/services/WebSocketHub.ts
git commit -m "feat(ws): kick device on unbind and verify binding/status in device auth"
```

---

## Task 6: 管理员 deleteDevice 改写 + markRebindable

**Files:**
- Modify: `server-auth/services/HeartbeatService.ts`（`deleteDevice`，第 125-133 行）
- Modify: `server-auth/routes/admin.ts`（PATCH，第 92-150 行；DELETE 提示文案）
- Modify: `server-auth/services/ActivationCodeService.ts`（新增 `markCodeRebindable`，可选——直接在路由内写库也可，这里抽函数）

- [ ] **Step 1: 写失败测试**

Append to `server-auth/services/unbind.test.ts`:
```ts
import { deleteDevice } from './HeartbeatService';
import { markCodeRebindable } from './ActivationCodeService';

test('deleteDevice returns real count, writes last_unbound_at and admin audit', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('adm-dev', future);
  const count = deleteDevice('adm-dev');
  expect(count).toBe(1);
  const db = getDb();
  const code = db.prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(id) as any;
  expect(code.last_unbound_at).not.toBeNull();
  const log = db.prepare('SELECT source FROM unbind_logs WHERE activation_code_id=?').get(id) as any;
  expect(log.source).toBe('admin');
});

test('markCodeRebindable succeeds for used code without binding', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('brick-dev', future);
  getDb().prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id); // 历史砖码
  const res = markCodeRebindable(id);
  expect(res.success).toBe(true);
  const code = getDb().prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(id) as any;
  expect(code.last_unbound_at).not.toBeNull();
});

test('markCodeRebindable rejects code that still has a binding', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('bound-dev', future);
  const res = markCodeRebindable(id);
  expect(res.success).toBe(false);
  expect(res.code).toBe('MARKREBIND_STILL_BOUND');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server-auth && npx jest services/unbind.test.ts`
Expected: FAIL（`markCodeRebindable is not a function`；deleteDevice 断言失败）。

- [ ] **Step 3: 实现 markCodeRebindable**

In `ActivationCodeService.ts`, append:
```ts
export function markCodeRebindable(id: number): { success: boolean; code?: string; error?: string } {
  const db = getDb();
  const code = db.prepare('SELECT id, status FROM activation_codes WHERE id = ?').get(id) as ActivationCode | undefined;
  if (!code) return { success: false, code: 'CODE_NOT_FOUND', error: '激活码不存在' };
  if (code.status !== 'used') return { success: false, code: 'CODE_NOT_USED', error: '仅已使用的码可解锁' };
  const stillBound = db.prepare('SELECT 1 FROM device_bindings WHERE activation_code_id = ?').get(id);
  if (stillBound) return { success: false, code: 'MARKREBIND_STILL_BOUND', error: '该码仍有绑定，无需解锁' };

  const now = Date.now();
  const transaction = db.transaction(() => {
    db.prepare('UPDATE activation_codes SET last_unbound_at = ? WHERE id = ?').run(now, id);
    db.prepare(`
      INSERT INTO unbind_logs (activation_code_id, device_fingerprint, source, ip_address, created_at)
      VALUES (?, ?, 'admin', NULL, ?)
    `).run(id, '(admin-mark)', now);
  });
  transaction();
  return { success: true };
}
```

- [ ] **Step 4: 改写 deleteDevice**

In `HeartbeatService.ts`, add import at top:
```ts
import { webSocketHub } from './WebSocketHub';
```
Replace `deleteDevice` (lines 125-133) with:
```ts
export function deleteDevice(fingerprint: string): number {
  const db = getDb();
  // 先收集受影响的码，删除后才能把它们标记为可换机
  const affected = db.prepare(
    'SELECT activation_code_id FROM device_bindings WHERE device_fingerprint = ?'
  ).all(fingerprint) as { activation_code_id: number }[];

  const now = Date.now();
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM device_bindings WHERE device_fingerprint = ?').run(fingerprint);
    db.prepare('DELETE FROM invitations WHERE invitee_fingerprint = ? OR inviter_fingerprint = ?').run(fingerprint, fingerprint);
    for (const row of affected) {
      db.prepare('UPDATE activation_codes SET last_unbound_at = ? WHERE id = ?').run(now, row.activation_code_id);
      db.prepare(`
        INSERT INTO unbind_logs (activation_code_id, device_fingerprint, source, ip_address, created_at)
        VALUES (?, ?, 'admin', NULL, ?)
      `).run(row.activation_code_id, fingerprint, now);
    }
  });
  transaction();

  if (affected.length > 0) {
    try { webSocketHub.kick(fingerprint); } catch (e) { console.error('[deleteDevice] kick failed:', e); }
  }
  return affected.length;
}
```

- [ ] **Step 5: admin PATCH 支持 markRebindable**

In `routes/admin.ts`:
- Change line 3 import to add `markCodeRebindable`:
```ts
import { generateCodes, getAllCodes, revokeCode, getStats, previewCode, exportCodes, getCodesCount, markCodeRebindable } from '../services/ActivationCodeService';
```
- In the PATCH handler, add `markRebindable` to the destructured body (line 100-104):
```ts
  const { tier, setDays, setExpiresAt, markRebindable } = ctx.request.body as {
    tier?: 'basic' | 'pro';
    setDays?: number;
    setExpiresAt?: number;
    markRebindable?: boolean;
  };
```
- After the `if (!code)` 404 block (after line 122), insert:
```ts
  if (markRebindable) {
    const r = markCodeRebindable(id);
    if (!r.success) {
      ctx.status = r.code === 'MARKREBIND_STILL_BOUND' ? 409 : 400;
      ctx.body = { success: false, code: r.code, error: r.error };
      return;
    }
  }
```
Then the existing dynamic UPDATE continues to run for tier/expiry fields. If *only* markRebindable was sent (no tier/setDays/setExpiresAt), `updates` is empty and currently returns 400. Fix by treating markRebindable as sufficient: replace the `if (updates.length === 0)` block (lines 139-143) with:
```ts
  if (updates.length === 0 && !markRebindable) {
    ctx.status = 400;
    ctx.body = { success: false, error: '无修改字段' };
    return;
  }

  if (updates.length > 0) {
    values.push(id);
    db.prepare(`UPDATE activation_codes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT id, code, tier, expires_at, last_unbound_at FROM activation_codes WHERE id = ?').get(id);
  ctx.body = { success: true, code: updated };
```
(Remove the old lines 145-149 that unconditionally ran the update.)

- [ ] **Step 6: 运行测试与编译**

Run: `cd server-auth && npx jest && npx tsc --noEmit`
Expected: pass。

- [ ] **Step 7: Commit**

```bash
git add server-auth/services/HeartbeatService.ts server-auth/services/ActivationCodeService.ts server-auth/routes/admin.ts server-auth/services/unbind.test.ts
git commit -m "feat(admin): deleteDevice writes last_unbound_at/audit+kick; PATCH markRebindable for legacy bricks"
```

---

## Task 7: core/license 类型与 LicenseService.unbind

**Files:**
- Modify: `core/license/types.ts`
- Modify: `core/license/LicenseService.ts`

- [ ] **Step 1: 类型加 lastUnboundAt**

In `core/license/types.ts`:
- Add to `LicenseStatus` (after `tier?`): `lastUnboundAt?: number;`
- Add to `HeartbeatResult`: `lastUnboundAt?: number;`
- Add to `StoredLicenseData`: `lastUnboundAt?: number;`

- [ ] **Step 2: 实现 unbind() 与存取 lastUnboundAt**

In `core/license/LicenseService.ts`:
- In `activate()`, add to the `licenseData` object (around line 141-155): `lastUnboundAt: typeof data.lastUnboundAt === 'number' ? data.lastUnboundAt : undefined,`
- In `heartbeat()` success save block (around line 215-227), add to the saved object: `...(typeof data?.lastUnboundAt === 'number' ? { lastUnboundAt: data.lastUnboundAt } : {}),`
  and add `lastUnboundAt` to the returned object (line 228): `return { success: true, isOffline: false, expiresAt: updatedExpiresAt, serverNow, lastUnboundAt: typeof data?.lastUnboundAt === 'number' ? data.lastUnboundAt : stored.lastUnboundAt };`
- In `getStatus()` success return (around line 69-79), add `lastUnboundAt: stored.lastUnboundAt,`
- Add this method before `deactivate()`:
```ts
  /**
   * 请求云端解绑本机。只负责网络请求并返回结果，不清除本地 license、
   * 不碰 RemoteClient —— 由调用方（本地路由层）在成功/401 后决定清本地与停远程。
   */
  async unbind(): Promise<{
    success: boolean;
    alreadyUnbound?: boolean;
    code?: string;
    error?: string;
    retryAfterMs?: number;
    status?: number;
  }> {
    const stored = await loadLicense();
    if (!stored) {
      return { success: false, code: 'NOT_ACTIVATED', error: '未激活', status: 400 };
    }
    try {
      const response = await fetch(`${AUTH_SERVER_URL}/api/auth/unbind`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${stored.token}`,
        },
        body: JSON.stringify({ fingerprint: stored.fingerprint }),
      });
      let data: any = {};
      try { data = await response.json(); } catch { /* 非 JSON */ }
      if (response.ok) {
        return { success: true, alreadyUnbound: data?.alreadyUnbound };
      }
      return {
        success: false,
        code: data?.code,
        error: data?.error || '解绑失败',
        retryAfterMs: data?.retryAfterMs,
        status: response.status,
      };
    } catch {
      return { success: false, code: 'NETWORK_ERROR', error: '无法连接授权服务器，请检查网络', status: 502 };
    }
  }
```

- [ ] **Step 3: 根项目类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add core/license/types.ts core/license/LicenseService.ts
git commit -m "feat(license): add unbind() and carry lastUnboundAt through activate/heartbeat/status"
```

---

## Task 8: 本地 license 路由（/unbind + stop remote + 错误透传）

**Files:**
- Modify: `server/routes/license.ts`

- [ ] **Step 1: 追加 /unbind 并在 /deactivate 加 remoteClient.stop()**

Replace the contents of `server/routes/license.ts` with:
```ts
import Router from 'koa-router';
import { licenseService } from '../../core/license';
import { remoteClient } from '../../core/remote/RemoteClient';

const router = new Router({ prefix: '/api/license' });

router.get('/status', async (ctx) => {
  const status = await licenseService.getStatus();
  ctx.body = { success: true, status };
});

router.post('/activate', async (ctx) => {
  const body = ctx.request.body as { code?: string; inviteCode?: string };
  if (!body.code) {
    ctx.status = 400;
    ctx.body = { success: false, error: '激活码不能为空' };
    return;
  }

  const result = await licenseService.activate(body.code, body.inviteCode);
  if (result.success) {
    ctx.body = result;
  } else {
    ctx.status = 400;
    ctx.body = result;
  }
});

router.post('/preview', async (ctx) => {
  const body = ctx.request.body as { code?: string };
  if (!body.code) {
    ctx.status = 400;
    ctx.body = { success: false, error: '激活码不能为空' };
    return;
  }
  const result = await licenseService.preview(body.code);
  ctx.body = result;
});

router.post('/deactivate', async (ctx) => {
  // 取消激活同样要停掉远程连接，否则 RemoteClient 会无限重连
  try { remoteClient.stop(); } catch { /* ignore */ }
  await licenseService.deactivate();
  ctx.body = { success: true };
});

router.post('/unbind', async (ctx) => {
  const result = await licenseService.unbind();

  // 成功/幂等成功/401（本地 token 已失效）：停远程、清本地，回激活页
  if (result.success || result.status === 401) {
    try { remoteClient.stop(); } catch { /* ignore */ }
    await licenseService.deactivate();
    ctx.body = { success: true, alreadyUnbound: result.alreadyUnbound };
    return;
  }

  // 其余情况把云端的 status 和 body 原样透传给前端，前端按 code 分支
  ctx.status = result.status || 502;
  ctx.body = {
    success: false,
    code: result.code,
    error: result.error,
    ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}),
  };
});

router.post('/heartbeat', async (ctx) => {
  const result = await licenseService.heartbeat();
  ctx.body = { success: result.success, status: await licenseService.getStatus() };
});

export default router;
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add server/routes/license.ts
git commit -m "feat(server): add /license/unbind with remoteClient.stop and cloud error passthrough"
```

---

## Task 9: 前端 API + Context

**Files:**
- Modify: `web/src/api/client.ts`（license 段，192-209）
- Modify: `web/src/contexts/LicenseContext.tsx`

- [ ] **Step 1: api/client.ts 加 unbind 与 status 字段**

In `web/src/api/client.ts`, replace the `license:` block (lines 192-209) with:
```ts
  license: {
    getStatus: () =>
      request<{ success: boolean; status: { activated: boolean; expiresAt?: number; isExpired: boolean; isOffline: boolean; clockRollback?: boolean; trustedNow?: number; graceRemainingMinutes?: number; deviceFingerprint?: string; tier?: 'basic' | 'pro'; lastUnboundAt?: number } }>('/license/status'),
    activate: (code: string, inviteCode?: string) =>
      request<{ success: boolean; error?: string; expiresAt?: number; tier?: 'basic' | 'pro'; inviteBonus?: boolean; inviteError?: string; inviterBonusDays?: number; inviteeBonusDays?: number }>('/license/activate', {
        method: 'POST',
        body: JSON.stringify({ code, inviteCode })
      }),
    preview: (code: string) =>
      request<{ success: boolean; durationDays?: number; tier?: 'basic' | 'pro'; error?: string }>('/license/preview', {
        method: 'POST',
        body: JSON.stringify({ code })
      }),
    deactivate: () =>
      request<{ success: boolean }>('/license/deactivate', { method: 'POST' }),
    unbind: () =>
      request<{ success: boolean; alreadyUnbound?: boolean }>('/license/unbind', { method: 'POST' }),
    heartbeat: () =>
      request<{ success: boolean; expiresAt?: number }>('/license/heartbeat', { method: 'POST' })
  }
```

- [ ] **Step 2: LicenseContext 暴露 unbind 与 lastUnboundAt 类型**

In `web/src/contexts/LicenseContext.tsx`:
- Add `lastUnboundAt?: number;` to the local `LicenseStatus` interface (after `tier?`).
- Add to `LicenseContextType` (after `deactivate`): `unbind: () => Promise<void>;`
- Add the `unbind` callback (after `deactivate` callback, around line 114):
```ts
  const unbind = useCallback(async () => {
    try {
      setLoading(true);
      // 非 2xx 会抛 ApiError，错误体在 e.data，由 UI 弹窗读取
      await api.license.unbind();
      await refreshStatus();
    } finally {
      setLoading(false);
    }
  }, [refreshStatus]);
```
- Add `unbind` to the Provider value (line 138):
```tsx
    <LicenseContext.Provider value={{ status, loading, error, activateError, expiredMessage, setExpiredMessage, activate, preview, deactivate, unbind, refreshStatus, syncStatus, clearActivateError }}>
```

- [ ] **Step 3: 前端类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add web/src/api/client.ts web/src/contexts/LicenseContext.tsx
git commit -m "feat(web): license.unbind api and context, expose lastUnboundAt"
```

---

## Task 10: UnbindMenu 组件（徽章 popover + 确认弹窗）

**Files:**
- Create: `web/src/components/UnbindMenu.tsx`
- Modify: `web/src/App.tsx`（替换徽章 207-215）

- [ ] **Step 1: 创建 UnbindMenu 组件**

Create `web/src/components/UnbindMenu.tsx`:
```tsx
import { useState, useEffect, useRef } from 'react';
import { useLicense } from '../contexts/LicenseContext';

const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function UnbindMenu({ expiresAt, trustedNow }: { expiresAt: number; trustedNow?: number }) {
  const { status, unbind } = useLicense();
  const tier = status?.tier || 'basic';
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // 点外部关闭 popover
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const now = trustedNow ?? Date.now();
  const lastUnboundAt = status?.lastUnboundAt;
  const cooldownRemaining = lastUnboundAt ? Math.max(0, COOLDOWN_MS - (now - lastUnboundAt)) : 0;
  const cooldownDays = Math.ceil(cooldownRemaining / 86400000);

  const doUnbind = async () => {
    setBusy(true);
    setErr(null);
    try {
      await unbind();
      // 成功后 refreshStatus 会让 LicenseGate 回到激活页；这里不用关弹窗
    } catch (e: any) {
      const data = e?.data || {};
      if (data.code === 'COOLDOWN_ACTIVE' && typeof data.retryAfterMs === 'number') {
        setErr(`还需 ${Math.ceil(data.retryAfterMs / 86400000)} 天才能再次换机`);
      } else {
        setErr(data.error || data.message || e?.message || '无法连接服务器，请检查网络');
      }
    } finally {
      setBusy(false);
    }
  };

  const badgeClass = tier === 'pro'
    ? 'bg-amber-100 text-amber-600'
    : 'bg-emerald-100 text-emerald-500';
  const dotClass = tier === 'pro' ? 'bg-amber-500' : 'bg-emerald-500';
  const label = tier === 'pro' ? 'Pro 版' : '基础版';

  return (
    <div className="relative" ref={ref} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`${badgeClass} px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity`}
        title="授权信息 / 换机"
      >
        <span className={`w-1.5 h-1.5 ${dotClass} rounded-full animate-pulse`} /> {label}
      </button>

      {open && !confirming && (
        <div className="absolute right-0 top-full mt-2 w-60 bg-white rounded-xl shadow-xl border border-slate-200 p-4 z-50">
          <p className="font-semibold text-slate-800">{label}</p>
          <p className="text-xs text-slate-500 mt-1">到期时间：{formatDate(expiresAt)}</p>
          {lastUnboundAt ? (
            <p className="text-xs text-slate-500 mt-1">
              上次换机：{formatDate(lastUnboundAt)}
              {cooldownRemaining > 0 && <span className="text-amber-600">（还剩 {cooldownDays} 天可再次换机）</span>}
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-1">每 30 天可解绑换机一次</p>
          )}
          <button
            onClick={() => { setErr(null); setConfirming(true); }}
            className="mt-3 w-full py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            解绑并换机
          </button>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]" onClick={() => !busy && setConfirming(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-800 mb-3">确认解绑并换机</h2>
            <ul className="text-sm text-slate-600 space-y-1.5 list-disc pl-5 mb-4">
              <li>解绑后本设备立即失去授权，需在新设备重新输入激活码。</li>
              <li>30 天内只能解绑一次，剩余天数不补。</li>
              <li>远程控制连接将全部断开。</li>
            </ul>
            {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
            <div className="flex gap-3">
              <button
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm text-slate-600 disabled:opacity-50"
              >
                取消
              </button>
              <button
                disabled={busy}
                onClick={doUnbind}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium disabled:opacity-50"
              >
                {busy ? '解绑中...' : '确认解绑'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: App.tsx 用 UnbindMenu 替换徽章**

In `web/src/App.tsx`:
- Add import near top:
```tsx
import { UnbindMenu } from './components/UnbindMenu';
```
- Replace the tier badge block (lines 207-215) with:
```tsx
            <UnbindMenu expiresAt={status.expiresAt} trustedNow={status.trustedNow} />
```
The `<RemainingTime ... />` on line 216 stays as-is.

- [ ] **Step 3: 前端类型检查 + 构建**

Run:
```bash
cd web && npx tsc --noEmit
```
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add web/src/components/UnbindMenu.tsx web/src/App.tsx
git commit -m "feat(web): tier badge opens unbind popover with 30-day cooldown confirm"
```

---

## Task 11: 激活页文案

**Files:**
- Modify: `web/src/pages/Activation.tsx:202`

- [ ] **Step 1: 改文案**

Find the line containing "激活后将绑定到当前设备，不可转移"（around line 202）and replace the phrase "不可转移" / the sentence with:
```
激活后绑定当前设备，每 30 天可解绑换机一次
```
Keep surrounding markup/classes intact.

- [ ] **Step 2: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Activation.tsx
git commit -m "copy(activation): reflect 30-day unbind policy"
```

---

## Task 12: 全量验证

- [ ] **Step 1: 服务端测试 + 编译**
```bash
cd server-auth && npx jest && npx tsc --noEmit
```
Expected: all pass，tsc 无错误。

- [ ] **Step 2: 根项目 + web 类型检查**
```bash
npx tsc --noEmit
cd web && npx tsc --noEmit
```
Expected: 均无错误。

- [ ] **Step 3: 手动端到端（需有设备，发布前）**
1. 本地 `npm run server` + `cd web && npm run dev`，用一个测试码激活。
2. 点 Pro/基础版徽章 → popover 出现；点"解绑并换机" → 确认 → 回到激活页。
3. 用原码在另一台设备/另一指纹激活 → 成功，到期时间为原剩余时间。
4. 立即在新设备再次解绑 → 提示"还剩 ~30 天"。
5. 远程控制：解绑后手机端连接被踢、设备显示离线。
6. admin 面板删除一个有绑定的设备 → 该码可在新设备激活；对仍有绑定的码调 `markRebindable` → 返回 409。

---

## Task 13: 部署（需用户明确确认后执行）

server-auth 部署在云端 VPS，本地 auth.db 是空库，不能拿它验证生产数据。部署属于外发/不可逆操作，**必须等用户明确同意后再做**。参考 `docs/VPS-运维指南.md`、记忆中的 VPS 管理密钥与备份部署流程。

- [ ] **Step 1: 生产库查重（部署唯一索引前）**
```sql
SELECT activation_code_id, COUNT(*) FROM device_bindings GROUP BY activation_code_id HAVING COUNT(*)>1;
```
有结果先人工清理。

- [ ] **Step 2: 构建并发布**
```bash
cd server-auth && npm run build
```
按 VPS 流程上传 dist、重启 pm2。

- [ ] **Step 3: 线上验证**
- 启动日志无 `idx_bindings_single_code` ERROR；
- 测试码走一次解绑→重绑；
- 冷却内再解绑返回 429；
- admin"标记可换机"能解锁砖码；
- 远程控制解绑后离线、旧手机连接被 kick 且无法重连。

---

## Self-Review 记录

- Spec 覆盖：schema/last_unbound_at/unbind_logs/唯一索引(Task 2)、重绑闸门+显式 INSERT(Task 3)、unbind+冷却+幂等+remote 清理+kick+审计(Task 4/5)、activate 状态映射+lastUnboundAt(Task 4)、deleteDevice 改写+markRebindable 前置校验+审计 source=admin(Task 6)、core types+unbind+lastUnboundAt 链路(Task 7)、本地路由 stop 在路由层+透传+502/NOT_ACTIVATED/401 清本地(Task 8)、前端 api/context/badge popover/确认弹窗/冷却文案/激活页文案(Task 9-11)、jest 接入与全部用例(Task 1/3/4/6)、部署 Runbook(Task 13)。
- 类型一致性：`unbind()` 返回 `{success, alreadyUnbound?, code?, error?, retryAfterMs?, status?}`；云端 `UnbindResult` 同形；`lastUnboundAt` 在 StoredLicenseData/HeartbeatResult/LicenseStatus(前后端) 四处一致。
- 无占位符；每个代码步骤都给了完整代码或精确替换。
