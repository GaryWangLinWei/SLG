import path from 'path';
import { copyFile, mkdir } from 'fs/promises';
import sharp from 'sharp';
import { PluginContext } from '../../../core/plugin';

export async function helpTeammates(ctx: PluginContext): Promise<void> {
  ctx.log('=== 检查盟友帮助 ===');

  const templatePath = path.join(__dirname, '../templates', 'helpOther.png');

  // 帮助按钮中心坐标
  const btnX = 1435;
  const btnY = 836;

  const { width: btnW = 60, height: btnH = 60 } = await sharp(templatePath).metadata();

  const regionPath = await ctx.captureRegion(
    btnX - Math.floor(btnW! / 2),
    btnY - Math.floor(btnH! / 2),
    btnW!,
    btnH!
  );

  const diff = await ctx.compareImages(regionPath, templatePath);
  ctx.log(`帮助图标差异: ${(diff * 100).toFixed(1)}%`);

  if (diff < 0.3) {
    ctx.log(`找到帮助图标 (${btnX}, ${btnY})，点击帮助`);
    await ctx.tap(btnX, btnY);
    await ctx.sleep(0.5);
    ctx.log('✅ 已帮助盟友');
  } else {
    ctx.log('没有可帮助的盟友');
  }

  ctx.log('=== 盟友帮助检查完毕 ===');
}
