# 宝石采集二次确认流程对齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将普通/专注宝石采集调整为 `verify → caiji YOLO → 坐标去重 → 点击 verified 坐标 → 找采集按钮`，移除固定矩形点击与固定区域模板占用检测。

**Architecture:** 修改公共 `searchAndClickGem()`，因此普通模式和专注模式同步生效；复用 `verifyGemAtCenter()` 返回的精确坐标，并调用现有 `detectTeamStates()` 做局部 caiji 检测。

**Tech Stack:** TypeScript、Jest、ONNX Runtime、YOLO `state.onnx` / `bigGem.onnx`。

---

### Task 1: 编写失败测试，锁定新流程

**Files:**
- Modify: `plugins/rok/actions/gatherGem.test.ts`

- [ ] **Step 1: 导出或注入必要测试边界**

确认 `searchAndClickGem` 已导出；测试使用 mock `PluginContext` 和最小 `RokConfig`，不增加生产测试专用 API。

- [ ] **Step 2: 添加源码级顺序测试**

```typescript
describe('searchAndClickGem 二次确认后流程', () => {
  const source = fs.readFileSync(path.join(__dirname, 'gatherGem.ts'), 'utf8');
  const start = source.indexOf('export async function searchAndClickGem');
  const end = source.indexOf('export interface DispatchResult');
  const body = source.slice(start, end);

  it('按 verify → caiji YOLO → 去重 → 点击 verified 坐标的顺序执行', () => {
    const verifyIndex = body.indexOf('const verify = await verifyGemAtCenter(ctx)');
    const caijiIndex = body.indexOf("detectTeamStates(ctx, ['caiji'], caijiRegion)");
    const dedupeIndex = body.indexOf('if (collectedCoords.length > 0)');
    const tapIndex = body.indexOf('await ctx.tap(cx, cy)');

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(caijiIndex).toBeGreaterThan(verifyIndex);
    expect(dedupeIndex).toBeGreaterThan(caijiIndex);
    expect(tapIndex).toBeGreaterThan(dedupeIndex);
  });

  it('不再点击固定矩形或使用固定区域 caiji 模板检测', () => {
    expect(body).not.toContain('PINCHED_GEM_TARGET_RECT');
    expect(body).not.toContain('CAIJI_STATE_TEMPLATE');
    expect(body).not.toContain('captureRegion(745, 360, 157, 142)');
  });
});
```

同时在文件顶部添加：

```typescript
import * as fs from 'fs';
import * as path from 'path';
```

- [ ] **Step 3: 运行测试确认 RED**

```bash
npx jest plugins/rok/actions/gatherGem.test.ts --runInBand
```

Expected: 新测试失败，指出当前固定矩形点击、固定区域模板检测仍存在，且顺序不匹配。

---

### Task 2: 重排 searchAndClickGem 流程

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts`

- [ ] **Step 1: 添加 detectTeamStates import**

从 `gatherGemFocus.ts` 导入：

```typescript
import { detectTeamStates } from './gatherGemFocus';
```

如果当前文件与 `gatherGemFocus.ts` 已存在循环依赖，则将公共检测函数移入独立工具文件再分别导入；不得复制 detector 逻辑。

- [ ] **Step 2: 删除固定矩形和固定模板常量**

删除：

```typescript
const PINCHED_GEM_TARGET_RECT = { x1: 792, y1: 426, x2: 878, y2: 502 };
```

如果 `CAIJI_STATE_TEMPLATE` 在 `gatherGem.ts` 中仅被旧固定区域检测使用，也删除该常量；若其他函数仍使用则保留定义但删除旧流程引用。

- [ ] **Step 3: 删除旧 caiji 模板检测与固定矩形点击**

从 `searchAndClickGem()` 删除：

```typescript
{
  const caiJiRegionPath = await ctx.captureRegion(745, 360, 157, 142);
  try {
    const caiJiResult = await vision.findImage(caiJiRegionPath, CAIJI_STATE_TEMPLATE, 0.6);
    if (caiJiResult.found) {
      ctx.log(`  🔄 该宝石已有队伍在采集 (confidence: ${caiJiResult.confidence.toFixed(3)})，缩地后继续螺旋`);
      await zoomOutToWorld(ctx, worldBtn);
      await ctx.sleep(1);
      continue;
    }
  } finally {
    await fs.unlink(caiJiRegionPath).catch(() => {});
  }
}

