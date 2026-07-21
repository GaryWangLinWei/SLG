import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fs from 'fs/promises';
// import sharp from 'sharp';
import { RokConfig } from '../index';
import { TeamPage } from '../utils/teamPage';
import { GemSearchWeights } from '../utils/gemSearchStrategies';
import {
  gatherGem,
  zoomOutToWorld,
  searchAndClickGem,
  checkIdleTeamsAvailable,
  dispatchToTeamPopup,
  createSpiralState,
  parseCoord,
} from './gatherGem';

const TEMPLATE_DIR = getTemplatesDir();

// 测试阶段：状态检测调试截图目录（已关闭）
// const DEBUG_DIR = 'D:/SLG/temp/debug/focus';

// function isDevEnv(): boolean {
//   try {
//     const { app } = require('electron');
//     return !app.isPackaged;
//   } catch {
//     return true;
//   }
// }

// 状态模板（保留行军按钮模板路径，其余状态改用 state.onnx 检测）
const MARCH_BTN_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_xingjun.png');

import {
  detectStatusRegionTeamStates,
  detectTeamStates,
} from '../utils/teamStateDetection';

// step 4 大 UI 中驻扎队伍的检测区域 + 点击 X（图标在区域中线）
const LARGE_REGION  = { x: 1443, y: 53,  w: 152, h: 753 };
const ZHUZHA_BUTTON = { x: 800, y: 593 };
const EXIT_LARGE_UI_BUTTON = { x: 70, y: 834 };
const MARCH_SEARCH_REGION = { x: 1068, y: 20, width: 362, height: 860 };
const BACK_RETRY_LIMIT = 5;
const AVATAR_OFFSET = { dx: -25, dy: -25 };

export interface GemGatherOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;
}

/**
 * 宝石采集专注模式：持续将队伍维持在采集状态，直到外部停止或配额满。
 * - step 1: 处理返回中的队伍（点击 → 驻扎，最多 5 次）
 * - step 2: 检测采集 + 前往 + 驻扎；配额满则退出
 * - step 3.1（无驻扎）: 走完整 gatherGem 流程
 * - step 3.2（有驻扎）: 点驻扎队伍 → 缩地 → searchAndClickGem 接续派矿
 * - step 4: 大 UI 中找驻扎队伍 → 点击行军按钮
 */
