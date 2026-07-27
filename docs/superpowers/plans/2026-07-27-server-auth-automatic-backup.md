# Server Auth SQLite Automatic Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为生产环境 `auth.db` 提供独立于 PM2 的每日加密 OSS 备份、每月恢复验证、钉钉告警和 systemd 调度。

**Architecture:** 在 `server-auth/backup/` 中实现可依赖注入的 ESM 模块，入口仅负责阶段编排；SQLite 使用在线 Backup API，密文采用自描述 AES-256-GCM 格式，OSS 使用 ECS RAM 实例角色临时凭证。systemd oneshot 服务通过共享 `flock` 锁串行执行，14 天保留由 OSS 生命周期完成。

**Tech Stack:** Node.js 20、`better-sqlite3`、`ali-oss`、Node `crypto/fs/test`、systemd timer、SQLite WAL。

## Global Constraints

- 每天北京时间 03:15 创建 SQLite 一致性备份；每月 1 日 04:15 验证最新备份。
- 使用 AES-256-GCM；密钥必须是 Base64 编码的随机 32 字节，每份备份使用新随机 nonce。
- OSS 凭证仅来自 ECS RAM 实例角色，不保存长期 AccessKey；专用私有 Bucket 与 `slg-updates` 隔离。
- 每日对象位于 `daily/`，14 天保留由 Bucket 生命周期实现；程序不拥有或调用删除对象能力。
- 不停止或修改 `slg-auth`，不复制运行中的数据库主文件，不自动覆盖或回滚生产数据库。
- 固定阶段名为 `preflight → snapshot → integrity → encrypt → upload → verify-upload → cleanup`。
- 数据库必须是绝对路径、普通文件且不是符号链接；临时文件必须在 `finally` 中清理。
- 关键表固定为 `activation_codes`、`device_bindings`、`remote_sessions`，完整性检查唯一结果必须为 `ok`。
- 日志为单行 JSON；错误、日志和通知不得泄露密钥、Webhook、Secret、临时凭证、激活码、设备指纹或数据库内容。
- 每日成功不发钉钉；每日失败立即告警；每月成功和失败都发钉钉。
- systemd 使用 `UMask=0077`、`TimeoutStartSec=15min`、`Persistent=true` 和共享锁 `/run/lock/slg-auth-backup.lock`。

---

### Task 1: 测试基础设施、配置校验与脱敏日志

**Files:**
- Modify: `server-auth/package.json`
- Modify: `server-auth/package-lock.json`
- Create: `server-auth/backup/config.mjs`
- Create: `server-auth/backup/log.mjs`
- Test: `server-auth/backup/config.test.mjs`
- Test: `server-auth/backup/log.test.mjs`

**Interfaces:**
- Produces: `loadConfig(env): BackupConfig`，字段为 `dbPath`, `ossRegion`, `ossBucket`, `ossPrefix`, `encryptionKey`, `dingtalkWebhook`, `dingtalkSecret`, `instanceId`。
- Produces: `assertSafeDatabasePath(path)`、`createRedactor(secrets)`、`serializeError(error, redact)`、`writeLog(stream, event, redact)`。

- [ ] **Step 1: 添加测试脚本和依赖**

将脚本设为 `"test": "node --test backup/*.test.mjs"`，运行：

```bash
npm install --prefix server-auth ali-oss
```

- [ ] **Step 2: 编写并运行失败测试**

逐项断言：缺少必填变量、相对 DB 路径、无效 Base64/非 32 字节密钥、非 HTTPS Webhook、空 Bucket/Region、非普通文件和符号链接均拒绝；递归脱敏字符串、Error message/stack 和对象；日志仅写一行合法 JSON。

```bash
npm test --prefix server-auth -- --test-name-pattern="config|redact|log"
```

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 3: 实现最小功能**

必填变量固定为：

