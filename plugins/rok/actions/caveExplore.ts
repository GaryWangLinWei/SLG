import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView } from '../utils/location';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fs from 'fs/promises';
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

// OCR 区域：3 个山洞坐标显示位置
const CAVE_OCR_REGIONS = [
  { id: 1, x: 286, y: 457, width: 144, height: 33, cx: 358, cy: 473 },
  { id: 2, x: 297, y: 626, width: 128, height: 30, cx: 361, cy: 641 },
];

// 调查按钮
const INVESTIGATE_BTN = { x: 1141, y: 596 };

export type CaveExploreResult = 'success' | 'no_scout_button' | 'no_idle_scout';

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

  const exploredSet = new Set<string>();

  // 外层循环：处理多个闲置斥候
  while (true) {
    // ============================================
    // 第 0 步: 重置城内视角
    // ============================================
    await resetCityView(ctx, config);

    // ============================================
    // 第 1 步: 拖动斥候营地到屏幕中心，点击
    // ============================================
    ctx.log(`[1/10] 拖动 ${buildingKey} 到屏幕中心 (${buildPos.x}, ${buildPos.y} → 800, 450)`);
    await ctx.swipe(buildPos.x, buildPos.y, 800, 450, 1000);
    await ctx.tap(800, 450);
    await ctx.sleep(0.3);
    await ctx.tap(800, 450);
    await ctx.sleep(0.5);
    await ctx.tap(800, 450);
    await ctx.sleep(1);

    // ============================================
    // 第 2 步: 识别弹出侦查按钮（复用 explore 缓存 key）
    // ============================================
    ctx.log('[2/10] 识别弹出侦查按钮');
    const CACHE_KEY = 'pop_ScoutBtn';
    let popX: number;
    let popY: number;

    const cached = ctx.getCachedLocation(CACHE_KEY);
    if (cached) {
      popX = cached.x;
      popY = cached.y;
      ctx.log(`  使用缓存的侦查按钮坐标 (${popX}, ${popY})`);
    } else {
      const popup = await ctx.findImageWithLocation(popScoutTemplate, 0.7, [0.7, 0.8, 0.9, 1.0, 1.1]);
      if (!popup.found) {
        ctx.log(`  ❌ 未找到弹出侦查按钮 (confidence: ${popup.confidence.toFixed(3)})`);
        return 'no_scout_button';
      }
      popX = popup.x;
      popY = popup.y;
      ctx.setCachedLocation(CACHE_KEY, popX, popY);
      ctx.log(`  识别并缓存侦查按钮 (${popX}, ${popY})，置信度: ${popup.confidence.toFixed(3)}`);
    }

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
    // 第 7 步: OCR 识别山洞坐标
    // ============================================
    ctx.log('[7/10] 识别山洞坐标...');
    let tappedCave = false;
    let anyOcrMatch = false;

    for (const region of CAVE_OCR_REGIONS) {
      const regionPath = await ctx.captureRegion(region.x, region.y, region.width, region.height);

      try {
        const text = (await ocrService.readText(regionPath)).replace(/¥/g, 'Y');
        ctx.log(`  区域${region.id} OCR: "${text}"`);

        // 解析 "X:数字Y:数字" 格式
        const match = text.match(/X\s*:?\s*(\d+)\s*Y\s*:?\s*(\d+)/i);
        if (match) {
          anyOcrMatch = true;
          const coordKey = `X:${match[1]}Y:${match[2]}`;
          if (exploredSet.has(coordKey)) {
            ctx.log(`  山洞 ${coordKey} 已探索，跳过`);
          } else {
            exploredSet.add(coordKey);
            ctx.log(`  新山洞 ${coordKey}，点击区域${region.id}中心 (${region.cx}, ${region.cy})`);
            await ctx.tap(region.cx, region.cy);
            tappedCave = true;
            await fs.unlink(regionPath).catch(() => {});
            break;
          }
        } else {
          ctx.log(`  区域${region.id} 未识别到坐标格式`);
        }
      } catch (e: any) {
        ctx.log(`  区域${region.id} OCR 异常: ${e.message}`);
      }

      await fs.unlink(regionPath).catch(() => {});
    }

    if (!tappedCave) {
      // 前两个山洞都已探索，前往固定位置的第三个山洞
      if (anyOcrMatch) {
        ctx.log(`  前2个山洞已探索，前往第三个山洞 (1235, 743)`);
        await ctx.tap(1235, 743);
        tappedCave = true;
      } else {
        ctx.log('  所有山洞已探索或 OCR 识别失败');
        if (idleTotal > 1) {
          // 还有剩余闲置斥候，继续下一轮
          ctx.log(`  剩余 ${idleTotal - 1} 个闲置斥候，继续...`);
          continue;
        }
        ctx.log('  无更多闲置斥候');
        await ctx.tap(CLOSE_SCOUT.x, CLOSE_SCOUT.y);
        await ctx.sleep(1);
        ctx.log(`=== 山洞探索完成 ===`);
        return 'success';
      }
    }
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
