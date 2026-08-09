import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';
import { getTeamButtons } from '../utils/teamButtons';
import { detectTeamStates } from '../utils/teamStateDetection';
import { handleMarchWithStamina } from '../utils/stamina';
import { ocrService } from '../../../core/ocr/OcrService';
import { parseTeamCount } from './rallyFort';
import * as path from 'path';
import * as fsp from 'fs/promises';
import sharp from 'sharp';

const TEMPLATE_DIR = getTemplatesDir();
const BARB_MAX_LEVEL = 40;

const SEARCH_ENTRY_RECT = { x1: 42, y1: 645, x2: 110, y2: 704 };
const BARBARIAN_TAB_POINT = { x: 148, y: 294 };
const LEVEL_OCR_RECT = { x1: 126, y1: 425, x2: 564, y2: 454 };
const LEVEL_MINUS_RECT = { x1: 102, y1: 467, x2: 137, y2: 501 };
const LEVEL_PLUS_RECT = { x1: 539, y1: 467, x2: 576, y2: 501 };
const LEVEL_RESET_BTN = { x: 167, y: 486 };
const SEARCH_ACTION_RECT = { x1: 244, y1: 561, x2: 436, y2: 626 };

const WORLD_SWITCH_BUTTON_RECT = { x1: 39, y1: 776, x2: 115, y2: 858 };
const CLOSE_POPUP_BUTTON = { x: 1392, y: 57 };
const CLOSE_STAMINA_POPUP = { x: 1363, y: 103 };
const TILI_BUTTON_REGION = { x: 1014, y: 242, width: 1358 - 1014, height: 407 - 242 };

const BTN_ATTACK_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_attack.png');
const BTN_BIANDUI_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'btn_biandui.png');
const BTN_XINGJUN_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_xingjun.png');
const BTN_XINGJUN_REGION = { x: 1068, y: 20, width: 362, height: 860 };
const PAGE_INDICATOR_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_page_indicator.png');

const MARCH_BUTTON_RECT = { x1: 1031, y1: 754, x2: 1292, y2: 820 };
const MARCH_BUTTON = { x: 1154, y: 791 };

const LARGE_REGION = { x: 1443, y: 53, w: 152, h: 753 };
const AVATAR_OFFSET = { dx: -25, dy: -25 };
/** 召回部队按钮（点开驻扎队伍信息面板后） */
const RECALL_BUTTON = { x: 924, y: 570 };
const TOP_SLOT_REGION = { x1: 1537, y1: 252, x2: 1575, y2: 299 };

const ZHUZHA_WAIT_TIMEOUT_SEC = 300;
const ZHUZHA_POLL_INTERVAL_SEC = 5;

export type AttackBarbarianResult =
  | 'success' | 'not_found' | 'no_march_button' | 'no_biandui'
  | 'team_unavailable' | 'stamina_insufficient' | 'zhuzha_timeout';

export interface AttackBarbarianParams {
  level: number;
  count: number;
  team: number;
  teamPage: TeamPage;
  usePotion: boolean;
}

export function neighborLevelOrder(target: number, maxLevel: number): number[] {
  const order: number[] = [];
  const seen = new Set<number>([target]);
  for (const d of [-1, +1, -2, +2]) {
    const lv = target + d;
    if (lv >= 1 && lv <= maxLevel && !seen.has(lv)) { order.push(lv); seen.add(lv); }
  }
  return order;
}

/** OCR 读取搜索面板当前野蛮人等级，失败返回 null */
async function readCurrentLevel(ctx: PluginContext): Promise<number | null> {
  let shot: string | null = null;
  let processed: string | null = null;
  try {
    shot = await ctx.captureRegion(
      LEVEL_OCR_RECT.x1, LEVEL_OCR_RECT.y1,
      LEVEL_OCR_RECT.x2 - LEVEL_OCR_RECT.x1,
      LEVEL_OCR_RECT.y2 - LEVEL_OCR_RECT.y1,
    );
    processed = shot.replace(/\.png$/i, '_lvl.png');
    await sharp(shot)
      .resize({ width: (LEVEL_OCR_RECT.x2 - LEVEL_OCR_RECT.x1) * 3, kernel: 'nearest' })
      .grayscale()
      .normalise()
      .toFile(processed);

    const txt = await ocrService.readChineseText(processed);
    ctx.log(`  [OCR] 打野等级原始识别: "${txt.replace(/\s+/g, ' ')}"`);

    const m = txt.match(/等\s*级[^\d]{0,5}(\d{1,2})/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= BARB_MAX_LEVEL) return n;
    }
    const nums = txt.match(/\d{1,2}/g) || [];
    for (const s of nums) {
      const n = parseInt(s, 10);
      if (n >= 1 && n <= BARB_MAX_LEVEL) return n;
    }
    return null;
  } catch (e) {
    ctx.log(`  [OCR] 打野等级识别异常: ${(e as Error).message}`);
    return null;
  } finally {
    if (shot) await fsp.unlink(shot).catch(() => {});
    if (processed) await fsp.unlink(processed).catch(() => {});
  }
}

