import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ocrService } from '../../../core/ocr/OcrService';
import { sharedGemPool, SharedGemCoord } from '../state/sharedGemPool';
import * as path from 'path';
import * as fs from 'fs/promises';

const TEMPLATE_DIR = getTemplatesDir();
const PIN_GEM = path.join(TEMPLATE_DIR, 'share_gem', 'pin_gem.png');
const ZHANKAI_BLUE = path.join(TEMPLATE_DIR, 'share_gem', 'zhankai_blue.png');
const ZHANKAI_ZONG = path.join(TEMPLATE_DIR, 'share_gem', 'zhankai_zong.png');
const MAINROLE_HEAD = path.join(TEMPLATE_DIR, 'share_gem', 'mainrolehead.png');

// 关键坐标（1600×900）
const CHAT_ENTRY = { x: 184, y: 844 };
const EXPAND_BTN = { x: 45, y: 34 };
const MAINROLE_SEARCH_REGION = { x: 20, y: 66, width: 91, height: 754 };
const CHAT_CLOSE = { x: 1189, y: 447 };
const SWIPE_TO = { x: 958, y: 783 };

// pin 图标左侧的坐标文字块相对偏移
const COORD_TEXT_DX = -340;
const COORD_TEXT_DY = -18;
const COORD_TEXT_W = 320;
const COORD_TEXT_H = 45;

const MAX_SWIPES = 15;

export type CollectResult = 'ok' | 'no_mainrole' | 'no_pin';

export interface CollectOutcome {
  result: CollectResult;
  collected: number;
  poolSize: number;
}

