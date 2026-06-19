# 宝石采集专注模式（gatherGemFocus）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现宝石采集专注模式：持续把队伍维持在采集状态（接续驻扎、收回返回中的队伍），通过最小化重构 `gatherGem.ts` 抽出 4 个可复用单元供 `gatherGemFocus.ts` 编排调用。

**Architecture:** 把 502 行单一函数 `gatherGem` 按职责切成 4 个 internal 单元（`zoomOutToWorld` / `searchAndClickGem` / `checkIdleTeamsAvailable` / `dispatchToTeamPopup`）+ `SpiralState` 数据结构，`gatherGem` 自身改为编排调用以保持原行为，新增 `options.collectedCoords` 注入参数让外部可跨调用持久化已采集坐标。`gatherGemFocus` 在 step1-4 主循环中按状态决定走完整 `gatherGem` 还是直接复用 `searchAndClickGem` 接续驻扎队伍。

**Tech Stack:** TypeScript / Node.js / sharp (image) / tesseract.js (OCR) / 自研 Vision 模板匹配 / ADB 设备抽象。规范 reference: `docs/superpowers/specs/2026-06-19-gather-gem-focus-design.md`。

---

## File Structure

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `plugins/rok/actions/gatherGem.ts` | 宝石采集普通模式；新增可复用单元（zoomOutToWorld、SpiralState、createSpiralState、searchAndClickGem、checkIdleTeamsAvailable、dispatchToTeamPopup）；主流程改为编排调用 | 重构（单文件内拆分） |
| `plugins/rok/actions/gatherGemFocus.ts` | 专注模式主循环（step1-4）；`detectTeamStates` 参数化（region + states 子集） | 重写主流程 |
| `plugins/rok/index.ts` | 删除 `gem-gather-focus` action 中的 OCR pre-check 段 | 修改（删段） |
| `plugins/rok/templates/btn_xingjun.png` | 大 UI 中的行军按钮模板 | 新增（用户已截图准备） |

---

## Task 1: gatherGem.ts — 抽出 zoomOutToWorld + SpiralState

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts`

**目标：** 把内联的 `doZoomOut` 闭包提升为 `export function zoomOutToWorld`；把散落的螺旋搜索状态变量封装为 `SpiralState` 接口 + `createSpiralState` 工厂。`gatherGem` 主流程内部改用提升后的形式调用，外部行为不变。

- [ ] **Step 1: 在 gatherGem.ts 顶部（紧接 isGemOccupied 之后、`export interface GemGatherOutcome` 之前）新增 `SpiralState` 接口、`createSpiralState` 工厂、`zoomOutToWorld` 函数**

```typescript
export interface SpiralState {
  step: number;
  dirIndex: number;
  moveCount: number;
  dirSwipes: number;
  checkedCenter: boolean;
  halfW: number;
  halfH: number;
  maxAttempts: number;
}

export function createSpiralState(config: RokConfig): SpiralState {
  const gg = config.gemGather;
  return {
    step: 1,
    dirIndex: 0,
    moveCount: 0,
    dirSwipes: 0,
    checkedCenter: false,
    halfW: Math.round(1600 * (gg.spiralSwipeRatioH ?? gg.spiralSwipeRatio) / 2),
    halfH: Math.round(900 * gg.spiralSwipeRatio / 2),
    maxAttempts: gg.searchMaxAttempts,
  };
}

export async function zoomOutToWorld(
  ctx: PluginContext,
  worldBtn: { x: number; y: number }
): Promise<void> {
  ctx.log(`  长按城内外按钮 (${worldBtn.x}, ${worldBtn.y}) 2秒`);
  await ctx.swipeAndHold(worldBtn.x, worldBtn.y, worldBtn.x, worldBtn.y, 2000);
  await ctx.releaseHold();
  await ctx.sleep(0.5);
  ctx.log(`  点击 (322, 700) 完成缩放`);
  await ctx.tap(322, 700);
  await ctx.sleep(0.5);
}
```

- [ ] **Step 2: 删除 gatherGem 函数体中第 159-167 行的 `doZoomOut` 闭包**

删除如下代码块：

```typescript
const doZoomOut = async () => {
  ctx.log(`  长按城内外按钮 (${worldBtn.x}, ${worldBtn.y}) 2秒`);
  await ctx.swipeAndHold(worldBtn.x, worldBtn.y, worldBtn.x, worldBtn.y, 2000);
  await ctx.releaseHold();
  await ctx.sleep(0.5);
  ctx.log(`  点击 (322, 700) 完成缩放`);
  await ctx.tap(322, 700);
  await ctx.sleep(0.5);
};
```

- [ ] **Step 3: 把 gatherGem 函数体中所有 `await doZoomOut()` 调用替换为 `await zoomOutToWorld(ctx, worldBtn)`**

文件中共有 4 处 `doZoomOut()` 调用（行 168、282、308、326、496）。逐一替换为 `zoomOutToWorld(ctx, worldBtn)`。

- [ ] **Step 4: 编译检查**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: 无关于 gatherGem.ts 的错误

- [ ] **Step 5: 提交**

```bash
cd D:/SLG && git add plugins/rok/actions/gatherGem.ts
git commit -m "refactor(gem): 抽出 zoomOutToWorld 函数 + SpiralState 接口"
```

---

## Task 2: gatherGem.ts — 抽出 checkIdleTeamsAvailable

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts`

**目标：** 把 `[5/7] 检测空闲队伍` 段的 `AddTeamBtn` 像素对比抽成独立函数。

- [ ] **Step 1: 在 zoomOutToWorld 之后新增 checkIdleTeamsAvailable 函数**

