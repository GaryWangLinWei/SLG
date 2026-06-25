# 游戏下线调度（夜间模式 + 宝石休息）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让游戏每天 02:00-05:00 自动 force-stop + 5:00 自动启动；同时把宝石采集 rest 阶段也接入下线机制；专注模式与普通模式共享 active/rest 轮替。

**Architecture:** ROK 插件新增两个 action（`kill-game` + `launch-game`），通过 `PluginContext.execShell` 透传到 `AdbDevice.execShell` 调 ADB shell。前端 Home.tsx 新增独立子循环作为下线监控器，依据 `nightMode` 配置 + 模块级宝石休息标志做边沿触发；所有现有子循环加双重守卫（offlineActive 检查 + 拿锁后二次检查）。宝石普通/专注模式重构为统一的 active/rest 主循环。

**Tech Stack:** TypeScript（前端 React + 后端 Node ts-node + Electron），ADB shell（`am force-stop` / `monkey -p ... 1`），现有 sharp/Vision 模板匹配（不涉及）。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `core/device/Device.ts` | Device 接口新增可选 `execShell` 方法签名 |
| `core/device/AdbDevice.ts` | 实现 `execShell(cmd: string): Promise<{stdout: string}>`，封装 `adb -s <id> shell <cmd>` |
| `core/plugin/PluginContext.ts` | 暴露 `execShell` 转发到 device |
| `plugins/rok/actions/killGame.ts` | 新增 — kill-game action |
| `plugins/rok/actions/launchGame.ts` | 新增 — launch-game action |
| `plugins/rok/index.ts` | 注册两个新 action |
| `plugins/rok/homeFeatures.ts` | 新增 `nightMode` 字段，删除 `loopInterval` 字段 |
| `web/src/pages/Home.tsx` | 下线监控子循环 + 全部子循环双重守卫 + 宝石 active/rest 重构 + banner UI 改造 + 城外采集间隔常量化 |

## 实施顺序

后端先行（Tasks 1-5），让 action 先可用；前端再做 UI/逻辑（Tasks 6-11）。所有任务互相独立，每个 task 都能单独编译跑通。

---

## Task 1: AdbDevice 暴露 execShell

**Files:**
- Modify: `D:\SLG\core\device\Device.ts`
- Modify: `D:\SLG\core\device\AdbDevice.ts`

- [ ] **Step 1: Device.ts 接口加 execShell 可选方法**

修改 `core/device/Device.ts`，在 `inputText` 之后插入一行：

```ts
import { Point, Rect } from '../types';

export interface Device {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getDeviceInfo(): Promise<{ width: number; height: number }>;

  screenshot(savePath?: string): Promise<Buffer>;
  tap(x: number, y: number): Promise<void>;
  tapPoint(point: Point): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, duration?: number): Promise<void>;
  swipeAndHold?(x1: number, y1: number, x2: number, y2: number, holdMs?: number): Promise<void>;
  releaseHold?(): Promise<void>;
  pinch(x1: number, y1: number, x2: number, y2: number, toX1: number, toY1: number, toX2: number, toY2: number, duration?: number): Promise<void>;
  inputText(text: string): Promise<void>;
  execShell?(cmd: string): Promise<{ stdout: string }>;
  sleep(seconds: number, maxSeconds?: number): Promise<void>;
}
```

- [ ] **Step 2: AdbDevice.ts 实现 execShell**

在 `core/device/AdbDevice.ts` 找到 `getDeviceInfo` 方法（约 103 行）后面插入新方法：

```ts
  /**
   * 执行任意 ADB shell 命令，返回 stdout（不经 input/screencap 包装）。
   * 用于 am force-stop / monkey 等系统命令。
   */
  async execShell(cmd: string): Promise<{ stdout: string }> {
    if (!this.connected) throw new Error('Device not connected');
    const fullCmd = `"${getAdbPath()}" -s ${this.deviceId} shell ${cmd}`;
    const { stdout } = await this.execAsync(fullCmd);
    return { stdout };
  }
```

注意：选用 `execAsync`（不是 `execAdb`）—— `execAdb` 设计为忽略 stdout 且会自动重连，而我们要的是简单一次性命令拿 stdout。`execAsync` 来自 `promisify(exec)`（见 60 行）。

- [ ] **Step 3: 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: zero output（无类型错误）

- [ ] **Step 4: Commit**

```bash
git add core/device/Device.ts core/device/AdbDevice.ts
git commit -m "feat(device): AdbDevice 暴露 execShell 方法"
```