function parseCoordText(text: string): SharedGemCoord | null {
  const m = text.match(/X[:：]\s*(\d+)\s*Y[:：]\s*(\d+)/i);
  if (!m) return null;
  const x = parseInt(m[1], 10);
  const y = parseInt(m[2], 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export function addCollectedCoord(accountId: string, coord: SharedGemCoord): boolean {
  return sharedGemPool.addUnique(accountId, coord);
}

export async function collectSharedGemCoords(
  ctx: PluginContext,
  accountId: string
): Promise<CollectOutcome> {
  ctx.log(`=== 收集分享矿坐标 account=${accountId} ===`);
  const before = sharedGemPool.size(accountId);

  ctx.log(`[1] 打开聊天框 (${CHAT_ENTRY.x},${CHAT_ENTRY.y})`);
  await ctx.tap(CHAT_ENTRY.x, CHAT_ENTRY.y);
  await ctx.sleep(1);

  // [2] 检测是否已展开（按钮位置判断：未展开≈(135,37)，展开≈(543,33)）
  const blue = await ctx.findImageWithLocation(ZHANKAI_BLUE, 0.75);
  const btn = blue.found ? blue : await ctx.findImageWithLocation(ZHANKAI_ZONG, 0.75);
  if (!btn.found) {
    ctx.log(`[2] 未识别到展开/收起按钮，尝试点击默认位置 (${EXPAND_BTN.x},${EXPAND_BTN.y})`);
    await ctx.tap(EXPAND_BTN.x, EXPAND_BTN.y);
    await ctx.sleep(0.8);
  } else if (btn.x < 340) {
    ctx.log(`[2] 按钮位于 (${btn.x},${btn.y})，判定未展开，点击 (42,37) 展开`);
    await ctx.tap(42, 37);
    await ctx.sleep(0.8);
  } else {
    ctx.log(`[2] 按钮位于 (${btn.x},${btn.y})，判定已展开`);
  }

  // [3] 找主号头像
  const heads = await ctx.findAllImages(MAINROLE_HEAD, 0.75, MAINROLE_SEARCH_REGION);
  if (!heads || heads.length === 0) {
    ctx.log(`[3] 未找到主号头像，关闭聊天`);
    await ctx.tap(CHAT_CLOSE.x, CHAT_CLOSE.y);
    await ctx.sleep(0.6);
    return { result: 'no_mainrole', collected: 0, poolSize: sharedGemPool.size(accountId) };
  }
  const target = [...heads].sort((a, b) => a.y - b.y)[0];
  ctx.log(`[3] 找到主号头像 (${target.x},${target.y})，点击`);
  await ctx.tap(target.x, target.y);
  await ctx.sleep(1);

  // [4] 循环收集
  let sawAnyPin = false;
  for (let round = 0; round < MAX_SWIPES; round++) {
    ctx.log(`[4] 第 ${round + 1} 屏：搜索 pin_gem`);
    const pins = await ctx.findAllImages(PIN_GEM, 0.7);
    if (!pins || pins.length === 0) {
      ctx.log(`  本屏无 pin`);
      if (round === 0) break;
    } else {
      sawAnyPin = true;
    }

    let addedThisPage = 0;
    let allSeen = true;
    for (const pin of pins) {
      const px = pin.x + COORD_TEXT_DX;
      const py = pin.y + COORD_TEXT_DY;
      const clipPath = await ctx.captureRegion(
        Math.max(0, px), Math.max(0, py), COORD_TEXT_W, COORD_TEXT_H
      );
      try {
        const text = await ocrService.readText(clipPath);
        const coord = parseCoordText(text);
        if (!coord) {
          ctx.log(`  pin@(${pin.x},${pin.y}) OCR="${text.trim()}" 解析失败`);
          allSeen = false;
          continue;
        }
        if (sharedGemPool.has(accountId, coord)) {
          ctx.log(`  pin@(${pin.x},${pin.y}) -> (${coord.x},${coord.y}) 已在池`);
        } else if (addCollectedCoord(accountId, coord)) {
          addedThisPage++;
          allSeen = false;
          ctx.log(`  pin@(${pin.x},${pin.y}) -> (${coord.x},${coord.y}) 加入池`);
        } else {
          ctx.log(`  pin@(${pin.x},${pin.y}) -> (${coord.x},${coord.y}) 已处理过`);
        }
      } catch (e) {
        ctx.log(`  pin@(${pin.x},${pin.y}) OCR 失败: ${(e as Error).message}`);
        allSeen = false;
      } finally {
        await fs.unlink(clipPath).catch(() => {});
      }
    }

    ctx.log(`  本屏新增 ${addedThisPage}，池当前 ${sharedGemPool.size(accountId)}`);
    if (addedThisPage === 0) {
      ctx.log(`[4] 本屏新增 0，停止滑动`);
      break;
    }
    if (pins.length > 0 && allSeen) {
      ctx.log(`[4] 本屏所有坐标均已存在池中，停止滑动`);
      break;
    }

    if (round < MAX_SWIPES - 1) {
      if (!pins || pins.length === 0) {
        ctx.log(`  本屏无 pin，无法确定滑动起点，停止`);
        break;
      }
      const topPin = [...pins].sort((a, b) => a.y - b.y)[0];
      ctx.log(`  向下滑动 (${topPin.x},${topPin.y})→(${SWIPE_TO.x},${SWIPE_TO.y})`);
      await ctx.swipe(topPin.x, topPin.y, SWIPE_TO.x, SWIPE_TO.y, 800);
      await ctx.sleep(0.8);
    } else {
      ctx.log(`[4] 达到最大滑动次数 ${MAX_SWIPES}`);
    }
  }

  ctx.log(`[5] 关闭聊天`);
  await ctx.tap(CHAT_CLOSE.x, CHAT_CLOSE.y);
  await ctx.sleep(0.6);

  const after = sharedGemPool.size(accountId);
  const collected = after - before;
  const result: CollectResult = sawAnyPin ? 'ok' : 'no_pin';
  ctx.log(`=== 收集完成 result=${result} 新增=${collected} 池=${after} ===`);
  return { result, collected, poolSize: after };
}
