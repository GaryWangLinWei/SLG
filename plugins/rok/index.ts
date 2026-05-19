import { Plugin } from '../../core/plugin';
import { collectResources } from './actions/collectResources';
import { upgradeSingleBuilding } from './actions/upgradeBuildings';
import { gatherSingleResource, GatherTask } from './actions/gatherResources';
import { researchTech, TECH_TEMPLATES, ECONOMIC_TECHS, MILITARY_TECHS } from './actions/researchTech';
import { trainTroopsSingle } from './actions/trainTroops';
import { explore } from './actions/explore';
import { idleDrag } from './actions/idleDrag';
import { helpTeammates } from './actions/helpTeammates';
import { ensureInCity, ensureBottomBarCollapsed } from './utils/location';

// 万国觉醒 - 配置项
// 这些坐标需要根据你的实际屏幕分辨率进行调整

import { HomeFeatures, DEFAULT_HOME_FEATURES } from './homeFeatures';
export { HomeFeatures, DEFAULT_HOME_FEATURES };

export interface RokConfig {
  // 返回按钮
  backButton: { x: number; y: number };

  // 所有建筑位置（按名称索引）
  buildingPositions: Record<string, { x: number; y: number }>;

  // 建筑升级 - 弹出升级按钮模板图（所有建筑共用）
  popupUpgradeTemplate: string;
  // 弹窗关闭按钮模板图（工人忙和资源不足弹窗共用）
  closeBtnTemplate: string;
  // 资源不足弹窗关闭按钮
  closePopupButton: { x: number; y: number };

  // 科技研究配置
  techResearch: {
    // 研究学院建筑名（引用 buildingPositions）
    researchBuilding: string;
    // 弹出研究按钮偏移量
    popupResearchOffset: { x: number; y: number };
    // 科技详情页中的研究按钮
    detailResearchButton: { x: number; y: number };
    swipeFromX: number;
    swipeToX: number;
    swipeY: number;
    availableTechs: string[];
    economicTechs: string[];
    militaryTechs: string[];
  };

  // 城内资源收集（引用 buildingPositions 中的建筑名）
  resources: Array<{
    building: string;
    collectOffset: { x: number; y: number };
  }>;

  // 城外资源采集
  resourceCollect: {
    worldSwitchButton: { x: number; y: number };
    searchButton: { x: number; y: number };
    gatherTemplate: string;
    resourceTypes: Record<string, {
      button: { x: number; y: number };
      minusOffset: { x: number; y: number };
      plusOffset: { x: number; y: number };
      searchOffset: { x: number; y: number };
    }>;
  };

  homeFeatures?: HomeFeatures;
}

export const DEFAULT_ROK_CONFIG: RokConfig = {
  backButton: { x: 1365, y: 103 },

  // ========== 所有建筑位置（通过坐标配置页面标注） ==========
  buildingPositions: {},

  // ========== 升级相关（所有建筑共用） ==========
  popupUpgradeTemplate: 'btn_upgrade.png',
  closeBtnTemplate: 'closeBtn.png',
  closePopupButton: { x: 1263, y: 176 },

  // ========== 科技研究 ==========
  techResearch: {
    researchBuilding: '',
    popupResearchOffset: { x: 131, y: 146 },
    detailResearchButton: { x: 1237, y: 668 },
    swipeFromX: 1400,
    swipeToX: 600,
    swipeY: 826,
    availableTechs: Object.keys(TECH_TEMPLATES),
    economicTechs: Array.from(ECONOMIC_TECHS),
    militaryTechs: Array.from(MILITARY_TECHS)
  },

  // ========== 资源收集（通过坐标配置页面设置） ==========
  resources: [],

  // ========== 城外资源采集 ==========
  resourceCollect: {
    worldSwitchButton: { x: 82, y: 814 },
    searchButton: { x: 82, y: 671 },
    gatherTemplate: 'btn_gather.png',
    resourceTypes: {
      '农田': {
        button: { x: 567, y: 794 },
        minusOffset: { x: -183, y: -269 },
        plusOffset: { x: 167, y: -269 },
        searchOffset: { x: 0, y: -185 },
      },
      '伐木场': {
        button: { x: 800, y: 794 },
        minusOffset: { x: -183, y: -269 },
        plusOffset: { x: 167, y: -269 },
        searchOffset: { x: 0, y: -185 },
      },
      '石矿': {
        button: { x: 1042, y: 794 },
        minusOffset: { x: -183, y: -269 },
        plusOffset: { x: 167, y: -269 },
        searchOffset: { x: 0, y: -185 },
      },
      '金矿': {
        button: { x: 1282, y: 794 },
        minusOffset: { x: -183, y: -269 },
        plusOffset: { x: 167, y: -269 },
        searchOffset: { x: 0, y: -185 },
      },
    }
  },

  homeFeatures: DEFAULT_HOME_FEATURES,
};

