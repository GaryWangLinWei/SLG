# 用户自助解绑/换机 设计

日期：2026-08-13
分支基线：`master`（实施时切 `feat/self-unbind`）

## 背景与目标

当前激活码绑定设备指纹（`device_bindings.device_fingerprint`，32 位 sha256），一个码绑一台设备。绑定后用户无法自行更换设备；管理员虽然能 `DELETE /api/admin/devices/:fingerprint` 物理删除绑定，但删除后码的 `status` 仍是 `used`，而 `useCode` 在"used 但无绑定"时返回"激活码无效或已失效"，码实际变砖。换机诉求目前只能靠客服手改库。

目标：

- 用户在**已激活的旧设备**上可自助解绑，解绑后原码可在新设备重新激活。
- 每 **30 天**最多解绑一次，防止一码多机转移。
- 解绑后**保留原到期时间**（剩余天数不补）。
- 一并清理该设备的远程控制数据并踢断已连接的远程会话。
- 顺带修复管理员删除绑定后码变砖的问题，并提供存量砖码的管理员解锁路径。

非目标：旧设备损坏/指纹不匹配时的换机（需要邮件/验证码等额外鉴权），本期不做；这类仍走客服。

## 现状关键点

- 绑定标识是硬件指纹哈希（CPU 型号/核数/主机名/用户名，`core/license/DeviceFingerprint.ts`），不是独立 deviceId。
- 续费切绑：`ActivationCodeService.useCode` 首次激活分支用 upsert（`ActivationCodeService.ts:217-228`），以 fingerprint 为键把设备的绑定从旧码改写指向新码，旧码停留在"used + 无绑定"。这是当前防止一码多机的机制，不能破坏。
- 远程控制的 `deviceId` 就是 license 指纹（`electron/main.ts:461`），远程设备/会话/日志均以该指纹为键。
- WebSocketHub 设备端认证只把 `auth.token`（即指纹）当 deviceId 直接登记，不校验绑定（`server-auth/services/WebSocketHub.ts:120-127`）；消息转发只查内存集合（`:174`）。
- RemoteClient 断线后 3 秒无限重连，只有 `stop()` 能停（`core/remote/RemoteClient.ts:132`）。
- `LicenseContext.deactivate()` 已定义但 UI 无按钮调用，且只清本地不通知服务端。
- license 路由前缀 `/api/license` 已在 licenseGuard 白名单（`server/middleware/licenseGuard.ts:7`）。

## 总体方案

新增一个**用户鉴权**的解绑接口 `POST /api/auth/unbind`（云端 server-auth），鉴权复用现有 JWT + 指纹。解绑物理删除 `device_bindings` 行，但通过在 `activation_codes` 上新增 `last_unbound_at` 列来区分"可重绑"与"续费砖码"：**只有 `last_unbound_at IS NOT NULL` 的码才能在新设备重绑**。续费切绑产生的旧码该列为 NULL，维持砖码，冷却机制不被绕过。

## 1/3 服务端安全规则

### Schema 迁移（`server-auth/services/AuthDatabase.ts` 的 `initTables`，沿用 `ALTER TABLE ... ADD COLUMN` try/catch 幂等风格）

```sql
-- 1. activation_codes 增列：最近一次解绑时间，NULL = 从未解绑 / 续费砖码
ALTER TABLE activation_codes ADD COLUMN last_unbound_at INTEGER;

-- 2. 审计表
CREATE TABLE IF NOT EXISTS unbind_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activation_code_id INTEGER NOT NULL,
  device_fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,        -- 'user' | 'admin'
  ip_address TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (activation_code_id) REFERENCES activation_codes(id)
);
CREATE INDEX IF NOT EXISTS idx_unbind_logs_code ON unbind_logs(activation_code_id);
-- 可选：按设备排查时再加 idx_unbind_logs_device，本期不加

-- 3. 单码唯一绑定兜底索引（见下方上线前置检查）
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_single_code ON device_bindings(activation_code_id);
```

唯一索引建在迁移里但**套 try/catch + 打印 ERROR**（"检测到重复绑定，请先清理再生产唯一索引"），避免生产库若有漏检重复绑定时启动直接崩掉鉴权服务。主要防线是部署 Runbook 的前置查重：

