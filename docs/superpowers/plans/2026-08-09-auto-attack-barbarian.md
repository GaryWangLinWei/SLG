# 自动打野（attack-barbarian）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立"自动打野"功能：自动搜索并攻击野蛮人，首次组队出兵，之后循环复用已驻扎的成型队伍连续攻击指定次数。

**Architecture:** 新建 action 文件 `plugins/rok/actions/attackBarbarian.ts`，首次攻击复用 rallyFort 的设级逻辑和 joinRally 的编队/选队/行军逻辑，后续循环用 state.onnx 等待驻扎、点最上方驻扎头像、点行军按钮开拔。先把 rallyFort/joinRally 重复的体力药水逻辑抽到 `plugins/rok/utils/stamina.ts`，三处共用。前端在 homeFeatures 加字段，Home.tsx 加独立循环和卡片。

**Tech Stack:** TypeScript, Node.js, sharp, tesseract.js, ONNX (state.onnx via PluginContext), Jest + ts-jest, React + Vite 前端。

参考 spec：`docs/superpowers/specs/2026-08-09-auto-attack-barbarian-design.md`

---

## File Structure

- Create: `plugins/rok/utils/stamina.ts` — 体力颜色判定、领免费体力、行军后体力处理（从 rallyFort/joinRally 抽出）。
- Create: `plugins/rok/actions/attackBarbarian.ts` — 自动打野 action 主逻辑。
- Create: `plugins/rok/actions/attackBarbarian.test.ts` — 纯函数单测（±2 级重试顺序、体力颜色判定）。
- Modify: `plugins/rok/actions/rallyFort.ts` — 删除本地体力函数，改 import stamina.ts；导出 `readCurrentLevel` 设级辅助或保留本地（见 Task 4）。
- Modify: `plugins/rok/actions/joinRally.ts` — 删除本地体力函数，改 import stamina.ts。
- Modify: `plugins/rok/index.ts` — 注册 `attack-barbarian` action。
- Modify: `plugins/rok/homeFeatures.ts` — 新增 6 个字段及默认值。
- Modify: `web/src/pages/Home.tsx` — 新增 `attackBarbarianLoop`、加入 Promise.all、新增卡片 UI。

**重要坐标/常量速查（1600×900）：**
- 搜索入口 rect：`{x1:42,y1:645,x2:110,y2:704}`；打野用点击点 `(82,674)`。
- 野蛮人页签（打野）：`(148,294)`。
- 等级 minus rect：`{x1:102,y1:467,x2:137,y2:501}`；plus rect：`{x1:539,y1:467,x2:576,y2:501}`；重置按钮 `(167,486)`。
- 搜索按钮：`(340,594)`（rect `{x1:244,y1:561,x2:436,y2:626}`）。
- 回城按钮 rect：`{x1:39,y1:776,x2:115,y2:858}`。
- 编队模板：`jijie/btn_biandui.png`；攻击模板：`btn_attack.png`；行军模板：`btn_xingjun.png`。
- 选队坐标（集结界面）：无分页 y 362/430/497/566/633，有分页 y 397/463/533/600/671，x=1378。
- 行军按钮 rect：`{x1:1031,y1:754,x2:1292,y2:820}`，中心 `(1154,791)`。
- 右侧大 UI 区域：`LARGE_REGION {x:1443,y:53,w:152,h:753}`；驻扎头像偏移 `AVATAR_OFFSET {-25,-25}`。
- 状态列最上方槽位命中区：x∈[1530,1582]，y∈[220,310]。

---

## Task 1: 创建 stamina.ts 共享体力工具

**Files:**
- Create: `plugins/rok/utils/stamina.ts`
- Test: `plugins/rok/utils/stamina.test.ts`

- [ ] **Step 1: 写失败的颜色判定测试**

创建 `plugins/rok/utils/stamina.test.ts`：

```ts
import { classifyStaminaColor } from './stamina';

describe('classifyStaminaColor', () => {
  it('绿色通道：G 明显大于 R 和 B', () => {
    expect(classifyStaminaColor(80, 180, 90)).toBe('green');
  });
  it('黄色通道：R/G 都高且接近，B 低', () => {
    expect(classifyStaminaColor(180, 160, 80)).toBe('yellow');
  });
  it('其他返回 unknown', () => {
    expect(classifyStaminaColor(50, 50, 50)).toBe('unknown');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest plugins/rok/utils/stamina.test.ts --runInBand`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 stamina.ts**

创建 `plugins/rok/utils/stamina.ts`：

```ts
import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';
import * as fsp from 'fs/promises';
import sharp from 'sharp';

export type StaminaColor = 'green' | 'yellow' | 'unknown';

export const STAMINA_BAR_RECT = { x1: 557, y1: 174, x2: 575, y2: 197 };
export const POTION_USE_BUTTON = { x: 1200, y: 326 };
export const CLOSE_STAMINA_POPUP = { x: 1363, y: 103 };
export const MAX_FREE_TILI_CLICKS = 2;
export const MAX_POTION_USES = 10;

const TILI_BUTTON_TEMPLATE = path.join(getTemplatesDir(), 'btn_tili.png');

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 纯函数：根据平均 RGB 判定体力条颜色 */
export function classifyStaminaColor(r: number, g: number, b: number): StaminaColor {
  if (g > r + 20 && g > b + 20) return 'green';
  if (r > 120 && g > 90 && Math.abs(r - g) < 60 && b < Math.min(r, g) - 40) return 'yellow';
  return 'unknown';
}

/** 采样体力条区域平均 RGB，判定颜色 */
export async function readStaminaColor(ctx: PluginContext): Promise<StaminaColor> {
  let shot: string | null = null;
  try {
    shot = await ctx.captureRegion(
      STAMINA_BAR_RECT.x1, STAMINA_BAR_RECT.y1,
      STAMINA_BAR_RECT.x2 - STAMINA_BAR_RECT.x1,
      STAMINA_BAR_RECT.y2 - STAMINA_BAR_RECT.y1,
    );
    const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let sumR = 0, sumG = 0, sumB = 0;
    const pixels = info.width * info.height;
    for (let i = 0; i < data.length; i += 3) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
    }
    const r = sumR / pixels, g = sumG / pixels, b = sumB / pixels;
    ctx.log(`  [体力条] RGB=(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})`);
    return classifyStaminaColor(r, g, b);
  } catch (e) {
    ctx.log(`  [体力条] 采样异常: ${(e as Error).message}`);
    return 'unknown';
  } finally {
    if (shot) await fsp.unlink(shot).catch(() => {});
  }
}

/** 循环点击 btn_tili 领取免费体力，最多 MAX_FREE_TILI_CLICKS 次或按钮消失 */
export async function claimAllFreeStamina(ctx: PluginContext, region: Rect): Promise<number> {
  let claimed = 0;
  for (let i = 0; i < MAX_FREE_TILI_CLICKS; i++) {
    const btn = await ctx.findImageWithLocation(TILI_BUTTON_TEMPLATE, 0.8, [0.9, 1.0, 1.1], false, undefined, region);
    ctx.log(`  [体力] 免费按钮检测 #${i + 1}: found=${btn.found} conf=${btn.confidence.toFixed(3)}`);
    if (!btn.found) break;
    ctx.log(`  [体力] 点击免费按钮 (${btn.x}, ${btn.y})`);
    await ctx.tap(btn.x, btn.y);
    await ctx.sleep(0.8);
    claimed++;
  }
  return claimed;
}

