import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

const STAMINA_BAR_RECT = { x1: 557, y1: 174, x2: 575, y2: 197 };
const POTION_USE_BUTTON = { x: 1200, y: 326 };
const CLOSE_STAMINA_POPUP = { x: 1363, y: 103 };
const MAX_FREE_TILI_CLICKS = 2;
const MAX_POTION_USES = 10;
const TILI_BUTTON_REGION = { x: 1014, y: 242, width: 1588 - 1014, height: 407 - 242 };

type StaminaColor = 'green' | 'yellow' | 'unknown';

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
      sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2];
    }
    const r = sumR / pixels, g = sumG / pixels, b = sumB / pixels;
    ctx.log(`  [体力条] RGB=(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})`);
    if (g > r + 20 && g > b + 20) return 'green';
    if (r > 120 && g > 90 && Math.abs(r - g) < 60 && b < Math.min(r, g) - 40) return 'yellow';
    return 'unknown';
  } catch (e) {
    ctx.log(`  [体力条] 采样异常: ${(e as Error).message}`);
    return 'unknown';
  } finally {
    if (shot) await fs.unlink(shot).catch(() => {});
  }
}

async function claimAllFreeStamina(ctx: PluginContext): Promise<number> {
  const tpl = path.join(getTemplatesDir(), 'btn_tili.png');
  let claimed = 0;
  for (let i = 0; i < MAX_FREE_TILI_CLICKS; i++) {
    const btn = await ctx.findImageWithLocation(tpl, 0.8, [0.9, 1.0, 1.1], false, undefined, TILI_BUTTON_REGION);
    ctx.log(`  [体力] 免费按钮检测 #${i + 1}: found=${btn.found} conf=${btn.confidence.toFixed(3)}`);
    if (!btn.found) break;
    ctx.log(`  [体力] 点击免费按钮 (${btn.x}, ${btn.y})`);
    await ctx.tap(btn.x, btn.y);
    await ctx.sleep(0.8);
    claimed++;
  }
  return claimed;
}

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
  1: { x: 1378, y: 325 }, 2: { x: 1378, y: 393 },
  3: { x: 1378, y: 459 }, 4: { x: 1378, y: 528 }, 5: { x: 1378, y: 595 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 359 }, 2: { x: 1378, y: 424 },
  3: { x: 1378, y: 492 }, 4: { x: 1378, y: 562 }, 5: { x: 1378, y: 630 },
};
const MARCH_BUTTON = { x: 1154, y: 791 };
const MARCH_BUTTON_RECT = { x1: 1031, y1: 754, x2: 1292, y2: 820 };