```sql
SELECT activation_code_id, COUNT(*) FROM device_bindings GROUP BY activation_code_id HAVING COUNT(*) > 1;
-- 有结果则先人工清理，再建索引
```

### 解绑事务 `unbindCode(token, fingerprint, ip)`（`ActivationCodeService` 新增）

1. `verifyTokenWithRotation(token)` 解析得 `codeId`，无效 → 401 `INVALID_TOKEN`。
2. 查 `activation_codes WHERE id=codeId`；不存在 → 404 `CODE_NOT_FOUND`。
3. 校验：`status='used'`（否则 409 `CODE_NOT_USED`）；`type != 'trial'`（否则 409 `TRIAL_CODE`）；`expires_at > now`（否则 409 `CODE_EXPIRED`）。
4. 查 `device_bindings WHERE activation_code_id=? AND device_fingerprint=?`：
   - 无任何 binding 行 → 幂等返回 `{ success:true, alreadyUnbound:true }`（HTTP 200），**不**重复写审计/kick。覆盖网络超时重试和续费砖码场景。
   - 有 binding 但指纹不匹配 → 403 `FINGERPRINT_MISMATCH`。
5. 事务内（冷却检查也放事务内，防未来改异步引入竞态）：
   - 冷却：若 `last_unbound_at IS NOT NULL` 且 `now - last_unbound_at < 30天` → 429 `COOLDOWN_ACTIVE`，body 带 `retryAfterMs`（= 30天 - 已过时间）。
   - `DELETE FROM device_bindings WHERE activation_code_id=?`，断言 `changes > 0`。
   - `UPDATE activation_codes SET last_unbound_at=? WHERE id=?`（**不**改 status/used_at/expires_at）。
   - 清理远程数据：`DELETE FROM remote_devices WHERE device_id=?`、`remote_sessions`、`remote_logs`、`remote_codes`。
   - 写 `unbind_logs`（`source='user'`）。
6. 事务提交成功后调用 `WebSocketHub.kick(deviceId)`。
7. 返回 `{ success:true, lastUnboundAt: now }`。

### 重绑分支（`useCode` 改造，`ActivationCodeService.ts:162-187`）

当前 `status='used'` 且查不到 binding 时一律报"激活码无效"。改为：

- 进入重绑闸门的条件：`status='used'` + 无 binding + **`last_unbound_at IS NOT NULL`** + `expires_at > now` + `type != 'trial'`。
  - `last_unbound_at IS NULL`（续费砖码/历史砖码）→ 维持现有报错"激活码无效或已失效，请联系客服"（code `CODE_NOT_REBINDABLE`）。
  - `expires_at <= now` → 拒绝并提示续费（code `CODE_EXPIRED`）。
- 绑定方式**显式 INSERT，禁止覆盖**：先 `SELECT 1 FROM device_bindings WHERE device_fingerprint=?`，若新设备已有任何绑定 → 409 `DEVICE_ALREADY_BOUND`（防止把另一台设备的现役码冲成砖码连锁扩散）。无绑定时 INSERT 新行，**沿用原 `expires_at`/`tier`，不加天数、不重置到期时间、不清空 `last_unbound_at`**（使"解绑→重绑→再解绑"连续受冷却约束）。
- 续费累加剩余时间分支（`existingBinding`，`ActivationCodeService.ts:191-208`）保持不变，它要求设备已有绑定且是首次激活新码，与重绑互斥。

**`useCode` 返回值带机器可读 `code`**：所有失败路径返回 `{ success:false, code, error }`，`code` 取值与上表一致（`CODE_NOT_REBINDABLE` / `DEVICE_ALREADY_BOUND` / `CODE_EXPIRED` / 现有"已绑定其他设备"用 `CODE_BOUND_OTHER_DEVICE` 等）。`POST /api/auth/activate` 路由（`server-auth/routes/auth.ts:16-21`）当前对所有失败一律 `ctx.status=400`，改为按 `code` 映射：重绑类冲突（`CODE_NOT_REBINDABLE`/`DEVICE_ALREADY_BOUND`/`CODE_BOUND_OTHER_DEVICE`）和 `CODE_EXPIRED` 返回 **409**，其余参数/校验错误仍返回 400。响应体始终透传 `code`/`message`/`retryAfterMs`。

