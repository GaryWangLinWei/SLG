# 采集分享矿 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小号从聊天里读主号分享的宝石矿坐标，直接定位并采集；池空时本轮跳过，由账号调度自然切号。

**Architecture:** 按账号隔离的内存池 `sharedGemPool`（模块级单例）+ 3 个新 action（`collect-shared-gem-coords`、`gather-shared-gem`、`clear-shared-gem-pool`）+ 从 shareGem/gatherGem 抽出公共 util (`utils/locateCoord.ts` 和 `dispatchToSharedGem`)。Home.tsx gemLoop 按 `gemGatherSharedOnly` 分支到不同 action。

**Tech Stack:** TypeScript / PluginContext / tesseract.js OCR / sharp / Vision 模板匹配 / React (Home.tsx)

参考设计文档：`docs/superpowers/specs/2026-07-17-gather-shared-gem-design.md`

---

## 文件结构

**新建：**
- `plugins/rok/state/sharedGemPool.ts` — 按账号隔离的坐标池
- `plugins/rok/utils/locateCoord.ts` — 输入坐标定位（从 shareGem.ts 抽出）
- `plugins/rok/actions/collectSharedGemCoords.ts` — 打开聊天读坐标
- `plugins/rok/actions/gatherSharedGem.ts` — 从池出队 → 定位 → 派兵
- `plugins/rok/actions/clearSharedGemPool.ts` — 清池
- 模板：`plugins/rok/templates/share_gem/zhankai_blue.png`、`zhankai_zong.png`（用户提供）；`pin_gem.png` 已存在

**修改：**
- `plugins/rok/actions/shareGem.ts` — 改用 `utils/locateCoord.ts`
- `plugins/rok/actions/gatherGem.ts` — 抽出 `dispatchToSharedGem` 公共函数
- `plugins/rok/index.ts` — 注册 3 个新 action
- `web/src/pages/Home.tsx` — 采集分享矿 chip 启用；gemLoop 分支；start 时清池

---

### Task 1: 建 `sharedGemPool` 单例

**Files:**
- Create: `plugins/rok/state/sharedGemPool.ts`
- Test: `plugins/rok/state/sharedGemPool.test.ts`

- [ ] **Step 1: 写测试**

```ts
// plugins/rok/state/sharedGemPool.test.ts
import { sharedGemPool } from './sharedGemPool';

describe('sharedGemPool', () => {
  beforeEach(() => sharedGemPool.clearAll());

  test('addUnique 去重', () => {
    expect(sharedGemPool.addUnique('A', { x: 100, y: 200 })).toBe(true);
    expect(sharedGemPool.addUnique('A', { x: 100, y: 200 })).toBe(false);
    expect(sharedGemPool.size('A')).toBe(1);
  });

  test('账号隔离', () => {
    sharedGemPool.addUnique('A', { x: 1, y: 2 });
    sharedGemPool.addUnique('B', { x: 3, y: 4 });
    expect(sharedGemPool.size('A')).toBe(1);
    expect(sharedGemPool.size('B')).toBe(1);
    expect(sharedGemPool.has('A', { x: 3, y: 4 })).toBe(false);
  });

  test('pop 出队', () => {
    sharedGemPool.addUnique('A', { x: 1, y: 2 });
    sharedGemPool.addUnique('A', { x: 3, y: 4 });
    expect(sharedGemPool.pop('A')).toEqual({ x: 1, y: 2 });
    expect(sharedGemPool.size('A')).toBe(1);
    expect(sharedGemPool.pop('A')).toEqual({ x: 3, y: 4 });
    expect(sharedGemPool.pop('A')).toBeUndefined();
  });

  test('clearAll / clear', () => {
    sharedGemPool.addUnique('A', { x: 1, y: 2 });
    sharedGemPool.addUnique('B', { x: 3, y: 4 });
    sharedGemPool.clear('A');
    expect(sharedGemPool.size('A')).toBe(0);
    expect(sharedGemPool.size('B')).toBe(1);
    sharedGemPool.clearAll();
    expect(sharedGemPool.size('B')).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest plugins/rok/state/sharedGemPool.test.ts`
Expected: FAIL "Cannot find module './sharedGemPool'"

- [ ] **Step 3: 实现**

