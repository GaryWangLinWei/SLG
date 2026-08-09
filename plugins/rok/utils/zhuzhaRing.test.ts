import { scoreZhuzhaRing, isZhuzhaBlue, ZHUZHA_RING_RECT } from './zhuzhaRing';

// 构造一张指定宽高的 RGB 图，默认底色，再用 paint 填充部分像素
function makeImage(width: number, height: number, fill: [number, number, number], paint?: Array<{ x: number; y: number; c: [number, number, number] }>): { data: Buffer; width: number; channels: number } {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = fill[0];
    data[i * 3 + 1] = fill[1];
    data[i * 3 + 2] = fill[2];
  }
  if (paint) {
    for (const p of paint) {
      const i = (p.y * width + p.x) * 3;
      data[i] = p.c[0];
      data[i + 1] = p.c[1];
      data[i + 2] = p.c[2];
    }
  }
  return { data, width, channels: 3 };
}

describe('isZhuzhaBlue', () => {
  it('accepts the ring blue (~0,142,194)', () => {
    expect(isZhuzhaBlue(0, 142, 194)).toBe(true);
  });
  it('rejects orange avatar background', () => {
    expect(isZhuzhaBlue(162, 98, 11)).toBe(false);
  });
  it('rejects green map background', () => {
    expect(isZhuzhaBlue(68, 123, 95)).toBe(false);
  });
});

describe('scoreZhuzhaRing', () => {
  it('detects zhuzha when upper arc is ring blue (>25%)', () => {
    const rect = ZHUZHA_RING_RECT;
    const paint = [];
    // 把采样条上半部分涂成蓝（超过 25%）
    for (let y = rect.y; y < rect.y + 6; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        paint.push({ x, y, c: [0, 142, 194] as [number, number, number] });
      }
    }
    const img = makeImage(1600, 900, [180, 140, 40], paint);
    const r = scoreZhuzhaRing(img.data, img.width, img.channels);
    expect(r.found).toBe(true);
    expect(r.ratio).toBeGreaterThan(0.4);
  });

  it('does not detect on plain avatar/background (no blue)', () => {
    const img = makeImage(1600, 900, [180, 140, 40]);
    const r = scoreZhuzhaRing(img.data, img.width, img.channels);
    expect(r.found).toBe(false);
    expect(r.bluePixels).toBe(0);
  });

  it('supports RGBA buffers (4 channels)', () => {
    const rect = ZHUZHA_RING_RECT;
    const w = 1600, ch = 4;
    const data = Buffer.alloc(w * 900 * ch);
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const i = (y * w + x) * ch;
        data[i] = 0; data[i + 1] = 142; data[i + 2] = 194; data[i + 3] = 255;
      }
    }
    const r = scoreZhuzhaRing(data, w, ch);
    expect(r.found).toBe(true);
  });
});
