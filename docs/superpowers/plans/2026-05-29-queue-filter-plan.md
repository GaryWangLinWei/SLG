# 队列速览过滤 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首次打开队列速览时自动过滤只保留部队训练、建造队列、科技研究三项

**Architecture:** 修复 Vision.findAllImages 实现真正的多匹配搜索；PluginContext 新增 findAllImages 方法支持可选搜索区域；readQueueOverview 新增 ensureQueueFilters 首次调用时通过图像识别智能过滤复选框

**Tech Stack:** TypeScript + Sharp + ADB

---

### Task 1: 修复 Vision.findAllImages

**Files:**
- Modify: `core/vision/Vision.ts:177-209`

`findAllImages` 当前在找到第一个匹配后就 break，无法找到所有匹配。需要修复为：用黑色矩形遮罩已找到区域，重新保存截图，继续搜索直到无匹配。

- [ ] **Step 1: 修改 findAllImages 实现**

```typescript
  async findAllImages(
    screenshotPath: string,
    templatePath: string,
    threshold: number = 0.85
  ): Promise<ImageMatchResult[]> {
    const results: ImageMatchResult[] = [];
    let currentScreenshot = screenshotPath;

    // Load template once to get its dimensions for masking
    const templateMeta = await sharp(templatePath).metadata();
    const tWidth = templateMeta.width!;
    const tHeight = templateMeta.height!;

    while (true) {
      const result = await this.findImage(currentScreenshot, templatePath, threshold);
      if (!result.found) break;

      results.push(result);

      // Black out the found area (with padding) to prevent re-matching
      const screenshotBuffer = await fs.readFile(currentScreenshot);
      const margin = Math.max(tWidth, tHeight);
      const maskLeft = Math.max(0, result.rect.x - margin);
      const maskTop = Math.max(0, result.rect.y - margin);
      const maskWidth = Math.min(result.rect.width + margin * 2, 9999);
      const maskHeight = Math.min(result.rect.height + margin * 2, 9999);

      const metadata = await sharp(screenshotBuffer).metadata();
      const blackRect = Buffer.alloc(maskWidth * maskHeight * 3, 0);

      const outputPath = path.join(TEMP_DIR, `masked_${Date.now()}.png`);
      await sharp(screenshotBuffer)
        .composite([{
          input: await sharp(blackRect, {
            raw: { width: maskWidth, height: maskHeight, channels: 3 }
          }).png().toBuffer(),
          top: maskTop,
          left: maskLeft
        }])
        .toFile(outputPath);

      // Clean up previous temp file if it was created by us
      if (currentScreenshot !== screenshotPath) {
        await fs.unlink(currentScreenshot).catch(() => {});
      }
      currentScreenshot = outputPath;
    }

    // Clean up last temp file
    if (currentScreenshot !== screenshotPath) {
      await fs.unlink(currentScreenshot).catch(() => {});
    }

    return results;
  }
```

- [ ] **Step 2: Commit**

```bash
git add core/vision/Vision.ts
git commit -m "fix: Vision.findAllImages properly masks and loops to find all matches"
```

---

### Task 2: PluginContext 新增 findAllImages

**Files:**
- Modify: `core/plugin/PluginContext.ts`

在 `findImageWithLocation` 方法之后，新增 `findAllImages` 方法，支持可选的搜索区域裁剪。

- [ ] **Step 1: 添加 findAllImages 方法**

在 `findImageWithLocation` 方法（约第 84 行）之后添加：

```typescript
  /**
   * Find all occurrences of a template image on screen.
   * If searchRegion is provided, only searches within that area
   * and adjusts returned coordinates to absolute screen positions.
   */
  async findAllImages(
    templatePath: string,
    threshold: number = 0.85,
    searchRegion?: { x: number; y: number; width: number; height: number }
  ): Promise<Array<{ x: number; y: number; confidence: number }>> {
    this.checkCancellation();
    const screenshotBuffer = await this.device.screenshot();
    let tempPath = path.join(os.tmpdir(), `screenshot-${Date.now()}.png`);

    try {
      if (searchRegion) {
        // Crop to search region for focused matching
        await sharp(screenshotBuffer)
          .extract({ left: searchRegion.x, top: searchRegion.y, width: searchRegion.width, height: searchRegion.height })
          .toFile(tempPath);
      } else {
        await fs.writeFile(tempPath, screenshotBuffer);
      }

      const results = await this.vision.findAllImages(tempPath, templatePath, threshold);

      // Adjust coordinates if cropped
      const offsetX = searchRegion?.x ?? 0;
      const offsetY = searchRegion?.y ?? 0;

      return results.map(r => {
        const tapLoc = this.vision.getTapLocation(r);
        return {
          x: tapLoc.x + offsetX,
          y: tapLoc.y + offsetY,
          confidence: r.confidence
        };
      });
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }
```

