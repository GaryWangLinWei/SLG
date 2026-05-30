import * as fs from 'fs/promises';
import * as path from 'path';
import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';

import { ocrService } from '../../../core/ocr/OcrService';
import { parseCountdown } from '../../../core/ocr/parseCountdown';

const SETTINGS_REGION = { x: 427, y: 167, width: 482, height: 396 };
const POSITION_TOLERANCE = 15;

let queueFiltersEnsured = false;

export function resetQueueFilters(): void {
  queueFiltersEnsured = false;
}

function isNear(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) <= POSITION_TOLERANCE && Math.abs(a.y - b.y) <= POSITION_TOLERANCE;
}

async function ensureQueueFilters(
  ctx: PluginContext,
  config: RokConfig
): Promise<void> {
  const qo = config.queueOverview;
  if (!qo?.settingsButton || !qo?.queueCheckboxes?.length) {
    ctx.log('[队列过滤] 未配置 settingsButton/queueCheckboxes，跳过');
    queueFiltersEnsured = true;
    return;
  }

  const btn = qo.settingsButton;

  ctx.log('[队列过滤] 打开队列设置面板');
  await ctx.tap(btn.x, btn.y);
  await ctx.sleep(1);

  const templatePath = path.join(getTemplatesDir(), 'chooseState.png');
  const found = await ctx.findAllImages(templatePath, 0.8, SETTINGS_REGION);

  ctx.log(`[队列过滤] 找到 ${found.length} 个勾选: ${found.map(f => `(${f.x},${f.y})`).join(', ')}`);

  for (const f of found) {
    const isTarget = qo.queueCheckboxes!.some(cb => isNear(f, cb));
    if (!isTarget) {
      ctx.log(`[队列过滤] 取消勾选 (${f.x}, ${f.y})`);
      await ctx.tap(f.x, f.y);
      await ctx.sleep(0.3);
    }
  }

  for (const cb of qo.queueCheckboxes!) {
    const hasCheck = found.some(f => isNear(f, cb));
    if (!hasCheck) {
      ctx.log(`[队列过滤] 补勾选 (${cb.x}, ${cb.y})`);
      await ctx.tap(cb.x, cb.y);
      await ctx.sleep(0.3);
    }
  }

  ctx.log('[队列过滤] 关闭队列设置面板');
  await ctx.tap(btn.x, btn.y);
  await ctx.sleep(0.5);

  queueFiltersEnsured = true;
  ctx.log('[队列过滤] 完成');
}

export interface QueueTimers {
  build1: number | null;
  build2: number | null;
  train_bingying: number | null;
  train_majiu: number | null;
  train_bachang: number | null;
  train_gongcheng: number | null;
  research: number | null;
  build1Building?: string | null;
  build2Building?: string | null;
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

  if (!queueFiltersEnsured) {
    await ensureQueueFilters(ctx, config);
  }

  // 向下滑动确保所有队列都显示
  if (qo.swipeDown) {
    await ctx.swipe(qo.swipeDown.fromX, qo.swipeDown.fromY, qo.swipeDown.toX, qo.swipeDown.toY);
    await ctx.sleep(1.5);
  }

  const result: QueueTimers = { build1: null, build2: null, train_bingying: null, train_majiu: null, train_bachang: null, train_gongcheng: null, research: null };

  for (const [key, region] of Object.entries(qo.rows) as [string, { x: number; y: number; w: number; h: number }][]) {
    if (!(key in result)) continue;
    const KEY_LABELS: Record<string, string> = {
      build1: '建筑队列1', build2: '建筑队列2',
      train_bingying: '训练-兵营', train_majiu: '训练-马厩',
      train_bachang: '训练-靶场', train_gongcheng: '训练-攻城武器厂',
      research: '研究',
    };
    ctx.log(`[OCR] 读取 ${key} 倒计时 (${region.x},${region.y} ${region.w}x${region.h})`);
    const label = KEY_LABELS[key] || key;
    let regionPath: string | null = null;
    try {
      regionPath = await ctx.captureRegion(region.x, region.y, region.w, region.h);
      let text = '';
      let seconds: number | null = null;
      try {
        text = await ocrService.readText(regionPath);
        seconds = parseCountdown(text);
        ctx.log(`[OCR] ${key} 原始="${text}" → ${seconds !== null ? seconds + 's' : '空闲/未识别'}`);
      } catch (ocrErr: any) {
        ctx.log(`[OCR] ${key} OCR识别失败: ${ocrErr.message}`);
      }

      (result as any)[key] = seconds;
    } catch (e: any) {
      ctx.log(`[OCR] ${key} 读取失败: ${e.message}`);
      (result as any)[key] = null;
    } finally {
      if (regionPath) await fs.unlink(regionPath).catch(() => {});
    }
  }

