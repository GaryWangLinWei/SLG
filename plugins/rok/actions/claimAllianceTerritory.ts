import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureBottomBarState } from '../utils/location';
import * as path from 'path';

// 1600x900 分辨率下的坐标（与 helpTeammates.ts 相同的硬编码风格）
const ALLIANCE_BUTTON = { x: 1164, y: 835 }; // 打开联盟页面
const CLOSE_BUTTON = { x: 1392, y: 56 };     // 关闭联盟/领土页面
const CLAIM_BUTTON = { x: 1268, y: 173 };    // 领取领土收益
const TERRITORY_TEMPLATE = 'icon_lingtu.png';
const TEMPLATE_THRESHOLD = 0.7;

export async function claimAllianceTerritory(ctx: PluginContext): Promise<void> {
  ctx.log('=== 领取联盟领土收益 ===');

  // 1. 展开底部栏（检测失败不阻断流程）
  await ensureBottomBarState(ctx, 'expanded');

  // 2. 打开联盟页面
  await ctx.tap(ALLIANCE_BUTTON.x, ALLIANCE_BUTTON.y);
  await ctx.sleep(1);

  // 3. 全屏识别领土按钮
  const templatePath = path.join(getTemplatesDir(), TERRITORY_TEMPLATE);
  try {
    const result = await ctx.findImageWithLocation(templatePath, TEMPLATE_THRESHOLD);
    if (!result.found) {
      ctx.log('未找到领土按钮，关闭联盟页面并结束');
      await ctx.tap(CLOSE_BUTTON.x, CLOSE_BUTTON.y);
      ctx.log('=== 领取联盟领土收益结束（未找到领土按钮） ===');
      return;
    }
    ctx.log(`找到领土按钮 (${result.x}, ${result.y})，点击`);
    await ctx.tap(result.x, result.y);
  } catch (e: any) {
    ctx.log(`领土按钮识别失败: ${e?.message || e}，按未找到处理`);
    await ctx.tap(CLOSE_BUTTON.x, CLOSE_BUTTON.y);
    ctx.log('=== 领取联盟领土收益结束（识别失败） ===');
    return;
  }
  await ctx.sleep(1);

  // 4. 点击领取按钮
  await ctx.tap(CLAIM_BUTTON.x, CLAIM_BUTTON.y);
  await ctx.sleep(0.5);

  // 5. 关闭领土页面
  await ctx.tap(CLOSE_BUTTON.x, CLOSE_BUTTON.y);
  await ctx.sleep(0.5);

  // 6. 关闭联盟页面
  await ctx.tap(CLOSE_BUTTON.x, CLOSE_BUTTON.y);

  ctx.log('=== 领取联盟领土收益完成 ===');
}
