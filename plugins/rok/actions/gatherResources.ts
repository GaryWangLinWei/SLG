import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';
import { ensureInWorld } from '../utils/location';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';

const TEMPLATE_DIR = getTemplatesDir();
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');
const ADD_TEAM_BTN_TEMPLATE = path.join(TEMPLATE_DIR, 'AddTeamBtn.png');

export interface GatherTask {
  type: string;
  level: number;
  team: number;
}

const SELECT_TEAM_BUTTON = { x: 1259, y: 180 };
const WORLD_SWITCH_BUTTON_RECT = { x1: 39, y1: 776, x2: 115, y2: 858 };
const SEARCH_ENTRY_RECT = { x1: 42, y1: 645, x2: 110, y2: 704 };
const GATHER_BUTTON_RECT = { x1: 1053, y1: 584, x2: 1280, y2: 649 };
const SELECT_TEAM_BUTTON_RECT = { x1: 1154, y1: 151, x2: 1373, y2: 214 };
const MARCH_BUTTON_RECT = { x1: 1031, y1: 754, x2: 1292, y2: 820 };
const RESOURCE_BUTTON_RECTS: Record<string, {
  minus: { x1: number; y1: number; x2: number; y2: number };
  plus: { x1: number; y1: number; x2: number; y2: number };
  search: { x1: number; y1: number; x2: number; y2: number };
}> = {
  '农田': {
    minus: { x1: 370, y1: 512, x2: 397, y2: 536 },
    plus: { x1: 722, y1: 512, x2: 750, y2: 536 },
    search: { x1: 483, y1: 583, x2: 639, y2: 634 },
  },
  '伐木场': {
    minus: { x1: 609, y1: 509, x2: 638, y2: 538 },
    plus: { x1: 960, y1: 509, x2: 991, y2: 538 },
    search: { x1: 723, y1: 583, x2: 879, y2: 634 },
  },
  '石矿': {
    minus: { x1: 850, y1: 509, x2: 878, y2: 535 },
    plus: { x1: 1200, y1: 509, x2: 1230, y2: 538 },
    search: { x1: 962, y1: 587, x2: 1118, y2: 636 },
  },
  '金矿': {
    minus: { x1: 1086, y1: 509, x2: 1114, y2: 535 },
    plus: { x1: 1437, y1: 509, x2: 1465, y2: 538 },
    search: { x1: 1203, y1: 584, x2: 1351, y2: 637 },
  },
};
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
const CLOSE_POPUP_BUTTON = { x: 1392, y: 57 };