```typescript
export async function checkIdleTeamsAvailable(ctx: PluginContext): Promise<boolean> {
  const { width: addTeamW = 80, height: addTeamH = 80 } = await sharp(ADD_TEAM_BTN_TEMPLATE).metadata();
  const x = 1517 - Math.floor(addTeamW! / 2);
  const y = 130 - Math.floor(addTeamH! / 2);
  const regionPath = await ctx.captureRegion(x, y, addTeamW!, addTeamH!);
  try {
    const diff = await ctx.compareImages(regionPath, ADD_TEAM_BTN_TEMPLATE);
    ctx.log(`  AddTeamBtn 匹对差异: ${(diff * 100).toFixed(1)}%`);
    return diff < 0.3;
  } finally {
    await fs.unlink(regionPath).catch(() => {});
  }
}
```

- [ ] **Step 2: 替换 gatherGem 函数体内 `[5/7]` 段（约 341-357 行）**

把以下整段：

```typescript
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
  await ctx.sleep(1.5 + Math.random() * 1.0);
  break;
}
await fs.unlink(addTeamRegionPath).catch(() => {});
ctx.log(`  有空闲队伍，继续`);
```

替换为：

```typescript
ctx.log(`  [5/7] 检测是否有空闲队伍...`);
const idleAvailable = await checkIdleTeamsAvailable(ctx);
if (!idleAvailable) {
  ctx.log(`  ⚠️ 没有空闲队伍，停止采集，切换回城内`);
  await ctx.tap(worldBtn.x, worldBtn.y);
  await ctx.sleep(1.5 + Math.random() * 1.0);
  break;
}
ctx.log(`  有空闲队伍，继续`);
```

- [ ] **Step 3: 编译检查**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
cd D:/SLG && git add plugins/rok/actions/gatherGem.ts
git commit -m "refactor(gem): 抽出 checkIdleTeamsAvailable 函数"
```

---

## Task 3: gatherGem.ts — 抽出 searchAndClickGem

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts`

**目标：** 把 `[3/7] 螺旋搜矿 + [4/7] 点击宝石矿 + 占用检测 + 重复坐标过滤 + 采集按钮检测` 整个内层循环抽成独立函数，原地修改 `spiralState` 和 `collectedCoords`。

- [ ] **Step 1: 在 checkIdleTeamsAvailable 之后新增 searchAndClickGem 函数**