/** 设置搜索等级到 targetLevel，返回 targetLevel */
async function setSearchLevel(ctx: PluginContext, targetLevel: number): Promise<number> {
  const ocrLevel = await readCurrentLevel(ctx);
  if (ocrLevel !== null) {
    const diff = targetLevel - ocrLevel;
    if (diff > 0) {
      for (let i = 0; i < diff; i++) {
        await ctx.tapRect(LEVEL_PLUS_RECT.x1, LEVEL_PLUS_RECT.y1, LEVEL_PLUS_RECT.x2, LEVEL_PLUS_RECT.y2);
        await ctx.sleep(0.15);
      }
    } else if (diff < 0) {
      for (let i = 0; i < -diff; i++) {
        await ctx.tapRect(LEVEL_MINUS_RECT.x1, LEVEL_MINUS_RECT.y1, LEVEL_MINUS_RECT.x2, LEVEL_MINUS_RECT.y2);
        await ctx.sleep(0.15);
      }
    }
    return targetLevel;
  }
  await ctx.tap(LEVEL_RESET_BTN.x, LEVEL_RESET_BTN.y);
  await ctx.sleep(0.3);
  for (let i = 0; i < targetLevel - 1; i++) {
    await ctx.tapRect(LEVEL_PLUS_RECT.x1, LEVEL_PLUS_RECT.y1, LEVEL_PLUS_RECT.x2, LEVEL_PLUS_RECT.y2);
    await ctx.sleep(0.15);
  }
  return targetLevel;
}

type SearchAttackState = 'attacked' | 'not_found';

/**
 * 设级并搜索一次。
 * 注意：搜索按钮自身的按下动画会让 checkButtonStateChangeRect 误判为"有变化"，
 * 因此最终以"攻击按钮是否真的出现"作为搜到目标的判据；没出现就视为该等级未搜到，
 * 交由上层降级重试相邻等级。
 */
async function searchAndAttack(ctx: PluginContext, level: number): Promise<SearchAttackState> {
  await setSearchLevel(ctx, level);
  ctx.log(`  点击搜索按钮 Lv.${level}`);
  await ctx.checkButtonStateChangeRect(
    SEARCH_ACTION_RECT.x1, SEARCH_ACTION_RECT.y1, SEARCH_ACTION_RECT.x2, SEARCH_ACTION_RECT.y2, 0.05,
  );
  await ctx.sleep(2.5);
  const atk = await ctx.findImageWithLocation(BTN_ATTACK_TEMPLATE, 0.7, [0.9, 1.0, 1.1]);
  if (!atk.found) {
    ctx.log(`  ❌ Lv.${level} 附近未找到野蛮人（无攻击按钮 conf=${atk.confidence.toFixed(3)}），尝试相邻等级`);
    return 'not_found';
  }
  await ctx.tap(atk.x, atk.y);
  await ctx.sleep(1.5);
  return 'attacked';
}

/** 从 initialLevel 开始，依次尝试相邻等级；reopenPanel 控制首次是否需要重开面板。
 *  全部等级都搜不到时返回 null。 */
async function searchWithNeighbors(
  ctx: PluginContext,
  initialLevel: number,
  reopenPanel: boolean,
): Promise<{ level: number } | null> {
  if (reopenPanel) {
    await ctx.tapRect(SEARCH_ENTRY_RECT.x1, SEARCH_ENTRY_RECT.y1, SEARCH_ENTRY_RECT.x2, SEARCH_ENTRY_RECT.y2);
    await ctx.sleep(1.5);
  }
  const candidates = [initialLevel, ...neighborLevelOrder(initialLevel, BARB_MAX_LEVEL)];
  for (const lv of candidates) {
    const r = await searchAndAttack(ctx, lv);
    if (r === 'attacked') return { level: lv };
  }
  return null;
}

