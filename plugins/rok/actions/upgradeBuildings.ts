import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView } from '../utils/location';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

const TEMPLATE_DIR = path.join(__dirname, '../templates');

export type UpgradeResult = 'success' | 'busy' | 'not_found' | 'no_upgrade_button' | 'lack_resources';

export async function upgradeSingleBuilding(
  ctx: PluginContext,
  config: RokConfig,
  targetBuilding: string
): Promise<UpgradeResult> {
  ctx.log(`>>> 升级建筑: ${targetBuilding}`);

  const pos = config.buildingPositions[targetBuilding];
  if (!pos) {
    ctx.log(`❌ 未找到建筑位置: ${targetBuilding}`);
    return 'not_found';
  }

  // Step 0: Reset city camera by toggling world/city twice
  await resetCityView(ctx, config);

  // Step 1: Tap building
  ctx.log(`  [1/6] 点击建筑 (${pos.x}, ${pos.y})`);
  await ctx.tap(pos.x, pos.y);
  await ctx.tap(pos.x, pos.y);
  await ctx.sleep(2);

  // Step 2: Find and tap popup upgrade button
  const upgradeTemplate = path.join(TEMPLATE_DIR, config.popupUpgradeTemplate);
  const popup = await ctx.findImageWithLocation(upgradeTemplate, 0.7, [0.7, 0.8, 0.9, 1.0, 1.1]);
  if (!popup.found) {
    ctx.log(`  [2/6] ⚠ 未找到升级按钮 (${popup.confidence.toFixed(3)})`);
    return 'no_upgrade_button';
  }
  ctx.log(`  [2/6] 点击升级按钮 (${popup.x}, ${popup.y})`);
  await ctx.tap(popup.x, popup.y);
  await ctx.sleep(2);

  // Step 3: Image-recognize and tap detail upgrade button
  const detailUpgradeTemplate = path.join(TEMPLATE_DIR, 'detailUpgradeButton.png');
  const detail = await ctx.findImageWithLocation(detailUpgradeTemplate, 0.7);
  if (!detail.found) {
    ctx.log(`  [3/6] ⚠ 未找到详情升级按钮 (${detail.confidence.toFixed(3)})`);
    await ctx.tap(config.backButton.x, config.backButton.y);
    await ctx.sleep(1);
    return 'no_upgrade_button';
  }
  ctx.log(`  [3/6] 点击详情升级 (${detail.x}, ${detail.y})`);
  await ctx.tap(detail.x, detail.y);
  await ctx.sleep(1);

  // Step 4: Detect result — busy, lack resources, or success
  // Capture fixed regions around each popup's close button and compare against template
  const closeBtnTemplate = path.join(TEMPLATE_DIR, config.closeBtnTemplate);
  const { width: btnW = 40, height: btnH = 40 } = await sharp(closeBtnTemplate).metadata();

  const backRegion = await ctx.captureRegion(
    config.backButton.x - Math.floor(btnW! / 2),
    config.backButton.y - Math.floor(btnH! / 2),
    btnW!, btnH!
  );
  const closeRegion = await ctx.captureRegion(
    config.closePopupButton.x - Math.floor(btnW! / 2),
    config.closePopupButton.y - Math.floor(btnH! / 2),
    btnW!, btnH!
  );

  const diffBack = await ctx.compareImages(backRegion, closeBtnTemplate);
  const diffClose = await ctx.compareImages(closeRegion, closeBtnTemplate);

  if (diffBack < 0.3 || diffClose < 0.3) {
    if (diffBack < diffClose) {
      ctx.log(`  [4/6] ⏳ 建筑工人忙`);
      await ctx.tap(config.backButton.x, config.backButton.y);
      await ctx.sleep(1);
      await ctx.tap(config.backButton.x, config.backButton.y);
      await ctx.sleep(1);
      return 'busy';
    } else {
      ctx.log(`  [4/6] 💰 资源不足`);
      await ctx.tap(config.closePopupButton.x, config.closePopupButton.y);
      await ctx.sleep(1);
      await ctx.tap(config.backButton.x, config.backButton.y);
      await ctx.sleep(1);
      return 'lack_resources';
    }
  }

  ctx.log(`  [4/6] ✅ 升级已开始`);

  // Step 5: Request alliance help (tap building again to hit the help button above)
  ctx.log(`  [5/6] 请求盟友帮助 (${pos.x}, ${pos.y})`);
  await ctx.sleep(1);
  await ctx.tap(pos.x, pos.y);
  await ctx.sleep(0.5);
  return 'success';
}