```typescript
/**
 * 螺旋搜矿 → 点击宝石 → 占用/重复检测 → 找采集按钮（点中）。
 * 内部循环：找到一颗满足条件的宝石（未占用、未重复采集、采集按钮可点）才返回 found:true。
 * 否则螺旋耗尽返回 found:false。
 *
 * 原地修改 spiralState（沿用螺旋进度）和 collectedCoords（追加新采坐标——点中采集按钮后由调用者负责追加，
 * 此函数仅做读侧检查，不做写入）。
 */
export async function searchAndClickGem(
  ctx: PluginContext,
  config: RokConfig,
  spiralState: SpiralState,
  collectedCoords: Array<{ x: number; y: number }>
): Promise<{ found: true; x: number; y: number } | { found: false }> {
  const gg = config.gemGather;
  const caijiBtnTemplate = path.join(TEMPLATE_DIR, gg.caijiBtnTemplate);
  const worldBtn = config.resourceCollect.worldSwitchButton;

  while (true) {
    let gemFound = false;
    let gemX = 0, gemY = 0;

    if (!spiralState.checkedCenter) {
      spiralState.checkedCenter = true;
      const initDets = await ctx.detectWithScreenshot(0.5);
      ctx.log(`  [搜索] 中心(5) 找到 ${initDets.length} 个宝石候选`);
      const initValid = initDets.find(d => !isInChatZone(d.x, d.y));
      if (initValid) {
        if (await isGemOccupied(ctx, initValid.x, initValid.y)) {
          ctx.log(`  宝石 (${initValid.x}, ${initValid.y}) 已被占用，继续搜索`);
        } else {
          gemX = initValid.x; gemY = initValid.y;
          ctx.log(`  找到空闲宝石矿 (${gemX}, ${gemY}) confidence: ${initValid.confidence.toFixed(3)}`);
          gemFound = true;
        }
      }
    }

    while (!gemFound && spiralState.moveCount < spiralState.maxAttempts) {
      const dir = SPIRAL_DIRECTIONS[spiralState.dirIndex % 4];

      while (
        spiralState.dirSwipes < spiralState.step &&
        !gemFound &&
        spiralState.moveCount < spiralState.maxAttempts
      ) {
        const fromX = dir.dx !== 0 ? (800 + dir.dx * spiralState.halfW) : 850;
        const fromY = dir.dy !== 0 ? (450 + dir.dy * spiralState.halfH) : 450;
        const toX   = dir.dx !== 0 ? (800 - dir.dx * spiralState.halfW) : 850;
        const toY   = dir.dy !== 0 ? (450 - dir.dy * spiralState.halfH) : 450;
        spiralState.moveCount++;
        spiralState.dirSwipes++;
        await ctx.swipe(fromX, fromY, toX, toY, 500);
        await ctx.sleep(1 + Math.random() * 0.5);

        const detections = await ctx.detectWithScreenshot(0.5);
        ctx.log(`  [搜索] ${SPIRAL_DIR_NAMES[spiralState.dirIndex % 4]}(${spiralState.moveCount}) 找到 ${detections.length} 个宝石候选`);
        const validDet = detections.find(d => !isInChatZone(d.x, d.y));
        if (validDet) {
          if (await isGemOccupied(ctx, validDet.x, validDet.y)) {
            ctx.log(`  宝石 (${validDet.x}, ${validDet.y}) 已被占用，继续搜索`);
          } else {
            gemX = validDet.x; gemY = validDet.y;
            ctx.log(`  找到空闲宝石矿 (${gemX}, ${gemY}) confidence: ${validDet.confidence.toFixed(3)}`);
            gemFound = true;
            break;
          }
        }
      }

      if (gemFound) break;
      if (spiralState.dirIndex % 2 === 1) spiralState.step++;
      spiralState.dirIndex++;
      spiralState.dirSwipes = 0;
    }

    if (!gemFound) return { found: false };

    // 点击宝石矿
    ctx.log(`  [4/7] 点击宝石矿 (${gemX}, ${gemY})`);
    await ctx.tap(gemX, gemY);
    await ctx.sleep(1.5);

    // 检测采集状态标志（已被占用）
    {
      const caiJiRegionPath = await ctx.captureRegion(745, 360, 157, 142);
      try {
        const caiJiResult = await vision.findImage(caiJiRegionPath, CAIJI_STATE_TEMPLATE, 0.6);
        if (isDevEnv()) {
          try {
            const DEBUG_DIR = 'D:/SLG/temp/debug/caiji';
            await fs.mkdir(DEBUG_DIR, { recursive: true });
            const caiJiMeta = await sharp(caiJiRegionPath).metadata();
            const w = caiJiMeta.width!, h = caiJiMeta.height!;
            const label = caiJiResult.found ? 'OCCUPIED' : 'FREE';
            const color = caiJiResult.found ? '#ff4444' : '#44aa44';
            const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="${color}" stroke-width="2" rx="1"/>
              <rect x="2" y="${h - 20}" width="${w - 4}" height="18" fill="${color}" rx="1"/>
              <text x="${w / 2}" y="${h - 6}" font-family="Arial" font-size="10" font-weight="bold" fill="white" text-anchor="middle">${label} ${caiJiResult.confidence.toFixed(2)}</text>
            </svg>`;
            const outPath = path.join(DEBUG_DIR, `caiji_${label}_${Date.now()}.png`);
            await sharp(caiJiRegionPath)
              .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
              .toFile(outPath);
          } catch {}
        }
        if (caiJiResult.found) {
          ctx.log(`  🔄 该宝石已有队伍在采集 (confidence: ${caiJiResult.confidence.toFixed(3)})，缩地后继续螺旋`);
          await fs.unlink(caiJiRegionPath).catch(() => {});
          await zoomOutToWorld(ctx, worldBtn);
          await ctx.sleep(1);
          continue;
        }
      } finally {
        await fs.unlink(caiJiRegionPath).catch(() => {});
      }
    }

    ctx.log(`  点击放大后的目标 (${gg.pinchedGemTapPoint.x}, ${gg.pinchedGemTapPoint.y})`);
    await ctx.tap(gg.pinchedGemTapPoint.x, gg.pinchedGemTapPoint.y);
    await ctx.sleep(1);

    // 重复坐标检测
    if (collectedCoords.length > 0) {
      const coordRegionPath = await ctx.captureRegion(
        COORD_REGION.x, COORD_REGION.y, COORD_REGION.w, COORD_REGION.h
      );
      try {
        const coordText = await ocrService.readText(coordRegionPath);
        const curCoord = parseCoord(coordText);
        const recorded = collectedCoords.map(c => `(${c.x},${c.y})`).join(', ');
        ctx.log(`  [坐标] 当前: ${coordText} → ${curCoord ? `(${curCoord.x},${curCoord.y})` : '解析失败'} | 已采集: [${recorded}]`);
        if (curCoord && isCoordRecorded(curCoord.x, curCoord.y, collectedCoords)) {
          ctx.log(`  ⚠️ 该宝石已采集过，缩地后继续螺旋`);
          await zoomOutToWorld(ctx, worldBtn);
          await ctx.sleep(1);
          continue;
        }
      } finally {
        await fs.unlink(coordRegionPath).catch(() => {});
      }
    }

    // 识别采集按钮
    ctx.log(`  搜索采集按钮 ${gg.caijiBtnTemplate}`);
    const caijiResult = await ctx.findImageWithLocation(caijiBtnTemplate, 0.7);
    if (caijiResult.found) {
      ctx.log(`  点击采集按钮 (${caijiResult.x}, ${caijiResult.y})`);
      await ctx.tap(caijiResult.x, caijiResult.y);
      await ctx.sleep(1.5);
      return { found: true, x: gemX, y: gemY };
    }
    ctx.log(`  ❌ 未找到采集按钮 (confidence: ${caijiResult.confidence.toFixed(3)})，缩地后继续螺旋`);
    await zoomOutToWorld(ctx, worldBtn);
    await ctx.sleep(1);
  }
}
```

- [ ] **Step 2: 编译检查（确认新函数自身无语法错误，旧主流程暂时仍引用旧逻辑）**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: 无错误（gatherGem 主流程内的旧螺旋代码尚未替换，但因变量重名问题需在下一步完成主流程改造后再检测）

如本步出现"重复声明"等错误，跳过本步，待 Step 3 后再统一检测。

- [ ] **Step 3: 替换 gatherGem 主流程内 `[3/7]` `[4/7]` 整段为 searchAndClickGem 调用**

需替换的范围：从 `// 螺旋搜索状态（全程接续，不因换队重置）` 到 `if (!gemFound) { ... break; }` 闭合（约 171-338 行）。

替换为：

```typescript
const spiralState = createSpiralState(config);
ctx.log(`[3/7] 方形螺旋搜索宝石矿（YOLO 检测, 上限 ${gg.searchMaxAttempts} 步）`);

let gemCount = 0;
while (true) {
  gemCount++;
  ctx.log(`--- 搜索第 ${gemCount} 颗宝石矿 ---`);

  const gem = await searchAndClickGem(ctx, config, spiralState, collectedCoords);
  if (!gem.found) {
    ctx.log(`  ❌ 搜索耗尽(${spiralState.moveCount}步)，未找到空闲宝石矿，任务完成`);
    await ctx.tap(worldBtn.x, worldBtn.y);
    await ctx.sleep(0.8 + Math.random() * 0.7);
    await ctx.tap(worldBtn.x, worldBtn.y);
    await ctx.sleep(1.5 + Math.random() * 1.0);
    break;
  }

  // [5/7] 检测空闲队伍 + [6/7] 选队伍弹窗 + [7/7] 派出 — 保持原逻辑（已在后续步骤中调用 checkIdleTeamsAvailable）
```

