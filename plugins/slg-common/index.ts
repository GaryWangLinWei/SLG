import { Plugin } from '../../core/plugin';
import { DEFAULT_CONFIG } from './config';
import { SlgPluginConfig } from './types';

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
    // Actions will be added in subsequent tasks
  ],

  onLoad: async () => {
    console.log('[SLG Common Plugin] 插件已加载');
  },

  onUnload: async () => {
    console.log('[SLG Common Plugin] 插件已卸载');
  }
};