### WebSocketHub 加固

- 新增 `kick(deviceId)`：关闭该 deviceId 的 device 连接（从 `devices` map 删除）和所有关联 user 连接（从 `users` set 删除），并向剩余连接广播该设备离线状态。
- 设备端认证（`authenticate` 的 `role==='device'` 分支，`WebSocketHub.ts:120-127`）增加绑定校验：JOIN `device_bindings` 与 `activation_codes`，要求该指纹存在绑定行、对应码 `status='used'` 且 `expires_at > now`；不满足则拒绝连接、关闭 ws。这样既保证解绑后/过期后旧客户端硬连进不来，也一并修掉过期码设备仍显示"在线"的现状。kick 才真正闭环。

### 管理员路径同步改

**`deleteDevice`（`HeartbeatService.ts:125`）**：

- 先 `SELECT id FROM device_bindings WHERE device_fingerprint=?` 收集受影响码（必须在 DELETE 之前）。
- 事务内：删 binding（保留现有 invitations 清理）；对每个受影响码 `UPDATE activation_codes SET last_unbound_at=? WHERE id=?`；每个码写一条 `unbind_logs(source='admin')`。
- 返回真实删除的 binding 条数（替换恒返回 1）。
- 事务后对该 fingerprint 调 `WebSocketHub.kick`。

**`PATCH /api/admin/codes/:id`（`admin.ts:92`）** 增加可更新字段 `markRebindable: boolean`：

- 为 `true` 时**前置校验**：码必须 `status='used'` **且当前无 binding 行**才允许设置。
  - 满足时 `UPDATE activation_codes SET last_unbound_at=? WHERE id=?`（写 now），并写一条 `unbind_logs(source='admin')`。
  - 若该码仍有 binding 行 → 拒绝并提示"该码仍有绑定，无需解锁"。原因：写 `last_unbound_at=now` 会让该用户之后自助解绑立即撞上 30 天冷却（误锁）。markRebindable 的用途仅是解砖"used 无绑定"的码。
  - 非 used 码忽略/拒绝。
- 这是**历史砖码的解锁路径**：过去被管理员删绑定、老续费产生的"used 无绑定 + last_unbound_at NULL"的码，管理员可一键标记为可换机。
- admin 面板码列表/编辑处加"标记可换机"按钮，避免手改库。

### 错误契约

所有失败返回 `{ success:false, code, message, retryAfterMs? }`：

| HTTP | code | 端点 | 含义 |
|---|---|---|---|
| 401 | `INVALID_TOKEN` | unbind | 无/无效 JWT |
| 403 | `FINGERPRINT_MISMATCH` | unbind | 有绑定但不是该指纹 |
| 404 | `CODE_NOT_FOUND` | unbind | 码不存在 |
| 409 | `CODE_NOT_USED` / `TRIAL_CODE` / `CODE_EXPIRED` | unbind | 码状态冲突 |
| 409 | `CODE_NOT_REBINDABLE` | activate | 续费砖码/历史砖码不可重绑 |
| 409 | `DEVICE_ALREADY_BOUND` | activate | 新设备已有其他绑定 |
| 409 | `CODE_BOUND_OTHER_DEVICE` | activate | 码已绑定其他设备（未解绑），沿用原报错改 409 |
| 409 | `CODE_EXPIRED` | activate | 解绑期间码已过期 |
| 400 | `MARKREBIND_STILL_BOUND` | admin PATCH | 码仍有绑定，无需解锁 |
| 429 | `COOLDOWN_ACTIVE` | unbind | 冷却中，带 `retryAfterMs` |
| 200 | `ALREADY_UNBOUND`（success:true, alreadyUnbound:true） | unbind | 幂等成功 |

## 2/3 客户端链路

### 本地 server（`server/routes/license.ts` 追加路由，非新增文件）

`remoteClient.stop()` **统一放在路由层**，不放进 `core/license`（避免 core 层耦合 remote 模块；RemoteClient 不依赖 license，不成环，但没必要）。生产模式 Koa 与 RemoteClient 同在 Electron 主进程、dev 同在 server 进程，路由层可直接拿到实例。