```js
const REQUIRED = [
  'BACKUP_DB_PATH', 'BACKUP_OSS_REGION', 'BACKUP_OSS_BUCKET',
  'BACKUP_OSS_PREFIX', 'BACKUP_ENCRYPTION_KEY',
  'DINGTALK_WEBHOOK', 'DINGTALK_SECRET'
];
```

密钥严格解码并验证 32 字节；前缀去除前导 `/` 并补尾随 `/`。`assertSafeDatabasePath` 使用 `lstat` 拒绝符号链接并要求 `isFile()`。日志事件包含 `runId`、`stage`、`status`、ISO 时间，序列化前递归脱敏。

- [ ] **Step 4: 验证并提交**

```bash
npm test --prefix server-auth
npm run build --prefix server-auth
git add server-auth/package.json server-auth/package-lock.json server-auth/backup
git commit -m "feat(backup): add config validation and safe logging"
```

Expected: 测试与构建通过。

### Task 2: SQLite 在线快照与恢复完整性检查

**Files:**
- Create: `server-auth/backup/sqlite.mjs`
- Test: `server-auth/backup/sqlite.test.mjs`

**Interfaces:**
- Consumes: `assertSafeDatabasePath(path)`。
- Produces: `createOnlineSnapshot(sourcePath, destinationPath): Promise<void>`。
- Produces: `verifySnapshot(path, requiredTables = REQUIRED_TABLES): { integrity: 'ok', size: number, tables: string[] }`。
- Produces: `REQUIRED_TABLES = ['activation_codes', 'device_bindings', 'remote_sessions']`。

- [ ] **Step 1: 编写并运行失败测试**

用临时 WAL 数据库创建三张关键表；连接保持打开且 WAL 中有已提交行时执行快照，断言快照包含该行。另测零字节/损坏 SQLite、缺少关键表和 integrity 失败。测试始终关闭句柄并删除临时目录。

```bash
node --test server-auth/backup/sqlite.test.mjs
```

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 2: 实现在线快照与检查**

使用：

```js
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
await source.backup(destinationPath);
```

禁止 `copyFile`。`verifySnapshot` 要求大小大于零，严格要求 `PRAGMA integrity_check` 返回唯一 `ok`；查询 `sqlite_master` 验证关键表，并对每张表执行 `SELECT 1 ... LIMIT 1`。句柄均在 `finally` 中关闭。

- [ ] **Step 3: 验证并提交**

```bash
node --test server-auth/backup/sqlite.test.mjs
git add server-auth/backup/sqlite.mjs server-auth/backup/sqlite.test.mjs
git commit -m "feat(backup): add consistent SQLite snapshots"
```

### Task 3: 自描述 AES-256-GCM 文件格式

**Files:**
- Create: `server-auth/backup/crypto.mjs`
- Test: `server-auth/backup/crypto.test.mjs`

**Interfaces:**
- Produces: `FORMAT_VERSION = 1`、`MAGIC = Buffer.from('SLGBAK01')`。
- Produces: `encryptFile(inputPath, outputPath, key, randomBytesFn = randomBytes)`。
- Produces: `decryptFile(inputPath, outputPath, key)`。
- Layout: `MAGIC(8) | version(1) | nonceLength(1) | tagLength(1) | reserved(1) | nonce(12) | tag(16) | ciphertext`。
- AAD: UTF-8 `SLG-AUTH-BACKUP:v1`。

- [ ] **Step 1: 编写并运行失败测试**

覆盖往返、错误密钥、密文/nonce/tag/version/头篡改、截断、错误魔数、两次加密 nonce 不同，并核对 SHA-256 是完整加密对象哈希。

```bash
node --test server-auth/backup/crypto.test.mjs
```

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 2: 实现格式**

使用 `createCipheriv('aes-256-gcm', key, nonce)`、12 字节随机 nonce、16 字节 tag 和固定 AAD。解密先验证头长度、魔数、版本、nonce/tag 长度，再认证解密；任何失败均删除不完整输出。

- [ ] **Step 3: 验证并提交**