注意：替换段尾留下的 `[5/7]…[7/7]` 段保持原状，但外层 `while` 已在新代码顶部声明，需删除原代码中的 `while (true) { gemCount++; ... }` 起始行（保留循环体内的 `[5/7]` 到 `dispatchedThisGem` 段，以及结尾的 `await doZoomOut()` 已在 Task 1 改成 `zoomOutToWorld`）。

完成形态：原 `[5/7]` 块（已在 Task 2 改造）紧接 `if (!gem.found)` 处理后；原 while 循环末尾的接续 `await zoomOutToWorld()` + `await ctx.sleep(1)` 仍保留。

- [ ] **Step 4: 编译检查**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: 无错误

- [ ] **Step 5: 手工核对 gatherGem 主流程**

打开 `gatherGem.ts`，确认主函数体内：
- 顶部仍有 `[1/7] ensureInWorld` + `[2/7] zoomOutToWorld`
- 然后 `createSpiralState` + 外层 while 循环
- 循环内：`searchAndClickGem` → `checkIdleTeamsAvailable` → `[6/7]/[7/7]` 派队段
- 循环末尾仍有缩地接续

- [ ] **Step 6: 提交**

```bash
cd D:/SLG && git add plugins/rok/actions/gatherGem.ts
git commit -m "refactor(gem): 抽出 searchAndClickGem 函数"
```

---

## Task 4: gatherGem.ts — 抽出 dispatchToTeamPopup + 给 gatherGem 加 options

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts`

**目标：** 把 `[6/7] 选队伍弹窗 + 部队页切换 + [7/7] 逐队尝试 + 派出后记录坐标 + OCR 队伍计数检查` 整段抽成 `dispatchToTeamPopup`；同时给 `gatherGem` 加 `options?: { collectedCoords? }` 让外部可注入跨调用持久化数组。

- [ ] **Step 1: 在 searchAndClickGem 之后新增 DispatchResult 接口和 dispatchToTeamPopup 函数**

```typescript
export interface DispatchResult {
  dispatched: boolean;
  nextTeamIdx: number;
  hasPaging: boolean | null;
  allTeamsBusy: boolean;
}

/**
 * 派出队伍弹窗内逐个尝试队伍：从 nextTeamIdx 开始向后尝试到 teams 末尾（不回绕）。
 * 派出成功后追加当前坐标到 collectedCoords，再 OCR 检测剩余空闲队伍数。
 *
 * - hasPaging=null 时本函数会自检并写回结果（首次调用语义）
 * - allTeamsBusy=true 表示全部已派出（OCR 显示 N/N），调用者应停止采集
 * - dispatched=false 表示弹窗内所有可尝试队伍都不可用（已自动关闭弹窗）
 */
