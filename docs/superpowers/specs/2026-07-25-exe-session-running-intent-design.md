# EXE 会话运行意图与防重复操作设计

## 背景

发布版 EXE 中，用户点击“开始运行”后，Home 页按钮会变成“停止运行”。当窗口通过右上角最小化或关闭到系统托盘，再次打开时，按钮可能恢复为“开始运行”，但后端任务仍在执行，用户因此失去停止入口。

当前按钮状态主要保存在 React state 和 renderer 模块变量中。窗口隐藏本身不应销毁 renderer，但只要 Home 重新挂载、页面重载或 renderer 重建，这些内存状态就可能回到初始值。后端任务运行于独立的本地服务进程，不会随前端状态一起停止，因而产生控制面与执行面不一致。

本设计不把按钮定义为“当前是否恰好存在一个 running action task”，而是定义为本次 EXE 会话内的**用户运行意图**：用户点击开始后，除非用户明确点击停止，否则按钮始终保持“停止运行”。

## 目标

1. 用户点击开始后，本次 EXE 会话内始终显示“停止运行”，直到用户点击停止。
2. 右上角最小化、关闭到托盘、Home 重挂载、页面重载或 renderer 重建不清除该状态。
3. 完全退出 EXE 并重新启动后，状态恢复为“开始运行”。
4. 用户快速连续点击开始或停止 3–5 次时，只允许一个操作进入执行流程。
5. 停止仍复用现有按账号停止所有 `pending` / `running` 后端任务的能力。
6. 切换账号不校准、不重置运行意图，按钮状态保持不变。

## 非目标

- 不轮询后端任务列表来决定按钮状态。
- 不把短生命周期 action task 的 `running` 状态等同于 Home 长期循环状态。
- 不在 renderer 重建后恢复已经丢失的 Home 调度闭包、计时器或子循环。
- 不把运行意图写入磁盘，也不跨 EXE 重启保存。
- 不因账号切换自动开始、停止或校准后台任务。
- 不迁移 Home 调度器到后端。

## 状态模型

### Electron 主进程：会话级运行意图

主进程维护一个仅存在于内存的布尔值：

```ts
runningIntent: boolean
```

语义如下：

- EXE 主进程启动时为 `false`；
- 开始流程被正式接受后设置为 `true`；
- 停止流程成功完成后设置为 `false`；
- BrowserWindow 隐藏、最小化、销毁并重建，以及 renderer 重载均不改变；
- 主进程退出后自然消失，下次启动重新为 `false`。

该值属于整个 EXE 会话，而不是某个账号。运行过程中切换账号不会改变它。

### Home：操作过程状态

Home 维护操作过渡状态：

```ts
type OperationState = 'idle' | 'starting' | 'stopping';
```

Home 另行维护 `intentLoaded: boolean`，用于区分“尚未从主进程恢复状态”和正常空闲态。状态未加载完成时显示“状态读取中”并禁用操作。

- `intentLoaded=false`：显示“状态读取中”，按钮禁用；
- `intentLoaded=true + idle + runningIntent=false`：显示“开始运行”；
- `intentLoaded=true + idle + runningIntent=true`：显示“停止运行”；
- `starting`：显示“启动中”，按钮禁用；
- `stopping`：显示“停止中”，按钮禁用。

`runningIntent` 表示用户意图，`operationState` 表示当前请求是否仍在处理。二者不能合并为一个可随意反转的布尔值。

## IPC 边界

在现有受限 `electronAPI` 上增加两个明确方法：

```ts
getRunningIntent(): Promise<boolean>
setRunningIntent(value: boolean): Promise<boolean>
```

职责划分：

- `electron/main.ts` 保存内存值并注册 IPC handler；
- `electron/preload.ts` 只暴露上述两个专用方法，不开放通用 IPC；
- `web/src/types/electron.d.ts` 同步声明接口；
- Home 通过该接口读取和更新状态。

`setRunningIntent` 返回主进程最终保存的值，便于 renderer 确认写入结果。

在非 Electron 的 Vite 浏览器开发环境中，没有主进程会话存储。Home 可继续使用现有 renderer 内存状态作为开发回退，但发布版 EXE 以主进程值为准。

## 状态流转

### Home 初始化或重新挂载

```text
Home mount
→ intentLoaded = false，显示“状态读取中”并禁用操作
→ 调用 getRunningIntent()
→ 成功：更新本地 runningIntent，intentLoaded = true，operationState = idle
→ 失败：显示状态读取失败，保留 intentLoaded = false 和禁用状态，并允许显式重试
```

状态读取完成前不得默认展示可点击的“开始运行”，否则 renderer 恢复瞬间仍可能创建重复任务。

普通窗口最小化或托盘隐藏若没有导致 Home 重挂载，则无需额外同步，当前 React 状态自然保留；若发生重挂载或 renderer 重建，初始化读取即可恢复。无需监听账号切换，也无需查询后端 task 列表。

### 开始流程

```text
点击“开始运行”
→ 同步抢占操作锁
→ operationState = starting
→ 执行现有启动前校验和初始化
→ Home 循环被正式接受
→ setRunningIntent(true)
→ 更新本地 runningIntent = true
→ operationState = idle
→ 释放操作锁
→ 显示“停止运行”
```

意图不能在仅仅收到点击时就提前写为 `true`，否则校验失败也会留下错误的“停止运行”状态；应在现有开始流程确认可以进入循环后写入。

如果启动校验、初始化或 IPC 写入失败：

1. 不进入稳定的运行状态；
2. 若 Home 循环或后端任务已部分启动，调用现有停止清理路径回滚；
3. 尽力将主进程意图恢复为 `false`；
4. 恢复“开始运行”并显示具体错误。

