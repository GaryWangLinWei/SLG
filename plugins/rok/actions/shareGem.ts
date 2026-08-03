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
  parseCoord,
  splitDigitsToXYCandidates,
  pickNearestToHome,
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
  poolAccountId: string = accountId,
  homeCoord?: { x: number; y: number }
): Array<{ x: number; y: number }> {
  // 带 X/Y 标签：精确解析，只入一个
  const tagged = coordText.match(/x\s*[:：]?\s*(\d+)\D+y\s*[:：]?\s*(\d+)/i);
  if (tagged) {
    const c = {
      x: parseInt(tagged[1], 10),
      y: parseInt(tagged[2], 10),
    };
    return sharedGemPool.addUnique(poolAccountId, c) ? [c] : [];
  }
  // 纯数字串：3+4 / 4+3 等所有合法候选都入池，由消费端就近验证淘汰错误候选
  const digits = coordText.replace(/\D/g, '');
  const candidates = splitDigitsToXYCandidates(digits);
  // 已知主城堡坐标时，歧义直接按"谁离城堡更近"消解，只入一个
  const homeKnown = homeCoord && (homeCoord.x !== 0 || homeCoord.y !== 0);
  const toAdd = homeKnown && candidates.length > 1
    ? [pickNearestToHome(candidates, homeCoord!)]
    : candidates;
  const added: Array<{ x: number; y: number }> = [];
  for (const c of toAdd) {
    if (sharedGemPool.addUnique(poolAccountId, c)) added.push(c);
  }
  return added;
}

async function recordCurrentCoord(
  ctx: PluginContext,
  sharedCoords: string[],
  accountId?: string,
  poolAccountId?: string,
  homeCoord?: { x: number; y: number }
): Promise<void> {
  const coordRegionPath = await ctx.captureRegion(400, 11, 137, 32);
  try {
    try {
      // 优先读完整文本（保留 X/Y 标签，切分无歧义），标签缺失时退回纯数字识别
      let coordText = await ocrService.readText(coordRegionPath);
      const hasLabel = /x\s*[:：]?\s*\d+\D+y\s*[:：]?\s*\d+/i.test(coordText);
      if (!hasLabel) {
        coordText = await ocrService.readCoordinates(coordRegionPath);
      }
      const curCoord = parseCoord(coordText);
      if (curCoord) {
        sharedCoords.push(curCoord);
        if (!hasLabel) {
          const candidates = splitDigitsToXYCandidates(curCoord);
          if (candidates.length > 1) {
            const homeKnown = homeCoord && (homeCoord.x !== 0 || homeCoord.y !== 0);
            if (homeKnown) {
              const nearest = pickNearestToHome(candidates, homeCoord!);
              ctx.log(`  ⚠️ [坐标] 标签缺失，纯数字 "${curCoord}" 按距主城堡(${homeCoord!.x},${homeCoord!.y})最近选择 (${nearest.x},${nearest.y})（候选: ${candidates.map(c => `(${c.x},${c.y})`).join(' / ')}）`);
            } else {
              ctx.log(`  ⚠️ [坐标] 标签缺失，纯数字 "${curCoord}" 解析出 ${candidates.length} 个候选 (${candidates.map(c => `(${c.x},${c.y})`).join(' / ')})，全部入池由消费端就近验证`);
            }
          }
        }
        if (accountId) {
          const addedCoords = addSharedGemCoordToPool(accountId, coordText, poolAccountId, homeCoord);
          if (addedCoords.length > 0) {
            const label = addedCoords.length === 1
              ? `x: ${addedCoords[0].x} y: ${addedCoords[0].y}`
              : addedCoords.map(c => `(${c.x},${c.y})`).join(' / ');
            ctx.log(`  [坐标] 记录已分享: ${label}`);
            ctx.log(`  [pool] 新增坐标 ${addedCoords.length} 个，当前 ${sharedGemPool.size(poolAccountId ?? accountId)}`);
          }
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
    await recordCurrentCoord(ctx, sharedCoords, params.accountId, params.poolAccountId, { x: startX, y: startY });
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