/** 点击回城按钮 */
async function backToCity(ctx: PluginContext): Promise<void> {
  await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
  await ctx.sleep(2);
}

/** 从仍打开的搜索面板退出：第一次关面板，第二次回城 */
async function backFromSearchPanel(ctx: PluginContext): Promise<void> {
  await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
  await ctx.sleep(1);
  await ctx.tapRect(WORLD_SWITCH_BUTTON_RECT.x1, WORLD_SWITCH_BUTTON_RECT.y1, WORLD_SWITCH_BUTTON_RECT.x2, WORLD_SWITCH_BUTTON_RECT.y2);
  await ctx.sleep(2);
}

/** 关闭弹窗并回城 */
async function closeAndCity(ctx: PluginContext): Promise<void> {
  await ctx.tap(CLOSE_POPUP_BUTTON.x, CLOSE_POPUP_BUTTON.y);
  await ctx.sleep(0.5);
  await backToCity(ctx);
}

/** 点击编队按钮，未检测到时等待 2s 重试一次 */
async function tapBiandui(ctx: PluginContext): Promise<boolean> {
  let btn = await ctx.findImageWithLocation(BTN_BIANDUI_TEMPLATE, 0.6);
  if (!btn.found) {
    ctx.log(`  未检测到编队按钮，等待 2s 后重试一次`);
    await ctx.sleep(2);
    btn = await ctx.findImageWithLocation(BTN_BIANDUI_TEMPLATE, 0.6);
  }
  if (!btn.found) {
    ctx.log(`  重试后仍未检测到编队按钮`);
    return false;
  }
  await ctx.tap(btn.x, btn.y);
  await ctx.sleep(1);
  return true;
}

type SelectMarchResult = 'marched' | 'team_unavailable' | 'stamina_insufficient';

/** 选队并行军（含体力处理） */
async function selectTeamAndMarch(
  ctx: PluginContext,
  team: number,
  teamPage: TeamPage,
  usePotion: boolean,
  logPrefix: string,
): Promise<SelectMarchResult> {
  const page = await ctx.findImageWithLocation(PAGE_INDICATOR_TEMPLATE, 0.8);
  if (page.found) {
    const ok = await ensureTeamPage(ctx, teamPage, { x: page.x, y: page.y });
    if (!ok) return 'team_unavailable';
  }

  // 选队弹窗布局与采集一致（非 joinRally 的集结列表），共用 teamButtons 坐标表
  const buttons = getTeamButtons(page.found);
  const btn = buttons[team];
  if (!btn) return 'team_unavailable';

  ctx.log(`${logPrefix} 选择队伍${team} 并检测选中状态`);
  const changed = await ctx.checkButtonStateChange(btn.x, btn.y, 150, 50, 0.1);
  if (!changed) return 'team_unavailable';

  const r = await handleMarchWithStamina(
    ctx,
    TILI_BUTTON_REGION,
    usePotion,
    async () => {
      ctx.log(`  点击行军 (${MARCH_BUTTON.x},${MARCH_BUTTON.y})`);
      await ctx.tapRect(MARCH_BUTTON_RECT.x1, MARCH_BUTTON_RECT.y1, MARCH_BUTTON_RECT.x2, MARCH_BUTTON_RECT.y2);
    },
    async () => {
      await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
      await ctx.sleep(0.5);
      await closeAndCity(ctx);
    },
  );

  return r === 'marched' ? 'marched' : 'stamina_insufficient';
}

/** 等待最上方槽位出现驻扎状态，超时返回 false */
async function waitForTopZhuzha(ctx: PluginContext): Promise<boolean> {
  const deadline = Date.now() + ZHUZHA_WAIT_TIMEOUT_SEC * 1000;
  let probeCount = 0;
  while (Date.now() < deadline) {
    const states = await detectTeamStates(ctx, ['zhuzha']);
    const found = states.find(s =>
      s.x >= TOP_SLOT_REGION.x1 && s.x <= TOP_SLOT_REGION.x2 &&
      s.y >= TOP_SLOT_REGION.y1 && s.y <= TOP_SLOT_REGION.y2,
    );
    if (found) {
      ctx.log(`  队伍已驻扎 (${found.x},${found.y}) conf=${(found.confidence * 100).toFixed(1)}%`);
      return true;
    }
    // [临时诊断] 每 6 次探测（约 30s）仍检不到时，存全屏截图并用低阈值全类别重跑
    probeCount++;
    if (probeCount % 6 === 0) {
      await dumpZhuzhaDiagnostics(ctx, probeCount);
    }
    ctx.log(`  等待驻扎中...（每 ${ZHUZHA_POLL_INTERVAL_SEC}s 检测）`);
    for (let i = 0; i < ZHUZHA_POLL_INTERVAL_SEC; i++) {
      await ctx.sleep(1);
    }
  }
  return false;
}

