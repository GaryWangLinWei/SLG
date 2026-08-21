import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';
import { ocrService } from '../../../core/ocr/OcrService';
import { handleMarchWithStamina } from '../utils/stamina';
import * as path from 'path';
import * as fsp from 'fs/promises';
import sharp from 'sharp';

const FORT_MAX_LEVEL = 15;
const FORT_LEVEL_RECT = { x1: 126, y1: 425, x2: 564, y2: 454 };
const FORT_LEVEL_RESET_BTN = { x: 167, y: 486 };

/**
 * 解析行军队列计数文本（如 "3/5"、"5/5"）。
 * used === total 表示队伍已满（无空闲队伍）。
 * OCR 偶尔会漏掉斜杠导致读到 "55" 之类的纯重复数字，此时回退为满队；
 * 非重复数字（如 "35"）无法判定，返回 null。
 */
export function parseTeamCount(text: string): { used: number; total: number } | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) return { used: parseInt(m[1], 10), total: parseInt(m[2], 10) };
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 2 && /^(\d)\1+$/.test(digits)) {
    return { used: parseInt(digits[0], 10), total: parseInt(digits[0], 10) };
  }
  return null;
}

/** OCR 顶部行军队列计数，判定队伍是否已满；识别失败返回 null */
async function readTeamFull(ctx: PluginContext): Promise<boolean | null> {
  const regionPath = await ctx.captureRegion(1507, 169, 55, 31);
  try {
    const text = (await ocrService.readTeamCount(regionPath)).trim();
    ctx.log(`  [队伍计数] OCR: "${text}"`);
    const count = parseTeamCount(text);
    if (!count) {
      ctx.log(`  [队伍计数] 未能解析，不做判定`);
      return null;
    }
    const full = count.used >= count.total;
    ctx.log(`  [队伍计数] ${count.used}/${count.total} → ${full ? '已满' : '有空闲'}`);
    return full;
  } finally {
    await fsp.unlink(regionPath).catch(() => {});
  }
}

/** OCR 读取城寨当前等级，失败返回 null */
async function readCurrentFortLevel(ctx: PluginContext): Promise<number | null> {
  let shot: string | null = null;
  let processed: string | null = null;
  try {
    shot = await ctx.captureRegion(
      FORT_LEVEL_RECT.x1, FORT_LEVEL_RECT.y1,
      FORT_LEVEL_RECT.x2 - FORT_LEVEL_RECT.x1,
      FORT_LEVEL_RECT.y2 - FORT_LEVEL_RECT.y1,
    );
    processed = shot.replace(/\.png$/i, '_lvl.png');
    await sharp(shot)
      .resize({ width: (FORT_LEVEL_RECT.x2 - FORT_LEVEL_RECT.x1) * 3, kernel: 'nearest' })
      .grayscale()
      .normalise()
      .toFile(processed);

    // 用中文 OCR 读完整 "等级：N"，再用正则抓数字，避免"等级：" 被误认成数字
    const txt = await ocrService.readChineseText(processed);
    ctx.log(`  [OCR] 城寨等级原始识别: "${txt.replace(/\s+/g, ' ')}"`);

    // 匹配"等级"后（含各种冒号/空格）的数字
    const m = txt.match(/等\s*级[^\d]{0,5}(\d{1,2})/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= FORT_MAX_LEVEL) return n;
    }
    // fallback：抓所有数字，取首个 1~10
    const nums = txt.match(/\d{1,2}/g) || [];
    for (const s of nums) {
      const n = parseInt(s, 10);
      if (n >= 1 && n <= FORT_MAX_LEVEL) return n;
    }
    return null;
  } catch (e) {
    ctx.log(`  [OCR] 城寨等级识别异常: ${(e as Error).message}`);
    return null;
  } finally {
    if (shot) await fsp.unlink(shot).catch(() => {});
    if (processed) await fsp.unlink(processed).catch(() => {});
  }
}

const TEMPLATE_DIR = getTemplatesDir();
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');

