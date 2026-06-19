import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { ensureTeamPage } from '../utils/teamPage';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fs from 'fs/promises';

const TEMPLATE_DIR = getTemplatesDir();
const CHENG_ZHAI_TEMPLATES = [
  path.join(TEMPLATE_DIR, 'ChengZhai.png'),
  path.join(TEMPLATE_DIR, 'ChengZhai_Afternoon_result.png'),
  path.join(TEMPLATE_DIR, 'ChengZhai_night_result.png'),
];
const JIJIE_TEMPLATE = path.join(TEMPLATE_DIR, 'JiJie.png');
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');

// 队伍选择坐标（与 rallyFort 内置搜索版一致）
const SELECT_TEAM_BUTTON = { x: 1259, y: 180 };
const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 362 }, 2: { x: 1378, y: 430 },
  3: { x: 1378, y: 497 }, 4: { x: 1378, y: 566 }, 5: { x: 1378, y: 633 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 397 }, 2: { x: 1378, y: 463 },
  3: { x: 1378, y: 533 }, 4: { x: 1378, y: 600 }, 5: { x: 1378, y: 671 },
};
const MARCH_BUTTON = { x: 1154, y: 791 };
const CLOSE_POPUP_BUTTON = { x: 1392, y: 57 };
const CLOSE_TEAM_PANEL_BUTTON = { x: 1394, y: 60 };
const CONFIRM_TIME_BUTTON = { x: 1177, y: 396 };
const SWITCH_IN_CITY_TEMPLATE = path.join(TEMPLATE_DIR, 'switch_in_city.png');
const SWITCH_IN_WORLD_TEMPLATE = path.join(TEMPLATE_DIR, 'switch_in_world.png');

const SPIRAL_DIRECTIONS = [
  { dx: 0, dy: -1 },  // 上
  { dx: 1, dy: 0 },   // 右
  { dx: 0, dy: 1 },   // 下
  { dx: -1, dy: 0 },  // 左
];
const SPIRAL_DIR_NAMES = ['↑', '→', '↓', '←'];

function isInChatZone(x: number, y: number): boolean {
  return x >= 0 && x <= 814 && y >= 794 && y <= 900;
}

interface FortMatch { x: number; y: number; confidence: number; }

async function trySelectFort(
  ctx: PluginContext,
  match: FortMatch,
  targetLevel: number
): Promise<{ matched: boolean; level: number }> {
  ctx.log(`  找到城寨图标 (${match.x}, ${match.y}) confidence: ${match.confidence.toFixed(3)}`);

  const ocrX = match.x - 15;
  const ocrY = match.y + 12;
  const ocrRegionPath = await ctx.captureRegion(ocrX, ocrY, 30, 13);
  const ocrText = await ocrService.readText(ocrRegionPath);
  await fs.unlink(ocrRegionPath).catch(() => {});
  ctx.log(`  OCR 识别等级: "${ocrText}"`);

  const levelMatch = ocrText.match(/(\d+)/);
  if (levelMatch) {
    const level = parseInt(levelMatch[1], 10);
    ctx.log(`  识别到 Lv.${level} 城寨`);
    if (level === targetLevel) {
      ctx.log(`  等级匹配 Lv.${targetLevel}，选择该城寨`);
      return { matched: true, level };
    }
    ctx.log(`  等级不匹配（期望 Lv.${targetLevel}，实际 Lv.${level}），跳过`);
    return { matched: false, level };
  }
  ctx.log(`  OCR 未识别到数字，跳过`);
  return { matched: false, level: 0 };
}

export interface RallyFortSpiralOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable' | 'stamina_insufficient';
  dispatched: number;
  foundLevel?: number;
}

