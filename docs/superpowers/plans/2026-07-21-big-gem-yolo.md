# bigGem YOLO 模型训练与接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 160 张放大宝石矿图集训练独立的 `bigGem.onnx`（YOLOv8n 单类），并接入所有 `verifyGemAtCenter()` 二次确认路径。

**Architecture:** 新增 `bigGemDetector` 与现有 `gemDetector` 并行加载；`PluginService → PluginManager → PluginContext` 注入链各加一个参数；`verifyGemAtCenter()` 从模板匹配切换为 `bigGemDetector` 单次推理。

**Tech Stack:** Python 3.10 + Ultralytics 8.4.61 + PyTorch CPU；TypeScript + ONNX Runtime Node；Jest + ts-jest。

---

### Task 1: 数据准备脚本

**Files:**
- Create: `scripts/prepare_big_gem_dataset.py`

- [ ] **Step 1: 编写数据准备脚本**

```python
"""将 bigGem 图集复制为标准 YOLO 数据集，固定种子 8:2 划分，单类 big_gem。"""
import os, shutil, random
from pathlib import Path

random.seed(42)

SRC_IMG = Path(r"C:\Users\54459\Desktop\bigGem\image")
SRC_LBL = Path(r"C:\Users\54459\Desktop\bigGem\label")
DST = Path(r"C:\Users\54459\Desktop\bigGem_yolo")

def collect():
    samples = []
    for img in SRC_IMG.iterdir():
        if img.suffix.lower() not in {'.png', '.jpg', '.jpeg'}:
            continue
        lbl = SRC_LBL / f"{img.stem}.txt"
        if not lbl.exists():
            raise SystemExit(f"缺少标签: {img.name}")
        # 校验标签
        for line in lbl.read_text().splitlines():
            parts = line.strip().split()
            if len(parts) != 5:
                raise SystemExit(f"标签列数异常: {lbl.name} -> {line}")
            cls = int(parts[0])
            if cls != 0:
                raise SystemExit(f"非 0 类别: {lbl.name} -> cls={cls}")
            vals = [float(x) for x in parts[1:]]
            if any(v < 0 or v > 1 for v in vals):
                raise SystemExit(f"坐标越界: {lbl.name} -> {vals}")
        samples.append((img, lbl))
    return samples

samples = collect()
print(f"有效样本: {len(samples)}")

random.shuffle(samples)
n_val = max(1, int(len(samples) * 0.2))
val = samples[:n_val]
train = samples[n_val:]

for split, pairs in [("train", train), ("val", val)]:
    (DST / "images" / split).mkdir(parents=True, exist_ok=True)
    (DST / "labels" / split).mkdir(parents=True, exist_ok=True)
    for img, lbl in pairs:
        shutil.copy2(img, DST / "images" / split / img.name)
        shutil.copy2(lbl, DST / "labels" / split / lbl.name)

print(f"train: {len(train)}, val: {len(val)}")

yaml = f"""path: {DST.as_posix()}
train: images/train
val: images/val
nc: 1
names:
  0: big_gem
"""
(DST / "dataset.yaml").write_text(yaml)
print(f"✅ dataset.yaml -> {DST / 'dataset.yaml'}")
```

- [ ] **Step 2: 运行脚本并验证输出**

```bash
python scripts/prepare_big_gem_dataset.py
```

Expected output:
```
有效样本: 160
train: 128, val: 32
✅ dataset.yaml -> C:\Users\54459\Desktop\bigGem_yolo\dataset.yaml
```

- [ ] **Step 3: 确认划分稳定性（再跑一次，应该完全一致）**

```bash
python scripts/prepare_big_gem_dataset.py
```

Expected: 同上次完全一致（seed 42 固定）。

- [ ] **Step 4: 人工抽查**

