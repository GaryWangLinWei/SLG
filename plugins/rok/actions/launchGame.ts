import * as path from 'path';
import { PluginAction } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';

const ROK_ICON_TEMPLATE = path.join(getTemplatesDir(), 'RokIcon.png');
// 进游戏点击区域（替代固定的屏幕正中心）
const TAP_REGION = { x1: 324, y1: 256, x2: 1231, y2: 798 };

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export const launchGame: PluginAction = {
  id: 'launch-game',
  name: '启动游戏',
  description: '识别桌面 RokIcon.png 图标点击进入，等加载后在区域内随机点一下进游戏',
  run: async (ctx) => {
    // 1. 图像识别桌面图标并点击（替代 monkey 启动，更接近真人点桌面图标）
    ctx.log(`[LAUNCH-GAME] 查找桌面图标 ${path.basename(ROK_ICON_TEMPLATE)}`);
    const matchStart = Date.now();
    let icon;
    try {
      icon = await ctx.findImageWithLocation(ROK_ICON_TEMPLATE, 0.8, [0.9, 1.0, 1.1]);
    } catch (e) {
      const elapsed = ((Date.now() - matchStart) / 1000).toFixed(1);
      ctx.log(`[LAUNCH-GAME] ❌ 图标识别异常，耗时 ${elapsed}s: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
    const matchElapsed = ((Date.now() - matchStart) / 1000).toFixed(1);
    ctx.log(`[LAUNCH-GAME] 图标识别完成，耗时 ${matchElapsed}s，found=${icon.found} conf=${icon.confidence.toFixed(3)}`);
    if (!icon.found) {
      ctx.log(`[LAUNCH-GAME] ⚠️ 未找到桌面图标 ${path.basename(ROK_ICON_TEMPLATE)}，启动中止`);
      throw new Error(`未找到桌面游戏图标 ${path.basename(ROK_ICON_TEMPLATE)}`);
    }
    ctx.log(`[LAUNCH-GAME] 已定位桌面图标 (${icon.x}, ${icon.y}) conf=${icon.confidence.toFixed(2)}，点击启动`);
    await ctx.tap(icon.x, icon.y);

    ctx.log(`[LAUNCH-GAME] 等待 15s 进入开始界面`);
    await ctx.sleep(15);

    // 2. 进游戏点击：区域内随机点（替代屏幕正中心 800,450）
    const tx = randInt(TAP_REGION.x1, TAP_REGION.x2);
    const ty = randInt(TAP_REGION.y1, TAP_REGION.y2);
    ctx.log(`[LAUNCH-GAME] 点击 (${tx}, ${ty}) 进入游戏`);
    await ctx.tap(tx, ty);

    ctx.log(`[LAUNCH-GAME] 等待 15s 加载完成`);
    await ctx.sleep(15);
  },
};
