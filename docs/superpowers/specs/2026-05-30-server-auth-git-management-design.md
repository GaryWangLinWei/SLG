# Server-Auth VPS Git 版本管理设计

**目标：** 为 VPS 上的 `server-auth/` 服务添加 git 版本管理，支持部署后精确回退到任意历史版本。

**范围：** VPS 端 `/root/server-auth/` 目录内 git 初始化、`/health` 端点增加 version 字段、更新运维指南中的部署/回退流程。

---

## 1. VPS 端 git 初始化

在 `/root/server-auth/` 下执行 `git init`，创建 `.gitignore`：

```gitignore
# 数据库
auth.db
auth.db-shm
auth.db-wal
auth-data/

# 依赖
node_modules/

# 运行时
dist/
```

首次提交：

```bash
cd /root/server-auth
git init
git add -A
git commit -m "初始版本 v1.0.0"
```

**注意：** `.gitignore` 中的路径相对于仓库根目录。如果 `auth-data/` 已移至其他位置，需相应调整。

---

## 2. `/health` 端点返回版本号

修改 `server-auth/index.ts`，在启动时读取 `package.json` 的 `version` 字段：

```typescript
import * as path from 'path';
import * as fs from 'fs';

const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
})();

// /health 响应增加 version
router.get('/health', async (ctx) => {
  ctx.body = {
    status: 'ok',
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    service: 'SLG Auth Server'
  };
});
```

**注意：** `__dirname` 在 tsc 编译后指向 `dist/`，`path.join(__dirname, '..')` 正好回到项目根目录。

---

## 3. 部署流程

在现有 SCP 上传的基础上，增加 git commit 步骤：

```bash
# 1. 本地修改 server-auth 代码，改 package.json 版本号，npm run build
# 2. SCP 上传到 VPS
scp -r dist/ package.json root@106.15.11.158:/root/server-auth/

# 3. SSH 上去，提交并重启
ssh root@106.15.11.158
cd /root/server-auth && git add -A && git commit -m "v1.0.1: 描述改动" && pm2 restart slg-auth
```

## 4. 回退流程

```bash
ssh root@106.15.11.158
cd /root/server-auth
git log --oneline               # 查看历史版本
git reset --hard <commit>       # 回退到指定提交
pm2 restart slg-auth            # 重启生效
```

## 5. 验证方法

```bash
# 部署后确认版本
curl http://106.15.11.158:3456/health
# → {"status":"ok","version":"1.0.1",...}

# VPS 上查看 git 历史
ssh root@106.15.11.158 "cd /root/server-auth && git log --oneline -5"
```

---

## 变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `docs/VPS-运维指南.md` | 修改 | 增加部署/回退步骤中的 git 操作 |
| `server-auth/index.ts` | 修改 | `/health` 端点增加 version 字段 |
| VPS `/root/server-auth/.gitignore` | 新建 | 忽略 db、node_modules、dist |
| VPS `/root/server-auth/` | git init | 初始化仓库，首次 commit |

**不涉及：** 数据库结构、授权逻辑、Docker 配置、前端代码。
