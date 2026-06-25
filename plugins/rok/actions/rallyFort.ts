import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';
import * as path from 'path';

const TEMPLATE_DIR = getTemplatesDir();
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');

// 队伍选择坐标（集结界面，与采集界面坐标不同）
const SELECT_TEAM_BUTTON = { x: 1259, y: 180 };
const WORLD_SWITCH_BUTTON_RECT = { x1: 39, y1: 776, x2: 115, y2: 858 };
const SEARCH_ENTRY_RECT = { x1: 42, y1: 645, x2: 110, y2: 704 };
const BARBARIAN_BUTTON_RECT = { x1: 269, y1: 749, x2: 370, y2: 844 };
const FORT_TAB_RECT = { x1: 347, y1: 276, x2: 576, y2: 313 };
const FORT_MINUS_RECT = { x1: 102, y1: 467, x2: 137, y2: 501 };
const FORT_PLUS_RECT = { x1: 539, y1: 467, x2: 576, y2: 501 };
const FORT_SEARCH_ACTION_RECT = { x1: 244, y1: 561, x2: 436, y2: 626 };
const RALLY_BUTTON_RECT = { x1: 1053, y1: 584, x2: 1280, y2: 649 };
const CONFIRM_TIME_BUTTON_RECT = { x1: 1062, y1: 359, x2: 1289, y2: 422 };
const MARCH_BUTTON_RECT = { x1: 1031, y1: 754, x2: 1292, y2: 820 };
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
const TILI_BUTTON_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_tili.png');
const TILI_BUTTON_REGION = { x: 1014, y: 242, width: 1358 - 1014, height: 407 - 242 };

export interface RallyFortOutcome {
  result: 'success' | 'not_found' | 'team_unavailable' | 'rally_full' | 'stamina_insufficient';
  dispatched: number;
  foundLevel?: number;
}

