# 宝石采集专注模式（gatherGemFocus）设计

**Date:** 2026-06-19
**Status:** Approved, ready for implementation

## 背景

普通宝石采集模式（`gatherGem`）每轮跑一次：

1. 缩地 → 螺旋搜矿 → 派出 N 队 → 退出
2. 搜不到矿/无空闲队伍即终止

普通模式没有处理"队伍返回中转驻扎"和"驻扎队伍接续派矿"的情况，因此队伍利用率低。

**专注模式（focus）的目标：** 持续地把所有队伍维持在采集状态，直到外部停止。在主循环里：
- 把"返回中"的队伍点驻扎收回（节省回城时间）
- 把"驻扎中"的队伍直接接续派出去采集（不浪费）
- 仅当无驻扎队伍时才走完整 gatherGem（重置视角+搜矿+派队）

## 既有代码结构

- **`plugins/rok/actions/gatherGem.ts`** — 502 行单一大函数。所有 `[1/7]–[7/7]` 步骤揉在 `while(true)` 主循环里。无可复用单元。
- **`plugins/rok/actions/gatherGemFocus.ts`** — 占位实现，含 `detectTeamStates` 状态检测函数（已可用），`gatherGemFocus` 主流程是 stub。
- **`plugins/rok/index.ts`** — `gem-gather-focus` action 注册，调用 `gatherGemFocus`，并有一段 OCR pre-check（无害日志，本次会删除）。

## 状态模板

`plugins/rok/templates/`:
- `state_back.png` — 返回中
- `state_caiji.png` — 采集中
- `state_totarget.png` — 前往采集
- `state_zhuzha.png` — 驻扎

新增模板：
- `btn_xingjun.png` — 大 UI 中的行军按钮（位置不固定，需模板检索）

## 整体流程

```
START
  ↓
─── while (true) ───
  ↓
  [step 1] 处理返回中的队伍（最多 5 次）
    检测 STATUS_REGION 中的 state_back
    有则点队伍 → sleep 1.5s → 点驻扎按钮 (800,593) → sleep 0.5s → 重检
    无则进入 step 2
  ↓
  [step 2] 检测采集 + 前往 + 驻扎
    states = detectTeamStates(STATUS_REGION, ['caiji','totarget','zhuzha'])
    if caijiCount + totargetCount >= teams.length:
      → 退出循环（success）
    if zhuzhaCount > 0:
      → step 3.2
    else:
      → step 3.1
  ↓
  [step 3.1] 调用整个 gatherGem
    gatherGem(ctx, config, teams, { collectedCoords })
    sleep 2s
    无论 success/not_found，都 continue 回 step 1
  ↓
  [step 3.2] 驻扎队伍接续派矿
    点击 y 最小的驻扎队伍 → sleep 1.5s
    zoomOutToWorld()
    searchAndClickGem(spiralState, collectedCoords)
    搜不到 → 点 (70, 834) 退大 UI → continue 回 step 1
    搜到 → step 4
  ↓
  [step 4] 大 UI 中找驻扎队伍 + 行军按钮
    states = detectTeamStates(LARGE_REGION, ['zhuzha'])
    if 驻扎数 == 0:
      // 兜底分支（图像识别误差时）
      调用 checkIdleTeamsAvailable + dispatchToTeamPopup
    else:
      点击 y 最小驻扎队伍 → sleep 1.5s
      findImageWithLocation(btn_xingjun, MARCH_SEARCH_REGION)
      找到 → 点击 → sleep 1.5s → continue 回 step 1
      没找到 → 点 (70, 834) 退大 UI → continue 回 step 1
  ↓
END (退出循环)
```

## 重构 gatherGem.ts（最小拆分方案）

抽出 4 个 internal 函数（export 出来给 focus 模式直接 import 复用），主流程 `gatherGem` 改为编排调用。

### `zoomOutToWorld(ctx, worldBtn): Promise<void>`

替代当前内联的 `doZoomOut` 闭包。

