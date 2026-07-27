# server-auth 自动备份 · 运维手册

本文档描述 `server-auth` 的 SQLite 数据库自动加密备份与恢复演练。系统组成：

- **每日备份** — `slg-auth-backup.timer` → `slg-auth-backup.service` → `/root/server-auth/backup/backup.mjs`
  - 每日 Asia/Shanghai 03:15，加密后上传到私有 OSS。
- **每月恢复演练** — `slg-auth-verify.timer` → `slg-auth-verify.service` → `/root/server-auth/backup/verify-restore.mjs`
  - 每月 1 号 Asia/Shanghai 04:15，下载最新备份、校验哈希、解密、`PRAGMA integrity_check`。
- **消息通道** — 失败通知与月度成功通知均通过钉钉自定义机器人（加签）。
- **凭证** — OSS AK/SK 只从 ECS 绑定的 RAM 角色 IMDS 获取，不落盘。加密密钥离线保管。

所有敏感值都不落在仓库或 unit 文件里，只落到 `/etc/slg-auth-backup.env`（`root:root 0600`）。

---

## 1. 一次性 OSS 侧准备

### 1.1 创建专用私有 Bucket

在阿里云 OSS 控制台创建一个**独立**的 Bucket，只用于 server-auth 备份：

- **读写权限**：私有（Private）。
- **区域**：与 VPS 同区域，减少跨区流量。
- **服务端加密**：建议启用 OSS 托管加密（KMS 或 SSE-OSS），叠加在应用层 AES-GCM 之上。
- **版本控制**：可选开启，若开启需为 `daily/` 前缀单独配置生命周期以避免版本堆积。
- **命名建议**：`slg-auth-backup-<region>-<env>`，Bucket 名不可回收，谨慎命名。

**不要**在此 Bucket 中存放任何其他文件。

### 1.2 `daily/` 前缀 14 天生命周期

控制台 → 该 Bucket → 数据管理 → 生命周期 → 创建规则：

- **规则名称**：`daily-14-day-retention`
- **应用范围**：指定前缀 `daily/`（**必须**包含末尾斜杠）
- **文件过期时间**：距最后修改时间 **14 天**后**永久删除**（Object 与所有 delete-marker）
- 不启用版本管理规则中的“NoncurrentVersion”长时保留，避免旧版本累积。

规则生效后，OSS 自身会在 14 天后清除对象；应用侧**不**执行 delete，也无删除权限。

### 1.3 RAM 角色 & 最小权限策略

**为该 ECS 绑定专用 RAM 角色**，例如 `slg-auth-backup-role`。

