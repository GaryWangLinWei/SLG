import { PluginAction } from '../../../core/plugin';

const PACKAGE_NAME = 'com.lilithgame.roc.gp';

export const killGame: PluginAction = {
  id: 'kill-game',
  name: '强制关闭游戏',
  description: 'force-stop 万国觉醒进程，模拟下线',
  run: async (ctx) => {
    await ctx.execShell(`am force-stop ${PACKAGE_NAME}`);
    ctx.log(`[KILL-GAME] 已 force-stop ${PACKAGE_NAME}`);
  },
};