```ts
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

### `SpiralState` 接口 + `createSpiralState(config)`

封装当前散落的螺旋状态变量：`step`、`dirIndex`、`moveCount`、`dirSwipes`、`checkedCenter`。

```ts
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
    step: 1, dirIndex: 0, moveCount: 0, dirSwipes: 0, checkedCenter: false,
    halfW: Math.round(1600 * (gg.spiralSwipeRatioH ?? gg.spiralSwipeRatio) / 2),
    halfH: Math.round(900 * gg.spiralSwipeRatio / 2),
    maxAttempts: gg.searchMaxAttempts,
  };
}
```

### `searchAndClickGem(ctx, config, spiralState, collectedCoords): Promise<...>`

封装 `[3/7] 螺旋搜矿 + [4/7] 点击宝石矿 + 占用检测 + 重复坐标过滤` 整段。原地修改 `spiralState`、`collectedCoords`。

```ts
export async function searchAndClickGem(
  ctx: PluginContext,
  config: RokConfig,
  spiralState: SpiralState,
  collectedCoords: Array<{ x: number; y: number }>
): Promise<{ found: true; x: number; y: number } | { found: false }> {
  // 内部循环：搜矿 → 点矿 → 检测占用 → 检测重复 → 检测采集按钮
  // 直到搜到一颗未被占用、未重复采集、有采集按钮的宝石矿
  // 否则螺旋耗尽返回 found:false
}
```

### `checkIdleTeamsAvailable(ctx): Promise<boolean>`

封装当前 `[5/7]` 那段 AddTeamBtn 像素对比。

```ts
export async function checkIdleTeamsAvailable(ctx: PluginContext): Promise<boolean> {
  const { width: addTeamW = 80, height: addTeamH = 80 } =
    await sharp(ADD_TEAM_BTN_TEMPLATE).metadata();
  const x = 1517 - Math.floor(addTeamW! / 2);
  const y = 130 - Math.floor(addTeamH! / 2);
  const region = await ctx.captureRegion(x, y, addTeamW!, addTeamH!);
  const diff = await ctx.compareImages(region, ADD_TEAM_BTN_TEMPLATE);
  await fs.unlink(region).catch(() => {});
  ctx.log(`  AddTeamBtn 匹对差异: ${(diff * 100).toFixed(1)}%`);
  return diff < 0.3;
}
```

### `dispatchToTeamPopup(ctx, config, teams, nextTeamIdx, hasPaging, collectedCoords): Promise<DispatchResult>`

封装 `[6/7] 点选队伍按钮 + 部队页切换 + [7/7] 逐个尝试 + 派出后记录坐标 + OCR 队伍计数检查` 整段。

```ts
export interface DispatchResult {
  dispatched: boolean;
  nextTeamIdx: number;
  hasPaging: boolean;
  allTeamsBusy: boolean;
}

export async function dispatchToTeamPopup(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[],
  nextTeamIdx: number,
  hasPaging: boolean | null,
  collectedCoords: Array<{ x: number; y: number }>
): Promise<DispatchResult>;
```

### gatherGem 签名调整

```ts
export async function gatherGem(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[],
  options?: { collectedCoords?: Array<{ x: number; y: number }> }
): Promise<GemGatherOutcome>
```

- 不传 `options` 时，内部 `const collectedCoords = []`，行为与现状一致
- 传入时 gatherGem 在传入的数组上原地 push，调用者可在多次 gatherGem 调用之间持久化

## gatherGemFocus.ts 重写

### 常量

```ts
const STATUS_REGION = { x: 1530, y: 202, w: 52, h: 478 };
const LARGE_REGION  = { x: 1443, y: 53,  w: 152, h: 753 };
const ZHUZHA_BUTTON = { x: 800, y: 593 };
const EXIT_LARGE_UI_BUTTON = { x: 70, y: 834 };
const MARCH_BTN_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_xingjun.png');
const MARCH_SEARCH_REGION = { x: 1068, y: 20, width: 362, height: 860 };  // findImageWithLocation 字段命名