export async function gatherGemFocus(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[],
  teamPage: TeamPage = 'gather',
  searchWeights?: GemSearchWeights,
  maxDistance?: number,
  initialCoords?: string[],
): Promise<GemGatherOutcome> {
  ctx.log(`=== 宝石采集专注模式 队伍[${teams.join(', ')}] ===`);
  const worldBtn = config.resourceCollect.worldSwitchButton;
  const collectedCoords: string[] = initialCoords ? [...initialCoords] : [];
  if (collectedCoords.length > 0) ctx.log(`  [坐标] 携带跨轮记忆 ${collectedCoords.length} 个`);
  const spiralState = createSpiralState(config);
  let dispatched = 0;
  let hasPaging: boolean | null = null;
  let quotaFull = false;

  while (true) {
    // === step 1: 处理返回中的队伍 ===
    let backRetry = 0;
    while (backRetry < BACK_RETRY_LIMIT) {
      const back = await detectStatusRegionTeamStates(ctx, ['back']);
      if (back.length === 0) break;
      const t = back[0];
      const tx = t.x + AVATAR_OFFSET.dx;
      const ty = t.y + AVATAR_OFFSET.dy;
      ctx.log(`[step 1] 点击返回队伍头像 (${tx}, ${ty})`);
      await ctx.tap(tx, ty);
      await ctx.sleep(1.5);
      ctx.log(`[step 1] 点击驻扎按钮 (${ZHUZHA_BUTTON.x}, ${ZHUZHA_BUTTON.y})`);
      await ctx.tap(ZHUZHA_BUTTON.x, ZHUZHA_BUTTON.y);
      await ctx.sleep(0.5);
      backRetry++;
    }

    // === step 2: 检测采集 + 前往 + 驻扎 ===
    const states = await detectStatusRegionTeamStates(
      ctx, ['caiji', 'totarget', 'zhuzha']
    );
    const caijiCount = states.filter(s => s.state === 'caiji').length;
    const totargetCount = states.filter(s => s.state === 'totarget').length;
    const zhuzhaList = states.filter(s => s.state === 'zhuzha').sort((a, b) => a.y - b.y);
    ctx.log(`[step 2] caiji=${caijiCount} totarget=${totargetCount} zhuzha=${zhuzhaList.length}`);

    if (caijiCount + totargetCount >= teams.length) {
      ctx.log(`[step 2] 配额已满（${caijiCount + totargetCount}/${teams.length}），退出循环`);
      quotaFull = true;
      break;
    }

    if (zhuzhaList.length === 0) {
      // step 3.1: 走完整 gatherGem
      ctx.log('[step 3.1] 调用 gatherGem 完整流程');
      const r = await gatherGem(ctx, config, teams, { collectedCoords, teamPage });
      dispatched += r.dispatched;
      if (r.result === 'no_idle_teams') {
        ctx.log('[step 3.1] gatherGem 报告无空闲队伍，退出专注模式');
        break;
      }
      // gatherGem 内部独立维护 spiralState 且可能让视角回到城内，
      // 重置焦点循环的 spiralState 以避免与实际视角错位
      Object.assign(spiralState, createSpiralState(config));
      await ctx.sleep(2);
      continue;
    }

    // === step 3.2: 驻扎队伍接续派矿 ===
    const top = zhuzhaList[0];
    const topX = top.x + AVATAR_OFFSET.dx;
    const topY = top.y + AVATAR_OFFSET.dy;
    ctx.log(`[step 3.2] 点击最上驻扎队伍头像 (${topX}, ${topY})`);
    await ctx.tap(topX, topY);
    await ctx.sleep(1.5);

    await zoomOutToWorld(ctx, worldBtn);
    // 每次接续派矿都从新螺旋开始搜，避免沿用上一轮已耗尽的 spiralState 直接返回搜不到矿
    Object.assign(spiralState, createSpiralState(config));
    const gem = await searchAndClickGem(ctx, config, spiralState, collectedCoords);
    if (!gem.found) {
      ctx.log('[step 3.2] 搜不到矿，退大 UI 回 step 1');
      await ctx.tap(EXIT_LARGE_UI_BUTTON.x, EXIT_LARGE_UI_BUTTON.y);
      await ctx.sleep(1);
      continue;
    }

    // === step 4: 大 UI 中找驻扎/返回队伍 + 行军按钮 ===
    // 全屏检测后按 LARGE_REGION 过滤（避免 152×753 被 ONNX resize 到 640×640 拉伸漏检）
    const inLarge = (d: { x: number; y: number }) =>
      d.x >= LARGE_REGION.x && d.x <= LARGE_REGION.x + LARGE_REGION.w &&
      d.y >= LARGE_REGION.y && d.y <= LARGE_REGION.y + LARGE_REGION.h;
    // 优先找驻扎队伍
    let stateIn4 = (await detectTeamStates(ctx, ['zhuzha'])).filter(inLarge);
    let foundState = 'zhuzha';

    // 没找到驻扎，找返回队伍
    if (stateIn4.length === 0) {
      stateIn4 = (await detectTeamStates(ctx, ['back'])).filter(inLarge);
      if (stateIn4.length > 0) {
        foundState = 'back';
        ctx.log(`[step 4] 未检测到驻扎，找到返回队伍`);
      }
    }

    if (stateIn4.length === 0) {
      // 兜底：驻扎和返回都没检测到，回退到派空闲队伍
      ctx.log('[step 4] 兜底：未检测到驻扎和返回，尝试派空闲队伍');
      if (!await checkIdleTeamsAvailable(ctx)) {
        ctx.log('[step 4] 兜底：也无空闲队伍，退出');
        await ctx.tap(EXIT_LARGE_UI_BUTTON.x, EXIT_LARGE_UI_BUTTON.y);
        await ctx.sleep(1);
        break;
      }
      const r = await dispatchToTeamPopup(
        ctx, config, teams, 0, hasPaging, collectedCoords, teamPage
      );
      hasPaging = r.hasPaging;
      if (r.dispatched) {
        dispatched++;
        // 记录坐标防止重复派队
        const coordRegionPath = await ctx.captureRegion(400, 11, 137, 32);
        try {
          try {
            const coordText = await ocrService.readCoordinates(coordRegionPath);
            ctx.log(`  [坐标] 记录已采集: ${coordText}`);
            const curCoord = parseCoord(coordText);
            if (curCoord) {
              collectedCoords.push(curCoord);
            }
          } catch (e) {
            ctx.log(`  ⚠️ 坐标 OCR 失败，跳过记录: ${(e as Error).message}`);
          }
        } finally {
          await fs.unlink(coordRegionPath).catch(() => {});
        }
      }
      continue;
    }

    const topInLarge = stateIn4.sort((a, b) => a.y - b.y)[0];
    const topInLargeX = topInLarge.x + AVATAR_OFFSET.dx;
    const topInLargeY = topInLarge.y + AVATAR_OFFSET.dy;
    const stateLabel = foundState === 'zhuzha' ? '驻扎' : '返回';
    ctx.log(`[step 4] 点击最上${stateLabel}队伍头像 (${topInLargeX}, ${topInLargeY})`);
    await ctx.tap(topInLargeX, topInLargeY);
    await ctx.sleep(1.5);

    const march = await ctx.findImageWithLocation(
      MARCH_BTN_TEMPLATE, 0.7, undefined, undefined, undefined, MARCH_SEARCH_REGION
    );
    if (!march.found) {
      ctx.log(`[step 4] 行军按钮未找到，退大 UI 回 step 1`);
      await ctx.tap(EXIT_LARGE_UI_BUTTON.x, EXIT_LARGE_UI_BUTTON.y);
      await ctx.sleep(1);
      continue;
    }
    ctx.log(`[step 4] 点击行军按钮 (${march.x}, ${march.y})`);
    await ctx.tap(march.x, march.y);
    await ctx.sleep(1.5);
    dispatched++;
    // 记录坐标防止重复派队
    const coordRegionPath = await ctx.captureRegion(400, 11, 137, 32);
    try {
      try {
        const coordText = await ocrService.readCoordinates(coordRegionPath);
        ctx.log(`  [坐标] 记录已采集: ${coordText}`);
        const curCoord = parseCoord(coordText);
        if (curCoord) {
          collectedCoords.push(curCoord);
        }
      } catch (e) {
        ctx.log(`  ⚠️ 坐标 OCR 失败，跳过记录: ${(e as Error).message}`);
      }
    } finally {
      await fs.unlink(coordRegionPath).catch(() => {});
    }
  }

  ctx.log(`=== 专注模式结束：派出 ${dispatched} 队 ===`);
  const result: GemGatherOutcome['result'] =
    dispatched > 0 || quotaFull ? 'success' : 'not_found';
  return { result, dispatched };
}
