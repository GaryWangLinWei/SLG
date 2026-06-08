import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
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
  { dx: 1, dy: 0 },   // 右
  { dx: 0, dy: 1 },   // 下
  { dx: -1, dy: 0 },  // 左
  { dx: 0, dy: -1 },  // 上
];

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

  // [3/8] 螺旋搜索城寨（多模板并行）
  const scales = spiralCfg.searchScales;
  ctx.log(`  [3/8] 螺旋搜索 Lv.${targetLevel} 城寨（上限 ${spiralCfg.searchMaxAttempts} 次, 模板${CHENG_ZHAI_TEMPLATES.length}个, 缩放${scales.join(',')}）`);
  let fortFound = false;
  let fortX = 0;
  let fortY = 0;
  let foundLevel = 0;

  for (let attempt = 0; attempt < spiralCfg.searchMaxAttempts && !fortFound; attempt++) {
    // 并行搜索所有城寨模板
    const matchResults = await Promise.all(
      CHENG_ZHAI_TEMPLATES.map(t => ctx.findImageWithLocation(t, spiralCfg.searchThreshold, scales))
    );
    const best = matchResults
      .filter(r => r.found)
      .sort((a, b) => b.confidence - a.confidence)[0];

    if (best) {
      fortX = best.x;
      fortY = best.y;
      ctx.log(`  找到城寨图标 (${fortX}, ${fortY}) confidence: ${best.confidence.toFixed(3)}`);

      // OCR 识别等级
      const ocrX = fortX - 15;
      const ocrY = fortY + 12;
      const ocrRegionPath = await ctx.captureRegion(ocrX, ocrY, 30, 13);
      const ocrText = await ocrService.readText(ocrRegionPath);
      await fs.unlink(ocrRegionPath).catch(() => {});
      ctx.log(`  OCR 识别等级: "${ocrText}"`);

      const levelMatch = ocrText.match(/(\d+)/);
      if (levelMatch) {
        foundLevel = parseInt(levelMatch[1], 10);
        ctx.log(`  识别到 Lv.${foundLevel} 城寨`);
        if (foundLevel === targetLevel) {
          fortFound = true;
          ctx.log(`  等级匹配 Lv.${targetLevel}，选择该城寨`);
        } else {
          ctx.log(`  等级不匹配（期望 Lv.${targetLevel}，实际 Lv.${foundLevel}），跳过`);
        }
      } else {
        ctx.log(`  OCR 未识别到数字，跳过`);
      }
    }

    if (!fortFound && attempt < spiralCfg.searchMaxAttempts - 1) {
      const dir = SPIRAL_DIRECTIONS[attempt % 4];
      const armLen = spiralCfg.spiralSwipeLength * (Math.floor(attempt / 4) + 1);
      const fromX = spiralCfg.spiralCenterX;
      const fromY = spiralCfg.spiralCenterY;
      const toX = spiralCfg.spiralCenterX + dir.dx * armLen;
      const toY = spiralCfg.spiralCenterY + dir.dy * armLen;
      ctx.log(`  未找到，滑动 ${dir.dx > 0 ? '→' : dir.dx < 0 ? '←' : dir.dy > 0 ? '↓' : '↑'} ${armLen}px (${attempt + 1}/${spiralCfg.searchMaxAttempts})`);
      await ctx.swipe(fromX, fromY, toX, toY, 500);
      await ctx.sleep(1);
    }
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

  // 检测分页
  const hasPaging = await ctx.findImage(PAGE_INDICATOR_TEMPLATE, 0.8);
  ctx.log(`  [检测] 换页按钮: ${hasPaging ? '存在 (>7组)' : '不存在 (≤7组)'}`);

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