/** [临时诊断] 保存当前全屏截图，并用 0.2 低阈值跑全类别 state.onnx，打印原始候选 */
async function dumpZhuzhaDiagnostics(ctx: PluginContext, probeCount: number): Promise<void> {
  let shot: string | null = null;
  try {
    shot = await ctx.captureRegion(0, 0, 1600, 900);
    const saved = path.join(process.cwd(), 'temp', `zhuzha-diag-${probeCount}-${Date.now()}.png`);
    await fsp.copyFile(shot, saved);
    ctx.log(`  [诊断] 已保存截图: ${saved}`);
    const raw = await ctx.detectStateImage(shot, 0.2, [0, 1, 2, 3]);
    if (raw.length === 0) {
      ctx.log(`  [诊断] 低阈值(0.2)全类别检测仍无任何候选`);
    } else {
      const names = ['back', 'caiji', 'totarget', 'zhuzha'];
      ctx.log(`  [诊断] 低阈值候选 ${raw.length} 个: ` + raw
        .map(d => `${names[d.classIndex] ?? d.classIndex}(${Math.round(d.x)},${Math.round(d.y)})=${(d.confidence * 100).toFixed(1)}%`)
        .join(', '));
    }
  } catch (e) {
    ctx.log(`  [诊断] 异常: ${(e as Error).message}`);
  } finally {
    if (shot) await fsp.unlink(shot).catch(() => {});
  }
}

/** 末次攻击后：点开最上方驻扎队伍并召回部队 */
async function recallTopGarrison(ctx: PluginContext): Promise<boolean> {
  const states = await detectTeamStates(ctx, ['zhuzha']);
  const found = states.find(s =>
    s.x >= TOP_SLOT_REGION.x1 && s.x <= TOP_SLOT_REGION.x2 &&
    s.y >= TOP_SLOT_REGION.y1 && s.y <= TOP_SLOT_REGION.y2,
  );
  if (!found) {
    ctx.log(`  ⚠️ 未在最上方槽位找到驻扎队伍，跳过召回`);
    return false;
  }
  await ctx.tap(found.x, found.y);
  await ctx.sleep(1);
  ctx.log(`  点击召回部队 (${RECALL_BUTTON.x},${RECALL_BUTTON.y})`);
  await ctx.tap(RECALL_BUTTON.x, RECALL_BUTTON.y);
  await ctx.sleep(1.5);
  return true;
}

/** 点击驻扎中队伍头像并点行军，继续攻击下一个目标（含体力处理） */
async function marchFromGarrison(
  ctx: PluginContext,
  usePotion: boolean,
): Promise<'marched' | 'no_march_button' | 'stamina_insufficient'> {
  const states = await detectTeamStates(ctx, ['zhuzha']);
  const garrisons = states.filter(s =>
    s.x >= LARGE_REGION.x && s.x <= LARGE_REGION.x + LARGE_REGION.w &&
    s.y >= LARGE_REGION.y && s.y <= LARGE_REGION.y + LARGE_REGION.h,
  );
  garrisons.sort((a, b) => a.y - b.y);
  const z = garrisons[0];
  if (!z) {
    ctx.log(`  ⚠️ 未找到驻扎队伍`);
    return 'no_march_button';
  }
  await ctx.tap(z.x + AVATAR_OFFSET.dx, z.y + AVATAR_OFFSET.dy);
  await ctx.sleep(1);

  // 先确认行军按钮存在，再进入体力流程；否则 util 会在没点行军的情况下误判体力弹窗并误点药水
  const btn = await ctx.findImageWithLocation(
    BTN_XINGJUN_TEMPLATE, 0.7, [0.9, 1.0, 1.1], false, undefined, BTN_XINGJUN_REGION,
  );
  if (!btn.found) {
    ctx.log(`  ⚠️ 未找到行军按钮 (conf=${btn.confidence.toFixed(3)})`);
    return 'no_march_button';
  }

  const result = await handleMarchWithStamina(
    ctx,
    TILI_BUTTON_REGION,
    usePotion,
    async () => {
      await ctx.tap(btn.x, btn.y);
    },
    async () => {
      await ctx.tap(CLOSE_STAMINA_POPUP.x, CLOSE_STAMINA_POPUP.y);
      await ctx.sleep(0.5);
      await closeAndCity(ctx);
    },
  );

  return result === 'marched' ? 'marched' : 'stamina_insufficient';
}