---

## Task 2: PluginContext 暴露 execShell

**Files:**
- Modify: `D:\SLG\core\plugin\PluginContext.ts`

- [ ] **Step 1: 在 PluginContext 类内部 inputText 方法后面新增 execShell**

在 `core/plugin/PluginContext.ts` 找到 `inputText` 方法（约 224 行）：

```ts
  async inputText(text: string): Promise<void> {
    await this.device.inputText(text);
  }
```

在它后面插入：

```ts
  /**
   * 执行任意 ADB shell 命令。返回 stdout 字符串。
   * 用于 am force-stop / monkey 等场景。
   */
  async execShell(cmd: string): Promise<{ stdout: string }> {
    this.checkCancellation();
    if (!this.device.execShell) {
      throw new Error('Device 不支持 execShell（仅 AdbDevice 支持）');
    }
    return await this.device.execShell(cmd);
  }
```

- [ ] **Step 2: 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: zero output

- [ ] **Step 3: Commit**

```bash
git add core/plugin/PluginContext.ts
git commit -m "feat(plugin): PluginContext 暴露 execShell 转发到 device"
```

---

## Task 3: 新增 killGame action

**Files:**
- Create: `D:\SLG\plugins\rok\actions\killGame.ts`

- [ ] **Step 1: 创建文件**

写入 `plugins/rok/actions/killGame.ts`：

```ts
import { PluginAction } from '../../../core/plugin';

const PACKAGE_NAME = 'com.lilithgame.roc.gp';

export const killGame: PluginAction = {
  id: 'kill-game',
  name: '强制关闭游戏',
  description: 'force-stop 万国觉醒进程，模拟下线',
  run: async (ctx) => {
    await ctx.execShell(`am force-stop ${PACKAGE_NAME}`);
    ctx.log(`[KILL-GAME] 已 force-stop ${PACKAGE_NAME}`);
  },
};
```

- [ ] **Step 2: 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: zero output

- [ ] **Step 3: Commit**

```bash
git add plugins/rok/actions/killGame.ts
git commit -m "feat(rok): 新增 kill-game action（force-stop 游戏）"
```

---

## Task 4: 新增 launchGame action

**Files:**
- Create: `D:\SLG\plugins\rok\actions\launchGame.ts`

- [ ] **Step 1: 创建文件**

写入 `plugins/rok/actions/launchGame.ts`：

```ts
import { PluginAction } from '../../../core/plugin';

const PACKAGE_NAME = 'com.lilithgame.roc.gp';

export const launchGame: PluginAction = {
  id: 'launch-game',
  name: '启动游戏',
  description: 'monkey 启动万国觉醒，等加载、点击中心进入游戏',
  run: async (ctx) => {
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

- [ ] **Step 2: 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: zero output

- [ ] **Step 3: Commit**

```bash
git add plugins/rok/actions/launchGame.ts
git commit -m "feat(rok): 新增 launch-game action（启动游戏 + 点击中心 + 30s 缓冲）"
```

---

## Task 5: 注册两个 action 到 ROK 插件

**Files:**
- Modify: `D:\SLG\plugins\rok\index.ts`

- [ ] **Step 1: 顶部加 import**

打开 `plugins/rok/index.ts`，在已有 import 块（1-22 行）末尾、`import * as path from 'path';` 之后追加：

```ts
import { killGame } from './actions/killGame';
import { launchGame } from './actions/launchGame';
```

- [ ] **Step 2: 注册 action**

在 actions 数组末尾（找到最后一个 action `gem-gather-focus` 的 `}` 闭合后、数组的 `]` 之前）追加两个条目。先用 grep 定位末尾：

```bash
grep -n "id: 'gem-gather-focus'" D:/SLG/plugins/rok/index.ts
```

然后在该 action 对象（包含闭合 `}` + 逗号）之后、`actions: [...]` 数组的 `]` 之前插入：

```ts
    killGame,
    launchGame,
