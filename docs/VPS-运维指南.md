# VPS 运维指南

**VPS IP:** `106.15.11.158`
**服务端口:** 3456
**服务器系统:** Ubuntu 22.04，阿里云 ECS

---

## 连接服务器

```powershell
ssh root@106.15.11.158
```

## 服务管理

| 操作 | 命令 |
|------|------|
| 查看状态 | `pm2 status` |
| 查看日志 | `pm2 logs slg-auth` |
| 重启服务 | `pm2 restart slg-auth` |
| 停止服务 | `pm2 stop slg-auth` |
| 手动启动 | `pm2 start slg-auth` |

PM2 已配置 systemd 开机自启，VPS 重启后自动恢复。

## 健康检查

浏览器打开：
```
http://106.15.11.158:3456/health
```
正常返回 `{"status":"ok"}`。

## 发布新版本（server-auth 后端）

### 1. 修改版本号

编辑 `server-auth/package.json`，改 `version` 字段（如 `1.0.0` → `1.0.1`）。

### 2. 构建

```bash
cd server-auth && npm run build
```

### 3. 上传到 VPS

```powershell
scp -r "D:\SLG\server-auth\dist\*" root@106.15.11.158:/root/server-auth/dist/
scp "D:\SLG\server-auth\package.json" root@106.15.11.158:/root/server-auth/
scp "D:\SLG\server-auth\index.ts" root@106.15.11.158:/root/server-auth/
```

### 4. Git 提交版本 + 重启

```bash
ssh root@106.15.11.158 "cd /root/server-auth && git add -A && git commit -m 'v1.0.1: 描述改动' && pm2 restart slg-auth"
```

### 5. 验证

浏览器打开：
```
http://106.15.11.158:3456/health
```
应返回包含新版本号的 JSON。

## VPS 回退

如果部署后出问题，回退到之前的版本：

```bash
ssh root@106.15.11.158
cd /root/server-auth
git log --oneline               # 查看历史版本，找到想回退的 commit
git reset --hard <commit>       # 回退
pm2 restart slg-auth            # 重启生效
```

验证回退成功：
```
http://106.15.11.158:3456/health
```

## 数据库备份

活库路径：`/root/server-auth/auth.db`（含用户激活码、设备绑定、心跳记录、远程验证码、远程日志）。VPS 磁盘挂了就全部丢失，git 里跟踪的 `auth-data/auth.db` 只是空开发库，救不了生产数据。**建议每周一次 + 每次改激活码逻辑或发新版本前手动一次。**

### 拉取备份到本地

在 **本地 PowerShell** 里按顺序跑（Git Bash 也可以，把 `Get-Date -Format yyyyMMdd` 换成 `$(date +%Y%m%d)`）：

```powershell
# ① 建备份目录（第一次跑时才需要）
mkdir D:\SLG\backups -Force

# ② SSH 到 VPS，让 sqlite 做一份原子快照到 /tmp（避免拷贝到半写入状态的文件）
ssh root@106.15.11.158 "sqlite3 /root/server-auth/auth.db '.backup /tmp/auth-backup.db'"

# ③ 拉回本地，文件名带日期
scp root@106.15.11.158:/tmp/auth-backup.db "D:\SLG\backups\auth-$(Get-Date -Format yyyyMMdd).db"

# ④ 清理服务器上的临时快照
ssh root@106.15.11.158 "rm /tmp/auth-backup.db"

# ⑤ 核对本地备份存在且大小合理（生产库约 500KB）
ls D:\SLG\backups\
```

> **备份文件已在 `.gitignore` 的 `backups/` 目录中被忽略，绝对不能提交到 git**（含用户激活码明文和设备指纹）。

### 从备份还原到 VPS

**只在生产库损坏或误删时使用**。还原前先停服，防止有请求继续写入：

```bash
# ① 停服
ssh root@106.15.11.158 "pm2 stop slg-auth"

# ② 把损坏的活库改名保底（万一还原也失败还能翻出来看）
ssh root@106.15.11.158 "mv /root/server-auth/auth.db /root/server-auth/auth.db.broken"

# ③ 从本地上传备份文件（改成你要还原的那份日期）
scp "D:\SLG\backups\auth-20260701.db" root@106.15.11.158:/root/server-auth/auth.db

# ④ 起服
ssh root@106.15.11.158 "pm2 restart slg-auth"

# ⑤ 验证：登录管理面板查看激活码列表是否恢复
# http://106.15.11.158:3456/admin/
```

## Electron 客户端双版本构建与发布

主版与代理商版共用根 `package.json` 中的版本号、应用 ID、安装目录和用户数据。一次构建会生成两套独立产物：

- 主版：`release/main/ROK助手 Setup <version>.exe`
- 代理商版：`release/agent/ROK助手-代理商版 Setup <version>.exe`