export async function rallyFortSpiral(
  ctx: PluginContext,
  config: RokConfig,
  targetLevel: number,
  team: number
): Promise<RallyFortSpiralOutcome> {
  ctx.log(`=== 自动攻打城寨（螺旋搜索） Lv.${targetLevel} 队伍${team} ===`);

  const spiralCfg = config.fortSpiral;
  const worldBtn = config.resourceCollect.worldSwitchButton;

  // [1/8] 确保在城外
  ctx.log('  [1/8] 确保在城外');
  await ensureInWorld(ctx, config);

  // [2/8] 缩小地图
  ctx.log('  [2/8] 缩小地图');
  const p = spiralCfg.pinch;
  await ctx.pinch(p.from1.x, p.from1.y, p.from2.x, p.from2.y, p.to1.x, p.to1.y, p.to2.x, p.to2.y, p.duration);
  await ctx.sleep(1);

  // [3/8] 方形螺旋搜索城寨（九宫格逐格推进）
  const scales = spiralCfg.searchScales;
  ctx.log(`  [3/8] 方形螺旋搜索 Lv.${targetLevel} 城寨（上限 ${spiralCfg.searchMaxAttempts} 步, 模板${CHENG_ZHAI_TEMPLATES.length}个, 缩放${scales.join(',')}）`);
  let fortFound = false;
  let fortX = 0;
  let fortY = 0;
  let foundLevel = 0;
  let step = 1;       // 当前方向上的移动次数，每两方向递增
  let dirIndex = 0;   // 0=上, 1=右, 2=下, 3=左
  let moveCount = 0;

  const halfW = Math.round(1600 * spiralCfg.spiralSwipeRatio / 2);
  const halfH = Math.round(900 * spiralCfg.spiralSwipeRatio / 2);

  // 先检测中心 5 号位
  const initResults = await Promise.all(
    CHENG_ZHAI_TEMPLATES.map(t => ctx.findImageWithLocation(t, spiralCfg.searchThreshold, scales))
  );
  const initBest = initResults.filter(r => r.found).sort((a, b) => b.confidence - a.confidence)[0];
  if (initBest && !isInChatZone(initBest.x, initBest.y)) {
    const result = await trySelectFort(ctx, initBest, targetLevel);
    if (result.matched) { fortFound = true; fortX = initBest.x; fortY = initBest.y; foundLevel = result.level; }
  }

  while (!fortFound && moveCount < spiralCfg.searchMaxAttempts) {
    const dir = SPIRAL_DIRECTIONS[dirIndex % 4];

    for (let s = 0; s < step && !fortFound && moveCount < spiralCfg.searchMaxAttempts; s++) {
      // 固定屏内坐标：竖直滑动 x=850 避开聊天窗口，水平滑动 y=450
      const fromX = dir.dx !== 0 ? (800 + dir.dx * halfW) : 850;
      const fromY = dir.dy !== 0 ? (450 + dir.dy * halfH) : 450;
      const toX   = dir.dx !== 0 ? (800 - dir.dx * halfW) : 850;
      const toY   = dir.dy !== 0 ? (450 - dir.dy * halfH) : 450;
      moveCount++;
      await ctx.swipe(fromX, fromY, toX, toY, 500);
      await ctx.sleep(1);

      const matchResults = await Promise.all(
        CHENG_ZHAI_TEMPLATES.map(t => ctx.findImageWithLocation(t, spiralCfg.searchThreshold, scales))
      );
      const best = matchResults.filter(r => r.found).sort((a, b) => b.confidence - a.confidence)[0];
      if (best) {
        ctx.log(`  ${SPIRAL_DIR_NAMES[dirIndex % 4]}(${moveCount}): ${best.confidence.toFixed(3)}`);
        if (isInChatZone(best.x, best.y)) {
          ctx.log(`  忽略聊天窗口区域的城寨图标 (${best.x}, ${best.y})`);
        } else {
          const result = await trySelectFort(ctx, best, targetLevel);
          if (result.matched) {
            fortFound = true; fortX = best.x; fortY = best.y; foundLevel = result.level;
            break;
          }
        }
      }
    }

    if (dirIndex % 2 === 1) step++;
    dirIndex++;
  }

  if (!fortFound) {
    ctx.log(`  ❌ 未找到 Lv.${targetLevel} 城寨`);
    await ctx.tap(worldBtn.x, worldBtn.y);
    await ctx.sleep(2);
    return { result: 'not_found', dispatched: 0 };
  }

  // [4/8] 点击城寨
  ctx.log(`  [4/8] 点击城寨 (${fortX}, ${fortY})`);
  await ctx.tap(fortX, fortY);
  await ctx.sleep(2);

  // [5/8] 识别并点击集结按钮
  ctx.log('  [5/8] 识别集结按钮');
  const jijieResult = await ctx.findImageWithLocation(JIJIE_TEMPLATE, 0.7);
  if (!jijieResult.found) {
    ctx.log(`  ❌ 未找到集结按钮 (confidence: ${jijieResult.confidence.toFixed(3)})`);
    await ctx.tap(worldBtn.x, worldBtn.y);
    await ctx.sleep(2);
    return { result: 'not_found', dispatched: 0, foundLevel };
  }
  ctx.log(`  点击集结按钮 (${jijieResult.x}, ${jijieResult.y})`);
  await ctx.tap(jijieResult.x, jijieResult.y);
  await ctx.sleep(1.5);

  // [6/8] 确认集结时间
  ctx.log(`  [6/8] 确认集结时间 (${CONFIRM_TIME_BUTTON.x}, ${CONFIRM_TIME_BUTTON.y})`);
  await ctx.tap(CONFIRM_TIME_BUTTON.x, CONFIRM_TIME_BUTTON.y);
  await ctx.sleep(1);

  // 检测分页 + 拿到换页按钮坐标
  const pageResult = await ctx.findImageWithLocation(PAGE_INDICATOR_TEMPLATE, 0.8);
  const hasPaging = pageResult.found;
  if (hasPaging) {
    ctx.log(`  [检测] 换页按钮: 存在 (>7组) @ (${pageResult.x},${pageResult.y})`);
  } else {
    ctx.log(`  [检测] 换页按钮: 不存在 (≤7组)`);
  }

  // 如有换页按钮，确保在攻击队伍页（红队）
  // rallyFort 弹窗的部队页指示器位于 (1361,378)-(1397,413)
  if (hasPaging) {
    const onTargetPage = await ensureTeamPage(
      ctx,
      'attack',
      { x: pageResult.x, y: pageResult.y },
      { x: 1361, y: 378, w: 36, h: 35 }
    );
    if (!onTargetPage) {
      ctx.log(`  ⚠️ 未能切换到攻击队伍页`);
      return { result: 'team_unavailable', dispatched: 0, foundLevel };
    }
  }

  const teamButtons = hasPaging ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
  const teamBtn = teamButtons[team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${team}`);
    return { result: 'team_unavailable', dispatched: 0, foundLevel };
  }

  // [7/8] 选择队伍并检测状态变化
  ctx.log(`  [7/8] 选择队伍 ${team} 并检测状态变化...`);
  const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
  ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

  if (!stateResult.changed) {
    ctx.log(`  ⚠️ 队伍${team}不可用，按钮无选中状态变化，跳过`);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    return { result: 'team_unavailable', dispatched: 0, foundLevel };
  }

  // [8/8] 点击行军
  await ctx.sleep(0.5);
  ctx.log(`  [8/8] 点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
  await ctx.tap(MARCH_BUTTON.x, MARCH_BUTTON.y);
  await ctx.sleep(1);

  // 检测行动力不足弹窗
  const switchCityResult = await ctx.findImageWithLocation(SWITCH_IN_CITY_TEMPLATE, 0.7);
  const switchWorldResult = await ctx.findImageWithLocation(SWITCH_IN_WORLD_TEMPLATE, 0.7);
  ctx.log(`  切换按钮: city=${switchCityResult.found ? switchCityResult.confidence.toFixed(3) : 'not found'}, world=${switchWorldResult.found ? switchWorldResult.confidence.toFixed(3) : 'not found'}`);
  const isStaminaInsufficient = !switchCityResult.found && !switchWorldResult.found;
  if (isStaminaInsufficient) {
    ctx.log(`  ⚠️ 切换按钮不可见 → 行动力不足弹窗`);
    await ctx.tap(1363, 103);
    await ctx.sleep(0.5);
    await ctx.tap(CLOSE_TEAM_PANEL_BUTTON.x, CLOSE_TEAM_PANEL_BUTTON.y);
    await ctx.sleep(0.5);
    await ctx.tap(worldBtn.x, worldBtn.y);
    await ctx.sleep(2);
    return { result: 'stamina_insufficient', dispatched: 0, foundLevel };
  }

  ctx.log(`  ✅ 队伍${team} 已发起 Lv.${foundLevel} 城寨集结（螺旋搜索）`);
  return { result: 'success', dispatched: 1, foundLevel };
}