export async function dispatchToTeamPopup(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[],
  nextTeamIdx: number,
  hasPaging: boolean | null,
  collectedCoords: Array<{ x: number; y: number }>
): Promise<DispatchResult> {
  ctx.log(`  [6/7] 点击选择队伍按钮 (${SELECT_TEAM_BUTTON.x}, ${SELECT_TEAM_BUTTON.y})`);
  await ctx.tap(SELECT_TEAM_BUTTON.x, SELECT_TEAM_BUTTON.y);
  await ctx.sleep(1);

  let pageSwitchButton: { x: number; y: number } | null = null;
  if (hasPaging === null) {
    const pageResult = await ctx.findImageWithLocation(PAGE_INDICATOR_TEMPLATE, 0.8);
    hasPaging = pageResult.found;
    if (hasPaging) {
      pageSwitchButton = { x: pageResult.x, y: pageResult.y };
      ctx.log(`  [检测] 换页按钮: 存在 (>7组) @ (${pageResult.x},${pageResult.y})`);
    } else {
      ctx.log(`  [检测] 换页按钮: 不存在 (≤7组)`);
    }
  } else if (hasPaging) {
    const pageResult = await ctx.findImageWithLocation(PAGE_INDICATOR_TEMPLATE, 0.8);
    if (pageResult.found) {
      pageSwitchButton = { x: pageResult.x, y: pageResult.y };
    }
  }

  if (hasPaging && pageSwitchButton) {
    const onTargetPage = await ensureTeamPage(ctx, 'gather', pageSwitchButton);
    if (!onTargetPage) {
      ctx.log(`  ⚠️ 未能切换到采集队伍页，关闭弹窗`);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      return { dispatched: false, nextTeamIdx, hasPaging, allTeamsBusy: false };
    }
  }

  const teamButtons = (hasPaging ?? false) ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;

  if (nextTeamIdx >= teams.length) {
    ctx.log(`  所有配置队伍已派出（${teams.length}队），关闭弹窗`);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    return { dispatched: false, nextTeamIdx, hasPaging, allTeamsBusy: false };
  }

  let dispatched = false;
  let allTeamsBusy = false;
  let newNextTeamIdx = nextTeamIdx;

  for (let ti = nextTeamIdx; ti < teams.length; ti++) {
    const tryTeam = teams[ti];
    const teamBtn = teamButtons[tryTeam];
    if (!teamBtn) {
      ctx.log(`  ❌ 无效的队伍序号: ${tryTeam}`);
      continue;
    }

    ctx.log(`  [7/7] 尝试队伍 ${tryTeam} (配置第${ti + 1}队) 并检测状态变化...`);
    const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
    ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

    if (!stateResult.changed) {
      ctx.log(`  ⚠️ 队伍${tryTeam}不可用，尝试下一队`);
      continue;
    }

    await ctx.sleep(0.3 + Math.random() * 0.4);
    ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
    await ctx.tap(MARCH_BUTTON.x, MARCH_BUTTON.y);
    await ctx.sleep(0.8 + Math.random() * 0.7);

    newNextTeamIdx = (ti === teams.length - 1) ? 0 : ti + 1;
    ctx.log(`  ✅ 队伍${tryTeam} 已派出（下次从第${newNextTeamIdx + 1}队开始）`);

    {
      const coordRegionPath = await ctx.captureRegion(
        COORD_REGION.x, COORD_REGION.y, COORD_REGION.w, COORD_REGION.h
      );
      try {
        const coordText = await ocrService.readText(coordRegionPath);
        ctx.log(`  [坐标] 记录已采集: ${coordText}`);
        const curCoord = parseCoord(coordText);
        if (curCoord) {
          collectedCoords.push(curCoord);
        } else {
          ctx.log(`  [坐标] 解析失败，跳过记录`);
        }
      } finally {
        await fs.unlink(coordRegionPath).catch(() => {});
      }
    }

    ctx.log(`  [OCR] 检测剩余空闲队伍数...`);
    const teamRegionPath = await ctx.captureRegion(1507, 169, 55, 31);
    try {
      const teamText = await ocrService.readText(teamRegionPath);
      ctx.log(`  [OCR] 结果: "${teamText}"`);
      const tm = teamText.match(/(\d+)\s*\/\s*(\d+)/);
      if (tm) {
        const used = parseInt(tm[1], 10);
        const total = parseInt(tm[2], 10);
        if (used === total) {
          ctx.log(`  ⏭️ 队伍已全部派出 (${used}/${total})`);
          allTeamsBusy = true;
        } else {
          ctx.log(`  剩余空闲队伍: ${total - used} (${used}/${total})`);
        }
      }
    } finally {
      await fs.unlink(teamRegionPath).catch(() => {});
    }

    dispatched = true;
    break;
  }

  if (!dispatched) {
    ctx.log(`  所有队伍不可用，关闭弹窗`);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
  }

  return { dispatched, nextTeamIdx: newNextTeamIdx, hasPaging, allTeamsBusy };
}
```

- [ ] **Step 2: 修改 gatherGem 函数签名加 options 参数**

把：

```typescript
export async function gatherGem(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[]
): Promise<GemGatherOutcome> {
```

改为：

```typescript
export async function gatherGem(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[],
  options?: { collectedCoords?: Array<{ x: number; y: number }> }
): Promise<GemGatherOutcome> {
```

并把函数体内 `const collectedCoords: Array<{ x: number; y: number }> = [];` 一行改为：

```typescript
const collectedCoords = options?.collectedCoords ?? [];
```

- [ ] **Step 3: 替换 gatherGem 函数体内 `[6/7]/[7/7]` 整段为 dispatchToTeamPopup 调用**

替换范围：从 `// [6/7] 点击选择队伍按钮` 到 for 循环结束 + `if (!dispatchedThisGem) { ... break; } if (allTeamsBusy) { ... break; }`（约 360-493 行）。

替换为：

```typescript
const r = await dispatchToTeamPopup(ctx, config, teams, nextTeamIdx, hasPaging, collectedCoords);
hasPaging = r.hasPaging;
nextTeamIdx = r.nextTeamIdx;
if (r.dispatched) dispatched++;

if (!r.dispatched) {
  ctx.log(`  无可用队伍，任务完成`);
  break;
}
if (r.allTeamsBusy) {
  ctx.log(`  队伍已全部派出，任务完成`);
  break;
}
```

- [ ] **Step 4: 编译检查**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
cd D:/SLG && git add plugins/rok/actions/gatherGem.ts
git commit -m "refactor(gem): 抽出 dispatchToTeamPopup + gatherGem 加 options.collectedCoords"
```

---

## Task 5: 用户准备 btn_xingjun.png 模板

**Files:**
- Create: `plugins/rok/templates/btn_xingjun.png`

**目标：** 让用户截图大 UI 中的"行军"按钮，裁剪后放进 templates 目录。

- [ ] **Step 1: 提示用户准备模板（暂停等待）**

实施 agent 在执行该任务时输出：

> 请准备模板：在 1600×900 分辨率下，从大 UI（右侧 1443-1595, 53-806 区域）某个驻扎队伍点开后看到的"行军"按钮（位置不固定，因此需要模板检索）。截取按钮图标，裁剪到约 60-100px 大小，命名为 `btn_xingjun.png` 放进 `D:/SLG/plugins/rok/templates/` 目录。

如用户未准备好，则继续后续 task；该模板在 Task 7 实际运行 step 4 路径时才会被加载。

- [ ] **Step 2: 验证模板存在（用户放好后）**

Run: `ls D:/SLG/plugins/rok/templates/btn_xingjun.png`
Expected: 文件存在

- [ ] **Step 3: 提交模板**

```bash
cd D:/SLG && git add plugins/rok/templates/btn_xingjun.png
git commit -m "assets: 新增大 UI 行军按钮模板 btn_xingjun.png"
```

---

## Task 6: gatherGemFocus.ts — detectTeamStates 参数化

**Files:**
- Modify: `plugins/rok/actions/gatherGemFocus.ts`

**目标：** 把 `detectTeamStates` 改为接受可选 `region` 和 `states` 参数，默认值维持原行为。

- [ ] **Step 1: 修改 detectTeamStates 签名和实现**

把当前 `export async function detectTeamStates(ctx: PluginContext): Promise<DetectedState[]>` 改为：

```typescript
export async function detectTeamStates(
  ctx: PluginContext,
  region: { x: number; y: number; w: number; h: number } = STATUS_REGION,
  states: TeamState[] = ['zhuzha', 'caiji', 'back', 'totarget']
): Promise<DetectedState[]> {
  ctx.log(`[状态检测] 截取区域 (${region.x},${region.y}) ${region.w}x${region.h} states=[${states.join(',')}]`);
  const regionPath = await ctx.captureRegion(region.x, region.y, region.w, region.h);

  try {
    const results: DetectedState[] = [];
    const drawRects: { y: number; h: number; state: string; confidence: number }[] = [];

    for (const state of states) {
      const templatePath = STATE_TEMPLATES[state];
      const tplMeta = await sharp(templatePath).metadata();
      const tplH = tplMeta.height || 24;

      const matches = await vision.findAllImages(regionPath, templatePath, 0.65);
      ctx.log(`  [${state}] 匹配到 ${matches.length} 个`);
      for (const m of matches) {
        const screenY = m.location.y + region.y;
        results.push({ state, y: screenY, confidence: m.confidence });
        ctx.log(`    y=${screenY} conf=${(m.confidence * 100).toFixed(1)}%`);
        drawRects.push({
          y: m.location.y,
          h: Math.round(tplH),
          state,
          confidence: m.confidence,
        });
      }
    }

    // 调试 SVG 截图保留
    if (isDevEnv()) {
      try {
        await fs.mkdir(DEBUG_DIR, { recursive: true });
        const regionMeta = await sharp(regionPath).metadata();
        const w = regionMeta.width!;
        const h = regionMeta.height!;

        const colors: Record<string, string> = {
          zhuzha: '#f59e0b',
          caiji: '#22c55e',
          back: '#ef4444',
          totarget: '#3b82f6',
        };

        let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#666" stroke-width="1"/>`;
        for (let gy = 0; gy < h; gy += 50) {
          svg += `<line x1="0" y1="${gy}" x2="${w}" y2="${gy}" stroke="#444" stroke-width="0.5" stroke-dasharray="3,3"/>
            <text x="2" y="${gy + 10}" font-family="Arial" font-size="9" fill="#888">y=${gy + region.y}</text>`;
        }
        for (const r of drawRects) {
          const color = colors[r.state] || '#fff';
          const label = `${r.state} ${(r.confidence * 100).toFixed(0)}%`;
          const textW = label.length * 9 + 12;
          const boxY = Math.max(0, r.y - 2);
          const boxH = Math.min(h - boxY, r.h + 4);
          svg += `
            <rect x="0" y="${boxY}" width="${w}" height="${boxH}"
                  fill="none" stroke="${color}" stroke-width="2" rx="1"/>
            <rect x="2" y="${Math.max(0, r.y - 16)}" width="${textW}" height="16"
                  fill="${color}" rx="2" opacity="0.9"/>
            <text x="8" y="${Math.max(16, r.y - 2)}" font-family="Arial" font-size="11"
                  font-weight="bold" fill="white">${label}</text>`;
        }
        if (drawRects.length === 0) {
          svg += `<text x="${w / 2}" y="${h / 2}" font-family="Arial" font-size="12" fill="#f44" text-anchor="middle">无匹配</text>`;
        }
        svg += '</svg>';

        const outPath = path.join(DEBUG_DIR, `focus_state_${Date.now()}.png`);
        await sharp(regionPath)
          .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
          .toFile(outPath);
        ctx.log(`  [调试] 截图已保存: ${outPath}`);
      } catch (e: any) {
        ctx.log(`  [调试] 保存截图失败: ${e.message}`);
      }
    }

    results.sort((a, b) => a.y - b.y);
    return results;
  } finally {
    await fs.unlink(regionPath).catch(() => {});
  }
}
```

- [ ] **Step 2: 编译检查**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
cd D:/SLG && git add plugins/rok/actions/gatherGemFocus.ts
git commit -m "refactor(focus): detectTeamStates 参数化（region + states）"
```

---

## Task 7: gatherGemFocus.ts — 实现 step1-4 主循环

**Files:**
- Modify: `plugins/rok/actions/gatherGemFocus.ts`

**目标：** 替换 stub 为完整 step1-4 主循环。

- [ ] **Step 1: 在 gatherGemFocus.ts 顶部 imports 区追加**

```typescript
import { RokConfig } from '../index';
import {
  gatherGem,
  zoomOutToWorld,
  searchAndClickGem,
  checkIdleTeamsAvailable,
  dispatchToTeamPopup,
  createSpiralState,
} from './gatherGem';
```

并删除原文件顶部 `import { Vision }`（继续保留 `vision` 实例不再被需要——确认顺路删除：实际上 `detectTeamStates` 内还使用 `vision.findAllImages`，**保留** vision 引用）。

- [ ] **Step 2: 在 STATUS_REGION 之后追加常量**

```typescript
const LARGE_REGION  = { x: 1443, y: 53,  w: 152, h: 753 };
const ZHUZHA_BUTTON = { x: 800, y: 593 };
const EXIT_LARGE_UI_BUTTON = { x: 70, y: 834 };
const MARCH_BTN_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_xingjun.png');
const MARCH_SEARCH_REGION = { x: 1068, y: 20, width: 362, height: 860 };
const BACK_RETRY_LIMIT = 5;
```

- [ ] **Step 3: 替换 gatherGemFocus 整个函数体**

把当前的 stub：

```typescript
export async function gatherGemFocus(
  ctx: PluginContext,
  _config: any,
  _teams: number[]
): Promise<GemGatherOutcome> {
  ctx.log('[专注模式] 状态检测可行性测试');
  const states = await detectTeamStates(ctx);
  const counts: Record<string, number> = {};
  for (const s of states) {
    counts[s.state] = (counts[s.state] || 0) + 1;
  }
  ctx.log(`[专注模式] 检测完成: ${states.length} 个状态 → ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ') || '无'}`);
  return { result: 'success', dispatched: 0 };
}
```

替换为：

```typescript
export async function gatherGemFocus(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[]
): Promise<GemGatherOutcome> {
  ctx.log(`=== 宝石采集专注模式 队伍[${teams.join(', ')}] ===`);
  const worldBtn = config.resourceCollect.worldSwitchButton;
  const collectedCoords: Array<{ x: number; y: number }> = [];
  const spiralState = createSpiralState(config);
  let dispatched = 0;
  let hasPaging: boolean | null = null;

  while (true) {
    // === step 1: 处理返回中的队伍 ===
    let backRetry = 0;
    while (backRetry < BACK_RETRY_LIMIT) {
      const back = await detectTeamStates(ctx, STATUS_REGION, ['back']);
      if (back.length === 0) break;
      const t = back[0];
      const iconX = Math.round(STATUS_REGION.x + STATUS_REGION.w / 2);
      ctx.log(`[step 1] 点击返回队伍 (${iconX}, ${t.y})`);
      await ctx.tap(iconX, t.y);
      await ctx.sleep(1.5);
      ctx.log(`[step 1] 点击驻扎按钮 (${ZHUZHA_BUTTON.x}, ${ZHUZHA_BUTTON.y})`);
      await ctx.tap(ZHUZHA_BUTTON.x, ZHUZHA_BUTTON.y);
      await ctx.sleep(0.5);
      backRetry++;
    }

    // === step 2: 检测采集 + 前往 + 驻扎 ===
    const states = await detectTeamStates(
      ctx, STATUS_REGION, ['caiji', 'totarget', 'zhuzha']
    );
    const caijiCount = states.filter(s => s.state === 'caiji').length;
    const totargetCount = states.filter(s => s.state === 'totarget').length;
    const zhuzhaList = states.filter(s => s.state === 'zhuzha').sort((a, b) => a.y - b.y);
    ctx.log(`[step 2] caiji=${caijiCount} totarget=${totargetCount} zhuzha=${zhuzhaList.length}`);

    if (caijiCount + totargetCount >= teams.length) {
      ctx.log(`[step 2] 配额已满（${caijiCount + totargetCount}/${teams.length}），退出循环`);
      break;
    }

    if (zhuzhaList.length === 0) {
      // step 3.1: 走完整 gatherGem
      ctx.log('[step 3.1] 调用 gatherGem 完整流程');
      const r = await gatherGem(ctx, config, teams, { collectedCoords });
      dispatched += r.dispatched;
      await ctx.sleep(2);
      continue;
    }

    // === step 3.2: 驻扎队伍接续派矿 ===
    const top = zhuzhaList[0];
    const iconX = Math.round(STATUS_REGION.x + STATUS_REGION.w / 2);
    ctx.log(`[step 3.2] 点击最上驻扎队伍 (${iconX}, ${top.y})`);
    await ctx.tap(iconX, top.y);
    await ctx.sleep(1.5);

    await zoomOutToWorld(ctx, worldBtn);
    const gem = await searchAndClickGem(ctx, config, spiralState, collectedCoords);
    if (!gem.found) {
      ctx.log('[step 3.2] 搜不到矿，退大 UI 回 step 1');
      await ctx.tap(EXIT_LARGE_UI_BUTTON.x, EXIT_LARGE_UI_BUTTON.y);
      await ctx.sleep(1);
      continue;
    }

    // === step 4: 大 UI 中找驻扎队伍 + 行军按钮 ===
    const stateIn4 = await detectTeamStates(ctx, LARGE_REGION, ['zhuzha']);
    if (stateIn4.length === 0) {
      // 兜底：图像识别误差导致没检测到驻扎，回退到派空闲队伍
      ctx.log('[step 4] 兜底：未检测到驻扎，尝试派空闲队伍');
      if (!await checkIdleTeamsAvailable(ctx)) {
        ctx.log('[step 4] 兜底：也无空闲队伍，退出');
        await ctx.tap(EXIT_LARGE_UI_BUTTON.x, EXIT_LARGE_UI_BUTTON.y);
        break;
      }
      const r = await dispatchToTeamPopup(
        ctx, config, teams, 0, hasPaging, collectedCoords
      );
      hasPaging = r.hasPaging;
      if (r.dispatched) dispatched++;
      continue;
    }

    const topInLarge = stateIn4.sort((a, b) => a.y - b.y)[0];
    const largeIconX = Math.round(LARGE_REGION.x + LARGE_REGION.w / 2);
    ctx.log(`[step 4] 点击最上驻扎队伍 (${largeIconX}, ${topInLarge.y})`);
    await ctx.tap(largeIconX, topInLarge.y);
    await ctx.sleep(1.5);

    const march = await ctx.findImageWithLocation(
      MARCH_BTN_TEMPLATE, 0.7, undefined, undefined, undefined, MARCH_SEARCH_REGION
    );
    if (!march.found) {
      ctx.log(`[step 4] 行军按钮未找到，退大 UI 回 step 1`);
      await ctx.tap(EXIT_LARGE_UI_BUTTON.x, EXIT_LARGE_UI_BUTTON.y);
      await ctx.sleep(1);
      continue;
    }
    ctx.log(`[step 4] 点击行军按钮 (${march.x}, ${march.y})`);
    await ctx.tap(march.x, march.y);
    await ctx.sleep(1.5);
    dispatched++;
  }

  ctx.log(`=== 专注模式结束：派出 ${dispatched} 队 ===`);
  return { result: dispatched > 0 ? 'success' : 'not_found', dispatched };
}
```

- [ ] **Step 4: 编译检查**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
cd D:/SLG && git add plugins/rok/actions/gatherGemFocus.ts
git commit -m "feat(focus): 实现宝石采集专注模式 step1-4 主循环"
```

---

## Task 8: index.ts — 删除 gem-gather-focus 的 OCR pre-check

**Files:**
- Modify: `plugins/rok/index.ts:756-794`

**目标：** 直接调用 `gatherGemFocus`，不需要 OCR 预检（专注模式内部会自动处理"返回中→驻扎→接续"）。

- [ ] **Step 1: 替换 gem-gather-focus action 的 run 函数体**

把现有 run 函数（行 760-793）：

```typescript
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
      ctx.log(`⚠️ OCR 显示无空闲队伍 (${used}/${total})，但仍进入专注检测（状态栏可能发现返回中的队伍）`);
    } else {
      ctx.log(`有空闲队伍 (${used}/${total})，继续宝石采集`);
    }
  } else {
    const digitsOnly = teamCountText.replace(/\D/g, '');
    if (digitsOnly.length >= 2 && /^(\d)\1+$/.test(digitsOnly)) {
      ctx.log(`⚠️ OCR 推测全部忙碌 ("${digitsOnly}")，但仍进入专注检测`);
    } else {
      ctx.log('⚠️ 未识别到队伍计数，继续宝石采集');
    }
  }

  const outcome = await gatherGemFocus(ctx, config, teams);
  ctx.log(`宝石采集(专注): 队伍[${teams.join(', ')}] → ${outcome.result}，派出 ${outcome.dispatched} 队`);
}
```

替换为：

```typescript
run: async (ctx, params: { teams?: number[] } = {}) => {
  const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
  const teams = params.teams || [1];
  const outcome = await gatherGemFocus(ctx, config, teams);
  ctx.log(`宝石采集(专注): 队伍[${teams.join(', ')}] → ${outcome.result}，派出 ${outcome.dispatched} 队`);
}
```

- [ ] **Step 2: 检查并清理可能孤立的 imports**

打开 `plugins/rok/index.ts`，检查文件顶部 imports 区。如 `ocrService` 和 `fs` 仅在被删除的 pre-check 段中使用，则删除对应 import 行。Run grep 验证：

Run: `grep -n "ocrService\|fs/promises\|fs\.unlink" D:/SLG/plugins/rok/index.ts`
Expected: 输出确认这两个符号在文件其他地方是否仍被引用；若仅 pre-check 用到，则删 import。

- [ ] **Step 3: 编译检查**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
cd D:/SLG && git add plugins/rok/index.ts
git commit -m "feat(focus): 移除 gem-gather-focus 的 OCR 预检（焦点模式内部已处理）"
```

---

## Task 9: 最终编译验证

**Files:** 全工程

**目标：** 确认整个工程编译通过、行为符合预期。

- [ ] **Step 1: 全工程 TypeScript 编译**

Run: `cd D:/SLG && npx tsc --noEmit -p tsconfig.json 2>&1`
Expected: 输出为空（无错误）

- [ ] **Step 2: 跑现有测试**

Run: `cd D:/SLG && npm test 2>&1 | tail -50`
Expected: 全部测试通过（项目无针对 gatherGem/gatherGemFocus 的测试，跑现有用例确保未破坏）

- [ ] **Step 3: 手工运行验证**

启动后端：

Run: `cd D:/SLG && npm run server`

在前端首页打开"宝石采集（专注）"开关，跑一轮验证：

1. **基本场景**：所有队伍空闲 → 应走 step3.1（调 gatherGem 完整流程派队）
2. **驻扎接续**：手动让 1 队驻扎在地图上 → 应走 step3.2 → step4 → 行军 → 该队进入采集
3. **回收返回中队伍**：手动让队伍返回 → 应在 step1 被收回为驻扎 → 下轮 step3.2 接续派出
4. **配额满退出**：所有 teams 都 caiji/totarget → step2 退出，task 返回 success
5. **行军按钮搜不到**：模拟点错驻扎队伍弹出非预期界面 → step4 应退大 UI 不卡死
6. **跨轮坐标去重**：连续派出多队，验证 collectedCoords 跨 step3.1/step3.2 不重复采矿

验证日志中能看到 `[step 1]` `[step 2]` `[step 3.1]` `[step 3.2]` `[step 4]` 等标记。

- [ ] **Step 4: 全部完成后提交一个总结 commit（可选）**

无需额外 commit。Task 1-8 已逐步提交。

---

## 自审查要点

1. **Spec 覆盖：**
   - ✅ zoomOutToWorld（Task 1）
   - ✅ SpiralState + createSpiralState（Task 1）
   - ✅ checkIdleTeamsAvailable（Task 2）
   - ✅ searchAndClickGem（Task 3）
   - ✅ dispatchToTeamPopup + DispatchResult（Task 4）
   - ✅ gatherGem.options.collectedCoords（Task 4）
   - ✅ btn_xingjun.png 模板（Task 5）
   - ✅ detectTeamStates 参数化（Task 6）
   - ✅ gatherGemFocus 主循环 step1-4（Task 7）
   - ✅ index.ts 删除 pre-check（Task 8）
   - ✅ 边界与异常处理（融在 Task 7 主循环 + dispatchToTeamPopup 内部）
   - ✅ 测试计划（Task 9 step3 列出 6 个手工场景）

2. **类型一致性：**
   - `SpiralState` 字段（step / dirIndex / moveCount / dirSwipes / checkedCenter / halfW / halfH / maxAttempts）—— Task 1 定义、Task 3 使用，名称一致
   - `DispatchResult` 字段（dispatched / nextTeamIdx / hasPaging / allTeamsBusy）—— Task 4 定义、Task 7 step4 兜底分支调用一致
   - `findImageWithLocation` 6 参签名（templatePath, threshold, scales?, normalize?, channel?, searchRegion?）—— Task 7 调用形参顺序对齐
   - `searchRegion` 字段是 `{x, y, width, height}`（不是 w/h）—— Task 7 中的 `MARCH_SEARCH_REGION` 与签名匹配
   - `collectedCoords: Array<{x, y}>` —— 跨 Task 1/3/4/7 命名一致

3. **Placeholder 检查：** 无 TBD/TODO/省略号；每个 step 都有具体代码或命令。

---

Plan complete and saved to `docs/superpowers/plans/2026-06-19-gather-gem-focus.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