```ts
// plugins/rok/state/sharedGemPool.ts
export interface SharedGemCoord { x: number; y: number; }

function key(c: SharedGemCoord): string {
  return `${c.x},${c.y}`;
}

class SharedGemPool {
  private byAccount = new Map<string, SharedGemCoord[]>();

  size(accountId: string): number {
    return this.byAccount.get(accountId)?.length ?? 0;
  }

  peek(accountId: string): SharedGemCoord | undefined {
    return this.byAccount.get(accountId)?.[0];
  }

  pop(accountId: string): SharedGemCoord | undefined {
    return this.byAccount.get(accountId)?.shift();
  }

  addUnique(accountId: string, c: SharedGemCoord): boolean {
    const list = this.byAccount.get(accountId) ?? [];
    if (list.some(x => x.x === c.x && x.y === c.y)) return false;
    list.push(c);
    this.byAccount.set(accountId, list);
    return true;
  }

  has(accountId: string, c: SharedGemCoord): boolean {
    const list = this.byAccount.get(accountId);
    if (!list) return false;
    return list.some(x => x.x === c.x && x.y === c.y);
  }

  clearAll(): void {
    this.byAccount.clear();
  }

  clear(accountId: string): void {
    this.byAccount.delete(accountId);
  }

  snapshot(accountId: string): SharedGemCoord[] {
    return [...(this.byAccount.get(accountId) ?? [])];
  }
}

export const sharedGemPool = new SharedGemPool();
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest plugins/rok/state/sharedGemPool.test.ts`
Expected: PASS 4 tests

- [ ] **Step 5: 提交**

```bash
git add plugins/rok/state/sharedGemPool.ts plugins/rok/state/sharedGemPool.test.ts
git commit -m "feat(shared-gem): sharedGemPool 按账号隔离的坐标池"
```

---

### Task 2: 抽出 `utils/locateCoord.ts`

**Files:**
- Create: `plugins/rok/utils/locateCoord.ts`
- Modify: `plugins/rok/actions/shareGem.ts:20-72`

- [ ] **Step 1: 建 util**

```ts
// plugins/rok/utils/locateCoord.ts
import { PluginContext } from '../../../core/plugin';

// UI 坐标（1600x900）
export const COORD_ENTRY_BUTTON = { x: 552, y: 26 };
export const X_INPUT_BOX        = { x: 799, y: 176 };
export const Y_INPUT_BOX        = { x: 987, y: 178 };
export const COORD_SEARCH_BTN   = { x: 1108, y: 180 };

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

async function typeDigitsLikeHuman(ctx: PluginContext, value: number): Promise<void> {
  const digits = String(value);
  for (let i = 0; i < digits.length; i++) {
    await ctx.inputText(digits[i]);
    if (i < digits.length - 1) await ctx.sleep(rand(0.08, 0.2));
  }
}

/**
 * 通过弹出的坐标输入框跳到 (x, y) 坐标。
 * 调用前需保证已经在城外视角。
 */
export async function locateByCoord(ctx: PluginContext, x: number, y: number): Promise<void> {
  ctx.log(`[定位] 坐标 (${x},${y})`);
  await ctx.tap(COORD_ENTRY_BUTTON.x, COORD_ENTRY_BUTTON.y);
  await ctx.sleep(rand(0.9, 1.4));
  await ctx.tap(X_INPUT_BOX.x, X_INPUT_BOX.y);
  await ctx.sleep(rand(0.4, 0.8));
  await typeDigitsLikeHuman(ctx, x);
  await ctx.sleep(rand(0.25, 0.55));
  await ctx.tap(Y_INPUT_BOX.x, Y_INPUT_BOX.y);
  await ctx.sleep(rand(0.4, 0.8));
  await typeDigitsLikeHuman(ctx, y);
  await ctx.sleep(rand(0.25, 0.55));
  await ctx.tap(COORD_SEARCH_BTN.x, COORD_SEARCH_BTN.y);
  await ctx.sleep(rand(1.3, 1.9));
}
```

- [ ] **Step 2: 改 shareGem.ts 使用 util**

删除 `shareGem.ts` 中的 `COORD_ENTRY_BUTTON`、`X_INPUT_BOX`、`Y_INPUT_BOX`、`COORD_SEARCH_BTN` 常量（第 21-24 行）、`rand` 函数（32-34 行）、`typeDigitsLikeHuman` 函数（36-42 行）、以及 `locateByCoord` 函数（58-72 行）。

在文件顶部 import 处加：

```ts
import { locateByCoord } from '../utils/locateCoord';
```

原文件里所有 `locateByCoord(...)` 的调用不变（函数签名一致）。