- `POST /api/license/unbind`：
  1. 调 `licenseService.unbind()`（只负责请求云端、返回云端结果，不自己清本地、不碰 remote）。
  2. 云端返回成功/alreadyUnbound **或 401** 时：先 `remoteClient.stop()`，再 `licenseService.clearLicense()`（401 表示 token 已失效，本地应清，与 heartbeat 现有处理一致）。
  3. **错误透传**：把云端的 HTTP status 和 body 原样映射给 web 端——`ctx.status = 云端状态码`，`ctx.body = 云端 body`（含 `code`/`message`/`retryAfterMs`）。这样前端 `request()` 在非 2xx 抛 `ApiError`，`e.data.code`/`e.data.retryAfterMs` 才能取到，429/409 分支才有效。不能把云端错误吞成 500 或 200。
- 现有 `POST /api/license/deactivate` 处理器同步：在调 `licenseService.deactivate()` 前/后加 `remoteClient.stop()`（现有"取消激活"同样有残留重连问题）。
- 不改 licenseGuard：`/api/license` 前缀已在白名单。

### LicenseService（`core/license/LicenseService.ts`）

- 新增 `unbind()`：从解密存储读出 JWT 与 fingerprint，POST 云端 `${AUTH_SERVER_URL}/api/auth/unbind`，带 `Authorization: Bearer <token>`、body `{ fingerprint }`。
  - 返回结构化结果（含 `success`/`alreadyUnbound`/`code`/`retryAfterMs`/http status），由路由层决定是否清本地；**本方法不直接 clearLicense、不碰 remote**（职责单一，也便于测试）。
  - 云端 401 作为"token 已失效"结果返回（不抛），让路由层清本地；403/429/409/网络错误抛出或返回错误结构，携带 `code`/`retryAfterMs`，路由层原样透传。
- `deactivate()`/clearLicense 前已 `stopHeartbeatInterval()`（实际 clearLicense 在 `LicenseService.ts:241` 附近），保持现状；remote 停止由路由层负责。
- `heartbeat()` 成功响应把云端新增的 `lastUnboundAt` 存入 `StoredLicenseData`（`LicenseService.ts:210` 附近）。
- `getStatus()` 读出 `lastUnboundAt` 返回；`/api/license/status` 原样透传。

### 类型（`core/license/types.ts`）

`StoredLicenseData`、`LicenseStatus`、`HeartbeatResult` 三处都加可选字段 `lastUnboundAt?: number`。

### 云端响应补字段

- `POST /api/auth/heartbeat` 响应加 `lastUnboundAt`（查 activation_codes 带出）。
- `POST /api/auth/activate` 响应**也**加 `lastUnboundAt` 并在激活时写入本地——否则换机激活后要等下一次每小时心跳才显示"上次换机"，弹窗第一眼是空的。

### 前端

- `web/src/api/client.ts`：加 `license.unbind()`。注意非 2xx 抛 `ApiError`，`code`/`retryAfterMs` 在 `e.data` 里（不是返回类型字段）。
- `web/src/contexts/LicenseContext.tsx`：暴露 `unbind()`，catch 后把 `e.data` 抛给上层；成功后 `refreshStatus()`（LicenseGate 自动渲染激活页）。
- 入口：`web/src/App.tsx:207` 的 Pro/基础版徽章 `<span>` 改为可点击按钮，点击弹 popover（绝对定位徽章下方，点外部关闭），内容：
  - 当前套餐、到期时间（复用 RemainingTime 文案）；
  - 若 `status.lastUnboundAt` 存在，**前端计算剩余冷却**：`30天 - (now - lastUnboundAt)`，剩余 > 0 显示"还剩 X 天可再次换机"；剩余 ≤ 0 只显示"上次换机：YYYY-MM-DD"或不显示。不要写死"30 天内不可再次换机"（超过 30 天后该文案错误）；
  - 红色文字按钮"解绑并换机"。
- 二次确认弹窗（复用 `App.tsx:268` 附近 modal 样式）：文案四句——
  - "解绑后本设备立即失去授权，需在新设备重新输入激活码。"
  - "30 天内只能解绑一次，剩余天数不补。"
  - "远程控制连接将全部断开。"
  - 确认按钮红色、loading 防重复点击。
  - 429 时弹窗内显示"还需 X 天才能再次换机"；网络失败/无 `code` 时兜底显示"无法连接服务器，请检查网络"，不渲染 undefined 天数。
