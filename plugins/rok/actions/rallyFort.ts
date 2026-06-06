import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import * as path from 'path';

const TEMPLATE_DIR = getTemplatesDir();
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');

// 队伍选择坐标（集结界面，与采集界面坐标不同）
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
const CONFIRM_TIME_BUTTON = { x: 1177, y: 396 };

export interface RallyFortOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;
  foundLevel?: number;
}

export async function rallyFort(
  ctx: PluginContext,
  config: RokConfig,
  targetLevel: number,
  team: number,
  downgrade: boolean = true
): Promise<RallyFortOutcome> {
  ctx.log(`=== 自动攻打城寨 Lv.${targetLevel} 队伍${team} ===`);

  const fs = config.fortSearch;
  const worldBtn = config.resourceCollect.worldSwitchButton;

  // [1/7] 确保在城外
  ctx.log('  [1/7] 确保在城外');
  await ensureInWorld(ctx, config);

  // [2/7] 打开搜索面板
  ctx.log(`  [2/7] 打开搜索面板 (${fs.searchButton.x}, ${fs.searchButton.y})`);
  await ctx.tap(fs.searchButton.x, fs.searchButton.y);
  await ctx.sleep(1.5);

  // [3/7] 切换到城寨页签
  ctx.log(`  [3/7] 切换到城寨页签 (${fs.fortTab.x}, ${fs.fortTab.y})`);
  await ctx.tap(fs.fortTab.x, fs.fortTab.y);
  await ctx.sleep(1);

  // [4/7] 设置等级并搜索
  ctx.log(`  [4/7] 设置等级并搜索`);

  // 重置到 1 级：快速点击 - ×9
  ctx.log(`  重置到1级: 快速点击 - ×9`);
  for (let i = 0; i < 9; i++) {
    await ctx.tap(fs.minusButton.x, fs.minusButton.y);
    await ctx.sleep(0.15);
  }

  // 设到目标等级
  let currentLevel = 1;
  let searchSuccess = false;

  const plusClicks = targetLevel - 1;
  if (plusClicks > 0) {
    ctx.log(`  设置 Lv.${targetLevel}: + ×${plusClicks}`);
    for (let i = 0; i < plusClicks; i++) {
      await ctx.tap(fs.plusButton.x, fs.plusButton.y);
      await ctx.sleep(0.15);
    }
  }
  currentLevel = targetLevel;

  // 搜索 + 降级重试
  while (currentLevel >= 1) {
    ctx.log(`  搜索 Lv.${currentLevel} (${fs.searchActionButton.x}, ${fs.searchActionButton.y})`);
    const stateResult = await ctx.checkButtonStateChange(
      fs.searchActionButton.x, fs.searchActionButton.y, 100, 40, 0.05
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
      await ctx.tap(fs.minusButton.x, fs.minusButton.y);
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
    await ctx.tap(worldBtn.x, worldBtn.y);
    await ctx.sleep(1);
    await ctx.tap(worldBtn.x, worldBtn.y);
    await ctx.sleep(2);
    return { result: 'not_found', dispatched: 0 };
  }

  await ctx.sleep(2.5);

  // [5/7] 点击集结按钮
  ctx.log(`  [5/7] 点击集结按钮 (${fs.rallyButton.x}, ${fs.rallyButton.y})`);
  await ctx.tap(fs.rallyButton.x, fs.rallyButton.y);
  await ctx.sleep(1.5);

  // [6/7] 确认集结时间
  ctx.log(`  [6/7] 确认集结时间 (${CONFIRM_TIME_BUTTON.x}, ${CONFIRM_TIME_BUTTON.y})`);
  await ctx.tap(CONFIRM_TIME_BUTTON.x, CONFIRM_TIME_BUTTON.y);
  await ctx.sleep(1);

  // 检测分页
  const hasPaging = await ctx.findImage(PAGE_INDICATOR_TEMPLATE, 0.8);
  ctx.log(`  [检测] 换页按钮: ${hasPaging ? '存在 (>7组)' : '不存在 (≤7组)'}`);

  const teamButtons = hasPaging ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
  const teamBtn = teamButtons[team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${team}`);
    return { result: 'team_unavailable', dispatched: 0, foundLevel: currentLevel };
  }

  // [7/7] 选择队伍并检测状态变化
  ctx.log(`  [7/7] 选择队伍 ${team} 并检测状态变化...`);
  const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
  ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

  if (!stateResult.changed) {
    ctx.log(`  ⚠️ 队伍${team}不可用，按钮无选中状态变化，跳过`);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    return { result: 'team_unavailable', dispatched: 0, foundLevel: currentLevel };
  }

  // 点击行军
  await ctx.sleep(0.5);
  ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
  await ctx.tap(MARCH_BUTTON.x, MARCH_BUTTON.y);
  await ctx.sleep(1);

  ctx.log(`  ✅ 队伍${team} 已发起 Lv.${currentLevel} 城寨集结`);
  return { result: 'success', dispatched: 1, foundLevel: currentLevel };
}
