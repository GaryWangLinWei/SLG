# 远程日志保留策略收缩与数据库瘦身 - 设计文档

- 日期：2026-08-02
- 状态：设计已确认，评审意见已合入（待写实施计划）

## 背景

生产库 `server-auth/auth.db` 从 7/1 的 479KB 膨胀到 8/2 的 157MB，几乎全部来自 `remote_logs` 表（479,062 条，日均约 6 万条）。现有保留逻辑（7 天 + 单设备 1 万条，凌晨 3 点 setTimeout 调度）有两个问题：

1. 调度不可靠：`setTimeout` 型每日任务在进程重启时被重置（PM2 累计重启 115 次），8/2 凌晨的清理未执行，库中残留 7,586 条超 7 天日志、单设备最多 32,083 条（远超 1 万上限）。
2. 即使清理正常运行，策略本身过宽：1 万条/设备 × 77 台设备 ≈ 56 万条 ≈ 150-180MB 稳态。

## 目标与成功标准

- 每个设备最多保留最近 500 条远程日志，插入时在**同一事务内**同步裁剪，不依赖定时调度
- 兜底时间维度：删除 30 天前的日志，覆盖"不再上线的陈旧设备"（由每小时 setInterval 清理，替代脆弱的凌晨 3 点 setTimeout）
- 一次性清理存量：479,062 条 → 约 33,530 条，`VACUUM` 后库文件 157MB → 约 8MB（本地演练实测 8,708,096 字节）
- `heartbeat_logs`、激活码、设备绑定等表不动
- 手机远程控制日志回看功能不受影响（每次取最近 200 条 < 500 条上限）

## 设计

### 1. 代码改动（`server-auth/services/RemoteLogService.ts`）

1. `MAX_LOGS_PER_DEVICE` 从 `10000` 改为 `500`；`LOG_RETENTION_MS` 从 7 天改为 30 天
2. `insertLogs`：把裁剪放进 `insertMany` 的**同一个 SQLite 事务**内（批量写入后对同一设备执行裁剪），每条日志只有一次写事务提交。实际调用方 `WebSocketHub.routeMessage` 是每条日志单元素调用 insertLogs，若不合并事务，日均 6 万条会变成 12 万次写事务。

```sql
DELETE FROM remote_logs
WHERE device_id = ?
  AND id NOT IN (
    SELECT id FROM remote_logs WHERE device_id = ?
    ORDER BY timestamp DESC LIMIT 500
  )
```

   注意：SQL 共 2 个 `?` 占位符（两个 device_id），`LIMIT 500` 使用常量，绑定参数必须恰好 2 个。保留"按 timestamp 取最近 500 条"语义——`msg.timestamp` 由客户端携带，id 顺序不保证与时间顺序一致，**不能用 `id <= OFFSET 阈值` 替代**（会改变语义）。

3. 兜底时间清理：`cleanup()` 简化为只按时间删除（`DELETE FROM remote_logs WHERE timestamp < now - 30天`）；调度从"凌晨 3 点 setTimeout"改为**每小时 setInterval + try/catch**（进程重启最多延迟 1 小时，异常不会杀死调度）。该兜底负责清理不再上线的陈旧设备日志；活跃设备由第 2 步插入时裁剪兜住。
4. `getLogs`（limit 200）、`clearDevice`（log_clear）行为不变

### 2. 一次性清理与缩库（部署时在 VPS 执行）

1. 清理前再次执行 `sqlite3 .backup` 备份生产库（双保险，另有今天已拉取的 `auth-20260802.db`）
2. `pm2 stop slg-auth`（VACUUM 需独占，避免写冲突）
3. 用 sqlite3 CLI 执行保留每设备 500 条（VPS sqlite3 3.37.2，支持窗口函数，已确认）：

```sql
DELETE FROM remote_logs WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY timestamp DESC) AS rn
    FROM remote_logs
  ) WHERE rn <= 500
);
VACUUM;
```

4. 核对：`SELECT COUNT(*) FROM remote_logs` ≈ 33,530；`ls -la auth.db` ≈ 8MB 量级（8,708,096 字节量级）
5. `pm2 start slg-auth`，确认健康

### 3. 测试

- 新增 `server-auth/backup/remote-log-retention.test.mjs`（沿用项目 `node --test backup/*.test.mjs` 约定，测试从 `dist/` 引入已编译模块，需先 `npm run build`）：
  - 临时库插入 600 条 → 断言仅剩 500 条（验证 INSERT + 裁剪同一事务生效）
  - 多设备各自独立裁剪（每设备各 600 → 各 500）
  - 边界：0 条不报错；恰好 500 条不删；501 条删 1 条
  - 时间戳乱序（客户端时钟回拨）时仍按 timestamp 保留最近 500 条
- `cd server-auth && npm run build`（tsc）通过
- `npm test` 全绿（原 backup 测试 + 新增测试）
- 版本号 `1.0.3` → `1.0.4`

> **类型门禁**：线上以 `npx ts-node --transpile-only` 运行，不做类型检查；本地 `npm run build`（tsc）是部署前唯一的类型门禁，必须通过，不得因"线上不发 dist"而省略。

### 4. 部署流程

**VPS 以 ts-node 运行源码**：`start.sh` 执行 `npx ts-node --transpile-only index.ts`（已核实 pm2 script path 与 start.sh 内容），部署目标是**源码文件**而非 dist。

1. 本地改完并构建测试通过后，scp `services/RemoteLogService.ts`、`package.json`（版本号）到 VPS `/root/server-auth/` 对应位置
2. VPS 上执行第 2 节清理缩库步骤（含 `pm2 stop` → 清理/VACUUM → `pm2 start`，服务已启动，无需再次重启）
3. 核对服务健康：`pm2 status` 显示 online、`/health` 正常、库大小已缩小

## 错误处理与回滚

- 清理前必须完成备份；若清理后发现问题，用备份恢复 `/root/server-auth/auth.db` 并重启
- 裁剪 SQL 幂等，可重复执行
- 不修改表结构、不迁移数据，风险面小

## 涉及文件

- 修改：`server-auth/services/RemoteLogService.ts`
- 新增：`server-auth/backup/remote-log-retention.test.mjs`
- 修改：`server-auth/package.json`（版本号）
