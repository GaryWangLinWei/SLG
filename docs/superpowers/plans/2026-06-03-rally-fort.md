# Auto Rally Barbarian Fort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement "自动攻打城寨" feature — search world map for barbarian forts, start rallies with configured teams.

**Architecture:** New `rallyFort.ts` action with 8-step flow (switch to world → pinch zoom → spiral search → OCR level → rally → confirm → team → march). Independent loop in Home.tsx with 10min CD. Reuses gatherResources team selection logic and AdbDevice for pinch zoom.

**Tech Stack:** TypeScript, ADB (motionevent for multi-touch pinch), existing Vision/OCR infrastructure.

---

### Task 1: Device + PluginContext — pinch zoom support

**Files:**
- Modify: `core/device/Device.ts:13` (add method signature)
- Modify: `core/device/AdbDevice.ts` (add implementation)
- Modify: `core/plugin/PluginContext.ts` (add wrapper)

- [ ] **Step 1: Add `pinch` method signature to Device interface**

Open `core/device/Device.ts`. Add after line 13 (`swipe`):
```typescript
  pinch(x1: number, y1: number, x2: number, y2: number, toX1: number, toY1: number, toX2: number, toY2: number, duration?: number): Promise<void>;
```

- [ ] **Step 2: Implement `pinch` in AdbDevice**

Open `core/device/AdbDevice.ts`. Add the method after `swipe` (after line ~220):

```typescript
  async pinch(x1: number, y1: number, x2: number, y2: number, toX1: number, toY1: number, toX2: number, toY2: number, duration: number = 500): Promise<void> {
    const steps = 10;
    const stepDuration = Math.floor(duration / steps);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx1 = Math.round(x1 + (toX1 - x1) * t);
      const cy1 = Math.round(y1 + (toY1 - y1) * t);
      const cx2 = Math.round(x2 + (toX2 - x2) * t);
      const cy2 = Math.round(y2 + (toY2 - y2) * t);
      if (i === 0) {
        // First frame: touch down both pointers
        await this.execAsync(`"${getAdbPath()}" -s ${this.deviceId} shell motionevent DOWN ${cx1} ${cy1}`);
        await this.execAsync(`"${getAdbPath()}" -s ${this.deviceId} shell motionevent POINTER_DOWN 1 ${cx2} ${cy2}`);
      } else if (i === steps) {
        // Last frame: lift both pointers
        await this.execAsync(`"${getAdbPath()}" -s ${this.deviceId} shell motionevent POINTER_UP 1 ${cx2} ${cy2}`);
        await this.execAsync(`"${getAdbPath()}" -s ${this.deviceId} shell motionevent UP ${cx1} ${cy1}`);
      } else {
        // Move both pointers
        await this.execAsync(`"${getAdbPath()}" -s ${this.deviceId} shell motionevent MOVE ${cx1} ${cy1} ${cx2} ${cy2}`);
      }
      if (i < steps) await this.sleep(stepDuration / 1000);
    }
  }
```

- [ ] **Step 3: Add `pinch` wrapper in PluginContext**

Open `core/plugin/PluginContext.ts`. Add after `swipe` method (after line 143):
```typescript
  async pinch(x1: number, y1: number, x2: number, y2: number, toX1: number, toY1: number, toX2: number, toY2: number, duration: number = 500): Promise<void> {
    this.checkCancellation();
    await this.device.pinch(x1, y1, x2, y2, toX1, toY1, toX2, toY2, duration);
  }
```

- [ ] **Step 4: Compile check**

Run: `npx tsc --noEmit 2>&1`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add core/device/Device.ts core/device/AdbDevice.ts core/plugin/PluginContext.ts
git commit -m "feat: add pinch zoom support to Device/PluginContext"
```

---

### Task 2: homeFeatures.ts — rally fort fields

**Files:**
- Modify: `plugins/rok/homeFeatures.ts`

- [ ] **Step 1: Add rally fort fields to HomeFeatures interface**

Add after `helpTeammates: boolean`:
```typescript
  autoRallyFort: boolean;
  rallyFortTasks: { level: number; team: number }[];
  rallyFortInterval: number;