export const RiseOfKingdomsPlugin: Plugin = {
  id: 'com.rok.automation',
  name: '万国觉醒自动化',
  version: '1.0.0',
  description: '专门针对万国觉醒 (Rise of Kingdoms) 的自动化插件',
  author: 'SLG Auto Framework',

  config: {
    collectInterval: {
      type: 'number',
      default: 300,
      description: '资源收集间隔（秒）'
    },
    upgradeInterval: {
      type: 'number',
      default: 600,
      description: '建筑升级检查间隔（秒）'
    }
  },

  actions: [
    {
      id: 'ensure-bottom-bar',
      name: '底部栏检测',
      description: '检测底部栏是否展开，展开时自动收回（每次运行只执行一次）',
      run: async (ctx) => {
        await ensureBottomBarCollapsed(ctx);
      }
    },
    {
      id: 'collect-resources',
      name: '收集所有资源',
      description: '遍历所有资源建筑并收集产出',
      run: async (ctx) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        await collectResources(ctx, config);
      }
    },
    {
      id: 'upgrade-buildings',
      name: '升级建筑',
      description: '按顺序升级多个建筑，成功的会从队列移除',
      run: async (ctx, params: { targetBuildings: string[] }) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const buildings = params.targetBuildings.filter(b => b);

        for (let i = 0; i < buildings.length; i++) {
          ctx.log(`--- [${i + 1}/${buildings.length}] ---`);
          const result = await upgradeSingleBuilding(ctx, config, buildings[i]);
          if (result === 'success') {
            ctx.log(`✅ ${buildings[i]} 升级成功，已从队列移除`);
          } else if (result === 'busy') {
            ctx.log(`⏳ ${buildings[i]} 队列满，可重试`);
            break;
          } else {
            ctx.log(`❌ ${buildings[i]} 升级失败 (${result})`);
          }
        }
        ctx.log('=== 升级队列执行完毕 ===');
      }
    },
    {
      id: 'gather-resources',
      name: '采集城外资源',
      description: '按队列采集城外资源，5个队伍按顺序派出',
      run: async (ctx, params: { gatherTasks: GatherTask[] }) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        let hasPaging: boolean | null = null;

        for (let i = 0; i < params.gatherTasks.length; i++) {
          const task = params.gatherTasks[i];
          ctx.log(`--- 队伍 ${task.team} ---`);
          const result = await gatherSingleResource(ctx, config, task, hasPaging);
          if (hasPaging === null) hasPaging = result.hasPaging;
          if (result.noIdleTeams) {
            ctx.log('⛔ 没有空闲队伍，停止采集任务');
            return;
          }
        }

        // 所有队伍采集完成后，等待2秒，然后智能切换回城内
        ctx.log('--- 所有队伍完成，等待2秒后切换回城内 ---');
        await ctx.sleep(2);
        await ensureInCity(ctx, config);

        ctx.log('=== 采集队列执行完毕 ===');
      }
    },
    {
      id: 'loop-collect',
      name: '循环收集资源',
      description: '定时循环收集资源',
      run: async (ctx) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const interval = ctx.getConfig('collectInterval', 300);

        ctx.log('开始循环收集资源模式');
        ctx.log(`收集间隔: ${interval}秒`);

        while (true) {
          ctx.log('--- 执行资源收集 ---');
          await collectResources(ctx, config);
          ctx.log(`等待 ${interval} 秒后继续下一次收集...`);
          await ctx.sleep(interval);
        }
      }
    },
    {
      id: 'loop-upgrade',
      name: '循环升级建筑',
      description: '定时循环升级队列中的建筑，成功自动移除',
      run: async (ctx, params: { targetBuildings: string[] }) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const interval = ctx.getConfig('upgradeInterval', 600);
        const pending = params.targetBuildings.filter(b => b);

        ctx.log(`循环升级队列: [${pending.join(', ')}]`);
        ctx.log(`检查间隔: ${interval}秒`);

        while (pending.length > 0) {
          ctx.log(`--- 当前队列 [${pending.join(', ')}] ---`);
          const remaining: string[] = [];

          for (const building of pending) {
            const result = await upgradeSingleBuilding(ctx, config, building);
            if (result === 'success') {
              ctx.log(`✅ ${building} 升级成功，移出队列`);
            } else if (result === 'busy') {
              ctx.log(`⏳ ${building} 队列满，下轮重试`);
              remaining.push(building);
            } else {
              ctx.log(`❌ ${building} 失败 (${result})`);
            }
          }

          if (remaining.length === 0) {
            ctx.log('=== 所有建筑升级完成 ===');
            break;
          }
          pending.length = 0;
          pending.push(...remaining);
          ctx.log(`等待 ${interval} 秒后继续...`);
          await ctx.sleep(interval);
        }
      }
    },
    {
      id: 'research-tech',
      name: '自动研究科技',
      description: '自动滑动寻找并研究科技',
      run: async (ctx, params: { targetTech?: string; researchBuilding?: string } = {}) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const targetTech = params.targetTech || config.techResearch.availableTechs[0];
        await researchTech(ctx, config, targetTech, params.researchBuilding);
      }
    },
    {
      id: 'research-tech-queue',
      name: '研究科技队列',
      description: '按队列顺序研究科技，成功自动移除',
      run: async (ctx, params: { targetTechs: string[]; researchBuilding?: string }) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const queue = params.targetTechs.filter(t => t);

        ctx.log(`研究队列: [${queue.join(', ')}]`);

        for (let i = 0; i < queue.length; i++) {
          ctx.log(`--- [${i + 1}/${queue.length}] ${queue[i]} ---`);
          const result = await researchTech(ctx, config, queue[i], params.researchBuilding);
          if (result === 'success') {
            ctx.log(`✅ ${queue[i]} 研究成功，已从队列移除`);
            break;
          } else if (result === 'busy') {
            ctx.log(`⏳ ${queue[i]} 正在研究中，停止队列`);
            break;
          } else {
            ctx.log(`❌ ${queue[i]} 研究失败 (${result})`);
          }
        }
        ctx.log('=== 研究队列执行完毕 ===');
      }
    },
    {
      id: 'train-troops',
      name: '训练兵种',
      description: '按队列训练兵种，busy 时停止',
      run: async (ctx, params: { trainQueue: { building: string; tier: number }[] }) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const queue = params.trainQueue.filter(t => t.building && t.tier);

        ctx.log(`训练队列: [${queue.map(t => `${t.building} T${t.tier}`).join(', ')}]`);

        for (let i = 0; i < queue.length; i++) {
          const task = queue[i];
          ctx.log(`--- [${i + 1}/${queue.length}] ${task.building} T${task.tier} ---`);
          const result = await trainTroopsSingle(ctx, config, task.building, task.tier);
          if (result === 'success') {
            ctx.log(`✅ ${task.building} T${task.tier} 训练完成`);
          } else if (result === 'busy') {
            ctx.log(`⏳ ${task.building} 正在训练中，跳过`);
          } else {
            ctx.log(`❌ ${task.building} 训练失败 (${result})`);
          }
        }
        ctx.log('=== 训练队列执行完毕 ===');
      }
    },
    {
      id: 'idle-drag',
      name: '随机拖拽',
      description: '模拟人类在循环等待期间随机滑动屏幕',
      run: async (ctx) => {
        await idleDrag(ctx);
      }
    },
    {
      id: 'help-teammates',
      name: '帮助盟友',
      description: '检测帮助图标并点击帮助盟友',
      run: async (ctx) => {
        await helpTeammates(ctx);
      }
    },
    {
      id: 'explore',
      name: '自动探索',
      description: '派出斥候探索迷雾',
      run: async (ctx, params: { scoutBuilding?: string; maxScouts?: number } = {}) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const outcome = await explore(ctx, config, params.scoutBuilding, params.maxScouts);
        ctx.log(`派出斥候: ${outcome.dispatched} 个 (${outcome.result})`);
      }
    }
  ],

  onLoad: async () => {
    console.log('[万国觉醒插件] 插件已加载');
  },

  onUnload: async () => {
    console.log('[万国觉醒插件] 插件已卸载');
  }
};
