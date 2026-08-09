import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureInWorld } from '../utils/location';
import { ensureTeamPage, TeamPage } from '../utils/teamPage';
import { detectTeamStates } from '../utils/teamStateDetection';
import { handleMarchWithStamina } from '../utils/stamina';
import { ocrService } from '../../../core/ocr/OcrService';
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
const SUREGO_TEMPLATE = path.join(TEMPLATE_DIR, 'jijie', 'btn_surego.png');

const MARCH_BUTTON_RECT = { x1: 1031, y1: 754, x2: 1292, y2: 820 };
const MARCH_BUTTON = { x: 1154, y: 791 };

const TEAM_BUTTONS_NO_PAGE: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 362 }, 2: { x: 1378, y: 430 },
  3: { x: 1378, y: 497 }, 4: { x: 1378, y: 566 }, 5: { x: 1378, y: 633 },
};
const TEAM_BUTTONS_PAGED: Record<number, { x: number; y: number }> = {
  1: { x: 1378, y: 397 }, 2: { x: 1378, y: 463 },
  3: { x: 1378, y: 533 }, 4: { x: 1378, y: 600 }, 5: { x: 1378, y: 671 },
};

const LARGE_REGION = { x: 1443, y: 53, w: 152, h: 753 };
const AVATAR_OFFSET = { dx: -25, dy: -25 };
const TOP_SLOT_REGION = { x1: 1530, y1: 220, x2: 1582, y2: 310 };

const ZHUZHA_WAIT_TIMEOUT_SEC = 300;
const ZHUZHA_POLL_INTERVAL_SEC = 5;

export type AttackBarbarianResult =
  | 'success' | 'not_found' | 'no_attack_button' | 'no_biandui'
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

type SearchAttackState = 'attacked' | 'not_found' | 'no_attack_button';

/** 设级并搜索一次，返回搜索结果 */
async function searchAndAttack(ctx: PluginContext, level: number): Promise<SearchAttackState> {
  await setSearchLevel(ctx, level);
  ctx.log(`  点击搜索按钮 Lv.${level}`);
  const changed = await ctx.checkButtonStateChangeRect(
    SEARCH_ACTION_RECT.x1, SEARCH_ACTION_RECT.y1, SEARCH_ACTION_RECT.x2, SEARCH_ACTION_RECT.y2, 0.05,
  );
  if (!changed) {
    ctx.log(`  ❌ Lv.${level} 未搜索到野蛮人`);
    return 'not_found';
  }
  await ctx.sleep(2.5);
  const atk = await ctx.findImageWithLocation(BTN_ATTACK_TEMPLATE, 0.7, [0.9, 1.0, 1.1]);
  if (!atk.found) {
    ctx.log(`  ❌ 未找到攻击按钮 (conf=${atk.confidence.toFixed(3)})`);
    return 'no_attack_button';
  }
  await ctx.tap(atk.x, atk.y);
  await ctx.sleep(1.5);
  return 'attacked';
}

/** 从 initialLevel 开始，依次尝试相邻等级；reopenPanel 控制首次是否需要重开面板 */
async function searchWithNeighbors(
  ctx: PluginContext,
  initialLevel: number,
  reopenPanel: boolean,
): Promise<{ level: number; attackState: 'attacked' | 'no_attack_button' } | null> {
  if (reopenPanel) {
    await ctx.tapRect(SEARCH_ENTRY_RECT.x1, SEARCH_ENTRY_RECT.y1, SEARCH_ENTRY_RECT.x2, SEARCH_ENTRY_RECT.y2);
    await ctx.sleep(1.5);
  }
  const candidates = [initialLevel, ...neighborLevelOrder(initialLevel, BARB_MAX_LEVEL)];
  for (let i = 0; i < candidates.length; i++) {
    const lv = candidates[i];
    if (i > 0) {
      await ctx.tapRect(SEARCH_ENTRY_RECT.x1, SEARCH_ENTRY_RECT.y1, SEARCH_ENTRY_RECT.x2, SEARCH_ENTRY_RECT.y2);
      await ctx.sleep(1.5);
    }
    const r = await searchAndAttack(ctx, lv);
    if (r === 'attacked') return { level: lv, attackState: 'attacked' };
    if (r === 'no_attack_button') return { level: lv, attackState: 'no_attack_button' };
  }
  return null;
}