```

（注意首字母小写，与 import 名匹配；它们已经是完整 PluginAction 对象，直接对象塞入即可）

- [ ] **Step 3: 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: zero output

- [ ] **Step 4: 后端运行测试**

```bash
cd D:/SLG && npm run server
```

Expected: 控制台无报错，看到 "Server listening on :3000"。Ctrl+C 停掉。

- [ ] **Step 5: Commit**

```bash
git add plugins/rok/index.ts
git commit -m "feat(rok): 注册 kill-game + launch-game action"
```

---

## Task 6: HomeFeatures 新增 nightMode + 删除 loopInterval

**Files:**
- Modify: `D:\SLG\plugins\rok\homeFeatures.ts`

- [ ] **Step 1: 编辑接口与默认值**

将 `plugins/rok/homeFeatures.ts` 完整替换为：

```ts
export interface HomeFeatures {
  collectResources: boolean;
  upgradeBuildings: boolean;
  selectedBuildings: string[];
  autoResearch: boolean;
  selectedTechs: string[];
  gatherResources: boolean;
  gatherTasks: { type: string; level: number }[];
  trainTroops: boolean;
  trainTasks: Record<string, number>;
  autoExplore: boolean;
  exploreCount: number;
  autoWorldChat: boolean;
  worldChatMessages: string[];
  worldChatInterval: number;
  helpTeammates: boolean;
  autoRallyFort: boolean;
  rallyFortLevel: number;
  rallyFortTeam: number;
  rallyFortDowngrade: boolean;
  gemGatherEnabled: boolean;
  gemGatherFocusMode: boolean;
  gemGatherTeams: number[];
  gemGatherActiveHours: number;
  gemGatherRestHours: number;
  autoCaveExplore: boolean;
  nightMode: boolean;
}

export const DEFAULT_HOME_FEATURES: HomeFeatures = {
  collectResources: true,
  upgradeBuildings: true,
  selectedBuildings: ['', '', '', '', ''],
  autoResearch: false,
  selectedTechs: ['', '', '', '', ''],
  gatherResources: false,
  gatherTasks: [
    { type: '农田', level: 5 },
    { type: '伐木场', level: 4 },
    { type: '石矿', level: 3 },
    { type: '金矿', level: 2 },
    { type: '', level: 1 },
  ],
  trainTroops: false,
  trainTasks: { '兵营': 0, '马厩': 0, '靶场': 0, '攻城武器厂': 0 },
  autoExplore: false,
  exploreCount: 3,
  autoWorldChat: false,
  worldChatMessages: ['', '', ''],
  worldChatInterval: 300,
  helpTeammates: false,
  autoRallyFort: false,
  rallyFortLevel: 0,
  rallyFortTeam: 1,
  rallyFortDowngrade: true,
  gemGatherEnabled: false,
  gemGatherFocusMode: false,
  gemGatherTeams: [1],
  gemGatherActiveHours: 2,
  gemGatherRestHours: 1,
  autoCaveExplore: false,
  nightMode: false,
};
```

变化：
- 删除接口里的 `loopInterval: number;` 行
- 删除默认值里的 `loopInterval: 300,` 行
- 新增接口里的 `nightMode: boolean;` 行（紧跟 `autoCaveExplore` 后）
- 新增默认值里的 `nightMode: false,` 行

- [ ] **Step 2: 编译检查（会报错，预期的）**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: 报 `web/src/pages/Home.tsx` 中 `loopInterval` 不存在的错误，**这正是 Task 7 要修的**。如果只在 Home.tsx 报错，继续；如果别处也报，先确认那些位置。

- [ ] **Step 3: Commit**

```bash
git add plugins/rok/homeFeatures.ts
git commit -m "feat(home-features): 新增 nightMode，删除 loopInterval"
```

---

## Task 7: Home.tsx — 城外采集间隔常量化 + 删除 loopInterval 引用

**Files:**
- Modify: `D:\SLG\web\src\pages\Home.tsx`

- [ ] **Step 1: 模块顶部新增常量**

打开 `web/src/pages/Home.tsx`，在第 14 行 `let deviceBusy = false;` 之后追加一行：

```ts
const GATHER_LOOP_INTERVAL = 300; // 城外采集独立循环间隔（秒）
```

- [ ] **Step 2: 替换启动日志的 interval 计算**

找到 `Home.tsx:389`：

```ts
    const interval = isExploreMode ? 60 : isWorldChatMode ? features.worldChatInterval : features.loopInterval;
```

替换为：

```ts
    const interval = isExploreMode ? 60 : isWorldChatMode ? features.worldChatInterval : GATHER_LOOP_INTERVAL;
```

- [ ] **Step 3: 替换城外采集间隔**

找到 `Home.tsx:459`：

```ts
          const jitteredInterval = features.loopInterval * (0.85 + Math.random() * 0.3);
```

替换为：

```ts
          const jitteredInterval = GATHER_LOOP_INTERVAL * (0.85 + Math.random() * 0.3);