/**
 * 点一次行军按钮，检测是否弹行动力不足弹窗。
 * - 成功（城内外切换按钮可见）返回 true。
 * - 弹窗则按 usePotion 处理：领免费体力 → 读颜色 → green 重试；yellow+usePotion 用药水补绿重试；
 *   无法补足返回 false，并由调用方负责关闭/收尾。
 *
 * @param marchTap 执行实际行军点击的回调
 * @param onGiveUp 体力不足且无法补足时的收尾回调（关闭弹窗/回城等）
 * @returns 'marched' 表示成功出兵；'insufficient' 表示体力不足已收尾
 */
export async function handleMarchWithStamina(
  ctx: PluginContext,
  tiliRegion: Rect,
  usePotion: boolean,
  marchTap: () => Promise<void>,
  closePopupAndCity: () => Promise<void>,
): Promise<'marched' | 'insufficient'> {
  const SWITCH_IN_CITY = path.join(getTemplatesDir(), 'switch_in_city.png');
  const SWITCH_IN_WORLD = path.join(getTemplatesDir(), 'switch_in_world.png');

  for (let attempt = 1; attempt <= 2; attempt++) {
    await ctx.sleep(0.5);
    await marchTap();
    await ctx.sleep(1);

    const city = await ctx.findImageWithLocation(SWITCH_IN_CITY, 0.7);
    const world = await ctx.findImageWithLocation(SWITCH_IN_WORLD, 0.7);
    ctx.log(`  切换按钮: city=${city.found ? city.confidence.toFixed(3) : 'not found'}, world=${world.found ? world.confidence.toFixed(3) : 'not found'}`);
    if (city.found || world.found) return 'marched';

    ctx.log(`  ⚠️ 切换按钮不可见 → 行动力不足弹窗`);
    if (attempt >= 2) {
      await closePopupAndCity();
      return 'insufficient';
    }

    const claimed = await claimAllFreeStamina(ctx, tiliRegion);
    ctx.log(`  [体力] 免费领取 ${claimed} 次`);
    const color = await readStaminaColor(ctx);
    ctx.log(`  [体力] 判定颜色: ${color}`);

    if (color === 'green') {
      await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
      await ctx.sleep(0.8);
      continue;
    }

    if (color === 'yellow' && usePotion) {
      let green = false;
      for (let i = 0; i < MAX_POTION_USES; i++) {
        ctx.log(`  [体力] 使用药水 #${i + 1} → (${POTION_USE_BUTTON.x}, ${POTION_USE_BUTTON.y})`);
        await ctx.tap(POTION_USE_BUTTON.x, POTION_USE_BUTTON.y);
        await ctx.sleep(0.9);
        if (await readStaminaColor(ctx) === 'green') { green = true; break; }
      }
      if (green) {
        await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
        await ctx.sleep(0.8);
        continue;
      }
      ctx.log(`  [体力] 药水用尽仍未转绿 → 放弃`);
    } else {
      ctx.log(`  [体力] 不足（color=${color}, usePotion=${usePotion}）→ 放弃`);
    }

    await closePopupAndCity();
    return 'insufficient';
  }
  return 'insufficient';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest plugins/rok/utils/stamina.test.ts --runInBand`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 提交**

```bash
git add plugins/rok/utils/stamina.ts plugins/rok/utils/stamina.test.ts
git commit -m "feat(stamina): extract shared stamina handling util"
```

---

## Task 2: rallyFort 改用 stamina.ts

**Files:**
- Modify: `plugins/rok/actions/rallyFort.ts`

- [ ] **Step 1: 替换 import 和删除本地体力代码**

在 `rallyFort.ts` 顶部 import 区加入：

```ts
import { handleMarchWithStamina, StaminaColor } from '../utils/stamina';
```

删除以下本地定义（约 129-184 行）：`TILI_BUTTON_TEMPLATE`、`TILI_BUTTON_REGION`、`STAMINA_BAR_RECT`、`POTION_USE_BUTTON`、`CLOSE_STAMINA_POPUP`、`MAX_FREE_TILI_CLICKS`、`MAX_POTION_USES`、`type StaminaColor`、`readStaminaColor`、`claimAllFreeStamina`。

保留一个 tili 区域常量（rallyFort 原宽度）：

```ts
const TILI_BUTTON_REGION = { x: 1014, y: 242, width: 1358 - 1014, height: 407 - 242 };
```

同时删除 `SWITCH_IN_CITY_TEMPLATE`、`SWITCH_IN_WORLD_TEMPLATE` 常量（127-128 行，已移入 stamina 内部）。

- [ ] **Step 2: 用 handleMarchWithStamina 替换行军队列循环**

删除 504-581 行整个 `for (let marchAttempt...)` 循环，替换为：

```ts
  // 点击行军；行动力不足时领免费体力/用药水后重试一次
  const staminaResult = await handleMarchWithStamina(
    ctx,
    TILI_BUTTON_REGION,
    usePotion,
    async () => {
      ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
      await ctx.tapRect(MARCH_BUTTON_RECT.x1, MARCH_BUTTON_RECT.y1, MARCH_BUTTON_RECT.x2, MARCH_BUTTON_RECT.y2);
    },
    async () => {
      await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
      await ctx.sleep(0.5);
      await ctx.tap(CLOSE_TEAM_PANEL_BUTTON.x, CLOSE_TEAM_PANEL_BUTTON.y);
      await ctx.sleep(0.5);
      await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
      await ctx.sleep(2);
    },
  );
  if (staminaResult === 'insufficient') {
    return { result: 'stamina_insufficient', dispatched: 0, foundLevel: currentLevel };
  }
  ctx.log(`  ✅ 队伍${team} 已发起 Lv.${currentLevel} 城寨集结`);
  return { result: 'success', dispatched: 1, foundLevel: currentLevel };
```

注意：文件中 `CLOSE_STAMINA_POPUP` 已删除，需要在收尾回调里用字面量或重新引入。改为在文件常量区加：

```ts
const CLOSE_STAMINA_POPUP = { x: 1363, y: 103 };
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 跑相关测试**

Run: `npx jest plugins/rok/actions/rallyFort.test.ts --runInBand`
Expected: PASS（parseTeamCount 8 个测试）。

- [ ] **Step 5: 提交**

```bash
git add plugins/rok/actions/rallyFort.ts
git commit -m "refactor(rally-fort): use shared stamina util"
```

---

## Task 3: joinRally 改用 stamina.ts

**Files:**
- Modify: `plugins/rok/actions/joinRally.ts`

- [ ] **Step 1: 先读 joinRally 体力/行军区**

Run: 读取 `plugins/rok/actions/joinRally.ts` 第 336-417 行，确认现有行军+胜算+体力结构。

joinRally 与 rallyFort 不同：行军前先检测胜算不足 `jijie/btn_surego.png` 二次确认。因此不能直接用 `handleMarchWithStamina`（它不含 surego）。做法：把 surego 检测放进 `marchTap` 回调里，体力弹窗判定仍交给共享函数。

- [ ] **Step 2: 替换 import 和删除本地体力代码**

顶部加：

```ts
import { handleMarchWithStamina } from '../utils/stamina';
```

删除 10-59 行本地体力定义：`STAMINA_BAR_RECT`、`POTION_USE_BUTTON`、`CLOSE_STAMINA_POPUP`、`MAX_FREE_TILI_CLICKS`、`MAX_POTION_USES`、`TILI_BUTTON_REGION`、`StaminaColor`、`readStaminaColor`、`claimAllFreeStamina`。

在常量区加：

```ts
const TILI_BUTTON_REGION = { x: 1014, y: 242, width: 1588 - 1014, height: 407 - 242 };
const CLOSE_STAMINA_POPUP = { x: 1363, y: 103 };
const SUREGO_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'btn_surego.png');
```

（若 `btn_surego` 路径原已内联，保留原写法。）

- [ ] **Step 3: 用 handleMarchWithStamina 替换行军队列循环**

把原 336-417 行的双 attempt 行军循环替换为：

```ts
  const staminaResult = await handleMarchWithStamina(
    ctx,
    TILI_BUTTON_REGION,
    params.usePotion === true,
    async () => {
      ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
      await ctx.tapRect(MARCH_BUTTON_RECT.x1, MARCH_BUTTON_RECT.y1, MARCH_BUTTON_RECT.x2, MARCH_BUTTON_RECT.y2);
      await ctx.sleep(1);
      // 胜算不足二次确认
      const surego = await ctx.findImageWithLocation(SUREGO_TEMPLATE, 0.6, [0.95, 1.0, 1.05]);
      if (surego.found) {
        ctx.log(`  胜算不足弹窗，点击确认 (${surego.x}, ${surego.y})`);
        await ctx.tap(surego.x, surego.y);
        await ctx.sleep(1);
      }
    },
    async () => {
      await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
      await ctx.sleep(0.5);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      await ctx.tap(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
      await ctx.sleep(2);
    },
  );
  if (staminaResult === 'insufficient') {
    return { result: 'stamina_insufficient', joined: 0, targetType: detectedTarget!, distance: detectedDistance };
  }
  ctx.log(`  ✅ 已加入集结: ${detectedTarget} 距离${detectedDistance}km`);
  return { result: 'joined', joined: 1, targetType: detectedTarget!, distance: detectedDistance };
```

注意核对 joinRally 里关闭按钮和回城 rect 的实际常量名（`CLOSE_POPUP_BUTTON`、`WORLD_SWITCH_BUTTON_RECT`），以文件现有命名为准。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 跑 joinRally 相关测试（若存在）**

Run: `npx jest joinRally --runInBand`
Expected: PASS 或无测试文件。

- [ ] **Step 6: 提交**

```bash
git add plugins/rok/actions/joinRally.ts
git commit -m "refactor(join-rally): use shared stamina util"
```

---

## Task 4: 实现 attackBarbarian.ts 纯函数与骨架

**Files:**
- Create: `plugins/rok/actions/attackBarbarian.ts`
- Test: `plugins/rok/actions/attackBarbarian.test.ts`

- [ ] **Step 1: 写失败测试（±2 级顺序 + 钳制）**

创建 `plugins/rok/actions/attackBarbarian.test.ts`：

```ts
import { neighborLevelOrder } from './attackBarbarian';

describe('neighborLevelOrder', () => {
  it('目标 10 → 9,11,8,12', () => {
    expect(neighborLevelOrder(10, 40)).toEqual([9, 11, 8, 12]);
  });
  it('目标 2 → 1,3,4（去掉越界的 0）', () => {
    expect(neighborLevelOrder(2, 40)).toEqual([1, 3, 4]);
  });
  it('目标 1 → 2,3', () => {
    expect(neighborLevelOrder(1, 40)).toEqual([2, 3]);
  });
  it('目标 40 → 39,38（去掉 41,42）', () => {
    expect(neighborLevelOrder(40, 40)).toEqual([39, 38]);
  });
  it('目标 39 → 38,40,37（去掉 41）', () => {
    expect(neighborLevelOrder(39, 40)).toEqual([38, 40, 37]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest plugins/rok/actions/attackBarbarian.test.ts --runInBand`
Expected: FAIL，无导出。

- [ ] **Step 3: 创建 attackBarbarian.ts 骨架与纯函数**

创建 `plugins/rok/actions/attackBarbarian.ts`，先写常量、类型、纯函数：

```ts
import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';
import { detectTeamStates } from '../utils/teamStateDetection';
import { handleMarchWithStamina } from '../utils/stamina';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fsp from 'fs/promises';
import sharp from 'sharp';

const TEMPLATE_DIR = getTemplatesDir();
const BARB_MAX_LEVEL = 40;

// 搜索面板
const SEARCH_ENTRY_POINT = { x: 82, y: 674 };
const SEARCH_ENTRY_RECT = { x1: 42, y1: 645, x2: 110, y2: 704 };
const BARBARIAN_TAB_POINT = { x: 148, y: 294 };
const LEVEL_MINUS_RECT = { x1: 102, y1: 467, x2: 137, y2: 501 };
const LEVEL_PLUS_RECT = { x1: 539, y1: 467, x2: 576, y2: 501 };
const LEVEL_RESET_BTN = { x: 167, y: 486 };
const LEVEL_OCR_RECT = { x1: 126, y1: 425, x2: 564, y2: 454 };
const SEARCH_ACTION_RECT = { x1: 244, y1: 561, x2: 436, y2: 626 };

// 回城
const WORLD_SWITCH_BUTTON_RECT = { x1: 39, y1: 776, x2: 115, y2: 858 };

// 攻击/编队/行军
const BTN_ATTACK_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_attack.png');
const BTN_BIANDUI_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'btn_biandui.png');
const BTN_XINGJUN_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_xingjun.png');
const BTN_XINGJUN_REGION = { x: 1068, y: 20, width: 362, height: 860 };
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');
const SUREGO_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'btn_surego.png');
const CLOSE_POPUP_BUTTON = { x: 1392, y: 57 };

const MARCH_BUTTON_RECT = { x1: 1031, y1: 754, x2: 1292, y2: 820 };
const MARCH_BUTTON = { x: 1154, y: 791 };
const TILI_BUTTON_REGION = { x: 1014, y: 242, width: 1358 - 1014, height: 407 - 242 };
const CLOSE_STAMINA_POPUP = { x: 1363, y: 103 };

// 队伍按钮（集结界面坐标）
const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 362 }, 2: { x: 1378, y: 430 },
  3: { x: 1378, y: 497 }, 4: { x: 1378, y: 566 }, 5: { x: 1378, y: 633 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 397 }, 2: { x: 1378, y: 463 },
  3: { x: 1378, y: 533 }, 4: { x: 1378, y: 600 }, 5: { x: 1378, y: 671 },
};

// 驻扎头像
const LARGE_REGION = { x: 1443, y: 53, w: 152, h: 753 };
const AVATAR_OFFSET = { dx: -25, dy: -25 };
// 状态列最上方槽位命中区
const TOP_SLOT_REGION = { x1: 1530, y1: 220, x2: 1582, y2: 310 };

const ZHUZHA_WAIT_TIMEOUT_SEC = 300;
const ZHUZHA_POLL_INTERVAL_SEC = 5;

export type AttackBarbarianResult =
  | 'success'
  | 'not_found'
  | 'no_attack_button'
  | 'no_biandui'
  | 'team_unavailable'
  | 'stamina_insufficient'
  | 'zhuzha_timeout';

export interface AttackBarbarianParams {
  level: number;
  count: number;
  team: number;
  teamPage: TeamPage;
  usePotion: boolean;
}

/**
 * 返回 ±2 级邻级的搜索顺序：先 ±1（下、上），再 ±2（下、上），
 * 钳制在 [1, maxLevel] 内并去重。目标 10 → [9,11,8,12]。
 */
export function neighborLevelOrder(target: number, maxLevel: number): number[] {
  const order: number[] = [];
  const seen = new Set<number>([target]);
  const deltas = [-1, +1, -2, +2];
  for (const d of deltas) {
    const lv = target + d;
    if (lv >= 1 && lv <= maxLevel && !seen.has(lv)) {
      order.push(lv);
      seen.add(lv);
    }
  }
  return order;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest plugins/rok/actions/attackBarbarian.test.ts --runInBand`
Expected: PASS（5 个测试）。

- [ ] **Step 5: 提交**

```bash
git add plugins/rok/actions/attackBarbarian.ts plugins/rok/actions/attackBarbarian.test.ts
git commit -m "feat(attack-barbarian): add skeleton and neighbor level order"
```

---

## Task 5: 实现设级与搜索辅助函数

**Files:**
- Modify: `plugins/rok/actions/attackBarbarian.ts`

- [ ] **Step 1: 添加 OCR 读等级、设级、搜索并攻击的内部函数**

在 `neighborLevelOrder` 之后、文件末尾之前加入：

```ts
/** OCR 读取当前搜索等级，失败返回 null（逻辑同 rallyFort.readCurrentFortLevel） */
async function readCurrentLevel(ctx: PluginContext): Promise<number | null> {
  let shot: string | null = null;
  let processed: string | null = null;
  try {
    shot = await ctx.captureRegion(
      LEVEL_OCR_RECT.x1, LEVEL_OCR_RECT.y1,
      LEVEL_OCR_RECT.x2 - LEVEL_OCR_RECT.x1,
      LEVEL_OCR_RECT.y2 - LEVEL_OCR_RECT.y1,
    );
    processed = shot.replace(/\.png$/i, '_lvl.png');
    await sharp(shot)
      .resize({ width: (LEVEL_OCR_RECT.x2 - LEVEL_OCR_RECT.x1) * 3, kernel: 'nearest' })
      .grayscale()
      .normalise()
      .toFile(processed);
    const txt = await ocrService.readChineseText(processed);
    ctx.log(`  [OCR] 打野等级原始识别: "${txt.replace(/\s+/g, ' ')}"`);
    const m = txt.match(/等\s*级[^\d]{0,5}(\d{1,2})/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= BARB_MAX_LEVEL) return n;
    }
    const nums = txt.match(/\d{1,2}/g) || [];
    for (const s of nums) {
      const n = parseInt(s, 10);
      if (n >= 1 && n <= BARB_MAX_LEVEL) return n;
    }
    return null;
  } catch (e) {
    ctx.log(`  [OCR] 打野等级识别异常: ${(e as Error).message}`);
    return null;
  } finally {
    if (shot) await fsp.unlink(shot).catch(() => {});
    if (processed) await fsp.unlink(processed).catch(() => {});
  }
}

/** 设置搜索面板等级到 targetLevel；返回实际设置的等级 */
async function setSearchLevel(ctx: PluginContext, targetLevel: number): Promise<number> {
  const ocrLevel = await readCurrentLevel(ctx);
  if (ocrLevel !== null) {
    const diff = targetLevel - ocrLevel;
    ctx.log(`  OCR 当前 Lv.${ocrLevel} → 目标 Lv.${targetLevel}: ${diff === 0 ? '无需调整' : (diff > 0 ? `+ ×${diff}` : `- ×${-diff}`)}`);
    for (let i = 0; i < Math.abs(diff); i++) {
      if (diff > 0) await ctx.tapRect(LEVEL_PLUS_RECT.x1, LEVEL_PLUS_RECT.y1, LEVEL_PLUS_RECT.x2, LEVEL_PLUS_RECT.y2);
      else await ctx.tapRect(LEVEL_MINUS_RECT.x1, LEVEL_MINUS_RECT.y1, LEVEL_MINUS_RECT.x2, LEVEL_MINUS_RECT.y2);
      await ctx.sleep(0.15);
    }
    return targetLevel;
  }
  ctx.log(`  OCR 失败，fallback: 点重置回 Lv.1 后再加到 Lv.${targetLevel}`);
  await ctx.tap(LEVEL_RESET_BTN.x, LEVEL_RESET_BTN.y);
  await ctx.sleep(0.3);
  for (let i = 0; i < targetLevel - 1; i++) {
    await ctx.tapRect(LEVEL_PLUS_RECT.x1, LEVEL_PLUS_RECT.y1, LEVEL_PLUS_RECT.x2, LEVEL_PLUS_RECT.y2);
    await ctx.sleep(0.15);
  }
  return targetLevel;
}

/**
 * 把面板设到 level 后点搜索，成功则匹配并点击 btn_attack。
 * 前提：搜索面板已打开，且已在野蛮人页签。
 * 返回 'attacked' | 'not_found' | 'no_attack_button'。
 */
async function searchAndAttack(ctx: PluginContext, level: number): Promise<'attacked' | 'not_found' | 'no_attack_button'> {
  await setSearchLevel(ctx, level);
  ctx.log(`  点击搜索按钮 Lv.${level}`);
  const state = await ctx.checkButtonStateChangeRect(
    SEARCH_ACTION_RECT.x1, SEARCH_ACTION_RECT.y1, SEARCH_ACTION_RECT.x2, SEARCH_ACTION_RECT.y2, 0.05,
  );
  if (!state.changed) {
    ctx.log(`  ❌ Lv.${level} 未搜索到野蛮人`);
    return 'not_found';
  }
  await ctx.sleep(2.5);
  const atk = await ctx.findImageWithLocation(BTN_ATTACK_TEMPLATE, 0.7, [0.9, 1.0, 1.1]);
  if (!atk.found) {
    ctx.log(`  ⚠️ 未找到攻击按钮 conf=${atk.confidence.toFixed(3)}`);
    return 'no_attack_button';
  }
  ctx.log(`  攻击按钮 (${atk.x},${atk.y}) conf=${atk.confidence.toFixed(3)}，点击`);
  await ctx.tap(atk.x, atk.y);
  await ctx.sleep(1.5);
  return 'attacked';
}

/**
 * 从 initialLevel 开始搜索：先试 initialLevel，再按 neighborLevelOrder 试 ±2 级。
 * 成功点击攻击后返回命中等级；全部失败返回 null。
 * reopenPanel=true 时先点搜索入口打开面板（不重选页签）。
 */
async function searchWithNeighbors(
  ctx: PluginContext,
  initialLevel: number,
  reopenPanel: boolean,
): Promise<{ level: number; attackState: 'attacked' | 'no_attack_button' } | null> {
  if (reopenPanel) {
    await ctx.tapRect(SEARCH_ENTRY_RECT.x1, SEARCH_ENTRY_RECT.y1, SEARCH_ENTRY_RECT.x2, SEARCH_ENTRY_RECT.y2);
    await ctx.sleep(1.5);
  }
  const candidates = [initialLevel, ...neighborLevelOrder(initialLevel, BARB_MAX_LEVEL)];
  for (let i = 0; i < candidates.length; i++) {
    const lv = candidates[i];
    if (i > 0) {
      // 上一次搜索后面板已关，重新打开（停留在野蛮人页签）
      await ctx.tapRect(SEARCH_ENTRY_RECT.x1, SEARCH_ENTRY_RECT.y1, SEARCH_ENTRY_RECT.x2, SEARCH_ENTRY_RECT.y2);
      await ctx.sleep(1.5);
    }
    const r = await searchAndAttack(ctx, lv);
    if (r === 'attacked') return { level: lv, attackState: 'attacked' };
    if (r === 'no_attack_button') return { level: lv, attackState: 'no_attack_button' };
    // not_found → 试下一个邻级
  }
  return null;
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误（未使用的函数不算错，noUnusedLocals 若开启可能告警；若报错见 Step 3）。

- [ ] **Step 3: 若 noUnusedLocals 报错**

检查 `tsconfig.json` 是否 `noUnusedLocals: true`。若是，这些函数将在 Task 6 被主函数使用，届时引用即消除；本任务先临时在文件末尾加 `void searchWithNeighbors;` 占位，Task 6 删除。若未开启则忽略。

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/actions/attackBarbarian.ts
git commit -m "feat(attack-barbarian): add level set and search-with-neighbors helpers"
```

---

## Task 6: 实现首次攻击与主循环

**Files:**
- Modify: `plugins/rok/actions/attackBarbarian.ts`

- [ ] **Step 1: 添加收尾、首次攻击、等驻扎、后续攻击、主函数**

在 `searchWithNeighbors` 之后追加：

```ts
async function backToCity(ctx: PluginContext): Promise<void> {
  await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
  await ctx.sleep(2);
}

/** 关闭弹窗并回城的通用收尾 */
async function closeAndCity(ctx: PluginContext): Promise<void> {
  await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
  await ctx.sleep(0.5);
  await backToCity(ctx);
}

/** 选中编队按钮（含一次 2s 重试） */
async function tapBiandui(ctx: PluginContext): Promise<boolean> {
  let b = await ctx.findImageWithLocation(BTN_BIANDUI_TEMPLATE, 0.6);
  if (!b.found) {
    ctx.log(`  未检测到编队按钮，等待 2s 后重试一次`);
    await ctx.sleep(2);
    b = await ctx.findImageWithLocation(BTN_BIANDUI_TEMPLATE, 0.6);
  }
  if (!b.found) {
    ctx.log(`  重试后仍未检测到编队按钮`);
    return false;
  }
  ctx.log(`  编队按钮 (${b.x},${b.y}) conf=${b.confidence.toFixed(3)}，点击`);
  await ctx.tap(b.x, b.y);
  await ctx.sleep(1);
  return true;
}

/** 选定队伍并行军（含胜算确认 + 体力处理） */
async function selectTeamAndMarch(
  ctx: PluginContext, team: number, teamPage: TeamPage, usePotion: boolean, logPrefix: string,
): Promise<'marched' | 'team_unavailable' | 'stamina_insufficient'> {
  const page = await ctx.findImageWithLocation(PAGE_INDICATOR_TEMPLATE, 0.8);
  if (page.found) {
    ctx.log(`  [检测] 换页按钮存在 @ (${page.x},${page.y})`);
    const ok = await ensureTeamPage(ctx, teamPage, { x: page.x, y: page.y }, { x: 1361, y: 378, w: 36, h: 35 });
    if (!ok) {
      ctx.log(`  ⚠️ 未能切换到目标队伍页`);
      return 'team_unavailable';
    }
  }
  const buttons = page.found ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
  const btn = buttons[team];
  if (!btn) return 'team_unavailable';
  ctx.log(`  ${logPrefix} 选择队伍${team} 并检测选中状态`);
  const sel = await ctx.checkButtonStateChange(btn.x, btn.y, 150, 50, 0.1);
  if (!sel.changed) {
    ctx.log(`  ⚠️ 队伍${team}不可用`);
    return 'team_unavailable';
  }

  const r = await handleMarchWithStamina(
    ctx,
    TILI_BUTTON_REGION,
    usePotion,
    async () => {
      ctx.log(`  点击行军 (${MARCH_BUTTON.x},${MARCH_BUTTON.y})`);
      await ctx.tapRect(MARCH_BUTTON_RECT.x1, MARCH_BUTTON_RECT.y1, MARCH_BUTTON_RECT.x2, MARCH_BUTTON_RECT.y2);
      await ctx.sleep(1);
      const surego = await ctx.findImageWithLocation(SUREGO_TEMPLATE, 0.6, [0.95, 1.0, 1.05]);
      if (surego.found) {
        ctx.log(`  胜算不足，确认 (${surego.x},${surego.y})`);
        await ctx.tap(surego.x, surego.y);
        await ctx.sleep(1);
      }
    },
    async () => {
      await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
      await ctx.sleep(0.5);
      await closeAndCity(ctx);
    },
  );
  return r === 'marched' ? 'marched' : 'stamina_insufficient';
}

/** 每 5s 全屏检测，直到状态列最上方槽位出现 zhuzha；超时返回 false */
async function waitForTopZhuzha(ctx: PluginContext): Promise<boolean> {
  const deadline = Date.now() + ZHUZHA_WAIT_TIMEOUT_SEC * 1000;
  while (Date.now() < deadline) {
    if (ctx.stopRequested) return false;
    const states = await detectTeamStates(ctx, ['zhuzha']);
    const top = states.find(s =>
      s.x >= TOP_SLOT_REGION.x1 && s.x <= TOP_SLOT_REGION.x2 &&
      s.y >= TOP_SLOT_REGION.y1 && s.y <= TOP_SLOT_REGION.y2,
    );
    if (top) {
      ctx.log(`  驻扎已出现于最上方槽位 (${top.x},${top.y})`);
      return true;
    }
    ctx.log(`  等待驻扎中...（每 ${ZHUZHA_POLL_INTERVAL_SEC}s 检测）`);
    // 分段 sleep 以便响应停止
    for (let i = 0; i < ZHUZHA_POLL_INTERVAL_SEC; i++) {
      if (ctx.stopRequested) return false;
      await ctx.sleep(1);
    }
  }
  return false;
}

/** 点最上方驻扎头像 → 找行军按钮 → 行军 */
async function marchFromGarrison(ctx: PluginContext): Promise<boolean> {
  const states = await detectTeamStates(ctx, ['zhuzha']);
  const z = states.filter(s =>
    s.x >= LARGE_REGION.x && s.x <= LARGE_REGION.x + LARGE_REGION.w &&
    s.y >= LARGE_REGION.y && s.y <= LARGE_REGION.y + LARGE_REGION.h,
  ).sort((a, b) => a.y - b.y)[0];
  if (!z) {
    ctx.log(`  ⚠️ 未找到驻扎队伍`);
    return false;
  }
  const ax = z.x + AVATAR_OFFSET.dx;
  const ay = z.y + AVATAR_OFFSET.dy;
  ctx.log(`  选中最上方驻扎队伍 (${z.x},${z.y}) → 点 (${ax},${ay})`);
  await ctx.tap(ax, ay);
  await ctx.sleep(1);
  const march = await ctx.findImageWithLocation(BTN_XINGJUN_TEMPLATE, 0.7, [0.9, 1.0, 1.1], false, undefined, BTN_XINGJUN_REGION);
  if (!march.found) {
    ctx.log(`  ⚠️ 未找到行军按钮 conf=${march.confidence.toFixed(3)}`);
    return false;
  }
  ctx.log(`  行军按钮 (${march.x},${march.y})，点击`);
  await ctx.tap(march.x, march.y);
  await ctx.sleep(1);
  return true;
}

export async function attackBarbarian(
  ctx: PluginContext,
  config: RokConfig,
  params: AttackBarbarianParams,
): Promise<{ result: AttackBarbarianResult }> {
  const { count, team, teamPage, usePotion } = params;
  let currentLevel = Math.min(Math.max(1, Math.round(params.level)), BARB_MAX_LEVEL);
  ctx.log(`=== 自动打野 Lv.${currentLevel} 队伍${team} 共${count}次 ===`);

  // 预备：OCR 队伍计数，满队则跳过
  const shot = await ctx.captureRegion(1507, 169, 55, 31);
  try {
    const text = (await ocrService.readTeamCount(shot)).trim();
    ctx.log(`[预备] 队伍计数 OCR: "${text}"`);
    const m = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (m) {
      const used = parseInt(m[1], 10), total = parseInt(m[2], 10);
      if (used >= total) {
        ctx.log(`⏭️ 无空闲队伍 (${used}/${total})，跳过打野`);
        await backToCity(ctx);
        return { result: 'team_unavailable' };
      }
    }
  } finally {
    await fsp.unlink(shot).catch(() => {});
  }

  // [1] 切到城外
  await ensureInWorld(ctx, config, { resetView: false });

  for (let i = 0; i < count; i++) {
    ctx.log(`--- 第 ${i + 1}/${count} 次攻击 ---`);

    if (i === 0) {
      // [2] 打开搜索面板 + 野蛮人页签
      await ctx.tapRect(SEARCH_ENTRY_RECT.x1, SEARCH_ENTRY_RECT.y1, SEARCH_ENTRY_RECT.x2, SEARCH_ENTRY_RECT.y2);
      await ctx.sleep(1.5);
      await ctx.tap(BARBARIAN_TAB_POINT.x, BARBARIAN_TAB_POINT.y);
      await ctx.sleep(1);

      // [3-5] 设级 + 搜索（含 ±2）+ 点攻击
      const r = await searchWithNeighbors(ctx, currentLevel, false);
      if (!r) { await backToCity(ctx); return { result: 'not_found' }; }
      if (r.attackState === 'no_attack_button') { await closeAndCity(ctx); return { result: 'no_attack_button' }; }
      currentLevel = r.level;

      // [6] 编队按钮
      if (!await tapBiandui(ctx)) { await closeAndCity(ctx); return { result: 'no_biandui' }; }

      // [7] 选队 + 行军
      const mr = await selectTeamAndMarch(ctx, team, teamPage, usePotion, '[首次]');
      if (mr === 'team_unavailable') { await closeAndCity(ctx); return { result: 'team_unavailable' }; }
      if (mr === 'stamina_insufficient') { return { result: 'stamina_insufficient' }; }
    } else {
      // [9] 重搜（不重选页签）+ 点攻击
      const r = await searchWithNeighbors(ctx, currentLevel, true);
      if (!r) { await backToCity(ctx); return { result: 'not_found' }; }
      if (r.attackState === 'no_attack_button') { await closeAndCity(ctx); return { result: 'no_attack_button' }; }
      currentLevel = r.level;

      // [10] 选中驻扎队伍 [11] 行军
      if (!await marchFromGarrison(ctx)) { await closeAndCity(ctx); return { result: 'no_attack_button' }; }
    }

    // 最后一次出兵后不再等驻扎
    if (i === count - 1) break;

    // [8] 等待驻扎
    ctx.log(`  等待队伍驻扎...`);
    const ok = await waitForTopZhuzha(ctx);
    if (!ok) {
      ctx.log(`  ⚠️ 等待驻扎超时（${ZHUZHA_WAIT_TIMEOUT_SEC}s）或被停止`);
      await backToCity(ctx);
      return { result: ctx.stopRequested ? 'success' : 'zhuzha_timeout' };
    }
  }

  await backToCity(ctx);
  ctx.log(`=== 自动打野完成，共 ${count} 次 ===`);
  return { result: 'success' };
}
```

- [ ] **Step 2: 若 Task 5 加了 `void searchWithNeighbors;` 占位，删除它**

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 跑全部 action 测试**

Run: `npx jest plugins/rok/actions plugins/rok/utils --runInBand`
Expected: PASS（含 stamina、rallyFort、attackBarbarian 测试）。

- [ ] **Step 5: 提交**

```bash
git add plugins/rok/actions/attackBarbarian.ts
git commit -m "feat(attack-barbarian): implement first attack and garrison loop"
```

---

## Task 7: 注册 action

**Files:**
- Modify: `plugins/rok/index.ts`

- [ ] **Step 1: 添加 import**

在 `plugins/rok/index.ts` 顶部 action import 区（与其他 action import 同处）加：

```ts
import { attackBarbarian } from './actions/attackBarbarian';
```

- [ ] **Step 2: 注册 action**

在 actions 数组里 `rally-fort` 注册项之后（约 741 行后）加入：

```ts
    {
      id: 'attack-barbarian',
      name: '自动打野',
      description: '搜索并攻击野蛮人，循环复用驻扎队伍连续攻击',
      run: async (ctx, params: { level?: number; count?: number; team?: number; teamPage?: TeamPage; usePotion?: boolean } = {}) => {
        if (await ensureNoPopupBlocking(ctx, 'attack-barbarian')) return;
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const outcome = await attackBarbarian(ctx, config, {
          level: params.level || 5,
          count: Math.max(1, params.count || 5),
          team: params.team || 1,
          teamPage: params.teamPage || 'attack',
          usePotion: params.usePotion === true,
        });
        ctx.log(`自动打野: ${outcome.result}`);
      }
    },
```

确认 `TeamPage` 类型已在该文件 import（rallyFort 注册已用到 `TeamPage`，应已存在）。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/index.ts
git commit -m "feat(attack-barbarian): register action"
```

---

## Task 8: homeFeatures 新增字段

**Files:**
- Modify: `plugins/rok/homeFeatures.ts`

- [ ] **Step 1: 接口加字段**

在 `HomeFeatures` 接口中 `rallyFortTroopType` 字段（第 43 行）之后加：

```ts
  autoAttackBarbarian: boolean;
  attackBarbarianLevel: number;
  attackBarbarianCount: number;
  attackBarbarianTeam: number;
  attackBarbarianTeamPage: TeamPageChoice;
  attackBarbarianUsePotion: boolean;
```

- [ ] **Step 2: 默认值**

在 `DEFAULT_HOME_FEATURES` 中 `rallyFortTroopType: 'any',`（第 120 行）之后加：

```ts
  autoAttackBarbarian: false,
  attackBarbarianLevel: 5,
  attackBarbarianCount: 5,
  attackBarbarianTeam: 1,
  attackBarbarianTeamPage: 'attack',
  attackBarbarianUsePotion: false,
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/homeFeatures.ts
git commit -m "feat(home): add auto-attack-barbarian feature fields"
```

---

## Task 9: Home.tsx 新增循环

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 读 rallyLoop 作为模板**

读取 `web/src/pages/Home.tsx` 第 1346-1413 行的 `rallyLoop`，照搬其结构（首轮 sleep、offlineActive、acquireLock、ensureGameRunning、createTask、run、结果判定、CD、markRoundDone、finally releaseLock、cooldownResetSeq 等待）。

- [ ] **Step 2: 在 rallyLoop 之后新增 attackBarbarianLoop**

插入：

```ts
      // 自动打野独立循环
      const attackBarbarianLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(12); continue; }
          if (offlineActive) { await sleep(30); continue; }
          const f = featuresRef.current;
          if (f.autoAttackBarbarian && f.attackBarbarianLevel > 0 && !f.autoWorldChat) {
            if (!await acquireLock()) continue;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            try {
              const createResult = await createTask(currentAccountId, 'com.rok.automation', 'attack-barbarian', {
                level: f.attackBarbarianLevel,
                count: f.attackBarbarianCount,
                team: f.attackBarbarianTeam,
                teamPage: f.attackBarbarianTeamPage,
                usePotion: f.attackBarbarianUsePotion,
              });
              if (createResult.success) {
                runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const runResult = await api.tasks.run(createResult.task.id);
                runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
                setRunningTaskIds([...runningTaskIdsRef.current]);
                if (runResult.task.status === 'stopped') { loopStopped = true; return; }
                const logs = runResult.task.logs || [];
                const isSuccess = logs.some((l: any) => String(l.message || '').includes('自动打野: success'));
                const noStamina = logs.some((l: any) => String(l.message || '').includes('自动打野: stamina_insufficient'));
                let cd = 120;
                if (isSuccess) cd = 300;
                if (noStamina) cd = 4500;
                markRoundDone('attack-barbarian', isSuccess);
                const interval = cd * (0.85 + Math.random() * 0.3);
                const startWait = monotonicNow();
                const waitSeq = cooldownResetSeq;
                while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < interval * 1000) {
                  await sleep(1);
                }
              }
            } catch {} finally { releaseLock(); }
          }
          await sleep(60);
        }
      })();
