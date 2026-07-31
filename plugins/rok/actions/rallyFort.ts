import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fsp from 'fs/promises';
import sharp from 'sharp';

const FORT_MAX_LEVEL = 10;
const FORT_LEVEL_RECT = { x1: 126, y1: 425, x2: 564, y2: 454 };
const FORT_LEVEL_RESET_BTN = { x: 167, y: 486 };

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
const STAMINA_BAR_RECT = { x1: 557, y1: 174, x2: 575, y2: 197 };
const POTION_USE_BUTTON = { x: 1200, y: 326 };
const CLOSE_STAMINA_POPUP = { x: 1363, y: 103 };
const MAX_FREE_TILI_CLICKS = 2;
const MAX_POTION_USES = 10;

type StaminaColor = 'green' | 'yellow' | 'unknown';

/** 采样体力条区域平均 RGB，判定绿/黄/未知 */
async function readStaminaColor(ctx: PluginContext): Promise<StaminaColor> {
  let shot: string | null = null;
  try {
    shot = await ctx.captureRegion(
      STAMINA_BAR_RECT.x1, STAMINA_BAR_RECT.y1,
      STAMINA_BAR_RECT.x2 - STAMINA_BAR_RECT.x1,
      STAMINA_BAR_RECT.y2 - STAMINA_BAR_RECT.y1,
    );
    const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let sumR = 0, sumG = 0, sumB = 0;
    const pixels = info.width * info.height;
    for (let i = 0; i < data.length; i += 3) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
    }
    const r = sumR / pixels, g = sumG / pixels, b = sumB / pixels;
    ctx.log(`  [体力条] RGB=(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})`);
    // 绿：G 明显大于 R
    if (g > r + 20 && g > b + 20) return 'green';
    // 黄：R 与 G 都高且接近，B 较低
    if (r > 120 && g > 90 && Math.abs(r - g) < 60 && b < Math.min(r, g) - 40) return 'yellow';
    return 'unknown';
  } catch (e) {
    ctx.log(`  [体力条] 采样异常: ${(e as Error).message}`);
    return 'unknown';
  } finally {
    if (shot) await fsp.unlink(shot).catch(() => {});
  }
}

/** 循环点击 btn_tili 领取免费体力，最多 MAX_FREE_TILI_CLICKS 次或按钮消失 */
async function claimAllFreeStamina(ctx: PluginContext): Promise<number> {
  let claimed = 0;
  for (let i = 0; i < MAX_FREE_TILI_CLICKS; i++) {
    const btn = await ctx.findImageWithLocation(TILI_BUTTON_TEMPLATE, 0.8, [0.9, 1.0, 1.1], false, undefined, TILI_BUTTON_REGION);
    ctx.log(`  [体力] 免费按钮检测 #${i + 1}: found=${btn.found} conf=${btn.confidence.toFixed(3)}`);
    if (!btn.found) break;
    ctx.log(`  [体力] 点击免费按钮 (${btn.x}, ${btn.y})`);
    await ctx.tap(btn.x, btn.y);
    await ctx.sleep(0.8);
    claimed++;
  }
  return claimed;
}

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
  fallbackTroopType: 'any' | 'infantry' | 'cavalry' | 'archer' = 'any'
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
  ctx.log(`  [4/8] 切换到城寨页签 (${fs.fortTab.x}, ${fs.fortTab.y})`);
  await ctx.tapRect(FORT_TAB_RECT.x1, FORT_TAB_RECT.y1, FORT_TAB_RECT.x2, FORT_TAB_RECT.y2);
  await ctx.sleep(1);

  // [5/8] 设置等级并搜索
  ctx.log(`  [5/8] 设置等级并搜索`);

  // OCR 读当前等级，只点差值次数；失败则点重置按钮回 Lv.1 后再加
  const ocrLevel = await readCurrentFortLevel(ctx);
  let currentLevel = 1;
  let searchSuccess = false;

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

    if (marchAttempt >= 2) {
      // 第二次仍失败，兜底关闭返回
      await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
      await ctx.sleep(0.5);
      await ctx.tap(CLOSE_TEAM_PANEL_BUTTON.x, CLOSE_TEAM_PANEL_BUTTON.y);
      await ctx.sleep(0.5);
      await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
      await ctx.sleep(2);
      return { result: 'stamina_insufficient', dispatched: 0, foundLevel: currentLevel };
    }

    // Step A: 循环领免费体力（最多 2 次，或按钮消失）
    const claimed = await claimAllFreeStamina(ctx);
    ctx.log(`  [体力] 免费领取 ${claimed} 次`);

    // Step B: 采样体力条颜色
    const color = await readStaminaColor(ctx);
    ctx.log(`  [体力] 判定颜色: ${color}`);

    if (color === 'green') {
      ctx.log(`  [体力] 充足 → 关闭弹窗重试行军`);
      await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
      await ctx.sleep(0.8);
      continue;
    }

    // 非绿：视为体力不足
    if (color === 'yellow' && usePotion) {
      // Step C: 循环使用体力药水直到变绿
      let becameGreen = false;
      for (let i = 0; i < MAX_POTION_USES; i++) {
        ctx.log(`  [体力] 使用药水 #${i + 1} → (${POTION_USE_BUTTON.x}, ${POTION_USE_BUTTON.y})`);
        await ctx.tap(POTION_USE_BUTTON.x, POTION_USE_BUTTON.y);
        await ctx.sleep(0.9);
        const c = await readStaminaColor(ctx);
        if (c === 'green') { becameGreen = true; break; }
      }
      if (becameGreen) {
        ctx.log(`  [体力] 药水补至绿 → 关闭弹窗重试行军`);
        await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
        await ctx.sleep(0.8);
        continue;
      }
      ctx.log(`  [体力] 药水用尽仍未转绿 → 放弃`);
    } else {
      ctx.log(`  [体力] 不足（color=${color}, usePotion=${usePotion}）→ 放弃`);
    }

    // 关闭 → 关队伍面板 → 切城内 → 返回
    await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
    await ctx.sleep(0.5);
    await ctx.tap(CLOSE_TEAM_PANEL_BUTTON.x, CLOSE_TEAM_PANEL_BUTTON.y);
    await ctx.sleep(0.5);
    await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
    await ctx.sleep(2);
    return { result: 'stamina_insufficient', dispatched: 0, foundLevel: currentLevel };
  }

  return { result: 'stamina_insufficient', dispatched: 0, foundLevel: currentLevel };
}