```

- [ ] **Step 2: Add defaults to DEFAULT_HOME_FEATURES**

Add after `helpTeammates: false`:
```typescript
  autoRallyFort: false,
  rallyFortTasks: [
    { level: 5, team: 1 },
    { level: 5, team: 2 },
    { level: 5, team: 3 },
    { level: 5, team: 4 },
    { level: 5, team: 5 },
  ],
  rallyFortInterval: 600,
```

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit 2>&1`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add plugins/rok/homeFeatures.ts
git commit -m "feat: add autoRallyFort fields to HomeFeatures"
```

---

### Task 3: RallyFort action — core implementation

**Files:**
- Create: `plugins/rok/actions/rallyFort.ts`

- [ ] **Step 1: Create rallyFort.ts with full implementation**

```typescript
import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fs from 'fs/promises';

const TEMPLATE_DIR = getTemplatesDir();
const CHENG_ZHAI_TEMPLATE = path.join(TEMPLATE_DIR, 'ChengZhai.png');
const JIJIE_TEMPLATE = path.join(TEMPLATE_DIR, 'JiJie.png');

// 队伍选择坐标（复用 gatherResources）
const SELECT_TEAM_BUTTON = { x: 1259, y: 180 };
const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 292 }, 2: { x: 1378, y: 359 },
  3: { x: 1378, y: 430 }, 4: { x: 1378, y: 499 }, 5: { x: 1378, y: 565 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 328 }, 2: { x: 1378, y: 392 },
  3: { x: 1378, y: 465 }, 4: { x: 1378, y: 529 }, 5: { x: 1378, y: 595 },
};
const MARCH_BUTTON = { x: 1154, y: 791 };
const CLOSE_POPUP_BUTTON = { x: 1392, y: 57 };
const CONFIRM_TIME_BUTTON = { x: 1177, y: 396 };

// 螺旋搜索参数
const SEARCH_MAX_ATTEMPTS = 20;
const SPIRAL_SWIPE_LENGTH = 600; // 每次滑动像素
const SPIRAL_DIRECTIONS = [
  { dx: 1, dy: 0 },   // 右
  { dx: 0, dy: 1 },   // 下
  { dx: -1, dy: 0 },  // 左
  { dx: 0, dy: -1 },  // 上
];

export interface RallyFortOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;
  foundLevel?: number;
}