ctx.log(`  点击放大后的目标 (${gg.pinchedGemTapPoint.x}, ${gg.pinchedGemTapPoint.y})`);
await ctx.tapRect(PINCHED_GEM_TARGET_RECT.x1, PINCHED_GEM_TARGET_RECT.y1, PINCHED_GEM_TARGET_RECT.x2, PINCHED_GEM_TARGET_RECT.y2);
await ctx.sleep(1);
```

- [ ] **Step 4: 在 verify 成功后增加 caiji YOLO 检测**

在：

```typescript
const verify = await verifyGemAtCenter(ctx);
if (!verify.found) {
  await zoomOutToWorld(ctx, worldBtn);
  await ctx.sleep(1);
  continue;
}
```

之后添加：

```typescript
const cx = verify.x!;
const cy = verify.y!;
const caijiRegion = {
  x: Math.max(0, cx - 60),
  y: Math.max(0, cy - 60),
  w: 120,
  h: 120,
};
const caijiStates = await detectTeamStates(ctx, ['caiji'], caijiRegion);
if (caijiStates.length > 0) {
  ctx.log(`  🔄 宝石上检测到 caiji 状态（已被采集），缩地后继续螺旋`);
  await zoomOutToWorld(ctx, worldBtn);
  await ctx.sleep(1);
  continue;
}
```

- [ ] **Step 5: 将坐标去重保留在点击前**

坐标去重块保持在 caiji YOLO 检测之后，不改变 OCR 区域：

```typescript
const COORD_REGION = { x: 400, y: 11, w: 137, h: 32 };
```

重复时继续执行原有 `zoomOutToWorld → sleep → continue`。

- [ ] **Step 6: 去重成功后点击 verified 坐标**

在坐标去重块之后、采集按钮搜索之前添加：

```typescript
ctx.log(`  点击二次确认后的宝石位置 (${cx}, ${cy})`);
await ctx.tap(cx, cy);
await ctx.sleep(1);
```

- [ ] **Step 7: 运行测试确认 GREEN**

```bash
npx jest plugins/rok/actions/gatherGem.test.ts --runInBand
```

Expected: 所有测试通过。

---

### Task 3: 清理无效配置字段

**Files:**
- Modify: `plugins/rok/index.ts`
- Search: `web/`, `server/`, `plugins/` 中的 `pinchedGemTapPoint`

- [ ] **Step 1: 搜索所有引用**

```bash
rg "pinchedGemTapPoint|PINCHED_GEM_TARGET_RECT|CAIJI_STATE_TEMPLATE" D:/SLG/plugins D:/SLG/web D:/SLG/server
```

- [ ] **Step 2: 删除仅供旧固定点击使用的配置字段**

若 `pinchedGemTapPoint` 只剩接口定义和默认值，删除：

```typescript
pinchedGemTapPoint: { x: number; y: number };
```

以及：

```typescript
pinchedGemTapPoint: { x: 791, y: 423 },
```

若前端配置编辑器仍引用该字段，一并移除对应表单；不要保留无效配置。

- [ ] **Step 3: TypeScript 检查**

```bash
npx tsc --noEmit
```

Expected: 无错误。

---

### Task 4: 完整验证

**Files:**
- Verify only

- [ ] **Step 1: 运行相关测试**

```bash
npx jest plugins/rok/actions/gatherGem.test.ts plugins/rok/actions/gatherSharedGem.test.ts --runInBand
```

Expected: 全部通过。

- [ ] **Step 2: 运行完整 TypeScript 检查**

```bash
npx tsc --noEmit
```

Expected: exit 0，无错误。

- [ ] **Step 3: 确认旧流程引用已清除**

```bash
rg "PINCHED_GEM_TARGET_RECT|pinchedGemTapPoint|captureRegion\(745, 360, 157, 142\)" D:/SLG/plugins D:/SLG/web D:/SLG/server
```

Expected: 无匹配。

- [ ] **Step 4: 确认新流程顺序**

人工检查 `searchAndClickGem()`：

```
点击 gemX/gemY
→ verifyGemAtCenter
→ detectTeamStates(caiji, 120×120)
→ OCR 坐标去重
→ ctx.tap(cx, cy)
→ 查找采集按钮
```

---
