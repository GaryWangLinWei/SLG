import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fs from 'fs/promises';

const TEMPLATE_DIR = getTemplatesDir();
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');
const STATE_JIJIE_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'state_jijie.png');
const BTN_JOINTEAM_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'btn_jointeam.png');
const ICON_CHENGZHAI_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'icon_jijie_chengzhai.png');
const ICON_LOHA_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'icon_jijie_luoha.png');
const BTN_BIANDUI_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'btn_biandui.png');

const CLOSE_POPUP_BUTTON = { x: 1395, y: 56 };

const SORT_SETTINGS_BUTTON = { x: 386, y: 137 };
const SORT_BY_DISTANCE_BUTTON = { x: 378, y: 230 };

const RALLY_STATE_REGION = { x: 1198, y: 659, width: 1588 - 1198, height: 771 - 659 };

const RALLY_COLUMNS = [
  {
    distance: { x: 216, y: 207, width: 320 - 216, height: 240 - 207 },
    joinBtn: { x: 1086, y: 322, width: 1138 - 1086, height: 374 - 322 },
    target: { x: 1219, y: 198, width: 1373 - 1219, height: 348 - 198 },
  },
  {
    distance: { x: 216, y: 441, width: 320 - 216, height: 468 - 441 },
    joinBtn: { x: 1086, y: 552, width: 1138 - 1086, height: 605 - 552 },
    target: { x: 1219, y: 429, width: 1373 - 1219, height: 579 - 429 },
  },
  {
    distance: { x: 216, y: 669, width: 320 - 216, height: 698 - 669 },
    joinBtn: { x: 1086, y: 781, width: 1138 - 1086, height: 834 - 781 },
    target: { x: 1219, y: 660, width: 1373 - 1219, height: 807 - 660 },
  },
];

const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 362 }, 2: { x: 1378, y: 430 },
  3: { x: 1378, y: 497 }, 4: { x: 1378, y: 566 }, 5: { x: 1378, y: 633 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 397 }, 2: { x: 1378, y: 463 },
  3: { x: 1378, y: 533 }, 4: { x: 1378, y: 600 }, 5: { x: 1378, y: 671 },
};
const MARCH_BUTTON = { x: 1154, y: 791 };
const MARCH_BUTTON_RECT = { x1: 1031, y1: 754, x2: 1292, y2: 820 };

export interface JoinRallyOutcome {
  result: 'success' | 'no_idle_teams' | 'no_rally_state' | 'no_joinable' | 'distance_exceed' | 'team_unavailable' | 'no_biandui';
  joined: number;
  targetType?: 'fort' | 'lohar';
  distance?: number;
}