```bash
python -c "
from pathlib import Path
train_imgs = sorted(Path(r'C:/Users/54459/Desktop/bigGem_yolo/images/train').glob('*.png'))
val_imgs = sorted(Path(r'C:/Users/54459/Desktop/bigGem_yolo/images/val').glob('*.png'))
print(f'train: {len(train_imgs)} files')
print(f'val:   {len(val_imgs)} files')
overlap = set(p.name for p in train_imgs) & set(p.name for p in val_imgs)
print(f'重叠: {overlap}' if overlap else '无重叠 ✅')
# 抽查一个标签
lbl = Path(r'C:/Users/54459/Desktop/bigGem_yolo/labels/train') / train_imgs[0].stem + '.txt'
print(f'标签示例 {lbl.name}: {lbl.read_text().strip()}')
"
```

Expected: 128/32，无重叠，标签类别为 0。

---

### Task 2: 短轮次试训

**Files:**
- Create: `scripts/train_big_gem.py`

- [ ] **Step 1: 编写试训/正式训练脚本**

```python
"""bigGem YOLOv8n 训练脚本。先试训 5 epoch 验证链路，再正式训练。"""
import sys
from ultralytics import YOLO

DATASET = r"C:\Users\54459\Desktop\bigGem_yolo\dataset.yaml"
PROJECT = r"C:\Users\54459\Desktop\bigGem_yolo\runs"
NAME = "big_gem"

def train(epochs: int, trial: bool = False):
    model = YOLO("yolov8n.pt")
    results = model.train(
        data=DATASET,
        epochs=epochs,
        imgsz=640,
        project=PROJECT,
        name=NAME,
        exist_ok=True,
        seed=42,
        patience=20 if not trial else 5,
        device="cpu",
        verbose=True,
        plots=True,
        save=True,
        val=True,
    )
    return results

if __name__ == "__main__":
    trial = "--trial" in sys.argv
    epochs = 5 if trial else 300
    print(f"训练模式: {'试训' if trial else '正式'} ({epochs} epochs)")
    results = train(epochs, trial=trial)
    print(f"完成。best.pt 指标: {results.results_dict}")
```

- [ ] **Step 2: 试训 5 epoch**

```bash
python scripts/train_big_gem.py --trial
```

Expected:
- 无报错完成训练。
- `C:\Users\54459\Desktop\bigGem_yolo\runs\big_gem\weights\best.pt` 文件存在。
- 验证指标输出正常。

- [ ] **Step 3: 试训 ONNX 导出验证**

```bash
python -c "
from ultralytics import YOLO
m = YOLO(r'C:/Users/54459/Desktop/bigGem_yolo/runs/big_gem/weights/best.pt')
m.export(format='onnx', imgsz=640, opset=12, simplify=True)
print('ONNX 导出完成')
"
```

Expected: `best.onnx` 在同目录生成。

- [ ] **Step 4: 用试训 ONNX 跑一次推理验证端到端链路**

```bash
python -c "
from ultralytics import YOLO
from pathlib import Path

m = YOLO(r'C:/Users/54459/Desktop/bigGem_yolo/runs/big_gem/weights/best.onnx')
val_imgs = sorted(Path(r'C:/Users/54459/Desktop/bigGem_yolo/images/val').glob('*.png'))[:3]
for p in val_imgs:
    results = m(str(p), imgsz=640, conf=0.5)
    boxes = results[0].boxes
    print(f'{p.name}: {len(boxes.xyxy)} detections')
    if len(boxes.xyxy) > 0:
        print(f'  best conf: {float(boxes.conf[0]):.3f}, cls: {int(boxes.cls[0])}')
"
```

Expected: 每张图至少 1 个检测，置信度合理。

---

### Task 3: 正式训练 + 验收

- [ ] **Step 1: 正式训练**

```bash
python scripts/train_big_gem.py
```

让早停自动结束训练。

- [ ] **Step 2: 检查验证指标**