export async function rallyFort(
  ctx: PluginContext,
  config: RokConfig,
  targetLevel: number,
  team: number
): Promise<RallyFortOutcome> {
  ctx.log(`=== 自动攻打城寨 Lv.${targetLevel} 队伍${team} ===`);

  // [1/8] 确保在城外
  ctx.log('  [1/8] 确保在城外');
  await ensureInWorld(ctx, config);

  // [2/8] 缩小地图（双指捏合）
  ctx.log('  [2/8] 缩小地图');
  await ctx.pinch(
    300, 960, 780, 960,   // 两指从左右往中间捏
    500, 960, 580, 960,
    800
  );
  await ctx.sleep(1);

  // [3/8] 螺旋搜索城寨
  ctx.log(`  [3/8] 螺旋搜索 Lv.${targetLevel} 城寨（上限 ${SEARCH_MAX_ATTEMPTS} 次）`);
  let fortFound = false;
  let fortX = 0;
  let fortY = 0;
  let foundLevel = 0;

  const screenX = 540;  // 屏幕中心
  const screenY = 960;

  let armLength = 0;  // 当前螺旋臂长（每完成一圈递增）
  let attempt = 0;

  for (; attempt < SEARCH_MAX_ATTEMPTS && !fortFound; attempt++) {
    // 截图搜索城寨图标
    const result = await ctx.findImageWithLocation(CHENG_ZHAI_TEMPLATE, 0.7, [0.7, 0.8, 0.9, 1.0, 1.1]);

    if (result.found) {
      fortX = result.x;
      fortY = result.y;
      ctx.log(`  找到城寨图标 (${fortX}, ${fortY}) confidence: ${result.confidence.toFixed(3)}`);

      // [4/8] OCR 识别等级
      const ocrX = fortX - 15;
      const ocrY = fortY + 12;
      const ocrRegionPath = await ctx.captureRegion(ocrX, ocrY, 30, 13);
      const ocrText = await ocrService.readText(ocrRegionPath);
      await fs.unlink(ocrRegionPath).catch(() => {});
      ctx.log(`  [4/8] OCR 识别等级: "${ocrText}" (区域: ${ocrX},${ocrY} 30x13)`);

      // 解析 OCR 结果
      const levelMatch = ocrText.match(/(\d+)/);
      if (levelMatch) {
        foundLevel = parseInt(levelMatch[1], 10);
        ctx.log(`  识别到 Lv.${foundLevel} 城寨`);
        if (foundLevel === targetLevel) {
          fortFound = true;
          ctx.log(`  等级匹配 Lv.${targetLevel}，选择该城寨`);
        } else {
          ctx.log(`  等级不匹配（期望 Lv.${targetLevel}，实际 Lv.${foundLevel}），跳过`);
        }
      } else {
        ctx.log(`  OCR 未识别到数字，跳过`);
      }
    }

    if (!fortFound && attempt < SEARCH_MAX_ATTEMPTS - 1) {
      // 螺旋滑动
      const dir = SPIRAL_DIRECTIONS[attempt % 4];
      const armLen = SPIRAL_SWIPE_LENGTH * (Math.floor(attempt / 4) + 1);
      const fromX = screenX;
      const fromY = screenY;
      const toX = screenX + dir.dx * armLen;
      const toY = screenY + dir.dy * armLen;
      ctx.log(`  未找到，滑动 ${dir.dx>0?'→':dir.dx<0?'←':dir.dy>0?'↓':'↑'} ${armLen}px (${attempt + 1}/${SEARCH_MAX_ATTEMPTS})`);
      await ctx.swipe(fromX, fromY, toX, toY, 500);
      await ctx.sleep(1);
    }
  }

  if (!fortFound) {
    ctx.log(`  ❌ 搜索 ${attempt} 次后未找到 Lv.${targetLevel} 城寨`);
    return { result: 'not_found', dispatched: 0, foundLevel };
  }

  // 点击城寨
  ctx.log(`  点击城寨 (${fortX}, ${fortY})`);
  await ctx.tap(fortX, fortY);
  await ctx.sleep(2);

  // [5/8] 识别并点击集结按钮
  ctx.log('  [5/8] 识别集结按钮');
  const jijieResult = await ctx.findImageWithLocation(JIJIE_TEMPLATE, 0.7);
  if (!jijieResult.found) {
    ctx.log(`  ❌ 未找到集结按钮 (confidence: ${jijieResult.confidence.toFixed(3)})`);
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);
    return { result: 'not_found', dispatched: 0, foundLevel };
  }
  ctx.log(`  点击集结按钮 (${jijieResult.x}, ${jijieResult.y})`);
  await ctx.tap(jijieResult.x, jijieResult.y);
  await ctx.sleep(1.5);

  // [6/8] 确认集结时间
  ctx.log(`  [6/8] 确认集结时间 (${CONFIRM_TIME_BUTTON.x}, ${CONFIRM_TIME_BUTTON.y})`);
  await ctx.tap(CONFIRM_TIME_BUTTON.x, CONFIRM_TIME_BUTTON.y);
  await ctx.sleep(1);

  // [7/8] 选队
  ctx.log(`  [7/8] 点击选择队伍按钮 (${SELECT_TEAM_BUTTON.x}, ${SELECT_TEAM_BUTTON.y})`);
  await ctx.tap(SELECT_TEAM_BUTTON.x, SELECT_TEAM_BUTTON.y);
  await ctx.sleep(1);

  // 检测分页
  const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');
  const hasPaging = await ctx.findImage(PAGE_INDICATOR_TEMPLATE, 0.8);
  ctx.log(`  [检测] 换页按钮: ${hasPaging ? '存在 (>7组)' : '不存在 (≤7组)'}`);

  const teamButtons = hasPaging ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
  const teamBtn = teamButtons[team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${team}`);
    return { result: 'team_unavailable', dispatched: 0, foundLevel };
  }

  ctx.log(`  [8/8] 选择队伍 ${team} 并检测状态变化...`);
  const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
  ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

  if (!stateResult.changed) {
    ctx.log(`  ⚠️ 队伍${team}不可用，按钮无选中状态变化，跳过`);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    return { result: 'team_unavailable', dispatched: 0, foundLevel };
  }

  // [9/8] 点击行军
  ctx.log(`  [9/9] 点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
  await ctx.tap(MARCH_BUTTON.x, MARCH_BUTTON.y);
  await ctx.sleep(1);

  ctx.log(`  ✅ 队伍${team} 已发起 Lv.${foundLevel} 城寨集结`);
  return { result: 'success', dispatched: 1, foundLevel };
}
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit 2>&1`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add plugins/rok/actions/rallyFort.ts
git commit -m "feat: add rally-fort action with spiral search and OCR level detection"
```