```

- [ ] **Step 4: 删除 banner 中的循环间隔显示文字**

找到 `Home.tsx:1190`：

```tsx
              <p className="text-sm text-slate-500">{deviceConnected ? `设备已连接 · 循环间隔 ${features.loopInterval}秒` : '未连接设备'}</p>
```

替换为：

```tsx
              <p className="text-sm text-slate-500">{deviceConnected ? '设备已连接' : '未连接设备'}</p>
```

- [ ] **Step 5: 删除 banner 中的循环间隔输入框**

找到 `Home.tsx:1194-1202` 这一段：

```tsx
            {deviceConnected && !taskRunning && (
              <div className="flex items-center gap-2">
                <span className="text-slate-500 text-sm">循环间隔:</span>
                <input type="number" min={180} step={30} value={features.loopInterval}
                  onChange={(e) => setFeatures({ ...features, loopInterval: Math.max(180, Number(e.target.value)) })}
                  className="w-16 px-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm text-center focus:outline-none focus:border-emerald-400" />
                <span className="text-slate-500 text-sm">秒</span>
              </div>
            )}
```

整段删除（包括外层 `{deviceConnected && !taskRunning && (` 与 `)}` 闭合）。

- [ ] **Step 6: 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: zero output（loopInterval 引用应已清理干净）

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "refactor(home): 城外采集间隔常量化，删除 loopInterval UI"
```

---

## Task 8: Home.tsx — 新增 offlineActive 状态 + 下线监控子循环

**Files:**
- Modify: `D:\SLG\web\src\pages\Home.tsx`

- [ ] **Step 1: 模块顶部新增状态变量**

在 `Home.tsx` 模块级状态区（紧跟第 16 行 `let moduleGemCollectedCount: number = 0;` 之后），追加：

```ts
let offlineActive = false;             // 当前是否处于下线状态
let lastOfflineState = false;          // 上次的状态（用于边沿检测）
let moduleGemRestActive = false;       // 宝石采集 rest 阶段标志
```

- [ ] **Step 2: clearLoopState 中重置标志**

找到 `Home.tsx:29-34` 的 `clearLoopState` 函数：

```ts
function clearLoopState() {
  loopLogs = [];
  moduleGemInitialCount = null;
  moduleGemCollectedCount = 0;
  try { sessionStorage.removeItem(LOOP_STATE_KEY); } catch {}
}
```

在 `moduleGemCollectedCount = 0;` 之后插入：

```ts
  offlineActive = false;
  lastOfflineState = false;
  moduleGemRestActive = false;
```

- [ ] **Step 3: 在主循环启动处插入下线监控子循环**

找到 `Home.tsx:601` 附近的 `// 山洞探索独立循环` 注释行（即 `caveLoop` 起始位置）。在它**前面**插入下线监控子循环：

