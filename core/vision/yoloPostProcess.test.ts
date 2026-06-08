import { computeIoU, nms, parseYoloOutput, scaleToOriginal, postProcess } from './yoloPostProcess';
import { RawDetection } from './yoloPostProcess';

describe('computeIoU', () => {
  it('should return 1.0 for identical boxes', () => {
    const a: RawDetection = { x: 0.5, y: 0.5, w: 0.2, h: 0.2, confidence: 0.9, classIndex: 0 };
    expect(computeIoU(a, a)).toBeCloseTo(1.0, 5);
  });

  it('should return 0 for non-overlapping boxes', () => {
    const a: RawDetection = { x: 0.1, y: 0.1, w: 0.1, h: 0.1, confidence: 0.9, classIndex: 0 };
    const b: RawDetection = { x: 0.9, y: 0.9, w: 0.1, h: 0.1, confidence: 0.8, classIndex: 0 };
    expect(computeIoU(a, b)).toBeCloseTo(0, 5);
  });

  it('should compute partial overlap correctly', () => {
    // 两个 0.2×0.2 的框，中心偏移 0.1 → 部分重叠
    const a: RawDetection = { x: 0.5, y: 0.5, w: 0.2, h: 0.2, confidence: 0.9, classIndex: 0 };
    const b: RawDetection = { x: 0.6, y: 0.5, w: 0.2, h: 0.2, confidence: 0.8, classIndex: 0 };
    const iou = computeIoU(a, b);
    expect(iou).toBeGreaterThan(0.3);
    expect(iou).toBeLessThan(0.4);
  });
});

describe('nms', () => {
  it('should keep the highest confidence detection and remove overlapping ones', () => {
    const dets: RawDetection[] = [
      { x: 0.5, y: 0.5, w: 0.2, h: 0.2, confidence: 0.7, classIndex: 0 },
      { x: 0.51, y: 0.51, w: 0.2, h: 0.2, confidence: 0.9, classIndex: 0 },
      { x: 0.52, y: 0.52, w: 0.2, h: 0.2, confidence: 0.5, classIndex: 0 },
    ];
    const kept = nms(dets, 0.45);
    expect(kept.length).toBe(1);
    expect(kept[0].confidence).toBe(0.9);
  });

  it('should keep non-overlapping detections', () => {
    const dets: RawDetection[] = [
      { x: 0.2, y: 0.2, w: 0.1, h: 0.1, confidence: 0.7, classIndex: 0 },
      { x: 0.8, y: 0.8, w: 0.1, h: 0.1, confidence: 0.8, classIndex: 0 },
    ];
    const kept = nms(dets, 0.45);
    expect(kept.length).toBe(2);
  });

  it('should return empty for empty input', () => {
    expect(nms([], 0.45)).toEqual([]);
  });
});

describe('parseYoloOutput', () => {
  it('should parse valid detections from tensor', () => {
    // 模拟 (1, 6, 2) tensor — 1 class, 2 anchors
    // anchor 0: (0.5, 0.5, 0.1, 0.1, 0.9, 0.8) → conf=0.9*0.8=0.72, above 0.5
    // anchor 1: (0.3, 0.3, 0.05, 0.05, 0.4, 0.3) → conf=0.4*0.3=0.12, below 0.5
    const tensor = new Float32Array([
      0.5, 0.5, 0.1, 0.1, 0.9, 0.8,
      0.3, 0.3, 0.05, 0.05, 0.4, 0.3,
    ]);
    const result = parseYoloOutput(tensor, [1, 6, 2], 0.5, 1);
    expect(result.length).toBe(1);
    expect(result[0].confidence).toBeCloseTo(0.72, 5);
    expect(result[0].classIndex).toBe(0);
  });

  it('should return empty when none meet threshold', () => {
    const tensor = new Float32Array([
      0.5, 0.5, 0.1, 0.1, 0.2, 0.3,
    ]);
    const result = parseYoloOutput(tensor, [1, 6, 1], 0.5, 1);
    expect(result.length).toBe(0);
  });
});

describe('scaleToOriginal', () => {
  it('should map coordinates from model space to original image (no padding)', () => {
    // 原图 1600×900, scale=0.4 (model 640), no pad
    // 目标在模型空间: (0.5, 0.5) 中心 → 原图 (0.5/0.4, 0.5/0.4) = (1.25, 1.25) in normalized...
    // Actually (0.5, 0.5) normalized → 原图 (0.5/0.4)*原图 = 800,450
    // w=0.1 → 原图 w=0.1/0.4 = 0.25 → 1600*0.25 = 400px...
    // Let me use simpler values
    const dets: RawDetection[] = [
      { x: 0.5, y: 0.5, w: 0.1, h: 0.1, confidence: 0.9, classIndex: 0 },
    ];
    const result = scaleToOriginal(dets, 1600, 900, 1.0, 0, 0);
    // scale=1, no pad → coordinates are directly proportional
    // x=0.5 * 1600 = 800, y=0.5 * 900 = 450
    // w=0.1 * 1600 = 160, h=0.1 * 900 = 90
    expect(result[0].x).toBe(800);
    expect(result[0].y).toBe(450);
    expect(result[0].width).toBe(160);
    expect(result[0].height).toBe(90);
  });

  it('should handle padding offset', () => {
    // 有 padding 的情况：padX=0.1, padY=0.05 (normalized)
    const dets: RawDetection[] = [
      { x: 0.6, y: 0.55, w: 0.1, h: 0.1, confidence: 0.9, classIndex: 0 },
    ];
    const result = scaleToOriginal(dets, 800, 600, 0.5, 0.1, 0.05);
    // After removing pad: sx=0.6-0.1=0.5, sy=0.55-0.05=0.5
    // Scale to original: ox=0.5/0.5=1.0, oy=0.5/0.5=1.0
    // In pixels: x=1.0*800=800, y=1.0*600=600
    // w=0.1/0.5=0.2 → 0.2*800=160, h=0.1/0.5=0.2 → 0.2*600=120
    expect(result[0].x).toBe(800);
    expect(result[0].y).toBe(600);
    expect(result[0].width).toBe(160);
    expect(result[0].height).toBe(120);
  });
});

describe('postProcess', () => {
  it('should run full pipeline end to end', () => {
    // 1 anchor, (x=0.5, y=0.5, w=0.1, h=0.1, obj=0.9, cls=0.95) → conf=0.855
    const tensor = new Float32Array([
      0.5, 0.5, 0.1, 0.1, 0.9, 0.95,
    ]);
    const result = postProcess(
      tensor, [1, 6, 1],
      1600, 900,   // 原图尺寸
      1.0, 0, 0,   // scale=1, no pad
      0.5, 0.45, 1
    );
    expect(result.length).toBe(1);
    expect(result[0].confidence).toBeCloseTo(0.855, 3);
    expect(result[0].x).toBe(800);
    expect(result[0].y).toBe(450);
  });

  it('should filter below threshold in full pipeline', () => {
    // conf=0.4*0.3=0.12 < 0.5
    const tensor = new Float32Array([
      0.5, 0.5, 0.1, 0.1, 0.4, 0.3,
    ]);
    const result = postProcess(
      tensor, [1, 6, 1],
      1600, 900,
      1.0, 0, 0,
      0.5, 0.45, 1
    );
    expect(result.length).toBe(0);
  });
});
