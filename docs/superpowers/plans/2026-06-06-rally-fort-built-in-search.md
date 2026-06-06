# 城寨搜索重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 rallyFort action 从图像识别+螺旋搜索改为使用游戏内置城寨搜索面板

**Architecture:** 流程对齐 gatherResources 模式 — 打开搜索面板→切城寨页签→设等级搜索→集结→选队→行军。RokConfig 新增 fortSearch 坐标段，HomeFeatures 新增 rallyFortDowngrade 开关。

**Tech Stack:** TypeScript, React, existing Vision/PluginContext infrastructure

---

## File Map

| 文件 | 改动 |
|------|------|
| `plugins/rok/homeFeatures.ts` | 新增 `rallyFortDowngrade` 字段 |
| `plugins/rok/index.ts` | RokConfig 新增 `fortSearch`；DEFAULT_ROK_CONFIG 新增默认值；rally-fort action 传入 downgrade |
| `plugins/rok/actions/rallyFort.ts` | 完整重写 |
| `web/src/pages/Home.tsx` | 城寨卡片新增降级搜索开关；调用时传 downgrade |

---

### Task 1: homeFeatures.ts — 新增 rallyFortDowngrade 字段

**Files:**
- Modify: `plugins/rok/homeFeatures.ts`

- [ ] **Step 1: 在 HomeFeatures interface 中新增字段**

在 `rallyFortInterval` 后面新增一行:

```typescript
  rallyFortDowngrade: boolean;
```

- [ ] **Step 2: 在 DEFAULT_HOME_FEATURES 中新增默认值**

在 `rallyFortInterval: 600,` 后面新增一行:

```typescript
  rallyFortDowngrade: true,
```

- [ ] **Step 3: Commit**

```bash
git add plugins/rok/homeFeatures.ts
git commit -m "feat: add rallyFortDowngrade field to HomeFeatures"
```

---

### Task 2: RokConfig — 新增 fortSearch 配置段

**Files:**
- Modify: `plugins/rok/index.ts`

- [ ] **Step 1: 在 RokConfig interface 中新增 fortSearch 段**

在 `worldChat` 段之后、`homeFeatures?` 之前插入:

```typescript
  // ========== 城寨搜索 ==========
  fortSearch: {
    searchButton: { x: number; y: number };
    fortTab: { x: number; y: number };
    minusButton: { x: number; y: number };
    plusButton: { x: number; y: number };
    searchActionButton: { x: number; y: number };
    rallyButton: { x: number; y: number };
  };
```

- [ ] **Step 2: 在 DEFAULT_ROK_CONFIG 中新增默认值**

在 `worldChat` 段之后、`homeFeatures` 之前插入:

```typescript
  // ========== 城寨搜索 ==========
  fortSearch: {
    searchButton: { x: 78, y: 677 },
    fortTab: { x: 438, y: 295 },
    minusButton: { x: 121, y: 484 },
    plusButton: { x: 559, y: 481 },
    searchActionButton: { x: 336, y: 593 },
    rallyButton: { x: 1181, y: 615 },
  },
```

- [ ] **Step 3: Commit**

```bash
git add plugins/rok/index.ts
git commit -m "feat: add fortSearch config section to RokConfig"
```

---

### Task 3: rallyFort.ts — 用内置搜索重写

**Files:**
- Modify: `plugins/rok/actions/rallyFort.ts`

- [ ] **Step 1: 读取当前文件确认基准**

Run: `cat plugins/rok/actions/rallyFort.ts | head -5`
确认当前文件是旧版图像识别实现。

- [ ] **Step 2: 完整重写 rallyFort.ts**

