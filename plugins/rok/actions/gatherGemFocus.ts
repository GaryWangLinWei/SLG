import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';
// import sharp from 'sharp';
import { RokConfig } from '../index';
import { TeamPage } from '../utils/teamPage';
import {
  gatherGem,
  zoomOutToWorld,
  searchAndClickGem,
  checkIdleTeamsAvailable,
  dispatchToTeamPopup,
  createSpiralState,
} from './gatherGem';

const TEMPLATE_DIR = getTemplatesDir();

// 测试阶段：状态检测调试截图目录（已关闭）
// const DEBUG_DIR = 'D:/SLG/temp/debug/focus';

// function isDevEnv(): boolean {
//   try {
//     const { app } = require('electron');
//     return !app.isPackaged;
//   } catch {
//     return true;
//   }
// }

// 状态模板（保留行军按钮模板路径，其余状态改用 state.onnx 检测）
const MARCH_BTN_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_xingjun.png');

// 队伍状态类型 ↔ state.onnx 类别索引（0=返回 1=采集 2=行军 3=驻扎）
type TeamState = 'back' | 'caiji' | 'totarget' | 'zhuzha';
const STATE_CLASS_INDEX: Record<TeamState, number> = {
  back: 0,
  caiji: 1,
  totarget: 2,
  zhuzha: 3,
};
const CLASS_INDEX_STATE: Record<number, TeamState> = {
  0: 'back',
  1: 'caiji',
  2: 'totarget',
  3: 'zhuzha',
};

// 检测置信度阈值：按类别区分。驻扎类模型置信度偏低，单独放宽（待重训模型后统一）。
const STATE_DETECT_THRESHOLD = 0.35; // 推理时用最低阈值，过滤阶段再按类别卡
const STATE_CONF_THRESHOLD: Record<TeamState, number> = {
  back: 0.35,
  caiji: 0.35,
  totarget: 0.35,
  zhuzha: 0.35,
};

// step 4 大 UI 中驻扎队伍的检测区域 + 点击 X（图标在区域中线）
const LARGE_REGION  = { x: 1443, y: 53,  w: 152, h: 753 };
// 右侧采集状态面板检测区域: (1530,202)-(1582,680)
const STATUS_REGION = { x: 1530, y: 202, w: 52, h: 478 };
const ZHUZHA_BUTTON = { x: 800, y: 593 };
const EXIT_LARGE_UI_BUTTON = { x: 70, y: 834 };
const MARCH_SEARCH_REGION = { x: 1068, y: 20, width: 362, height: 860 };
const BACK_RETRY_LIMIT = 5;

// 状态图标 → 队伍头像的偏移：头像在状态图标左上方。点击作用到头像上才能选中/定位队伍。
const AVATAR_OFFSET = { dx: -25, dy: -25 };

export interface DetectedState {
  state: TeamState;
  x: number;
  y: number;
  confidence: number;
}

export interface GemGatherOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;
}

/**
 * 用 state.onnx 全屏检测队伍状态（不再拖动展开面板）。
 * 类别：0=返回 1=采集 2=行军 3=驻扎。
 * @param region 可选检测区域，命中框中心落在区域内才保留（如 step 4 的大 UI 区域）
 */
export async function detectTeamStates(
  ctx: PluginContext,
  states: TeamState[] = ['zhuzha', 'caiji', 'back', 'totarget'],
  region?: { x: number; y: number; w: number; h: number }
): Promise<DetectedState[]> {
  ctx.log(`[状态检测] state.onnx 全屏检测 states=[${states.join(',')}]`);

  // 截全屏（用于检测 + 调试标注）。检测全部 4 类，便于调试图标注所有识别到的类；
  // 功能过滤（只保留请求的 states）在下方循环里做。
  const shotPath = await ctx.captureRegion(0, 0, 1600, 900);
  let dets: Awaited<ReturnType<typeof ctx.detectStateImage>>;
  try {
    dets = await ctx.detectStateImage(shotPath, STATE_DETECT_THRESHOLD, [0, 1, 2, 3]);

    const results: DetectedState[] = [];
    for (const d of dets) {
      const state = CLASS_INDEX_STATE[d.classIndex];
      if (!state || !states.includes(state)) continue;
      if (d.confidence < STATE_CONF_THRESHOLD[state]) continue; // 按类别卡置信度
      const x = Math.round(d.x);
      const y = Math.round(d.y);
      if (region && !(x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h)) {
        continue;
      }
      results.push({ state, x, y, confidence: d.confidence });
      ctx.log(`  [${state}] (${x},${y}) conf=${(d.confidence * 100).toFixed(1)}%`);
    }

    // 测试阶段：把检测到的状态画红框 + 置信度，保存截图（已关闭）
    // if (isDevEnv()) {
    //   await saveStateDebugShot(ctx, shotPath, dets, region).catch(e =>
    //     ctx.log(`  [调试] 保存状态截图失败: ${e.message}`));
    // }

    results.sort((a, b) => a.y - b.y);
    return results;
  } finally {
    await fs.unlink(shotPath).catch(() => {});
  }
}

