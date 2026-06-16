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
    const text = (await ocrService.readDigits(regionPath)).trim();
    ctx.log(`[GEM-COUNT] OCR: "${text}"`);

    // 提取数字（支持 "1.2K" "1234" "1,234" 等格式）
    const numMatch = text.match(/(\d[\d,.]*[KkMm]?|\d+)/);
    if (numMatch) {
      const raw = numMatch[1].toUpperCase().replace(/,/g, '');
      let num: number;
      if (raw.endsWith('K')) {
        num = Math.round(parseFloat(raw.slice(0, -1)) * 1000);
      } else if (raw.endsWith('M')) {
        num = Math.round(parseFloat(raw.slice(0, -1)) * 1_000_000);
      } else {
        num = parseInt(raw, 10);
      }
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
