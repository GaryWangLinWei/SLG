# 宝石采集（gatherGem）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建宝石采集功能，使用图像识别 + 螺旋搜索在世界地图上寻找宝石矿并派出勾选的队伍采集。

**Architecture:** 新建 `gatherGem.ts` action 文件，复用原始 rallyFort 的螺旋搜索骨架 + gatherResources 的后半段队伍选择/行军逻辑。前端将"即将上线"占位替换为功能卡片（开关 + 5 队复选框）。

**Tech Stack:** TypeScript (Node.js backend + React frontend), sharp 图像处理

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `plugins/rok/actions/gatherGem.ts` | 新建 | 宝石采集完整流程 [1/7]~[7/7] |
| `plugins/rok/homeFeatures.ts` | 修改 | 新增 gemGatherEnabled、gemGatherTeams |
| `plugins/rok/index.ts` | 修改 | 新增 gemGather 配置段 + 注册 gem-gather action |
| `web/src/pages/Home.tsx` | 修改 | 替换 coming-soon 卡片 + 新增 gem loop |
| `plugins/rok/templates/baoshi.png` | 新建 | 宝石矿地图图标模板（待用户截取） |

---

### Task 1: homeFeatures.ts — 新增 gemGatherEnabled、gemGatherTeams

**Files:**
- Modify: `plugins/rok/homeFeatures.ts`

- [ ] **Step 1: 新增字段到 HomeFeatures 接口**

在 `HomeFeatures` 接口中 `rallyFortDowngrade` 后新增：

```typescript
gemGatherEnabled: boolean;
gemGatherTeams: number[];
```

- [ ] **Step 2: 新增默认值到 DEFAULT_HOME_FEATURES**

在 `DEFAULT_HOME_FEATURES` 中 `rallyFortDowngrade: true,` 后新增：

```typescript
gemGatherEnabled: false,
gemGatherTeams: [1],
```

- [ ] **Step 3: Commit**

```bash
git add plugins/rok/homeFeatures.ts
git commit -m "feat: add gemGatherEnabled and gemGatherTeams to HomeFeatures"
```

---

### Task 2: gatherGem.ts — 新建宝石采集 action

**Files:**
- Create: `plugins/rok/actions/gatherGem.ts`
- Need: `plugins/rok/templates/baoshi.png`（用户提供）

- [ ] **Step 1: 创建文件并导入依赖**

```typescript
import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

const TEMPLATE_DIR = getTemplatesDir();
const ADD_TEAM_BTN_TEMPLATE = path.join(TEMPLATE_DIR, 'AddTeamBtn.png');
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');

// 队伍选择坐标（复用 gatherResources）
const SELECT_TEAM_BUTTON = { x: 1259, y: 180 };
const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 292 },
  2: { x: 1378, y: 359 },
  3: { x: 1378, y: 430 },
  4: { x: 1378, y: 499 },
  5: { x: 1378, y: 565 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 328 },
  2: { x: 1378, y: 392 },
  3: { x: 1378, y: 465 },
  4: { x: 1378, y: 529 },
  5: { x: 1378, y: 595 },
};
const MARCH_BUTTON = { x: 1154, y: 791 };

// 螺旋搜索参数
const SEARCH_MAX_ATTEMPTS = 20;
const SPIRAL_SWIPE_LENGTH = 600;
const SPIRAL_DIRECTIONS = [
  { dx: 1, dy: 0 },   // 右
  { dx: 0, dy: 1 },   // 下
  { dx: -1, dy: 0 },  // 左
  { dx: 0, dy: -1 },  // 上
];

export interface GemGatherOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;
}
```

- [ ] **Step 2: 实现 dispatchGemTeam 函数（单个队伍派遣）**