需要新增 import：`import * as fs from 'fs/promises';` — 但该文件已有这个 import（第 1 行），无需添加。需要新增 `import sharp from 'sharp';` — 但文件第 4 行已有该 import。

- [ ] **Step 2: Commit**

```bash
git add core/plugin/PluginContext.ts
git commit -m "feat: add findAllImages to PluginContext with optional searchRegion"
```

---

### Task 3: RokConfig 新增队列过滤配置

**Files:**
- Modify: `plugins/rok/index.ts`

在 `RokConfig` 接口的 `queueOverview?` 中新增 `settingsButton` 和 `queueCheckboxes` 字段，并在 `DEFAULT_ROK_CONFIG` 中提供默认值。

- [ ] **Step 1: 修改 RokConfig 接口**

在 `RokConfig` 的 `queueOverview?: { ... }` 内部新增两个字段：

```typescript
  // 在 queueOverview 的 rows 和 buildNameRows 之后，swipeDown 之前
  // 队列设置面板
  settingsButton?: { x: number; y: number };
  queueCheckboxes?: Array<{ x: number; y: number }>;
```

即 `queueOverview` 变为：

```typescript
  queueOverview?: {
    openButton: { x: number; y: number };
    closeButton?: { x: number; y: number };
    swipeDown?: { fromX: number; fromY: number; toX: number; toY: number };
    rows: {
      build1: { x: number; y: number; w: number; h: number };
      build2: { x: number; y: number; w: number; h: number };
      train_bingying: { x: number; y: number; w: number; h: number };
      train_majiu: { x: number; y: number; w: number; h: number };
      train_bachang: { x: number; y: number; w: number; h: number };
      train_gongcheng: { x: number; y: number; w: number; h: number };
      research: { x: number; y: number; w: number; h: number };
    };
    buildNameRows?: {
      build1: { x: number; y: number; w: number; h: number };
      build2: { x: number; y: number; w: number; h: number };
    };
    settingsButton?: { x: number; y: number };
    queueCheckboxes?: Array<{ x: number; y: number }>;
  };
```

- [ ] **Step 2: 修改 DEFAULT_ROK_CONFIG**

在 `DEFAULT_ROK_CONFIG.queueOverview` 中添加默认值（位于 `buildNameRows` 之后）：

```typescript
      queueOverview: {
        openButton: { x: 42, y: 161 },
        closeButton:{ x: 415, y: 459 },
        swipeDown: { fromX: 300, fromY: 524, toX: 300, toY: 300 },
        rows: {
          build1: { x: 103, y: 585, w: 267, h: 23 },
          build2: { x: 103, y: 665, w: 267, h: 23 },
          train_bingying: { x: 103, y: 201, w: 267, h: 23 },
          train_majiu: { x: 104, y: 362, w: 267, h: 23 },
          train_bachang: { x: 103, y: 280, w: 267, h: 23 },
          train_gongcheng: { x: 103, y: 444, w: 267, h: 23 },
          research: { x: 103, y: 805, w: 267, h: 23 }
        },
        buildNameRows: {
          build1: { x: 98, y: 548, w: 266, h: 26 },
          build2: { x: 98, y: 630, w: 266, h: 26 },
        },
        settingsButton: { x: 356, y: 157 },
        queueCheckboxes: [
          { x: 465, y: 212 },  // 部队训练
          { x: 465, y: 366 },  // 建造队列
          { x: 465, y: 443 },  // 科技研究
        ],
      },
```

- [ ] **Step 3: Commit**

```bash
git add plugins/rok/index.ts
git commit -m "feat: add queue filter config fields to RokConfig"
```

---

### Task 4: readQueueOverview 新增 ensureQueueFilters

**Files:**
- Modify: `plugins/rok/actions/readQueueOverview.ts`