- [ ] **Step 3: 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/utils/locateCoord.ts plugins/rok/actions/shareGem.ts
git commit -m "refactor(share-gem): locateByCoord 抽到 utils/locateCoord.ts"
```

---

### Task 3: 抽出 `dispatchToSharedGem`（复用 gatherGem 中的派兵段）

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts` — 新增导出函数 `dispatchToSharedGem`

**背景：** 现在 `gatherGem.ts` 中的 `dispatchToTeamPopup`（第 604 行起）已经是通用派兵函数（打开队伍选择弹窗 → 选队伍 → 派出）。**它本身就足够复用**，不需要额外抽新函数。只需在 `gatherSharedGem.ts` 里直接 `import { dispatchToTeamPopup }`。

这个 Task 改为**验证性**：确认 `dispatchToTeamPopup` 已 export，且调用签名（`teams, nextTeamIdx, hasPaging, collectedCoords, teamPage`）在 shared-gem 场景可用。

- [ ] **Step 1: 确认导出**

Run: `grep -n "export async function dispatchToTeamPopup" plugins/rok/actions/gatherGem.ts`
Expected: 匹配到一行

- [ ] **Step 2: 记录调用契约**

在 `gatherGem.ts` `dispatchToTeamPopup` 定义上方的 JSDoc 补一行：

原有 JSDoc（596-603 行）已足够，无需改动。跳到 Step 3。

- [ ] **Step 3: 无代码改动，无需提交**

跳过。

---

### Task 4: 建 `collectSharedGemCoords` action

**Files:**
- Create: `plugins/rok/actions/collectSharedGemCoords.ts`

**前置：** 用户已提供 `plugins/rok/templates/share_gem/pin_gem.png`；需要用户另提供 `zhankai_blue.png` 和 `zhankai_zong.png` 两张模板。**如果模板缺失，Step 3 的 findImage 检测会永远返回 not found，导致每次都尝试点击展开按钮 (45, 34)**——即便如此逻辑仍能跑通（游戏对已展开状态再点一次不会破坏），只是日志会显示反复展开。

- [ ] **Step 1: 实现**

