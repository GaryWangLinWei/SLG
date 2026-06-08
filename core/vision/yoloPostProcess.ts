export interface RawDetection {
  x: number;      // 中心 x（模型空间，0~1 归一化）
  y: number;      // 中心 y（模型空间，0~1 归一化）
  w: number;      // 宽（模型空间，0~1 归一化）
  h: number;      // 高（模型空间，0~1 归一化）
  confidence: number;  // 置信度 0~1
  classIndex: number;  // 类别索引
}

export interface Detection {
  x: number;      // 中心 x（原图像素坐标）
  y: number;      // 中心 y（原图像素坐标）
  width: number;  // 框宽（原图像素）
  height: number; // 框高（原图像素）
  confidence: number;
  classIndex: number;
}

/**
 * 计算两个框的 IoU（Intersection over Union）
 */
export function computeIoU(a: RawDetection, b: RawDetection): number {
  const ax1 = a.x - a.w / 2;
  const ay1 = a.y - a.h / 2;
  const ax2 = a.x + a.w / 2;
  const ay2 = a.y + a.h / 2;

  const bx1 = b.x - b.w / 2;
  const by1 = b.y - b.h / 2;
  const bx2 = b.x + b.w / 2;
  const by2 = b.y + b.h / 2;

  const interX1 = Math.max(ax1, bx1);
  const interY1 = Math.max(ay1, by1);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);

  const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1);
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;

  return interArea / (areaA + areaB - interArea + 1e-9);
}

/**
 * Non-Maximum Suppression — 去重重叠框，保留置信度最高的
 */
export function nms(detections: RawDetection[], iouThreshold: number = 0.45): RawDetection[] {
  if (detections.length === 0) return [];

  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const keep: RawDetection[] = [];

  for (const det of sorted) {
    const overlap = keep.some(k => computeIoU(det, k) > iouThreshold);
    if (!overlap) keep.push(det);
  }

  return keep;
}

/**
 * 解析 YOLO 输出的 float32 tensor 为检出列表。
 *
 * @param output — ONNX 输出 tensor data（Float32Array）
 * @param dims  — tensor 形状，如 [1, 5, 8400] 或 [1, 6, 8400]
 * @param threshold — 最低置信度
 * @param numClasses — 类别数（默认 1）
 */
export function parseYoloOutput(
  output: Float32Array,
  dims: readonly number[],
  threshold: number = 0.5,
  numClasses: number = 1
): RawDetection[] {
  // YOLOv8 输出格式: (1, 4 + 1 + numClasses, numAnchors)
  // channels: [x_center, y_center, width, height, objectness, class_0, class_1, ...]
  const features = dims[1];          // 每个 anchor 的特征数
  const numAnchors = dims[2];

  const detections: RawDetection[] = [];

  for (let i = 0; i < numAnchors; i++) {
    const offset = i * features;

    const x = output[offset + 0];
    const y = output[offset + 1];
    const w = output[offset + 2];
    const h = output[offset + 3];
    const objectness = output[offset + 4];

    // 找最高分的类别
    let bestClass = 0;
    let bestClassScore = 0;
    for (let c = 0; c < numClasses; c++) {
      const score = output[offset + 5 + c];
      if (score > bestClassScore) {
        bestClassScore = score;
        bestClass = c;
      }
    }

    const confidence = objectness * bestClassScore;
    if (confidence >= threshold) {
      detections.push({ x, y, w, h, confidence, classIndex: bestClass });
    }
  }

  return detections;
}

/**
 * 将模型空间坐标映射回原图坐标。
 *
 * @param detections — 0~1 归一化坐标
 * @param imgWidth   — 原图宽度
 * @param imgHeight  — 原图高度
 * @param letterboxScale — letterbox 缩放比例
 * @param padXN      — 水平 padding（归一化，0~1）
 * @param padYN      — 垂直 padding（归一化，0~1）
 */
export function scaleToOriginal(
  detections: RawDetection[],
  imgWidth: number,
  imgHeight: number,
  letterboxScale: number,
  padXN: number,
  padYN: number
): Detection[] {
  return detections.map(d => {
    // 去除 letterbox pad 的影响
    const sx = d.x - padXN;
    const sy = d.y - padYN;

    // 还原到原图像素坐标
    const ox = (sx / letterboxScale) * imgWidth;
    const oy = (sy / letterboxScale) * imgHeight;
    const ow = (d.w / letterboxScale) * imgWidth;
    const oh = (d.h / letterboxScale) * imgHeight;

    return {
      x: Math.round(ox),
      y: Math.round(oy),
      width: Math.round(ow),
      height: Math.round(oh),
      confidence: d.confidence,
      classIndex: d.classIndex,
    };
  });
}

/**
 * 完整的 YOLO 后处理管线：解析 → NMS → 坐标映射
 */
export function postProcess(
  output: Float32Array,
  outputDims: readonly number[],
  imgWidth: number,
  imgHeight: number,
  letterboxScale: number,
  padXN: number,
  padYN: number,
  threshold: number = 0.5,
  iouThreshold: number = 0.45,
  numClasses: number = 1
): Detection[] {
  const raw = parseYoloOutput(output, outputDims, threshold, numClasses);
  const filtered = nms(raw, iouThreshold);
  return scaleToOriginal(filtered, imgWidth, imgHeight, letterboxScale, padXN, padYN);
}