策略文档（**仅这些 Action**，绝无 delete/ACL/lifecycle）：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:PutObject",
        "oss:GetObject",
        "oss:HeadObject",
        "oss:GetObjectMeta"
      ],
      "Resource": "acs:oss:*:*:<BUCKET_NAME>/daily/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "oss:ListObjects"
      ],
      "Resource": "acs:oss:*:*:<BUCKET_NAME>",
      "Condition": {
        "StringLike": {
          "oss:Prefix": ["daily/", "daily/*"]
        }
      }
    }
  ]
}
```

**明确不允许**：`oss:DeleteObject`、`oss:PutBucketAcl`、`oss:PutBucketLifecycle`、`AliyunOSSFullAccess` 等托管策略。生命周期只能在控制台手工调整，应用不能改。

在 ECS 控制台把该角色绑到目标实例，然后测试：

```bash
curl -s http://100.100.100.200/latest/meta-data/ram/security-credentials/  # 输出角色名
```

---

## 2. 加密密钥生成与保管

备份采用应用层 AES-256-GCM，密钥必须**离线生成、离线保管**。

```bash
# 在受信主机（个人开发机 / 物理机）上生成 32 字节随机数，Base64 编码：
openssl rand -base64 32
```

- 保存到密码管理器或加密的离线存储（YubiKey 备份区 / 加密 U 盘 / 保险箱）。
- **不要**把密钥值提交进 Git、贴到聊天记录、贴到 issue，或写入任何配置管理系统中。
- 若丢失，所有历史备份将无法解密；应立即生成新密钥、更换、并计划新一轮清理。
- 定期（每 6 – 12 个月）轮换密钥：新密钥启用后旧密钥继续离线保存到最后一个用旧密钥加密的备份被 OSS 生命周期删除为止。

---

## 3. VPS 上的 env 文件

在 VPS 上创建 `/etc/slg-auth-backup.env`，从模板复制并填值：

```bash
sudo install -o root -g root -m 0600 /root/server-auth/deploy/systemd/slg-auth-backup.env.example /etc/slg-auth-backup.env
sudo vi /etc/slg-auth-backup.env      # 填入 region/bucket/prefix/密钥/钉钉
sudo chown root:root /etc/slg-auth-backup.env
sudo chmod 0600 /etc/slg-auth-backup.env
ls -l /etc/slg-auth-backup.env         # 必须显示 -rw-------
```

字段说明见模板注释。要点：

- `BACKUP_DB_PATH=/root/server-auth/auth.db`（生产实际路径）。
- `BACKUP_OSS_PREFIX=daily/` — 末尾斜杠必需，且必须与 OSS 生命周期规则一致。
- `BACKUP_ENCRYPTION_KEY` — 步骤 2 生成的 Base64。**不要**通过任何远程终端粘贴到共享剪贴板。
- `DINGTALK_WEBHOOK` — HTTPS URL；`DINGTALK_SECRET` — 钉钉“加签”密钥，**不是**账号密码。
- `BACKUP_OSS_STS_REFRESH_SEC`（可选）— OSS STS token 刷新间隔（秒），60 – 86400；不设置则默认 3600。

**绝不**在 env 中导出 `BACKUP_OSS_ACCESS_KEY_ID` / `BACKUP_OSS_ACCESS_KEY_SECRET`；这些必须由 RAM 角色的 IMDS 提供。

---

## 4. 安装 systemd unit

仓库自带 unit 文件位于 `/root/server-auth/deploy/systemd/`。安装步骤：

```bash
sudo install -o root -g root -m 0644 /root/server-auth/deploy/systemd/slg-auth-backup.service /etc/systemd/system/
sudo install -o root -g root -m 0644 /root/server-auth/deploy/systemd/slg-auth-backup.timer   /etc/systemd/system/
sudo install -o root -g root -m 0644 /root/server-auth/deploy/systemd/slg-auth-verify.service /etc/systemd/system/
sudo install -o root -g root -m 0644 /root/server-auth/deploy/systemd/slg-auth-verify.timer   /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now slg-auth-backup.timer
sudo systemctl enable --now slg-auth-verify.timer

