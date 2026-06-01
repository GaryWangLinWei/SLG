# Stop Button Fix — 停止按钮修复设计

## 问题

点击停止运行后，模拟器中偶尔仍会出现点击和滑动的操作。

## 根因

`TaskService.ts` 中的 `stopTask` 只接受 `status === 'running'` 的任务。当任务在 `accountBusy` 排队等待时（status = `pending`），`stopTask` 被拒绝，任务之后拿到锁便正常执行。同时 `runTask` 在拿到锁后无条件重置 `stopRequested = false`，导致即使 `stopRequested` 被设置也会被清除。

### 触发场景

1. 帮助盟友正在跑 → `accountBusy` 被锁
2. 喊话任务 `api.tasks.run()` → 排队等锁（pending）
3. 用户点停止 → `handleStop` 调 `api.tasks.stop(id)` 停喊话任务
4. 后端 `status !== 'running'` → 返回"任务未在运行"
5. 帮助跑完释放锁 → 喊话拿到锁 → `stopRequested = false` → 开跑
6. 模拟器里继续点、继续滑

## 修改点

### 1. `TaskService.stopTask()` — 允许停止 pending 任务

**文件：** `server/services/TaskService.ts`

```
当前：if (task.status !== 'running') → 拒绝，返回"任务未在运行"
改为：仅 completed / error / stopped 三种终态拒绝
     pending → 直接设 status='stopped' + endTime
     running → 现有逻辑不变（stopRequested + abort）
```

### 2. `TaskService.runTask()` — 拿锁后检查 + 删 stopRequested 重置

**文件：** `server/services/TaskService.ts`

- 拿到 `accountBusy` 锁后，检查 `task.status === 'stopped'`，是则抛 `Task stopped by user`
- 删除 `task.stopRequested = false`（第 140 行），避免覆盖 `stopTask` 设置的标志

### 3. `Home.tsx` `runTask` 本地函数 — 防御检查

**文件：** `web/src/pages/Home.tsx`

`api.tasks.run()` 返回后，检查 `runResult.task.status === 'stopped'`，是则设 `loopStopped = true` 并提前返回。

## 未改动

- `handleStop` 调用顺序已正确：先设 `loopStopped = true`，再调 `api.tasks.stop`
- `checkStop` / `checkCancellation` 机制不变：每个 tap/sleep 前后检查，最多等当前 sleep 结束
- `AbortController` 不改接：信号从未接入执行链路，本次不改变这一点

## 测试验证

1. 启动帮助盟友（长时间任务），同时创建喊话任务（进入 pending 队列）
2. 在喊话任务 pending 期间点击停止
3. 确认喊话任务状态变为 stopped，不执行任何 tap/swipe
4. 正在 running 的任务停止行为不变