新增 `ensureQueueFilters` 函数：打开设置面板，用图像识别找到所有 `chooseState.png` 勾选，取消非目标位置的勾选，补上缺失的目标勾选。

- [ ] **Step 1: 添加 ensureQueueFilters 函数**

在 `readQueueOverview` 函数之前、所有 import 之后添加：

```typescript
import * as path from 'path';

/** 队列过滤只执行一次（游戏会记住设置） */
let queueFiltersEnsured = false;

const QUEUE_FILTER_CHECKBOXES = [
  { x: 465, y: 212 },  // 部队训练
  { x: 465, y: 366 },  // 建造队列
  { x: 465, y: 443 },  // 科技研究
];

const SETTINGS_REGION = { x: 427, y: 167, width: 482, height: 396 };
const POSITION_TOLERANCE = 15;

function isNear(pos: { x: number; y: number }, target: { x: number; y: number }): boolean {
  return Math.abs(pos.x - target.x) <= POSITION_TOLERANCE && Math.abs(pos.y - target.y) <= POSITION_TOLERANCE;
}

async function ensureQueueFilters(
  ctx: PluginContext,
  config: RokConfig
): Promise<void> {
  const qo = config.queueOverview;
  if (!qo?.settingsButton || !qo?.queueCheckboxes?.length) {
    ctx.log('[队列过滤] 未配置 settingsButton/queueCheckboxes，跳过');
    queueFiltersEnsured = true;
    return;
  }

  const btn = qo.settingsButton;

  ctx.log('[队列过滤] 打开队列设置面板');
  await ctx.tap(btn.x, btn.y);
  await ctx.sleep(1);

  // 在设置面板区域内搜索所有已勾选的复选框
  const templatePath = path.join(__dirname, '..', '..', 'templates', 'chooseState.png');
  const found = await ctx.findAllImages(templatePath, 0.8, SETTINGS_REGION);

  ctx.log(`[队列过滤] 找到 ${found.length} 个勾选: ${found.map(f => `(${f.x},${f.y})`).join(', ')}`);

  // 取消非目标位置的勾选
  for (const f of found) {
    const isTarget = qo.queueCheckboxes!.some(cb => isNear(f, cb));
    if (!isTarget) {
      ctx.log(`[队列过滤] 取消勾选 (${f.x}, ${f.y})`);
      await ctx.tap(f.x, f.y);
      await ctx.sleep(0.3);
    }
  }

  // 确保目标位置已勾选（如果没找到对应勾选则点击补上）
  for (const cb of qo.queueCheckboxes!) {
    const hasCheck = found.some(f => isNear(f, cb));
    if (!hasCheck) {
      ctx.log(`[队列过滤] 补勾选 (${cb.x}, ${cb.y})`);
      await ctx.tap(cb.x, cb.y);
      await ctx.sleep(0.3);
    }
  }

  // 关闭设置面板（和打开同一按钮）
  ctx.log('[队列过滤] 关闭队列设置面板');
  await ctx.tap(btn.x, btn.y);
  await ctx.sleep(0.5);

  queueFiltersEnsured = true;
  ctx.log('[队列过滤] 完成');
}
```

- [ ] **Step 2: 在 readQueueOverview 开头调用**

在 `readQueueOverview` 函数体内，`ctx.log('[OCR] 打开队列速览面板')` 之前添加：

```typescript
  // 首次调用时过滤干扰队列
  if (!queueFiltersEnsured) {
    await ensureQueueFilters(ctx, config);
  }
```

- [ ] **Step 3: Commit**

```bash
git add plugins/rok/actions/readQueueOverview.ts
git commit -m "feat: add ensureQueueFilters to readQueueOverview first run"
```

---

### Task 5: 最终验证

- [ ] **Step 1: TypeScript 编译**

```bash
cd D:/SLG && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 2: 运行测试**

```bash
cd D:/SLG && npx jest --no-coverage
```

Expected: 全部通过。

- [ ] **Step 3: 功能验证**

启动模拟器 + 前后端后验证：
- 首次启动 → 打开队列速览 → 设置面板自动打开
- 日志显示找到的勾选数量
- 多余勾选被取消，缺失的目标勾选被补上
- 后续循环不再重复过滤（module 级 flag）
- OCR 速览正常读取三个队列的倒计时