# 验证 timer 已注册
systemctl list-timers 'slg-auth-*'
# 详细状态
systemctl status slg-auth-backup.timer slg-auth-verify.timer
```

两个 timer 均：

- `Persistent=true` — VPS 关机错过的时点会在开机后追跑一次。
- 有 `RandomizedDelaySec` 抖动，避免多台机器同时打到 OSS。
- 依赖 `network-online.target`。

两个 service 均通过 `flock -n /run/lock/slg-auth-backup.lock` 互斥，保证任一时刻只有一个作业在跑，同时不允许排队等待（`-n` 意为“拿不到锁立即退出”）。

---

## 5. 首次验收 15 步清单

在启用前，人工在 VPS 上**手动**跑一次每日备份和一次恢复演练，逐项核对：

1. `sudo systemctl daemon-reload && sudo systemctl restart slg-auth-backup.timer slg-auth-verify.timer`
2. `sudo systemctl list-timers 'slg-auth-*'` — 确认两个 timer 都出现，下一次运行时间为 Asia/Shanghai 03:15 / 每月 1 号 04:15。
3. `sudo systemctl cat slg-auth-backup.service` — 目视检查 EnvironmentFile、ExecStart、ReadOnlyPaths、ReadWritePaths、UMask=0077 与生产上一致。
4. `sudo systemctl cat slg-auth-verify.service` — 同上。
5. `sudo stat -c '%U:%G %a' /etc/slg-auth-backup.env` — 必须输出 `root:root 600`。
6. `sudo -u root -- /usr/bin/flock -n /run/lock/slg-auth-backup.lock /usr/bin/node /root/server-auth/backup/backup.mjs` — 手工同步跑一次每日备份。命令输出的每一条 JSON 行应为 `status=ok`；最后应看到 `stage=cleanup status=ok`（临时目录已清理，见第 8 节）。
7. 登录 OSS 控制台，在 Bucket 的 `daily/<YYYY>/<MM>/` 下找到 `auth-<YYYYMMDD>T<HHMMSS>+0800.db.enc`；对象大小 > 0；`daily/` 前缀的生命周期状态为“已启用”。
8. 该对象的自定义 Meta 中必须包含 `format-version=1`、`sha256=<64hex>`、`snapshot-size=<bytes>`、`created-at=<ISO>`、`run-id=<uuid>`。
9. 钉钉群没有失败告警（成功不发通知）。
10. `sudo -u root -- /usr/bin/flock -n /run/lock/slg-auth-backup.lock /usr/bin/node /root/server-auth/backup/verify-restore.mjs` — 手工同步跑一次恢复演练。
11. 输出应依次出现 `list`、`head`、`download`、`decrypt`、`verify-restore`、`cleanup`、`notify` 全为 `status=ok`。
12. 钉钉群收到 `[SLG-AUTH-BACKUP] monthly VERIFY OK object=auth-...db.enc integrity=ok created-at=... verified-at=... duration=...ms` 单条消息；内容中不含任何完整对象路径、密钥、Signature、AK/SK。
13. `sudo journalctl -u slg-auth-backup.service -u slg-auth-verify.service --since '10 minutes ago' --no-pager` — 逐条检查，无 `[REDACTED]` 之外的敏感字符串。
14. `sudo systemctl start slg-auth-backup.service; sudo systemctl status slg-auth-backup.service` — 由 systemd 触发一次，重复上面 6–8 项检查。
15. **主动断网测试可选**：临时把 IMDS 或钉钉 DNS 阻塞，手工触发一次备份，确认失败通知（若能发出）与日志都不泄露 stsToken、access_token、Authorization 头。

任何一项失败必须先修复，再依赖计划任务。

---

## 6. 查看日志

- 全部：`sudo journalctl -u slg-auth-backup.service -u slg-auth-verify.service --since today`
- 只看最近一次每日：`sudo journalctl -u slg-auth-backup.service -n 200 --no-pager`
- 只看错误行：`sudo journalctl -u slg-auth-backup.service -p err`
- Timer 状态与下一次运行时间：`systemctl list-timers 'slg-auth-*'`
- 上一次运行结果：`systemctl show slg-auth-backup.service --property=Result,ExecMainStatus,InvocationID`

日志格式为一行一条 JSON，字段固定：`runId`、`stage`、`status`、`timestamp`，加业务字段（如 `objectKey`、`size`、`integrity`、`error`）。所有 secret/URL/token 已在应用层做双层脱敏：`createRedactor`（针对已知配置值）+ `sanitizeErrorForLog`（针对错误对象里出现的 `stsToken=`、`Authorization:`、`Signature=` 等按字段名脱敏）。

### 6.1 `cleanup` 事件语义

每次运行**总会**输出 `stage=cleanup` 事件，其含义：

- `status=ok` — 临时目录已删除（正常情况，无论主流程成功还是失败）。这是**预期**的操作运维事件，不代表异常。
- `status=warn` — 主流程已完成（成功或失败），但 `rm -rf` 临时目录时出错。此时日志会附带 `error` 对象。主流程的成功/失败结果不受影响（`warn` 不会覆盖 primary error），但操作员应**检查 `/tmp` 是否残留 `slg-auth-backup-*` / `slg-auth-verify-*` 目录**，必要时手工清理并调查磁盘/权限问题。

因此在监控层，只需要针对 `status=fail`（业务阶段失败）与 `status=warn` 且 `stage!=notify`（noise 情况）做告警；`cleanup status=ok` 是常见良性事件。

---

## 7. 常见故障与排查

| 症状 | 可能原因 | 处理 |
| --- | --- | --- |
| `stage=preflight status=fail`：`Database path must be a symbolic link` | `BACKUP_DB_PATH` 指向了软链 | 改为真实路径或用 `readlink -f` 解析 |
| `stage=snapshot status=fail`：`SQLITE_BUSY` | 有并发写事务 | 减少写压力或延后运行；重跑通常成功 |
| `stage=upload status=fail`：403/AccessDenied | RAM 角色策略缺少 `oss:PutObject` 或 Resource 前缀不匹配 | 核对 2.3 策略与 Bucket 名 |
| `stage=verify-upload status=fail`：size/metadata 不匹配 | 网络中断、OSS 侧异常、密钥不一致导致文件被替换 | 手动 HEAD 对象，比对 meta，必要时删除本次运行遗留（RAM 无 delete，需人工在控制台清理） |
| 每日跑但 timer 状态 `dead` | Persistent=true 状态下 timer 只在下次触发前调度，正常；用 `list-timers` 看下一次 |
| `flock: cannot obtain lock` | 上一次运行仍在跑 | 用 `systemctl status` 定位进程，等它完成或 `kill -TERM` 后清理 `/run/lock/slg-auth-backup.lock`（RW 目录已声明为可写） |

---

## 8. 人工恢复流程（11 步）

**触发场景**：生产 `auth.db` 损坏、被误删、被误改；或需要在紧急场景下用某一天的备份恢复业务。

**核心原则**：

- **停服**再动库文件，避免 SQLite 并发写破坏文件系统的原子重命名。
- **保留现场**：损坏的原 db、WAL、SHM 全部搬到 `/root/server-auth/incident/<timestamp>/`，供后续取证与对比。
- **同一文件系统**内 rename，才能保证 `mv` 是原子操作（不同挂载点会退化为 copy+unlink）。

流程如下（生产 db 假设为 `/root/server-auth/auth.db`）：

1. **停止对外服务** — `sudo pm2 stop slg-auth`（或 `pm2 list` 里对应的进程名）；确认 `pm2 status` 显示 stopped，端口不再监听。**不要** kill -9 SQLite 进程。
2. **保留现场** — 建目录并搬走损坏的 db 与 SQLite 附属文件，不要直接删：
   ```bash
   TS=$(date -u +%Y%m%dT%H%M%SZ)
   sudo mkdir -p /root/server-auth/incident/$TS
   sudo mv /root/server-auth/auth.db          /root/server-auth/incident/$TS/auth.db.corrupt || true
   sudo mv /root/server-auth/auth.db-wal      /root/server-auth/incident/$TS/auth.db-wal.corrupt || true
   sudo mv /root/server-auth/auth.db-shm      /root/server-auth/incident/$TS/auth.db-shm.corrupt || true
   ```
3. **确认目标备份对象** — 登录 OSS 控制台或 `aliyun oss ls`，在 `daily/<YYYY>/<MM>/` 下选定要恢复的 `.db.enc`；记下对象名与 SHA-256 Meta。
4. **准备恢复工作区** — 在同一文件系统（`/root/server-auth` 通常与 `/root` 同挂载）建目录：
   ```bash
   sudo mkdir -p /root/server-auth/restore/$TS
   sudo chown root:root /root/server-auth/restore/$TS
   sudo chmod 0700 /root/server-auth/restore/$TS
   ```
5. **下载 + SHA 校验** — 用 verify-restore 的调试模式或手工 `aliyun oss cp` 到 `restore/$TS/auth.db.enc`，然后 `sha256sum` 与 OSS meta 中 `sha256` 严格相等。**不匹配则终止**并回滚到 incident 现场。
6. **解密** — 用 `BACKUP_ENCRYPTION_KEY` 与 `crypto.mjs::decryptFile` 解密到 `restore/$TS/auth.db.new`。也可以临时把 env 里的 KEY 传给一次性 Node 脚本；解密完成后立即从 shell 历史中清除。
7. **快速校验** — `sqlite3 /root/server-auth/restore/$TS/auth.db.new "PRAGMA integrity_check;"` 必须输出 `ok`；再抽查关键表：
   ```sql
   SELECT COUNT(*) FROM activation_codes;
   SELECT COUNT(*) FROM device_bindings;
   SELECT COUNT(*) FROM remote_sessions;
   ```
   数据规模与业务预期相符。
8. **隔离剩余 WAL/SHM** — 步骤 2 已经搬走，但如果 pm2 stop 之后仍观察到新的 `auth.db-wal`（例如内核缓存刷新）：
   ```bash
   sudo find /root/server-auth -maxdepth 1 -name 'auth.db-wal' -o -name 'auth.db-shm' | \
     xargs -r -I{} sudo mv {} /root/server-auth/incident/$TS/
   ```
   这一步的目的：**新库上线前，禁止任何旧 WAL/SHM 出现**，否则 SQLite 会认为它们与新 db 属于同一事务日志并按旧内容重放，导致再次损坏。
9. **原子替换** — 同文件系统 rename：
   ```bash
   sudo mv -f /root/server-auth/restore/$TS/auth.db.new /root/server-auth/auth.db
   sudo chown root:root /root/server-auth/auth.db
   sudo chmod 0640 /root/server-auth/auth.db     # 与生产原值一致；按需调整
   sudo -u root ls -l /root/server-auth/auth.db*  # 确认只剩 auth.db，无 -wal / -shm
   ```
10. **启动服务并跑健康检查**：
    ```bash
    sudo pm2 start slg-auth
    sleep 2
    curl -fsS http://127.0.0.1:<PORT>/healthz
    curl -fsS http://127.0.0.1:<PORT>/admin/ping   # 需 admin key 的管理端点
    ```
    - `/healthz` 返回 200，DB 连接就绪。
    - 管理端点（携带 admin key）能正常响应。
11. **受控激活验证** — 用一个**测试用**激活码（不消耗真实业务码）走一次完整激活链路：`POST /api/activate` → 检查激活状态 → 检查设备绑定表 → `DELETE`（或调用解绑）→ 状态回到 unused。全部通过后，才把 pm2 恢复到监控栈，公告业务恢复。

事故收尾：`/root/server-auth/incident/$TS/` 保留至少 14 天供审计，之后与生命周期一致清理。

---

## 9. 修改与升级

- **改代码** — 只改 `/root/server-auth/backup/*.mjs` 或 unit 文件不需要重启 PM2；改完 `sudo systemctl daemon-reload` 让新 unit 生效，下一次 timer 触发即使用新逻辑。
- **改 env** — `sudo systemctl restart slg-auth-backup.timer slg-auth-verify.timer` 后下次触发生效；也可 `sudo systemctl start slg-auth-backup.service` 手工触发一次验证。
- **禁用某一路** — `sudo systemctl disable --now slg-auth-verify.timer`（示例：临时禁用月度演练）。**不要**通过删除 unit 文件的方式禁用。
- **卸载** — 反顺序：`disable --now` timer → 删 `/etc/systemd/system/slg-auth-*` → `daemon-reload` → 手工确认 OSS 生命周期仍在管理历史数据。

---

## 附录 A · 快速参考

| 项 | 值 |
| --- | --- |
| 每日备份计划 | Asia/Shanghai `03:15:00`, `Persistent=true`, `RandomizedDelaySec=300` |
| 月度演练计划 | Asia/Shanghai 每月 1 号 `04:15:00`, `Persistent=true`, `RandomizedDelaySec=600` |
| 互斥锁 | `/run/lock/slg-auth-backup.lock`（daily + monthly 共享） |
| ExecStart 前缀 | `/usr/bin/flock -n /run/lock/slg-auth-backup.lock /usr/bin/node …` |
| 服务隔离 | `Type=oneshot`、`User=root`、`UMask=0077`、`NoNewPrivileges=true`、`PrivateTmp=true`、`ProtectSystem=strict`、`ProtectHome=read-only`、`ReadOnlyPaths=/root/server-auth`、`ReadWritePaths=/tmp /run/lock` |
| Env 文件 | `/etc/slg-auth-backup.env`（`root:root 0600`） |
| OSS 前缀 | `daily/`（末尾斜杠，14 天生命周期在此前缀上） |
| 加密算法 | AES-256-GCM（应用层） + 可选 OSS 服务端加密（叠加层） |
| 凭证来源 | ECS RAM 角色 → IMDS；env 中**没有**静态 AK/SK |
