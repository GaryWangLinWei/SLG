# 游戏下线调度（夜间模式 + 宝石休息）设计

**Date:** 2026-06-19
**Status:** Draft, awaiting user review

## 背景

两个使用场景：
1. **夜间模式** — 每天 02:00-05:00 下线游戏（模拟玩家睡觉），到点自动 kill 游戏，5 点自动启动游戏
2. **宝石采集休息** — 普通模式的 rest 阶段（不采集），需要把游戏下线模拟玩家不在线，rest 结束后启动游戏

两者共享同一套 "kill / launch" 机制 —— 任何一个进入下线状态都 kill，全部退出下线状态才 launch。

## 范围

- **包名硬编码 `com.lilithgame.roc.gp`**（国服万国）。可后续放到 RokConfig 里给 Config 页改，本期不做。
- **设备绑定当前选中账号**，多设备无关。
- **专注模式与普通模式共享同一套 active/rest 轮替**，两者都使用 `gemGatherActiveHours` / `gemGatherRestHours` 配置。rest 阶段都触发游戏下线。

## 改动清单

### 1. 新增两个 ROK action

**`plugins/rok/actions/killGame.ts`**
```ts
const PACKAGE_NAME = 'com.lilithgame.roc.gp';

export const killGame: PluginAction = {
  id: 'kill-game',
  name: '强制关闭游戏',
  description: 'force-stop 万国觉醒进程，模拟下线',
  run: async (ctx: PluginContext) => {
    await ctx.execShell(`am force-stop ${PACKAGE_NAME}`);
    ctx.log(`[KILL-GAME] 已 force-stop ${PACKAGE_NAME}`);
  },
};
```

**`plugins/rok/actions/launchGame.ts`**
```ts
export const launchGame: PluginAction = {
  id: 'launch-game',
  name: '启动游戏',
  description: 'monkey 启动万国觉醒，等加载、点击中心进入游戏',
  run: async (ctx: PluginContext) => {
    await ctx.execShell(`monkey -p ${PACKAGE_NAME} -c android.intent.category.LAUNCHER 1`);
    ctx.log(`[LAUNCH-GAME] 已发送启动命令，等待 10s 进入开始界面`);
    await ctx.sleep(10);
    ctx.log(`[LAUNCH-GAME] 点击屏幕中心 (800, 450) 进入游戏`);
    await ctx.tap(800, 450);
    ctx.log(`[LAUNCH-GAME] 等待 20s 加载完成`);
    await ctx.sleep(20);
  },
};
```

### 2. PluginContext 新增 `execShell`

`core/plugin/PluginContext.ts` 暴露 `device.execShell` 方法，调用 `AdbDevice` 现有的 ADB shell 执行能力。`AdbDevice` 已有 `execAsync` + 拼装 `adb -s <id> shell <cmd>` 的能力（见 `screencap`、`tap` 实现），抽个 public method `execShell(cmd: string): Promise<{stdout: string}>` 出来即可。

### 3. HomeFeatures 改动

**新增：**
```ts
nightMode: boolean;  // 夜间下线模式开关，固定 02:00-05:00
```
默认 `false`。不暴露时间段（固定 2-5 点）。

**删除：**
```ts
loopInterval: number;  // 已只剩城外采集使用，迁移为代码常量
```

迁移：`Home.tsx:389`（启动日志的 interval 显示）和 `Home.tsx:459`（城外采集间隔）的 `features.loopInterval` 改成模块级常量 `const GATHER_LOOP_INTERVAL = 300`。`Home.tsx:1190-1201` banner 内的"循环间隔 X 秒"文字 + 输入框删除。`homeFeatures.ts` 接口字段 + 默认值删除。

### 4. Home.tsx — 下线调度器

**新增模块级状态**（与 loopStopped 同层）：
```ts
let offlineActive = false;        // 当前是否处于下线状态
let lastOfflineState = false;     // 上次的状态（用于边沿检测）
```

