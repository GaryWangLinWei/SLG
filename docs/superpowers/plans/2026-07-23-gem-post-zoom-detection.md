# 缩地后宝石快速检测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 普通宝石采集每次缩地后先运行一次 gem.onnx，排除屏幕中心 200×200 区域，再决定是否继续螺旋滑动搜索。

**Architecture:** 在公共 `SpiralState` 中保存一次性 `justZoomedOut` 状态；`searchAndClickGem()` 消费该状态并执行非中心快速检测。普通模式的所有继续搜索型缩地设置该状态；专注模式重新开始搜索时保留 `checkedCenter=false` 的全屏含中心检测。

**Tech Stack:** TypeScript、Jest、现有 PluginContext ONNX 检测接口

## Global Constraints

- 中心排除区域固定为屏幕中心 `(800,450)` 周围 200×200，即 `x=700..900`、`y=350..550`。
- 快速检测不增加 `moveCount`，未命中后继续原有螺旋搜索。
- 专注模式选中驻扎队伍后的缩地视为重新开始，首次检测必须包含中心区域。
- 不修改 `gatherGemFocus.ts` 的缩地状态设置。

---

### Task 1: 增加缩地快速检测状态与中心过滤

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts:207-236`
- Test: `plugins/rok/actions/gatherGem.test.ts`

**Interfaces:**
- Produces: `SpiralState.justZoomedOut: boolean`
- Produces: `isInGemCenterExclusionZone(x: number, y: number): boolean`

- [ ] **Step 1: 写失败测试**

测试 `createSpiralState()` 初始化 `justZoomedOut=false`，并测试中心区域边界：`(700,350)`、`(900,550)` 被排除，边界外坐标不排除。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest plugins/rok/actions/gatherGem.test.ts --runInBand`
Expected: FAIL，原因是新字段/过滤函数尚不存在。

- [ ] **Step 3: 最小实现状态与过滤函数**

在 `SpiralState` 增加：

```ts
justZoomedOut: boolean;
```

在 `createSpiralState()` 返回值中增加：

```ts
justZoomedOut: false,
```

增加纯函数：

```ts
export function isInGemCenterExclusionZone(x: number, y: number): boolean {
  return x >= 700 && x <= 900 && y >= 350 && y <= 550;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest plugins/rok/actions/gatherGem.test.ts --runInBand`
Expected: PASS。

### Task 2: 在普通模式所有继续搜索型缩地后触发快速检测

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts:337-470,721-723`
- Test: `plugins/rok/actions/gatherGem.test.ts`

**Interfaces:**
- Consumes: `SpiralState.justZoomedOut`
- Consumes: `isInGemCenterExclusionZone()`

- [ ] **Step 1: 写失败测试**

覆盖以下行为：

1. `justZoomedOut=true` 时先调用 `detectWithScreenshot(0.35)`，过滤中心候选，选择非中心候选。
2. 只有中心候选时不点击中心候选，随后执行原有螺旋滑动。
3. 快速扫描不增加 `moveCount`。
4. `justZoomedOut` 被消费后立即重置为 `false`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest plugins/rok/actions/gatherGem.test.ts --runInBand`
Expected: FAIL，原因是搜索函数尚未消费 `justZoomedOut`。

- [ ] **Step 3: 实现快速检测**

在 `searchAndClickGem()` 的首次中心检测块之前处理：

```ts
if (spiralState.justZoomedOut) {
  spiralState.justZoomedOut = false;
  const detections = await ctx.detectWithScreenshot(0.35);
  ctx.log(`  [搜索] 缩地快速检测找到 ${detections.length} 个宝石候选`);
  const validDet = detections.find(d =>
    !isInChatZone(d.x, d.y) &&
    !isInGemCenterExclusionZone(d.x, d.y)
  );
  if (validDet) {
    if (await isGemOccupied(ctx, validDet.x, validDet.y)) {
      ctx.log(`  宝石 (${validDet.x}, ${validDet.y}) 已被占用，继续搜索`);
    } else {
      gemX = validDet.x;
      gemY = validDet.y;
      gemFound = true;
    }
  }
}
```

只有 `!gemFound` 时才进入原有 `checkedCenter` 和螺旋逻辑。

- [ ] **Step 4: 标记普通模式缩地状态**

在 `searchAndClickGem()` 内以下缩地后设置：

```ts
spiralState.justZoomedOut = true;
```

场景包括：bigGem 二次确认失败、检测到采集占用、重复坐标、未找到采集按钮。

在 `gatherGem()` 成功派队后的缩地后设置同一字段。不要修改 `gatherGemFocus.ts`；其重置后的 `checkedCenter=false` 保证全屏含中心检测。

- [ ] **Step 5: 运行单测与项目测试**

Run: `npx jest plugins/rok/actions/gatherGem.test.ts --runInBand`
Expected: PASS。

Run: `npm test -- --runInBand`
Expected: 全部测试通过。

- [ ] **Step 6: TypeScript 编译验证**

Run: `npx tsc --noEmit`
Expected: exit 0，无 TypeScript 错误。

- [ ] **Step 7: 检查差异**

Run: `git diff -- plugins/rok/actions/gatherGem.ts plugins/rok/actions/gatherGem.test.ts`
Expected: 仅包含本计划要求的状态、过滤、快速检测与测试；不包含 `gatherGemFocus.ts` 修改。

> 不自动提交：当前工作区已有多项未提交修改，提交范围需由用户另行确认。
