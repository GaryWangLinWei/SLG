# 宝石 UI 遮挡一次避让 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让普通宝石搜索优先选择同屏非 UI 区候选，并仅在所有候选被 UI 遮挡时执行一次避让和一次原地重检。

**Architecture:** 在 `gatherGem.ts` 中增加一个只负责候选选择和一次 UI 避让的辅助函数，初始检测与螺旋检测都调用它。辅助函数不接触占用判断、点击、中心验证或螺旋状态；聚焦测试单独放在新测试文件中，避免恢复当前已删除且包含过时接口假设的整份旧测试。

**Tech Stack:** TypeScript、Jest、ts-jest、现有 `PluginContext` 设备操作封装

---

## File Map

- Modify: `plugins/rok/actions/gatherGem.ts` — 定义候选类型和一次 UI 避让辅助函数，并让初始/螺旋检测复用它。
- Create: `plugins/rok/actions/gatherGemUiAvoidance.test.ts` — 只测试候选优先级、一次避让、原地重检和计数边界。
- Reference: `docs/superpowers/specs/2026-07-25-gem-ui-avoidance-design.md` — 已批准的行为规范，不修改。

## Global Constraints

- 不恢复已删除的 `plugins/rok/actions/gatherGem.test.ts`；其历史版本包含与当前 `verifyGemAtCenter()` 接口不一致的测试。
- 不改变 `isInUIArea()` 的三个区域边界。
- 每个检测机会最多调用一次避让滑动和一次额外检测。
- 避让重检仍没有非 UI 候选时，不允许再次避让。
- 避让和重检不修改 `SpiralState.moveCount`。
- 当前工作区已有大量用户改动；执行过程中不提交、不还原、不格式化无关文件。

---

### Task 1: 用失败测试锁定候选选择和一次避让

**Files:**
- Create: `plugins/rok/actions/gatherGemUiAvoidance.test.ts`
- Test: `plugins/rok/actions/gatherGemUiAvoidance.test.ts`

- [ ] **Step 1: 创建聚焦测试文件并写候选优先级测试**

创建 `plugins/rok/actions/gatherGemUiAvoidance.test.ts`：

```ts
import { selectGemCandidateWithUiAvoidance } from './gatherGem';

type Detection = { x: number; y: number; confidence: number };

function createCtx(redetected: Detection[] = []) {
  return {
    log: jest.fn(),
    swipe: jest.fn(async () => {}),
    sleep: jest.fn(async () => {}),
    detectWithScreenshot: jest.fn(async () => redetected),
  } as any;
}

describe('selectGemCandidateWithUiAvoidance', () => {
  it('同屏有 UI 与非 UI 候选时优先返回非 UI 候选且不避让', async () => {
    const ctx = createCtx();
    const visible = { x: 900, y: 500, confidence: 0.8 };

    await expect(selectGemCandidateWithUiAvoidance(ctx, [
      { x: 1300, y: 300, confidence: 0.95 },
      visible,
    ])).resolves.toEqual(visible);

    expect(ctx.swipe).not.toHaveBeenCalled();
    expect(ctx.sleep).not.toHaveBeenCalled();
    expect(ctx.detectWithScreenshot).not.toHaveBeenCalled();
  });

  it('首次检测为空时不避让', async () => {
    const ctx = createCtx();

    await expect(selectGemCandidateWithUiAvoidance(ctx, []))
      .resolves.toBeUndefined();

    expect(ctx.swipe).not.toHaveBeenCalled();
    expect(ctx.detectWithScreenshot).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 写全部候选被遮挡时的一次避让测试**

在同一 `describe` 中追加：

```ts
it('全部候选在 UI 区时避让一次并在 0.8 秒后原地重检', async () => {
  const movedGem = { x: 1000, y: 500, confidence: 0.9 };
  const ctx = createCtx([movedGem]);

  await expect(selectGemCandidateWithUiAvoidance(ctx, [
    { x: 1400, y: 800, confidence: 0.95 },
    { x: 1300, y: 300, confidence: 0.9 },
  ])).resolves.toEqual(movedGem);

  expect(ctx.swipe).toHaveBeenCalledTimes(1);
  expect(ctx.swipe).toHaveBeenCalledWith(1100, 625, 800, 450, 500, false);
  expect(ctx.sleep).toHaveBeenCalledTimes(1);
  expect(ctx.sleep).toHaveBeenCalledWith(0.8);
  expect(ctx.detectWithScreenshot).toHaveBeenCalledTimes(1);
  expect(ctx.detectWithScreenshot).toHaveBeenCalledWith(0.35);
  expect(ctx.swipe.mock.invocationCallOrder[0])
    .toBeLessThan(ctx.sleep.mock.invocationCallOrder[0]);
  expect(ctx.sleep.mock.invocationCallOrder[0])
    .toBeLessThan(ctx.detectWithScreenshot.mock.invocationCallOrder[0]);
});