```ts
// plugins/rok/actions/collectSharedGemCoords.ts
import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ocrService } from '../../../core/ocr/OcrService';
import { sharedGemPool, SharedGemCoord } from '../state/sharedGemPool';
import * as path from 'path';
import * as fs from 'fs/promises';

const TEMPLATE_DIR = getTemplatesDir();
const PIN_GEM = path.join(TEMPLATE_DIR, 'share_gem', 'pin_gem.png');
const ZHANKAI_BLUE = path.join(TEMPLATE_DIR, 'share_gem', 'zhankai_blue.png');
const ZHANKAI_ZONG = path.join(TEMPLATE_DIR, 'share_gem', 'zhankai_zong.png');
const MAINROLE_HEAD = path.join(TEMPLATE_DIR, 'share_gem', 'mainrolehead.png');

// 关键坐标（1600×900）
const CHAT_ENTRY = { x: 375, y: 854 };
const EXPAND_REGION = { x: 508, y: 5, w: 64, h: 58 };
const EXPAND_BTN = { x: 45, y: 34 };
const MAINROLE_SEARCH_REGION = { x: 20, y: 66, w: 91, h: 754 };
const CHAT_CLOSE = { x: 1189, y: 447 };
const SWIPE_FROM = { x: 641, y: 121 };
const SWIPE_TO = { x: 618, y: 720 };

// pin 图标左侧的坐标文字块相对偏移（相对 pin 的 top-left）
const COORD_TEXT_DX = -215;
const COORD_TEXT_DY = -12;
const COORD_TEXT_W = 200;
const COORD_TEXT_H = 55;

const MAX_SWIPES = 15;

export type CollectResult = 'ok' | 'no_mainrole' | 'no_pin';

export interface CollectOutcome {
  result: CollectResult;
  collected: number;
  poolSize: number;
}

function parseCoordText(text: string): SharedGemCoord | null {
  const m = text.match(/X[:：]\s*(\d+)\s*Y[:：]\s*(\d+)/i);
  if (!m) return null;
  const x = parseInt(m[1], 10);
  const y = parseInt(m[2], 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export async function collectSharedGemCoords(
  ctx: PluginContext,
  accountId: string
): Promise<CollectOutcome> {
  ctx.log(`=== 收集分享矿坐标 account=${accountId} ===`);
  const before = sharedGemPool.size(accountId);

  ctx.log(`[1] 打开聊天框 (${CHAT_ENTRY.x},${CHAT_ENTRY.y})`);
  await ctx.tap(CHAT_ENTRY.x, CHAT_ENTRY.y);
  await ctx.sleep(1);

  // [2] 检测是否已展开
  const expandCheck = await ctx.captureRegion(
    EXPAND_REGION.x, EXPAND_REGION.y, EXPAND_REGION.w, EXPAND_REGION.h
  );
  try {
    const blue = await ctx.findImageInRegion(ZHANKAI_BLUE, expandCheck, 0.75);
    const zong = blue.found ? blue : await ctx.findImageInRegion(ZHANKAI_ZONG, expandCheck, 0.75);
    if (!blue.found && !zong.found) {
      ctx.log(`[2] 未展开，点击展开按钮 (${EXPAND_BTN.x},${EXPAND_BTN.y})`);
      await ctx.tap(EXPAND_BTN.x, EXPAND_BTN.y);
      await ctx.sleep(0.8);
    } else {
      ctx.log(`[2] 聊天已展开`);
    }
  } finally {
    await fs.unlink(expandCheck).catch(() => {});
  }

  // [3] 找主号头像
  const heads = await ctx.findAllImages(MAINROLE_HEAD, 0.7, {
    x: MAINROLE_SEARCH_REGION.x,
    y: MAINROLE_SEARCH_REGION.y,
    w: MAINROLE_SEARCH_REGION.w,
    h: MAINROLE_SEARCH_REGION.h,
  });
  if (!heads || heads.length === 0) {
    ctx.log(`[3] 未找到主号头像，关闭聊天`);
    await ctx.tap(CHAT_CLOSE.x, CHAT_CLOSE.y);
    await ctx.sleep(0.6);
    return { result: 'no_mainrole', collected: 0, poolSize: sharedGemPool.size(accountId) };
  }
  const target = [...heads].sort((a, b) => a.y - b.y)[0];
  ctx.log(`[3] 找到主号头像 (${target.x},${target.y})，点击`);
  await ctx.tap(target.x, target.y);
  await ctx.sleep(1);

  // [4] 循环收集
  let sawAnyPin = false;
  for (let round = 0; round < MAX_SWIPES; round++) {
    ctx.log(`[4] 第 ${round + 1} 屏：搜索 pin_gem`);
    const pins = await ctx.findAllImages(PIN_GEM, 0.7);
    if (!pins || pins.length === 0) {
      ctx.log(`  本屏无 pin`);
      if (round === 0) {
        // 首屏就没有 pin，退出
        break;
      }
    } else {
      sawAnyPin = true;
    }

    let addedThisPage = 0;
    let allSeen = true;
    for (const pin of pins) {
      const px = pin.x + COORD_TEXT_DX;
      const py = pin.y + COORD_TEXT_DY;
      const clipPath = await ctx.captureRegion(
        Math.max(0, px), Math.max(0, py), COORD_TEXT_W, COORD_TEXT_H
      );
      try {
        const text = await ocrService.readText(clipPath);
        const coord = parseCoordText(text);
        if (!coord) {
          ctx.log(`  pin@(${pin.x},${pin.y}) OCR="${text.trim()}" 解析失败`);
          allSeen = false; // 未知坐标不算已看过
          continue;
        }
        if (sharedGemPool.has(accountId, coord)) {
          ctx.log(`  pin@(${pin.x},${pin.y}) -> (${coord.x},${coord.y}) 已在池`);
        } else {
          sharedGemPool.addUnique(accountId, coord);
          addedThisPage++;
          allSeen = false;
          ctx.log(`  pin@(${pin.x},${pin.y}) -> (${coord.x},${coord.y}) 加入池`);
        }
      } catch (e) {
        ctx.log(`  pin@(${pin.x},${pin.y}) OCR 失败: ${(e as Error).message}`);
        allSeen = false;
      } finally {
        await fs.unlink(clipPath).catch(() => {});
      }
    }

    ctx.log(`  本屏新增 ${addedThisPage}，池当前 ${sharedGemPool.size(accountId)}`);
    if (pins.length > 0 && allSeen) {
      ctx.log(`[4] 本屏所有坐标均已存在池中，停止滑动`);
      break;
    }

    if (round < MAX_SWIPES - 1) {
      ctx.log(`  向下滑动 (${SWIPE_FROM.x},${SWIPE_FROM.y})→(${SWIPE_TO.x},${SWIPE_TO.y})`);
      await ctx.swipe(SWIPE_FROM.x, SWIPE_FROM.y, SWIPE_TO.x, SWIPE_TO.y, 800);
      await ctx.sleep(0.8);
    } else {
      ctx.log(`[4] 达到最大滑动次数 ${MAX_SWIPES}`);
    }
  }

  ctx.log(`[5] 关闭聊天`);
  await ctx.tap(CHAT_CLOSE.x, CHAT_CLOSE.y);
  await ctx.sleep(0.6);

  const after = sharedGemPool.size(accountId);
  const collected = after - before;
  const result: CollectResult = sawAnyPin ? 'ok' : 'no_pin';
  ctx.log(`=== 收集完成 result=${result} 新增=${collected} 池=${after} ===`);
  return { result, collected, poolSize: after };
}
```