const BACK_RETRY_LIMIT = 5;
```

### `detectTeamStates` 重构（参数化）

```ts
export async function detectTeamStates(
  ctx: PluginContext,
  region: { x: number; y: number; w: number; h: number } = STATUS_REGION,
  states: TeamState[] = ['zhuzha', 'caiji', 'back', 'totarget']
): Promise<DetectedState[]>
```

- 默认参数维持原行为
- focus 主循环按需传入 `LARGE_REGION` 或子集 `['back']` / `['caiji','totarget','zhuzha']` / `['zhuzha']`
- 调试 SVG 截图保留（开发期排查）

### 主循环

```ts
export async function gatherGemFocus(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[]
): Promise<GemGatherOutcome> {
  const worldBtn = config.resourceCollect.worldSwitchButton;
  const collectedCoords: Array<{ x: number; y: number }> = [];
  const spiralState = createSpiralState(config);
  let dispatched = 0;
  let hasPaging: boolean | null = null;

  while (true) {
    // step 1: 处理返回中的队伍
    let backRetry = 0;
    while (backRetry < BACK_RETRY_LIMIT) {
      const back = await detectTeamStates(ctx, STATUS_REGION, ['back']);
      if (back.length === 0) break;
      const t = back[0];
      // 状态图标中心 x = STATUS_REGION.x + STATUS_REGION.w/2
      const iconX = Math.round(STATUS_REGION.x + STATUS_REGION.w / 2);
      ctx.log(`[step 1] 点击返回队伍 (${iconX}, ${t.y})`);
      await ctx.tap(iconX, t.y);
      await ctx.sleep(1.5);
      ctx.log(`[step 1] 点击驻扎按钮 (${ZHUZHA_BUTTON.x}, ${ZHUZHA_BUTTON.y})`);
      await ctx.tap(ZHUZHA_BUTTON.x, ZHUZHA_BUTTON.y);
      await ctx.sleep(0.5);
      backRetry++;
    }

    // step 2: 检测状态
    const states = await detectTeamStates(
      ctx, STATUS_REGION, ['caiji', 'totarget', 'zhuzha']
    );
    const caijiCount = states.filter(s => s.state === 'caiji').length;
    const totargetCount = states.filter(s => s.state === 'totarget').length;
    const zhuzhaList = states.filter(s => s.state === 'zhuzha')
                             .sort((a, b) => a.y - b.y);
    ctx.log(`[step 2] caiji=${caijiCount} totarget=${totargetCount} zhuzha=${zhuzhaList.length}`);

    if (caijiCount + totargetCount >= teams.length) {
      ctx.log(`[step 2] 配额已满（${caijiCount + totargetCount}/${teams.length}），退出`);
      break;
    }

    if (zhuzhaList.length === 0) {
      // step 3.1: 整套 gatherGem
      ctx.log('[step 3.1] 调用 gatherGem 完整流程');
      const r = await gatherGem(ctx, config, teams, { collectedCoords });
      dispatched += r.dispatched;
      await ctx.sleep(2);
      continue;
    }

    // step 3.2: 驻扎队伍接续搜矿
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

    // step 4: 大 UI 中找驻扎队伍 + 行军按钮
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

## index.ts 改动

删除 `gem-gather-focus` action 的 OCR pre-check 段（764–789 行），改为直接调用：

```ts
{
  id: 'gem-gather-focus',
  name: '宝石采集专注模式',
  description: '...',
  run: async (ctx, params: { teams?: number[] } = {}) => {
    const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
    const teams = params.teams || [1];
    const outcome = await gatherGemFocus(ctx, config, teams);
    ctx.log(`宝石采集(专注): 队伍[${teams.join(', ')}] → ${outcome.result}，派出 ${outcome.dispatched} 队`);
  }
}
```

## 模板准备

实现前需准备：
- `plugins/rok/templates/btn_xingjun.png` — 大 UI 中的行军按钮模板（用户截图后放入）

## 边界与异常处理

| 场景 | 处理 |
|---|---|
| step1 重试 5 次仍有 back 状态 | 跳出 step1 循环，进 step2（避免死循环） |
| step2 caiji+totarget == 0 且 zhuzha == 0（全空闲） | 走 step3.1，符合预期 |
| step3.1 gatherGem 返回 not_found | continue 回 step1（队伍可能转回，下轮继续） |
| step3.1 gatherGem 返回 no_idle_teams | continue 回 step1（同上） |
| step3.2 大 UI 中检测驻扎为 0（图像识别误差） | 兜底：调 checkIdleTeamsAvailable + dispatchToTeamPopup |
| step3.2 兜底也无空闲队伍 | 退大 UI，break 退出 |
| step4 行军按钮搜不到 | 退大 UI，continue（不破坏循环） |
| step3.2 / step4 退大 UI 后回到 step1 | 此时主屏可能仍在世界视图，step1 的 detectTeamStates 在右侧状态栏，状态栏一直可见，不影响 |

## 任务调度协同

`web/src/pages/Home.tsx:682` 已有外层 `while (!loopStopped)` 持续创建 `gem-gather-focus` task。本设计内部循环到退出条件（队伍配额满）才返回，单次 task 内最多派出 N 队（N = teams.length）。前端外层负责：
- 检测许可证过期日志，过期则停止循环
- 每次 task 完成后更新已采宝石计数
- 用户取消采集时通过 stop 中断 task

## 测试计划

实现后人工验证：

1. **基本场景**：所有队伍空闲 → 应走 step3.1（调 gatherGem 完整流程派队）
2. **驻扎接续**：手动让 1 队驻扎在地图上 → 应走 step3.2 → step4 → 行军 → 该队进入采集
3. **回收返回中队伍**：手动让队伍返回 → 应在 step1 被收回为驻扎 → 下轮 step3.2 接续派出
4. **配额满退出**：所有 teams 都 caiji/totarget → step2 退出，task 返回 success
5. **行军按钮搜不到**：模拟点错驻扎队伍弹出非预期界面 → step4 应退大 UI 不卡死
6. **跨轮坐标去重**：连续派出多队，验证 collectedCoords 跨 step3.1/step3.2 不重复采矿

## 文件变更清单

```
plugins/rok/actions/gatherGem.ts        重构：抽 4 函数 + 加 options 参数
plugins/rok/actions/gatherGemFocus.ts   重写：实现完整 step1-4 主循环
plugins/rok/index.ts                    删除 pre-check
plugins/rok/templates/btn_xingjun.png   新增（用户准备）
```
