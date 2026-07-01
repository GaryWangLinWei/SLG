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

## Electron 客户端发布

### 1. 修改版本号

编辑 `package.json`（项目根），改 `version` 字段。

### 2. 构建

```bash
npm run electron:build:win
```

产物在 `release/` 目录。

### 3. 上传到 VPS

```powershell
scp "D:\SLG\release\latest.yml" "D:\SLG\release\ROK助手 Setup 1.0.2.exe" "D:\SLG\release\ROK助手 Setup 1.0.2.exe.blockmap" root@106.15.11.158:/root/server-auth/updates/
```

> **重要：不要删除 VPS 上旧版本的 .exe 和 .blockmap 文件。** `electron-updater` 会用旧版本的 blockmap 做**差量更新**，只下载差异部分（通常几 MB 而非 169 MB）。如果删了旧文件，每次都得全量下载。

### 4. 验证

浏览器打开：
```
http://106.15.11.158:3456/updates/latest.yml
```

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
