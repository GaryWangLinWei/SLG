import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ocrService } from '../../../core/ocr/OcrService';
import { RokConfig } from '../index';
import { sharedGemPool, SharedGemCoord } from '../state/sharedGemPool';
import { locateByCoord } from '../utils/locateCoord';
import { getCurrentLocation, tapWorldSwitchButton } from '../utils/location';
import { collectSharedGemCoords } from './collectSharedGemCoords';
import {
  dispatchToTeamPopup,
  verifyGemAtCenter,
} from './gatherGem';
import {
  detectStatusRegionTeamStates,
  detectTeamStates,
} from '../utils/teamStateDetection';
import { TeamPage } from '../utils/teamPage';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

const REFILL_THRESHOLD = 5;

// 与 gatherGemFocus 同源
const ZHUZHA_BUTTON = { x: 800, y: 593 };
const AVATAR_OFFSET = { dx: -25, dy: -25 };
const COORD_OCR_REGION = { x: 400, y: 11, w: 137, h: 32 };
const WORLD_SWITCH_BUTTON = { x: 82, y: 814 };
const MARCH_BTN_TEMPLATE = path.join(getTemplatesDir(), 'btn_xingjun.png');
const MARCH_SEARCH_REGION = { x: 1068, y: 20, width: 362, height: 860 };
const LARGE_REGION = { x: 1443, y: 53, w: 152, h: 753 };

// 测试阶段调试目录
const DEBUG_DIR = 'D:/SLG/temp/debug/shared_gem';
async function saveDebugShot(ctx: PluginContext, tag: string): Promise<void> {
  try {
    await fs.mkdir(DEBUG_DIR, { recursive: true });
    const buf = await ctx.getScreenshot();
    const out = path.join(DEBUG_DIR, `${tag}_${Date.now()}.png`);
    await sharp(buf).toFile(out);
    ctx.log(`  [调试] 截图: ${out}`);
  } catch (e) {
    ctx.log(`  [调试] 截图失败: ${(e as Error).message}`);
  }
}

/** 调试：保存带标注的 caiji 检测截图。红框=检测到的 caiji，绿框=过滤区域 */
async function saveCaijiDebugShot(
  ctx: PluginContext,
  tag: string,
  region: { x: number; y: number; w: number; h: number },
  caiji: Array<{ x: number; y: number; confidence: number }>
): Promise<void> {
  try {
    await fs.mkdir(DEBUG_DIR, { recursive: true });
    const buf = await ctx.getScreenshot();
    const img = sharp(buf);
    const meta = await img.metadata();
    const W = meta.width ?? 1600;
    const H = meta.height ?? 900;
    const boxes = caiji.map(c => `<rect x="${c.x - 20}" y="${c.y - 20}" width="40" height="40" fill="none" stroke="red" stroke-width="3"/><text x="${c.x - 20}" y="${c.y - 24}" fill="red" font-size="14">${c.confidence.toFixed(2)}</text>`).join('');
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}" fill="none" stroke="lime" stroke-width="2"/>${boxes}</svg>`;
    const out = path.join(DEBUG_DIR, `${tag}_${Date.now()}.png`);
    await img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(out);
    ctx.log(`  [调试] caiji 标注截图: ${out} (框内 ${caiji.length} 个)`);
  } catch (e) {
    ctx.log(`  [调试] caiji 标注截图失败: ${(e as Error).message}`);
  }
}

export interface GatherSharedGemOutcome {
  result: 'ok' | 'empty' | 'no_team';
  gathered: number;
}

export interface GatherSharedGemParams {
  /** 组合模式下跨账号共用的池 key；普通模式默认使用 accountId。 */
  poolAccountId?: string;
  /** Skip chat box collect (combo mode: coords from small accounts) */
  skipChatCollect?: boolean;
  accountId: string;
  teams: number[];
  teamPage?: TeamPage;
  homeX?: number;
  homeY?: number;
}

async function ensureInWorldLite(ctx: PluginContext): Promise<void> {
  const loc = await getCurrentLocation(ctx);
  if (loc !== 'world') {
    ctx.log('  [位置] 不在城外，切换');
    await tapWorldSwitchButton(ctx);
    await ctx.sleep(2);
  } else {
    ctx.log('  [位置] 已在城外');
  }
}

