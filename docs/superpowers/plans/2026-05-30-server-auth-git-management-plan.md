# Server-Auth VPS Git 版本管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 VPS 上的 server-auth 服务添加 git 版本管理，/health 端点返回版本号，支持部署后回退。

**Architecture:** 纯配置/运维变更 — 修改 server-auth/index.ts 读取 package.json version 并在 /health 返回；VPS 上 git init + .gitignore；更新运维文档。

**Tech Stack:** TypeScript (server-auth), Git, PM2, SSH/SCP

---

### Task 1: server-auth/index.ts — /health 端点增加 version 字段

**Files:**
- Modify: `server-auth/index.ts:1-62`

- [ ] **Step 1: 修改 index.ts，在顶部加入版本读取逻辑**

在 `import { getDb } from './services/AuthDatabase';` 之后，`const app = new Koa();` 之前，插入：

```typescript
import * as path from 'path';
import * as fs from 'fs';

const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
})();
```

- [ ] **Step 2: 修改 /health 路由，增加 version 字段**

将当前：
```typescript
router.get('/health', async (ctx) => {
  ctx.body = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'SLG Auth Server'
  };
});
```

改为：
```typescript
router.get('/health', async (ctx) => {
  ctx.body = {
    status: 'ok',
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    service: 'SLG Auth Server'
  };
});
```

- [ ] **Step 3: 编译 TypeScript**

```bash
cd D:\SLG\server-auth && npx tsc
```

预期：编译成功，无错误。`dist/index.js` 中能看到 `app_version` 变量被注入。

- [ ] **Step 4: 本地验证 /health 端点**

先启动服务：
```bash
cd D:\SLG\server-auth && node dist/index.js
```

另开终端：
```bash
curl http://localhost:3456/health
```

预期输出包含 `"version":"1.0.0"`：
```json
{"status":"ok","version":"1.0.0","timestamp":"...","service":"SLG Auth Server"}
```

Ctrl+C 停掉服务。

- [ ] **Step 5: 提交代码**

```bash
cd D:\SLG
git add server-auth/index.ts server-auth/dist/
git commit -m "feat: add version field to server-auth /health endpoint"
```

---

### Task 2: VPS — git init + .gitignore + 首次提交

**此任务在 VPS 上操作，通过 SSH 执行。**

- [ ] **Step 1: SSH 到 VPS**

```bash
ssh root@106.15.11.158
```

- [ ] **Step 2: 创建 .gitignore**

```bash
cat > /root/server-auth/.gitignore << 'EOF'
# 数据库
auth.db
auth.db-shm
auth.db-wal
auth-data/

# 依赖
node_modules/

# 运行时
dist/
EOF
```

- [ ] **Step 3: 初始化 git 仓库并首次提交**

```bash
cd /root/server-auth
git init
git add -A
git commit -m "初始版本 v1.0.0"
```

预期输出：`[master (root-commit) ...] 初始版本 v1.0.0`，且 `.gitignore` 生效（auth.db 等不在 staging 中）。

- [ ] **Step 4: 确认 gitignore 生效**

```bash
git status
```

预期输出：`working tree clean`，不包含数据库文件。

- [ ] **Step 5: 退出 VPS**

```bash
exit
```

---

### Task 3: VPS — 部署新版本（含 /health version 变更）

- [ ] **Step 1: 上传编译产物和配置文件到 VPS**

```bash
scp -r D:\SLG\server-auth\dist\* root@106.15.11.158:/root/server-auth/dist/
scp D:\SLG\server-auth\package.json root@106.15.11.158:/root/server-auth/
```

- [ ] **Step 2: SSH 上去，git commit 并重启服务**

```bash
ssh root@106.15.11.158 "cd /root/server-auth && git add -A && git commit -m 'v1.0.1: 增加 /health version 字段' && pm2 restart slg-auth"
```

- [ ] **Step 3: 验证部署成功**

```bash
curl http://106.15.11.158:3456/health
```

预期输出包含 `"version":"1.0.0"`（或 package.json 中当前的版本号）。

```bash
ssh root@106.15.11.158 "cd /root/server-auth && git log --oneline -3"
```

预期输出显示两个 commit：初始版本 + v1.0.1。

---

### Task 4: 更新运维指南

**Files:**
- Modify: `docs/VPS-运维指南.md:48-58`

- [ ] **Step 1: 更新发布新版本流程**

将「发布新版本」章节替换为包含 git 步骤的版本：

当前内容（第 35-58 行区域）替换为：

```markdown
## 发布新版本

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

---

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

## Electron 客户端发布（主项目）

### 1. 修改版本号

编辑 `package.json`（项目根），改 `version` 字段。
```

- [ ] **Step 2: 提交文档更新**

```bash
cd D:\SLG
git add docs/VPS-运维指南.md
git commit -m "docs: add git deploy/rollback steps to VPS ops guide"
```

---

### Task 5: 最终验证

- [ ] **Step 1: 端到端验证 — 确认 VPS 版本号**

```bash
curl http://106.15.11.158:3456/health
```

预期：`version` 字段对应新部署的版本。

- [ ] **Step 2: 确认 git 历史正确**

```bash
ssh root@106.15.11.158 "cd /root/server-auth && git log --oneline -5"
```

预期：清晰的历史记录，每次部署一个 commit。

- [ ] **Step 3: 确认本地 git 状态干净**

```bash
cd D:\SLG && git status
```

预期：所有变更已提交，无未跟踪文件。
