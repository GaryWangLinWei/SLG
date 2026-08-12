import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';
import { ensureInWorld } from '../utils/location';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';
import { getTeamButtons } from '../utils/teamButtons';
import { ocrService } from '../../../core/ocr/OcrService';

const MAX_LEVEL = 8;

// 等级重置按钮坐标（点一次直接回到 Lv.1）
const LEVEL_RESET_BTN: Record<string, { x: number; y: number }> = {
  '农田':   { x: 423,  y: 525 },
  '伐木场': { x: 665,  y: 523 },
  '石矿':   { x: 902,  y: 523 },
  '金矿':   { x: 1139, y: 523 },
};

// 等级数字显示区域（minus 和 plus 中间的 "Lv.N" 数字）
const LEVEL_RECTS: Record<string, { x1: number; y1: number; x2: number; y2: number }> = {
  '农田':   { x1: 391,  y1: 478, x2: 734,  y2: 501 },
  '伐木场': { x1: 631,  y1: 478, x2: 978,  y2: 501 },
  '石矿':   { x1: 868,  y1: 478, x2: 1214, y2: 501 },
  '金矿':   { x1: 1107, y1: 478, x2: 1450, y2: 501 },
};

/** 截取等级区域并 OCR 读数字，失败返回 null */
async function readCurrentLevel(ctx: PluginContext, type: string): Promise<number | null> {
  const rect = LEVEL_RECTS[type];
  if (!rect) return null;
  let shot: string | null = null;
  try {
    shot = await ctx.captureRegion(rect.x1, rect.y1, rect.x2 - rect.x1, rect.y2 - rect.y1);

    // 预处理：3x 放大 + 灰度 + 二值化，方便 tesseract 识别小字
    const processed = shot.replace(/\.png$/i, '_lvl.png');
    await sharp(shot)
      .resize({ width: (rect.x2 - rect.x1) * 3, kernel: 'nearest' })
      .grayscale()
      .normalise()
      .threshold(160)
      .toFile(processed);

    const txt = await ocrService.readDigits(processed);
    ctx.log(`  [OCR] 等级原始识别: "${txt}" (${type})`);
    await fs.unlink(processed).catch(() => {});

    const digits = txt.replace(/\D/g, '');
    if (!digits) return null;
    // 若识别出多个数字（如 "18"），只取最后一位（等级：1 时可能有杂数字）
    const n = parseInt(digits.slice(-1), 10);
    if (n >= 1 && n <= MAX_LEVEL) return n;
    return null;
  } catch (e) {
    ctx.log(`  [OCR] 等级识别异常: ${(e as Error).message}`);
    return null;
  } finally {
    if (shot) await fs.unlink(shot).catch(() => {});
  }
}

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
const MARCH_BUTTON = { x: 1154, y: 791 };
const CLOSE_POPUP_BUTTON = { x: 1392, y: 57 };

export type GatherSingleResult = {
  success: boolean;
  hasPaging: boolean;
  noIdleTeams?: boolean;
  /** 已知可用的目标队伍集合；首次探测后填充并跨调用透传，null 表示尚未探测 */
  idleTeams: Set<number> | null;
};

