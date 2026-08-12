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

## 管理员密钥管理

- 密钥存放：VPS `/root/.slg-auth.env`（内容为 `ADMIN_KEY=<值>`，`chmod 600`，仅 root 可读）
- 加载方式：`start.sh` 通过 `set -a; source /root/.slg-auth.env; set +a` 注入环境变量；**禁止把密钥写进 start.sh 或任何 git 仓库文件**
- 轮换流程：
  1. 生成新密钥（32 字节随机 hex，如 `openssl rand -hex 32`）
  2. 写入 VPS：`ssh root@106.15.11.158 "printf 'ADMIN_KEY=%s\n' '<新密钥>' > /root/.slg-auth.env && chmod 600 /root/.slg-auth.env"`
  3. 重启：`ssh root@106.15.11.158 "pm2 restart slg-auth"`
  4. 验证：旧密钥请求 `/api/admin/stats` 返回 403，新密钥返回 200
- 密钥一旦出现在聊天记录、日志或其他非授权可见处，立即按上述流程轮换

## JWT 密钥管理

- 存放：`/root/.slg-auth.env` 中的 `JWT_SECRET`（当前）与 `JWT_SECRET_LEGACY`（过渡期旧密钥）
- 当前为双密钥过渡态：激活/新 token 用 `JWT_SECRET` 签发；心跳校验先试新密钥、失败再试 `JWT_SECRET_LEGACY`，**存量用户 token 不失效，无需重新激活**
- 轮换流程（零用户影响）：
  1. 生成新密钥：`openssl rand -hex 32`
  2. 把当前 `JWT_SECRET` 的值移到 `JWT_SECRET_LEGACY`，新值写入 `JWT_SECRET`：`ssh root@106.15.11.158 "printf 'JWT_SECRET=%s\nJWT_SECRET_LEGACY=%s\n' '<新值>' '<旧值>' >> /root/.slg-auth.env"`（先核对 .env 现有内容，避免重复追加）
  3. 上传更新后的 `config.ts`、`services/HeartbeatService.ts`（生产跑 ts-node 源码），`pm2 restart slg-auth`
  4. 验证：新激活→心跳 200；用旧密钥签发的 token 心跳 200
- **不要直接替换 JWT_SECRET 单密钥重启**：所有现存 token 立即失效，用户下次心跳 401 会清空本地许可、全部被迫重新激活
- 过渡期结束后（旧 token 全部过期，最长 1 年）可删除 `JWT_SECRET_LEGACY` 并去掉 verify 回退

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

**分发链路**：发布器把产物上传到 OSS 源站（bucket `slg-updates`，`oss-cn-shanghai`），客户端通过阿里云 CDN 域名 `https://updates.slgbot.com` 拉取，CDN 回源到该 OSS bucket。走 CDN 后下行流量单价从直连 OSS 的 0.5 元/G 降到约 0.3 元/G。客户端更新地址配置在：

- `config/editions.json`（main / agent 的 `updateUrl`）
- `package.json` 的 `build.publish.url`
- `electron/main.ts` 的 dev 默认 `updateUrl`

> CDN 缓存：`latest.yml`/`*.blockmap` 缓存 30 天，客户端靠文件名中的版本号 + blockmap 做差量；发版上传新文件后无需刷新 CDN，但**不要手工删除或覆盖旧 exe/blockmap**，否则存量旧客户端差量更新会失败。OSS 直连地址（`slg-updates.oss-cn-shanghai.aliyuncs.com`）必须保持可用：已安装的 1.2.7 及更早版本仍写死直连 OSS，只有 1.2.8 及以后版本走 CDN。
>
> CDN HTTPS 证书为阿里云免费"个人测试证书"，有效期 90 天，到期前需在数字证书管理服务里重新申请并重新"云产品部署"到 CDN（见"CDN 证书续期"）。

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

`--dry-run` 只检查本地文件、版本号、manifest 文件名和六个 OSS 目标路径，不创建 OSS client，也不会访问或修改 OSS。确认输出中的两个版本号相同，并分别指向（即 `config/editions.json` 的 CDN 地址）：

- `https://updates.slgbot.com/updates`
- `https://updates.slgbot.com/updates/agent`

> 注意：`--dry-run` 打印的是客户端拉取地址（CDN），实际上传目标始终是 OSS 源站（`oss-cn-shanghai` / bucket `slg-updates`），由 `scripts/publish-release.mjs` 内部写死，与 CDN 域名无关。

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
https://updates.slgbot.com/updates/agent/latest.yml
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

检查两份 manifest 的 `version` 均为本次版本（走 CDN）：

```text
https://updates.slgbot.com/updates/latest.yml
https://updates.slgbot.com/updates/agent/latest.yml
```

如果刚上传完 CDN 仍返回旧版本，等 1–2 分钟让边缘缓存自然刷新，或在阿里云 CDN 控制台对这两个 `latest.yml` 执行"刷新目录/URL"。

同时确认 OSS 源站（直连，用于核对上传是否到位）和 CDN 下均存在：

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
├── help/           # 帮助页源文件（部署到 /var/www/slgbot-help，由 https://slgbot.com 提供）
├── auth.db         # SQLite 活库（生产数据，需定期备份，见"数据库备份"章节）
├── auth-data/      # 遗留空目录（内含空 auth.db，忽略）
├── data/           # 遗留空目录（忽略）
├── node_modules/
├── index.ts        # 入口
└── start.sh        # PM2 启动脚本
```

Electron 更新包不在本 VPS，存放在阿里云 OSS bucket `slg-updates`（`oss-cn-shanghai`），经 CDN `https://updates.slgbot.com` 分发。

## 常见问题

**服务挂了？** SSH 上去执行 `pm2 restart slg-auth`。

**端口不通？** 阿里云控制台 → 安全组 → 入方向规则，确认 3456 端口已开放。

**更新不触发？** 确认 `package.json` 的 `version` 比 `latest.yml` 的版本号高。

## CDN 证书续期

`updates.slgbot.com` 使用阿里云免费"个人测试证书"，有效期 90 天，不自动续期，到期前需手动更换，否则客户端更新会因 HTTPS 证书失效而失败。

续期步骤：

1. 登录阿里云 → **数字证书管理服务** → 证书管理，重新购买/申请一张免费"个人测试证书"，域名填 `updates.slgbot.com`，验证方式选"自动 DNS 验证"，等待签发（通常几分钟）。
2. 在证书列表点该证书右侧 **「部署」/「云产品部署」**，云产品选 **CDN**，勾选加速域名 `updates.slgbot.com`，提交。
3. 等 1–2 分钟后本地验证（应返回 200，且证书为新的到期日）：

   ```bash
   curl -sI https://updates.slgbot.com/updates/latest.yml
   curl -sI https://updates.slgbot.com/updates/agent/latest.yml
   ```

> 建议在到期日前一周操作。可在证书管理页查看每张证书的到期时间。