```bash
python -c "
from ultralytics import YOLO
m = YOLO(r'C:/Users/54459/Desktop/bigGem_yolo/runs/big_gem/weights/best.pt')
results = m.val(data=r'C:/Users/54459/Desktop/bigGem_yolo/dataset.yaml', imgsz=640, device='cpu')
d = results.results_dict
print(f'Precision: {d[\"metrics/precision(B)\"]:.4f}')
print(f'Recall:    {d[\"metrics/recall(B)\"]:.4f}')
print(f'mAP50:     {d[\"metrics/mAP50(B)\"]:.4f}')
print(f'mAP50-95:  {d[\"metrics/mAP50-95(B)\"]:.4f}')
if d['metrics/recall(B)'] >= 0.95:
    print('✅ Recall >= 0.95，验收通过')
else:
    print(f'❌ Recall {d[\"metrics/recall(B)\"]:.4f} < 0.95，不通过')
"
```

Expected: Recall ≥ 0.95。

- [ ] **Step 3: 人工检查验证集预测效果图**

打开 `C:\Users\54459\Desktop\bigGem_yolo\runs\big_gem\val_batch*.jpg`，检查：
- 检测框覆盖完整宝石主体
- 检测框中心适合作为点击位置
- 无 UI/文字/队伍状态误识别

- [ ] **Step 4: 导出最终 ONNX**

```bash
python -c "
from ultralytics import YOLO
m = YOLO(r'C:/Users/54459/Desktop/bigGem_yolo/runs/big_gem/weights/best.pt')
m.export(format='onnx', imgsz=640, opset=12, simplify=True)
print('ONNX 导出完成')
"
```

- [ ] **Step 5: ONNX 推理复验 Recall**

```bash
python -c "
from ultralytics import YOLO
m = YOLO(r'C:/Users/54459/Desktop/bigGem_yolo/runs/big_gem/weights/best.onnx')
results = m.val(data=r'C:/Users/54459/Desktop/bigGem_yolo/dataset.yaml', imgsz=640, device='cpu')
d = results.results_dict
print(f'ONNX Recall: {d[\"metrics/recall(B)\"]:.4f}')
print('✅ ONNX Recall 达标' if d['metrics/recall(B)'] >= 0.95 else '❌ ONNX Recall 不达标')
"
```

Expected: ONNX Recall ≥ 0.95。

- [ ] **Step 6: 复制到生产模型目录（验收通过后才执行）**

```bash
cp C:/Users/54459/Desktop/bigGem_yolo/runs/big_gem/weights/best.onnx D:/SLG/plugins/rok/models/bigGem.onnx
```

---

### Task 4: PluginService 加载 bigGemDetector

**Files:**
- Modify: `server/services/PluginService.ts`

- [ ] **Step 1: 新增 bigGemDetector 字段**

在 `PluginService` 类中，紧接 `heroDetector` 之后添加：

```typescript
private bigGemDetector: YoloDetector | null = null;
```

- [ ] **Step 2: 在 initYoloDetector 中加载 bigGem.onnx**

在 `initYoloDetector()` 方法末尾（heroDetector 加载之后）添加：

```typescript
const bigGemModelPath = path.join(getModelsDir(), 'bigGem.onnx');
try {
  this.bigGemDetector = await YoloDetector.create(bigGemModelPath);
  console.log('[PluginService] bigGem detector initialized');
} catch (err: any) {
  console.warn('[PluginService] bigGem model not found at', bigGemModelPath, '- bigGem detection disabled:', err.message);
  this.bigGemDetector = null;
}
```

- [ ] **Step 3: buildManager 传递 bigGemDetector**

修改 `buildManager()` 中的 `PluginManager` 构造调用，追加 `bigGemDetector`：

```typescript
const manager = new PluginManager(
  device,
  this.vision,
  this.yoloDetector ?? undefined,
  this.stateDetector ?? undefined,
  this.heroDetector ?? undefined,
  this.bigGemDetector ?? undefined
);
```

- [ ] **Step 4: TypeScript 编译检查**

```bash
npx tsc --noEmit
```

Expected: 无错误。如果有类型错误（PluginManager 构造函数参数数量不匹配），继续 Task 5。

---

### Task 5: PluginManager 接受并传递 bigGemDetector

**Files:**
- Modify: `core/plugin/PluginManager.ts`

- [ ] **Step 1: 新增字段与构造参数**