**注意：**`ctx.findImageInRegion` 可能不存在。检查 PluginContext 是否有该方法，无则改用现有 `findImage` 传截图路径：

```bash
grep -n "findImageInRegion\|findImage(" core/plugin/PluginContext.ts
```

若没有 `findImageInRegion`，把 [2] 的展开检测改为：直接对 `expandCheck` 截图路径调 `Vision.findImage(expandCheck, ZHANKAI_BLUE, 0.75)` 拿到 `found`。或者用现有 `ctx.findImageWithLocation(ZHANKAI_BLUE, 0.75)` 直接对全屏找（因为展开图标位置固定在左上角，全屏也能找到）。**推荐直接用 `findImageWithLocation` 全屏找，去掉 `captureRegion` 步骤**。

- [ ] **Step 2: 简化展开检测（去掉 captureRegion）**

替换 Step 1 中 [2] 部分为：

```ts
const blue = await ctx.findImageWithLocation(ZHANKAI_BLUE, 0.75);
const zong = blue.found ? blue : await ctx.findImageWithLocation(ZHANKAI_ZONG, 0.75);
if (!blue.found && !zong.found) {
  ctx.log(`[2] 未展开，点击展开按钮 (${EXPAND_BTN.x},${EXPAND_BTN.y})`);
  await ctx.tap(EXPAND_BTN.x, EXPAND_BTN.y);
  await ctx.sleep(0.8);
} else {
  ctx.log(`[2] 聊天已展开`);
}
```

同时删除文件顶部的 `EXPAND_REGION` 常量。

- [ ] **Step 3: 确认 `findAllImages` 支持 searchRegion 参数**

Run: `grep -n "findAllImages" core/plugin/PluginContext.ts`
Expected: 找到签名，确认第 3 参数是 threshold，第 4 参数是 searchRegion（或类似）。

若签名不同，把 [3] 中的 `findAllImages` 调用改成两步：全屏 findAll → 手动过滤 `x/y` 在 `MAINROLE_SEARCH_REGION` 范围内。

- [ ] **Step 4: 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add plugins/rok/actions/collectSharedGemCoords.ts
git commit -m "feat(shared-gem): collectSharedGemCoords 读取主号分享坐标"
```

---

### Task 5: 建 `gatherSharedGem` action

**Files:**
- Create: `plugins/rok/actions/gatherSharedGem.ts`

- [ ] **Step 1: 实现**

```ts
// plugins/rok/actions/gatherSharedGem.ts
import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { sharedGemPool } from '../state/sharedGemPool';
import { locateByCoord } from '../utils/locateCoord';
import { ensureInWorld } from '../utils/location';
import { collectSharedGemCoords } from './collectSharedGemCoords';
import {
  dispatchToTeamPopup,
  verifyGemAtCenter,
  parseCoord,
} from './gatherGem';
import { getTemplatesDir } from '../../../core/resourcePath';
import { TeamPage } from '../utils/teamPage';
import * as path from 'path';

const TEMPLATE_DIR = getTemplatesDir();
const PINCHED_GEM_TARGET_RECT = { x1: 792, y1: 426, x2: 878, y2: 502 };

const REFILL_THRESHOLD = 5;

export interface GatherSharedGemOutcome {
  result: 'ok' | 'empty' | 'no_team';
  gathered: number;
}

export interface GatherSharedGemParams {
  accountId: string;
  teams: number[];
  teamPage?: TeamPage;
}

/**
 * 从 sharedGemPool 中出队坐标进行采集：
 *   - pool.size < REFILL_THRESHOLD 时先触发一次 collectSharedGemCoords 扩充
 *   - pool 空则返回 'empty'，主循环走「切号」逻辑
 *   - 每个坐标出队即消耗（策略 A）
 */