export async function attackBarbarian(
  ctx: PluginContext,
  config: RokConfig,
  params: AttackBarbarianParams,
): Promise<{ result: AttackBarbarianResult }> {
  const { team, teamPage, usePotion } = params;
  const count = Math.max(1, Math.round(params.count) || 1);
  let currentLevel = Math.min(Math.max(1, Math.round(params.level)), BARB_MAX_LEVEL);
  ctx.log(`=== 自动打野 Lv.${currentLevel} 队伍${team} 共${count}次 ===`);

  // 预备：OCR 队伍计数，满队跳过
  const shot = await ctx.captureRegion(1507, 169, 55, 31);
  try {
    const text = (await ocrService.readTeamCount(shot)).trim();
    ctx.log(`[预备] 队伍计数 OCR: "${text}"`);
    const teamCount = parseTeamCount(text);
    if (teamCount && teamCount.used >= teamCount.total) {
      ctx.log(`⏭️ 无空闲队伍 (${teamCount.used}/${teamCount.total})，跳过打野`);
      await backToCity(ctx);
      return { result: 'team_unavailable' };
    }
  } finally {
    await fsp.unlink(shot).catch(() => {});
  }

  await ensureInWorld(ctx, config, { resetView: false });

  for (let i = 0; i < count; i++) {
    ctx.log(`--- 第 ${i + 1}/${count} 次攻击 ---`);

    if (i === 0) {
      await ctx.tapRect(SEARCH_ENTRY_RECT.x1, SEARCH_ENTRY_RECT.y1, SEARCH_ENTRY_RECT.x2, SEARCH_ENTRY_RECT.y2);
      await ctx.sleep(1.5);
      await ctx.tap(BARBARIAN_TAB_POINT.x, BARBARIAN_TAB_POINT.y);
      await ctx.sleep(1);

      const r = await searchWithNeighbors(ctx, currentLevel, false);
      if (!r) { await backFromSearchPanel(ctx); return { result: 'not_found' }; }
      currentLevel = r.level;

      if (!await tapBiandui(ctx)) { await closeAndCity(ctx); return { result: 'no_biandui' }; }

      const mr = await selectTeamAndMarch(ctx, team, teamPage, usePotion, '[首次]');
      if (mr === 'team_unavailable') { await closeAndCity(ctx); return { result: 'team_unavailable' }; }
      if (mr === 'stamina_insufficient') { return { result: 'stamina_insufficient' }; }
    } else {
      const r = await searchWithNeighbors(ctx, currentLevel, true);
      if (!r) { await backFromSearchPanel(ctx); return { result: 'not_found' }; }
      currentLevel = r.level;

      const gr = await marchFromGarrison(ctx, usePotion);
      if (gr === 'no_march_button') { await closeAndCity(ctx); return { result: 'no_march_button' }; }
      if (gr === 'stamina_insufficient') { return { result: 'stamina_insufficient' }; }
    }

    // 每次攻击后都等待驻扎；末次等待是为了确认部队驻扎后召回
    ctx.log(`  等待队伍驻扎...`);
    const ok = await waitForTopZhuzha(ctx);
    if (!ok) {
      ctx.log(`  ⚠️ 等待驻扎超时（${ZHUZHA_WAIT_TIMEOUT_SEC}s）`);
      await backToCity(ctx);
      return { result: 'zhuzha_timeout' };
    }

    if (i === count - 1) {
      ctx.log(`  末次攻击完成，召回部队`);
      await recallTopGarrison(ctx);
    }
  }

  await backToCity(ctx);
  ctx.log(`=== 自动打野完成，共 ${count} 次 ===`);
  return { result: 'success' };
}