it('重检仍全部在 UI 区时不执行第二次避让', async () => {
  const ctx = createCtx([
    { x: 100, y: 850, confidence: 0.92 },
    { x: 1450, y: 820, confidence: 0.88 },
  ]);

  await expect(selectGemCandidateWithUiAvoidance(ctx, [
    { x: 1300, y: 300, confidence: 0.95 },
  ])).resolves.toBeUndefined();

  expect(ctx.swipe).toHaveBeenCalledTimes(1);
  expect(ctx.sleep).toHaveBeenCalledTimes(1);
  expect(ctx.detectWithScreenshot).toHaveBeenCalledTimes(1);
});
```

说明：首个 UI 候选 `(1400,800)` 与中心 `(800,450)` 的中点为 `(1100,625)`，因此断言现有避让坐标算法未被改变。

- [ ] **Step 3: 运行测试确认因导出不存在而失败**

Run:

```bash
npx jest plugins/rok/actions/gatherGemUiAvoidance.test.ts --runInBand
```

Expected: FAIL，TypeScript/Jest 报告 `selectGemCandidateWithUiAvoidance` 未从 `./gatherGem` 导出。

---

### Task 2: 实现候选选择和一次 UI 避让辅助函数

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts:118-135`
- Test: `plugins/rok/actions/gatherGemUiAvoidance.test.ts`

- [ ] **Step 1: 在 UI 区判断下方定义候选类型和辅助函数**

在 `isInUIArea()` 后、`verifyGemAtCenter()` 前加入：

```ts
export interface GemCandidate {
  x: number;
  y: number;
  confidence: number;
}

/**
 * 优先返回非 UI 区候选；仅当所有候选都在 UI 区时，执行一次避让并原地重检。
 * 重检结果不会再次触发避让。
 */
export async function selectGemCandidateWithUiAvoidance(
  ctx: PluginContext,
  detections: GemCandidate[]
): Promise<GemCandidate | undefined> {
  const visible = detections.find(d => !isInUIArea(d.x, d.y));
  if (visible || detections.length === 0) return visible;

  const blocked = detections[0];
  const midX = Math.floor((blocked.x + 800) / 2);
  const midY = Math.floor((blocked.y + 450) / 2);
  ctx.log(`  [UI gem] swipe from (${midX},${midY}) to center`);
  await ctx.swipe(midX, midY, 800, 450, 500, false);
  await ctx.sleep(0.8);

  const redetected = await ctx.detectWithScreenshot(0.35);
  ctx.log(`  [UI gem] 原地重检找到 ${redetected.length} 个宝石候选`);
  return redetected.find(d => !isInUIArea(d.x, d.y));
}
```

此函数只读取检测结果并调用 `PluginContext`，不接收或修改 `SpiralState`，从结构上保证避让和重检不会增加 `moveCount`。

- [ ] **Step 2: 运行聚焦测试确认通过**

Run:

```bash
npx jest plugins/rok/actions/gatherGemUiAvoidance.test.ts --runInBand
```

Expected: PASS，4 tests passed。

- [ ] **Step 3: 检查辅助函数差异范围**

Run:

```bash
git diff --check -- plugins/rok/actions/gatherGem.ts plugins/rok/actions/gatherGemUiAvoidance.test.ts
git diff -- plugins/rok/actions/gatherGem.ts plugins/rok/actions/gatherGemUiAvoidance.test.ts
```

Expected: `diff --check` 无输出；源码此时只新增 `GemCandidate` 与辅助函数，尚未替换搜索调用点。

---

