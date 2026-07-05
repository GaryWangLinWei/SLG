import { PluginContext } from '../../../core/plugin';
import { ocrService } from '../../../core/ocr/OcrService';
import * as fs from 'fs/promises';

// 宝石数量显示区域
const GEM_COUNT_REGION = { x: 1475, y: 12, width: 80, height: 37 };

export async function readGemCount(ctx: PluginContext): Promise<number | null> {
  const regionPath = await ctx.captureRegion(
    GEM_COUNT_REGION.x,
    GEM_COUNT_REGION.y,
    GEM_COUNT_REGION.width,
    GEM_COUNT_REGION.height
  );

  try {
    const text = (await ocrService.readGemCount(regionPath)).trim();
    ctx.log(`[GEM-COUNT] OCR: "${text}"`);

    // 提取数字（支持 "5,562" 等千位分隔符格式）
    const numMatch = text.match(/(\d[\d,]*|\d+)/);
    if (numMatch) {
      const raw = numMatch[1].replace(/,/g, '');  // 移除千位分隔符
      const num = parseInt(raw, 10);
      if (!isNaN(num)) {
        ctx.log(`[GEM-COUNT] ${num}`);
        return num;
      }
    }
    ctx.log(`[GEM-COUNT] 解析失败`);
    return null;
  } finally {
    await fs.unlink(regionPath).catch(() => {});
  }
}
