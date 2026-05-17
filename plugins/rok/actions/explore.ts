import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView } from '../utils/location';
import * as path from 'path';
import sharp from 'sharp';

const TEMPLATE_DIR = path.join(__dirname, '../templates');

// 3个斥候的判定坐标
const SCOUT_POSITIONS = [
  { x: 1174, y: 448 },
  { x: 1174, y: 609 },
  { x: 1174, y: 774 },
];

const CONFIRM_EXPLORE = { x: 1006, y: 598 };

export type ExploreResult = 'success' | 'no_scout_button' | 'not_found';

export interface ExploreOutcome {
  result: ExploreResult;
  dispatched: number;
}

export async function explore(
  ctx: PluginContext,
  config: RokConfig,
  scoutBuilding?: string,
  maxScouts: number = 3
): Promise<ExploreOutcome> {
  const buildingName = scoutBuilding || '斥候营地';
  const max = Math.min(maxScouts, 3);

  ctx.log(`=== 开始自动探索 (斥候营地: ${buildingName}, 最多派出 ${max} 个) ===`);

  const buildPos = config.buildingPositions[buildingName];
  if (!buildPos) {
    ctx.log(`❌ 未找到建筑坐标: ${buildingName}`);
    return { result: 'not_found', dispatched: 0 };
  }

  let dispatched = 0;

  for (let scoutIdx = 0; scoutIdx < max; scoutIdx++) {
    ctx.log(`--- 寻找第 ${scoutIdx + 1} 个可用斥候 ---`);

    // ============================================
    // 第 1-4 步: 进入斥候面板
    // ============================================
    await resetCityView(ctx, config);

    ctx.log(`  [1/8] 点击 ${buildingName} (${buildPos.x}, ${buildPos.y})`);
    await ctx.tap(buildPos.x, buildPos.y);
    await ctx.sleep(1.5);

    // 第 3 步: 图像识别弹出侦查按钮
    ctx.log('  [3/8] 识别弹出侦查按钮');
    const popScoutTemplate = path.join(TEMPLATE_DIR, 'pop_zhenChaBtn.png');
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
        return { result: 'no_scout_button', dispatched: 0 };
      }
      popX = popup.x;
      popY = popup.y;
      ctx.setCachedLocation(CACHE_KEY, popX, popY);
      ctx.log(`  识别并缓存侦查按钮 (${popX}, ${popY})`);
    }

    // 第 4 步: 点击弹出侦查按钮
    ctx.log(`  [4/8] 点击侦查按钮 (${popX}, ${popY})`);
    await ctx.tap(popX, popY);
    await ctx.sleep(2);

    // ============================================
    // 第 5 步: 从当前 scoutIdx 开始依次检测可用斥候
    // ============================================
    ctx.log('  [5/8] 检测可用斥候...');
    const availableTemplate = path.join(TEMPLATE_DIR, 'btn_scout_available.png');
    const { width: availW = 60, height: availH = 60 } = await sharp(availableTemplate).metadata();

    let foundAvailable = false;
    let chosenScoutIdx = -1;

    for (let i = scoutIdx; i < 3; i++) {
      const pos = SCOUT_POSITIONS[i];
      const regionPath = await ctx.captureRegion(
        pos.x - Math.floor(availW! / 2),
        pos.y - Math.floor(availH! / 2),
        availW!, availH!
      );
      const diff = await ctx.compareImages(regionPath, availableTemplate);
      ctx.log(`  斥候${i + 1} (${pos.x}, ${pos.y}) 差异: ${(diff * 100).toFixed(1)}%`);

      if (diff < 0.3) {
        ctx.log(`  斥候${i + 1} 可用，选择`);
        await ctx.tap(pos.x, pos.y);
        chosenScoutIdx = i;
        foundAvailable = true;
        break;
      }
      ctx.log(`  斥候${i + 1} 不可用，继续下一个`);
    }

    if (!foundAvailable) {
      ctx.log('  ⚠️ 所有剩余斥候均不可用');
      await ctx.tap(config.backButton.x, config.backButton.y);
      await ctx.sleep(1);
      return { result: 'success', dispatched };
    }

    scoutIdx = chosenScoutIdx;

    // ============================================
    // 第 6 步: 等待视角跳转，点击确认探索
    // ============================================
    ctx.log(`  [6/8] 等待视角跳转，点击确认探索 (${CONFIRM_EXPLORE.x}, ${CONFIRM_EXPLORE.y})`);
    await ctx.sleep(2.5);
    await ctx.tap(CONFIRM_EXPLORE.x, CONFIRM_EXPLORE.y);
    await ctx.sleep(1.5);

    // ============================================
    // 第 7 步: 图像识别斥候探索按钮
    // ============================================
    ctx.log('  [7/8] 识别斥候探索按钮');
    const exploreTemplate = path.join(TEMPLATE_DIR, 'btn_explore.png');
    const exploreBtn = await ctx.findImageWithLocation(exploreTemplate, 0.7);
    if (!exploreBtn.found) {
      ctx.log(`  ⚠️ 未找到斥候探索按钮 (confidence: ${exploreBtn.confidence.toFixed(3)})`);
      await ctx.tap(config.backButton.x, config.backButton.y);
      await ctx.sleep(1);
      continue;
    }
    ctx.log(`  找到探索按钮 (${exploreBtn.x}, ${exploreBtn.y})`);

    // ============================================
    // 第 8 步: 点击探索按钮
    // ============================================
    ctx.log(`  [8/8] 点击探索按钮 (${exploreBtn.x}, ${exploreBtn.y})`);
    await ctx.tap(exploreBtn.x, exploreBtn.y);
    await ctx.sleep(1);

    dispatched++;
    ctx.log(`  ✅ 斥候${chosenScoutIdx + 1} 已派出，累计派出 ${dispatched} 个`);
  }

  ctx.log(`=== 自动探索完成，共派出 ${dispatched} 个斥候 ===`);
  return { result: 'success', dispatched };
}