**新增独立 async 子循环 — 下线监控器**（与现有 cave / gem 子循环并列）：
```ts
(async () => {
  while (!loopStopped) {
    const f = featuresRef.current;
    const now = new Date();
    const hour = now.getHours();

    // 夜间窗口：2:00 ≤ now < 5:00
    const inNightWindow = f.nightMode && hour >= 2 && hour < 5;

    // 宝石休息窗口：由宝石普通模式 loop 通过模块级标志告知
    const inGemRest = moduleGemRestActive;  // 见下条

    const shouldOffline = inNightWindow || inGemRest;

    if (shouldOffline && !lastOfflineState) {
      // 边沿：进入下线
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🌙 进入下线状态`]);
      if (await acquireLock()) {
        try {
          const r = await api.tasks.create(currentAccountId, 'com.rok.automation', 'kill-game');
          if (r.success) await api.tasks.run(r.task.id);
        } finally { releaseLock(); }
      }
      offlineActive = true;
      lastOfflineState = true;
    } else if (!shouldOffline && lastOfflineState) {
      // 边沿：恢复上线
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ☀️ 恢复上线状态`]);
      if (await acquireLock()) {
        try {
          const r = await api.tasks.create(currentAccountId, 'com.rok.automation', 'launch-game');
          if (r.success) await api.tasks.run(r.task.id);
        } finally { releaseLock(); }
      }
      offlineActive = false;
      lastOfflineState = false;
    }

    await sleep(30);  // 每 30s 检查一次
  }
})();
```

**所有现有子循环加双重守卫**（建造、采集、协助、援助、城寨、洞窟、宝石、世界聊天）：

acquireLock 是单互斥锁，task A 通过守卫 ① 后还要排队等锁；监控器可能先拿到锁 → kill 游戏 → offlineActive=true → 释放锁；task A 才拿到锁，此时游戏已 kill，若直接执行 task 会发出无效 ADB 操作（截图 launcher 桌面、模板不匹配、task 失败若干次才退出）。修复：拿到锁后再检查一次 offlineActive，发现下线立刻释放锁跳过本轮。

```ts
while (!loopStopped) {
  if (offlineActive) { await sleep(30); continue; }   // ① 进入排队前的快速跳过
  // ...原有 if (!features.xxx) continue 等检查
  if (!await acquireLock()) break;
  if (offlineActive) {                                 // ② 拿到锁后的二次检查
    releaseLock();
    await sleep(30);
    continue;
  }
  try {
    // ...task 执行
  } finally { releaseLock(); }
}
```

这样监控器和其他 task 平等竞争锁，但 task 有"放弃"机制，监控器 kill 后所有排队中的 task 拿到锁就立刻跳过。kill-game / launch-game 期间任何已跑到一半的 task 都不会被打断（acquireLock 排队等它跑完）—— 最坏延迟 = 单 task 最长执行时间（宝石专注约 5 分钟），可接受。

**宝石普通模式 + 专注模式共享 active/rest 轮替** —— 重构 `Home.tsx` 宝石子循环，把 active/rest 框架抽到外层，模式选择只决定 active 阶段调哪个 task：

```ts
while (!loopStopped) {
  if (offlineActive) { await sleep(30); continue; }
  const f = featuresRef.current;
  if (!f.gemGatherEnabled || f.gemGatherTeams.length === 0 || f.autoExplore || f.autoWorldChat) {
    await sleep(30); continue;
  }
  // ── 读取初始宝石数（如未记录）── 见现有代码

  const activeHours = Number(f.gemGatherActiveHours) || 2;
  const restHours = Number(f.gemGatherRestHours) || 1;

  // ── active 阶段 ──
  const activeEnd = Date.now() + activeHours * 3600 * 1000;
  const isFocus = f.gemGatherFocusMode;
  const actionId = isFocus ? 'gem-gather-focus' : 'gem-gather';
  const intervalSec = isFocus ? 60 : 300;          // 专注 60s, 普通 300s
  setGemRestCountdown('');
  setLogs(prev => [...prev,
    `[${new Date().toLocaleTimeString()}] 💎 ${isFocus ? '专注' : '普通'}采集开始，${activeHours}h`]);

  while (!loopStopped && Date.now() < activeEnd) {
    if (offlineActive) { await sleep(30); continue; }
    if (!await acquireLock()) break;
    if (offlineActive) { releaseLock(); await sleep(30); continue; }
    try {
      const r = await api.tasks.create(currentAccountId, 'com.rok.automation', actionId, { teams: f.gemGatherTeams });
      // ...原有 run / 许可证检测 / readCount 同两个模式都已有的逻辑（保留即可）
    } catch {} finally { releaseLock(); }

    if (loopStopped) break;
    if (Date.now() >= activeEnd) break;
    const wait = intervalSec * (0.85 + Math.random() * 0.3);
    const startWait = Date.now();
    while (!loopStopped && (Date.now() - startWait) < wait * 1000 && Date.now() < activeEnd) {
      await sleep(1);
    }
  }
  if (loopStopped) break;

  // ── rest 阶段（普通+专注共用，触发下线）──
  const restEnd = Date.now() + restHours * 3600 * 1000;
  moduleGemRestActive = true;
  setLogs(prev => [...prev,
    `[${new Date().toLocaleTimeString()}] 💤 宝石采集休息 ${restHours}h，${new Date(restEnd).toLocaleTimeString()} 恢复`]);
  while (!loopStopped && Date.now() < restEnd) {
    const remaining = Math.max(0, restEnd - Date.now());
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    setGemRestCountdown(`${h}h ${m}m ${s}s`);
    await sleep(1);
  }
  setGemRestCountdown('');
  moduleGemRestActive = false;
}
```

注意：原专注模式分支（668-722 行）整段删除，普通模式分支（724-820 左右）外层结构合并到上面统一框架。

### 5. UI

**首页顶部 Status banner（`Home.tsx:1185`，"准备就绪/运行中"那行）的改动：**

1. **删除"循环间隔: [输入框] 秒"组件**（`Home.tsx:1193-1202` 那段 `deviceConnected && !taskRunning` 的 div）
2. **删除副标题中的"· 循环间隔 X 秒"**（`Home.tsx:1190` 改成 `{deviceConnected ? '设备已连接' : '未连接设备'}`）
3. **新增夜间模式勾选框**（占用步骤 1 删除后腾出的位置，按钮左侧）。需要让用户清楚知道作用——文字直接写明，并加 `title` 属性 hover 提示详情：

```tsx
{deviceConnected && (
  <label
    className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer"
    title="开启后每天 02:00 自动强制关闭游戏，05:00 自动启动游戏，模拟玩家睡觉时段下线，降低被检测风险"
  >
    <input type="checkbox" checked={features.nightMode}
      onChange={e => setFeatures({ ...features, nightMode: e.target.checked })}
      className="w-4 h-4 accent-emerald-500" />
    <span>🌙 夜间下线 02-05点</span>
  </label>
)}
```

文字解读：
- "夜间下线"明确动作（不是"夜间模式"那种含糊词）
- "02-05点"明确时段
- hover tooltip 解释为什么这么做（防检测）

可选增强：当 `offlineActive === true` 时，副标题改为 "设备已连接 · 💤 已下线"。

### 6. plugins/rok/index.ts

注册 `killGame` 和 `launchGame` 两个 action。

## 边沿场景

| 场景 | 处理 |
|---|---|
| 用户启动 loop 时正好在夜间窗口内 | 监控器首次 tick 检测到 shouldOffline=true、lastOfflineState=false → 触发 kill 路径 ✅ |
| 用户在 dispatch kill-game 期间停止 loop | acquireLock 内的 task 跑完才退出，无残留 |
| task 通过守卫 ① 后、acquireLock 阻塞中，监控器抢先 kill | task 拿到锁后守卫 ② 检测到 offlineActive，释放锁跳过本轮 ✅ |
| 夜间窗口和宝石休息时段重叠 | shouldOffline = inNightWindow OR inGemRest，状态不会双重触发，离开重叠区时只 launch 一次（要求两个都退出）|
| 关闭 nightMode 开关时正在夜间下线 | 下次 tick: inNightWindow=false, inGemRest=false → shouldOffline=false → 触发 launch（符合预期：用户关掉了功能就上线）|
| launch 完成但游戏加载未完成就开始跑任务 | launchGame 内置 `sleep(10) → tap(800,450) → sleep(20)` 共 30s 缓冲；offlineActive 直到 launch task 跑完才置 false，期间所有子循环守卫拦住 |

## 测试

实现后人工验证：
1. 启动 loop，nightMode 开 → 等到 2 点 → 应触发 kill，5 点 → 应触发 launch（点中心 → 等加载 → 子循环开始跑）
2. 不到夜间，启动宝石普通模式（active=0.05h, rest=0.05h，约 3 分钟切换） → rest 阶段应 kill，rest 结束应 launch
3. 不到夜间，启动宝石专注模式（active=0.05h, rest=0.05h） → 应同样切换到 rest → kill → 恢复时 launch
4. 夜间窗口 + 宝石休息重叠 → 进入夜间触发 kill，宝石休息开始/结束不重复 kill/launch，夜间结束 + 宝石休息已结束 → launch 一次
5. 验证夜间下线期间，建造/协助/采集等 loop 跳过

## 文件变更清单

```
plugins/rok/actions/killGame.ts      新增
plugins/rok/actions/launchGame.ts    新增
plugins/rok/index.ts                 注册两个 action
plugins/rok/homeFeatures.ts          新增 nightMode + 删除 loopInterval
core/plugin/PluginContext.ts         暴露 execShell 方法
core/device/AdbDevice.ts             暴露 execShell public method
web/src/pages/Home.tsx               下线监控子循环 + 子循环双重守卫 + 宝石 active/rest 重构（普通+专注共用）+ banner 删除循环间隔输入框 + 新增夜间模式勾选 + 城外采集 loopInterval 常量化
```