export async function rallyFort(
  ctx: PluginContext,
  config: RokConfig,
  targetLevel: number,
  team: number,
  downgrade: boolean = true,
  teamPage: TeamPage = 'attack'
): Promise<RallyFortOutcome> {
  ctx.log(`=== 自动攻打城寨 Lv.${targetLevel} 队伍${team} ===`);

  const fs = config.fortSearch;
  const worldBtn = config.resourceCollect.worldSwitchButton;

  // [1/8] 确保在城外
  ctx.log('  [1/8] 确保在城外');
  await ensureInWorld(ctx, config);

  // [2/8] 打开搜索面板
  ctx.log(`  [2/8] 打开搜索面板 (${fs.searchButton.x}, ${fs.searchButton.y})`);
  await ctx.tapRect(SEARCH_ENTRY_RECT.x1, SEARCH_ENTRY_RECT.y1, SEARCH_ENTRY_RECT.x2, SEARCH_ENTRY_RECT.y2);
  await ctx.sleep(1.5);

  // [3/8] 选择野蛮人
  ctx.log(`  [3/8] 选择野蛮人 (${fs.barbarianButton.x}, ${fs.barbarianButton.y})`);
  await ctx.tapRect(BARBARIAN_BUTTON_RECT.x1, BARBARIAN_BUTTON_RECT.y1, BARBARIAN_BUTTON_RECT.x2, BARBARIAN_BUTTON_RECT.y2);
  await ctx.sleep(1);

  // [4/8] 切换到城寨页签
  ctx.log(`  [4/8] 切换到城寨页签 (${fs.fortTab.x}, ${fs.fortTab.y})`);
  await ctx.tapRect(FORT_TAB_RECT.x1, FORT_TAB_RECT.y1, FORT_TAB_RECT.x2, FORT_TAB_RECT.y2);
  await ctx.sleep(1);

  // [5/8] 设置等级并搜索
  ctx.log(`  [5/8] 设置等级并搜索`);

  // 重置到 1 级：快速点击 - ×9
  ctx.log(`  重置到1级: 快速点击 - ×9`);
  for (let i = 0; i < 9; i++) {
    await ctx.tapRect(FORT_MINUS_RECT.x1, FORT_MINUS_RECT.y1, FORT_MINUS_RECT.x2, FORT_MINUS_RECT.y2);
    await ctx.sleep(0.15);
  }

  // 设到目标等级
  let currentLevel = 1;
  let searchSuccess = false;

  const plusClicks = targetLevel - 1;
  if (plusClicks > 0) {
    ctx.log(`  设置 Lv.${targetLevel}: + ×${plusClicks}`);
    for (let i = 0; i < plusClicks; i++) {
      await ctx.tapRect(FORT_PLUS_RECT.x1, FORT_PLUS_RECT.y1, FORT_PLUS_RECT.x2, FORT_PLUS_RECT.y2);
      await ctx.sleep(0.15);
    }
  }
  currentLevel = targetLevel;

  // 搜索 + 降级重试
  while (currentLevel >= 1) {
    ctx.log(`  搜索 Lv.${currentLevel} (${fs.searchActionButton.x}, ${fs.searchActionButton.y})`);
    const stateResult = await ctx.checkButtonStateChangeRect(
      FORT_SEARCH_ACTION_RECT.x1, FORT_SEARCH_ACTION_RECT.y1,
      FORT_SEARCH_ACTION_RECT.x2, FORT_SEARCH_ACTION_RECT.y2,
      0.05
    );

    if (stateResult.changed) {
      if (currentLevel < targetLevel) {
        ctx.log(`  Lv.${targetLevel} 未搜索到，降级至 Lv.${currentLevel} 搜索成功`);
      }
      searchSuccess = true;
      break;
    }

    if (downgrade && currentLevel > 1) {
      ctx.log(`  Lv.${currentLevel} 未搜索到，降级重试...`);
      await ctx.tapRect(FORT_MINUS_RECT.x1, FORT_MINUS_RECT.y1, FORT_MINUS_RECT.x2, FORT_MINUS_RECT.y2);
      await ctx.sleep(0.15);
      currentLevel--;
    } else {
      break;
    }
  }

  if (!searchSuccess) {
    ctx.log(`  ❌ 未搜索到 Lv.${targetLevel} 城寨`);
    // 点击2次切换按钮：第1次退出搜索面板，第2次回到城内
    ctx.log(`  退出搜索面板并返回城内`);
    await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
    await ctx.sleep(1);
    await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
    await ctx.sleep(2);
    return { result: 'not_found', dispatched: 0 };
  }

  await ctx.sleep(2.5);

  // [6/8] 点击集结按钮并检测
  ctx.log(`  [6/8] 点击集结按钮并检测 (${fs.rallyButton.x}, ${fs.rallyButton.y})`);
  const rallyResult = await ctx.checkButtonStateChangeRect(
    RALLY_BUTTON_RECT.x1, RALLY_BUTTON_RECT.y1,
    RALLY_BUTTON_RECT.x2, RALLY_BUTTON_RECT.y2,
    0.05
  );
  if (!rallyResult.changed) {
    ctx.log(`  ⚠️ 集结按钮无变化，队伍已满`);
    await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
    await ctx.sleep(2);
    return { result: 'rally_full', dispatched: 0, foundLevel: currentLevel };
  }
  await ctx.sleep(1.5);

  // [7/8] 确认集结时间
  ctx.log(`  [7/8] 确认集结时间 (${CONFIRM_TIME_BUTTON.x}, ${CONFIRM_TIME_BUTTON.y})`);
  await ctx.tapRect(CONFIRM_TIME_BUTTON_RECT.x1, CONFIRM_TIME_BUTTON_RECT.y1, CONFIRM_TIME_BUTTON_RECT.x2, CONFIRM_TIME_BUTTON_RECT.y2);
  await ctx.sleep(1);

  // 检测分页 + 拿到换页按钮坐标
  const pageResult = await ctx.findImageWithLocation(PAGE_INDICATOR_TEMPLATE, 0.8);
  const hasPaging = pageResult.found;
  if (hasPaging) {
    ctx.log(`  [检测] 换页按钮: 存在 (>7组) @ (${pageResult.x},${pageResult.y})`);
  } else {
    ctx.log(`  [检测] 换页按钮: 不存在 (≤7组)`);
  }

  // 如有换页按钮，确保在目标队伍页
  // rallyFort 弹窗的部队页指示器位于 (1361,378)-(1397,413)
  if (hasPaging) {
    const onTargetPage = await ensureTeamPage(
      ctx,
      teamPage,
      { x: pageResult.x, y: pageResult.y },
      { x: 1361, y: 378, w: 36, h: 35 }
    );
    if (!onTargetPage) {
      ctx.log(`  ⚠️ 未能切换到目标队伍页`);
      return { result: 'team_unavailable', dispatched: 0, foundLevel: currentLevel };
    }
  }

  const teamButtons = hasPaging ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
  const teamBtn = teamButtons[team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${team}`);
    return { result: 'team_unavailable', dispatched: 0, foundLevel: currentLevel };
  }

  // [8/8] 选择队伍并检测状态变化
  ctx.log(`  [8/8] 选择队伍 ${team} 并检测状态变化...`);
  const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
  ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

  if (!stateResult.changed) {
    ctx.log(`  ⚠️ 队伍${team}不可用，按钮无选中状态变化，跳过`);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    return { result: 'team_unavailable', dispatched: 0, foundLevel: currentLevel };
  }

  // 点击行军；若弹出行动力不足且存在免费体力，领取后重试一次
  for (let marchAttempt = 1; marchAttempt <= 2; marchAttempt++) {
    await ctx.sleep(0.5);
    ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})${marchAttempt > 1 ? '（领取体力后重试）' : ''}`);
    await ctx.tapRect(MARCH_BUTTON_RECT.x1, MARCH_BUTTON_RECT.y1, MARCH_BUTTON_RECT.x2, MARCH_BUTTON_RECT.y2);
    await ctx.sleep(1);

    // 检测行动力不足弹窗：城内外切换按钮不可见则认为被弹窗遮挡
    const switchCityResult = await ctx.findImageWithLocation(SWITCH_IN_CITY_TEMPLATE, 0.7);
    const switchWorldResult = await ctx.findImageWithLocation(SWITCH_IN_WORLD_TEMPLATE, 0.7);
    ctx.log(`  切换按钮: city=${switchCityResult.found ? switchCityResult.confidence.toFixed(3) : 'not found'}, world=${switchWorldResult.found ? switchWorldResult.confidence.toFixed(3) : 'not found'}`);
    const isStaminaInsufficient = !switchCityResult.found && !switchWorldResult.found;
    if (!isStaminaInsufficient) {
      ctx.log(`  ✅ 队伍${team} 已发起 Lv.${currentLevel} 城寨集结`);
      return { result: 'success', dispatched: 1, foundLevel: currentLevel };
    }

    ctx.log(`  ⚠️ 切换按钮不可见 → 行动力不足弹窗`);

    if (marchAttempt === 1) {
      const tiliButton = await ctx.findImageWithLocation(TILI_BUTTON_TEMPLATE, 0.8, [0.9, 1.0, 1.1], false, undefined, TILI_BUTTON_REGION);
      ctx.log(`  [体力] 免费体力按钮: found=${tiliButton.found} conf=${tiliButton.confidence.toFixed(3)}`);
      if (tiliButton.found) {
        ctx.log(`  [体力] 领取免费体力 (${tiliButton.x}, ${tiliButton.y})`);
        await ctx.tap(tiliButton.x, tiliButton.y);
        await ctx.sleep(0.8);
        await ctx.tap(1363, 103);  // 关闭行动力不足弹窗
        await ctx.sleep(0.8);
        continue;
      }
    }

    await ctx.tap(1363, 103);  // 关闭行动力不足弹窗
    await ctx.sleep(0.5);
    await ctx.tap(CLOSE_TEAM_PANEL_BUTTON.x, CLOSE_TEAM_PANEL_BUTTON.y);  // 关闭队伍面板
    await ctx.sleep(0.5);
    await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);  // 切换到城内
    await ctx.sleep(2);
    return { result: 'stamina_insufficient', dispatched: 0, foundLevel: currentLevel };
  }

  return { result: 'stamina_insufficient', dispatched: 0, foundLevel: currentLevel };
}
