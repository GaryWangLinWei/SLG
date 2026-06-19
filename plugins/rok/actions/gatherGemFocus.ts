import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { Vision } from '../../../core/vision';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';
import { RokConfig } from '../index';
import {
  gatherGem,
  zoomOutToWorld,
  searchAndClickGem,
  checkIdleTeamsAvailable,
  dispatchToTeamPopup,
  createSpiralState,
} from './gatherGem';

const vision = new Vision();
const TEMPLATE_DIR = getTemplatesDir();

// 开发调试：保存状态检测截图
const DEBUG_DIR = 'D:/SLG/temp/debug/focus';

function isDevEnv(): boolean {
  try {
    const { app } = require('electron');
    return !app.isPackaged;
  } catch {
    return true;
  }
}

// 状态模板
const STATE_TEMPLATES = {
  zhuzha: path.join(TEMPLATE_DIR, 'state_zhuzha.png'),        // 驻扎
  caiji: path.join(TEMPLATE_DIR, 'state_caiji.png'),          // 采集中
  back: path.join(TEMPLATE_DIR, 'state_back.png'),            // 返回
  totarget: path.join(TEMPLATE_DIR, 'state_totarget.png'),    // 前往目标
} as const;

type TeamState = keyof typeof STATE_TEMPLATES;

// 检测区域: (1530, 202) → (1582, 680)
const STATUS_REGION = { x: 1530, y: 202, w: 52, h: 478 };
const LARGE_REGION  = { x: 1443, y: 53,  w: 152, h: 753 };
const ZHUZHA_BUTTON = { x: 800, y: 593 };
const EXIT_LARGE_UI_BUTTON = { x: 70, y: 834 };
const MARCH_BTN_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_xingjun.png');
const MARCH_SEARCH_REGION = { x: 1068, y: 20, width: 362, height: 860 };
const BACK_RETRY_LIMIT = 5;

export interface DetectedState {
  state: TeamState;
  y: number;
  confidence: number;
}

export interface GemGatherOutcome {
  result: 'success' | 'not_found' | 'no_idle_teams' | 'team_unavailable';
  dispatched: number;
}

/**
 * 检测右侧状态栏中的队伍状态（可行性测试）。
 * 在区域 (1530,202)-(1582,680) 中匹配 4 种状态模板：
 *   totarget  — 前往目标
 *   collecting — 采集中
 *   garrisoned — 驻扎
 *   returning  — 返回
 */
