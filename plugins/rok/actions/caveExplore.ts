import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView, swipeBuildingToCenter } from '../utils/location';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';
import sharp from 'sharp';

const TEMPLATE_DIR = getTemplatesDir();

// 斥候列表滑动
const SCOUT_LIST_SWIPE_START = { x: 904, y: 675 };
const SCOUT_LIST_SWIPE_END = { x: 955, y: 438 };

// 闲置斥候检测区域
const IDLE_SEARCH_REGION = { x: 509, y: 385, width: 57, height: 412 };

// 关闭斥候管理界面
const CLOSE_SCOUT = { x: 1365, y: 109 };

// 山洞页签
const CAVE_TAB = { x: 940, y: 267 };

// 调查按钮
const INVESTIGATE_BTN = { x: 1141, y: 596 };

export type CaveExploreResult = 'success' | 'no_scout_button' | 'no_idle_scout' | 'no_cave';

export async function caveExplore(
  ctx: PluginContext,
  config: RokConfig
): Promise<CaveExploreResult> {
  const buildingKey = '斥候营地';
  const buildPos = config.buildingPositions[buildingKey];
  if (!buildPos) {
    ctx.log(`❌ 未找到建筑坐标: ${buildingKey}`);
    return 'no_scout_button';
  }

  ctx.log(`=== 开始山洞探索 ===`);

  const popScoutTemplate = path.join(TEMPLATE_DIR, 'pop_zhenChaBtn.png');
  const chihouIdleTemplate = path.join(TEMPLATE_DIR, 'chihou_idle.png');
  const chihouBackTemplate = path.join(TEMPLATE_DIR, 'chihou_back.png');
  const chihouZhuzhaTemplate = path.join(TEMPLATE_DIR, 'chihou_zhuzha.png');
  const btnExploreTemplate = path.join(TEMPLATE_DIR, 'btn_explore.png');
  const btnGoToCaveTemplate = path.join(TEMPLATE_DIR, 'btn_gotocave.png');

  // 预加载模板尺寸
  const idleMeta = await sharp(chihouIdleTemplate).metadata();
  const backMeta = await sharp(chihouBackTemplate).metadata();
  const zhuzhaMeta = await sharp(chihouZhuzhaTemplate).metadata();
  const idleW = idleMeta.width!;
  const idleH = idleMeta.height!;
  const backW = backMeta.width!;
  const backH = backMeta.height!;
  const zhuzhaW = zhuzhaMeta.width!;
  const zhuzhaH = zhuzhaMeta.height!;

  // 外层循环：处理多个闲置斥候
  while (true) {
    // ============================================
    // 第 0 步: 重置城内视角
    // ============================================
    await resetCityView(ctx, config);

    // ============================================
    // 第 1 步: 拖动斥候营地到屏幕中心，点击
    // ============================================
    await swipeBuildingToCenter(ctx, buildPos, buildingKey);

    // ============================================
    // 第 2 步: 识别弹出侦查按钮
    // ============================================
    ctx.log('[2/10] 识别弹出侦查按钮');
    const popup = await ctx.findImageWithLocation(popScoutTemplate, 0.7, [0.7, 0.8, 0.9, 1.0, 1.1]);
    if (!popup.found) {
      ctx.log(`  ❌ 未找到弹出侦查按钮 (confidence: ${popup.confidence.toFixed(3)})`);
      return 'no_scout_button';
    }
    const popX = popup.x;
    const popY = popup.y;
    ctx.log(`  识别侦查按钮 (${popX}, ${popY})，置信度: ${popup.confidence.toFixed(3)}`);

    // ============================================
    // 第 3 步: 点击侦查按钮
    // ============================================
    ctx.log(`[3/10] 点击侦查按钮 (${popX}, ${popY})`);
    await ctx.tap(popX, popY);
    await ctx.sleep(2);

    // ============================================
    // 第 4 步: 滑动斥候列表
    // ============================================
    ctx.log(`[4/10] 滑动斥候列表 (${SCOUT_LIST_SWIPE_START.x}, ${SCOUT_LIST_SWIPE_START.y}) → (${SCOUT_LIST_SWIPE_END.x}, ${SCOUT_LIST_SWIPE_END.y})`);
    await ctx.swipe(SCOUT_LIST_SWIPE_START.x, SCOUT_LIST_SWIPE_START.y, SCOUT_LIST_SWIPE_END.x, SCOUT_LIST_SWIPE_END.y, 500);
    await ctx.sleep(1);

    // ============================================
    // 第 5 步: 检测闲置斥候
    // ============================================
    ctx.log('[5/10] 检测闲置斥候...');

    const idleMatches = await ctx.findAllImages(chihouIdleTemplate, 0.7, IDLE_SEARCH_REGION);
    const backMatches = await ctx.findAllImages(chihouBackTemplate, 0.7, IDLE_SEARCH_REGION);
    const zhuzhaMatches = await ctx.findAllImages(chihouZhuzhaTemplate, 0.7, IDLE_SEARCH_REGION);

    ctx.log(`  闲置: ${idleMatches.length} 个, 归巢: ${backMatches.length} 个, 驻扎: ${zhuzhaMatches.length} 个`);

    const idleTotal = idleMatches.length + backMatches.length + zhuzhaMatches.length;

    if (idleTotal === 0) {
      ctx.log('  无闲置斥候，关闭界面');
      await ctx.tap(CLOSE_SCOUT.x, CLOSE_SCOUT.y);
      await ctx.sleep(1);
      ctx.log(`=== 山洞探索完成 (无闲置斥候) ===`);
      return 'no_idle_scout';
    }

    // 选取第一个可用斥候
    const firstTarget = idleMatches[0] ?? backMatches[0] ?? zhuzhaMatches[0];
    ctx.log(`  选择斥候 (${firstTarget.x}, ${firstTarget.y})，闲置总数: ${idleTotal}`);
    await ctx.tap(firstTarget.x, firstTarget.y);
    await ctx.sleep(1);

    // ============================================
    // 第 6 步: 点击山洞页签
    // ============================================
    ctx.log(`[6/10] 点击山洞页签 (${CAVE_TAB.x}, ${CAVE_TAB.y})`);
    await ctx.tap(CAVE_TAB.x, CAVE_TAB.y);
    await ctx.sleep(1);

    // ============================================
    // 第 7 步: 全屏识别所有"前往"按钮，按可用斥候数选择
    // 可用斥候=3 → 最上面的按钮；=2 → 第二上面；=1 → 最下面
    // （前往按钮按 y 升序排列，最上面在前）
    // ============================================
    ctx.log('[7/10] 全屏识别前往按钮...');

    // 按 y 升序排列（最上面在前）
    const gotoMatches = (await ctx.findAllImages(btnGoToCaveTemplate, 0.7))
      .sort((a, b) => a.y - b.y);
    ctx.log(`  识别到 ${gotoMatches.length} 个前往按钮，可用斥候 ${idleTotal} 个`);

    if (gotoMatches.length === 0) {
      ctx.log('  ⚠️ 未识别到前往按钮，无可探索山洞，关闭界面');
      await ctx.tap(CLOSE_SCOUT.x, CLOSE_SCOUT.y);
      await ctx.sleep(1);
      ctx.log(`=== 山洞探索完成 (无可探索山洞) ===`);
      return 'no_cave';
    }

    // 按 y 升序（最上面在前）：
    // 3 个斥候 → 最上面(index 0)；2 个 → 第二上面(index 1)；1 个 → 最下面(index length-1)
    let pickIndex: number;
    if (idleTotal >= 3) pickIndex = 0;
    else if (idleTotal === 2) pickIndex = 1;
    else pickIndex = gotoMatches.length - 1;
    const target = gotoMatches[pickIndex] ?? gotoMatches[gotoMatches.length - 1];
    ctx.log(`  选择第 ${pickIndex + 1} 个前往按钮 (${target.x}, ${target.y})，可用斥候 ${idleTotal}`);
    await ctx.tap(target.x, target.y);
    await ctx.sleep(2.5);

    // ============================================
    // 第 8 步: 点击调查按钮
    // ============================================
    ctx.log(`[8/10] 点击调查按钮 (${INVESTIGATE_BTN.x}, ${INVESTIGATE_BTN.y})`);
    await ctx.tap(INVESTIGATE_BTN.x, INVESTIGATE_BTN.y);
    await ctx.sleep(1.5);

    // ============================================
    // 第 9 步: 识别并点击派遣按钮
    // ============================================
    ctx.log('[9/10] 识别派遣按钮');
    const exploreBtn = await ctx.findImageWithLocation(btnExploreTemplate, 0.7);
    if (!exploreBtn.found) {
      ctx.log(`  ⚠️ 未找到派遣按钮 (confidence: ${exploreBtn.confidence.toFixed(3)})`);
      await ctx.tap(config.backButton.x, config.backButton.y);
      await ctx.sleep(1);
      if (idleTotal > 1) continue;
      ctx.log(`=== 山洞探索完成 ===`);
      return 'success';
    }
    ctx.log(`  找到派遣按钮 (${exploreBtn.x}, ${exploreBtn.y})，点击派遣`);
    await ctx.tap(exploreBtn.x, exploreBtn.y);
    await ctx.sleep(1);

    // ============================================
    // 第 10 步: 判断是否继续
    // ============================================
    ctx.log(`[10/10] 本轮完成，闲置总数: ${idleTotal}`);
    if (idleTotal > 1) {
      ctx.log(`  还有 ${idleTotal - 1} 个闲置斥候，从第 0 步重新开始`);
    } else {
      ctx.log('  唯一闲置斥候已派遣');
      ctx.log(`=== 山洞探索完成 ===`);
      return 'success';
    }
  }
}

/**
 * 重置山洞探索状态。
 * 改为按"前往"按钮位置选洞后无内部状态，保留空实现以兼容前端 action 调用。
 */
export function resetCaveExploreState(): void {
  // no-op
}
