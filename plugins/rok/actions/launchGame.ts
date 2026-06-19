import { PluginAction } from '../../../core/plugin';

const PACKAGE_NAME = 'com.lilithgames.rok.offical.cn';

export const launchGame: PluginAction = {
  id: 'launch-game',
  name: '启动游戏',
  description: 'monkey 启动万国觉醒，等加载、点击中心进入游戏',
  run: async (ctx) => {
    await ctx.execShell(`monkey -p ${PACKAGE_NAME} -c android.intent.category.LAUNCHER 1`);
    ctx.log(`[LAUNCH-GAME] 已发送启动命令，等待 10s 进入开始界面`);
    await ctx.sleep(10);
    ctx.log(`[LAUNCH-GAME] 点击屏幕中心 (800, 450) 进入游戏`);
    await ctx.tap(800, 450);
    ctx.log(`[LAUNCH-GAME] 等待 20s 加载完成`);
    await ctx.sleep(20);
  },
};
