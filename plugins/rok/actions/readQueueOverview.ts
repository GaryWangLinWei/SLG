import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ocrService } from '../../../core/ocr/OcrService';
import { parseCountdown } from '../../../core/ocr/parseCountdown';

export interface QueueTimers {
  build1: number | null;
  build2: number | null;
  train_bingying: number | null;
  train_majiu: number | null;
  train_bachang: number | null;
  train_gongcheng: number | null;
  research: number | null;
}

const TRAIN_KEY_TO_BUILDING: Record<string, string> = {
  train_bingying: '兵营',
  train_majiu: '马厩',
  train_bachang: '靶场',
  train_gongcheng: '攻城武器厂',
};

export function trainTimerToBuilding(key: string): string | undefined {
  return TRAIN_KEY_TO_BUILDING[key];
}

export async function readQueueOverview(
  ctx: PluginContext,
  config: RokConfig
): Promise<QueueTimers> {
  const qo = config.queueOverview;
  if (!qo) {
    ctx.log('[OCR] queueOverview 未配置');
    return { build1: null, build2: null, train_bingying: null, train_majiu: null, train_bachang: null, train_gongcheng: null, research: null };
  }

  ctx.log('[OCR] 打开队列速览面板');
  await ctx.tap(qo.openButton.x, qo.openButton.y);
  await ctx.sleep(1);

  // 向下滑动确保所有队列都显示
  if (qo.swipeDown) {
    await ctx.swipe(qo.swipeDown.fromX, qo.swipeDown.fromY, qo.swipeDown.toX, qo.swipeDown.toY);
    await ctx.sleep(0.5);
  }

  const result: QueueTimers = { build1: null, build2: null, train_bingying: null, train_majiu: null, train_bachang: null, train_gongcheng: null, research: null };

  for (const [key, region] of Object.entries(qo.rows) as [string, { x: number; y: number; w: number; h: number }][]) {
    if (!(key in result)) continue;
    ctx.log(`[OCR] 读取 ${key} 倒计时 (${region.x},${region.y} ${region.w}x${region.h})`);
    try {
      const regionPath = await ctx.captureRegion(region.x, region.y, region.w, region.h);
      const text = await ocrService.readText(regionPath);
      // 保存截图到 debug 目录以便排查
      const debugDir = path.join(process.cwd(), 'plugins', 'rok', 'debug');
      await fs.mkdir(debugDir, { recursive: true });
      
      await fs.unlink(regionPath).catch(() => {});
      const seconds = parseCountdown(text);
      ctx.log(`[OCR] ${key} 原始="${text}" → ${seconds !== null ? seconds + 's' : '空闲/未识别'}`);
      (result as any)[key] = seconds;
    } catch (e: any) {
      ctx.log(`[OCR] ${key} 读取失败: ${e.message}`);
      (result as any)[key] = null;
    }
  }

  // 关闭面板：优先用关闭按钮，否则用返回按钮
  if (qo.closeButton) {
    await ctx.tap(qo.closeButton.x, qo.closeButton.y);
  } else {
    await ctx.tap(config.backButton.x, config.backButton.y);
  }
  await ctx.sleep(0.5);

  // 计算下次检测时间（取最近到期的倒计时 × 0.6，上限 30 分钟）
  const allTimers = Object.values(result).filter((v): v is number => v !== null);
  if (allTimers.length > 0) {
    const minTimer = Math.min(...allTimers);
    const nextCheck = Math.round(Math.min(minTimer * 0.6, 1800));
    ctx.log(`[OCR] 所有队列均忙碌，下次检测约 ${nextCheck}s 后 (最近到期: ${minTimer}s)`);
  } else {
    ctx.log('[OCR] 所有队列空闲，无活跃倒计时');
  }

  // 结构化日志，供前端解析
  ctx.log(`[OCR-RESULT] build1=${result.build1} build2=${result.build2} train_bingying=${result.train_bingying} train_majiu=${result.train_majiu} train_bachang=${result.train_bachang} train_gongcheng=${result.train_gongcheng} research=${result.research}`);

  return result;
}