/**
 * 测试阶段：在全屏截图上用红框标注所有检测到的状态框及其类别/置信度，保存到 DEBUG_DIR。（已关闭）
 */
// async function saveStateDebugShot(
//   ctx: PluginContext,
//   shotPath: string,
//   dets: Awaited<ReturnType<typeof ctx.detectStateImage>>,
//   region?: { x: number; y: number; w: number; h: number }
// ): Promise<void> {
//   await fs.mkdir(DEBUG_DIR, { recursive: true });
//   const meta = await sharp(shotPath).metadata();
//   const W = meta.width!;
//   const H = meta.height!;
//
//   let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
//   // 检测区域用蓝色虚线框标出
//   if (region) {
//     svg += `<rect x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}"
//       fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="6,4"/>`;
//   }
//   for (const d of dets) {
//     const state = CLASS_INDEX_STATE[d.classIndex] || `cls${d.classIndex}`;
//     const bx = Math.round(d.x - d.width / 2);
//     const by = Math.round(d.y - d.height / 2);
//     const bw = Math.round(d.width);
//     const bh = Math.round(d.height);
//     const label = `${state} ${(d.confidence * 100).toFixed(1)}%`;
//     const textW = label.length * 8 + 10;
//     const lx = Math.max(0, bx - textW); // 标签放到框左侧
//     svg += `
//       <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="red" stroke-width="2"/>
//       <rect x="${lx}" y="${by}" width="${textW}" height="18" fill="red" opacity="0.85"/>
//       <text x="${lx + 4}" y="${by + 13}" font-family="Arial" font-size="13" font-weight="bold" fill="white">${label}</text>`;
//   }
//   if (dets.length === 0) {
//     svg += `<text x="${W / 2}" y="${H / 2}" font-family="Arial" font-size="20" fill="red" text-anchor="middle">无匹配</text>`;
//   }
//   svg += '</svg>';
//
//   const outPath = path.join(DEBUG_DIR, `state_${Date.now()}.png`);
//   await sharp(shotPath)
//     .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
//     .toFile(outPath);
//   ctx.log(`  [调试] 状态截图已保存: ${outPath}`);
// }

/**
 * 检测右侧采集状态面板的队伍状态。直接用 state.onnx 全屏检索，无需拖动展开；
 * 只保留落在右侧状态面板区域 STATUS_REGION 内的命中。
 */
export async function detectStatusRegionTeamStates(
  ctx: PluginContext,
  states: TeamState[] = ['zhuzha', 'caiji', 'back', 'totarget']
): Promise<DetectedState[]> {
  return detectTeamStates(ctx, states, STATUS_REGION);
}

/**
 * 宝石采集专注模式：持续将队伍维持在采集状态，直到外部停止或配额满。
 * - step 1: 处理返回中的队伍（点击 → 驻扎，最多 5 次）
 * - step 2: 检测采集 + 前往 + 驻扎；配额满则退出
 * - step 3.1（无驻扎）: 走完整 gatherGem 流程
 * - step 3.2（有驻扎）: 点驻扎队伍 → 缩地 → searchAndClickGem 接续派矿
 * - step 4: 大 UI 中找驻扎队伍 → 点击行军按钮
 */