```typescript
private bigGemDetector?: YoloDetector;

constructor(
  device: Device,
  vision: Vision,
  yoloDetector?: YoloDetector,
  stateDetector?: YoloDetector,
  heroDetector?: YoloDetector,
  bigGemDetector?: YoloDetector
) {
  this.device = device;
  this.vision = vision;
  this.yoloDetector = yoloDetector;
  this.stateDetector = stateDetector;
  this.heroDetector = heroDetector;
  this.bigGemDetector = bigGemDetector;
}
```

- [ ] **Step 2: runAction 中创建 PluginContext 时传递**

```typescript
const ctx = new PluginContext(
  this.device,
  this.vision,
  config,
  checkStop,
  logCallback,
  this.yoloDetector,
  this.stateDetector,
  this.heroDetector,
  this.bigGemDetector
);
```

- [ ] **Step 3: TypeScript 编译检查**

```bash
npx tsc --noEmit
```

Expected: 无错误。如果 PluginContext 构造函数参数数量不匹配，继续 Task 6。

---

### Task 6: PluginContext 新增 bigGem 检测 API

**Files:**
- Modify: `core/plugin/PluginContext.ts`

- [ ] **Step 1: 新增构造参数与字段**

在 `PluginContext` 类中，`heroDetector` 之后添加：

```typescript
private bigGemDetector?: YoloDetector;
```

构造参数追加：

```typescript
bigGemDetector?: YoloDetector
```

构造函数体中：

```typescript
this.bigGemDetector = bigGemDetector;
```

- [ ] **Step 2: 新增 detectBigGemImage 方法**

在 `detectHeroImage` 方法之后添加：

```typescript
/**
 * 用放大宝石模型（bigGem.onnx）检测指定图片，不做截图与清理。
 */
async detectBigGemImage(imagePath: string, threshold: number = 0.5, classIndices: number[] = [0]): Promise<Detection[]> {
  this.checkCancellation();
  if (!this.bigGemDetector) return [];
  return this.bigGemDetector.detect(imagePath, threshold, 0.45, classIndices);
}
```

- [ ] **Step 3: 新增 detectBigGemWithScreenshot 方法**

```typescript
/**
 * 截图并用放大宝石模型（bigGem.onnx）检测，自动清理临时文件。
 */
async detectBigGemWithScreenshot(threshold: number = 0.5, classIndices: number[] = [0]): Promise<Detection[]> {
  this.checkCancellation();
  if (!this.bigGemDetector) return [];

  const screenshotBuffer = await this.device.screenshot();
  const tempPath = path.join(os.tmpdir(), `bigGem-${Date.now()}.png`);
  await fs.writeFile(tempPath, screenshotBuffer);

  try {
    return await this.bigGemDetector.detect(tempPath, threshold, 0.45, classIndices);
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}
```

- [ ] **Step 4: TypeScript 编译检查**

```bash
npx tsc --noEmit
```

Expected: 无错误。

---

### Task 7: verifyGemAtCenter 切换到 bigGemDetector

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts`

- [ ] **Step 1: 重写 verifyGemAtCenter 函数**

用以下实现替换现有 `verifyGemAtCenter`（第 109–162 行）：

```typescript
/**
 * 二次确认宝石：用 bigGem.onnx 检测中心区域是否有宝石。
 * @returns found=true 且 x/y 为宝石检测框中心的全屏坐标
 */