```bash
node --test server-auth/backup/crypto.test.mjs
git add server-auth/backup/crypto.mjs server-auth/backup/crypto.test.mjs
git commit -m "feat(backup): add authenticated backup encryption"
```

### Task 4: ECS RAM OSS 适配器与钉钉通知

**Files:**
- Create: `server-auth/backup/oss.mjs`
- Test: `server-auth/backup/oss.test.mjs`
- Create: `server-auth/backup/dingtalk.mjs`
- Test: `server-auth/backup/dingtalk.test.mjs`

**Interfaces:**
- Produces: `createOssClient(config, Client = OSS)`，配置 `authorizationV4: true` 与 `refreshSTSToken`。
- Produces: `uploadAndVerify(client, objectKey, localPath, metadata)`。
- Produces: `listLatestBackup(client, prefix)`、`downloadAndVerify(client, object, destinationPath, expectedSha256)`。
- Produces: `signDingtalk(timestamp, secret)`、`sendDingtalk({ webhook, secret, text, fetchImpl = fetch, now = Date.now })`。

- [ ] **Step 1: 编写并运行失败测试**

假 OSS client 覆盖上传后 HEAD 的大小和每项 metadata、分页列举后选择最新 `.db.enc`、下载 SHA 不匹配。钉钉用固定 timestamp/secret 验证 HMAC-SHA256 Base64 向量、URL 编码和非 2xx 失败。

```bash
node --test server-auth/backup/oss.test.mjs server-auth/backup/dingtalk.test.mjs
```

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 2: 实现适配器**

IMDSv2 先 `PUT http://100.100.100.200/latest/api/token` 获取 token，再读取 RAM 角色名和临时凭证；短超时并严格校验字段。OSS 仅实现 put/head/list/get，不实现 delete。metadata 键固定为 `format-version`、`sha256`、`snapshot-size`、`created-at`、`run-id`。

钉钉签名原文为 `${timestamp}\n${secret}`，HMAC-SHA256 后 Base64；发送函数只接收已脱敏文本。

- [ ] **Step 3: 验证并提交**

```bash
node --test server-auth/backup/oss.test.mjs server-auth/backup/dingtalk.test.mjs
git add server-auth/package.json server-auth/package-lock.json server-auth/backup/oss* server-auth/backup/dingtalk*
git commit -m "feat(backup): add OSS and DingTalk adapters"
```

### Task 5: 每日备份与每月恢复验证编排

**Files:**
- Create: `server-auth/backup/workflow.mjs`
- Create: `server-auth/backup/backup.mjs`
- Create: `server-auth/backup/verify-restore.mjs`
- Test: `server-auth/backup/workflow.test.mjs`

**Interfaces:**
- Produces: `runBackup(deps, env): Promise<BackupResult>`。
- Produces: `runRestoreVerification(deps, env): Promise<VerifyResult>`。
- Produces: `buildObjectKey(prefix, date)`，格式 `daily/YYYY/MM/auth-YYYYMMDDTHHmmss+0800.db.enc`。

- [ ] **Step 1: 编写并运行失败测试**

依赖注入假实现，断言每日阶段顺序固定；任一阶段失败停止后续业务步骤；上传确认成功才返回成功；每日成功不通知、失败通知；每月选择最新对象、校验 SHA/格式、解密和验证；每月成功/失败均通知。所有路径清理临时文件，清理或通知失败不覆盖主错误，敏感值不出现在日志或通知。

```bash
node --test server-auth/backup/workflow.test.mjs
```

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 2: 实现工作流**

每日用 `mkdtemp` 创建唯一目录，依次执行 preflight、snapshot、integrity、encrypt、upload、verify-upload，并在 `finally` cleanup。对象时间使用 `Asia/Shanghai`，runId 使用 `randomUUID()`，metadata 包含版本、SHA、原始大小、创建时间和 runId。

每月列举最新对象、下载、核对大小/SHA/version、解密、执行同一 `verifySnapshot`，绝不连接生产数据库。成功通知只含验证时间、备份创建时间、basename 对象名、integrity 和耗时。