```

注意：以 rallyLoop 实际变量名/工具函数为准（`acquireLock`/`releaseLock`/`ensureGameRunning`/`markRoundDone`/`cooldownResetSeq`/`monotonicNow`/`loopStopped` 等均应已存在）。

- [ ] **Step 3: 加入 Promise.all**

在约 2387 行的 `await Promise.all([...])` 数组中加入 `attackBarbarianLoop`（放在 `rallyLoop` 之后）。

- [ ] **Step 4: computeExpectedActions 加入**

在约 959 行 `computeExpectedActions` 中，`if (f.autoRallyFort ...)` 之后加：

```ts
      if (f.autoAttackBarbarian && f.attackBarbarianLevel > 0) exp.add('attack-barbarian');
```

- [ ] **Step 5: 前端类型检查**

Run: `cd web && VITE_APP_EDITION=main npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): add auto-attack-barbarian loop"
```

---

## Task 10: Home.tsx 新增卡片 UI

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 定位卡片插入点**

读取攻打城寨卡片（约 3204-3345 行），在其结束 `</div>` 之后、加入集结卡片之前插入新卡片。复用现有 CSS 类名与勾选框样式（见记忆 [[home-card-checkbox-style]]：sr-only peer + 自绘方框、amber-500 选中色、禁用态给外层 label）。

- [ ] **Step 2: 插入卡片 JSX**

```tsx
              {/* 自动打野 */}
              <div className={`bg-white rounded-lg shadow-sm border ${features.autoAttackBarbarian ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200'} ${features.autoWorldChat ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <span className="w-6 h-6 bg-red-100 rounded flex items-center justify-center text-xs">⚔️</span>
                    自动打野
                  </span>
                  <button
                    type="button"
                    onClick={() => setFeatures({ ...features, autoAttackBarbarian: !features.autoAttackBarbarian })}
                    className={`relative w-10 h-5 rounded-full transition-colors ${features.autoAttackBarbarian ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${features.autoAttackBarbarian ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
                {features.autoAttackBarbarian && (
                  <>
                    <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100">
                      <span className="text-xs text-slate-500">野蛮人等级</span>
                      <input
                        type="number" min={1} max={40}
                        value={features.attackBarbarianLevel}
                        onChange={(e) => setFeatures({ ...features, attackBarbarianLevel: Math.min(40, Math.max(1, Number(e.target.value) || 1)) })}
                        className="w-16 px-2 py-1 border border-slate-200 rounded text-xs"
                      />
                      <span className="text-xs text-slate-500">次数</span>
                      <input
                        type="number" min={1} max={50}
                        value={features.attackBarbarianCount}
                        onChange={(e) => setFeatures({ ...features, attackBarbarianCount: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })}
                        className="w-16 px-2 py-1 border border-slate-200 rounded text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100">
                      <span className="text-xs text-slate-500">派遣第</span>
                      <select
                        value={features.attackBarbarianTeam}
                        onChange={(e) => setFeatures({ ...features, attackBarbarianTeam: Number(e.target.value) })}
                        className="px-1 py-0.5 bg-white border border-slate-200 rounded text-xs"
                      >
                        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <span className="text-xs text-slate-500">队伍</span>
                      <span className="text-xs text-slate-500 ml-2">队伍页</span>
                      {renderTeamPageSelect(features.attackBarbarianTeamPage, (v) => setFeatures({ ...features, attackBarbarianTeamPage: v }))}
                    </div>
                    <label className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100 cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={features.attackBarbarianUsePotion}
                        onChange={(e) => setFeatures({ ...features, attackBarbarianUsePotion: e.target.checked })}
                      />
                      <span className="w-4 h-4 border border-slate-300 rounded peer-checked:bg-amber-500 peer-checked:border-amber-500 flex items-center justify-center">
                        {features.attackBarbarianUsePotion && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        )}
                      </span>
                      <span className="text-xs text-slate-600">体力不足使用药水</span>
                    </label>
                  </>
                )}
              </div>
```

确认 `renderTeamPageSelect` 在 Home.tsx 中已定义（rallyFort 卡片在用）。蓝/红/黄对应 gather/attack/other。

- [ ] **Step 3: 前端类型检查 + 构建**

Run: `cd web && VITE_APP_EDITION=main npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): add auto-attack-barbarian card UI"
```

---

## Task 11: 全量验证

- [ ] **Step 1: 根类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 2: 前端构建**

Run: `cd web && VITE_APP_EDITION=main npm run build`
Expected: 构建成功。

- [ ] **Step 3: 相关测试**

Run: `npx jest plugins/rok/actions plugins/rok/utils --runInBand`
Expected: 全部 PASS。

- [ ] **Step 4: 手动验证（需连接模拟器）**

1. `npm run server`，`cd web && npm run dev`。
2. 首页出现"自动打野"卡片，设置等级（如 10）、次数（如 3）、队伍、队伍页。
3. 开启开关，观察日志：
   - 首次：城外→搜索面板→野蛮人页签→设级→搜索（若 10 级没有，按 9/11/8/12 顺序试）→点攻击→编队→选队→行军。
   - 出兵后每 5s 检测，最上方槽位出现驻扎后：重开搜索→搜下一个→点攻击→点最上方驻扎头像→点行军。
   - 完成 3 次后回城，日志 `自动打野: success`。
4. 边界：填一个明显无野人的等级区间，确认 ±2 全失败后回城并返回 `not_found`。
5. 停止按钮能在等待驻扎循环中及时中断。

- [ ] **Step 5: 记录待人工核对的坐标**

以下坐标沿用城寨搜索面板，野蛮人页签下若布局有差异需在真机核对：等级 OCR 区 `(126,425,438,29)`、minus/plus rect、搜索按钮 rect。若 OCR 读不到等级或 +/- 点偏，按截图调整 `LEVEL_OCR_RECT`/`LEVEL_MINUS_RECT`/`LEVEL_PLUS_RECT`。