export async function gatherSingleResource(
  ctx: PluginContext,
  config: RokConfig,
  task: GatherTask,
  hasPaging: boolean | null = null,
  teamPage: TeamPage = 'gather'
): Promise<{ success: boolean; hasPaging: boolean; noIdleTeams?: boolean }> {
  const rc = config.resourceCollect;
  const rt = rc.resourceTypes[task.type];
  if (!rt) {
    ctx.log(`❌ 未知资源类型: ${task.type}`);
    return { success: false, hasPaging: false };
  }

  ctx.log(`>>> 采集: ${task.type} Lv.${task.level} 队伍${task.team}`);

  // Step 1: Ensure in world map (智能检测当前位置，需要时才切换)
  ctx.log(`  [1/9] 确保在城外`);
  await ensureInWorld(ctx, config);

  // Step 2: Open search panel
  ctx.log(`  [2/9] 打开搜索面板`);
  await ctx.tapRect(SEARCH_ENTRY_RECT.x1, SEARCH_ENTRY_RECT.y1, SEARCH_ENTRY_RECT.x2, SEARCH_ENTRY_RECT.y2);
  await ctx.sleep(1.5);

  // Step 3: Select resource type
  ctx.log(`  [3/9] 选择 ${task.type}`);
  await ctx.tap(rt.button.x, rt.button.y);
  await ctx.sleep(1);

  // Step 4: Reset to level 1
  const minusX = rt.button.x + rt.minusOffset.x;
  const minusY = rt.button.y + rt.minusOffset.y;
  const plusX = rt.button.x + rt.plusOffset.x;
  const plusY = rt.button.y + rt.plusOffset.y;
  const searchX = rt.button.x + rt.searchOffset.x;
  const searchY = rt.button.y + rt.searchOffset.y;

  const buttonRects = RESOURCE_BUTTON_RECTS[task.type];

  ctx.log(`  [4/9] 重置到1级: 快速点击 - ×7`);
  for (let i = 0; i < 7; i++) {
    if (buttonRects) await ctx.tapRect(buttonRects.minus.x1, buttonRects.minus.y1, buttonRects.minus.x2, buttonRects.minus.y2);
    else await ctx.tap(minusX, minusY);
    await ctx.sleep(0.15);
  }

  // Step 5: Set level and search with downgrade retry
  let currentLevel = 1;
  let searchSuccess = false;

  // First attempt: set to target level
  const initialClicks = task.level - 1;
  if (initialClicks > 0) {
    ctx.log(`  [5/9] 设置 Lv.${task.level}: + ×${initialClicks}`);
    for (let i = 0; i < initialClicks; i++) {
      if (buttonRects) await ctx.tapRect(buttonRects.plus.x1, buttonRects.plus.y1, buttonRects.plus.x2, buttonRects.plus.y2);
      else await ctx.tap(plusX, plusY);
      await ctx.sleep(0.15);
    }
  }
  currentLevel = task.level;

  while (currentLevel >= 1) {
    ctx.log(`  [5/9] 搜索 Lv.${currentLevel} (${searchX}, ${searchY})`);
    const stateResult = buttonRects
      ? await ctx.checkButtonStateChangeRect(buttonRects.search.x1, buttonRects.search.y1, buttonRects.search.x2, buttonRects.search.y2, 0.05)
      : await ctx.checkButtonStateChange(searchX, searchY, 100, 40, 0.05);

    if (stateResult.changed) {
      if (currentLevel < task.level) {
        ctx.log(`  Lv.${task.level} 未搜索到，降级至 Lv.${currentLevel} 搜索成功`);
      }
      searchSuccess = true;
      break;
    }

    if (currentLevel > 1) {
      ctx.log(`  Lv.${currentLevel} 未搜索到，降级重试...`);
      if (buttonRects) await ctx.tapRect(buttonRects.minus.x1, buttonRects.minus.y1, buttonRects.minus.x2, buttonRects.minus.y2);
      else await ctx.tap(minusX, minusY);
      await ctx.sleep(0.15);
      currentLevel--;
    } else {
      break;
    }
  }

  if (!searchSuccess) {
    ctx.log(`  ❌ 所有等级均未搜索到 ${task.type}，跳过`);
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);
    return { success: false, hasPaging: hasPaging ?? false };
  }

  await ctx.sleep(2.5);

  // Step 6: Tap gather button at fixed coordinates
  ctx.log(`  [6/9] 点击采集按钮 (1193, 604)`);
  await ctx.tapRect(GATHER_BUTTON_RECT.x1, GATHER_BUTTON_RECT.y1, GATHER_BUTTON_RECT.x2, GATHER_BUTTON_RECT.y2);
  await ctx.sleep(1.5);

  // Step 6.5: Check if there are idle teams by detecting AddTeamBtn at (1517, 130)
  ctx.log(`  [6.5/9] 检测是否有空闲队伍...`);
  const { width: addTeamW = 80, height: addTeamH = 80 } = await sharp(ADD_TEAM_BTN_TEMPLATE).metadata();
  const addTeamRegionX = 1517 - Math.floor(addTeamW! / 2);
  const addTeamRegionY = 130 - Math.floor(addTeamH! / 2);
  const addTeamRegionPath = await ctx.captureRegion(addTeamRegionX, addTeamRegionY, addTeamW!, addTeamH!);
  const addTeamDiff = await ctx.compareImages(addTeamRegionPath, ADD_TEAM_BTN_TEMPLATE);
  ctx.log(`  AddTeamBtn 匹对差异: ${(addTeamDiff * 100).toFixed(1)}%`);

  if (addTeamDiff >= 0.3) {
    ctx.log(`  ⚠️ 没有空闲队伍，停止采集，切换回城内`);
    await fs.unlink(addTeamRegionPath).catch(() => {});
    await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
    await ctx.sleep(2);
    return { success: false, hasPaging: hasPaging ?? false, noIdleTeams: true };
  }
  await fs.unlink(addTeamRegionPath).catch(() => {});
  ctx.log(`  有空闲队伍，继续`);

  // Step 7: Click select team button
  ctx.log(`  [7/9] 点击选择队伍按钮 (${SELECT_TEAM_BUTTON.x}, ${SELECT_TEAM_BUTTON.y})`);
  await ctx.tapRect(SELECT_TEAM_BUTTON_RECT.x1, SELECT_TEAM_BUTTON_RECT.y1, SELECT_TEAM_BUTTON_RECT.x2, SELECT_TEAM_BUTTON_RECT.y2);
  await ctx.sleep(1);

  // Step 7.5: Detect page indicator (only on first call)
  let pageSwitchButton: { x: number; y: number } | null = null;
  if (hasPaging === null) {
    const pageResult = await ctx.findImageWithLocation(PAGE_INDICATOR_TEMPLATE, 0.8);
    hasPaging = pageResult.found;
    if (hasPaging) {
      pageSwitchButton = { x: pageResult.x, y: pageResult.y };
      ctx.log(`  [检测] 换页按钮: 存在 (>7组) @ (${pageResult.x},${pageResult.y})`);
    } else {
      ctx.log(`  [检测] 换页按钮: 不存在 (≤7组)`);
    }
  } else if (hasPaging) {
    // 后续调用：换页按钮位置基本固定，这里也重新定位以避免坐标变化
    const pageResult = await ctx.findImageWithLocation(PAGE_INDICATOR_TEMPLATE, 0.8);
    if (pageResult.found) {
      pageSwitchButton = { x: pageResult.x, y: pageResult.y };
    }
  }

  // Step 7.6: 如有换页按钮，确保当前在目标队伍页
  if (hasPaging && pageSwitchButton) {
    const onTargetPage = await ensureTeamPage(ctx, teamPage, pageSwitchButton);
    if (!onTargetPage) {
      ctx.log(`  ⚠️ 未能切换到目标队伍页，跳过`);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      return { success: false, hasPaging: hasPaging ?? false };
    }
  }

  // Step 8: Select team by number and check if state changed (button highlighted)
  const teamButtons = hasPaging ? TEAM_BUTTONS_PAGED : TEAM_BUTTONS_NO_PAGE;
  const teamBtn = teamButtons[task.team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${task.team}`);
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);
    return { success: false, hasPaging: hasPaging ?? false };
  }

  ctx.log(`  [8/9] 选择队伍 ${task.team} 并检测状态变化...`);
  const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
  ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

  if (!stateResult.changed) {
    ctx.log(`  ⚠️ 队伍${task.team}不可用，按钮无选中状态变化，跳过`);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    return { success: false, hasPaging: hasPaging ?? false };
  }

  // Step 9: Team available, click march button
  ctx.log(`  [9/9] 点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
  await ctx.tapRect(MARCH_BUTTON_RECT.x1, MARCH_BUTTON_RECT.y1, MARCH_BUTTON_RECT.x2, MARCH_BUTTON_RECT.y2);
  await ctx.sleep(1);

  ctx.log(`  ✅ 队伍${task.team}已派出采集 ${task.type} Lv.${currentLevel}`);
  return { success: true, hasPaging: hasPaging! };
}