- [ ] **Step 3: 实现 CLI 入口并验证提交**

入口只装配真实依赖；异常写脱敏 JSON 到 stderr，并设置非零退出码。

```bash
npm test --prefix server-auth
npm run build --prefix server-auth
git add server-auth/backup
git commit -m "feat(backup): orchestrate backup and restore verification"
```

### Task 6: systemd 调度、部署模板与恢复文档

**Files:**
- Create: `deploy/systemd/slg-auth-backup.service`
- Create: `deploy/systemd/slg-auth-backup.timer`
- Create: `deploy/systemd/slg-auth-verify.service`
- Create: `deploy/systemd/slg-auth-verify.timer`
- Create: `deploy/systemd/slg-auth-backup.env.example`
- Create: `docs/server-auth-backup-operations.md`
- Test: `server-auth/backup/systemd.test.mjs`

**Interfaces:**
- Services execute `/usr/bin/flock -n /run/lock/slg-auth-backup.lock /usr/bin/node /root/server-auth/backup/<entry>.mjs`。
- Both load `/etc/slg-auth-backup.env`。

- [ ] **Step 1: 编写并运行 unit 静态测试**

断言每日 `OnCalendar=*-*-* 03:15:00 Asia/Shanghai`、每月 `OnCalendar=*-*-01 04:15:00 Asia/Shanghai`；timer 均有 `Persistent=true` 和随机秒延迟；service 均共享 flock、`UMask=0077`、`TimeoutStartSec=15min`、环境文件、只读应用目录和受限写目录。

```bash
node --test server-auth/backup/systemd.test.mjs
```

Expected: FAIL，因为 unit 尚不存在。

- [ ] **Step 2: 创建 unit 与环境模板**

service 使用 `Type=oneshot`、`User=root`、`NoNewPrivileges=true`、`PrivateTmp=true`、`ProtectSystem=strict`、`ProtectHome=read-only`、`ReadOnlyPaths=/root/server-auth`、`ReadWritePaths=/tmp /run/lock`，同时保留 DNS/TLS/IMDS 网络。模板仅含安全占位符。

- [ ] **Step 3: 编写运维文档**

包含：专用私有 Bucket、`daily/` 14 天生命周期、无 delete/ACL/lifecycle 的最小 RAM 权限、密钥生成与离线保存、env `root:root 0600`、unit 安装启用、首次 15 步验收、journal/timer 命令，以及人工恢复 11 步流程（停服务、保留 db/WAL/SHM、隔离旧 WAL/SHM、同文件系统原子替换、恢复权限、启动和健康/管理/受控激活验证）。

- [ ] **Step 4: 验证并提交**

```bash
node --test server-auth/backup/systemd.test.mjs
npm test --prefix server-auth
git add deploy/systemd docs/server-auth-backup-operations.md server-auth/backup/systemd.test.mjs
git commit -m "ops: schedule and document auth backups"
```

### Task 7: 全量规格验证

**Files:** Verify all files from Tasks 1-6.

- [ ] **Step 1: 自动测试与构建**

```bash
npm test --prefix server-auth
npm run build --prefix server-auth
```

Expected: 全部通过，测试不访问真实 OSS、IMDS 或钉钉。

- [ ] **Step 2: 检查禁止实现与凭证**

```bash
git grep -nE "copyFile|setInterval|delete(Multi)?|AliyunOSSFullAccess|slg-updates" -- server-auth/backup deploy/systemd
git grep -nE "AccessKey(Id|Secret)|BACKUP_ENCRYPTION_KEY=.*[^>]$|DINGTALK_SECRET=.*SEC" -- server-auth/backup deploy/systemd docs/server-auth-backup-operations.md
```

Expected: 除测试中的禁止项断言外无禁止实现；无真实凭证或密钥。

- [ ] **Step 3: 检查分支差异**

```bash
git status --short
git diff --check
```

Expected: 无 whitespace error，仅计划内文件变化。