export async function gatherGemFocus(
  ctx: PluginContext,
  config: RokConfig,
  teams: number[],
  teamPage: TeamPage = 'gather'
): Promise<GemGatherOutcome> {
  ctx.log(`=== 宝石采集专注模式 队伍[${teams.join(', ')}] ===`);
  const worldBtn = config.resourceCollect.worldSwitchButton;
  const collectedCoords: Array<{ x: number; y: number }> = [];
  const spiralState = createSpiralState(config);
  let dispatched = 0;
  let hasPaging: boolean | null = null;
  let quotaFull = false;

  while (true) {
    // === step 1: 处理返回中的队伍 ===
    let backRetry = 0;
    while (backRetry < BACK_RETRY_LIMIT) {
      const back = await detectStatusRegionTeamStates(ctx, ['back']);
      if (back.length === 0) break;
      const t = back[0];
      const tx = t.x + AVATAR_OFFSET.dx;
      const ty = t.y + AVATAR_OFFSET.dy;
      ctx.log(`[step 1] 点击返回队伍头像 (${tx}, ${ty})`);
      await ctx.tap(tx, ty);
      await ctx.sleep(1.5);
      ctx.log(`[step 1] 点击驻扎按钮 (${ZHUZHA_BUTTON.x}, ${ZHUZHA_BUTTON.y})`);
      await ctx.tap(ZHUZHA_BUTTON.x, ZHUZHA_BUTTON.y);
      await ctx.sleep(0.5);
      backRetry++;
    }

    // === step 2: 检测采集 + 前往 + 驻扎 ===
    const states = await detectStatusRegionTeamStates(
      ctx, ['caiji', 'totarget', 'zhuzha']
    );
    const caijiCount = states.filter(s => s.state === 'caiji').length;
    const totargetCount = states.filter(s => s.state === 'totarget').length;
    const zhuzhaList = states.filter(s => s.state === 'zhuzha').sort((a, b) => a.y - b.y);
    ctx.log(`[step 2] caiji=${caijiCount} totarget=${totargetCount} zhuzha=${zhuzhaList.length}`);

    if (caijiCount + totargetCount >= teams.length) {
      ctx.log(`[step 2] 配额已满（${caijiCount + totargetCount}/${teams.length}），退出循环`);
      quotaFull = true;
      break;
    }

    if (zhuzhaList.length === 0) {
      // step 3.1: 走完整 gatherGem
      ctx.log('[step 3.1] 调用 gatherGem 完整流程');
      const r = await gatherGem(ctx, config, teams, { collectedCoords, teamPage });
      dispatched += r.dispatched;
      // gatherGem 内部独立维护 spiralState 且可能让视角回到城内，
      // 重置焦点循环的 spiralState 以避免与实际视角错位
      Object.assign(spiralState, createSpiralState(config));
      await ctx.sleep(2);
      continue;
    }

    // === step 3.2: 驻扎队伍接续派矿 ===
    const top = zhuzhaList[0];
    const topX = top.x + AVATAR_OFFSET.dx;
    const topY = top.y + AVATAR_OFFSET.dy;
    ctx.log(`[step 3.2] 点击最上驻扎队伍头像 (${topX}, ${topY})`);
    await ctx.tap(topX, topY);
    await ctx.sleep(1.5);

    await zoomOutToWorld(ctx, worldBtn);
    // 每次接续派矿都从新螺旋开始搜，避免沿用上一轮已耗尽的 spiralState 直接返回搜不到矿
    Object.assign(spiralState, createSpiralState(config));
    const gem = await searchAndClickGem(ctx, config, spiralState, collectedCoords);
    if (!gem.found) {
      ctx.log('[step 3.2] 搜不到矿，退大 UI 回 step 1');
      await ctx.tap(EXIT_LARGE_UI_BUTTON.x, EXIT_LARGE_UI_BUTTON.y);
      await ctx.sleep(1);
      continue;
    }

    // === step 4: 大 UI 中找驻扎/返回队伍 + 行军按钮 ===
    // 优先找驻扎队伍
    let stateIn4 = await detectTeamStates(ctx, ['zhuzha'], LARGE_REGION);
    let foundState = 'zhuzha';

    // 没找到驻扎，找返回队伍
    if (stateIn4.length === 0) {
      stateIn4 = await detectTeamStates(ctx, ['back'], LARGE_REGION);
      if (stateIn4.length > 0) {
        foundState = 'back';
        ctx.log(`[step 4] 未检测到驻扎，找到返回队伍`);
      }
    }

    if (stateIn4.length === 0) {
      // 兜底：驻扎和返回都没检测到，回退到派空闲队伍
      ctx.log('[step 4] 兜底：未检测到驻扎和返回，尝试派空闲队伍');
      if (!await checkIdleTeamsAvailable(ctx)) {
        ctx.log('[step 4] 兜底：也无空闲队伍，退出');
        await ctx.tap(EXIT_LARGE_UI_BUTTON.x, EXIT_LARGE_UI_BUTTON.y);
        await ctx.sleep(1);
        break;
      }
      const r = await dispatchToTeamPopup(
        ctx, config, teams, 0, hasPaging, collectedCoords, teamPage
      );
      hasPaging = r.hasPaging;
      if (r.dispatched) dispatched++;
      continue;
    }

    const topInLarge = stateIn4.sort((a, b) => a.y - b.y)[0];
    const topInLargeX = topInLarge.x + AVATAR_OFFSET.dx;
    const topInLargeY = topInLarge.y + AVATAR_OFFSET.dy;
    const stateLabel = foundState === 'zhuzha' ? '驻扎' : '返回';
    ctx.log(`[step 4] 点击最上${stateLabel}队伍头像 (${topInLargeX}, ${topInLargeY})`);
    await ctx.tap(topInLargeX, topInLargeY);
    await ctx.sleep(1.5);

    const march = await ctx.findImageWithLocation(
      MARCH_BTN_TEMPLATE, 0.7, undefined, undefined, undefined, MARCH_SEARCH_REGION
    );
    if (!march.found) {
      ctx.log(`[step 4] 行军按钮未找到，退大 UI 回 step 1`);
      await ctx.tap(EXIT_LARGE_UI_BUTTON.x, EXIT_LARGE_UI_BUTTON.y);
      await ctx.sleep(1);
      continue;
    }
    ctx.log(`[step 4] 点击行军按钮 (${march.x}, ${march.y})`);
    await ctx.tap(march.x, march.y);
    await ctx.sleep(1.5);
    dispatched++;
  }

  ctx.log(`=== 专注模式结束：派出 ${dispatched} 队 ===`);
  const result: GemGatherOutcome['result'] =
    dispatched > 0 || quotaFull ? 'success' : 'not_found';
  return { result, dispatched };
}