---

### Task 4: Register rally-fort action in ROK plugin

**Files:**
- Modify: `plugins/rok/index.ts`

- [ ] **Step 1: Import rallyFort**

Add after line 9 (`helpTeammates` import):
```typescript
import { rallyFort } from './actions/rallyFort';
```

- [ ] **Step 2: Register action**

Add after the `read-queue-overview` action block (after line 499):
```typescript
    {
      id: 'rally-fort',
      name: '攻打城寨',
      description: '搜索野蛮人城寨并发起集结',
      run: async (ctx, params: { level?: number; team?: number } = {}) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const level = params.level || 5;
        const team = params.team || 1;
        const outcome = await rallyFort(ctx, config, level, team);
        ctx.log(`城寨集结: Lv.${outcome.foundLevel || level} 队伍${team} → ${outcome.result}`);
      }
    },
```

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit 2>&1`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add plugins/rok/index.ts
git commit -m "feat: register rally-fort action in ROK plugin"
```

---

### Task 5: Home.tsx — rally loop + UI card

**Files:**
- Modify: `web/src/pages/Home.tsx`

This task has two parts: (A) rally loop in handleStartAll, (B) UI card replacing placeholder.

- [ ] **Step 1: Add rallyFortLoop inside handleStartAll**

After the existing `collectLoop` block (after `await Promise.all([helpLoop, collectLoop, gatherLoop])` on line 826), add the rallyLoop before the Promise.all:

Add this block right after `collectLoop` definition (after line ~501) and before the main `while (!loopStopped)` loop:

```typescript
// 攻打城寨独立循环 — 每 10min
const rallyLoop = (async () => {
  let first = true;
  while (!loopStopped) {
    if (first) { first = false; await sleep(10); continue; }
    if (features.autoRallyFort) {
      const tasks = features.rallyFortTasks
        .map((t: { level: number; team: number }, i: number) => ({ ...t, team: i + 1 }))
        .filter((t: { level: number; team: number }) => t.level > 0);
      if (tasks.length > 0) {
        for (const task of tasks) {
          if (loopStopped) break;
          if (!await acquireLock()) break;
          try {
            const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', 'rally-fort', { level: task.level, team: task.team });
            if (createResult.success) {
              runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
              setRunningTaskIds([...runningTaskIdsRef.current]);
              const runResult = await api.tasks.run(createResult.task.id);
              runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
              setRunningTaskIds([...runningTaskIdsRef.current]);

              if (runResult.task?.status === 'stopped') {
                loopStopped = true;
                setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏹️ ${createResult.task.actionId} 已被停止`]);
                return;
              }

              const logs = runResult.task?.logs ?? [];
              const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
              if (hasExpiredLog) {
                setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⛔ 许可证已到期，停止运行`]);
                loopStopped = true;
                setExpiredMessage('激活码已到期，请重新激活');
                refreshStatus();
              } else {
                setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ 城寨 Lv.${task.level} 队伍${task.team} 完成`]);
              }
            }
          } catch {} finally { releaseLock(); }
        }
        if (loopStopped) break;
        const cd = features.rallyFortInterval || 600;
        const cdJitter = cd * (0.85 + Math.random() * 0.3);
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🏰 城寨一轮完成，${cdJitter.toFixed(0)} 秒后下一轮`]);
        const startWait = Date.now();
        while (!loopStopped && (Date.now() - startWait) < cdJitter * 1000) {
          await sleep(1);
        }
      }
    } else {
      // 未开启城寨功能，长时间休眠避免空转
      await sleep(60);
    }
  }
})();
```

- [ ] **Step 2: Add rallyLoop to Promise.all**

Change the existing line:
```typescript
await Promise.all([helpLoop, collectLoop, gatherLoop]);
```
To:
```typescript
await Promise.all([helpLoop, collectLoop, gatherLoop, rallyLoop]);
```

- [ ] **Step 3: Replace the placeholder UI card**

