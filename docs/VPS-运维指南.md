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
scp "D:\SLG\release\latest.yml" "D:\SLG\release\ROK助手 Setup 1.0.1.exe" root@106.15.11.158:/root/server-auth/updates/
```

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
├── data/           # SQLite 数据库
├── node_modules/
├── index.ts        # 入口
└── start.sh        # PM2 启动脚本
```

## 常见问题

**服务挂了？** SSH 上去执行 `pm2 restart slg-auth`。

**端口不通？** 阿里云控制台 → 安全组 → 入方向规则，确认 3456 端口已开放。

**更新不触发？** 确认 `package.json` 的 `version` 比 VPS 上 `latest.yml` 的版本号高。
