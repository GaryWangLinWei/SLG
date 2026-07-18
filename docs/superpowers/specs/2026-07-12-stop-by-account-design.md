# 按账号一键停止任务 设计文档

## 背景

前端 Home 页的"停止运行"当前只会 `stop` `runningTaskIdsRef.current` 里记录的 task id。这个 list 在多处 sub-loop 里以 `filter(id !== createResult.task.id)` 的方式移除已完成/进行中的 taskId，只要有某个子循环让 `loopStopped=true` 提前触发 UI 复位（16 处：许可证过期、runTask 返回 `stopped`、attack 检测等），后端排队/运行中的 task 就会脱离前端跟踪。

结果：
- UI 自己变回"开始运行"（其他子循环仍在跑，taskId 已从 ref 里 filter 掉）
- 再点"停止"→ ref 为空 → `Promise.all([].map(stop))` 什么也没停 → 后端继续跑

## 目标

"停止运行"按钮无条件停掉当前账号在后端上所有 `pending` / `running` 的 task —— 不依赖前端跟踪的 taskId list。

## 方案

**A. 后端新增端点** `POST /api/tasks/stop-by-account/:accountId`

- 遍历 `taskService.listTasks()`，筛出 `task.accountId === accountId && (status === 'running' || status === 'pending')`
- 对每个匹配 task 调用 `taskService.stopTask(id)`
- 返回 `{ success: true, stopped: [id...] }`

一次请求内完成筛选和停止，避免"前端 list → stop 之间新起 task 漏网"的窗口。

**B. 前端 API client 加方法**

`web/src/api/client.ts` 加 `api.tasks.stopByAccount(accountId): Promise<{ success, stopped: string[] }>`。

**C. `handleStop` 调整**

前端本地清理**保留不变**（`loopStopped=true` / `loopGen+=1` / 清 timer / reset UI / 重置 gem 计数 / 远程杀游戏），只把 stop 后端 task 的那一步换掉：

```typescript
// 原:
// if (runningTaskIdsRef.current.length > 0) {
//   await Promise.all(runningTaskIdsRef.current.map(id => api.tasks.stop(id).catch(() => {})));
// }

// 新:
if (currentAccountId) {
  try {
    const r = await api.tasks.stopByAccount(currentAccountId);
    if (r.success && r.stopped.length > 0) pushLog(`⏹️ 后端停止 ${r.stopped.length} 个任务`);
  } catch {}
}
runningTaskIdsRef.current = [];
```

## 影响面

- `server/routes/tasks.ts` — 新增一个路由，10 行
- `server/services/TaskService.ts` — 无改动（复用 `listTasks()` + `stopTask()`）
- `web/src/api/client.ts` — 新增 `stopByAccount` 方法
- `web/src/pages/Home.tsx` — 只改 `handleStop` 中 stop 后端 task 那一段

## 验证

1. 触发一个子循环让 `loopStopped=true`（比如手动模拟许可证到期），观察 UI 已变回"开始运行"，此时点后端 task 列表接口应仍看到有 `running` task
2. 手动调 `/api/tasks/stop-by-account/{accountId}`，应返回 `stopped` 里包含那批漏网 task
3. 完整流程：正常开始运行 → 点停止 → 后端所有 running/pending task 全部 status=`stopped`

## 非目标

- 不改前端"运行中/开始运行"UI 的判断逻辑（不引入基于后端轮询的状态源）
- 不修 16 处子循环里的 `loopStopped=true`（各自语义仍有意义）
- 不改 `runningTaskIdsRef` 的维护方式（继续用于其他不涉及"全停"的场景）
