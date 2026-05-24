import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView } from '../utils/location';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';

const TEMPLATE_DIR = getTemplatesDir();

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

  // Step 1: Drag building to center, then tap
  ctx.log(`  [1/6] 拖动建筑到屏幕中心 (${pos.x}, ${pos.y} → 800, 450)`);
  await ctx.swipe(pos.x, pos.y, 800, 450, 1000);
  await ctx.tap(800, 450);  // 打断惯性
  await ctx.sleep(0.3);
  await ctx.tap(800, 450);
  await ctx.sleep(0.5);
  await ctx.tap(800, 450);
  await ctx.sleep(1);

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

  // ============================================
  // Step 4: Detect result — busy, lack resources, or success
  // ============================================
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
  ctx.log(`  [4/6] back diff: ${(diffBack * 100).toFixed(1)}%, close diff: ${(diffClose * 100).toFixed(1)}%`);

  await fs.unlink(backRegion).catch(() => {});
  await fs.unlink(closeRegion).catch(() => {});

  if (diffBack < 0.3 || diffClose < 0.3) {
    if (diffBack < diffClose) {
      ctx.log(`  [4/6] ⏳ 建筑工人忙`);
      await ctx.tap(config.backButton.x, config.backButton.y);
      await ctx.sleep(1);
      await ctx.tap(config.backButton.x, config.backButton.y);
      await ctx.sleep(1);
      return 'busy';
    }

    // ============================================
    // [4/6] 💰 资源不足 → 补充流程
    // ============================================
    ctx.log('  [4/6] 💰 资源不足');

    // 判断是否有付费道具不足（图纸等）
    const tuZhiTemplate = path.join(TEMPLATE_DIR, 'resources_tuZhi.png');
    const tuZhi = await ctx.findImageWithLocation(tuZhiTemplate, 0.7);
    if (tuZhi.found) {
      ctx.log('    ❌ 付费道具不足（图纸等），无法补充');
      await ctx.tap(config.closePopupButton.x, config.closePopupButton.y);
      await ctx.sleep(1);
      await ctx.tap(config.backButton.x, config.backButton.y);
      await ctx.sleep(1);
      return 'lack_resources';
    }
    ctx.log(`    无付费道具弹窗 (${tuZhi.confidence.toFixed(3)})，继续补充`);

    // [4.1/6] 点击一键补充
    ctx.log('  [4.1/6] 点击一键补充');
    const REPLENISH_BTN = { x: 1004, y: 624 };
    await ctx.tap(REPLENISH_BTN.x, REPLENISH_BTN.y);
    await ctx.sleep(1);

    // [4.2/6] 判断弹窗类型
    ctx.log('  [4.2/6] 判断弹窗类型');
    const yesBtnTemplate = path.join(TEMPLATE_DIR, 'yesBtn.png');
    const { width: yesW = 200, height: yesH = 60 } = await sharp(yesBtnTemplate).metadata();

    const detail2 = await ctx.findImageWithLocation(detailUpgradeTemplate, 0.7);
    if (detail2.found) {
      ctx.log(`    detailUpgradeButton 识别到 (${detail2.confidence.toFixed(3)})，资源补充完成`);
      ctx.log(`    点击详情升级 (${detail2.x}, ${detail2.y})`);
      await ctx.tap(detail2.x, detail2.y);
      await ctx.sleep(1);

      ctx.log(`  [5/6] 请求盟友帮助 (800, 450)`);

      await ctx.sleep(1);
      await ctx.tap(800, 450);
      await ctx.sleep(0.5);
      return 'success';
    }

    ctx.log(`    detailUpgradeButton 未识别到 (${detail2.confidence.toFixed(3)})，有弹窗`);

    // 判断弹窗类型
    const yesRegion = await ctx.captureRegion(567, 611, yesW!, yesH!);
    const yesDiff = await ctx.compareImages(yesRegion, yesBtnTemplate);
    ctx.log(`    yesBtn 匹对差异: ${(yesDiff * 100).toFixed(1)}%`);
    await fs.unlink(yesRegion).catch(() => {});

    if (yesDiff < 0.3) {
      // 资源超出保护提示
      ctx.log('    资源超出保护提示，点击确认');
      await ctx.tap(567, 611);
      await ctx.sleep(1);

      const detail3 = await ctx.findImageWithLocation(detailUpgradeTemplate, 0.7);
      if (detail3.found) {
        ctx.log(`    点击详情升级 (${detail3.x}, ${detail3.y})`);
        await ctx.tap(detail3.x, detail3.y);
        await ctx.sleep(1);
      } else {
        ctx.log(`    ⚠ 未找到详情升级按钮 (${detail3.confidence.toFixed(3)})`);
        return 'no_upgrade_button';
      }

      ctx.log(`  [5/6] 请求盟友帮助 (800, 450)`);

      await ctx.sleep(1);
      await ctx.tap(800, 450);
      await ctx.sleep(0.5);
      return 'success';
    }

    // 二次确认弹窗
    ctx.log('    二次确认弹窗，点击确认');
    const CONFIRM_BTN = { x: 803, y: 685 };
    await ctx.tap(CONFIRM_BTN.x, CONFIRM_BTN.y);
    await ctx.sleep(1);

    // 再次判断是否有资源超出保护提示
    const yesRegion2 = await ctx.captureRegion(567, 611, yesW!, yesH!);
    const yesDiff2 = await ctx.compareImages(yesRegion2, yesBtnTemplate);
    ctx.log(`    二次检测 yesBtn 匹对差异: ${(yesDiff2 * 100).toFixed(1)}%`);
    await fs.unlink(yesRegion2).catch(() => {});

    if (yesDiff2 < 0.3) {
      ctx.log('    资源超出保护提示，点击确认');
      await ctx.tap(567, 611);
      await ctx.sleep(1);
    }

    const detail4 = await ctx.findImageWithLocation(detailUpgradeTemplate, 0.7);
    if (detail4.found) {
      ctx.log(`    点击详情升级 (${detail4.x}, ${detail4.y})`);
      await ctx.tap(detail4.x, detail4.y);
      await ctx.sleep(1);
    } else {
      ctx.log(`    ⚠ 未找到详情升级按钮 (${detail4.confidence.toFixed(3)})`);
      return 'no_upgrade_button';
    }

    ctx.log(`  [5/6] 请求盟友帮助 (800, 450)`);

    await ctx.sleep(1);
    await ctx.tap(800, 450);
    await ctx.sleep(0.5);
    return 'success';
  }

  ctx.log(`  [4/6] ✅ 升级已开始`);

  // Step 5: Request alliance help (tap building again to hit the help button above)
  ctx.log(`  [5/6] 请求盟友帮助 (800, 450)`);

  await ctx.sleep(1);
  await ctx.tap(800, 450);
  await ctx.sleep(0.5);
  return 'success';
}
