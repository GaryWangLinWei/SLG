import * as path from 'path';
import { PluginAction } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';

export const ROK_PACKAGE = 'com.lilithgames.rok.offical.cn';
const KICKED_POPUP_TEMPLATE = path.join(getTemplatesDir(), '顶号弹窗.png');
const KICKED_CONFIRM_TAP = { x: 797, y: 638 }; // 顶号弹窗确认按钮，点击后退出游戏

/** 通过 pidof 判断游戏进程是否存活。`|| echo` 兜底非零退出码 */
async function isGameRunning(ctx: any): Promise<boolean> {
  try {
    const { stdout } = await ctx.execShell(`"pidof ${ROK_PACKAGE} || echo"`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export const checkGameRunning: PluginAction = {
  id: 'check-game-running',
  name: '检测游戏进程',
  description: `检测 ${ROK_PACKAGE} 进程是否在运行，并识别"顶号弹窗"`,
  run: async (ctx) => {
    const processAlive = await isGameRunning(ctx);

    // 进程存活时，进一步检查是否弹出顶号弹窗；若出现则点确认退出游戏，视为掉线
    if (processAlive) {
      try {
        const popup = await ctx.findImageWithLocation(KICKED_POPUP_TEMPLATE, 0.7);
        ctx.log(`[CHECK-GAME] 顶号弹窗匹配 found=${popup.found} conf=${popup.confidence.toFixed(3)}`);
        if (popup.found) {
          ctx.log(`[CHECK-GAME] 检测到顶号弹窗，点击 (${KICKED_CONFIRM_TAP.x},${KICKED_CONFIRM_TAP.y}) 退出`);
          await ctx.tap(KICKED_CONFIRM_TAP.x, KICKED_CONFIRM_TAP.y);
          await ctx.sleep(3);
          ctx.log(`[CHECK-GAME] running=false`);
          return;
        }
      } catch (e) {
        ctx.log(`[CHECK-GAME] 顶号弹窗匹配异常: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    ctx.log(`[CHECK-GAME] running=${processAlive}`);
    // 结果通过日志中的 running=true/false 传出（前端 grep 日志判断）
  },
};
