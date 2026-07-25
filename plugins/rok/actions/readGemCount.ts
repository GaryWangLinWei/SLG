import { PluginContext } from '../../../core/plugin';
import { ocrService } from '../../../core/ocr/OcrService';
import * as fs from 'fs/promises';
import * as path from 'path';

// 宝石数量显示区域
const GEM_COUNT_REGION = { x: 1475, y: 12, width: 80, height: 37 };
const GEM_COUNT_DEBUG_DIR = path.join(process.cwd(), 'temp', 'debug', 'gem_count');

function isDevEnv(): boolean {
  try {
    const { app } = require('electron');
    return !app.isPackaged;
  } catch {
    return true;
  }
}

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
        if (isDevEnv()) {
          await fs.mkdir(GEM_COUNT_DEBUG_DIR, { recursive: true });
          const debugPath = path.join(GEM_COUNT_DEBUG_DIR, `${num}_${Date.now()}.png`);
          await fs.copyFile(regionPath, debugPath);
          ctx.log(`[GEM-COUNT] DEV 截图: ${debugPath}`);
        }
        return num;
      }
    }
    ctx.log(`[GEM-COUNT] 解析失败`);
    return null;
  } finally {
    await fs.unlink(regionPath).catch(() => {});
  }
}
