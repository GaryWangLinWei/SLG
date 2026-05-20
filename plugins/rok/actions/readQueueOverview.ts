import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import * as fs from 'fs/promises';
import { ocrService } from '../../../core/ocr/OcrService';
import { parseCountdown } from '../../../core/ocr/parseCountdown';

export interface QueueTimers {
  build: number | null;
  train: number | null;
  research: number | null;
}

export async function readQueueOverview(
  ctx: PluginContext,
  config: RokConfig
): Promise<QueueTimers> {
  const qo = config.queueOverview;
  if (!qo) {
    ctx.log('[OCR] queueOverview 未配置');
    return { build: null, train: null, research: null };
  }

  ctx.log('[OCR] 打开队列速览面板');
  await ctx.tap(qo.openButton.x, qo.openButton.y);
  await ctx.sleep(1);

  const result: QueueTimers = { build: null, train: null, research: null };

  for (const [key, region] of Object.entries(qo.rows) as [keyof QueueTimers, { x: number; y: number; w: number; h: number }][]) {
    ctx.log(`[OCR] 读取 ${key} 倒计时 (${region.x},${region.y} ${region.w}x${region.h})`);
    try {
      const regionPath = await ctx.captureRegion(region.x, region.y, region.w, region.h);
      const text = await ocrService.readText(regionPath);
      await fs.unlink(regionPath).catch(() => {});
      const seconds = parseCountdown(text);
      ctx.log(`[OCR] ${key} 原始="${text}" → ${seconds !== null ? seconds + 's' : '空闲/未识别'}`);
      result[key] = seconds;
    } catch (e: any) {
      ctx.log(`[OCR] ${key} 读取失败: ${e.message}`);
      result[key] = null;
    }
  }

  // 关闭面板：优先用关闭按钮，否则用返回按钮
  if (qo.closeButton) {
    await ctx.tap(qo.closeButton.x, qo.closeButton.y);
  } else {
    await ctx.tap(config.backButton.x, config.backButton.y);
  }
  await ctx.sleep(0.5);

  // 结构化日志，供前端解析
  ctx.log(`[OCR-RESULT] build=${result.build} train=${result.train} research=${result.research}`);

  return result;
}