### 停止流程

```text
点击“停止运行”
→ 同步抢占操作锁
→ operationState = stopping
→ 设置现有前端循环停止标记并清理 timer
→ 调用 stop-by-account 停止当前账号所有 pending/running 任务
→ 后端停止成功
→ setRunningIntent(false)
→ 更新本地 runningIntent = false
→ operationState = idle
→ 释放操作锁
→ 显示“开始运行”
```

如果后端停止失败：

- 主进程意图保持 `true`；
- 按钮恢复为“停止运行”；
- 显示失败信息，允许用户再次停止；
- 不得因为本地清理已执行就假装后端停止成功。

如果后端停止成功但 IPC 写入 `false` 失败：

- 显示会话状态更新失败；
- 保持安全侧状态，不直接显示可点击的“开始运行”；
- 提供重试状态写入或重新读取主进程状态的路径。

## 防快速重复点击

采用两层保护，不使用单纯时间防抖：

1. **UI 禁用**：`starting` 或 `stopping` 时按钮不可点击；
2. **同步 ref 锁**：handler 第一行同步检查并设置 `operationLockRef.current`，在 `finally` 中释放。

需要 ref 锁是因为 React state 更新不是同步提交的。在第一次点击调用 `setOperationState('starting')` 后、组件重新渲染并禁用按钮前，连续点击仍可能再次进入 handler。同步 ref 会在同一个事件循环中立即挡住后续调用。

锁的规则：

```text
锁空闲 → 第一次点击抢占 → 后续点击直接返回
→ 操作成功或失败 → finally 释放
```

开始与停止共享同一把锁，避免开始请求尚未稳定时又进入停止流程，或停止请求尚未完成时再次开始。

## 状态权威与一致性规则

- **用户点击**负责改变运行意图并驱动后台操作；
- **Electron 主进程**负责在本次 EXE 会话内保存该意图；
- **Home 挂载**从主进程恢复意图；
- **按钮显示**不得反向自动启动或停止后台；
- **后端 task 状态**不自动覆盖会话运行意图；
- **任务自然完成、等待、报错或账号切换**不自动把按钮切回“开始运行”；只有明确且成功的停止流程才能清除意图。

这意味着按钮表达“用户是否尚未撤销运行指令”，而不是实时诊断后端是否仍存在 action。该语义与 Home 长期循环中 action 运行、等待、冷却交替出现的结构一致。

## 影响范围

预计涉及：

- `electron/main.ts`：增加会话内存值及 IPC handlers；
- `electron/preload.ts`：暴露读写运行意图的方法；
- `web/src/types/electron.d.ts`：同步 Electron API 类型；
- `web/src/pages/Home.tsx`：初始化恢复、状态模型、开始/停止流转与操作锁；
- 与 Home 状态或 Electron IPC 相邻的测试文件：新增或扩展测试。

不修改 `TaskService`、任务列表接口或账号切换协议；停止继续使用已有 `stop-by-account` 接口。

## 测试设计

### Electron IPC

1. 新 EXE 会话中 `getRunningIntent()` 返回 `false`；
2. 设置为 `true` 后再次读取仍为 `true`；
3. BrowserWindow 隐藏、最小化或 renderer 重载不重置该值；
4. 新主进程会话重新从 `false` 开始；
5. IPC 只接受布尔值，非法值被拒绝或规范化为明确错误。

### Home 状态

1. 初始化读取为 `false` 时显示“开始运行”；
2. 初始化读取为 `true` 时显示“停止运行”；
3. 状态读取完成前开始按钮不可用；
4. 状态读取失败时不误显示可点击的“开始运行”；
5. 开始成功后写入 `true` 并显示“停止运行”；
6. 启动校验失败时保持或回滚为 `false`；
7. 停止成功后写入 `false` 并显示“开始运行”；
8. 停止后端失败时保持 `true` 和“停止运行”；
9. 切换账号不读取、不清除、不改变会话运行意图；
10. task 自然完成或进入等待阶段不改变按钮。

### 快速点击

1. 连续快速触发开始 handler 3–5 次，只执行一次启动流程和一次意图写入；
2. 连续快速触发停止 handler 3–5 次，只执行一次按账号停止和一次意图写入；
3. React 尚未完成 `starting/stopping` 重渲染时，同步 ref 锁仍能拦截重复调用；
4. 操作失败后锁在 `finally` 中释放，用户可以重试；
5. 开始和停止不能并发执行。

### 发布版手工验证

1. 点击开始，确认按钮进入“启动中”后变为“停止运行”；
2. 通过右上角“—”最小化并恢复，按钮仍为“停止运行”；
3. 通过“×”最小化到托盘并恢复，按钮仍为“停止运行”；
4. 在开发工具或测试钩子中触发 renderer reload，按钮从主进程恢复为“停止运行”；
5. 快速点击开始或停止 3–5 次，日志和后端任务证明只执行一次；
6. 运行中切换账号，按钮保持“停止运行”；
7. 点击停止成功后按钮变为“开始运行”，后端当前账号无 `pending/running` 任务；
8. 完全退出 EXE，再次启动后显示“开始运行”。

## 成功标准

- 两种窗口隐藏路径恢复后均不再丢失“停止运行”状态；
- renderer 重建后可从主进程恢复本次会话意图；
- 用户始终保留停止入口，直到停止流程成功；
- 快速连续点击不会创建重复启动流程、并发停止请求或产生请求顺序竞态；
- EXE 完全退出后不残留运行意图。