async function refillIfNeeded(
  ctx: PluginContext,
  poolAccountId: string,
  skipChatCollect?: boolean
): Promise<void> {
  if (skipChatCollect) {
    ctx.log(`[pool refill] combo mode, skip chat collect (from small accounts)`);
    return;
  }
  ctx.log(`[pool refill] count ${sharedGemPool.size(poolAccountId)} < ${REFILL_THRESHOLD}，触发收集`);
  await collectSharedGemCoords(ctx, poolAccountId);
  await ensureInWorldLite(ctx);
}

/** OCR 顶部当前坐标 (400,11,137,32) → {x, y}，失败返回 null */
async function readCurrentCoord(ctx: PluginContext): Promise<SharedGemCoord | null> {
  const clipPath = await ctx.captureRegion(
    COORD_OCR_REGION.x, COORD_OCR_REGION.y, COORD_OCR_REGION.w, COORD_OCR_REGION.h
  );
  try {
    const text = await ocrService.readText(clipPath);
    const m = text.match(/X[:：]?\s*(\d+)\s*Y[:：]?\s*(\d+)/i);
    if (m) {
      const x = parseInt(m[1], 10);
      const y = parseInt(m[2], 10);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    // 兜底：readCoordinates 纯数字模式 → 从中间切分 4+3/3+4 位
    const digits = (await ocrService.readCoordinates(clipPath)).replace(/\D/g, '');
    if (digits.length >= 6 && digits.length <= 8) {
      // 万国觉醒 X/Y 都 3-4 位；假定二者位数相等或差 1，先试对半分
      const mid = Math.floor(digits.length / 2);
      const candidates: Array<[number, number]> = [
        [mid, digits.length - mid],
        [mid + 1, digits.length - mid - 1],
      ];
      for (const [lx, ly] of candidates) {
        if (lx < 3 || lx > 4 || ly < 3 || ly > 4) continue;
        const x = parseInt(digits.slice(0, lx), 10);
        const y = parseInt(digits.slice(lx, lx + ly), 10);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          ctx.log(`  [坐标兜底] "${digits}" → (${x},${y})`);
          return { x, y };
        }
      }
    }
    ctx.log(`  ⚠️ 当前坐标 OCR 无法解析: "${text.trim()}" / "${digits}"`);
    await saveDebugShot(ctx, 'readCurrentCoord_fail');
    return null;
  } catch (e) {
    ctx.log(`  ⚠️ 当前坐标 OCR 失败: ${(e as Error).message}`);
    return null;
  } finally {
    await fs.unlink(clipPath).catch(() => {});
  }
}

/**
 * 从池中找到距 anchor 最近的坐标并 pop 出来。空池返回 null。
 */
function popNearest(poolAccountId: string, anchor: SharedGemCoord): SharedGemCoord | null {
  const snap = sharedGemPool.snapshot(poolAccountId);
  if (snap.length === 0) return null;
  let bestIdx = 0;
  let bestDist2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < snap.length; i++) {
    const dx = snap[i].x - anchor.x;
    const dy = snap[i].y - anchor.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestIdx = i;
    }
  }
  return sharedGemPool.removeAt(poolAccountId, bestIdx) ?? null;
}

/**
 * 传送到坐标 → 中心验证 → 点宝石 → 找采集 → 根据 mode 派兵。
 *
 * 中心验证或采集按钮失败时不放弃：从池中继续找下一个最近矿重试，
 * 直到成功进入派兵阶段或池空。
 *
 * mode='dispatch': 走 dispatchToTeamPopup 弹队伍列表选空闲队伍派兵（用于 step 3）
 * mode='march':    检测驻扎队伍，若无驻扎点城内切换按钮并返回 needRestart；有则点最上驻扎头像 → 找行军按钮 → 点击（用于 step 1）
 */