### Task 3: 让初始检测和螺旋检测共用辅助函数

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts:373-439`
- Modify: `plugins/rok/actions/gatherGemUiAvoidance.test.ts`
- Test: `plugins/rok/actions/gatherGemUiAvoidance.test.ts`

- [ ] **Step 1: 增加源码调用点一致性测试**

在测试文件顶部增加：

```ts
import * as fs from 'fs';
import * as path from 'path';
```

在文件末尾增加：

```ts
describe('searchAndClickGem UI 候选选择接线', () => {
  it('初始检测与螺旋检测都调用统一辅助函数', () => {
    const source = fs.readFileSync(path.join(__dirname, 'gatherGem.ts'), 'utf8');
    const start = source.indexOf('export async function searchAndClickGem');
    const end = source.indexOf('export interface DispatchResult', start);
    const body = source.slice(start, end);

    expect(
      body.match(/selectGemCandidateWithUiAvoidance\(ctx, /g)
    ).toHaveLength(2);
    expect(body).not.toContain('spiralState.checkedCenter = false');
  });
});
```

该测试只锁定两处必须复用统一流程以及移除初始无限避让入口；候选行为由 Task 1 的运行时测试负责。

- [ ] **Step 2: 运行测试确认接线测试失败**

Run:

```bash
npx jest plugins/rok/actions/gatherGemUiAvoidance.test.ts --runInBand
```

Expected: FAIL，调用次数为 0，且源码仍包含 `spiralState.checkedCenter = false`。

- [ ] **Step 3: 替换初始检测的候选选择和内联避让**

把 `searchAndClickGem()` 初始检测块中的：

```ts
const initValid = initDets.find(d => true);
// UI area gem: swipe from midpoint to center (avoid clicking UI)
if (initValid && isInUIArea(initValid.x, initValid.y)) {
  const midX = Math.floor((initValid.x + 800) / 2);
  const midY = Math.floor((initValid.y + 450) / 2);
  ctx.log(`  [UI gem] swipe from (${midX},${midY}) to center`);
  await ctx.swipe(midX, midY, 800, 450, 500, false);
  await ctx.sleep(0.8);
  spiralState.checkedCenter = false;
  continue;
}
```

替换为：

```ts
const initValid = await selectGemCandidateWithUiAvoidance(ctx, initDets);
```

保留紧随其后的 `if (initValid) { ... isGemOccupied ... }` 原样。这样重检仍无非 UI 候选时会自然结束初始检测并进入螺旋循环，而不会重置 `checkedCenter`。

- [ ] **Step 4: 替换螺旋检测的候选选择和内联避让**

把螺旋检测中的：

```ts
const validDet = detections.find(d => true);
// UI area gem: swipe from midpoint to center
if (validDet && isInUIArea(validDet.x, validDet.y)) {
  const midX = Math.floor((validDet.x + 800) / 2);
  const midY = Math.floor((validDet.y + 450) / 2);
  ctx.log(`  [UI gem] swipe from (${midX},${midY}) to center`);
  await ctx.swipe(midX, midY, 800, 450, 500, false);
  await ctx.sleep(0.8);
  continue;
}
```

替换为：

```ts
const validDet = await selectGemCandidateWithUiAvoidance(ctx, detections);
```

保留后续占用检测和 `gemFound` 设置原样。辅助函数重检得到可点击候选时，当前循环会立即处理它；返回 `undefined` 时才自然进入下一螺旋步。

- [ ] **Step 5: 运行聚焦测试确认全部通过**

Run:

```bash
npx jest plugins/rok/actions/gatherGemUiAvoidance.test.ts --runInBand
```

Expected: PASS，5 tests passed。

- [ ] **Step 6: 用现有状态结构确认避让不改变搜索计数**

检查最终 `searchAndClickGem()`：

```ts
spiralState.moveCount++;
spiralState.dirSwipes++;
await ctx.swipe(fromX, fromY, toX, toY, 500, false);
```

Expected: `moveCount++` 仍只位于正常螺旋滑动之前；`selectGemCandidateWithUiAvoidance()` 内没有 `SpiralState` 参数或计数修改。

---

### Task 4: 验证类型、聚焦行为和最终差异

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts`
- Create: `plugins/rok/actions/gatherGemUiAvoidance.test.ts`

- [ ] **Step 1: 运行聚焦测试**

Run:

```bash
npx jest plugins/rok/actions/gatherGemUiAvoidance.test.ts --runInBand
```

Expected: PASS，5 tests passed；无异步句柄警告。

- [ ] **Step 2: 运行根项目 TypeScript 检查**

Run:

```bash
npx tsc --noEmit
```

Expected: exit 0，无 TypeScript 错误。

- [ ] **Step 3: 检查格式和差异**

Run:

```bash
git diff --check -- plugins/rok/actions/gatherGem.ts plugins/rok/actions/gatherGemUiAvoidance.test.ts
git diff -- plugins/rok/actions/gatherGem.ts plugins/rok/actions/gatherGemUiAvoidance.test.ts
git status --short
```

Expected:

- `diff --check` 无输出；
- `gatherGem.ts` 仅包含本功能所需的辅助函数和两处调用点替换，不覆盖用户现有改动；
- 新测试只覆盖 UI 候选选择和接线；
- `git status` 中其他已有修改保持原状。

- [ ] **Step 4: 不自动提交**

不要运行 `git add` 或 `git commit`。向用户报告修改文件、聚焦测试结果、类型检查结果，以及任何未通过项的原始错误摘要。