```typescript
import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import * as path from 'path';

const TEMPLATE_DIR = getTemplatesDir();
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');

// 队伍选择坐标（复用 gatherResources）
const SELECT_TEAM_BUTTON = { x: 1259, y: 180 };
const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 362 }, 2: { x: 1378, y: 430 },
  3: { x: 1378, y: 497 }, 4: { x: 1378, y: 566 }, 5: { x: 1378, y: 633 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 397 }, 2: { x: 1378, y: 463 },
  3: { x: 1378, y: 533 }, 4: { x: 1378, y: 600 }, 5: { x: 1378, y: 671 },
};
const MARCH_BUTTON = { x: 1154, y: 791 };
const CLOSE_POPUP_BUTTON = { x: 1392, y: 57 };
const CONFIRM_TIME_BUTTON = { x: 1177, y: 396 };

export interface RallyFortOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;
  foundLevel?: number;
}

export async function rallyFort(
  ctx: PluginContext,
  config: RokConfig,
  targetLevel: number,
  team: number,
  downgrade: boolean = true
): Promise<RallyFortOutcome> {
  ctx.log(`=== 自动攻打城寨 Lv.${targetLevel} 队伍${team} ===`);

  const fs = config.fortSearch;
  const worldBtn = config.resourceCollect.worldSwitchButton;

  // [1/7] 确保在城外
  ctx.log('  [1/7] 确保在城外');
  await ensureInWorld(ctx, config);

  // [2/7] 打开搜索面板
  ctx.log(`  [2/7] 打开搜索面板 (${fs.searchButton.x}, ${fs.searchButton.y})`);
  await ctx.tap(fs.searchButton.x, fs.searchButton.y);
  await ctx.sleep(1.5);

  // [3/7] 切换到城寨页签
  ctx.log(`  [3/7] 切换到城寨页签 (${fs.fortTab.x}, ${fs.fortTab.y})`);
  await ctx.tap(fs.fortTab.x, fs.fortTab.y);
  await ctx.sleep(1);

  // [4/7] 设置等级并搜索
  ctx.log(`  [4/7] 设置等级并搜索`);

  // 重置到 1 级：快速点击 - ×9
  ctx.log(`  重置到1级: 快速点击 - ×9`);
  for (let i = 0; i < 9; i++) {
    await ctx.tap(fs.minusButton.x, fs.minusButton.y);
    await ctx.sleep(0.15);
  }

  // 设到目标等级
  let currentLevel = 1;
  let searchSuccess = false;

  const plusClicks = targetLevel - 1;
  if (plusClicks > 0) {
    ctx.log(`  设置 Lv.${targetLevel}: + ×${plusClicks}`);
    for (let i = 0; i < plusClicks; i++) {
      await ctx.tap(fs.plusButton.x, fs.plusButton.y);
      await ctx.sleep(0.15);
    }
  }
  currentLevel = targetLevel;

  // 搜索 + 降级重试
  while (currentLevel >= 1) {
    ctx.log(`  搜索 Lv.${currentLevel} (${fs.searchActionButton.x}, ${fs.searchActionButton.y})`);
    const stateResult = await ctx.checkButtonStateChange(
      fs.searchActionButton.x, fs.searchActionButton.y, 100, 40, 0.05
    );

    if (stateResult.changed) {
      if (currentLevel < targetLevel) {
        ctx.log(`  Lv.${targetLevel} 未搜索到，降级至 Lv.${currentLevel} 搜索成功`);
      }
      searchSuccess = true;
      break;
    }

    if (downgrade && currentLevel > 1) {
      ctx.log(`  Lv.${currentLevel} 未搜索到，降级重试...`);
      await ctx.tap(fs.minusButton.x, fs.minusButton.y);
      await ctx.sleep(0.15);
      currentLevel--;
    } else {
      break;
    }
  }

  if (!searchSuccess) {
    ctx.log(`  ❌ 未搜索到 Lv.${targetLevel} 城寨`);
    // 点击2次切换按钮：第1次退出搜索面板，第2次回到城内
    ctx.log(`  退出搜索面板并返回城内`);
    await ctx.tap(worldBtn.x, worldBtn.y);
    await ctx.sleep(1);
    await ctx.tap(worldBtn.x, worldBtn.y);
    await ctx.sleep(2);
    return { result: 'not_found', dispatched: 0 };
  }

  await ctx.sleep(2.5);

  // [5/7] 点击集结按钮
  ctx.log(`  [5/7] 点击集结按钮 (${fs.rallyButton.x}, ${fs.rallyButton.y})`);
  await ctx.tap(fs.rallyButton.x, fs.rallyButton.y);
  await ctx.sleep(1.5);

  // [6/7] 确认集结时间
  ctx.log(`  [6/7] 确认集结时间 (${CONFIRM_TIME_BUTTON.x}, ${CONFIRM_TIME_BUTTON.y})`);
  await ctx.tap(CONFIRM_TIME_BUTTON.x, CONFIRM_TIME_BUTTON.y);
  await ctx.sleep(1);

  // 检测分页
  const hasPaging = await ctx.findImage(PAGE_INDICATOR_TEMPLATE, 0.8);
  ctx.log(`  [检测] 换页按钮: ${hasPaging ? '存在 (>7组)' : '不存在 (≤7组)'}`);

  const teamButtons = hasPaging ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
  const teamBtn = teamButtons[team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${team}`);
    return { result: 'team_unavailable', dispatched: 0, foundLevel: currentLevel };
  }

  // [7/7] 选择队伍并检测状态变化
  ctx.log(`  [7/7] 选择队伍 ${team} 并检测状态变化...`);
  const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
  ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

  if (!stateResult.changed) {
    ctx.log(`  ⚠️ 队伍${team}不可用，按钮无选中状态变化，跳过`);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    return { result: 'team_unavailable', dispatched: 0, foundLevel: currentLevel };
  }

  // 点击行军
  await ctx.sleep(0.5);
  ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
  await ctx.tap(MARCH_BUTTON.x, MARCH_BUTTON.y);
  await ctx.sleep(1);

  ctx.log(`  ✅ 队伍${team} 已发起 Lv.${currentLevel} 城寨集结`);
  return { result: 'success', dispatched: 1, foundLevel: currentLevel };
}
```

- [ ] **Step 3: Commit**

```bash
git add plugins/rok/actions/rallyFort.ts
git commit -m "feat: rewrite rallyFort to use built-in fort search UI"
```

---

### Task 4: plugins/rok/index.ts — 更新 rally-fort action 传入 downgrade

**Files:**
- Modify: `plugins/rok/index.ts`

- [ ] **Step 1: 更新 rally-fort action 定义**

将 rally-fort action 的 run 函数改为从 params 取 downgrade 并传入 rallyFort:

```typescript
    {
      id: 'rally-fort',
      name: '攻打城寨',
      description: '使用游戏内置搜索查找野蛮人城寨并发起集结',
      run: async (ctx, params: { level?: number; team?: number; downgrade?: boolean } = {}) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const level = params.level || 5;
        const team = params.team || 1;
        const downgrade = params.downgrade !== false;
        const outcome = await rallyFort(ctx, config, level, team, downgrade);
        ctx.log(`城寨集结: Lv.${outcome.foundLevel || level} 队伍${team} → ${outcome.result}`);
      }
    },
