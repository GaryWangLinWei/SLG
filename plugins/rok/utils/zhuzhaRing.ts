import sharp from 'sharp';

/**
 * 驻扎（zhuzha）状态：右上角槽位武将头像右下角的蓝色圆环帐篷图标。
 *
 * 该图标下半部分是透明通道，无法用整图模板匹配；ONNX 对该形态置信度过低
 * （实测约 18%）。但圆环上半部分是一段确定的蓝色（实测 RGB≈(0,142,194)），
 * 透到底下的武将头像/地图背景不会呈现这种高饱和蓝。
 *
 * 因此只截取圆环上弧的一小条矩形，统计蓝色像素数量来判定。
 */

/** 圆环上弧采样条（相对 1600×900）。中心 (1557,265)，宽约 28，高约 12 */
export const ZHUZHA_RING_RECT = {
  x: 1543,
  y: 258,
  width: 30,
  height: 13,
};

/** 蓝色像素判定：圆环实测 RGB≈(0,142,194)；要求 B 高且明显大于 R/G */
export function isZhuzhaBlue(r: number, g: number, b: number): boolean {
  return b >= 140 && b - r >= 70 && b - g >= 35;
}

/** 蓝色像素达到该比例即判定为驻扎（上弧实测蓝像素约占 50%+） */
export const ZHUZHA_BLUE_RATIO_THRESHOLD = 0.25;

export interface ZhuzhaRingResult {
  found: boolean;
  bluePixels: number;
  totalPixels: number;
  ratio: number;
}

/**
 * 从已解码的原始 RGB 数据中统计圆环上弧的蓝色像素比例。
 * data 为连续 RGB/RGBA（由 channels 指定），坐标相对整张截图。
 */
export function scoreZhuzhaRing(
  data: Buffer,
  imageWidth: number,
  channels: number,
  rect = ZHUZHA_RING_RECT,
): ZhuzhaRingResult {
  let blue = 0;
  let total = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * imageWidth + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      total++;
      if (isZhuzhaBlue(r, g, b)) blue++;
    }
  }
  const ratio = total > 0 ? blue / total : 0;
  return { found: ratio >= ZHUZHA_BLUE_RATIO_THRESHOLD, bluePixels: blue, totalPixels: total, ratio };
}

/** 从截图文件统计圆环上弧蓝色比例 */
export async function detectZhuzhaRingFile(imagePath: string): Promise<ZhuzhaRingResult> {
  const { data, info } = await sharp(imagePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return scoreZhuzhaRing(data, info.width, 3);
}

/** 右侧队伍状态槽列范围（相对 1600×900） */
export const ZHUZHA_COLUMN = { x: 1543, yStart: 202, yEnd: 680 };

export interface ZhuzhaSlot {
  x: number;
  y: number;
  ratio: number;
}

/**
 * 沿右侧队伍槽列自上而下滑动圆环采样条，找出所有蓝色圆环（驻扎）位置。
 * 返回每个命中槽的圆环中心坐标，按 y 升序。用于多队驻扎时定位每一队。
 */
export function findZhuzhaSlots(
  data: Buffer,
  imageWidth: number,
  channels: number,
  opts: { step?: number; minGap?: number } = {},
): ZhuzhaSlot[] {
  const step = opts.step ?? 4;
  const minGap = opts.minGap ?? 30;
  const hits: ZhuzhaSlot[] = [];
  for (let y = ZHUZHA_COLUMN.yStart; y + ZHUZHA_RING_RECT.height <= ZHUZHA_COLUMN.yEnd; y += step) {
    const r = scoreZhuzhaRing(data, imageWidth, channels, {
      x: ZHUZHA_COLUMN.x,
      y,
      width: ZHUZHA_RING_RECT.width,
      height: ZHUZHA_RING_RECT.height,
    });
    if (r.found) {
      hits.push({ x: ZHUZHA_COLUMN.x + ZHUZHA_RING_RECT.width / 2, y: y + ZHUZHA_RING_RECT.height / 2, ratio: r.ratio });
    }
  }
  // 同一圆环会在相邻多行命中，按 minGap 合并成一个槽，取 ratio 最高的位置
  const slots: ZhuzhaSlot[] = [];
  for (const hit of hits) {
    const last = slots[slots.length - 1];
    if (last && Math.abs(hit.y - last.y) < minGap) {
      if (hit.ratio > last.ratio) {
        last.y = hit.y;
        last.ratio = hit.ratio;
      }
    } else {
      slots.push({ ...hit });
    }
  }
  return slots;
}

/** 从截图文件扫描右侧驻扎槽列 */
export async function findZhuzhaSlotsFile(imagePath: string): Promise<ZhuzhaSlot[]> {
  const { data, info } = await sharp(imagePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return findZhuzhaSlots(data, info.width, 3);
}