```typescript
async function dispatchGemTeam(
  ctx: PluginContext,
  config: RokConfig,
  team: number,
  hasPaging: boolean
): Promise<'success' | 'team_unavailable'> {
  // 点击选择队伍按钮
  await ctx.tap(SELECT_TEAM_BUTTON.x, SELECT_TEAM_BUTTON.y);
  await ctx.sleep(1);

  const teamButtons = hasPaging ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
  const teamBtn = teamButtons[team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${team}`);
    return 'team_unavailable';
  }

  ctx.log(`  选择队伍 ${team} 并检测状态变化...`);
  const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
  ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

  if (!stateResult.changed) {
    ctx.log(`  ⚠️ 队伍${team}不可用，按钮无选中状态变化，跳过`);
    return 'team_unavailable';
  }

  // 点击行军
  await ctx.sleep(0.5);
  ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
  await ctx.tap(MARCH_BUTTON.x, MARCH_BUTTON.y);
  await ctx.sleep(1);

  ctx.log(`  ✅ 队伍${team} 已派出采集宝石矿`);
  return 'success';
}
```

- [ ] **Step 3: 实现 gatherGem 主函数**

```typescript
export async function gatherGem(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[]
): Promise<GemGatherOutcome> {
  ctx.log(`=== 智能采集宝石 队伍[${teams.join(', ')}] ===`);

  const gg = config.gemGather;
  const baoshiTemplate = path.join(TEMPLATE_DIR, gg.baoshiTemplate);
  const caijiBtnTemplate = path.join(TEMPLATE_DIR, gg.caijiBtnTemplate);
  const worldBtn = config.resourceCollect.worldSwitchButton;

  let dispatched = 0;

  for (let teamIdx = 0; teamIdx < teams.length; teamIdx++) {
    const team = teams[teamIdx];
    ctx.log(`--- 派队伍 ${team} (第${teamIdx + 1}/${teams.length}颗矿) ---`);

    // [1/7] 重置城外默认视角
    ctx.log('  [1/7] 重置城外默认视角');
    const { x: wx, y: wy } = worldBtn;
    await ensureInWorld(ctx, config);
    // 已经在 ensureInWorld 后，再确保一次视角重置（已在 ensureInWorld 中处理）

    // [2/7] 缩小地图
    ctx.log('  [2/7] 缩小地图');
    const p = gg.pinch;
    await ctx.pinch(p.from1.x, p.from1.y, p.from2.x, p.from2.y, p.to1.x, p.to1.y, p.to2.x, p.to2.y, p.duration);
    await ctx.sleep(1);

    // [3/7] 螺旋搜索 baoshi.png
    ctx.log(`  [3/7] 螺旋搜索宝石矿（上限 ${SEARCH_MAX_ATTEMPTS} 次）`);
    let gemFound = false;
    let gemX = 0;
    let gemY = 0;
    const screenX = 540;
    const screenY = 960;

    for (let attempt = 0; attempt < SEARCH_MAX_ATTEMPTS && !gemFound; attempt++) {
      const result = await ctx.findImageWithLocation(baoshiTemplate, 0.7, [0.7, 0.8, 0.9, 1.0, 1.1]);

      if (result.found) {
        gemX = result.x;
        gemY = result.y;
        ctx.log(`  找到宝石矿 (${gemX}, ${gemY}) confidence: ${result.confidence.toFixed(3)}`);
        gemFound = true;
      } else if (attempt < SEARCH_MAX_ATTEMPTS - 1) {
        // 螺旋滑动
        const dir = SPIRAL_DIRECTIONS[attempt % 4];
        const armLen = SPIRAL_SWIPE_LENGTH * (Math.floor(attempt / 4) + 1);
        const fromX = screenX;
        const fromY = screenY;
        const toX = screenX + dir.dx * armLen;
        const toY = screenY + dir.dy * armLen;
        ctx.log(`  未找到，滑动 ${dir.dx > 0 ? '→' : dir.dx < 0 ? '←' : dir.dy > 0 ? '↓' : '↑'} ${armLen}px (${attempt + 1}/${SEARCH_MAX_ATTEMPTS})`);
        await ctx.swipe(fromX, fromY, toX, toY, 500);
        await ctx.sleep(1);
      }
    }

    if (!gemFound) {
      ctx.log(`  ❌ 搜索 ${SEARCH_MAX_ATTEMPTS} 次后未找到宝石矿，停止后续队伍`);
      break;
    }

    // [4/7] 点击宝石矿
    ctx.log(`  [4/7] 点击宝石矿 (${gemX}, ${gemY})`);
    await ctx.tap(gemX, gemY);
    await ctx.sleep(1.5);

    // 点击放大后的宝石矿
    ctx.log(`  点击放大后的目标 (${gg.pinchedGemTapPoint.x}, ${gg.pinchedGemTapPoint.y})`);
    await ctx.tap(gg.pinchedGemTapPoint.x, gg.pinchedGemTapPoint.y);
    await ctx.sleep(1);

    // 识别采集按钮
    ctx.log(`  搜索采集按钮 ${gg.caijiBtnTemplate}`);
    const caijiResult = await ctx.findImageWithLocation(caijiBtnTemplate, 0.7);
    if (!caijiResult.found) {
      ctx.log(`  ❌ 未找到采集按钮 (confidence: ${caijiResult.confidence.toFixed(3)})，跳过`);
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(1.5);
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(2);
      continue;
    }
    ctx.log(`  点击采集按钮 (${caijiResult.x}, ${caijiResult.y})`);
    await ctx.tap(caijiResult.x, caijiResult.y);
    await ctx.sleep(1.5);

    // [5/7] 检测空闲队伍
    ctx.log(`  [5/7] 检测是否有空闲队伍...`);
    const { width: addTeamW = 80, height: addTeamH = 80 } = await sharp(ADD_TEAM_BTN_TEMPLATE).metadata();
    const addTeamRegionX = 1517 - Math.floor(addTeamW! / 2);
    const addTeamRegionY = 130 - Math.floor(addTeamH! / 2);
    const addTeamRegionPath = await ctx.captureRegion(addTeamRegionX, addTeamRegionY, addTeamW!, addTeamH!);
    const addTeamDiff = await ctx.compareImages(addTeamRegionPath, ADD_TEAM_BTN_TEMPLATE);
    ctx.log(`  AddTeamBtn 匹对差异: ${(addTeamDiff * 100).toFixed(1)}%`);

    if (addTeamDiff >= 0.3) {
      ctx.log(`  ⚠️ 没有空闲队伍，停止采集，切换回城内`);
      await fs.unlink(addTeamRegionPath).catch(() => {});
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(2);
      break;
    }
    await fs.unlink(addTeamRegionPath).catch(() => {});
    ctx.log(`  有空闲队伍，继续`);

    // [6/7] 检测分页（首次）
    const hasPaging = await ctx.findImage(PAGE_INDICATOR_TEMPLATE, 0.8);
    ctx.log(`  [6/7] 换页按钮: ${hasPaging ? '存在 (>7组)' : '不存在 (≤7组)'}`);

    // [7/7] 选择队伍 + 行军
    ctx.log(`  [7/7] 选择队伍 ${team} 并派出`);
    const outcome = await dispatchGemTeam(ctx, config, team, hasPaging);
    if (outcome === 'success') {
      dispatched++;
      ctx.log(`  ✅ 队伍${team} 已派出采集宝石矿（累计 ${dispatched} 队）`);
    } else {
      ctx.log(`  ⚠️ 队伍${team} 不可用，跳过`);
    }
  }

  ctx.log(`=== 宝石采集完成：派出 ${dispatched} 队 ===`);
  return { result: dispatched > 0 ? 'success' : 'not_found', dispatched };
}
```

- [ ] **Step 4: Commit**

```bash
git add plugins/rok/actions/gatherGem.ts
git commit -m "feat: add gatherGem action with spiral search and multi-team dispatch"
```

---

### Task 3: index.ts — 新增 gemGather 配置段 + 注册 action

**Files:**
- Modify: `plugins/rok/index.ts`

- [ ] **Step 1: 导入 gatherGem**

在文件顶部 import 区域，`import { rallyFort }` 之后新增：

```typescript
import { gatherGem } from './actions/gatherGem';
```

- [ ] **Step 2: 在 RokConfig 接口中新增 gemGather 段**

在 `fortSearch` 段之后（第 115 行 `}` 闭合后），`homeFeatures?: HomeFeatures;` 之前新增：

```typescript
// ========== 宝石采集 ==========
gemGather: {
  baoshiTemplate: string;
  caijiBtnTemplate: string;
  pinchedGemTapPoint: { x: number; y: number };
  pinch: {
    from1: { x: number; y: number };
    from2: { x: number; y: number };
    to1: { x: number; y: number };
    to2: { x: number; y: number };
    duration: number;
  };
  searchMaxAttempts: number;
  spiralSwipeLength: number;
};
```

- [ ] **Step 3: 在 DEFAULT_ROK_CONFIG 中新增 gemGather 默认值**

在 `fortSearch` 默认值之后（第 227 行 `},` 之后），`homeFeatures` 之前新增：

```typescript
// ========== 宝石采集 ==========
gemGather: {
  baoshiTemplate: 'baoshi.png',
  caijiBtnTemplate: 'btn_caiji.png',
  pinchedGemTapPoint: { x: 791, y: 423 },
  pinch: {
    from1: { x: 300, y: 960 },
    from2: { x: 780, y: 960 },
    to1: { x: 500, y: 960 },
    to2: { x: 580, y: 960 },
    duration: 800,
  },
  searchMaxAttempts: 20,
  spiralSwipeLength: 600,
},
```

- [ ] **Step 4: 注册 gem-gather action**

在 `rally-fort` action 定义之后（`},` 之后）新增：

```typescript
{
  id: 'gem-gather',
  name: '智能采集宝石',
  description: '使用图像识别螺旋搜索宝石矿并派出队伍采集',
  run: async (ctx, params: { teams?: number[] } = {}) => {
    const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
    const teams = params.teams || [1];

    // Pre-check: OCR team count
    ctx.log('[预备] OCR 检测空闲队伍数...');
    const regionPath = await ctx.captureRegion(1507, 169, 55, 31);
    const teamCountText = await ocrService.readText(regionPath);
    await fs.unlink(regionPath).catch(() => {});
    ctx.log(`[预备] OCR 结果: "${teamCountText}"`);

    const match = teamCountText.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      const used = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      if (used === total) {
        ctx.log(`⏭️ 无空闲队伍 (${used}/${total})，跳过宝石采集`);
        return;
      }
      ctx.log(`有空闲队伍 (${used}/${total})，继续宝石采集`);
    } else {
      const digitsOnly = teamCountText.replace(/\D/g, '');
      if (digitsOnly.length >= 2 && /^(\d)\1+$/.test(digitsOnly)) {
        ctx.log(`⏭️ 无空闲队伍 (OCR识别为 "${digitsOnly}"，推测全部忙碌)，跳过宝石采集`);
        return;
      }
      ctx.log('⚠️ 未识别到队伍计数，继续宝石采集');
    }

    const outcome = await gatherGem(ctx, config, teams);
    ctx.log(`宝石采集: 队伍[${teams.join(', ')}] → ${outcome.result}，派出 ${outcome.dispatched} 队`);
  }
},
```

- [ ] **Step 5: Commit**

```bash
git add plugins/rok/index.ts
git commit -m "feat: add gemGather config section and gem-gather action registration"
```

---

### Task 4: Home.tsx — 替换 coming-soon 占位 + 新增 gem loop

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 更新 hasAnyFeature 判断**

在第 358 行 `(features.autoRallyFort && features.rallyFortLevel > 0) ||` 之后新增一行：

```typescript
(features.gemGatherEnabled && features.gemGatherTeams.some((t: number) => t)) ||
```

- [ ] **Step 2: 替换 coming-soon 占位卡片**

将第 1337-1347 行的 `<div>` 替换为：

```tsx
{/* 智能采集宝石 */}
<div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border ${features.gemGatherEnabled ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
  <div className="flex items-center justify-between">
    <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-cyan-100 rounded-lg flex items-center justify-center text-base">💎</span>智能采集宝石</span>
    <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
      <input type="checkbox" checked={features.gemGatherEnabled} disabled={features.autoExplore || features.autoWorldChat}
        onChange={(e) => setFeatures({ ...features, gemGatherEnabled: e.target.checked })}
        className="sr-only" />
      <span className={`absolute inset-0 rounded-full transition-colors ${features.gemGatherEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
      <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.gemGatherEnabled ? 'translate-x-[18px]' : ''}`} />
    </label>
  </div>
  <div className="flex items-center gap-2 mt-2">
    <span className="text-xs text-slate-400 whitespace-nowrap">派遣</span>
    {[1,2,3,4,5].map(teamNum => (
      <label key={teamNum} className="flex items-center gap-1 cursor-pointer">
        <input type="checkbox"
          checked={features.gemGatherTeams.includes(teamNum)}
          disabled={features.autoExplore || features.autoWorldChat || !features.gemGatherEnabled}
          onChange={(e) => {
            const next = e.target.checked
              ? [...features.gemGatherTeams, teamNum].sort((a, b) => a - b)
              : features.gemGatherTeams.filter(t => t !== teamNum);
            setFeatures({ ...features, gemGatherTeams: next.length === 0 ? [teamNum] : next });
          }}
          className="sr-only" />
        <span className={`w-6 h-6 rounded flex items-center justify-center text-xs border ${features.gemGatherTeams.includes(teamNum) ? 'bg-cyan-500 border-cyan-600 text-white' : 'bg-white border-slate-200 text-slate-400'} ${!features.gemGatherEnabled ? 'opacity-50' : ''}`}>
          {teamNum}
        </span>
      </label>
    ))}
    <span className="text-xs text-slate-400 whitespace-nowrap">队伍</span>
  </div>
  <p className="text-xs text-slate-400 mt-1.5">选择队伍请勿与采集队伍冲突</p>
</div>
```

- [ ] **Step 3: 新增 gem 独立循环（在 rallyLoop 之后）**

在 rallyLoop 结束后（大约第 581 行 `})();` 之后）新增 gem loop。参照 rallyLoop 的模式：独立循环，每 10 分钟（默认 CD），派完所有勾选队伍后回到主循环等待。

```typescript
// 宝石采集独立循环
const gemLoop = (async () => {
  let first = true;
  while (!loopStopped) {
    if (first) { first = false; await sleep(10); continue; }
    if (features.gemGatherEnabled && features.gemGatherTeams.length > 0) {
      if (loopStopped) break;
      if (!await acquireLock()) break;
      try {
        const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', 'gem-gather', { teams: features.gemGatherTeams });
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
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 💎 宝石采集完成`]);
          }
        }
      } catch {} finally { releaseLock(); }
      if (loopStopped) break;
    }
    const gemInterval = 600 * (0.85 + Math.random() * 0.3);
    const startWait = Date.now();
    while (!loopStopped && (Date.now() - startWait) < gemInterval * 1000) {
      await sleep(1);
    }
  }
})();
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: add gem gather card with team checkboxes and gem loop"
```

---

### Task 5: 编译验证

**Files:**
- Check: 所有修改的文件

- [ ] **Step 1: 编译后端检查**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```
Expected: 无类型错误

- [ ] **Step 2: 编译前端检查**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: compile check passed for gem gather"
```
