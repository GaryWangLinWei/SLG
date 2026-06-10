import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

const TEMPLATE_DIR = getTemplatesDir();
const ADD_TEAM_BTN_TEMPLATE = path.join(TEMPLATE_DIR, 'AddTeamBtn.png');
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');

// 队伍选择坐标（复用 gatherResources）
const SELECT_TEAM_BUTTON = { x: 1259, y: 180 };
const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 292 },
  2: { x: 1378, y: 359 },
  3: { x: 1378, y: 430 },
  4: { x: 1378, y: 499 },
  5: { x: 1378, y: 565 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 328 },
  2: { x: 1378, y: 392 },
  3: { x: 1378, y: 465 },
  4: { x: 1378, y: 529 },
  5: { x: 1378, y: 595 },
};
const MARCH_BUTTON = { x: 1154, y: 791 };

const SPIRAL_DIRECTIONS = [
  { dx: 1, dy: 0 },   // 右
  { dx: 0, dy: 1 },   // 下
  { dx: -1, dy: 0 },  // 左
  { dx: 0, dy: -1 },  // 上
];

export interface GemGatherOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;
}

async function dispatchGemTeam(
  ctx: PluginContext,
  team: number,
  hasPaging: boolean
): Promise<'success' | 'team_unavailable'> {
  // 点击选择队伍按钮
  ctx.log(`  点击选择队伍按钮 (${SELECT_TEAM_BUTTON.x}, ${SELECT_TEAM_BUTTON.y})`);
  await ctx.tap(SELECT_TEAM_BUTTON.x, SELECT_TEAM_BUTTON.y);
  await ctx.sleep(1);

  const teamButtons = hasPaging ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
  const teamBtn = teamButtons[team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${team}`);
    return 'team_unavailable';
  }

  ctx.log(`  选择队伍 ${team} 并检测状态变化...`);
  const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
  ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

  if (!stateResult.changed) {
    ctx.log(`  ⚠️ 队伍${team}不可用，按钮无选中状态变化，跳过`);
    return 'team_unavailable';
  }

  // 点击行军
  await ctx.sleep(0.5);
  ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
  await ctx.tap(MARCH_BUTTON.x, MARCH_BUTTON.y);
  await ctx.sleep(1);

  ctx.log(`  ✅ 队伍${team} 已派出采集宝石矿`);
  return 'success';
}

export async function gatherGem(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[]
): Promise<GemGatherOutcome> {
  ctx.log(`=== 智能采集宝石 队伍[${teams.join(', ')}] ===`);

  const gg = config.gemGather;
  const caijiBtnTemplate = path.join(TEMPLATE_DIR, gg.caijiBtnTemplate);
  const worldBtn = config.resourceCollect.worldSwitchButton;

  let dispatched = 0;

  for (let teamIdx = 0; teamIdx < teams.length; teamIdx++) {
    const team = teams[teamIdx];
    ctx.log(`--- 派队伍 ${team} (第${teamIdx + 1}/${teams.length}颗矿) ---`);

    // [1/7] 重置城外默认视角
    ctx.log('  [1/7] 重置城外默认视角');
    await ensureInWorld(ctx, config);

    // [2/7] 缩小地图
    ctx.log('  [2/7] 缩小地图');
    const p = gg.pinch;
    await ctx.pinch(p.from1.x, p.from1.y, p.from2.x, p.from2.y, p.to1.x, p.to1.y, p.to2.x, p.to2.y, p.duration);
    await ctx.sleep(1);

    // [3/7] 螺旋搜索宝石矿（YOLO 单次推理 <1s）
    ctx.log(`  [3/7] 螺旋搜索宝石矿（YOLO 检测, 上限 ${gg.searchMaxAttempts} 次）`);
    let gemFound = false;
    let gemX = 0;
    let gemY = 0;
    let curX = gg.spiralCenterX;
    let curY = gg.spiralCenterY;

    for (let attempt = 0; attempt < gg.searchMaxAttempts && !gemFound; attempt++) {
      // YOLO 检测（单次推理 <1s，替代 3 模板 × 3 尺度并行模板匹配）
      const detections = await ctx.detectWithScreenshot(0.5);
      ctx.log(`  [搜索] 找到 ${detections.length} 个宝石候选`);

      if (detections.length > 0) {
        // 排除聊天窗口区域 (0,794)-(814,900)，取第一个不在聊天区的检出
        const validDet = detections.find(
          d => !(d.x >= 0 && d.x <= 814 && d.y >= 794 && d.y <= 900)
        );
        if (validDet) {
          gemX = validDet.x;
          gemY = validDet.y;
          ctx.log(`  找到宝石矿 (${gemX}, ${gemY}) confidence: ${validDet.confidence.toFixed(3)}`);
          gemFound = true;
        } else {
          ctx.log(`  所有检出均在聊天窗口区域，跳过本次截图`);
        }
      } else if (attempt < gg.searchMaxAttempts - 1) {
        // 接续螺旋：从上次终点继续往外滑，每次滑约 0.8 屏
        const dir = SPIRAL_DIRECTIONS[attempt % 4];
        const baseLen = dir.dx !== 0
          ? Math.round(1600 * gg.spiralSwipeRatio)   // 横向 1280px
          : Math.round(900 * gg.spiralSwipeRatio);   // 竖向 720px
        const armLen = baseLen * (Math.floor(attempt / 4) + 1);
        const toX = curX + dir.dx * armLen;
        const toY = curY + dir.dy * armLen;
        ctx.log(`  未找到，滑动 ${dir.dx > 0 ? '→' : dir.dx < 0 ? '←' : dir.dy > 0 ? '↓' : '↑'} ${armLen}px (${attempt + 1}/${gg.searchMaxAttempts})`);
        await ctx.swipe(curX, curY, toX, toY, 500);
        curX = toX;
        curY = toY;
        await ctx.sleep(1);
      }
    }

    if (!gemFound) {
      ctx.log(`  ❌ 搜索 ${gg.searchMaxAttempts} 次后未找到宝石矿，停止后续队伍`);
      break;
    }

    // [4/7] 点击宝石矿
    ctx.log(`  [4/7] 点击宝石矿 (${gemX}, ${gemY})`);
    await ctx.tap(gemX, gemY);
    await ctx.sleep(1.5);

    // 点击放大后的宝石矿
    ctx.log(`  点击放大后的目标 (${gg.pinchedGemTapPoint.x}, ${gg.pinchedGemTapPoint.y})`);
    await ctx.tap(gg.pinchedGemTapPoint.x, gg.pinchedGemTapPoint.y);
    await ctx.sleep(1);

    // 识别采集按钮
    ctx.log(`  搜索采集按钮 ${gg.caijiBtnTemplate}`);
    const caijiResult = await ctx.findImageWithLocation(caijiBtnTemplate, 0.7);
    if (!caijiResult.found) {
      ctx.log(`  ❌ 未找到采集按钮 (confidence: ${caijiResult.confidence.toFixed(3)})，跳过`);
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(1.5);
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(2);
      continue;
    }
    ctx.log(`  点击采集按钮 (${caijiResult.x}, ${caijiResult.y})`);
    await ctx.tap(caijiResult.x, caijiResult.y);
    await ctx.sleep(1.5);

    // [5/7] 检测空闲队伍
    ctx.log(`  [5/7] 检测是否有空闲队伍...`);
    const { width: addTeamW = 80, height: addTeamH = 80 } = await sharp(ADD_TEAM_BTN_TEMPLATE).metadata();
    const addTeamRegionX = 1517 - Math.floor(addTeamW! / 2);
    const addTeamRegionY = 130 - Math.floor(addTeamH! / 2);
    const addTeamRegionPath = await ctx.captureRegion(addTeamRegionX, addTeamRegionY, addTeamW!, addTeamH!);
    const addTeamDiff = await ctx.compareImages(addTeamRegionPath, ADD_TEAM_BTN_TEMPLATE);
    ctx.log(`  AddTeamBtn 匹对差异: ${(addTeamDiff * 100).toFixed(1)}%`);

    if (addTeamDiff >= 0.3) {
      ctx.log(`  ⚠️ 没有空闲队伍，停止采集，切换回城内`);
      await fs.unlink(addTeamRegionPath).catch(() => {});
      await ctx.tap(worldBtn.x, worldBtn.y);
      await ctx.sleep(2);
      break;
    }
    await fs.unlink(addTeamRegionPath).catch(() => {});
    ctx.log(`  有空闲队伍，继续`);

    // [6/7] 检测分页
    const hasPaging = await ctx.findImage(PAGE_INDICATOR_TEMPLATE, 0.8);
    ctx.log(`  [6/7] 换页按钮: ${hasPaging ? '存在 (>7组)' : '不存在 (≤7组)'}`);

    // [7/7] 选择队伍 + 行军
    ctx.log(`  [7/7] 选择队伍 ${team} 并派出`);
    const outcome = await dispatchGemTeam(ctx, team, hasPaging);
    if (outcome === 'success') {
      dispatched++;
      ctx.log(`  ✅ 队伍${team} 已派出采集宝石矿（累计 ${dispatched} 队）`);
    } else {
      ctx.log(`  ⚠️ 队伍${team} 不可用，跳过`);
    }
  }

  ctx.log(`=== 宝石采集完成：派出 ${dispatched} 队 ===`);
  return { result: dispatched > 0 ? 'success' : 'not_found', dispatched };
}