export async function verifyGemAtCenter(ctx: PluginContext): Promise<{ found: boolean; x?: number; y?: number }> {
  ctx.log('  [宝石二次确认] bigGem 检测中心附近宝石...');

  const regionPath = await ctx.captureRegion(
    GEM_VERIFY_REGION.x, GEM_VERIFY_REGION.y, GEM_VERIFY_REGION.w, GEM_VERIFY_REGION.h
  );

  try {
    const detections = await ctx.detectBigGemImage(regionPath, 0.5, [0]);

    if (detections.length === 0) {
      ctx.log('  ❌ bigGem 中心附近无宝石，缩地继续螺旋搜索');
      if (isDevEnv()) {
        try {
          await fs.mkdir(GEM_VERIFY_FAIL_DIR, { recursive: true });
          const fullShot = await ctx.captureRegion(0, 0, 1600, 900);
          try {
            const outPath = path.join(
              GEM_VERIFY_FAIL_DIR,
              `fail_${Date.now()}_conf0.png`
            );
            await fs.copyFile(fullShot, outPath);
            ctx.log(`  [调试] 已保存失败截图: ${outPath}`);
          } finally {
            await fs.unlink(fullShot).catch(() => {});
          }
        } catch (e) {
          ctx.log(`  [调试] 保存失败截图出错: ${(e as Error).message}`);
        }
      }
      return { found: false };
    }

    // 取置信度最高的检测框
    const best = detections.reduce((a, b) => a.confidence > b.confidence ? a : b);

    // Detection.x/y 是相对于裁剪区域的中心坐标，换算到全屏
    const fullX = GEM_VERIFY_REGION.x + best.x;
    const fullY = GEM_VERIFY_REGION.y + best.y;

    ctx.log(`  ✅ bigGem 确认宝石矿 @ (${Math.round(fullX)}, ${Math.round(fullY)}) conf=${(best.confidence * 100).toFixed(1)}%`);
    return { found: true, x: Math.round(fullX), y: Math.round(fullY) };
  } finally {
    await fs.unlink(regionPath).catch(() => {});
  }
}
```

- [ ] **Step 2: 移除不再使用的 GEM_VERIFY_TEMPLATES 常量**

删除第 39–45 行：

```typescript
const GEM_VERIFY_TEMPLATES = [
  path.join(TEMPLATE_DIR, 'gem', 'dayGem.png'),
  path.join(TEMPLATE_DIR, 'gem', 'afternoonGem.png'),
  path.join(TEMPLATE_DIR, 'gem', 'nightGem.png'),
  path.join(TEMPLATE_DIR, 'gem', 'gem_old_day.png'),
  path.join(TEMPLATE_DIR, 'gem', 'gem_old_night.png'),
];
```

- [ ] **Step 3: 确认 vision import 不再需要（如有其他地方使用则保留）**

`gatherGem.ts` 顶部有 `import { Vision } from '../../../core/vision';` 和 `const vision = new Vision();` — 检查其他函数如 `isGemOccupied` 是否仍使用。如果仍在使用则保留 import。

- [ ] **Step 4: TypeScript 编译检查**

```bash
npx tsc --noEmit
```

Expected: 无错误。

---

### Task 8: 编写回归测试

**Files:**
- Modify: `plugins/rok/actions/gatherGem.test.ts`
- Modify: `plugins/rok/actions/gatherSharedGem.test.ts`

- [ ] **Step 1: 编写 verifyGemAtCenter bigGem 命中测试**

在 `gatherGem.test.ts` 末尾追加：

```typescript
describe('verifyGemAtCenter bigGem 检测', () => {
  it('bigGem 命中时返回检测框中心的全屏坐标', async () => {
    const detectBigGemImage = jest.fn(async () => [
      { x: 150, y: 120, width: 80, height: 80, confidence: 0.92, classIndex: 0 },
    ]);
    const ctx: any = {
      captureRegion: jest.fn(async () => 'temp-verify-region.png'),
      detectBigGemImage,
      log: jest.fn(),
    };

    // 动态 import，避免顶层 mock 冲突
    const { verifyGemAtCenter } = await import('./gatherGem');
    const result = await verifyGemAtCenter(ctx);

    expect(result.found).toBe(true);
    // GEM_VERIFY_REGION = { x: 650, y: 300, w: 300, h: 300 }
    // Detection(150, 120) + offset(650, 300) = (800, 420)
    expect(result.x).toBe(800);
    expect(result.y).toBe(420);
    expect(detectBigGemImage).toHaveBeenCalledWith('temp-verify-region.png', 0.5, [0]);
  });

  it('bigGem 无命中时返回 found=false', async () => {
    const ctx: any = {
      captureRegion: jest.fn(async () => 'temp-verify-region.png'),
      detectBigGemImage: jest.fn(async () => []),
      log: jest.fn(),
    };

    const { verifyGemAtCenter } = await import('./gatherGem');
    const result = await verifyGemAtCenter(ctx);

    expect(result.found).toBe(false);
    expect(result.x).toBeUndefined();
    expect(result.y).toBeUndefined();
  });

  it('bigGem 多命中时选择置信度最高的', async () => {
    const detectBigGemImage = jest.fn(async () => [
      { x: 100, y: 100, width: 60, height: 60, confidence: 0.75, classIndex: 0 },
      { x: 200, y: 180, width: 70, height: 70, confidence: 0.88, classIndex: 0 },
      { x: 50,  y: 250, width: 55, height: 55, confidence: 0.81, classIndex: 0 },
    ]);
    const ctx: any = {
      captureRegion: jest.fn(async () => 'temp-verify-region.png'),
      detectBigGemImage,
      log: jest.fn(),
    };

    const { verifyGemAtCenter } = await import('./gatherGem');
    const result = await verifyGemAtCenter(ctx);

    expect(result.found).toBe(true);
    // 置信度最高 0.88: (200, 180) + (650, 300) = (850, 480)
    expect(result.x).toBe(850);
    expect(result.y).toBe(480);
  });

  it('detectBigGemImage 抛错时 finally 仍清理临时文件', async () => {
    const unlink = jest.fn(async () => {});
    jest.mock('fs/promises', () => ({ unlink }));

    const ctx: any = {
      captureRegion: jest.fn(async () => 'temp-verify-region.png'),
      detectBigGemImage: jest.fn(async () => { throw new Error('inference error'); }),
      log: jest.fn(),
    };

    const { verifyGemAtCenter } = await import('./gatherGem');
    await expect(verifyGemAtCenter(ctx)).rejects.toThrow('inference error');
  });
});
```

- [ ] **Step 2: 更新 gatherSharedGem 截图回归测试**

`gatherSharedGem.test.ts` 中现有测试通过 `fs.readFileSync` 检查源码字符串。`verifyGemAtCenter` 重构后文件内容变化，需更新断言。将现有测试改为检查 `detectBigGemImage` 调用模式：

```typescript
describe('gatherSharedGem 补池时机', () => {
  const source = fs.readFileSync(path.join(__dirname, 'gatherSharedGem.ts'), 'utf8');

  test('只在 action 入口补充一次，处理中不再补池', () => {
    const calls = source.match(/await refillIfNeeded\(ctx, accountId\)/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  test('二次确认仅失败时保存调试截图', () => {
    expect(source).toContain("if (!verified.found) {\n      await saveDebugShot(ctx, 'verify_fail');");
    expect(source).not.toContain("'verify_success'");
  });
});
```

（此文件无需实质性改动，只确认测试仍可运行。）

- [ ] **Step 3: 运行测试确认现有测试未回归**

```bash
npx jest plugins/rok/actions/gatherGem.test.ts --runInBand
npx jest plugins/rok/actions/gatherSharedGem.test.ts --runInBand
```

Expected: 所有测试通过。

---

### Task 9: 全量验证

- [ ] **Step 1: 全量 TypeScript 检查**

```bash
npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 2: 全量 Jest**

```bash
npm test
```

Expected: 0 failures。如果有个别与本次改动无关的预存失败，标注出来。

- [ ] **Step 3: 确认 bigGem.onnx 在模型目录中**

```bash
ls -la D:/SLG/plugins/rok/models/bigGem.onnx
```

Expected: 文件存在，大小约 6 MB。

- [ ] **Step 4: 确认 electron-builder 配置无需修改**

`package.json` 的 `extraResources` 已配置 `plugins/rok/models → models`，覆盖整个目录。新增的 `bigGem.onnx` 会被自动打包。

---

### 回滚说明

如果 `bigGem.onnx` 不可用（缺失或加载失败），`PluginService.initYoloDetector()` 会将 `bigGemDetector` 设为 `null`，`verifyGemAtCenter` 的 `detectBigGemImage` 调用返回空数组，二次确认进入既有失败流程。不影响 `gem.onnx`、`state.onnx`、`hero.onnx` 的独立运行。