export async function joinRally(
  ctx: PluginContext,
  config: RokConfig,
  params: {
    team: number;
    teamPage: TeamPage;
    targetFort: boolean;
    targetLohar: boolean;
    maxDistance: number;
    firstRun?: boolean;
  }
): Promise<JoinRallyOutcome> {
  ctx.log(`=== 加入集结 队伍${params.team} 最大距离${params.maxDistance}公里 ===`);

  const isFirstRun = params.firstRun ?? true;

  // [1/6] 检测空闲队伍
  ctx.log('  [1/6] OCR 检测空闲队伍数...');
  const regionPath = await ctx.captureRegion(1507, 169, 55, 31);
  const teamCountText = await ocrService.readText(regionPath);
  await fs.unlink(regionPath).catch(() => {});
  ctx.log(`  OCR 结果: "${teamCountText}"`);

  const match = teamCountText.match(/(\d+)\s*\/\s*(\d+)/);
  if (match) {
    const used = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);
    if (used === total) {
      ctx.log(`⏭️ 无空闲队伍 (${used}/${total})，结束`);
      return { result: 'no_idle_teams', joined: 0 };
    }
    ctx.log(`  有空闲队伍 (${used}/${total})，继续`);
  } else {
    const digitsOnly = teamCountText.replace(/\D/g, '');
    if (digitsOnly.length >= 2 && /^(\d)\1+$/.test(digitsOnly)) {
      ctx.log(`⏭️ 无空闲队伍 (OCR识别为 "${digitsOnly}"，推测全部忙碌)，结束`);
      return { result: 'no_idle_teams', joined: 0 };
    }
    ctx.log('  未识别到队伍计数，继续');
  }

  // [2/6] 检测集结状态
  ctx.log('  [2/6] 检测集结状态...');
  const stateResult = await ctx.findImageWithLocation(STATE_JIJIE_TEMPLATE, 0.7, undefined, false, undefined, RALLY_STATE_REGION);
  if (!stateResult.found) {
    ctx.log('  未检测到集结状态，结束');
    return { result: 'no_rally_state', joined: 0 };
  }
  ctx.log(`  检测到集结状态 (${stateResult.x}, ${stateResult.y})，点击打开集结面板`);
  await ctx.tap(stateResult.x, stateResult.y);
  await ctx.sleep(1.5);

  // [3/6] 首次运行：按距离排序
  if (isFirstRun) {
    ctx.log('  [3/6] 首次运行：设置按距离排序');
    await ctx.tap(SORT_SETTINGS_BUTTON.x, SORT_SETTINGS_BUTTON.y);
    await ctx.sleep(1);
    await ctx.tap(SORT_BY_DISTANCE_BUTTON.x, SORT_BY_DISTANCE_BUTTON.y);
    await ctx.sleep(0.5);
  } else {
    ctx.log('  [3/6] 非首次运行：跳过排序设置');
  }

  // [4/6] 遍历三栏识别可加入的集结
  ctx.log('  [4/6] 遍历三栏识别可加入的集结...');
  let selectedColumnIndex = -1;
  let detectedDistance = 0;
  let detectedTarget: 'fort' | 'lohar' | null = null;

  for (let i = 0; i < RALLY_COLUMNS.length; i++) {
    const col = RALLY_COLUMNS[i];
    ctx.log(`  检查第 ${i + 1} 栏...`);

    const joinBtnResult = await ctx.findImageWithLocation(
      BTN_JOINTEAM_TEMPLATE, 0.8, undefined, false, undefined,
      { x: col.joinBtn.x, y: col.joinBtn.y, width: col.joinBtn.width, height: col.joinBtn.height }
    );
    if (!joinBtnResult.found) {
      ctx.log(`    第 ${i + 1} 栏：无可加入按钮，跳过`);
      continue;
    }
    ctx.log(`    第 ${i + 1} 栏：检测到可加入按钮`);

    const fortResult = await ctx.findImageWithLocation(
      ICON_CHENGZHAI_TEMPLATE, 0.8, undefined, false, undefined,
      { x: col.target.x, y: col.target.y, width: col.target.width, height: col.target.height }
    );
    const loharResult = await ctx.findImageWithLocation(
      ICON_LOHA_TEMPLATE, 0.8, undefined, false, undefined,
      { x: col.target.x, y: col.target.y, width: col.target.width, height: col.target.height }
    );

    let currentTarget: 'fort' | 'lohar' | null = null;
    if (fortResult.found) {
      currentTarget = 'fort';
      ctx.log(`    检测到城寨集结`);
    } else if (loharResult.found) {
      currentTarget = 'lohar';
      ctx.log(`    检测到洛哈集结`);
    } else {
      ctx.log(`    未识别到目标类型，跳过`);
      continue;
    }

    if (currentTarget === 'fort' && !params.targetFort) {
      ctx.log(`    城寨不在勾选目标中，跳过`);
      continue;
    }
    if (currentTarget === 'lohar' && !params.targetLohar) {
      ctx.log(`    洛哈不在勾选目标中，跳过`);
      continue;
    }

    const distPath = await ctx.captureRegion(col.distance.x, col.distance.y, col.distance.width, col.distance.height);
    const distText = await ocrService.readText(distPath);
    await fs.unlink(distPath).catch(() => {});
    ctx.log(`    距离 OCR: "${distText}"`);

    const distMatch = distText.match(/(\d+)/);
    if (!distMatch) {
      ctx.log(`    未能识别距离数字，跳过`);
      continue;
    }

    const distance = parseInt(distMatch[1], 10);
    ctx.log(`    识别距离: ${distance} 公里`);

    if (distance > params.maxDistance) {
      ctx.log(`    距离 ${distance} > 最大设置 ${params.maxDistance}，关闭面板结束`);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      return { result: 'distance_exceed', joined: 0, targetType: currentTarget, distance };
    }

    ctx.log(`    符合条件：${currentTarget === 'fort' ? '城寨' : '洛哈'} ${distance}公里，点击加入`);
    await ctx.tap(joinBtnResult.x, joinBtnResult.y);
    await ctx.sleep(1);

    selectedColumnIndex = i;
    detectedDistance = distance;
    detectedTarget = currentTarget;
    break;
  }

  if (selectedColumnIndex === -1) {
    ctx.log('  三栏均无可加入的集结，结束');
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    return { result: 'no_joinable', joined: 0 };
  }

  // [5/6] 识别编队按钮
  ctx.log('  [5/6] 识别编队按钮...');
  const bianduiResult = await ctx.findImageWithLocation(
    BTN_BIANDUI_TEMPLATE, 0.8, undefined, false, undefined,
    { x: 1123, y: 130, width: 1400 - 1123, height: 240 - 130 }
  );
  if (!bianduiResult.found) {
    ctx.log('  未检测到编队按钮，无可派遣队伍');
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    return { result: 'no_biandui', joined: 0, targetType: detectedTarget!, distance: detectedDistance };
  }
  ctx.log(`  点击编队按钮 (${bianduiResult.x}, ${bianduiResult.y})`);
  await ctx.tap(bianduiResult.x, bianduiResult.y);
  await ctx.sleep(1);

  // [6/6] 选择队伍并行军（复用 rallyFort 逻辑）
  ctx.log('  [6/6] 选择队伍并行军...');

  const pageResult = await ctx.findImageWithLocation(PAGE_INDICATOR_TEMPLATE, 0.8);
  const hasPaging = pageResult.found;
  if (hasPaging) {
    ctx.log(`  换页按钮: 存在 (>7组) @ (${pageResult.x},${pageResult.y})`);
  } else {
    ctx.log(`  换页按钮: 不存在 (≤7组)`);
  }

  if (hasPaging) {
    const onTargetPage = await ensureTeamPage(
      ctx,
      params.teamPage,
      { x: pageResult.x, y: pageResult.y },
      { x: 1361, y: 378, w: 36, h: 35 }
    );
    if (!onTargetPage) {
      ctx.log(`  ⚠️ 未能切换到目标队伍页`);
      return { result: 'team_unavailable', joined: 0, targetType: detectedTarget!, distance: detectedDistance };
    }
  }

  const teamButtons = hasPaging ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
  const teamBtn = teamButtons[params.team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${params.team}`);
    return { result: 'team_unavailable', joined: 0, targetType: detectedTarget!, distance: detectedDistance };
  }

  ctx.log(`  选择队伍 ${params.team} (${teamBtn.x}, ${teamBtn.y})`);
  const stateResult2 = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
  ctx.log(`  像素变化率: ${(stateResult2.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult2.changed}`);

  if (!stateResult2.changed) {
    ctx.log(`  ⚠️ 队伍${params.team}不可用，按钮无选中状态变化`);
    return { result: 'team_unavailable', joined: 0, targetType: detectedTarget!, distance: detectedDistance };
  }

  await ctx.sleep(0.5);
  ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
  await ctx.tapRect(MARCH_BUTTON_RECT.x1, MARCH_BUTTON_RECT.y1, MARCH_BUTTON_RECT.x2, MARCH_BUTTON_RECT.y2);
  await ctx.sleep(1);

  ctx.log(`  ✅ 成功加入${detectedTarget === 'fort' ? '城寨' : '洛哈'}集结 (${detectedDistance}公里)`);
  return { result: 'success', joined: 1, targetType: detectedTarget!, distance: detectedDistance };
}