async function gatherOne(
  ctx: PluginContext,
  config: RokConfig,
  firstTarget: SharedGemCoord,
  anchor: SharedGemCoord,
  poolAccountId: string,
  teams: number[],
  nextTeamIdx: number,
  hasPaging: boolean | null,
  collectedCoords: string[],
  teamPage: TeamPage,
  mode: 'dispatch' | 'march'
): Promise<{ dispatched: boolean; allTeamsBusy: boolean; nextTeamIdx: number; hasPaging: boolean | null; skipped: boolean; needRestart: boolean }> {
  const caijiBtnTemplate = path.join(getTemplatesDir(), config.gemGather.caijiBtnTemplate);

  // 内层循环：不停从池取最近矿，直到成功点到采集按钮
  let target: SharedGemCoord | null = firstTarget;
  while (target) {
    ctx.log(`  [定位] 目标 (${target.x},${target.y})`);
    await locateByCoord(ctx, target.x, target.y);
    await ctx.sleep(2);

    const verified = await verifyGemAtCenter(ctx);
    if (!verified.found) {
      await saveDebugShot(ctx, 'verify_fail');
      ctx.log(`  ⚠️ (${target.x},${target.y}) 中心未确认宝石，从池找下一个最近矿`);
      target = popNearest(poolAccountId, anchor);
      continue;
    }

    // caiji 占用检测：全屏检测后按 verify 坐标 ±60px 边界过滤
    // （避免 120x120 小区域被 ONNX resize 到 640×640 拉伸导致漏检）
    const cx = verified.x!;
    const cy = verified.y!;
    const caijiRegion = {
      x: Math.max(0, cx - 60),
      y: Math.max(0, cy - 60),
      w: 120,
      h: 120,
    };
    const allCaiji = await detectTeamStates(ctx, ['caiji']);
    const caijiStates = allCaiji.filter(d =>
      d.x >= caijiRegion.x && d.x <= caijiRegion.x + caijiRegion.w &&
      d.y >= caijiRegion.y && d.y <= caijiRegion.y + caijiRegion.h
    );
    await saveCaijiDebugShot(ctx, caijiStates.length > 0 ? 'caiji_hit' : 'caiji_miss', caijiRegion, allCaiji);
    if (caijiStates.length > 0) {
      ctx.log(`  ⚠️ (${target.x},${target.y}) 宝石上检测到 caiji 状态（已被采集），从池找下一个最近矿`);
      target = popNearest(poolAccountId, anchor);
      continue;
    }

    ctx.log(`  点击二次确认后的宝石位置 (${cx}, ${cy})`);
    await ctx.tap(cx, cy);
    await ctx.sleep(1);

    const caijiResult = await ctx.findImageWithLocation(caijiBtnTemplate, 0.7);
    if (!caijiResult.found) {
      ctx.log(`  ❌ (${target.x},${target.y}) 未找到采集按钮 (confidence: ${caijiResult.confidence.toFixed(3)})，从池找下一个最近矿`);
      target = popNearest(poolAccountId, anchor);
      continue;
    }
    ctx.log(`  点击采集按钮 (${caijiResult.x}, ${caijiResult.y})`);
    await ctx.tap(caijiResult.x, caijiResult.y);
    await ctx.sleep(1);
    break; // 成功进入派兵阶段
  }

  if (!target) {
    ctx.log(`  池已耗尽，没有可用矿点`);
    return { dispatched: false, allTeamsBusy: false, nextTeamIdx, hasPaging, skipped: true, needRestart: false };
  }

  if (mode === 'dispatch') {
    const r = await dispatchToTeamPopup(ctx, config, teams, nextTeamIdx, hasPaging, collectedCoords, teamPage);
    return {
      dispatched: r.dispatched,
      allTeamsBusy: r.allTeamsBusy,
      nextTeamIdx: r.nextTeamIdx,
      hasPaging: r.hasPaging,
      skipped: false,
      needRestart: false,
    };
  }

  // mode === 'march': 驻扎接续行军（全屏检测后按 LARGE_REGION 过滤，避免拉伸漏检）
  const allZ = await detectTeamStates(ctx, ['zhuzha']);
  const zStates = allZ.filter(d =>
    d.x >= LARGE_REGION.x && d.x <= LARGE_REGION.x + LARGE_REGION.w &&
    d.y >= LARGE_REGION.y && d.y <= LARGE_REGION.y + LARGE_REGION.h
  );
  if (zStates.length === 0) {
    ctx.log(`  ⚠️ 驻扎队伍为 0，点城内切换按钮 (${WORLD_SWITCH_BUTTON.x},${WORLD_SWITCH_BUTTON.y})，重跑 step 1`);
    await saveDebugShot(ctx, 'zhuzha_zero');
    await ctx.tap(WORLD_SWITCH_BUTTON.x, WORLD_SWITCH_BUTTON.y);
    await ctx.sleep(2);
    return { dispatched: false, allTeamsBusy: false, nextTeamIdx, hasPaging, skipped: false, needRestart: true };
  }
  const topZ = [...zStates].sort((a, b) => a.y - b.y)[0];
  const zx = topZ.x + AVATAR_OFFSET.dx;
  const zy = topZ.y + AVATAR_OFFSET.dy;
  ctx.log(`  点击最上驻扎队伍头像 (${zx}, ${zy})`);
  await ctx.tap(zx, zy);
  await ctx.sleep(1.5);

  const march = await ctx.findImageWithLocation(
    MARCH_BTN_TEMPLATE, 0.7, undefined, undefined, undefined, MARCH_SEARCH_REGION
  );
  if (!march.found) {
    ctx.log(`  ⚠️ 未找到行军按钮 (confidence: ${march.confidence.toFixed(3)})，跳过`);
    return { dispatched: false, allTeamsBusy: false, nextTeamIdx, hasPaging, skipped: true, needRestart: false };
  }
  ctx.log(`  点击行军按钮 (${march.x}, ${march.y})`);
  await ctx.tap(march.x, march.y);
  await ctx.sleep(1.5);
  return { dispatched: true, allTeamsBusy: false, nextTeamIdx, hasPaging, skipped: false, needRestart: false };
}

