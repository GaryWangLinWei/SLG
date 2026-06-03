import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fs from 'fs/promises';

const TEMPLATE_DIR = getTemplatesDir();
const CHENG_ZHAI_TEMPLATE = path.join(TEMPLATE_DIR, 'ChengZhai.png');
const JIJIE_TEMPLATE = path.join(TEMPLATE_DIR, 'JiJie.png');

// 队伍选择坐标（复用 gatherResources）
const SELECT_TEAM_BUTTON = { x: 1259, y: 180 };
const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 292 }, 2: { x: 1378, y: 359 },
  3: { x: 1378, y: 430 }, 4: { x: 1378, y: 499 }, 5: { x: 1378, y: 565 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 328 }, 2: { x: 1378, y: 392 },
  3: { x: 1378, y: 465 }, 4: { x: 1378, y: 529 }, 5: { x: 1378, y: 595 },
};
const MARCH_BUTTON = { x: 1154, y: 791 };
const CLOSE_POPUP_BUTTON = { x: 1392, y: 57 };
const CONFIRM_TIME_BUTTON = { x: 1177, y: 396 };

// 螺旋搜索参数
const SEARCH_MAX_ATTEMPTS = 20;
const SPIRAL_SWIPE_LENGTH = 600;
const SPIRAL_DIRECTIONS = [
  { dx: 1, dy: 0 },   // 右
  { dx: 0, dy: 1 },   // 下
  { dx: -1, dy: 0 },  // 左
  { dx: 0, dy: -1 },  // 上
];

export interface RallyFortOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;
  foundLevel?: number;
}

export async function rallyFort(
  ctx: PluginContext,
  config: RokConfig,
  targetLevel: number,
  team: number
): Promise<RallyFortOutcome> {
  ctx.log(`=== 自动攻打城寨 Lv.${targetLevel} 队伍${team} ===`);

  // [1/8] 确保在城外
  ctx.log('  [1/8] 确保在城外');
  await ensureInWorld(ctx, config);

  // [2/8] 缩小地图（双指捏合）
  ctx.log('  [2/8] 缩小地图');
  await ctx.pinch(
    300, 960, 780, 960,
    500, 960, 580, 960,
    800
  );
  await ctx.sleep(1);

  // [3/8] 螺旋搜索城寨
  ctx.log(`  [3/8] 螺旋搜索 Lv.${targetLevel} 城寨（上限 ${SEARCH_MAX_ATTEMPTS} 次）`);
  let fortFound = false;
  let fortX = 0;
  let fortY = 0;
  let foundLevel = 0;

  const screenX = 540;
  const screenY = 960;

  let attempt = 0;

  for (; attempt < SEARCH_MAX_ATTEMPTS && !fortFound; attempt++) {
    // 截图搜索城寨图标
    const result = await ctx.findImageWithLocation(CHENG_ZHAI_TEMPLATE, 0.7, [0.7, 0.8, 0.9, 1.0, 1.1]);

    if (result.found) {
      fortX = result.x;
      fortY = result.y;
      ctx.log(`  找到城寨图标 (${fortX}, ${fortY}) confidence: ${result.confidence.toFixed(3)}`);

      // [4/8] OCR 识别等级
      const ocrX = fortX - 15;
      const ocrY = fortY + 12;
      const ocrRegionPath = await ctx.captureRegion(ocrX, ocrY, 30, 13);
      const ocrText = await ocrService.readText(ocrRegionPath);
      await fs.unlink(ocrRegionPath).catch(() => {});
      ctx.log(`  [4/8] OCR 识别等级: "${ocrText}" (区域: ${ocrX},${ocrY} 30x13)`);

      // 解析 OCR 结果
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

    if (!fortFound && attempt < SEARCH_MAX_ATTEMPTS - 1) {
      // 螺旋滑动
      const dir = SPIRAL_DIRECTIONS[attempt % 4];
      const armLen = SPIRAL_SWIPE_LENGTH * (Math.floor(attempt / 4) + 1);
      const fromX = screenX;
      const fromY = screenY;
      const toX = screenX + dir.dx * armLen;
      const toY = screenY + dir.dy * armLen;
      ctx.log(`  未找到，滑动 ${dir.dx>0?'→':dir.dx<0?'←':dir.dy>0?'↓':'↑'} ${armLen}px (${attempt + 1}/${SEARCH_MAX_ATTEMPTS})`);
      await ctx.swipe(fromX, fromY, toX, toY, 500);
      await ctx.sleep(1);
    }
  }

  if (!fortFound) {
    ctx.log(`  ❌ 搜索 ${attempt} 次后未找到 Lv.${targetLevel} 城寨`);
    return { result: 'not_found', dispatched: 0 };
  }

  // 点击城寨
  ctx.log(`  点击城寨 (${fortX}, ${fortY})`);
  await ctx.tap(fortX, fortY);
  await ctx.sleep(2);

  // [5/8] 识别并点击集结按钮
  ctx.log('  [5/8] 识别集结按钮');
  const jijieResult = await ctx.findImageWithLocation(JIJIE_TEMPLATE, 0.7);
  if (!jijieResult.found) {
    ctx.log(`  ❌ 未找到集结按钮 (confidence: ${jijieResult.confidence.toFixed(3)})`);
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);
    return { result: 'not_found', dispatched: 0, foundLevel };
  }
  ctx.log(`  点击集结按钮 (${jijieResult.x}, ${jijieResult.y})`);
  await ctx.tap(jijieResult.x, jijieResult.y);
  await ctx.sleep(1.5);

  // [6/8] 确认集结时间
  ctx.log(`  [6/8] 确认集结时间 (${CONFIRM_TIME_BUTTON.x}, ${CONFIRM_TIME_BUTTON.y})`);
  await ctx.tap(CONFIRM_TIME_BUTTON.x, CONFIRM_TIME_BUTTON.y);
  await ctx.sleep(1);

  // [7/8] 选队
  ctx.log(`  [7/8] 点击选择队伍按钮 (${SELECT_TEAM_BUTTON.x}, ${SELECT_TEAM_BUTTON.y})`);
  await ctx.tap(SELECT_TEAM_BUTTON.x, SELECT_TEAM_BUTTON.y);
  await ctx.sleep(1);

  // 检测分页
  const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');
  const hasPaging = await ctx.findImage(PAGE_INDICATOR_TEMPLATE, 0.8);
  ctx.log(`  [检测] 换页按钮: ${hasPaging ? '存在 (>7组)' : '不存在 (≤7组)'}`);

  const teamButtons = hasPaging ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
  const teamBtn = teamButtons[team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${team}`);
    return { result: 'team_unavailable', dispatched: 0, foundLevel };
  }

  ctx.log(`  [8/8] 选择队伍 ${team} 并检测状态变化...`);
  const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
  ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

  if (!stateResult.changed) {
    ctx.log(`  ⚠️ 队伍${team}不可用，按钮无选中状态变化，跳过`);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    return { result: 'team_unavailable', dispatched: 0, foundLevel };
  }

  // 点击行军
  ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
  await ctx.tap(MARCH_BUTTON.x, MARCH_BUTTON.y);
  await ctx.sleep(1);

  ctx.log(`  ✅ 队伍${team} 已发起 Lv.${foundLevel} 城寨集结`);
  return { result: 'success', dispatched: 1, foundLevel };
}
