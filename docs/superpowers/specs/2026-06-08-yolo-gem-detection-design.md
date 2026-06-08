# YOLO 目标检测替换模板匹配 — 宝石采集

> 用 ONNX Runtime + YOLO 模型替代多模板并行搜索，将宝石矿识别从 ~19s 降到 <1s。

## 架构

```
core/vision/
├── Vision.ts              # 保留，不修改
├── YoloDetector.ts        # 新增，单例 ONNX 推理
└── yoloPostProcess.ts     # 新增，NMS + 坐标还原

plugins/rok/
├── models/
│   └── gem.onnx            # 新增，YOLO 模型（~10MB）
├── actions/
│   └── gatherGem.ts        # 修改：findImageWithLocation → yoloDetector.detect
```

**数据流：** 截图 PNG → sharp 解码 → resize + normalize → ONNX 推理 → 解析输出 tensor → NMS → `Detection[]` → 业务逻辑取坐标点击。

## YoloDetector

单例懒加载，`create(modelPath)` 初始化一次，全局复用回话。

```typescript
class YoloDetector {
  static async create(modelPath: string): Promise<YoloDetector>

  /**
   * 检测图片中的所有目标。
   * @returns 按置信度降序排列的检测结果
   */
  async detect(
    imagePath: string,
    threshold?: number    // 默认 0.5
  ): Promise<Detection[]>
}

type Detection = {
  x: number;            // 目标中心 x（相对原图）
  y: number;            // 目标中心 y（相对原图）
  width: number;        // 框宽
  height: number;       // 框高
  confidence: number;   // 置信度 0~1
  classIndex: number;   // 0 = gem（将来可扩展城寨等）
}
```

### 预处理

1. `sharp` 加载截图，resize 到模型输入尺寸（默认 640×640，保持宽高比 letterbox，填充灰边 114）
2. 转 RGB（移除 alpha），float32，归一化到 [0, 1]
3. CHW 排列 (3, 640, 640)

### 后处理

1. 解析 YOLO 输出 tensor：`(1, 5+N, 8400)` — 8400 个 anchor，每 anchor 含 x/y/w/h + objectness + N 个 class score
2. 过滤 objectness × classScore < threshold 的 anchor
3. NMS（IoU 阈值 0.45）
4. 坐标从模型空间 (640×640) 映射回原图 (1600×900)

## 模型规格

| 项 | 值 |
|---|---|
| 架构 | YOLOv8n（nano，最快）|
| 输入 | (1, 3, 640, 640) float32 |
| 输出 | (1, 5, 8400) — 单类（gem）|
| 体积 | ~6MB（FP32）或 ~3MB（FP16）|
| 标注量 | 100~200 张截图，含宝石矿 bounding box |

后期如需同时识别城寨，可将输出改为 (1, 6, 8400) 双类（gem + fort），模型体积不变，标注量翻倍。

## gatherGem 改动

搜索回路从「并行 findImageWithLocation × 3 模板 × 3 尺度」简化为：

```typescript
// 旧（~19s）：3 模板 × 3 尺度 = 9 次全图扫描
const matchResults = await Promise.all(
  baoshiTemplates.map(t => ctx.findImageWithLocation(t, 0.7, scales))
);

// 新（<1s）：一次 ONNX 推理
const detections = await ctx.yoloDetector.detect(screenshotPath, 0.5);
const best = detections.sort((a, b) => b.confidence - a.confidence)[0];
```

螺旋搜索不变——每轮 swipe 后重新调用 `detect()` 即可，性能开销可忽略。

## PluginContext 注入

`PluginContext` 新增 `yoloDetector?: YoloDetector` 字段。通过 `PluginManager` 在创建 ctx 时注入，与设备抽象层平级。

## 部署

### 依赖

```json
// package.json
"dependencies": {
  "onnxruntime-node": "^1.18.0"   // 已有 sharp 0.34，无需额外配置
}
```

`onnxruntime-node` 在 Windows x64 上有预编译二进制（prebuildify），`npm install` 即用，无需 C++ 编译环境。

### 模型文件打包

```json
// electron-builder extraResources
{
  "from": "plugins/rok/models",
  "to": "models"
}
```

`resourcePath.ts` 新增：

```typescript
export function getModelsDir(): string {
  if (injectedModelsDir) return injectedModelsDir;
  return path.join(__dirname, '..', 'plugins', 'rok', 'models');
}
```

### 安装包影响

模型 ~3MB（FP16），安装包增量可忽略。

## 风险

| 风险 | 缓解 |
|---|---|
| 模型未训练，暂无可用 gem.onnx | 先完成代码基础设施，标注样本后训练模型 |
| ONNX 推理在部分 Windows 机器可能崩溃 | 加 try-catch，fallback 到模板匹配 |
| 首次推理需要 warmup（~1-2s） | 在 YoloDetector.create() 时跑一次空推理预热 |
| CPU 推理可能有内存峰值 | nano 模型推理峰值 <200MB，可接受 |

## 可扩展性

- **城寨识别**：同一模型加一个 class（gem + fort），标注城寨 bounding box 即可。`rallyFortSpiral.ts` 复用同一 YoloDetector 实例。
- **更多 UI 元素**：只要标注数据到位，理论上可替代所有 `findImage` / `findImageWithLocation` 调用。

## 测试策略

1. `YoloDetector.test.ts` — 用模拟 ONNX 模型验证预处理/后处理正确性
2. `Vision.test.ts` — 对 Test 截图目录跑 `detect()`，记录耗时和置信度分布
3. `gatherGem.test.ts` — 模拟完整采集流程，验证 YoloDetector 集成