export async function gatherSharedGem(
  ctx: PluginContext,
  config: RokConfig,
  params: GatherSharedGemParams
): Promise<GatherSharedGemOutcome> {
  const { accountId, teams } = params;
  const teamPage: TeamPage = params.teamPage ?? 'gather';
  ctx.log(`=== 采集分享矿 account=${accountId} teams=[${teams.join(',')}] ===`);

  ctx.log(`[1] 切换到城外`);
  await ensureInWorld(ctx, config);

  if (sharedGemPool.size(accountId) < REFILL_THRESHOLD) {
    ctx.log(`[2] 池数量 ${sharedGemPool.size(accountId)} < ${REFILL_THRESHOLD}，先收集`);
    await collectSharedGemCoords(ctx, accountId);
    // 收集完成后重新回到城外（收集过程点开了聊天但未切城）
    await ensureInWorld(ctx, config);
  }

  if (sharedGemPool.size(accountId) === 0) {
    ctx.log(`[2] 池为空，本轮结束`);
    return { result: 'empty', gathered: 0 };
  }

  const collectedCoords: string[] = [];
  let nextTeamIdx = 0;
  let hasPaging: boolean | null = null;
  let gathered = 0;

  while (sharedGemPool.size(accountId) > 0) {
    const coord = sharedGemPool.pop(accountId)!;
    ctx.log(`[3] 定位坐标 (${coord.x},${coord.y})，剩余池 ${sharedGemPool.size(accountId)}`);
    await locateByCoord(ctx, coord.x, coord.y);
    await ctx.sleep(2);

    // 中心区二次确认宝石存在
    const verified = await verifyGemAtCenter(ctx);
    if (!verified) {
      ctx.log(`  ⚠️ (${coord.x},${coord.y}) 中心未确认宝石，跳过`);
      continue;
    }

    ctx.log(`  点击宝石 rect=${JSON.stringify(PINCHED_GEM_TARGET_RECT)}`);
    await ctx.tapRect(PINCHED_GEM_TARGET_RECT.x1, PINCHED_GEM_TARGET_RECT.y1, PINCHED_GEM_TARGET_RECT.x2, PINCHED_GEM_TARGET_RECT.y2);
    await ctx.sleep(1);

    // 派兵
    const r = await dispatchToTeamPopup(ctx, config, teams, nextTeamIdx, hasPaging, collectedCoords, teamPage);
    hasPaging = r.hasPaging;
    nextTeamIdx = r.nextTeamIdx;

    if (r.dispatched) {
      gathered++;
      ctx.log(`  ✅ 派兵成功，累计 ${gathered}`);
    } else {
      ctx.log(`  ⚠️ 派兵失败，跳过`);
    }

    if (r.allTeamsBusy) {
      ctx.log(`[4] 队伍全忙，停止本轮`);
      return { result: 'no_team', gathered };
    }
  }

  ctx.log(`=== 采集完成 gathered=${gathered} ===`);
  return { result: 'ok', gathered };
}
```

**注意事项：**
1. `verifyGemAtCenter` 在 `gatherGem.ts` 已 export（第 109 行），直接 import 使用。
2. `dispatchToTeamPopup` 签名：`(ctx, config, teams, nextTeamIdx, hasPaging, collectedCoords, teamPage)`。`collectedCoords` 参数在 shared 场景不重要（本地空数组即可），因为分享矿的坐标去重靠池而非 `collectedCoords`。
3. 若 `verifyGemAtCenter` 中心未识别到宝石图案，说明矿已被别人抢采或坐标失效，直接跳过（不重入池，符合策略 A）。

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add plugins/rok/actions/gatherSharedGem.ts
git commit -m "feat(shared-gem): gatherSharedGem 从池出队采集"
```

---

### Task 6: 建 `clear-shared-gem-pool` action + 注册所有新 action

**Files:**
- Create: `plugins/rok/actions/clearSharedGemPool.ts`
- Modify: `plugins/rok/index.ts` — 新增 3 个 action 注册

- [ ] **Step 1: 建 clear action**

```ts
// plugins/rok/actions/clearSharedGemPool.ts
import { PluginContext } from '../../../core/plugin';
import { sharedGemPool } from '../state/sharedGemPool';

export async function clearSharedGemPool(ctx: PluginContext): Promise<void> {
  sharedGemPool.clearAll();
  ctx.log(`[shared-gem-pool] 已清空全部账号的分享矿池`);
}
```

- [ ] **Step 2: 在 index.ts 加 import**

在 `plugins/rok/index.ts` 顶部 shareGem import 附近加：

```ts
import { collectSharedGemCoords } from './actions/collectSharedGemCoords';
import { gatherSharedGem } from './actions/gatherSharedGem';
import { clearSharedGemPool } from './actions/clearSharedGemPool';
```