两版只通过 OSS 发布，不再向 VPS 上传更新文件，也不再使用 `--oss-only`。主版更新目录为 `/updates`，代理商版为 `/updates/agent`。

### 1. 发布前修改版本信息

编辑项目根目录的 `package.json`：

- 修改 `version`，例如 `1.1.8` → `1.1.9`；
- 修改 `build.releaseInfo.releaseNotes`；
- 确认 `package-lock.json` 根版本同步更新。

构建脚本会在每个版本开始前清理对应的 `release/main|agent` 和临时 `dist`，避免旧模型备份、重复 OCR 文件等历史残留进入安装包。

### 2. 构建两个安装包

在项目根目录 `D:\SLG` 执行：

```bash
npm run electron:build:win
```

该命令依次构建 main 和 agent，任意一版失败都会以非零状态退出。构建完成后应存在：

```text
release/main/latest.yml
release/main/ROK助手 Setup <version>.exe
release/main/ROK助手 Setup <version>.exe.blockmap

release/agent/latest.yml
release/agent/ROK助手-代理商版 Setup <version>.exe
release/agent/ROK助手-代理商版 Setup <version>.exe.blockmap
```

如果在 Claude 隔离 worktree 中执行，产物会生成在该 worktree 的 `release/`；正式打包应在 `D:\SLG` 项目根目录执行，或将上述六个文件复制到 `D:\SLG\release\main|agent`。

### 3. 上传前本地预检

```bash
node scripts/publish-release.mjs --dry-run
```

`--dry-run` 只检查本地文件、版本号、manifest 文件名和六个 OSS 目标路径，不创建 OSS client，也不会访问或修改 OSS。确认输出中的两个版本号相同，并分别指向：

- `https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates`
- `https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates/agent`

### 4. 首次启用代理商渠道

首次发布代理商版时，先准备 OSS 凭据：

```text
OSS_KEY_ID
OSS_KEY_SECRET
```

然后执行：

```bash
npm run electron:build:win
node scripts/publish-release.mjs --dry-run
node scripts/publish-release.mjs --initialize-agent
```

`--initialize-agent` 只创建代理商渠道的基线，不修改主版 manifest。完成后检查：

```text
https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates/agent/latest.yml
```

确认代理商基线存在后，再执行正式双端发布：

```bash
node scripts/publish-release.mjs
```

### 5. 日常双端同步发布

推荐分开构建、预检和上传，便于在写入 OSS 前人工确认：

```bash
npm run electron:build:win
node scripts/publish-release.mjs --dry-run
node scripts/publish-release.mjs
```

也可以使用一键命令（会重新构建后立即上传）：

```bash
npm run electron:publish:win
```

发布器会：

1. 校验两个 `latest.yml` 的版本均等于根 `package.json.version`；
2. 校验 manifest 中的安装包文件名与 edition 配置精确一致；
3. 先上传两版 exe 和 blockmap，并逐个执行 OSS `head` 验证；
4. 最后按 main、agent 顺序切换两份 `latest.yml`；
5. agent manifest 上传失败时，尝试恢复已切换的 main manifest；
6. 回滚失败时同时报告发布错误和回滚错误。

正常双端发布要求 OSS 上已有两份旧 manifest。不要手工删除旧 exe 或 blockmap，否则旧客户端的差量更新可能失败。

### 6. 发布后验证

检查两份 manifest 的 `version` 均为本次版本：

```text
https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates/latest.yml
https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates/agent/latest.yml
```

同时确认 OSS 中存在：

```text
updates/ROK助手 Setup <version>.exe
updates/ROK助手 Setup <version>.exe.blockmap
updates/agent/ROK助手-代理商版 Setup <version>.exe
updates/agent/ROK助手-代理商版 Setup <version>.exe.blockmap
```

客户端验证：

- 主版显示“在线购买”和“续费”，更新日志使用 `/updates`；
- 代理商版隐藏“在线购买”和“续费”，其他授权功能保持不变，更新日志使用 `/updates/agent`；
- 两版互相覆盖安装后，许可证和现有配置仍可使用。

## 文件结构（VPS 上）

```
/root/server-auth/
├── admin/          # 管理面板静态文件
├── updates/        # 更新包（FTP/SCP 上传到这里）
│   ├── latest.yml
│   └── ROK助手 Setup 1.0.0.exe
├── auth.db         # SQLite 活库（生产数据，需定期备份，见"数据库备份"章节）
├── auth-data/      # 遗留空目录（内含空 auth.db，忽略）
├── data/           # 遗留空目录（忽略）
├── node_modules/
├── index.ts        # 入口
└── start.sh        # PM2 启动脚本
```

## 常见问题

**服务挂了？** SSH 上去执行 `pm2 restart slg-auth`。

**端口不通？** 阿里云控制台 → 安全组 → 入方向规则，确认 3456 端口已开放。

**更新不触发？** 确认 `package.json` 的 `version` 比 VPS 上 `latest.yml` 的版本号高。