// 队伍选择坐标（集结界面，与采集界面坐标不同）
const SELECT_TEAM_BUTTON = { x: 1259, y: 180 };
const WORLD_SWITCH_BUTTON_RECT = { x1: 39, y1: 776, x2: 115, y2: 858 };
const SEARCH_ENTRY_RECT = { x1: 42, y1: 645, x2: 110, y2: 704 };
const BARBARIAN_BUTTON_RECT = { x1: 269, y1: 749, x2: 370, y2: 844 };
// 劫掠者城寨页签（dev 选项勾选后用这个坐标）
const MARAUDER_TAB_POINT = { x: 474, y: 300 };
const FORT_MINUS_RECT = { x1: 102, y1: 467, x2: 137, y2: 501 };
const FORT_PLUS_RECT = { x1: 539, y1: 467, x2: 576, y2: 501 };
const FORT_SEARCH_ACTION_RECT = { x1: 244, y1: 561, x2: 436, y2: 626 };
const RALLY_BUTTON_RECT = { x1: 1053, y1: 584, x2: 1280, y2: 649 };
const RALLY_BUTTON_TEMPLATE = path.join(TEMPLATE_DIR, 'JiJie.png');
// 集结按钮位于屏幕右下，限定搜索区域避免误匹配并加速
const RALLY_BUTTON_REGION = { x: 1000, y: 560, width: 360, height: 130 };
// 劫掠者城寨：集结按钮不可点时，先点此坐标（城寨目标项）后再集结
const MARAUDER_RALLY_TARGET = { x: 764, y: 415 };
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
const TILI_BUTTON_REGION = { x: 1014, y: 242, width: 1358 - 1014, height: 407 - 242 };
const CLOSE_STAMINA_POPUP = { x: 1363, y: 103 };

export interface RallyFortOutcome {
  result: 'success' | 'not_found' | 'team_unavailable' | 'rally_full' | 'stamina_insufficient';
  dispatched: number;
  foundLevel?: number;
}

