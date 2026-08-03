import { PluginContext } from '../../../core/plugin';
import { ocrService } from '../../../core/ocr/OcrService';
import * as fs from 'fs/promises';
import { RokConfig } from '../index';
import { sharedGemPool } from '../state/sharedGemPool';
import { GemSearchWeights } from '../utils/gemSearchStrategies';
import {
  zoomOutToWorld,
  createSpiralState,
  searchAndClickGem,
  formatCoordForLog,
  parseCoord,
} from './gatherGem';
import { ensureInWorld } from '../utils/location';
import { locateByCoord } from '../utils/locateCoord';

export interface ShareGemParams {
  poolAccountId?: string;
  accountId?: string;
  startX: number;
  startY: number;
  searchWeights?: GemSearchWeights;
  maxDistance?: number;
  /** 跨轮记忆：本次运行内已记录过的坐标（Home.tsx 从日志累计，start 时清空） */
  recordedCoords?: string[];
  /** 记录数量上限，达到就停止（默认无上限，即由螺旋步数耗尽结束） */
  targetCount?: number;
}

export interface ShareGemOutcome {
  result: 'success' | 'not_found' | 'aborted';
  shared: number;
}

export function addSharedGemCoordToPool(
  accountId: string,
  coordText: string,
  poolAccountId: string = accountId
): boolean {
  const formatted = formatCoordForLog(coordText);
  const match = formatted?.match(/x:\s*(\d+)\s*y:\s*(\d+)/i);
  if (!match) return false;
  const coord = {
    x: parseInt(match[1], 10),
    y: parseInt(match[2], 10),
  };
  return sharedGemPool.addUnique(poolAccountId, coord);
}

async function recordCurrentCoord(
  ctx: PluginContext,
  sharedCoords: string[],
  accountId?: string,
  poolAccountId?: string
): Promise<void> {
  const coordRegionPath = await ctx.captureRegion(400, 11, 137, 32);
  try {
    try {
      const coordText = await ocrService.readCoordinates(coordRegionPath);
      const curCoord = parseCoord(coordText);
      if (curCoord) {
        sharedCoords.push(curCoord);
        ctx.log(`  [坐标] 记录已分享: ${formatCoordForLog(coordText) ?? curCoord}`);
        if (accountId && addSharedGemCoordToPool(accountId, coordText, poolAccountId)) {
          ctx.log(`  [pool] 新增坐标，当前 ${sharedGemPool.size(poolAccountId ?? accountId)}`);
        }
      }
    } catch (e) {
      ctx.log(`  ⚠️ 坐标 OCR 失败，跳过记录: ${(e as Error).message}`);
    }
  } finally {
    await fs.unlink(coordRegionPath).catch(() => {});
  }
}

export async function shareGem(
  ctx: PluginContext,
  config: RokConfig,
  params: ShareGemParams
): Promise<ShareGemOutcome> {
  const { startX, startY, searchWeights, maxDistance } = params;
  ctx.log(`=== 分享宝石矿 起点(${startX},${startY}) ===`);
  const worldBtn = config.resourceCollect.worldSwitchButton;

  ctx.log('[step 1] 切换到城外视角');
  await ensureInWorld(ctx, config);

  if (startX !== 0 || startY !== 0) {
    await locateByCoord(ctx, startX, startY);
  } else {
    ctx.log('[step 2] 起点为 (0,0)，跳过定位');
  }

  await ctx.sleep(2);
  ctx.log('[step 3] 缩地后开始螺旋搜索');
  await zoomOutToWorld(ctx, worldBtn);
  const spiralState = createSpiralState(config);
  const sharedCoords: string[] = params.recordedCoords ? [...params.recordedCoords] : [];
  if (sharedCoords.length > 0) ctx.log(`  [记忆] 携带已分享坐标 ${sharedCoords.length} 个`);
  let consecutiveFails = 0;
  let shared = 0;

  while (true) {
    const gem = await searchAndClickGem(ctx, config, spiralState, sharedCoords, {
      skipCaijiClick: true,
      skipVerifiedGemClick: true,
    });
    if (!gem.found) {
      ctx.log('[step 3] 螺旋步数耗尽');
      break;
    }

    shared++;
    await recordCurrentCoord(ctx, sharedCoords, params.accountId, params.poolAccountId);
    if (params.targetCount && shared >= params.targetCount) {
      ctx.log(`[早退] 已记录 ${shared} 个 ≥ 目标 ${params.targetCount}，停止`);
      ctx.log(`=== 分享结束: 记录 ${shared} 个 ===`);
      return { result: 'success', shared };
    }

    // 记录完成后缩地回世界视角，才能继续螺旋搜索
    await zoomOutToWorld(ctx, worldBtn);
    await ctx.sleep(1);
  }

  ctx.log(`=== 分享结束: 记录 ${shared} 个 ===`);
  return {
    result: shared > 0 ? 'success' : 'not_found',
    shared,
  };
}
