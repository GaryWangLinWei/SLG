import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { Vision } from '../../../core/vision';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

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
export async function detectTeamStates(ctx: PluginContext): Promise<DetectedState[]> {
  ctx.log(`[状态检测] 截取区域 (${STATUS_REGION.x},${STATUS_REGION.y}) ${STATUS_REGION.w}x${STATUS_REGION.h}`);
  const regionPath = await ctx.captureRegion(
    STATUS_REGION.x, STATUS_REGION.y, STATUS_REGION.w, STATUS_REGION.h
  );

  try {
    const results: DetectedState[] = [];
    // 记录匹配框，用于绘制调试截图
    const drawRects: { y: number; h: number; state: string; confidence: number }[] = [];

    for (const [state, templatePath] of Object.entries(STATE_TEMPLATES)) {
      // 先获取模板尺寸
      const tplMeta = await sharp(templatePath).metadata();
      const tplH = tplMeta.height || 24;

      const matches = await vision.findAllImages(regionPath, templatePath, 0.65);
      ctx.log(`  [${state}] 匹配到 ${matches.length} 个`);
      for (const m of matches) {
        const screenY = m.location.y + STATUS_REGION.y;
        results.push({
          state: state as TeamState,
          y: screenY,
          confidence: m.confidence,
        });
        ctx.log(`    y=${screenY} conf=${(m.confidence * 100).toFixed(1)}%`);
        drawRects.push({
          y: m.location.y,
          h: Math.round(tplH),
          state,
          confidence: m.confidence,
        });
      }
    }

    // 保存调试截图：无论是否匹配都保存，方便确认区域是否正确
    if (isDevEnv()) {
      try {
        await fs.mkdir(DEBUG_DIR, { recursive: true });
        const regionMeta = await sharp(regionPath).metadata();
        const w = regionMeta.width!;
        const h = regionMeta.height!;

        const colors: Record<string, string> = {
          zhuzha: '#f59e0b',     // 橙 — 驻扎
          caiji: '#22c55e',      // 绿 — 采集中
          back: '#ef4444',       // 红 — 返回
          totarget: '#3b82f6',   // 蓝 — 前往目标
        };

        let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#666" stroke-width="1"/>`;
        // 坐标刻度（每 50px 标一个 Y 值）
        for (let gy = 0; gy < h; gy += 50) {
          svg += `<line x1="0" y1="${gy}" x2="${w}" y2="${gy}" stroke="#444" stroke-width="0.5" stroke-dasharray="3,3"/>
            <text x="2" y="${gy + 10}" font-family="Arial" font-size="9" fill="#888">y=${gy + STATUS_REGION.y}</text>`;
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
 * 宝石采集专注模式（占位 — 可行性测试阶段仅做状态检测）
 */
export async function gatherGemFocus(
  ctx: PluginContext,
  _config: any,
  _teams: number[]
): Promise<GemGatherOutcome> {
  ctx.log('[专注模式] 状态检测可行性测试');

  const states = await detectTeamStates(ctx);

  const counts: Record<string, number> = {};
  for (const s of states) {
    counts[s.state] = (counts[s.state] || 0) + 1;
  }

  ctx.log(`[专注模式] 检测完成: ${states.length} 个状态 → ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ') || '无'}`);

  return { result: 'success', dispatched: 0 };
}