- [ ] **Step 3: 在 actions 数组注册**

找到 `share-gem` action 定义结束的位置（第 851 行 `}` 后面 `,` 处），在其后追加：

```ts
    {
      id: 'collect-shared-gem-coords',
      name: '收集分享矿坐标',
      description: '打开聊天读取主号分享的宝石矿坐标并加入池（按账号隔离）',
      run: async (ctx, params: { accountId: string }) => {
        if (!params?.accountId) {
          ctx.log('❌ 缺少 accountId 参数');
          return;
        }
        const outcome = await collectSharedGemCoords(ctx, params.accountId);
        ctx.log(`收集分享矿: ${outcome.result} 新增=${outcome.collected} 池=${outcome.poolSize}`);
      }
    },
    {
      id: 'gather-shared-gem',
      name: '采集分享矿',
      description: '从池出队坐标定位并派兵采集；池不足会先自动收集',
      run: async (ctx, params: { accountId: string; teams?: number[]; teamPage?: 'gather' | 'rally' } = { accountId: '' }) => {
        if (!params?.accountId) {
          ctx.log('❌ 缺少 accountId 参数');
          return;
        }
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const teams = params.teams ?? [1];
        const outcome = await gatherSharedGem(ctx, config, {
          accountId: params.accountId,
          teams,
          teamPage: params.teamPage ?? 'gather',
        });
        ctx.log(`采集分享矿: → ${outcome.result}，采集 ${outcome.gathered} 队`);
      }
    },
    {
      id: 'clear-shared-gem-pool',
      name: '清空分享矿池',
      description: '清空所有账号的分享矿坐标池（点击开始运行时调用一次）',
      run: async (ctx) => {
        await clearSharedGemPool(ctx);
      }
    },
```

- [ ] **Step 4: 编译验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add plugins/rok/actions/clearSharedGemPool.ts plugins/rok/index.ts
git commit -m "feat(shared-gem): 注册 collect/gather/clear 三个 action"
```

---

### Task 7: Home.tsx — 启用采集分享矿 chip

**Files:**
- Modify: `web/src/pages/Home.tsx:2525-2536`

- [ ] **Step 1: 替换 chip**

找到 `Home.tsx` 第 2525-2536 行的禁用版 chip，整段替换为：

```tsx
                  <div className="flex items-center gap-3 mt-2">
                    <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                      features.gemGatherSharedOnly
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                    } ${(!features.gemGatherEnabled || isFeatureLocked('gemGather')) ? 'opacity-40 cursor-not-allowed' : ''}`}>
                      <input type="checkbox"
                        checked={features.gemGatherSharedOnly}
                        onChange={(e) => setFeatures({ ...features, gemGatherSharedOnly: e.target.checked })}
                        disabled={!features.gemGatherEnabled || isFeatureLocked('gemGather')}
                        className="sr-only peer" />
                      <span className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center text-[11px] ${
                        features.gemGatherSharedOnly ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-300 text-transparent'
                      }`}>✓</span>
                      采集分享矿
                    </label>
                  </div>
```

- [ ] **Step 2: 前端编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(shared-gem): 采集分享矿 chip 启用"
```

---

### Task 8: Home.tsx — gemLoop 按 sharedOnly 分支 + 开始运行清池

**Files:**
- Modify: `web/src/pages/Home.tsx` — gemLoop 相关分支 + start 入口

- [ ] **Step 1: 找到 gemLoop 中调用 gem-gather 的位置**

Run: `grep -n "'gem-gather'\|'gem-gather-focus'\|gemLoop\|start(" web/src/pages/Home.tsx | head -30`

**目的：** 定位现在 gemLoop 里调用 `api.tasks.create(..., 'gem-gather', ...)` 的位置。

- [ ] **Step 2: 分支逻辑**

在 gemLoop 里，将调用点替换为条件分支：

```tsx
const useShared = featuresRef.current.gemGatherSharedOnly && !featuresRef.current.gemGatherFocusMode;
const actionId = useShared ? 'gather-shared-gem' : 'gem-gather';
const params: any = useShared
  ? {
      accountId: currentAccountId,
      teams: featuresRef.current.gemGatherTeams,
      teamPage: featuresRef.current.gemGatherTeamPage,
    }
  : {
      // 保持现有 gem-gather 参数结构不变
      teams: featuresRef.current.gemGatherTeams,
      searchWeights: featuresRef.current.gemSearchWeights,
      maxDistance: featuresRef.current.gemGatherMaxDistance,
      teamPage: featuresRef.current.gemGatherTeamPage,
    };
const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', actionId, params);
```

