import { Plugin } from '../../core/plugin';
import { DEFAULT_CONFIG } from './config';
import { SlgPluginConfig } from './types';
import { collectResources } from './actions/collectResources';
import { upgradeBuildings } from './actions/upgradeBuildings';
import { runLoop } from './actions/loop';

export const SlgCommonPlugin: Plugin = {
  id: 'com.slg.common',
  name: 'SLG通用插件',
  version: '1.0.0',
  description: '适用于大多数SLG游戏的通用自动化插件',
  author: 'SLG Auto Framework',

  config: {
    collectInterval: {
      type: 'number',
      default: DEFAULT_CONFIG.collectInterval,
      description: '资源收集间隔（秒）'
    },
    upgradeInterval: {
      type: 'number',
      default: DEFAULT_CONFIG.upgradeInterval,
      description: '建筑升级检查间隔（秒）'
    }
  },

  actions: [
    {
      id: 'collect-resources',
      name: '收集资源',
      description: '遍历所有资源建筑并收集产出',
      run: async (ctx) => {
        const resources = ctx.getConfig('resources', []);
        await collectResources(ctx, resources);
      }
    },
    {
      id: 'upgrade-buildings',
      name: '升级建筑',
      description: '按优先级检查并升级建筑',
      run: async (ctx) => {
        const buildings = ctx.getConfig('buildings', []);
        await upgradeBuildings(ctx, buildings);
      }
    },
    {
      id: 'loop-collect',
      name: '循环收集资源',
      description: '定时循环收集资源',
      run: async (ctx) => {
        const collectInterval = ctx.getConfig('collectInterval', 300);
        const resources = ctx.getConfig('resources', []);
        const { collectResources } = await import('./actions/collectResources');

        await runLoop(ctx, {
          action: (c) => collectResources(c, resources),
          intervalSeconds: collectInterval
        });
      }
    },
    {
      id: 'loop-upgrade',
      name: '循环升级建筑',
      description: '定时循环检查并升级建筑',
      run: async (ctx) => {
        const upgradeInterval = ctx.getConfig('upgradeInterval', 600);
        const buildings = ctx.getConfig('buildings', []);
        const { upgradeBuildings } = await import('./actions/upgradeBuildings');

        await runLoop(ctx, {
          action: (c) => upgradeBuildings(c, buildings),
          intervalSeconds: upgradeInterval
        });
      }
    }
  ],

  onLoad: async () => {
    console.log('[SLG Common Plugin] 插件已加载');
  },

  onUnload: async () => {
    console.log('[SLG Common Plugin] 插件已卸载');
  }
};
