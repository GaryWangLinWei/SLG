import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureBottomBarState } from '../utils/location';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fs from 'fs/promises';

export const DONATE_FALLBACK_CLICKS = 10;

export function parseDonateCount(text: string): number {
  const trimmed = (text || '').trim();
  let numStr: string | undefined;
  const slash = trimmed.indexOf('/');
  if (slash >= 0) {
    numStr = trimmed.slice(0, slash);
  } else {
    const m = trimmed.match(/\d+/);
    numStr = m ? m[0] : undefined;
  }
  if (!numStr) return -1;
  const n = parseInt(numStr.replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return -1;
  return Math.max(0, Math.min(20, n));
}

const ALLIANCE_BUTTON = { x: 1165, y: 838 };
const TECH_BUTTON = { x: 879, y: 689 };
const TUIJIAN_OFFSET = { dx: 50, dy: 50 };
const CLOSE_DONATE = { x: 1363, y: 103 };
const CLOSE_TECH = { x: 1394, y: 91 };
const CLOSE_ALLIANCE = { x: 1394, y: 55 };
const JUANXIAN_REGION = { x: 1107, y: 663, width: 233, height: 58 };
const COUNT_REGION = { x: 1240, y: 636, width: 62, height: 30 };
const THRESHOLD = 0.7;

const TUIJIAN_TEMPLATE = path.join(getTemplatesDir(), 'lianmeng', 'icon_tuijian.png');
const JUANXIAN_TEMPLATE = path.join(getTemplatesDir(), 'lianmeng', 'btn_juanxian.png');

export async function donateAllianceTech(ctx: PluginContext): Promise<void> {
  ctx.log('=== 联盟科技捐献 ===');

  await ensureBottomBarState(ctx, 'expanded');

  await ctx.tap(ALLIANCE_BUTTON.x, ALLIANCE_BUTTON.y);
  await ctx.sleep(1.5);

  await ctx.tap(TECH_BUTTON.x, TECH_BUTTON.y);
  await ctx.sleep(1.5);

  const tuijian = await ctx.findImageWithLocation(TUIJIAN_TEMPLATE, THRESHOLD);
  if (!tuijian.found) {
    ctx.log('未找到推荐科技图标，关闭科技与联盟界面，结束');
    await ctx.tap(CLOSE_TECH.x, CLOSE_TECH.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_ALLIANCE.x, CLOSE_ALLIANCE.y);
    ctx.log('=== 联盟科技捐献结束（无推荐科技） ===');
    return;
  }

  await ctx.tap(tuijian.x + TUIJIAN_OFFSET.dx, tuijian.y + TUIJIAN_OFFSET.dy);
  await ctx.sleep(1.5);

  const btn = await ctx.findImageWithLocation(
    JUANXIAN_TEMPLATE, THRESHOLD, undefined, undefined, undefined, JUANXIAN_REGION,
  );
  if (!btn.found) {
    ctx.log('❌ 找不到捐献按钮，关闭所有弹窗后结束');
    await closeAll(ctx);
    ctx.log('=== 联盟科技捐献结束（找不到捐献按钮） ===');
    return;
  }
  ctx.log(`找到捐献按钮 (${btn.x}, ${btn.y})，confidence=${btn.confidence.toFixed(3)}`);

  let clicks = DONATE_FALLBACK_CLICKS;
  const regionPath = await ctx.captureRegion(COUNT_REGION.x, COUNT_REGION.y, COUNT_REGION.width, COUNT_REGION.height);
  try {
    const text = await ocrService.readTeamCount(regionPath);
    const n = parseDonateCount(text);
    if (n < 0) {
      ctx.log(`⚠️ 次数 OCR 解析失败，原文="${text.trim()}"，兜底点击 ${DONATE_FALLBACK_CLICKS} 次`);
    } else {
      clicks = n;
      ctx.log(`OCR 剩余捐献次数: ${clicks}/20（原文="${text.trim()}"）`);
    }
  } catch (e: any) {
    ctx.log(`⚠️ 次数 OCR 异常: ${e?.message || e}，兜底点击 ${DONATE_FALLBACK_CLICKS} 次`);
  } finally {
    await fs.unlink(regionPath).catch(() => {});
  }

  if (clicks > 0) {
    for (let i = 0; i < clicks; i++) {
      await ctx.tap(btn.x, btn.y);
      await ctx.sleep(0.5);
    }
    ctx.log(`✅ 已捐献 ${clicks} 次`);
  } else {
    ctx.log('可捐献次数为 0，跳过点击');
  }

  await closeAll(ctx);
  ctx.log('=== 联盟科技捐献完成 ===');
}

async function closeAll(ctx: PluginContext): Promise<void> {
  await ctx.tap(CLOSE_DONATE.x, CLOSE_DONATE.y);
  await ctx.sleep(0.3);
  await ctx.tap(CLOSE_TECH.x, CLOSE_TECH.y);
  await ctx.sleep(0.3);
  await ctx.tap(CLOSE_ALLIANCE.x, CLOSE_ALLIANCE.y);
}