export async function detectTeamStates(
  ctx: PluginContext,
  region: { x: number; y: number; w: number; h: number } = STATUS_REGION,
  states: TeamState[] = ['zhuzha', 'caiji', 'back', 'totarget']
): Promise<DetectedState[]> {
  ctx.log(`[状态检测] 截取区域 (${region.x},${region.y}) ${region.w}x${region.h} states=[${states.join(',')}]`);
  const regionPath = await ctx.captureRegion(region.x, region.y, region.w, region.h);

  try {
    const results: DetectedState[] = [];
    const drawRects: { y: number; h: number; state: string; confidence: number }[] = [];

    for (const state of states) {
      const templatePath = STATE_TEMPLATES[state];
      const tplMeta = await sharp(templatePath).metadata();
      const tplH = tplMeta.height || 24;

      const matches = await vision.findAllImages(regionPath, templatePath, 0.65);
      ctx.log(`  [${state}] 匹配到 ${matches.length} 个`);
      for (const m of matches) {
        const screenY = m.location.y + region.y;
        results.push({ state, y: screenY, confidence: m.confidence });
        ctx.log(`    y=${screenY} conf=${(m.confidence * 100).toFixed(1)}%`);
        drawRects.push({
          y: m.location.y,
          h: Math.round(tplH),
          state,
          confidence: m.confidence,
        });
      }
    }

    // 调试 SVG 截图保留
    if (isDevEnv()) {
      try {
        await fs.mkdir(DEBUG_DIR, { recursive: true });
        const regionMeta = await sharp(regionPath).metadata();
        const w = regionMeta.width!;
        const h = regionMeta.height!;

        const colors: Record<string, string> = {
          zhuzha: '#f59e0b',
          caiji: '#22c55e',
          back: '#ef4444',
          totarget: '#3b82f6',
        };

        let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#666" stroke-width="1"/>`;
        for (let gy = 0; gy < h; gy += 50) {
          svg += `<line x1="0" y1="${gy}" x2="${w}" y2="${gy}" stroke="#444" stroke-width="0.5" stroke-dasharray="3,3"/>
            <text x="2" y="${gy + 10}" font-family="Arial" font-size="9" fill="#888">y=${gy + region.y}</text>`;
        }
        for (const r of drawRects) {
          const color = colors[r.state] || '#fff';
          const label = `${r.state} ${(r.confidence * 100).toFixed(0)}%`;
          const textW = label.length * 9 + 12;
          const boxY = Math.max(0, r.y - 2);
          const boxH = Math.min(h - boxY, r.h + 4);
          svg += `
            <rect x="0" y="${boxY}" width="${w}" height="${boxH}"
                  fill="none" stroke="${color}" stroke-width="2" rx="1"/>
            <rect x="2" y="${Math.max(0, r.y - 16)}" width="${textW}" height="16"
                  fill="${color}" rx="2" opacity="0.9"/>
            <text x="8" y="${Math.max(16, r.y - 2)}" font-family="Arial" font-size="11"
                  font-weight="bold" fill="white">${label}</text>`;
        }
        if (drawRects.length === 0) {
          svg += `<text x="${w / 2}" y="${h / 2}" font-family="Arial" font-size="12" fill="#f44" text-anchor="middle">无匹配</text>`;
        }
        svg += '</svg>';

        const outPath = path.join(DEBUG_DIR, `focus_state_${Date.now()}.png`);
        await sharp(regionPath)
          .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
          .toFile(outPath);
        ctx.log(`  [调试] 截图已保存: ${outPath}`);
      } catch (e: any) {
        ctx.log(`  [调试] 保存截图失败: ${e.message}`);
      }
    }

    results.sort((a, b) => a.y - b.y);
    return results;
  } finally {
    await fs.unlink(regionPath).catch(() => {});
  }
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
  teams: number[]
): Promise<GemGatherOutcome> {
  ctx.log(`=== 宝石采集专注模式 队伍[${teams.join(', ')}] ===`);
  const worldBtn = config.resourceCollect.worldSwitchButton;
  const collectedCoords: Array<{ x: number; y: number }> = [];
  const spiralState = createSpiralState(config);
  let dispatched = 0;
  let hasPaging: boolean | null = null;

  while (true) {
    // === step 1: 处理返回中的队伍 ===
    let backRetry = 0;
    while (backRetry < BACK_RETRY_LIMIT) {
      const back = await detectTeamStates(ctx, STATUS_REGION, ['back']);
      if (back.length === 0) break;
      const t = back[0];
      const iconX = Math.round(STATUS_REGION.x + STATUS_REGION.w / 2);
      ctx.log(`[step 1] 点击返回队伍 (${iconX}, ${t.y})`);
      await ctx.tap(iconX, t.y);
      await ctx.sleep(1.5);
      ctx.log(`[step 1] 点击驻扎按钮 (${ZHUZHA_BUTTON.x}, ${ZHUZHA_BUTTON.y})`);
      await ctx.tap(ZHUZHA_BUTTON.x, ZHUZHA_BUTTON.y);
      await ctx.sleep(0.5);
      backRetry++;
    }

    // === step 2: 检测采集 + 前往 + 驻扎 ===
    const states = await detectTeamStates(
      ctx, STATUS_REGION, ['caiji', 'totarget', 'zhuzha']
    );
    const caijiCount = states.filter(s => s.state === 'caiji').length;
    const totargetCount = states.filter(s => s.state === 'totarget').length;
    const zhuzhaList = states.filter(s => s.state === 'zhuzha').sort((a, b) => a.y - b.y);
    ctx.log(`[step 2] caiji=${caijiCount} totarget=${totargetCount} zhuzha=${zhuzhaList.length}`);

    if (caijiCount + totargetCount >= teams.length) {
      ctx.log(`[step 2] 配额已满（${caijiCount + totargetCount}/${teams.length}），退出循环`);
      break;
    }

    if (zhuzhaList.length === 0) {
      // step 3.1: 走完整 gatherGem
      ctx.log('[step 3.1] 调用 gatherGem 完整流程');
      const r = await gatherGem(ctx, config, teams, { collectedCoords });
      dispatched += r.dispatched;
      await ctx.sleep(2);
      continue;
    }

    // === step 3.2: 驻扎队伍接续派矿 ===
    const top = zhuzhaList[0];
    const iconX = Math.round(STATUS_REGION.x + STATUS_REGION.w / 2);
    ctx.log(`[step 3.2] 点击最上驻扎队伍 (${iconX}, ${top.y})`);
    await ctx.tap(iconX, top.y);
    await ctx.sleep(1.5);

    await zoomOutToWorld(ctx, worldBtn);
    const gem = await searchAndClickGem(ctx, config, spiralState, collectedCoords);
    if (!gem.found) {
      ctx.log('[step 3.2] 搜不到矿，退大 UI 回 step 1');
      await ctx.tap(EXIT_LARGE_UI_BUTTON.x, EXIT_LARGE_UI_BUTTON.y);
      await ctx.sleep(1);
      continue;
    }

    // === step 4: 大 UI 中找驻扎队伍 + 行军按钮 ===
    const stateIn4 = await detectTeamStates(ctx, LARGE_REGION, ['zhuzha']);
    if (stateIn4.length === 0) {
      // 兜底：图像识别误差导致没检测到驻扎，回退到派空闲队伍
      ctx.log('[step 4] 兜底：未检测到驻扎，尝试派空闲队伍');
      if (!await checkIdleTeamsAvailable(ctx)) {
        ctx.log('[step 4] 兜底：也无空闲队伍，退出');
        await ctx.tap(EXIT_LARGE_UI_BUTTON.x, EXIT_LARGE_UI_BUTTON.y);
        break;
      }
      const r = await dispatchToTeamPopup(
        ctx, config, teams, 0, hasPaging, collectedCoords
      );
      hasPaging = r.hasPaging;
      if (r.dispatched) dispatched++;
      continue;
    }

    const topInLarge = stateIn4.sort((a, b) => a.y - b.y)[0];
    const largeIconX = Math.round(LARGE_REGION.x + LARGE_REGION.w / 2);
    ctx.log(`[step 4] 点击最上驻扎队伍 (${largeIconX}, ${topInLarge.y})`);
    await ctx.tap(largeIconX, topInLarge.y);
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
  return { result: dispatched > 0 ? 'success' : 'not_found', dispatched };
}
