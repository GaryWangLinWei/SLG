import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView } from '../utils/location';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';

const TEMPLATE_DIR = getTemplatesDir();

// 关闭斥候管理界面
const CLOSE_SCOUT = { x: 1365, y: 109 };

// 山洞页签
const CAVE_TAB = { x: 940, y: 267 };

// 调查按钮
const INVESTIGATE_BTN = { x: 1141, y: 596 };

// 神秘山洞标题左侧"探索中"红眼图标与右侧"前往"按钮的水平范围（相对 1600×900）。
// 每个前往按钮同一行的标题左侧若存在该红眼图标，说明该洞正在探索中，前往不可点，需跳过。
const TANSUO_ROW = { xStart: 380, xEnd: 470, yTolerance: 100 };

export type CaveExploreResult = 'success' | 'no_scout_button' | 'no_idle_scout' | 'no_cave';

/** 判断某个前往按钮所在行是否处于探索中（标题左侧有红眼图标） */
async function isRowExploring(
  ctx: PluginContext,
  template: string,
  gotoY: number,
): Promise<boolean> {
  const matches = await ctx.findAllImages(template, 0.7, {
    x: TANSUO_ROW.xStart,
    y: Math.max(0, Math.round(gotoY - TANSUO_ROW.yTolerance)),
    width: TANSUO_ROW.xEnd - TANSUO_ROW.xStart,
    height: TANSUO_ROW.yTolerance * 2,
  });
  return matches.length > 0;
}

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

  const popScoutTemplate = path.join(TEMPLATE_DIR, 'pop_zhenChaBtn.png');
  const btnExploreTemplate = path.join(TEMPLATE_DIR, 'btn_explore.png');
  const btnGoToCaveTemplate = path.join(TEMPLATE_DIR, 'btn_gotocave.png');
  const tansuoTemplate = path.join(TEMPLATE_DIR, 'chihou_tansuo.png');

  let dispatched = 0;

  // 外层循环：每轮派一个斥候去一个未在探索的山洞，直到当前可见列表没有可点的前往。
  while (true) {
    ctx.log(`=== 山洞探索：开始第 ${dispatched + 1} 轮 ===`);

    // 第 0 步: 重置城内视角
    await resetCityView(ctx, config);

    // 第 1 步: 点击斥候营地
    ctx.log(`[1/7] 点击斥候营地 (${buildPos.x},${buildPos.y})`);
    await ctx.tap(buildPos.x, buildPos.y);
    await ctx.sleep(1);

    // 第 2 步: 识别弹出侦查按钮
    ctx.log('[2/7] 识别弹出侦查按钮');
    const popup = await ctx.findImageWithLocation(popScoutTemplate, 0.7, [0.7, 0.8, 0.9, 1.0, 1.1]);
    if (!popup.found) {
      ctx.log(`  ❌ 未找到弹出侦查按钮 (confidence: ${popup.confidence.toFixed(3)})`);
      return dispatched > 0 ? 'success' : 'no_scout_button';
    }
    ctx.log(`  识别侦查按钮 (${popup.x}, ${popup.y})，置信度: ${popup.confidence.toFixed(3)}`);

    // 第 3 步: 点击侦查按钮
    ctx.log(`[3/7] 点击侦查按钮 (${popup.x}, ${popup.y})`);
    await ctx.tap(popup.x, popup.y);
    await ctx.sleep(2);

    // 第 4 步: 点击山洞页签
    ctx.log(`[4/7] 点击山洞页签 (${CAVE_TAB.x},${CAVE_TAB.y})`);
    await ctx.tap(CAVE_TAB.x, CAVE_TAB.y);
    await ctx.sleep(1);

    // 第 5 步: 识别所有"前往"按钮（按 y 升序），逐个检查同一行是否正在探索中
    ctx.log('[5/7] 识别前往按钮并排除探索中的山洞...');
    const gotoMatches = (await ctx.findAllImages(btnGoToCaveTemplate, 0.7))
      .sort((a, b) => a.y - b.y);

    if (gotoMatches.length === 0) {
      ctx.log('  未识别到前往按钮，关闭界面');
      await ctx.tap(CLOSE_SCOUT.x, CLOSE_SCOUT.y);
      await ctx.sleep(1);
      return dispatched > 0 ? 'success' : 'no_cave';
    }

    let target: { x: number; y: number } | null = null;
    for (const m of gotoMatches) {
      const exploring = await isRowExploring(ctx, tansuoTemplate, m.y);
      ctx.log(`  前往按钮 (${m.x},${m.y}) conf=${m.confidence.toFixed(3)} → ${exploring ? '探索中，跳过' : '可前往'}`);
      if (!exploring) {
        target = m;
        break;
      }
    }

    if (!target) {
      ctx.log('  当前可见山洞全部探索中，没有可点的前往，关闭界面');
      await ctx.tap(CLOSE_SCOUT.x, CLOSE_SCOUT.y);
      await ctx.sleep(1);
      ctx.log(`=== 山洞探索完成，共派遣 ${dispatched} 个 ===`);
      return 'success';
    }

    // 第 6 步: 点击前往，视角跳到山洞
    ctx.log(`[6/7] 点击前往 (${target.x},${target.y})`);
    await ctx.tap(target.x, target.y);
    await ctx.sleep(2.5);

    // 点调查
    ctx.log(`  点击调查按钮 (${INVESTIGATE_BTN.x},${INVESTIGATE_BTN.y})`);
    await ctx.tap(INVESTIGATE_BTN.x, INVESTIGATE_BTN.y);
    await ctx.sleep(1.5);

    // 第 7 步: 识别并点击派遣按钮
    ctx.log('[7/7] 识别派遣按钮');
    const exploreBtn = await ctx.findImageWithLocation(btnExploreTemplate, 0.7);
    if (!exploreBtn.found) {
      ctx.log(`  ⚠️ 未找到派遣按钮 (confidence: ${exploreBtn.confidence.toFixed(3)})，返回`);
      await ctx.tap(config.backButton.x, config.backButton.y);
      await ctx.sleep(1);
      continue;
    }
    ctx.log(`  找到派遣按钮 (${exploreBtn.x},${exploreBtn.y})，点击派遣`);
    await ctx.tap(exploreBtn.x, exploreBtn.y);
    await ctx.sleep(1);
    dispatched++;
    ctx.log(`  已派遣第 ${dispatched} 个斥候，返回继续寻找下一个山洞`);
  }
}

/**
 * 重置山洞探索状态。
 * 改为按"前往"按钮位置选洞后无内部状态，保留空实现以兼容前端 action 调用。
 */
export function resetCaveExploreState(): void {
  // no-op
}
