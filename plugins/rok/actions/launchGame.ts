import * as path from 'path';
import * as fs from 'fs';
import { PluginAction } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ROK_PACKAGE } from './checkGameRunning';

const ROK_ICON_TEMPLATE = path.join(getTemplatesDir(), 'RokIcon.png');
const DEBUG_DIR = path.join(process.cwd(), 'temp', 'launchGame');
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
    // 先收起可能被误滑出来的通知栏，避免遮挡后续操作
    try {
      await ctx.execShell(`"cmd statusbar collapse"`);
      ctx.log(`[LAUNCH-GAME] 已收起通知栏`);
    } catch (e) {
      ctx.log(`[LAUNCH-GAME] 收起通知栏失败（忽略）: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 0. 先检测游戏进程，已在跑就直接跳过启动流程
    // 用 `|| echo` 兜底 pidof 未找到时的非零退出码
    try {
      const { stdout } = await ctx.execShell(`"pidof ${ROK_PACKAGE} || echo"`);
      const pid = stdout.trim();
      if (pid.length > 0) {
        ctx.log(`[LAUNCH-GAME] 游戏进程已存在 (pid=${pid})，跳过启动`);
        return;
      }
      ctx.log(`[LAUNCH-GAME] 游戏进程不存在，走启动流程`);
    } catch (e) {
      ctx.log(`[LAUNCH-GAME] 进程检测失败，继续走启动流程: ${e instanceof Error ? e.message : String(e)}`);
    }

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
      // 桌面图标找不到 —— 可能游戏已被其它循环误触启动。二次确认进程，若在则直接进 tap 阶段；否则 monkey 兜底
      ctx.log(`[LAUNCH-GAME] ⚠️ 未找到桌面图标，二次确认游戏进程`);
      let alive = false;
      try {
        const { stdout } = await ctx.execShell(`"pidof ${ROK_PACKAGE} || echo"`);
        alive = stdout.trim().length > 0;
      } catch {}

      if (!alive) {
        ctx.log(`[LAUNCH-GAME] 进程仍不存在，使用 monkey 兜底拉起`);
        try {
          await ctx.execShell(`"monkey -p ${ROK_PACKAGE} -c android.intent.category.LAUNCHER 1"`);
        } catch (e) {
          ctx.log(`[LAUNCH-GAME] monkey 启动失败: ${e instanceof Error ? e.message : String(e)}`);
          // 失败时保存当前截图，便于排查图标外观变化
          try {
            if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
            const dumpPath = path.join(DEBUG_DIR, `launch_fail_${Date.now()}.png`);
            const screenshot = await ctx.captureRegion(0, 0, 1600, 900);
            fs.copyFileSync(screenshot, dumpPath);
            ctx.log(`[LAUNCH-GAME] 已保存失败截图到 ${dumpPath}`);
          } catch {}
          throw new Error(`未找到桌面游戏图标且 monkey 启动失败`);
        }
        ctx.log(`[LAUNCH-GAME] monkey 已发起，等待 15s 进入开始界面`);
        await ctx.sleep(15);
      } else {
        ctx.log(`[LAUNCH-GAME] 游戏进程已存在，跳过图标点击，直接进入开始界面点击流程`);
        // 已经在开始界面/启动过程，短等一会即可
        await ctx.sleep(5);
      }
    } else {
      ctx.log(`[LAUNCH-GAME] 已定位桌面图标 (${icon.x}, ${icon.y}) conf=${icon.confidence.toFixed(2)}，点击启动`);
      await ctx.tap(icon.x, icon.y);

      ctx.log(`[LAUNCH-GAME] 等待 15s 进入开始界面`);
      await ctx.sleep(15);
    }

    // 2. 进游戏点击：区域内随机点（替代屏幕正中心 800,450）
    const tx = randInt(TAP_REGION.x1, TAP_REGION.x2);
    const ty = randInt(TAP_REGION.y1, TAP_REGION.y2);
    ctx.log(`[LAUNCH-GAME] 点击 (${tx}, ${ty}) 进入游戏`);
    await ctx.tap(tx, ty);

    ctx.log(`[LAUNCH-GAME] 等待 15s 加载完成`);
    await ctx.sleep(15);
  },
};
