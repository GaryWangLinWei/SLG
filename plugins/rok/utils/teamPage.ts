import { PluginContext } from '../../../core/plugin';
import * as fs from 'fs/promises';
import sharp from 'sharp';

// 当前部队页指示器区域 (1361,308) - (1399,343)
const TEAM_PAGE_REGION = { x: 1361, y: 308, w: 38, h: 35 };

/** 部队页类型 */
export type TeamPage = 'other' | 'attack' | 'gather';

const PAGE_NAMES: Record<TeamPage, string> = {
  other: '其他队伍',
  attack: '攻击队伍',
  gather: '采集队伍',
};

/**
 * 检测当前选队弹窗的部队页类型。
 *
 * 三种部队图标颜色判别（基于模板平均色）：
 * - other (黄队): RGB ≈ (76, 80, 29)  → R≈G ≫ B，黄绿色
 * - attack (红队): RGB ≈ (74, 47, 53) → R ≫ G,B，红色
 * - gather (蓝队): RGB ≈ (17, 103, 154) → B ≫ R,G，蓝色
 *
 * 形状几乎相同，但颜色差异巨大，用色调判别比模板匹配稳得多。
 * 返回 null 表示三类色调均不明确。
 */
export async function detectCurrentTeamPage(ctx: PluginContext): Promise<TeamPage | null> {
  const regionPath = await ctx.captureRegion(
    TEAM_PAGE_REGION.x, TEAM_PAGE_REGION.y, TEAM_PAGE_REGION.w, TEAM_PAGE_REGION.h
  );

  try {
    const { data, info } = await sharp(regionPath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 计算平均 RGB（背景为深色 UI，主体即图标）
    let sumR = 0, sumG = 0, sumB = 0;
    const pixels = info.width * info.height;
    for (let i = 0; i < data.length; i += 3) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
    }
    const r = sumR / pixels;
    const g = sumG / pixels;
    const b = sumB / pixels;

    // 计算到三个模板平均色的距离（欧氏）
    const refs: Array<{ page: TeamPage; r: number; g: number; b: number }> = [
      { page: 'other',  r: 76, g: 80, b: 29 },
      { page: 'attack', r: 74, g: 47, b: 53 },
      { page: 'gather', r: 17, g: 103, b: 154 },
    ];
    const dists = refs.map(ref => ({
      page: ref.page,
      dist: Math.sqrt((r - ref.r) ** 2 + (g - ref.g) ** 2 + (b - ref.b) ** 2),
    }));
    dists.sort((a, b) => a.dist - b.dist);

    const distLog = `RGB=(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})  dist: yellow=${dists.find(d => d.page === 'other')!.dist.toFixed(1)}, red=${dists.find(d => d.page === 'attack')!.dist.toFixed(1)}, blue=${dists.find(d => d.page === 'gather')!.dist.toFixed(1)}`;

    // 距离 < 60 视为可识别（三类参考色彼此距离 50+）
    const best = dists[0];
    if (best.dist >= 60) {
      ctx.log(`  [部队页] 未识别 ${distLog}`);
      return null;
    }

    ctx.log(`  [部队页] 当前: ${PAGE_NAMES[best.page]} ${distLog}`);
    return best.page;
  } finally {
    await fs.unlink(regionPath).catch(() => {});
  }
}

/**
 * 确保当前选队弹窗位于指定的部队页。
 * 如不在目标页，点击换页按钮切换，最多换页 2 次（共检测 3 次）。
 * 返回是否成功切换到目标页。
 *
 * @param pageSwitchButton 换页按钮坐标（由调用方在前置 step 检测后传入）
 */
export async function ensureTeamPage(
  ctx: PluginContext,
  target: TeamPage,
  pageSwitchButton: { x: number; y: number },
  maxAttempts: number = 3
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const current = await detectCurrentTeamPage(ctx);

    if (current === target) {
      if (attempt > 1) {
        ctx.log(`  [部队页] ✅ 已切换到 ${PAGE_NAMES[target]} (${attempt}/${maxAttempts})`);
      }
      return true;
    }

    if (attempt >= maxAttempts) {
      ctx.log(`  [部队页] ❌ 切换 ${maxAttempts} 次后仍未到达 ${PAGE_NAMES[target]}`);
      return false;
    }

    ctx.log(`  [部队页] 点击换页按钮 (${pageSwitchButton.x},${pageSwitchButton.y}) → 目标 ${PAGE_NAMES[target]} (${attempt + 1}/${maxAttempts})`);
    await ctx.tap(pageSwitchButton.x, pageSwitchButton.y);
    await ctx.sleep(0.6);
  }

  return false;
}
