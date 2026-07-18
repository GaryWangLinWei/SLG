# 按账号一键停止任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个"按 accountId 全停"端点，前端"停止运行"改为调用它，避免 taskId 脱离前端跟踪后无法停止的问题。

**Architecture:** 后端新增一个 REST 端点 `POST /api/tasks/stop-by-account/:accountId`，遍历 TaskService 内部的 tasks Map 停止匹配账号的 running/pending 任务；前端 `api.tasks.stopByAccount()` 封装，`handleStop` 用它替代原来遍历 `runningTaskIdsRef` 的方式；本地清理动作全部保留。

**Tech Stack:** Koa、TypeScript、React、fetch

---

### Task 1: 后端 — 新增 stop-by-account 路由

**Files:**
- Modify: `D:\SLG\server\routes\tasks.ts` (在 line 82 后新增路由)

- [ ] **Step 1: 新增路由**

在 `server/routes/tasks.ts` 中，找到 `router.post('/:id/stop', ...)`（约 line 79-82），在其后紧接着插入：

```typescript
router.post('/stop-by-account/:accountId', async (ctx) => {
  const accountId = ctx.params.accountId;
  const all = taskService.listTasks();
  const targets = all.filter(t => t.accountId === accountId && (t.status === 'running' || t.status === 'pending'));
  const stopped: string[] = [];
  for (const t of targets) {
    const r = taskService.stopTask(t.id);
    if (r.success) stopped.push(t.id);
  }
  ctx.body = { success: true, stopped };
});
```

- [ ] **Step 2: 语法检查**

Run: `cd D:\SLG && npx tsc --noEmit -p tsconfig.json`
Expected: 无 error 输出（或至少 `tasks.ts` 无新增 error）。

- [ ] **Step 3: 手动验证（可选，无生产阻塞）**

启动后端 `npm run server`，在另一终端跑：
```bash
curl -X POST http://localhost:3000/api/tasks/stop-by-account/test-account-id
```
Expected: 返回 `{"success":true,"stopped":[]}`（因为 test-account-id 上没 task）。

- [ ] **Step 4: Commit**

```bash
git add server/routes/tasks.ts
git commit -m "feat(tasks): 新增 POST /tasks/stop-by-account/:accountId 端点"
```

---

### Task 2: 前端 API client — 新增 stopByAccount

**Files:**
- Modify: `D:\SLG\web\src\api\client.ts` (line 146-147 区域)

- [ ] **Step 1: 追加 stopByAccount 方法**

在 `web/src/api/client.ts` 找到 `stop: (id: string) => ...` 那一行（约 line 146-147），把 `stop` 后面的 `}` 前追加一个方法：

```typescript
    stop: (id: string) =>
      request<{ success: boolean; message: string }>(`/tasks/${id}/stop`, { method: 'POST' }),
    stopByAccount: (accountId: string) =>
      request<{ success: boolean; stopped: string[] }>(`/tasks/stop-by-account/${encodeURIComponent(accountId)}`, { method: 'POST' })
  },
```

注意：`stop` 那行末尾的 `}` 之前需要加逗号（原来是最后一个方法所以没逗号，现在不是了）。

- [ ] **Step 2: 类型检查**

Run: `cd D:\SLG\web && npx tsc --noEmit`
Expected: 无 error。

- [ ] **Step 3: Commit**

```bash
git add web/src/api/client.ts
git commit -m "feat(api): 新增 api.tasks.stopByAccount"
```

---

### Task 3: 前端 handleStop — 用 stopByAccount 替换遍历

**Files:**
- Modify: `D:\SLG\web\src\pages\Home.tsx` (约 line 2022-2024)

- [ ] **Step 1: 替换 stop 后端任务的调用**

在 `web/src/pages/Home.tsx` 找到 `handleStop`（约 line 2014），定位到这几行：

```typescript
    if (runningTaskIdsRef.current.length > 0) {
      await Promise.all(runningTaskIdsRef.current.map(id => api.tasks.stop(id).catch(() => {})));
    }
    runningTaskIdsRef.current = [];
```

替换为：

```typescript
    if (currentAccountId) {
      try {
        const r = await api.tasks.stopByAccount(currentAccountId);
        if (r.success && r.stopped.length > 0) pushLog(`⏹️ 后端停止 ${r.stopped.length} 个任务`);
      } catch {}
    }
    runningTaskIdsRef.current = [];
```

保留其他所有本地清理动作不动（`loopStopped=true` / `loopGen+=1` / `loopRunning=false` / `setLoopRunningState(false)` / `clearLoopState()` / clear timers / reset gem 计数 / 远程杀游戏 分支）。

- [ ] **Step 2: 类型检查**

Run: `cd D:\SLG\web && npx tsc --noEmit`
Expected: 无 error。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "fix(home): 停止按钮改为按 accountId 一键停后端所有任务"
```

---

### Task 4: 端到端手动验证

**Files:** 无

- [ ] **Step 1: 启动后端**

新终端：`cd D:\SLG && npm run server`

- [ ] **Step 2: 启动前端**

新终端：`cd D:\SLG\web && npm run dev`

- [ ] **Step 3: 完整流程**

1. 浏览器打开 http://localhost:5173
2. 选一个账号 → 首页点"开始运行"（勾选至少一个功能）
3. 等 5~10 秒让子循环启动、后端至少有 1 个 running task
4. 打开 devtools Network 面板
5. 点"停止运行"

Expected:
- Network 里出现一次 `POST /api/tasks/stop-by-account/<accountId>`，返回 200，body 含 `stopped: [...]`（非空）
- 前端日志出现 `⏹️ 后端停止 N 个任务`
- 前端日志出现 `⏹️ 已停止所有任务`
- UI 变回"开始运行"

- [ ] **Step 4: 故障场景验证（可选）**

模拟"前端 UI 已复位、后端还在跑"：
1. 开始运行
2. 在 devtools console 手动执行 `window.__debugForceReset && window.__debugForceReset()` —— 如果没这个 hook，直接用后端 API `GET /api/tasks` 查一下当前 running task 数量 N
3. 前端点停止运行
4. 再 `GET /api/tasks?status=running`（或 `.filter(t => t.status === 'running')`）

Expected: 该 accountId 下 running/pending 数量为 0。

---

## Self-Review

**Spec 覆盖：**
- 后端新端点（方案 A）→ Task 1 ✅
- 前端 API 封装 → Task 2 ✅
- handleStop 调整（保留本地清理） → Task 3 ✅
- 验证（三条） → Task 4 ✅
- 非目标（不改 UI 状态源、不改 16 处 loopStopped、不改 ref 维护）→ Task 3 明确只改一段，未触及其他 ✅

**Placeholder 扫描：** 无 TBD/TODO。

**类型一致性：** `stopByAccount(accountId)` 签名、返回 `{ success, stopped: string[] }` 在 Task 1（后端 body）、Task 2（前端类型）、Task 3（消费点）三处一致。路由路径 `/tasks/stop-by-account/:accountId` 一致。

无问题。