  // OCR 建筑队列名称（格式：等级8 学院），识别哪个建筑正在升级
  if (qo.buildNameRows) {
    const parseBuildingName = (text: string): string | null => {
      // OCR 可能在中文间加空格，先合并再匹配
      const compact = text.replace(/\s+/g, '');
      // 空闲队列显示 "建造队列N" 表头，无建筑名
      if (/建造队列/.test(compact) || /空闲/.test(compact)) return null;
      // 去掉 "等级N" 前缀（同时处理 "等级8" 和 "等级 8" ocr 后加空格的情况）
      const cleaned = compact.replace(/等级\d+/i, '').replace(/^\d+/, '');
      if (!cleaned) return null;
      const knownBuildings = [
        '攻城武器厂', '采石场', '木材厂', '金矿', '农场',
        '学院', '兵营', '马厩', '靶场', '斥候营地', '联盟中心',
        '酒馆', '商店', '仓库', '驿站', '箭塔', '城墙', '城堡',
      ];
      for (const b of knownBuildings) {
        if (cleaned === b) return b;
      }
      let best: string | null = null;
      for (const b of knownBuildings) {
        if (cleaned.includes(b) && (!best || b.length > best.length)) {
          best = b;
        }
      }
      return best;
    };

    for (const key of ['build1', 'build2'] as const) {
      const region = (qo.buildNameRows as any)[key];
      if (!region) continue;
      ctx.log(`[OCR] 读取 ${key} 建筑名 (${region.x},${region.y} ${region.w}x${region.h})`);
      let regionPath: string | null = null;
      try {
        regionPath = await ctx.captureRegion(region.x, region.y, region.w, region.h);
        const text = await ocrService.readChineseText(regionPath);
        const name = parseBuildingName(text);
        ctx.log(`[OCR] ${key} 建筑名 原始="${text}" → ${name ?? '未识别'}`);
        (result as any)[`${key}Building`] = name;
      } catch (e: any) {
        ctx.log(`[OCR] ${key} 建筑名读取失败: ${e.message}`);
        (result as any)[`${key}Building`] = null;
      } finally {
        if (regionPath) await fs.unlink(regionPath).catch(() => {});
      }
    }
  }

  // 关闭面板：优先用关闭按钮，否则用返回按钮
  if (qo.closeButton) {
    await ctx.tap(qo.closeButton.x, qo.closeButton.y);
  } else {
    await ctx.tap(config.backButton.x, config.backButton.y);
  }
  await ctx.sleep(0.5);

  // 计算下次检测时间（建筑/科技队列 ×0.6，训练队列用原始值，上限 30 分钟）
  const buildResearchKeys: (keyof QueueTimers)[] = ['build1', 'build2', 'research'];
  const trainKeys: (keyof QueueTimers)[] = ['train_bingying', 'train_majiu', 'train_bachang', 'train_gongcheng'];
  const buildResearchTimers = buildResearchKeys.map(k => result[k]).filter((v): v is number => v !== null);
  const trainTimers = trainKeys.map(k => result[k]).filter((v): v is number => v !== null);
  const adjustedTimers = [...buildResearchTimers.map(t => t * 0.6), ...trainTimers];
  if (adjustedTimers.length > 0) {
    const minTimer = Math.min(...adjustedTimers);
    const nextCheck = Math.round(Math.min(minTimer, 1800));
    ctx.log(`[OCR] 下次检测约 ${nextCheck}s 后 (调整后最近到期: ${minTimer.toFixed(0)}s)`);
  } else {
    ctx.log('[OCR] 所有队列空闲/识别失败，无活跃倒计时');
  }

  // 结构化日志，供前端解析
  ctx.log(`[OCR-RESULT] build1=${result.build1} build2=${result.build2} train_bingying=${result.train_bingying} train_majiu=${result.train_majiu} train_bachang=${result.train_bachang} train_gongcheng=${result.train_gongcheng} research=${result.research} build1Building=${result.build1Building ?? 'null'} build2Building=${result.build2Building ?? 'null'}`);

  return result;
}