/**
 * 采集分享矿（专注模式，就近派兵）：
 * - step 1: 循环处理返回/驻扎队伍
 *     - 最上方是驻扎 → 直接点头像 → 读当前队伍坐标 → 从池找最近矿 → gatherOne
 *     - 最上方是返回 → 点头像 → 点驻扎按钮钉住 → 读当前队伍坐标 → 找最近矿 → gatherOne
 *     - 循环直到 STATUS_REGION 里再无返回/驻扎
 * - step 2: 全屏检测采集/前往/驻扎状态，配额满退出
 * - step 3: 无驻扎路径。以主城堡为锚，从池中找最近矿 → gatherOne
 */
export async function gatherSharedGem(
  ctx: PluginContext,
  config: RokConfig,
  params: GatherSharedGemParams
): Promise<GatherSharedGemOutcome> {
  const { accountId, teams } = params;
  const poolAccountId = params.poolAccountId ?? accountId;
  const teamPage: TeamPage = params.teamPage ?? 'gather';
  ctx.log(`=== 采集分享矿（专注模式）account=${accountId} pool=${poolAccountId} teams=[${teams.join(',')}] ===`);

  ctx.log(`[准备] 确保在城外`);
  await ensureInWorldLite(ctx);
  await refillIfNeeded(ctx, poolAccountId, params.skipChatCollect);
  ctx.log(`[准备] skipChatCollect = ${params.skipChatCollect}`);
  if (sharedGemPool.size(poolAccountId) === 0) {
    ctx.log(`[准备] 池为空，本轮结束`);
    return { result: 'empty', gathered: 0 };
  }

  // 主城堡坐标（前端传入）：供 step 3 计算最近矿
  let homeCoord: SharedGemCoord | null = null;
  if (params.homeX && params.homeY) {
    homeCoord = { x: params.homeX, y: params.homeY };
    ctx.log(`[准备] 主城堡坐标 (${homeCoord.x},${homeCoord.y})`);
  } else {
    ctx.log(`[准备] 未配置主城堡坐标，step 3 将按 FIFO`);
  }

  const collectedCoords: string[] = [];
  let nextTeamIdx = 0;
  let hasPaging: boolean | null = null;
  let gathered = 0;
  let quotaFull = false;

  while (true) {
    // === step 1: 循环处理返回/驻扎队伍 ===
    while (true) {
      if (sharedGemPool.size(poolAccountId) === 0) {
        ctx.log('[step 1] 池空，跳出 step 1');
        break;
      }

      const states = await detectStatusRegionTeamStates(ctx, ['back', 'zhuzha']);
      if (states.length === 0) {
        ctx.log('[step 1] 无返回/驻扎队伍');
        break;
      }
      // 最上方
      const top = [...states].sort((a, b) => a.y - b.y)[0];
      const tx = top.x + AVATAR_OFFSET.dx;
      const ty = top.y + AVATAR_OFFSET.dy;
      const isBack = top.state === 'back';
      ctx.log(`[step 1] 最上方${isBack ? '返回' : '驻扎'}队伍头像 (${tx}, ${ty})`);
      await ctx.tap(tx, ty);
      await ctx.sleep(1.5);

      if (isBack) {
        ctx.log(`[step 1] 点驻扎按钮 (${ZHUZHA_BUTTON.x}, ${ZHUZHA_BUTTON.y}) 钉住`);
        await ctx.tap(ZHUZHA_BUTTON.x, ZHUZHA_BUTTON.y);
        await ctx.sleep(1.5);
      }

      // 读当前队伍坐标（视角已跟到该队伍所在处）
      let anchor = await readCurrentCoord(ctx);
      if (!anchor) {
        if (homeCoord) {
          ctx.log('[step 1] ocr坐标失败，使用主城坐标');
          anchor = homeCoord;
        } else {
          ctx.log('[step 1] ocr坐标失败且无主城坐标，跳过本队伍');
          continue;
        }
      }
      ctx.log(`[step 1] 参考坐标 (${anchor.x},${anchor.y})，从池找最近矿`);

      const target = popNearest(poolAccountId, anchor);
      if (!target) {
        ctx.log('[step 1] 池已空，跳出');
        break;
      }
      ctx.log(`[step 1] 最近矿 (${target.x},${target.y})`);

      const r = await gatherOne(
        ctx, config, target, anchor, poolAccountId, teams, nextTeamIdx, hasPaging, collectedCoords, teamPage, 'march'
      );
      nextTeamIdx = r.nextTeamIdx;
      hasPaging = r.hasPaging;
      if (r.dispatched) {
        gathered++;
        ctx.log(`  ✅ 派兵成功，累计 ${gathered}`);
      } else if (!r.skipped && !r.needRestart) {
        ctx.log(`  ⚠️ 派兵失败`);
      }
      if (r.needRestart) {
        ctx.log('[step 1] 重跑 step 1');
        continue;
      }
      if (r.allTeamsBusy) {
        ctx.log(`[step 1] 队伍全忙，退出`);
        return { result: 'no_team', gathered };
      }
    }

    // === step 2: 配额检测 ===
    const states = await detectStatusRegionTeamStates(ctx, ['caiji', 'totarget', 'zhuzha']);
    const caijiCount = states.filter(s => s.state === 'caiji').length;
    const totargetCount = states.filter(s => s.state === 'totarget').length;
    const zhuzhaCount = states.filter(s => s.state === 'zhuzha').length;
    ctx.log(`[step 2] caiji=${caijiCount} totarget=${totargetCount} zhuzha=${zhuzhaCount}`);
    if (caijiCount + totargetCount >= teams.length) {
      ctx.log(`[step 2] 配额已满（${caijiCount + totargetCount}/${teams.length}），退出`);
      quotaFull = true;
      break;
    }

    // === step 3: 无驻扎路径 ===
    if (sharedGemPool.size(poolAccountId) === 0) {
      ctx.log('[step 3] 池空，退出');
      break;
    }

    let target: SharedGemCoord | null;
    if (homeCoord) {
      target = popNearest(poolAccountId, homeCoord);
      ctx.log(`[step 3] 主城堡最近矿 (${target?.x},${target?.y})`);
    } else {
      target = sharedGemPool.pop(poolAccountId) ?? null;
      ctx.log(`[step 3] FIFO pop 矿 (${target?.x},${target?.y})`);
    }
    if (!target) break;

    const step3Anchor = homeCoord ?? target;
    const r = await gatherOne(
      ctx, config, target, step3Anchor, poolAccountId, teams, nextTeamIdx, hasPaging, collectedCoords, teamPage, 'dispatch'
    );
    nextTeamIdx = r.nextTeamIdx;
    hasPaging = r.hasPaging;
    if (r.dispatched) {
      gathered++;
      ctx.log(`  ✅ 派兵成功，累计 ${gathered}`);
    } else if (!r.skipped) {
      ctx.log(`  ⚠️ 派兵失败`);
    }
    if (r.allTeamsBusy) {
      ctx.log(`[step 3] 队伍全忙，退出`);
      return { result: 'no_team', gathered };
    }
  }

  ctx.log(`=== 采集完成 gathered=${gathered} quotaFull=${quotaFull} ===`);
  return {
    result: quotaFull || gathered > 0 ? 'ok' : 'empty',
    gathered,
  };
}