Find the placeholder card (the `自动攻打城寨 — coming soon` section starting around line 1204). Replace the entire block:

```tsx
{/* 自动攻打城寨 */}
<div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${features.autoRallyFort ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-slate-300'}`}>
  <div className="flex items-center justify-between">
    <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-base">🏰</span>自动攻打城寨</span>
    <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
      <input type="checkbox" checked={features.autoRallyFort}
        onChange={(e) => setFeatures({ ...features, autoRallyFort: e.target.checked })}
        className="sr-only" />
      <span className={`absolute inset-0 rounded-full transition-colors ${features.autoRallyFort ? 'bg-purple-500' : 'bg-slate-200'}`} />
      <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoRallyFort ? 'translate-x-[18px]' : ''}`} />
    </label>
  </div>
  <div className="flex flex-col gap-2 mt-2">
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-slate-400">队伍配置（等级 + 队伍编号）</span>
      {features.rallyFortTasks.map((task: { level: number; team: number }, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-slate-400 w-8">#{i + 1}</span>
          <select value={task.level} disabled={features.autoRallyFort}
            onChange={(e) => {
              const next = [...features.rallyFortTasks];
              next[i] = { ...next[i], level: Number(e.target.value) };
              setFeatures({ ...features, rallyFortTasks: next });
            }}
            className="px-2 py-1 bg-white border border-slate-200 rounded text-xs w-20">
            {[1,2,3,4,5,6,7,8,9,10].map(l => (<option key={l} value={l}>Lv.{l}</option>))}
          </select>
          <span className="text-xs text-slate-400">队伍</span>
          <select value={task.team} disabled={features.autoRallyFort}
            onChange={(e) => {
              const next = [...features.rallyFortTasks];
              next[i] = { ...next[i], team: Number(e.target.value) };
              setFeatures({ ...features, rallyFortTasks: next });
            }}
            className="px-2 py-1 bg-white border border-slate-200 rounded text-xs w-16">
            {[1,2,3,4,5].map(t => (<option key={t} value={t}>{t}</option>))}
          </select>
        </div>
      ))}
    </div>
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 whitespace-nowrap">循环间隔（秒）</span>
      <input type="number" value={features.rallyFortInterval} min={60}
        onChange={(e) => setFeatures({ ...features, rallyFortInterval: Math.max(60, Number(e.target.value)) })}
        disabled={features.autoRallyFort}
        className="w-20 px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700 focus:outline-none focus:border-purple-500 disabled:opacity-50" />
    </div>
  </div>
  <p className="text-xs text-slate-400 mt-1.5">需标记城寨图标模板和集结按钮模板</p>
</div>
```

- [ ] **Step 4: Update loadFeatures migration to include rally fields**

In the `loadFeatures` function (around line 138-158), ensure rally fort defaults are merged:
```typescript
// Already handled by ...DEFAULT_FEATURES spread, but verify rallyFortTasks
// is an array (migration from older saved state)
if (!Array.isArray(merged.rallyFortTasks) || merged.rallyFortTasks.length !== 5) {
  merged.rallyFortTasks = DEFAULT_FEATURES.rallyFortTasks;
}
```

- [ ] **Step 5: Compile check**

Run: `cd web && npx tsc --noEmit 2>&1`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: add rally fort loop and UI card to Home page"
```

---

### Task 6: Final verification

- [ ] **Step 1: Full TypeScript compile**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1`
Expected: All tests pass (ignore pre-existing AdbDevice screenshot test failure).

- [ ] **Step 3: Vite build**

Run: `cd web && npm run build 2>&1`
Expected: Build succeeds.

- [ ] **Step 4: Commit final verification**

```bash
git add -A
git commit -m "chore: final verification for rally fort feature"
```

---

## Self-Review

1. **Spec coverage:** All spec requirements mapped to tasks:
   - homeFeatures fields → Task 2
   - rally-fort action (8 steps) → Task 3
   - Pinch zoom → Task 1
   - Register action → Task 4
   - Home.tsx loop + UI → Task 5
   - Verification → Task 6

2. **No placeholders:** All coordinates, file paths, and code are concrete.

3. **Type consistency:** `RallyFortOutcome` used consistently. `rallyFortTasks` array has `{ level: number, team: number }` shape across all tasks.