```ts
      // 下线监控独立循环 — 每 30s 检查一次，边沿触发 kill / launch
      const offlineLoop = (async () => {
        while (!loopStopped) {
          const f = featuresRef.current;
          const now = new Date();
          const hour = now.getHours();
          const inNightWindow = f.nightMode && hour >= 2 && hour < 5;
          const inGemRest = moduleGemRestActive;
          const shouldOffline = inNightWindow || inGemRest;

          if (shouldOffline && !lastOfflineState) {
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🌙 进入下线状态（${inNightWindow ? '夜间' : '宝石休息'}）`]);
            offlineActive = true;
            lastOfflineState = true;
            if (await acquireLock()) {
              try {
                const r = await api.tasks.create(currentAccountId, 'com.rok.automation', 'kill-game');
                if (r.success) {
                  runningTaskIdsRef.current = [...runningTaskIdsRef.current, r.task.id];
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                  await api.tasks.run(r.task.id);
                  runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== r.task.id);
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                }
              } catch {} finally { releaseLock(); }
            }
          } else if (!shouldOffline && lastOfflineState) {
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ☀️ 恢复上线状态`]);
            if (await acquireLock()) {
              try {
                const r = await api.tasks.create(currentAccountId, 'com.rok.automation', 'launch-game');
                if (r.success) {
                  runningTaskIdsRef.current = [...runningTaskIdsRef.current, r.task.id];
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                  await api.tasks.run(r.task.id);
                  runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== r.task.id);
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                }
              } catch {} finally { releaseLock(); }
            }
            offlineActive = false;
            lastOfflineState = false;
          }

          // 等 30s 再检查（中途循环停止可立即退出）
          const startWait = Date.now();
          while (!loopStopped && (Date.now() - startWait) < 30000) {
            await sleep(1);
          }
        }
      })();
```

注意：进入下线时**先**置 `offlineActive = true`，再去拿锁 kill；这样所有现有 task 一旦拿锁后做二次检查就会跳过。退出下线时反之，先 launch 完再置 false，保证子循环不在游戏未启动时跑。

- [ ] **Step 4: 把 offlineLoop 加入主循环 await 集合**

找到 `Home.tsx:1142` 附近（实际行号可能因前面插入而偏移）：

```ts
      await Promise.all([helpLoop, collectLoop, gatherLoop, rallyLoop, caveLoop]);
```

替换为：

```ts
      await Promise.all([helpLoop, collectLoop, gatherLoop, rallyLoop, caveLoop, offlineLoop]);
```

- [ ] **Step 5: 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: zero output

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): 新增下线监控子循环（边沿触发 kill/launch）"
```

---

## Task 9: Home.tsx — 现有子循环加双重守卫

**Files:**
- Modify: `D:\SLG\web\src\pages\Home.tsx`

每个子循环改两处：① while 入口加 `if (offlineActive) { await sleep(30); continue; }`；② `if (!await acquireLock()) break;` 之后立刻 `if (offlineActive) { releaseLock(); await sleep(30); continue; }`。下面针对每个子循环列出具体位置和改动。

注：行号是 Task 8 之前的原始行号；Task 8 的插入会让这些位置整体往后移。grep 定位代码片段比按行号靠谱。

- [ ] **Step 1: gatherLoop（城外采集）**

找到城外采集 loop 入口：

```bash
grep -n "城外采集独立循环" D:/SLG/web/src/pages/Home.tsx
```

它的 while 主体（约 429 行起）：

```ts
        while (!loopStopped) {
          if (first) { first = false; await sleep(10); continue; }
          if (features.gatherResources && !features.autoExplore && !features.autoWorldChat && !features.gemGatherFocusMode) {
```

在 `if (first) ... continue; }` 后、`if (features.gatherResources ...)` 前插入：

```ts
          if (offlineActive) { await sleep(30); continue; }
```

然后找到本循环的 `if (!await acquireLock()) break;`（约 436 行）：

```ts
              if (!await acquireLock()) break;
              try {
```

替换为：

```ts
              if (!await acquireLock()) break;
              if (offlineActive) { releaseLock(); await sleep(30); continue; }
              try {
```

- [ ] **Step 2: helpLoop（帮助盟友）**

找到位置：

```bash
grep -n "帮助盟友独立循环" D:/SLG/web/src/pages/Home.tsx
```

在 `if (first) ... continue; }` 后追加守卫 ①：

```ts
          if (offlineActive) { await sleep(30); continue; }
```

在 `if (!await acquireLock()) break;` 后追加守卫 ②：

```ts
            if (!await acquireLock()) break;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            try {
```

- [ ] **Step 3: collectLoop（收集资源）**

找到位置：

```bash
grep -n "收集资源独立循环" D:/SLG/web/src/pages/Home.tsx
```

注意此 loop 的 `if (first) { first = false; await sleep(4 * 3600); continue; }` 后续处理 features 检查，再 acquire。在 `if (first) ... continue; }` 后追加：

```ts
          if (offlineActive) { await sleep(30); continue; }
```

在 `if (!await acquireLock()) break;` 后追加：

```ts
            if (!await acquireLock()) break;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            try {
```

- [ ] **Step 4: rallyLoop（攻打城寨）**

找到位置：

```bash
grep -n "攻打城寨独立循环" D:/SLG/web/src/pages/Home.tsx
```

在 `if (first) ... continue; }` 后追加：

```ts
          if (offlineActive) { await sleep(30); continue; }
```

在 `if (!await acquireLock()) break;` 后追加：

```ts
            if (!await acquireLock()) break;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            let cd = 600;
```

- [ ] **Step 5: caveLoop（山洞探索）**

找到位置：

```bash
grep -n "山洞探索独立循环" D:/SLG/web/src/pages/Home.tsx
```

在 `if (first) ... continue; }` 后追加：

```ts
          if (offlineActive) { await sleep(30); continue; }
```

在 `if (!await acquireLock()) break;` 后追加：

```ts
              if (!await acquireLock()) break;
              if (offlineActive) { releaseLock(); await sleep(30); continue; }
              try {
```

- [ ] **Step 6: 主循环（OCR 调度循环 + idle-drag 等）**

主循环用了多次 acquireLock。先在主循环 `while (!loopStopped)` 入口（约 415 行 `let round = 0;` 之后的 while；找 `let round = 0;` 然后下一个 while）加守卫 ①：

```bash
grep -n "let round = 0;" D:/SLG/web/src/pages/Home.tsx
```

在 `let round = 0;` 之后第一个 `while (!loopStopped)` 内最早的 try/逻辑之前加。具体位置：找到主循环里 `if (!bottomBarChecked) {` 前面：

```ts
        if (!bottomBarChecked) {
          if (await acquireLock()) {
            try { await runTask('ensure-bottom-bar'); bottomBarChecked = true; }
            finally { releaseLock(); }
          }
        }
```

把整段改为：

```ts
        if (offlineActive) { await sleep(30); continue; }

        if (!bottomBarChecked) {
          if (await acquireLock()) {
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            try { await runTask('ensure-bottom-bar'); bottomBarChecked = true; }
            finally { releaseLock(); }
          }
        }
```

主循环的核心 OCR 派发段（找 `// 获取设备锁，执行 OCR + 派发`）：

```ts
        if (loopStopped) break;
        if (!await acquireLock()) {
          if (loopStopped) break;
          continue;
        }
        try {
```

替换为：

```ts
        if (loopStopped) break;
        if (!await acquireLock()) {
          if (loopStopped) break;
          continue;
        }
        if (offlineActive) { releaseLock(); await sleep(30); continue; }
        try {
```

主循环里的 idle-drag（约 1128 行 `if (await acquireLock()) {` 这种简单 if 结构）—— 它本来不需要在 offlineActive 时跑，因为外层 while 入口已经守卫了；不需要额外加守卫 ②。**但**：如果在 `await sleep(s)` 期间 offlineActive 翻 true，idle-drag 的 acquireLock 也会等住。简单处理：把所有此类 `if (await acquireLock()) { try { await runTask('idle-drag'); ... } }` 改为：

```bash
grep -n "await runTask('idle-drag')" D:/SLG/web/src/pages/Home.tsx
```

每个匹配位置原代码形如：

```ts
              if (await acquireLock()) {
                try { await runTask('idle-drag'); } catch {} finally { releaseLock(); }
              }
```

替换为：

```ts
              if (await acquireLock()) {
                if (offlineActive) { releaseLock(); }
                else { try { await runTask('idle-drag'); } catch {} finally { releaseLock(); } }
              }
```

或更紧凑的等价版本（如果你偏好）：

```ts
              if (await acquireLock()) {
                try { if (!offlineActive) await runTask('idle-drag'); } catch {} finally { releaseLock(); }
              }
```

整个 Home.tsx 中应有 3 处 idle-drag 调用（探索模式 + 喊话模式 + 主循环 dragWindow）—— 全部改。

`explore` 和 `send-world-chat` 调用同理：

```bash
grep -n "await runTask('explore'\|await runTask('send-world-chat'" D:/SLG/web/src/pages/Home.tsx
```

每个位置原代码：

```ts
            if (await acquireLock()) {
              try { await runTask('explore', { maxScouts: features.exploreCount }); }
              finally { releaseLock(); }
            }
```

替换为：

```ts
            if (await acquireLock()) {
              try { if (!offlineActive) await runTask('explore', { maxScouts: features.exploreCount }); }
              finally { releaseLock(); }
            }
```

send-world-chat 同样处理（注意保留它原本的 message 参数）：

```ts
              if (await acquireLock()) {
                try { if (!offlineActive) await runTask('send-world-chat', { message: messages[i], isFirst: i === 0 && true }); }
                finally { releaseLock(); }
              }
```

- [ ] **Step 7: 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: zero output

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): 全部子循环加 offlineActive 双重守卫"
```

---

## Task 10: Home.tsx — 宝石 active/rest 重构（普通+专注共用）

**Files:**
- Modify: `D:\SLG\web\src\pages\Home.tsx`

- [ ] **Step 1: 定位宝石子循环**

```bash
grep -n "宝石采集独立循环" D:/SLG/web/src/pages/Home.tsx
```

定位到 `(async () => { let first = true; let localInitialCount: number | null = null;` 那段（原约 641-820 行）。**整段宝石 IIFE 替换。** 先备份当前文件确保看清楚结构：

```bash
grep -n "宝石采集独立循环\|城外采集独立循环\|帮助盟友独立循环" D:/SLG/web/src/pages/Home.tsx
```

宝石 IIFE 起始于 `// 宝石采集独立循环` 注释，结束于 IIFE 的 `})();`。结尾处看 `setGemRestCountdown('');` 加 `await sleep(1)` 加 `}` 加 `}` 加 `})();` —— 即下一个独立 IIFE 之前。

- [ ] **Step 2: 替换为统一 active/rest 框架**

把整个宝石 IIFE 替换为：

```ts
      // 宝石采集独立循环（普通+专注共用 active/rest 轮替）
      (async () => {
        let first = true;
        let localInitialCount: number | null = null;

        const readCount = async (): Promise<number | null> => {
          try {
            const res = await api.tasks.create(currentAccountId, 'com.rok.automation', 'read-gem-count');
            if (!res.success) { console.error('[readCount] create failed', res); return null; }
            const run = await api.tasks.run(res.task.id);
            const logs = run.task?.logs ?? [];
            const line = logs.find((l: string) => /\[GEM-COUNT\]\s+\d+/.test(l));
            if (!line) return null;
            const m = line.match(/\[GEM-COUNT\]\s+(\d+)/);
            return m ? parseInt(m[1], 10) : null;
          } catch (e) { console.error('[readCount] error:', e); return null; }
        };

        while (!loopStopped) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }

          const f = featuresRef.current;
          if (!f.gemGatherEnabled || f.gemGatherTeams.length === 0 || f.autoExplore || f.autoWorldChat) {
            await sleep(30); continue;
          }

          // ── 读取初始宝石数（首次进入或被 reset 后）──
          if (localInitialCount === null) {
            const count = await readCount();
            if (count !== null) {
              localInitialCount = count;
              moduleGemInitialCount = count;
              moduleGemCollectedCount = 0;
              setGemInitialCount(count);
              setGemCollectedCount(0);
            }
          }

          const activeHours = Number(f.gemGatherActiveHours) || 2;
          const restHours = Number(f.gemGatherRestHours) || 1;
          const isFocus = f.gemGatherFocusMode;
          const actionId = isFocus ? 'gem-gather-focus' : 'gem-gather';
          const intervalSec = isFocus ? 60 : 300;

          // ── active 阶段 ──
          const activeEnd = Date.now() + activeHours * 3600 * 1000;
          setGemRestCountdown('');
          setLogs(prev => [...prev,
            `[${new Date().toLocaleTimeString()}] 💎 ${isFocus ? '专注' : '普通'}采集开始，持续 ${activeHours}h`]);

          while (!loopStopped && Date.now() < activeEnd) {
            if (offlineActive) { await sleep(30); continue; }
            if (!await acquireLock()) break;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            try {
              const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', actionId, { teams: f.gemGatherTeams });
              if (createResult.success) {
                runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const runResult = await api.tasks.run(createResult.task.id);
                runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const logs = runResult.task?.logs ?? [];
                const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
                if (hasExpiredLog) {
                  setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⛔ 许可证已到期，停止运行`]);
                  loopStopped = true;
                  setExpiredMessage('激活码已到期，请重新激活');
                  refreshStatus();
                } else {
                  setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 💎 宝石采集${isFocus ? '(专注)' : ''}完成`]);
                }
              }

              const current = await readCount();
              if (current !== null && localInitialCount !== null) {
                moduleGemCollectedCount = Math.max(0, current - localInitialCount);
                setGemCollectedCount(moduleGemCollectedCount);
                setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 💎 已采集: ${moduleGemCollectedCount} 颗`]);
              }
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
      })();
