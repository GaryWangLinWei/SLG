import { Plugin } from '../../core/plugin';
import { collectResources } from './actions/collectResources';
import { upgradeSingleBuilding } from './actions/upgradeBuildings';
import { gatherSingleResource, GatherTask } from './actions/gatherResources';
import { researchTech, TECH_TEMPLATES, ECONOMIC_TECHS, MILITARY_TECHS } from './actions/researchTech';
import { trainTroopsSingle } from './actions/trainTroops';
import { explore } from './actions/explore';
import { idleDrag } from './actions/idleDrag';
import { helpTeammates } from './actions/helpTeammates';
import { readQueueOverview, resetQueueFilters } from './actions/readQueueOverview';
import { rallyFort } from './actions/rallyFort';
import { rallyFortSpiral } from './actions/rallyFortSpiral';
import { joinRally } from './actions/joinRally';
import { gatherGem } from './actions/gatherGem';
import { gatherGemFocus } from './actions/gatherGemFocus';
import { caveExplore } from './actions/caveExplore';
import { readGemCount } from './actions/readGemCount';
import { sendWorldChat, sendWorldChatFirstRun } from './actions/sendWorldChat';
import { killGame } from './actions/killGame';
import { launchGame } from './actions/launchGame';
import { ensureInCity, ensureBottomBarCollapsed } from './utils/location';
import { TeamPage } from './utils/teamPage';
import { ocrService } from '../../core/ocr/OcrService';
import * as fs from 'fs/promises';
import { getTemplatesDir } from '../../core/resourcePath';
import * as path from 'path';

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

  // 队列速览 OCR（读取建造/训练/研究倒计时）
  queueOverview?: {
    openButton: { x: number; y: number };
    closeButton?: { x: number; y: number };
    // 打开面板后向下滑动，确保所有队列都出现
    swipeDown?: { fromX: number; fromY: number; toX: number; toY: number };
    rows: {
      build1: { x: number; y: number; w: number; h: number };
      build2: { x: number; y: number; w: number; h: number };
      train_bingying: { x: number; y: number; w: number; h: number };
      train_majiu: { x: number; y: number; w: number; h: number };
      train_bachang: { x: number; y: number; w: number; h: number };
      train_gongcheng: { x: number; y: number; w: number; h: number };
      research: { x: number; y: number; w: number; h: number };
    };
    // 建筑队列名称区域（格式：等级8 学院），用于识别哪个建筑正在升级
    buildNameRows?: {
      build1: { x: number; y: number; w: number; h: number };
      build2: { x: number; y: number; w: number; h: number };
    };
    // 队列设置面板
    settingsButton?: { x: number; y: number };
    queueCheckboxes?: Array<{ x: number; y: number }>;
  };

  // ========== 世界喊话 ==========
  worldChat: {
    chatButton: { x: number; y: number };
    inputBox: { x: number; y: number };
    sendButton: { x: number; y: number };
  };

  // ========== 城寨搜索 ==========
  fortSearch: {
    searchButton: { x: number; y: number };
    barbarianButton: { x: number; y: number };
    fortTab: { x: number; y: number };
    minusButton: { x: number; y: number };
    plusButton: { x: number; y: number };
    searchActionButton: { x: number; y: number };
    rallyButton: { x: number; y: number };
  };

  // ========== 城寨螺旋搜索 ==========
  fortSpiral: {
    pinch: {
      from1: { x: number; y: number };
      from2: { x: number; y: number };
      to1: { x: number; y: number };
      to2: { x: number; y: number };
      duration: number;
    };
    spiralCenterX: number;
    spiralCenterY: number;
    searchMaxAttempts: number;
    spiralSwipeRatio: number;
    searchScales: number[];
    searchThreshold: number;
  };

  // ========== 宝石采集 ==========
  gemGather: {
    baoshiTemplates: string[];
    caijiBtnTemplate: string;
    pinchedGemTapPoint: { x: number; y: number };
    pinch: {
      from1: { x: number; y: number };
      from2: { x: number; y: number };
      to1: { x: number; y: number };
      to2: { x: number; y: number };
      duration: number;
    };
    spiralCenterX: number;
    spiralCenterY: number;
    searchMaxAttempts: number;
    spiralSwipeRatio: number;
    spiralSwipeRatioH?: number;
    searchScales: number[];
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
    detailResearchButton: { x: 1161, y: 682 },
    swipeFromX: 1400,
    swipeToX: 610,
    swipeY: 826,
    availableTechs: Object.keys(TECH_TEMPLATES),
    economicTechs: Array.from(ECONOMIC_TECHS),
    militaryTechs: Array.from(MILITARY_TECHS)
  },

  // ========== 资源收集（默认采集这4种建筑，通过 buildingPositions 找坐标） ==========
  resources: [
    { building: '农场', collectOffset: { x: 0, y: 50 } },
    { building: '木材厂', collectOffset: { x: 0, y: 50 } },
    { building: '采石场', collectOffset: { x: 0, y: 50 } },
    { building: '金矿', collectOffset: { x: 0, y: 50 } },
  ],

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

  // ========== 队列速览 OCR ==========
  queueOverview: {
    openButton: { x: 42, y: 161 },
    closeButton:{ x: 415, y: 459 },
    swipeDown: { fromX: 300, fromY: 524, toX: 300, toY: 300 },
    rows: {
      build1: { x: 103, y: 585, w: 267, h: 23 },
      build2: { x: 103, y: 665, w: 267, h: 23 },
      train_bingying: { x: 103, y: 201, w: 267, h: 23 },
      train_majiu: { x: 104, y: 362, w: 267, h: 23 },
      train_bachang: { x: 103, y: 280, w: 267, h: 23 },
      train_gongcheng: { x: 103, y: 444, w: 267, h: 23 },
      research: { x: 103, y: 805, w: 267, h: 23 }
    },
    buildNameRows: {
      build1: { x: 98, y: 548, w: 266, h: 26 },
      build2: { x: 98, y: 630, w: 266, h: 26 },
    },
    settingsButton: { x: 356, y: 157 },
    queueCheckboxes: [
      { x: 465, y: 212 },  // 部队训练
      { x: 465, y: 366 },  // 建造队列
      { x: 465, y: 443 },  // 科技研究
    ],
  },

  // ========== 世界喊话 ==========
  worldChat: {
    chatButton: { x: 418, y: 845 },
    inputBox: { x: 601, y: 837 },
    sendButton: { x: 1518, y: 848 },
  },

  // ========== 城寨搜索 ==========
  fortSearch: {
    searchButton: { x: 78, y: 677 },
    barbarianButton: { x: 318, y: 795 },
    fortTab: { x: 438, y: 295 },
    minusButton: { x: 121, y: 484 },
    plusButton: { x: 559, y: 481 },
    searchActionButton: { x: 336, y: 593 },
    rallyButton: { x: 1181, y: 615 },
  },

  // ========== 城寨螺旋搜索 ==========
  fortSpiral: {
    pinch: {
      from1: { x: 350, y: 550 },
      from2: { x: 850, y: 550 },
      to1: { x: 500, y: 550 },
      to2: { x: 700, y: 550 },
      duration: 600,
    },
    spiralCenterX: 800,
    spiralCenterY: 450,
    searchMaxAttempts: 16,
    spiralSwipeRatio: 0.8,
    searchScales: [0.8, 0.9, 1.0],
    searchThreshold: 0.7,
  },

  // ========== 宝石采集 ==========
  gemGather: {
    baoshiTemplates: ['baoshi.png', 'baoshi_night.png', 'baoshi_afternoon.png'],
    caijiBtnTemplate: 'btn_caiji.png',
    pinchedGemTapPoint: { x: 791, y: 423 },
    pinch: {
      from1: { x: 300, y: 450 },
      from2: { x: 1300, y: 450 },
      to1: { x: 570, y: 450 },
      to2: { x: 1030, y: 450 },
      duration: 600,
    },
    spiralCenterX: 800,
    spiralCenterY: 450,
    searchMaxAttempts: 81,
    spiralSwipeRatio: 0.8,
    spiralSwipeRatioH: 0.7,
    searchScales: [0.8, 0.9, 1.0],
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

        const done = new Set<string>();
        for (let i = 0; i < buildings.length; i++) {
          if (done.has(buildings[i])) {
            ctx.log(`--- [${i + 1}/${buildings.length}] ⏭ ${buildings[i]} 与前面同名，跳过`);
            continue;
          }
          ctx.log(`--- [${i + 1}/${buildings.length}] ---`);
          const result = await upgradeSingleBuilding(ctx, config, buildings[i]);
          if (result === 'success') {
            ctx.log(`✅ ${buildings[i]} 升级成功，已从队列移除`);
            done.add(buildings[i]);
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
      run: async (ctx, params: { gatherTasks: GatherTask[]; teamPage?: TeamPage }) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        let hasPaging: boolean | null = null;
        const teamPage = params.teamPage ?? 'gather';

        // Pre-check: OCR team count to skip round if no idle teams
        ctx.log('[预备] OCR 检测空闲队伍数...');
        const regionPath = await ctx.captureRegion(1507, 169, 55, 31);
        const teamCountText = await ocrService.readText(regionPath);
        await fs.unlink(regionPath).catch(() => {});
        ctx.log(`[预备] OCR 结果: "${teamCountText}"`);

        // Parse fraction like "2/4", "3/3", "5/5"
        const match = teamCountText.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          const used = parseInt(match[1], 10);
          const total = parseInt(match[2], 10);
          if (used === total) {
            ctx.log(`⏭️ 无空闲队伍 (${used}/${total})，跳过本轮采集`);
            return;
          }
          ctx.log(`有空闲队伍 (${used}/${total})，继续采集`);
        } else {
          // OCR 可能漏掉斜杠，如 "33" → 3/3, "55" → 5/5
          const digitsOnly = teamCountText.replace(/\D/g, '');
          if (digitsOnly.length >= 2 && /^(\d)\1+$/.test(digitsOnly)) {
            ctx.log(`⏭️ 无空闲队伍 (OCR识别为 "${digitsOnly}"，推测全部忙碌)，跳过本轮采集`);
            return;
          }
          ctx.log('⚠️ 未识别到队伍计数，继续采集');
        }

        // 二次验证：检测采集状态图标，若已派出队伍数 ≥ 配置任务数则跳过
        // 检测前先拖动并保持，展开采集状态面板
        ctx.log('[预备] 拖动展开采集状态面板...');
        await ctx.swipeAndHold(1485, 271, 1486, 234);
        const CAIJI_STATE_TEMPLATE = path.join(getTemplatesDir(), 'CaiJiState_result.png');
        const activeTaskCount = params.gatherTasks.filter(t => t.type).length;
        const caiJiResults = await ctx.findAllImages(CAIJI_STATE_TEMPLATE, 0.75, {
          x: 1476, y: 206, width: 114, height: 472
        }, [0.7, 0.8, 0.9, 1.0, 1.1]);
        await ctx.releaseHold();
        ctx.log('[预备] 采集状态面板检测完成，已松手');
        ctx.log(`[预备] 检测到 ${caiJiResults.length} 个采集状态图标（配置任务数: ${activeTaskCount}）`);
        if (caiJiResults.length >= activeTaskCount && activeTaskCount > 0) {
          ctx.log(`⏭️ 已派出队伍数 (${caiJiResults.length}) ≥ 配置任务数 (${activeTaskCount})，认为无空闲采集队伍，跳过本轮采集`);
          return;
        }

        for (let i = 0; i < params.gatherTasks.length; i++) {
          const task = params.gatherTasks[i];
          ctx.log(`--- 队伍 ${task.team} ---`);
          const result = await gatherSingleResource(ctx, config, task, hasPaging, teamPage);
          if (hasPaging === null) hasPaging = result.hasPaging;
          if (result.noIdleTeams) {
            ctx.log('⛔ 没有空闲队伍，停止采集任务');
            await ensureInCity(ctx, config);
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
      name: '迷雾探索',
      description: '派出斥候探索迷雾',
      run: async (ctx, params: { scoutBuilding?: string; maxScouts?: number } = {}) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const outcome = await explore(ctx, config, params.scoutBuilding, params.maxScouts);
        ctx.log(`派出斥候: ${outcome.dispatched} 个 (${outcome.result})`);
      }
    },
    {
      id: 'cave-explore',
      name: '山洞探索',
      description: '派出闲置斥候探索山洞',
      run: async (ctx) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const result = await caveExplore(ctx, config);
        ctx.log(`山洞探索: ${result}`);
      }
    },
    {
      id: 'read-gem-count',
      name: '读取宝石数量',
      description: 'OCR 读取游戏界面宝石数量显示',
      run: async (ctx) => {
        const count = await readGemCount(ctx);
        ctx.log(`宝石数量: ${count ?? '解析失败'}`);
      }
    },
    {
      id: 'send-world-chat',
      name: '发送世界喊话',
      description: '在世界频道发送用户预设的消息',
      run: async (ctx, params: { message: string; isFirst?: boolean }) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        if (params.isFirst) {
          await sendWorldChatFirstRun(ctx, config, params.message);
        } else {
          await sendWorldChat(ctx, config, params.message);
        }
      }
    },
    {
      id: 'read-queue-overview',
      name: '读取队列倒计时',
      description: '打开队列速览面板，OCR 读取建造/训练/研究倒计时。传 { reset: true } 重置过滤状态',
      run: async (ctx, params?: { reset?: boolean }) => {
        if (params?.reset) {
          resetQueueFilters();
          return;
        }
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        await readQueueOverview(ctx, config);
      }
    },
    {
      id: 'rally-fort',
      name: '攻打城寨',
      description: '使用游戏内置搜索查找野蛮人城寨并发起集结',
      run: async (ctx, params: { level?: number; team?: number; downgrade?: boolean; teamPage?: TeamPage } = {}) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const level = params.level || 5;
        const team = params.team || 1;
        const downgrade = params.downgrade !== false;

        // Pre-check: OCR team count to skip if no idle teams
        ctx.log('[预备] OCR 检测空闲队伍数...');
        const regionPath = await ctx.captureRegion(1507, 169, 55, 31);
        const teamCountText = await ocrService.readText(regionPath);
        await fs.unlink(regionPath).catch(() => {});
        ctx.log(`[预备] OCR 结果: "${teamCountText}"`);

        // Parse fraction like "2/4", "3/3", "5/5"
        const match = teamCountText.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          const used = parseInt(match[1], 10);
          const total = parseInt(match[2], 10);
          if (used === total) {
            ctx.log(`⏭️ 无空闲队伍 (${used}/${total})，跳过城寨集结`);
            return;
          }
          ctx.log(`有空闲队伍 (${used}/${total})，继续城寨集结`);
        } else {
          // OCR 可能漏掉斜杠，如 "33" → 3/3, "55" → 5/5
          const digitsOnly = teamCountText.replace(/\D/g, '');
          if (digitsOnly.length >= 2 && /^(\d)\1+$/.test(digitsOnly)) {
            ctx.log(`⏭️ 无空闲队伍 (OCR识别为 "${digitsOnly}"，推测全部忙碌)，跳过城寨集结`);
            return;
          }
          ctx.log('⚠️ 未识别到队伍计数，继续城寨集结');
        }

        const outcome = await rallyFort(ctx, config, level, team, downgrade, params.teamPage ?? 'attack');
        ctx.log(`城寨集结: Lv.${outcome.foundLevel || level} 队伍${team} → ${outcome.result}`);
      }
    },
    {
      id: 'rally-fort-spiral',
      name: '攻打城寨（螺旋搜索）',
      description: '使用图像识别螺旋搜索城寨图标并发起集结',
      run: async (ctx, params: { level?: number; team?: number } = {}) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const level = params.level || 5;
        const team = params.team || 1;

        // Pre-check: OCR team count
        ctx.log('[预备] OCR 检测空闲队伍数...');
        const regionPath = await ctx.captureRegion(1507, 169, 55, 31);
        const teamCountText = await ocrService.readText(regionPath);
        await fs.unlink(regionPath).catch(() => {});
        ctx.log(`[预备] OCR 结果: "${teamCountText}"`);

        const match = teamCountText.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          const used = parseInt(match[1], 10);
          const total = parseInt(match[2], 10);
          if (used === total) {
            ctx.log(`⏭️ 无空闲队伍 (${used}/${total})，跳过城寨集结`);
            return;
          }
          ctx.log(`有空闲队伍 (${used}/${total})，继续城寨集结`);
        } else {
          const digitsOnly = teamCountText.replace(/\D/g, '');
          if (digitsOnly.length >= 2 && /^(\d)\1+$/.test(digitsOnly)) {
            ctx.log(`⏭️ 无空闲队伍 (OCR识别为 "${digitsOnly}"，推测全部忙碌)，跳过城寨集结`);
            return;
          }
          ctx.log('⚠️ 未识别到队伍计数，继续城寨集结');
        }

        const outcome = await rallyFortSpiral(ctx, config, level, team);
        ctx.log(`城寨集结（螺旋）: Lv.${outcome.foundLevel || level} 队伍${team} → ${outcome.result}`);
      }
    },
    {
      id: 'join-rally',
      name: '加入集结',
      description: '自动加入联盟的城寨/洛哈集结，按距离排序选择',
      run: async (ctx, params: {
        team?: number;
        teamPage?: TeamPage;
        targetFort?: boolean;
        targetLohar?: boolean;
        maxDistance?: number;
        firstRun?: boolean;
      } = {}) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const team = params.team || 1;

        const outcome = await joinRally(ctx, config, {
          team,
          teamPage: params.teamPage ?? 'attack',
          targetFort: params.targetFort ?? true,
          targetLohar: params.targetLohar ?? true,
          maxDistance: params.maxDistance ?? 50,
          firstRun: params.firstRun,
        });
        ctx.log(`加入集结: ${outcome.targetType === 'fort' ? '城寨' : outcome.targetType === 'lohar' ? '洛哈' : '未知'} ${outcome.distance || 0}公里 → ${outcome.result}`);
      }
    },
    {
      id: 'gem-gather',
      name: '智能采集宝石',
      description: '使用图像识别螺旋搜索宝石矿并派出队伍采集',
      run: async (ctx, params: { teams?: number[]; teamPage?: TeamPage } = {}) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const teams = params.teams || [1];

        // Pre-check: OCR team count
        ctx.log('[预备] OCR 检测空闲队伍数...');
        const regionPath = await ctx.captureRegion(1507, 169, 55, 31);
        const teamCountText = await ocrService.readText(regionPath);
        await fs.unlink(regionPath).catch(() => {});
        ctx.log(`[预备] OCR 结果: "${teamCountText}"`);

        const match = teamCountText.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          const used = parseInt(match[1], 10);
          const total = parseInt(match[2], 10);
          if (used === total) {
            ctx.log(`⏭️ 无空闲队伍 (${used}/${total})，跳过宝石采集`);
            return;
          }
          ctx.log(`有空闲队伍 (${used}/${total})，继续宝石采集`);
        } else {
          const digitsOnly = teamCountText.replace(/\D/g, '');
          if (digitsOnly.length >= 2 && /^(\d)\1+$/.test(digitsOnly)) {
            ctx.log(`⏭️ 无空闲队伍 (OCR识别为 "${digitsOnly}"，推测全部忙碌)，跳过宝石采集`);
            return;
          }
          ctx.log('⚠️ 未识别到队伍计数，继续宝石采集');
        }

        const outcome = await gatherGem(ctx, config, teams, { teamPage: params.teamPage ?? 'gather' });
        ctx.log(`宝石采集: 队伍[${teams.join(', ')}] → ${outcome.result}，派出 ${outcome.dispatched} 队`);
      }
    },
    {
      id: 'gem-gather-focus',
      name: '宝石采集驻扎模式',
      description: '独占运行，持续采集宝石，暂停城寨/资源/建筑/科技/练兵/社交等所有其他功能',
      run: async (ctx, params: { teams?: number[]; teamPage?: TeamPage } = {}) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const teams = params.teams || [1];
        const outcome = await gatherGemFocus(ctx, config, teams, params.teamPage ?? 'gather');
        ctx.log(`宝石采集(驻扎): 队伍[${teams.join(', ')}] → ${outcome.result}，派出 ${outcome.dispatched} 队`);
      }
    },
    killGame,
    launchGame,
  ],

  onLoad: async () => {
    console.log('[万国觉醒插件] 插件已加载');
  },

  onUnload: async () => {
    console.log('[万国觉醒插件] 插件已卸载');
  }
};
