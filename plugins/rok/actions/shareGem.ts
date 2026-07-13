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

const TEMPLATE_DIR = getTemplatesDir();
const BTN_SHARE = path.join(TEMPLATE_DIR, 'share_gem', 'btn_share.png');
const MAINROLE_HEAD = path.join(TEMPLATE_DIR, 'share_gem', 'mainrolehead.png');

// UI 坐标（1600x900）
const COORD_ENTRY_BUTTON = { x: 552, y: 26 };
const X_INPUT_BOX        = { x: 799, y: 176 };
const Y_INPUT_BOX        = { x: 987, y: 178 };
const COORD_SEARCH_BTN   = { x: 1108, y: 180 };
const CONFIRM_SHARE_BTN  = { x: 893, y: 551 };
const DISMISS_SHARE_BOX  = { x: 782, y: 447 };
const CLOSE_SHARE_LIST   = { x: 1110, y: 102 };

const FAIL_LIMIT = 3;

export interface ShareGemParams {
  startX: number;
  startY: number;
  searchWeights?: GemSearchWeights;
  maxDistance?: number;
}

export interface ShareGemOutcome {
  result: 'success' | 'not_found' | 'aborted';
  shared: number;
}

type ShareResult = 'ok' | 'no_share_btn' | 'no_mainrole';

async function locateByCoord(ctx: PluginContext, x: number, y: number): Promise<void> {
  ctx.log(`[step 2] 定位坐标 (${x},${y})`);
  await ctx.tap(COORD_ENTRY_BUTTON.x, COORD_ENTRY_BUTTON.y);
  await ctx.sleep(1);
  await ctx.tap(X_INPUT_BOX.x, X_INPUT_BOX.y);
  await ctx.sleep(0.5);
  await ctx.inputText(String(x));
  await ctx.sleep(0.3);
  await ctx.tap(Y_INPUT_BOX.x, Y_INPUT_BOX.y);
  await ctx.sleep(0.5);
  await ctx.inputText(String(y));
  await ctx.sleep(0.3);
  await ctx.tap(COORD_SEARCH_BTN.x, COORD_SEARCH_BTN.y);
  await ctx.sleep(1.5);
}

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

  ctx.log('[step 1] 重置城外视角');
  await zoomOutToWorld(ctx, worldBtn);

  if (startX !== 0 || startY !== 0) {
    await locateByCoord(ctx, startX, startY);
  } else {
    ctx.log('[step 2] 起点为 (0,0)，跳过定位');
  }

  await ctx.sleep(2);
  ctx.log('[step 3] 开始螺旋搜索');
  const spiralState = await createSpiralState(ctx, config, searchWeights);
  const sharedCoords: string[] = [];
  let consecutiveFails = 0;
  let shared = 0;

  while (true) {
    const gem = await searchAndClickGem(ctx, config, spiralState, sharedCoords, maxDistance);
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
  }

  ctx.log(`=== 分享结束: 分享 ${shared} 个 ===`);
  return {
    result: shared > 0 ? 'success' : 'not_found',
    shared,
  };
}