export interface JoinRallyOutcome {
  result: 'success' | 'no_idle_teams' | 'no_rally_state' | 'no_joinable' | 'distance_exceed' | 'team_unavailable' | 'no_biandui' | 'stamina_insufficient';
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
    usePotion?: boolean;
    useDefaultTeam?: boolean;
  }
): Promise<JoinRallyOutcome> {
  ctx.log(`=== 加入集结 队伍${params.team} 最大距离${params.maxDistance}公里 ===`);

  const isFirstRun = params.firstRun ?? true;

  // [1/6] 检测空闲队伍
  ctx.log('  [1/6] OCR 检测空闲队伍数...');
  const regionPath = await ctx.captureRegion(1507, 169, 55, 31);
  const teamCountText = await ocrService.readTeamCount(regionPath);
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

  // [3/6] 每次都按距离排序（原首次运行判断暂时注释）
  // if (isFirstRun) {
  ctx.log('  [3/6] 设置按距离排序');
  await ctx.tap(SORT_SETTINGS_BUTTON.x, SORT_SETTINGS_BUTTON.y);
  await ctx.sleep(1);
  await ctx.tap(SORT_BY_DISTANCE_BUTTON.x, SORT_BY_DISTANCE_BUTTON.y);
  await ctx.sleep(0.5);
  // } else {
  //   ctx.log('  [3/6] 非首次运行：跳过排序设置');
  // }

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

    const targetRegion = { x: col.target.x, y: col.target.y, width: col.target.width, height: col.target.height };
    const fortResult = await ctx.findImageWithLocation(
      ICON_CHENGZHAI_TEMPLATE, 0.8, undefined, false, undefined, targetRegion
    );
    const loharResult = await ctx.findImageWithLocation(
      ICON_LOHA_TEMPLATE, 0.8, undefined, false, undefined, targetRegion
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
    const distText = await ocrService.readDistance(distPath);
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
    BTN_BIANDUI_TEMPLATE, 0.6
  );
  if (!bianduiResult.found) {
    ctx.log('  未检测到编队按钮，点击回城按钮并结束');
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    // 点击回城按钮（左下角）
    await ctx.tap(80, 830);
    await ctx.sleep(1);
    return { result: 'no_biandui', joined: 0, targetType: detectedTarget!, distance: detectedDistance };
  }
  ctx.log(`  点击编队按钮 (${bianduiResult.x}, ${bianduiResult.y})`);
  await ctx.tap(bianduiResult.x, bianduiResult.y);
  await ctx.sleep(1);

  // [6/6] 选择队伍并行军（复用 rallyFort 逻辑）
  ctx.log('  [6/6] 选择队伍并行军...');

  if (params.useDefaultTeam) {
    ctx.log('  使用默认队伍，跳过换页和队伍选择');
  } else {
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
        { x: 1361, y: 359, w: 36, h: 35 }
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
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);  // 关闭队伍面板
      await ctx.sleep(0.5);
      return { result: 'team_unavailable', joined: 0, targetType: detectedTarget!, distance: detectedDistance };
    }
  }

  // 点击行军；先检测胜算不足弹窗，再检测行动力不足，有免费体力则领取重试
  for (let marchAttempt = 1; marchAttempt <= 2; marchAttempt++) {
    await ctx.sleep(0.5);
    ctx.log(`  点击行军按钮 (${MARCH_BUTTON.x}, ${MARCH_BUTTON.y})${marchAttempt > 1 ? '（领取体力后重试）' : ''}`);
    await ctx.tapRect(MARCH_BUTTON_RECT.x1, MARCH_BUTTON_RECT.y1, MARCH_BUTTON_RECT.x2, MARCH_BUTTON_RECT.y2);
    await ctx.sleep(1);

    // [1] 先检测胜算不足弹窗：识别 jijie/btn_surego.png 二次确认行军按钮
    const sureGoResult = await ctx.findImageWithLocation(path.join(TEMPLATE_DIR, 'jijie', 'btn_surego.png'), 0.6, [0.95, 1.0, 1.05]);
    ctx.log(`  [胜算不足] 最佳置信度: ${sureGoResult.confidence.toFixed(3)}, found: ${sureGoResult.found}`);
    if (sureGoResult.found) {
      ctx.log(`  ⚠️ 检测到胜算不足弹窗，点击二次确认行军 (${sureGoResult.x}, ${sureGoResult.y})`);
      await ctx.tap(sureGoResult.x, sureGoResult.y);
      await ctx.sleep(1.5);
      // 点击二次确认后不直接返回，继续往下检测行动力不足弹窗
    }

    // [2] 再检测行动力不足弹窗：城内外切换按钮不可见则认为被弹窗遮挡
    const switchCityResult = await ctx.findImageWithLocation(path.join(TEMPLATE_DIR, 'switch_in_city.png'), 0.7);
    const switchWorldResult = await ctx.findImageWithLocation(path.join(TEMPLATE_DIR, 'switch_in_world.png'), 0.7);
    ctx.log(`  切换按钮: city=${switchCityResult.confidence.toFixed(3)}, world=${switchWorldResult.confidence.toFixed(3)}`);
    const isStaminaInsufficient = !switchCityResult.found && !switchWorldResult.found;

    if (!isStaminaInsufficient) {
      ctx.log(`  ✅ 成功加入${detectedTarget === 'fort' ? '城寨' : '洛哈'}集结 (${detectedDistance}公里)`);
      return { result: 'success', joined: 1, targetType: detectedTarget!, distance: detectedDistance };
    }

    ctx.log(`  ⚠️ 切换按钮不可见 → 行动力不足弹窗`);

    if (marchAttempt >= 2) {
      await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
      await ctx.sleep(0.5);
      await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
      await ctx.sleep(0.5);
      await ctx.tap(80, 830);
      await ctx.sleep(1);
      return { result: 'stamina_insufficient', joined: 0, targetType: detectedTarget!, distance: detectedDistance };
    }

    // Step A: 循环领免费体力
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

    if (color === 'yellow' && params.usePotion) {
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
      ctx.log(`  [体力] 不足（color=${color}, usePotion=${params.usePotion === true}）→ 放弃`);
    }

    await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
    await ctx.sleep(0.5);
    await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
    await ctx.sleep(0.5);
    await ctx.tap(80, 830);
    await ctx.sleep(1);
    return { result: 'stamina_insufficient', joined: 0, targetType: detectedTarget!, distance: detectedDistance };
  }

  return { result: 'stamina_insufficient', joined: 0, targetType: detectedTarget!, distance: detectedDistance };
}