export async function rallyFort(
  ctx: PluginContext,
  config: RokConfig,
  targetLevel: number,
  primaryTeam: number,
  downgrade: boolean = true,
  teamPage: TeamPage = 'attack',
  usePotion: boolean = false,
  troopType: 'any' | 'infantry' | 'cavalry' | 'archer' = 'any',
  fallbackTeamEnabled: boolean = false,
  fallbackTeamNum: number = 2,
  fallbackTroopType: 'any' | 'infantry' | 'cavalry' | 'archer' = 'any',
  marauder: boolean = false
): Promise<RallyFortOutcome> {
  let team = primaryTeam;
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
  if (marauder) {
    ctx.log(`  [4/8] 切换到劫掠者城寨页签 (${MARAUDER_TAB_POINT.x}, ${MARAUDER_TAB_POINT.y})`);
    await ctx.tap(MARAUDER_TAB_POINT.x, MARAUDER_TAB_POINT.y);
  } else {
    ctx.log(`  [4/8] 切换到野蛮人城寨页签 (${fs.fortTab.x}, ${fs.fortTab.y})`);
    await ctx.tap(fs.fortTab.x, fs.fortTab.y);
  }
  await ctx.sleep(1);

  // [5/8] 设置目标等级（劫掠者城寨不设等级）
  let currentLevel = targetLevel;

  if (!marauder) {
    ctx.log(`  [5/8] 设置等级`);

    // OCR 读当前等级，只点差值次数；失败则点重置按钮回 Lv.1 后再加
    const ocrLevel = await readCurrentFortLevel(ctx);

    if (ocrLevel !== null) {
      const diff = targetLevel - ocrLevel;
      ctx.log(`  OCR 当前 Lv.${ocrLevel} → 目标 Lv.${targetLevel}: ${diff === 0 ? '无需调整' : (diff > 0 ? `+ ×${diff}` : `- ×${-diff}`)}`);
      for (let i = 0; i < Math.abs(diff); i++) {
        if (diff > 0) await ctx.tapRect(FORT_PLUS_RECT.x1, FORT_PLUS_RECT.y1, FORT_PLUS_RECT.x2, FORT_PLUS_RECT.y2);
        else await ctx.tapRect(FORT_MINUS_RECT.x1, FORT_MINUS_RECT.y1, FORT_MINUS_RECT.x2, FORT_MINUS_RECT.y2);
        await ctx.sleep(0.15);
      }
      currentLevel = targetLevel;
    } else {
      ctx.log(`  OCR 失败，fallback: 点击重置按钮回 Lv.1`);
      await ctx.tap(FORT_LEVEL_RESET_BTN.x, FORT_LEVEL_RESET_BTN.y);
      await ctx.sleep(0.3);
      const plusClicks = targetLevel - 1;
      if (plusClicks > 0) {
        ctx.log(`  设置 Lv.${targetLevel}: + ×${plusClicks}`);
        for (let i = 0; i < plusClicks; i++) {
          await ctx.tapRect(FORT_PLUS_RECT.x1, FORT_PLUS_RECT.y1, FORT_PLUS_RECT.x2, FORT_PLUS_RECT.y2);
          await ctx.sleep(0.15);
        }
      }
      currentLevel = targetLevel;
    }
  } else {
    ctx.log(`  [5/8] 劫掠者城寨：不设置等级`);
  }

  /**
   * 执行一次"搜索 → 匹配集结按钮 → 点击"。
   * - openedPanel: 是否需要重新打开搜索面板（首次已在面板内，重试时面板已关）。
   * 返回 'opened'（集结弹窗已打开，继续 [7/8]）、'not_found'（搜不到城寨）、
   * 'rally_full'（队伍已满）、'already_rallied'（城寨正被集结，应搜下一个）。
   */
  const MAX_ATTEMPTS_PER_LEVEL = 5;
  async function searchAndOpenRally(reopenPanel: boolean): Promise<'opened' | 'not_found' | 'rally_full' | 'already_rallied'> {
    if (reopenPanel) {
      ctx.log(`  重新打开搜索面板，直接搜索（不切页签、不重设等级）`);
      await ctx.tapRect(SEARCH_ENTRY_RECT.x1, SEARCH_ENTRY_RECT.y1, SEARCH_ENTRY_RECT.x2, SEARCH_ENTRY_RECT.y2);
      await ctx.sleep(1.5);
    }

    ctx.log(`  点击搜索按钮 Lv.${currentLevel}`);
    const stateResult = await ctx.checkButtonStateChangeRect(
      FORT_SEARCH_ACTION_RECT.x1, FORT_SEARCH_ACTION_RECT.y1,
      FORT_SEARCH_ACTION_RECT.x2, FORT_SEARCH_ACTION_RECT.y2,
      0.05
    );
    if (!stateResult.changed) {
      ctx.log(`  ❌ 未搜索到城寨`);
      return 'not_found';
    }

    await ctx.sleep(2.5);

    // [6/8] 模板匹配集结按钮并点击
    ctx.log(`  [6/8] 匹配集结按钮 JiJie.png`);
    let rallyBtn = await ctx.findImageWithLocation(RALLY_BUTTON_TEMPLATE, 0.7, [0.9, 1.0, 1.1], false, undefined, RALLY_BUTTON_REGION);

    // 劫掠者城寨：匹配不到集结按钮时，先点城寨目标项再重新匹配
    if (!rallyBtn.found && marauder) {
      ctx.log(`  劫掠者：未匹配到集结按钮，点击城寨目标 (${MARAUDER_RALLY_TARGET.x}, ${MARAUDER_RALLY_TARGET.y}) 后重新匹配`);
      await ctx.tap(MARAUDER_RALLY_TARGET.x, MARAUDER_RALLY_TARGET.y);
      await ctx.sleep(1);
      rallyBtn = await ctx.findImageWithLocation(RALLY_BUTTON_TEMPLATE, 0.7, [0.9, 1.0, 1.1], false, undefined, RALLY_BUTTON_REGION);
    }

    if (!rallyBtn.found) {
      ctx.log(`  ⚠️ 未找到集结按钮（conf=${rallyBtn.confidence.toFixed(3)}），判定队伍已满`);
      return 'rally_full';
    }
    ctx.log(`  集结按钮位置 (${rallyBtn.x}, ${rallyBtn.y}) conf=${rallyBtn.confidence.toFixed(3)}，点击并检测弹窗`);
    const rallyResult = await ctx.checkButtonStateChange(rallyBtn.x, rallyBtn.y, 150, 50, 0.05);
    if (!rallyResult.changed) {
      // 点击无变化有两种情况：队伍已满、或城寨正被其它队伍集结。OCR 队伍计数区分。
      ctx.log(`  ⚠️ 集结按钮点击后无变化，OCR 队伍计数区分原因`);
      const full = await readTeamFull(ctx);
      if (full === true) {
        ctx.log(`  队伍已满`);
        return 'rally_full';
      }
      if (full === false) {
        ctx.log(`  有空闲队伍 → 当前城寨正被集结，搜下一个城寨`);
        return 'already_rallied';
      }
      ctx.log(`  队伍计数无法判定，按城寨被集结处理（搜下一个）`);
      return 'already_rallied';
    }
    await ctx.sleep(1.5);
    return 'opened';
  }

  // 每个等级最多尝试 MAX_ATTEMPTS_PER_LEVEL 次（首次 + 最多 4 次重试）。
  // 城寨被集结时，重新打开搜索面板直接搜下一个；5 次都被集结且允许降级时，
  // 降级一个等级后再给 5 次机会。
  let attemptOutcome: 'opened' | 'not_found' | 'rally_full' = 'not_found';
  // panelOpen：进入搜索时面板是否已开着（首次已开；点击集结按钮后面板关闭，重试需重开）
  let panelOpen = true;
  // 降级次数上限：最多降 2 级，或已到 Lv.1 即停
  const MAX_DOWNGRADE = 2;
  let downgradeCount = 0;
  while (true) {
    let ralliedCount = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_LEVEL; attempt++) {
      ctx.log(`  ▶ Lv.${currentLevel} 尝试 ${attempt}/${MAX_ATTEMPTS_PER_LEVEL}`);
      const r = await searchAndOpenRally(!panelOpen);
      panelOpen = false;
      if (r === 'opened') { attemptOutcome = 'opened'; break; }
      if (r === 'not_found') { attemptOutcome = 'not_found'; break; }
      if (r === 'rally_full') { attemptOutcome = 'rally_full'; break; }
      // already_rallied：继续下一次尝试
      ralliedCount++;
    }

    if (attemptOutcome === 'opened') break;

    // 非劫掠者且允许降级：降一级再来一轮（被集结 5 次或搜不到当前等级时）。
    // 最多降级 MAX_DOWNGRADE 次，或已到 Lv.1 即停。
    if (!marauder && downgrade && currentLevel > 1 && downgradeCount < MAX_DOWNGRADE && attemptOutcome !== 'rally_full') {
      downgradeCount++;
      ctx.log(`  Lv.${currentLevel} 连续 ${ralliedCount} 次被集结/未搜到，降级至 Lv.${currentLevel - 1} 重试（${downgradeCount}/${MAX_DOWNGRADE}）`);
      // 面板可能还开着，点一次减号降级；若面板已关则需重新打开再降。
      // searchAndOpenRally 下一轮会重新打开面板，先打开再点减号。
      await ctx.tapRect(SEARCH_ENTRY_RECT.x1, SEARCH_ENTRY_RECT.y1, SEARCH_ENTRY_RECT.x2, SEARCH_ENTRY_RECT.y2);
      await ctx.sleep(1.5);
      await ctx.tapRect(FORT_MINUS_RECT.x1, FORT_MINUS_RECT.y1, FORT_MINUS_RECT.x2, FORT_MINUS_RECT.y2);
      await ctx.sleep(0.15);
      currentLevel--;
      panelOpen = true; // 面板已重新打开且已降级，下一轮直接点搜索，不要再开面板
      continue;
    }
    break;
  }

  if (attemptOutcome === 'not_found') {
    ctx.log(`  ❌ 未搜索到城寨`);
    // 点击2次切换按钮：第1次退出搜索面板，第2次回到城内
    ctx.log(`  退出搜索面板并返回城内`);
    await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
    await ctx.sleep(1);
    await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
    await ctx.sleep(2);
    return { result: 'not_found', dispatched: 0 };
  }

  if (attemptOutcome === 'rally_full') {
    await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
    await ctx.sleep(2);
    return { result: 'rally_full', dispatched: 0, foundLevel: currentLevel };
  }

  // [7/8] 确认集结时间
  ctx.log(`  [7/8] 确认集结时间 (${CONFIRM_TIME_BUTTON.x}, ${CONFIRM_TIME_BUTTON.y})`);
  await ctx.tapRect(CONFIRM_TIME_BUTTON_RECT.x1, CONFIRM_TIME_BUTTON_RECT.y1, CONFIRM_TIME_BUTTON_RECT.x2, CONFIRM_TIME_BUTTON_RECT.y2);
  await ctx.sleep(1);

  // 部队推荐：勾选兵种（步/骑/弓），不限制则跳过
  if (troopType !== 'any') {
    const troopTapMap: Record<string, { x: number; y: number }> = {
      infantry: { x: 864, y: 136 },
      cavalry: { x: 1009, y: 136 },
      archer: { x: 1152, y: 134 },
    };
    const tap = troopTapMap[troopType];
    ctx.log(`  [部队推荐] ${troopType} → 点击 (${tap.x}, ${tap.y})`);
    await ctx.tap(tap.x, tap.y);
    await ctx.sleep(0.6);
  }

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
  let teamBtn = teamButtons[team];
  if (!teamBtn) {
    ctx.log(`  ❌ 无效的队伍序号: ${team}`);
    return { result: 'team_unavailable', dispatched: 0, foundLevel: currentLevel };
  }

  // [8/8] 选择队伍并检测状态变化
  ctx.log(`  [8/8] 选择队伍 ${team} 并检测状态变化...`);
  const stateResult = await ctx.checkButtonStateChange(teamBtn.x, teamBtn.y, 150, 50, 0.1);
  ctx.log(`  [debug] 像素变化率: ${(stateResult.diffPercentage * 100).toFixed(1)}%, changed: ${stateResult.changed}`);

  if (!stateResult.changed) {
    ctx.log(`  ⚠️ 队伍${team}不可用，按钮无选中状态变化`);
    if (!fallbackTeamEnabled) {
      ctx.log(`  跳过（未启用备用队伍）`);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      return { result: 'team_unavailable', dispatched: 0, foundLevel: currentLevel };
    }

    // 备用队伍：根据备用部队推荐勾选兵种，再点击备用队伍
    const fbBtn = teamButtons[fallbackTeamNum];
    if (!fbBtn) {
      ctx.log(`  ❌ 无效的备用队伍序号: ${fallbackTeamNum}`);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      return { result: 'team_unavailable', dispatched: 0, foundLevel: currentLevel };
    }

    // 兵种切换：与主队不同时，先取消主队已选兵种，再点备用兵种；相同则不动
    const troopTapMap: Record<string, { x: number; y: number }> = {
      infantry: { x: 864, y: 136 },
      cavalry: { x: 1009, y: 136 },
      archer: { x: 1152, y: 134 },
    };
    if (troopType !== fallbackTroopType) {
      if (troopType !== 'any') {
        const offTap = troopTapMap[troopType];
        ctx.log(`  [备用队伍] 取消主队兵种 ${troopType} → 点击 (${offTap.x}, ${offTap.y})`);
        await ctx.tap(offTap.x, offTap.y);
        await ctx.sleep(0.4);
      }
      if (fallbackTroopType !== 'any') {
        const onTap = troopTapMap[fallbackTroopType];
        ctx.log(`  [备用队伍] 选中备用兵种 ${fallbackTroopType} → 点击 (${onTap.x}, ${onTap.y})`);
        await ctx.tap(onTap.x, onTap.y);
        await ctx.sleep(0.6);
      }
    } else {
      ctx.log(`  [备用队伍] 主备兵种一致（${troopType}），无需切换`);
    }

    ctx.log(`  [备用队伍] 选择队伍 ${fallbackTeamNum} 并检测状态变化...`);
    const fbState = await ctx.checkButtonStateChange(fbBtn.x, fbBtn.y, 150, 50, 0.1);
    ctx.log(`  [debug] 备用队伍${fallbackTeamNum} 像素变化率: ${(fbState.diffPercentage * 100).toFixed(1)}%, changed: ${fbState.changed}`);
    if (!fbState.changed) {
      ctx.log(`  ⚠️ 备用队伍${fallbackTeamNum}也不可用，跳过`);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      return { result: 'team_unavailable', dispatched: 0, foundLevel: currentLevel };
    }
    // 选中备用队伍，覆盖 team 变量以便后续日志/行军使用
    team = fallbackTeamNum;
    teamBtn = fbBtn;
  }

  const staminaResult = await handleMarchWithStamina(
    ctx,
    TILI_BUTTON_REGION,
    usePotion,
    async () => {
      ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})`);
      await ctx.tapRect(MARCH_BUTTON_RECT.x1, MARCH_BUTTON_RECT.y1, MARCH_BUTTON_RECT.x2, MARCH_BUTTON_RECT.y2);
    },
    async () => {
      await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
      await ctx.sleep(0.5);
      await ctx.tap(CLOSE_TEAM_PANEL_BUTTON.x, CLOSE_TEAM_PANEL_BUTTON.y);
      await ctx.sleep(0.5);
      await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
      await ctx.sleep(2);
    },
  );
  if (staminaResult === 'insufficient') {
    return { result: 'stamina_insufficient', dispatched: 0, foundLevel: currentLevel };
  }
  ctx.log(`  ✅ 队伍${team} 已发起 Lv.${currentLevel} 城寨集结`);
  return { result: 'success', dispatched: 1, foundLevel: currentLevel };
}
