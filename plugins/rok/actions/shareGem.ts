import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fs from 'fs/promises';
import { RokConfig } from '../index';
import { GemSearchWeights } from '../utils/gemSearchStrategies';
import {
  zoomOutToWorld,
  createSpiralState,
  searchAndClickGem,
  parseCoord,
} from './gatherGem';
import { ensureInWorld } from '../utils/location';
import { locateByCoord } from '../utils/locateCoord';

const TEMPLATE_DIR = getTemplatesDir();
const BTN_SHARE = path.join(TEMPLATE_DIR, 'share_gem', 'btn_share.png');
const MAINROLE_HEAD = path.join(TEMPLATE_DIR, 'share_gem', 'mainrolehead.png');

// UI 坐标（1600x900）
const CONFIRM_SHARE_BTN  = { x: 893, y: 551 };
const DISMISS_SHARE_BOX  = { x: 782, y: 447 };
const CLOSE_SHARE_LIST   = { x: 1110, y: 102 };

const FAIL_LIMIT = 3;

export interface ShareGemParams {
  startX: number;
  startY: number;
  searchWeights?: GemSearchWeights;
  maxDistance?: number;
  /** 跨轮记忆：本次运行内已分享过的坐标（Home.tsx 从日志累计，start 时清空） */
  recordedCoords?: string[];
}

export interface ShareGemOutcome {
  result: 'success' | 'not_found' | 'aborted';
  shared: number;
}

type ShareResult = 'ok' | 'no_share_btn' | 'no_mainrole';

async function shareCurrentGem(ctx: PluginContext): Promise<ShareResult> {
  const shareBtn = await ctx.findImageWithLocation(BTN_SHARE, 0.7);
  if (!shareBtn.found) {
    ctx.log('  ⚠️ 找不到分享按钮');
    return 'no_share_btn';
  }
  ctx.log(`  [分享] 点击分享按钮 (${shareBtn.x},${shareBtn.y})`);
  await ctx.tap(shareBtn.x, shareBtn.y);
  await ctx.sleep(1.2);

  const heads = await ctx.findAllImages(MAINROLE_HEAD, 0.7);
  if (heads.length === 0) {
    ctx.log('  ⚠️ 找不到主号头像，关闭分享列表');
    await ctx.tap(CLOSE_SHARE_LIST.x, CLOSE_SHARE_LIST.y);
    await ctx.sleep(0.8);
    return 'no_mainrole';
  }
  const target = [...heads].sort((a, b) => a.y - b.y)[0];
  ctx.log(`  [分享] 点击主号头像 (${target.x},${target.y})`);
  await ctx.tap(target.x, target.y);
  await ctx.sleep(1);

  await ctx.tap(CONFIRM_SHARE_BTN.x, CONFIRM_SHARE_BTN.y);
  await ctx.sleep(1);
  await ctx.tap(DISMISS_SHARE_BOX.x, DISMISS_SHARE_BOX.y);
  await ctx.sleep(0.8);
  return 'ok';
}

async function recordCurrentCoord(ctx: PluginContext, sharedCoords: string[]): Promise<void> {
  const coordRegionPath = await ctx.captureRegion(400, 11, 137, 32);
  try {
    try {
      const coordText = await ocrService.readCoordinates(coordRegionPath);
      const curCoord = parseCoord(coordText);
      if (curCoord) {
        sharedCoords.push(curCoord);
        ctx.log(`  [坐标] 记录已分享: ${curCoord}`);
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
  const spiralState = await createSpiralState(ctx, config, searchWeights);
  const sharedCoords: string[] = params.recordedCoords ? [...params.recordedCoords] : [];
  if (sharedCoords.length > 0) ctx.log(`  [记忆] 携带已分享坐标 ${sharedCoords.length} 个`);
  let consecutiveFails = 0;
  let shared = 0;

  while (true) {
    const gem = await searchAndClickGem(ctx, config, spiralState, sharedCoords, maxDistance, true);
    if (!gem.found) {
      ctx.log('[step 3] 螺旋步数耗尽');
      break;
    }

    const outcome = await shareCurrentGem(ctx);
    if (outcome === 'ok') {
      shared++;
      consecutiveFails = 0;
      await recordCurrentCoord(ctx, sharedCoords);
    } else {
      consecutiveFails++;
      ctx.log(`  [失败计数] ${consecutiveFails}/${FAIL_LIMIT}`);
      if (consecutiveFails >= FAIL_LIMIT) {
        ctx.log(`[早退] 连续 ${FAIL_LIMIT} 次失败，退出`);
        ctx.log(`=== 分享结束: 分享 ${shared} 个 ===`);
        return { result: 'aborted', shared };
      }
    }

    // 分享完成（或失败）后缩地回世界视角，才能继续螺旋搜索
    await zoomOutToWorld(ctx, worldBtn, spiralState);
    await ctx.sleep(1);
  }

  ctx.log(`=== 分享结束: 分享 ${shared} 个 ===`);
  return {
    result: shared > 0 ? 'success' : 'not_found',
    shared,
  };
}