```

- [ ] **Step 2: Commit**

```bash
git add plugins/rok/index.ts
git commit -m "feat: pass downgrade param to rally-fort action"
```

---

### Task 5: Home.tsx — 城寨卡片新增降级搜索开关

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 在 loadFeatures 中补充 rallyFortDowngrade 默认值**

找到 `loadFeatures` 中对 `rallyFortTeam` 的默认值处理（约 163 行），在其附近新增:

```typescript
        if (typeof merged.rallyFortDowngrade !== 'boolean') merged.rallyFortDowngrade = DEFAULT_FEATURES.rallyFortDowngrade;
```

- [ ] **Step 2: 在 rally-fort 任务创建处传入 downgrade**

找到 `rally-fort` 的 `api.tasks.create` 调用（约 522 行），在 params 中新增 downgrade:

```typescript
              const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', 'rally-fort', { level: features.rallyFortLevel, team: features.rallyFortTeam, downgrade: features.rallyFortDowngrade });
```

- [ ] **Step 3: 在城寨卡片 UI 中新增降级搜索开关**

在队伍选择 `<select>` 之后、循环间隔 `<input>` 之前（约 1294-1301 行之间），新增一行:

```tsx
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-16">降级搜索</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={features.rallyFortDowngrade}
                        onChange={(e) => setFeatures({ ...features, rallyFortDowngrade: e.target.checked })}
                        className="sr-only peer" />
                      <span className={`w-9 h-5 rounded-full transition-colors ${features.rallyFortDowngrade ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                      <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.rallyFortDowngrade ? 'translate-x-[18px]' : ''}`} />
                    </label>
                  </div>
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: add rallyFortDowngrade toggle to Home UI"
```

---

### Task 6: 编译验证

**Files:**
- (验证，不修改任何文件)

- [ ] **Step 1: 后端 TypeScript 编译检查**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 2: 前端构建检查**

```bash
cd web && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: verify build passes after rally fort refactor"
```
(Only if there are any changes from fixes during verification.)