- 激活页文案（`web/src/pages/Activation.tsx:202`）：把"激活后将绑定到当前设备，不可转移"改为"激活后绑定当前设备，每 30 天可解绑换机一次"。

解绑成功后（由本地路由层执行）：`remoteClient.stop()` → `licenseService.clearLicense()` → refreshStatus → LicenseGate 显示激活页，用户在新设备用原码激活走重绑分支。

## 3/3 测试与部署

### 测试入口

server-auth 是独立包，无 jest/ts-jest 依赖；根 jest.config.js 的 roots 不含 server-auth。现有 `server-auth/services/ActivationCodeService.test.ts` 是 node:test + require，在 Node 24 下报 `require is not defined in ES module scope`。

采用方案：给 server-auth 加 `ts-jest` + 独立 `jest.config.js`（preset 与根仓库一致，roots 指 services/routes），把现有测试改写成 jest 的 describe/it/expect。server-auth 内 `backup/*.test.mjs` 仍用 node:test，两套并存可接受。

### 用例清单

服务端：
1. 首次解绑成功：binding 删除、`last_unbound_at` 写入、remote_* 清理、`unbind_logs` 落一条 `source=user`。
2. 冷却期内二次解绑 → 429 `COOLDOWN_ACTIVE` + 正确 `retryAfterMs`。
3. 解绑→新设备重绑成功→**立即再次解绑仍 429**（验证 `last_unbound_at` 未被清空，防换机链条）。
4. 指纹不匹配 → 403；无绑定重复请求 → 200 alreadyUnbound。
5. 解绑后新设备重绑：沿用原 `expires_at`/`tier`、不加天数、INSERT 新 binding。
6. 续费切绑后的旧码（`last_unbound_at IS NULL`）在新设备激活 → 维持砖码报错 `CODE_NOT_REBINDABLE`，不绕过冷却。
7. 新设备已有其他绑定时重绑 → 409 `DEVICE_ALREADY_BOUND`。
8. 解绑期间码过期（`expires_at <= now`）→ 重绑拒绝 `CODE_EXPIRED`；未过期但解绑时已过期 → unbind 409。
9. trial 码解绑 → 409 `TRIAL_CODE`。
10. admin `deleteDevice`：受影响码写入 `last_unbound_at`、`unbind_logs` 落 `source=admin`、返回真实条数、kick 被调用。
11. `markRebindable`：used 且无绑定的码解锁后可在新设备重绑、审计落 `source=admin`；**码仍有绑定时拒绝**（防误锁用户冷却）；非 used 码拒绝。
12. 本地 `/api/license/unbind` 对云端 429/409 返回相同 status + body（含 code/retryAfterMs），前端能读到；云端 401 时本地 stop+clear。
13. 并发重复 INSERT 同一码被 `idx_bindings_single_code` 拦下（可选）。

### 部署

server-auth 部署在云端 VPS（参见 `docs/VPS-运维指南.md`、记忆 [[vps-admin-key]]、[[server-auth-backup-vps-deploy]]）。本地 auth.db 是空库，不能拿它验证生产数据。

1. 部署前在生产库跑查重 SQL（见 Schema 迁移），有重复绑定先人工清理。
2. `cd server-auth && npm run build` 出 dist，按 VPS 流程部署并重启 pm2。
3. 部署后验证：
   - 启动日志无唯一索引 ERROR；
   - 旧设备走一次解绑→新设备重绑（用测试码）；
   - 冷却内再次解绑返回 429；
   - 管理员"标记可换机"能解锁存量砖码；
   - 远程控制解绑后设备显示离线、旧手机连接被 kick 且无法重连。

## 不改动

- 指纹算法、JWT 签发/密钥轮换、心跳间隔、离线宽限。
- 激活码生成、邀请码、续费累加逻辑（仅在 useCode 增加重绑分支）。
- 多账号设备管理、license 本地加密存储结构（仅加 `lastUnboundAt` 字段）。
- 管理员接口鉴权（仍用 `x-admin-key`）。