```

- [ ] **Step 3: 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: zero output

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "refactor(home): 宝石普通+专注模式共用 active/rest 主循环"
```

---

## Task 11: Home.tsx — Banner 新增夜间模式勾选框

**Files:**
- Modify: `D:\SLG\web\src\pages\Home.tsx`

- [ ] **Step 1: 在 banner 右侧操作区插入勾选框**

定位：

```bash
grep -n "deviceConnected ? '设备已连接' : '未连接设备'" D:/SLG/web/src/pages/Home.tsx
```

往下翻 3-5 行，找到外层 `<div className="flex items-center gap-3">`（这个 div 包住"开始运行"按钮）。**在此 div 的第一个子元素之前**（即开 div 标签紧随其后）插入：

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

完整上下文应类似（修改前）：

```tsx
          </div>
          <div className="flex items-center gap-3">
            {!deviceConnected ? (
              <button
                onClick={handleConnectDevice}
```

修改后：

```tsx
          </div>
          <div className="flex items-center gap-3">
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
            {!deviceConnected ? (
              <button
                onClick={handleConnectDevice}
```

- [ ] **Step 2: 编译检查**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: zero output

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): banner 新增夜间下线勾选框"
```

---

## Task 12: 最终验证

**Files:** （只读，无修改）

- [ ] **Step 1: 全工程编译**

```bash
cd D:/SLG && npx tsc --noEmit -p tsconfig.json
```

Expected: zero output

- [ ] **Step 2: 后端启动**

```bash
cd D:/SLG && npm run server
```

Expected: 看到 "Server listening on :3000"，无报错。Ctrl+C 停掉。

- [ ] **Step 3: 前端启动**

```bash
cd D:/SLG/web && npm run dev
```

Expected: Vite 启动，URL 输出。打开浏览器 → Home 页面：
- banner 不再有"循环间隔: [输入框] 秒"
- 副标题不再有"· 循环间隔 X 秒"，只显示"设备已连接"或"未连接设备"
- 连接设备后，按钮左侧出现 "🌙 夜间下线 02-05点" 勾选框
- hover 勾选框出现 tooltip

- [ ] **Step 4: 人工 UI 验证（用户跑模拟器）**

仅文档化，不在 plan 阶段强制：

1. 启动 loop，nightMode 开 → 改本地系统时间到 1:59 → 等到 2:00 → 应触发 kill-game task，日志出现 "🌙 进入下线状态（夜间）"，应能看到游戏被强关
2. 系统时间改到 4:59 → 等到 5:00 → 应触发 launch-game task，日志出现 "☀️ 恢复上线状态"，游戏被启动 → 点屏幕中心 → 等加载
3. 不到夜间，启动宝石普通模式（active=0.05h, rest=0.05h，约 3 分钟切换） → rest 阶段 → 监控器应触发 kill；rest 结束 → launch
4. 不到夜间，启动宝石专注模式（active=0.05h, rest=0.05h） → 同上轨迹（active 阶段调 gem-gather-focus，rest 阶段游戏被 kill）
5. 夜间窗口 + 宝石休息重叠 → 进入夜间触发 kill 一次，宝石休息开始/结束不重复 kill/launch；夜间结束 + 宝石休息已结束 → launch 一次
6. 验证夜间下线期间，建造/采集/协助/城寨/洞窟等子循环都跳过

- [ ] **Step 5: 查看本次提交链**

```bash
git log --oneline HEAD~12..HEAD
```

Expected: 看到 12 个 commit，按 Task 顺序：
1. feat(device): AdbDevice 暴露 execShell
2. feat(plugin): PluginContext 暴露 execShell
3. feat(rok): kill-game action
4. feat(rok): launch-game action
5. feat(rok): 注册两个 action
6. feat(home-features): nightMode + 删除 loopInterval
7. refactor(home): 城外采集间隔常量化
8. feat(home): 下线监控子循环
9. feat(home): 全部子循环加守卫
10. refactor(home): 宝石 active/rest 重构
11. feat(home): banner 夜间下线勾选框
12. （无第 12 commit；第 12 task 是验证）

- [ ] **Step 6: 标记完成**

无需 commit。所有 task 完成。

---

## Spec 覆盖自查

| Spec 条目 | 实施 task |
|---|---|
| killGame action（PACKAGE_NAME, am force-stop, log）| Task 3 |
| launchGame action（monkey + sleep10 + tap(800,450) + sleep20）| Task 4 |
| PluginContext.execShell | Task 2 |
| AdbDevice public execShell | Task 1 |
| HomeFeatures 新增 nightMode | Task 6 |
| HomeFeatures 删除 loopInterval | Task 6 |
| 城外采集 loopInterval 常量化 | Task 7 |
| Banner 删除"循环间隔"输入框 + 副标题文字 | Task 7 |
| 模块级 offlineActive / lastOfflineState / moduleGemRestActive | Task 8 |
| 下线监控子循环（边沿触发 kill/launch）| Task 8 |
| 子循环双重守卫（gather/help/collect/rally/cave/main + idle-drag/explore/world-chat）| Task 9 |
| 宝石普通+专注 active/rest 共用主循环 | Task 10 |
| Banner 新增夜间下线勾选框 + tooltip | Task 11 |
| 注册 kill-game / launch-game | Task 5 |
| 编译 + 后端 + 前端验证 | Task 12 |