（focusMode 与 sharedOnly 互斥：focusMode 优先走 `gem-gather-focus` — 保留现有 focusMode 逻辑不动。）

**读日志判断 empty**：runResult 完成后：

```tsx
const isEmpty = useShared && logs.some((l: string) => l.includes('采集分享矿:') && l.includes('→ empty'));
if (isEmpty) {
  pushLog(`💎 分享矿池空，本轮跳过（等待账号调度）`);
} else {
  pushLog(`💎 采集宝石完成`);
  markRoundDone('gem-gather');
}
```

注意：`markRoundDone` 决定切号信号。empty 不算完成本轮，也不 markRoundDone —— 这样账号调度不会因为「本号轮次跑完」被推进。

**等等**：设计文档里说的是「pool 为空本轮跳过，账号调度自然切号」。要让账号调度切号，其实需要正常 markRoundDone —— 因为账号调度靠所有勾选项 markRoundDone 后才切。**采用 markRoundDone**：empty 也算本轮结束（否则永远卡在这个账号）。

修正为：

```tsx
if (isEmpty) {
  pushLog(`💎 分享矿池空，本轮跳过`);
}
markRoundDone('gem-gather');
```

- [ ] **Step 3: 开始运行时清池**

`grep -n "const start\|function start\|start = async\|loopStopped = false" web/src/pages/Home.tsx | head -10` 找到 start 函数入口。

在 start 函数内、`loopStopped = false` 附近（loop 开始之前）加一行：

```tsx
try {
  const cr = await api.tasks.create(currentAccountId, 'com.rok.automation', 'clear-shared-gem-pool');
  if (cr.success) await api.tasks.run(cr.task.id);
} catch {}
```

- [ ] **Step 4: 前端编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(shared-gem): gemLoop 分支 + 开始运行清池"
```

---

### Task 9: 最终验证

- [ ] **Step 1: 全量编译**

Run: `npx tsc --noEmit && cd web && npx tsc --noEmit && cd ..`
Expected: 无错误

- [ ] **Step 2: 单元测试**

Run: `npx jest plugins/rok/state/`
Expected: sharedGemPool 4 tests PASS

- [ ] **Step 3: 手工验证清单（用户在真实模拟器执行）**

- [ ] 主号开启「分享宝石矿」，等一段时间让主号分享几个坐标到聊天
- [ ] 小号开启「自动采集宝石」+「采集分享矿」
- [ ] 观察日志：
  - `sharedGemPool` 初始为空
  - 第一轮 collectSharedGemCoords 打开聊天、找主号、OCR 出坐标
  - gatherSharedGem 依次 locateByCoord → 派兵
  - 池用完 → `→ empty`
- [ ] 切号后（另一账号）：新账号 pool 独立为 0，同样触发收集
- [ ] 点停止 → 再点开始：pool 应被 clear（可在池空日志验证）

- [ ] **Step 4: 无自动测试的路径由用户手工确认后完成**

---

## Spec 自查

- ✅ **sharedGemPool 数据结构** → Task 1
- ✅ **collectSharedGemCoords 流程 5 步** → Task 4
- ✅ **gatherSharedGem 流程** → Task 5
- ✅ **share-gem 依赖 utils/locateCoord** → Task 2
- ✅ **dispatchToTeamPopup 复用**（不用额外抽 dispatchToSharedGem，直接复用现成的） → Task 3 & Task 5
- ✅ **clear-shared-gem-pool action** → Task 6
- ✅ **UI chip 启用** → Task 7
- ✅ **Home gemLoop 分支 + start 清池** → Task 8
- ✅ **模板：pin_gem.png（已有）、zhankai_blue.png、zhankai_zong.png（需用户提供）** → Task 4 备注
- ✅ **策略 A（一次消耗）** → Task 5 `pop()` 立即出队
- ✅ **本屏全部命中已知 → 停止滑动** → Task 4 `allSeen` 判定
- ✅ **最多 15 屏保险** → Task 4 `MAX_SWIPES`
- ✅ **模板过滤宝石矿床（靠 pin_gem 模板本身）** → Task 4 无额外文字过滤

**放弃项：**
- 设计文档中提到「抽出 dispatchToSharedGem」— 实际发现 `dispatchToTeamPopup` 已经通用，直接复用（避免过度抽象）。Task 3 改为验证性 no-op。