export async function gatherSingleResource(
  ctx: PluginContext,
  config: RokConfig,
  task: GatherTask,
  hasPaging: boolean | null = null,
  teamPage: TeamPage = 'gather',
  idleTeams: Set<number> | null = null,
  probeTeams: number[] = []
): Promise<GatherSingleResult> {
  const rc = config.resourceCollect;
  const rt = rc.resourceTypes[task.type];
  if (!rt) {
    ctx.log(`❌ 未知资源类型: ${task.type}`);
    return { success: false, hasPaging: false, idleTeams };
  }

  // 若已探测过且本队不在可用集合中，直接跳过，省掉开面板/搜索等前 7 步
  if (idleTeams && !idleTeams.has(task.team)) {
    ctx.log(`>>> 采集: ${task.type} Lv.${task.level} 队伍${task.team} → 队伍忙，跳过`);
    return { success: false, hasPaging: hasPaging ?? false, idleTeams };
  }

  ctx.log(`>>> 采集: ${task.type} Lv.${task.level} 队伍${task.team}`);

  // Step 1: Ensure in world map (智能检测当前位置，需要时才切换；城外采集搜索面板有固定坐标入口，无需重置视角)
  ctx.log(`  [1/9] 确保在城外`);
  await ensureInWorld(ctx, config, { resetView: false });

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

  // Step 4: OCR 读当前等级，只点差值次数（读不到则退回"减 MAX_LEVEL-1 次"兜底）
  const ocrLevel = await readCurrentLevel(ctx, task.type);
  let currentLevel: number;

  if (ocrLevel !== null) {
    const diff = task.level - ocrLevel;
    ctx.log(`  [4/9] OCR 当前 Lv.${ocrLevel} → 目标 Lv.${task.level}: ${diff === 0 ? '无需调整' : (diff > 0 ? `+ ×${diff}` : `- ×${-diff}`)}`);
    for (let i = 0; i < Math.abs(diff); i++) {
      if (diff > 0) {
        if (buttonRects) await ctx.tapRect(buttonRects.plus.x1, buttonRects.plus.y1, buttonRects.plus.x2, buttonRects.plus.y2);
        else await ctx.tap(plusX, plusY);
      } else {
        if (buttonRects) await ctx.tapRect(buttonRects.minus.x1, buttonRects.minus.y1, buttonRects.minus.x2, buttonRects.minus.y2);
        else await ctx.tap(minusX, minusY);
      }
      await ctx.sleep(0.15);
    }
    currentLevel = task.level;
  } else {
    ctx.log(`  [4/9] OCR 读等级失败，fallback: 点击重置按钮回到 Lv.1`);
    const resetBtn = LEVEL_RESET_BTN[task.type];
    if (resetBtn) {
      await ctx.tap(resetBtn.x, resetBtn.y);
      await ctx.sleep(0.3);
    } else {
      // 无重置按钮配置，退回连点减号
      for (let i = 0; i < MAX_LEVEL - 1; i++) {
        if (buttonRects) await ctx.tapRect(buttonRects.minus.x1, buttonRects.minus.y1, buttonRects.minus.x2, buttonRects.minus.y2);
        else await ctx.tap(minusX, minusY);
        await ctx.sleep(0.15);
      }
    }
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
  }

  let searchSuccess = false;

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
    return { success: false, hasPaging: hasPaging ?? false, idleTeams };
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
    return { success: false, hasPaging: hasPaging ?? false, noIdleTeams: true, idleTeams };
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
      return { success: false, hasPaging: hasPaging ?? false, idleTeams };
    }
  }

  // Step 7.7: 首次打开队伍面板时，一次性探测所有目标队伍是否可用，
  // 避免后续忙队伍重复走前 7 步。探测靠点击按钮后是否有选中状态变化判断（不点行军，安全）。
  const teamButtons = getTeamButtons(hasPaging);
  if (idleTeams === null) {
    idleTeams = new Set<number>();
    const teamsToProbe = probeTeams.length > 0 ? probeTeams : [task.team];
    ctx.log(`  [探测] 检查目标队伍 ${teamsToProbe.join(',')} 是否空闲...`);
    for (const num of teamsToProbe) {
      const btn = teamButtons[num];
      if (!btn) continue;
      const res = await ctx.checkButtonStateChange(btn.x, btn.y, 150, 50, 0.1);
      if (res.changed) {
        idleTeams.add(num);
        ctx.log(`  [探测] 队伍${num} 空闲 (变化率 ${(res.diffPercentage * 100).toFixed(1)}%)`);
      } else {
        ctx.log(`  [探测] 队伍${num} 忙，跳过 (变化率 ${(res.diffPercentage * 100).toFixed(1)}%)`);
      }
    }
    ctx.log(`  [探测] 空闲队伍: [${[...idleTeams].join(',')}]`);

    if (!idleTeams.has(task.team)) {
      ctx.log(`  ⚠️ 当前队伍${task.team}忙，关闭面板（已记录可用队伍供后续使用）`);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      return { success: false, hasPaging: hasPaging!, idleTeams };
    }
  }

  // Step 8: Select team by number and check if state changed (button highlighted)
  const teamBtn = teamButtons[task.team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${task.team}`);
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);
    return { success: false, hasPaging: hasPaging ?? false, idleTeams };
  }

  // 探测阶段可能最后选中了别的空闲队，这里重新选中本任务队伍
  ctx.log(`  [8/9] 选择队伍 ${task.team}...`);
  await ctx.tap(teamBtn.x, teamBtn.y);
  await ctx.sleep(0.5);

  // Step 9: Team available, click march button
  ctx.log(`  [9/9] 点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
  await ctx.tapRect(MARCH_BUTTON_RECT.x1, MARCH_BUTTON_RECT.y1, MARCH_BUTTON_RECT.x2, MARCH_BUTTON_RECT.y2);
  await ctx.sleep(1);

  ctx.log(`  ✅ 队伍${task.team}已派出采集 ${task.type} Lv.${currentLevel}`);
  return { success: true, hasPaging: hasPaging!, idleTeams };
}
