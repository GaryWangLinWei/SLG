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
  it('should parse valid detections from multi-class tensor', () => {
    // (1, 6, 2) channel-major: [ch0_a0, ch0_a1, ch1_a0, ch1_a1, ...]
    // ch0=x, ch1=y, ch2=w, ch3=h, ch4=obj, ch5=cls
    // anchor 0: x=0.5,y=0.5,w=0.1,h=0.1,conf=0.9
    // anchor 1: x=0.3,y=0.3,w=0.05,h=0.05,conf=0.4
    const tensor = new Float32Array([
      0.5, 0.3,  // ch0: x for anchors 0,1
      0.5, 0.3,  // ch1: y
      0.1, 0.05, // ch2: w
      0.1, 0.05, // ch3: h
      0.9, 0.4,  // ch4: conf
      0.8, 0.3,  // ch5: (unused)
    ]);
    const result = parseYoloOutput(tensor, [1, 6, 2], 0.5, 1);
    expect(result.length).toBe(1);
    expect(result[0].confidence).toBeCloseTo(0.9, 5);
    expect(result[0].classIndex).toBe(0);
  });

  it('should handle single-class (numClasses=0) output', () => {
    // (1, 5, 2) 单类模型: channel-major [x0,x1, y0,y1, w0,w1, h0,h1, obj0,obj1]
    const tensor = new Float32Array([
      0.5, 0.3,  // ch0: x  → anchor0 x=0.5, anchor1 x=0.3
      0.6, 0.4,  // ch1: y
      0.1, 0.2,  // ch2: w
      0.1, 0.2,  // ch3: h
      0.9, 0.4,  // ch4: conf → anchor0 conf=0.9, anchor1 conf=0.4
    ]);
    const result = parseYoloOutput(tensor, [1, 5, 2], 0.5, 0);
    expect(result.length).toBe(1);
    expect(result[0].confidence).toBeCloseTo(0.9, 5);
    expect(result[0].x).toBeCloseTo(0.5, 5);
    expect(result[0].y).toBeCloseTo(0.6, 5);
    expect(result[0].classIndex).toBe(0);
  });

  it('should return empty when none meet threshold', () => {
    // (1, 6, 1) channel-major: single anchor, all below threshold
    const tensor = new Float32Array([
      0.5,   // x
      0.5,   // y
      0.1,   // w
      0.1,   // h
      0.2,   // obj
      0.3,   // cls → conf=0.06
    ]);
    const result = parseYoloOutput(tensor, [1, 6, 1], 0.5, 1);
    expect(result.length).toBe(0);
  });
});

describe('scaleToOriginal', () => {
  it('should map coordinates from model space to original image (no padding)', () => {
    // 模型空间 640×640 → 归一化 [0,1] 坐标
    // 公式: orig = (d - padN) * max(imgW, imgH)
    // max(1600,900) = 1600
    const dets: RawDetection[] = [
      { x: 0.5, y: 0.5, w: 0.1, h: 0.1, confidence: 0.9, classIndex: 0 },
    ];
    const result = scaleToOriginal(dets, 1600, 900, 0.4, 0, 0);
    // x=0.5*1600=800, y=0.5*1600=800, w=0.1*1600=160, h=0.1*1600=160
    expect(result[0].x).toBe(800);
    expect(result[0].y).toBe(800);
    expect(result[0].width).toBe(160);
    expect(result[0].height).toBe(160);
  });

  it('should handle padding offset', () => {
    // max(800,600) = 800
    var dets: RawDetection[] = [
      { x: 0.6, y: 0.55, w: 0.1, h: 0.1, confidence: 0.9, classIndex: 0 },
    ];
    var result = scaleToOriginal(dets, 800, 600, 0.5, 0.1, 0.05);
    // sx=0.6-0.1=0.5, sy=0.55-0.05=0.5
    // x=0.5*800=400, y=0.5*800=400, w=0.1*800=80, h=0.1*800=80
    expect(result[0].x).toBe(400);
    expect(result[0].y).toBe(400);
    expect(result[0].width).toBe(80);
    expect(result[0].height).toBe(80);
  });
});

describe('postProcess', () => {
  it('should run full pipeline end to end', () => {
    // 1 anchor, (x=0.5, y=0.5, w=0.1, h=0.1, conf=0.9)
    var tensor = new Float32Array([
      0.5, 0.5, 0.1, 0.1, 0.9, 0.95,
    ]);
    var result = postProcess(
      tensor, [1, 6, 1],
      1600, 900,   // 原图尺寸
      0.4, 0, 0,   // scale=0.4 (max=1600), no pad
      0.5, 0.45, 1
    );
    // max(1600,900)=1600, x=0.5*1600=800, y=0.5*1600=800
    expect(result.length).toBe(1);
    expect(result[0].confidence).toBeCloseTo(0.9, 5);
    expect(result[0].x).toBe(800);
    expect(result[0].y).toBe(800);
  });

  it('should filter below threshold in full pipeline', () => {
    // conf=0.4*0.3=0.12 < 0.5
    var tensor = new Float32Array([
      0.5, 0.5, 0.1, 0.1, 0.4, 0.3,
    ]);
    var result = postProcess(
      tensor, [1, 6, 1],
      1600, 900,
      0.4, 0, 0,
      0.5, 0.45, 1
    );
    expect(result.length).toBe(0);
  });
});
