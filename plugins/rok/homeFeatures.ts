export type TeamPageChoice = 'gather' | 'attack' | 'other';

export const DEFAULT_COLLECT_RESOURCES_INTERVAL_MINUTES = 240;
export const MIN_COLLECT_RESOURCES_INTERVAL_MINUTES = 2;

export const DEFAULT_AUTO_RECONNECT_INTERVAL_MINUTES = 5;
export const MIN_AUTO_RECONNECT_INTERVAL_MINUTES = 0;

export function getCollectResourcesIntervalSeconds(minutes: number): number {
  const baseMinutes = Number.isFinite(minutes) ? Math.max(MIN_COLLECT_RESOURCES_INTERVAL_MINUTES, minutes) : DEFAULT_COLLECT_RESOURCES_INTERVAL_MINUTES;
  return baseMinutes * 60 * (0.85 + Math.random() * 0.3);
}

export interface HomeFeatures {
  collectResources: boolean;
  collectResourcesIntervalMinutes: number;
  upgradeBuildings: boolean;
  selectedBuildings: string[];
  autoResearch: boolean;
  selectedTechs: string[];
  gatherResources: boolean;
  gatherTasks: { type: string; level: number }[];
  resourceGatherTeamPage: TeamPageChoice;
  trainTroops: boolean;
  trainTasks: Record<string, number>;
  autoExplore: boolean;
  exploreCount: number;
  autoWorldChat: boolean;
  worldChatMessages: string[];
  worldChatInterval: number;
  helpTeammates: boolean;
  autoReconnectIntervalMinutes: number;
  autoRallyFort: boolean;
  rallyFortLevel: number;
  rallyFortTeam: number;
  rallyFortTeamPage: TeamPageChoice;
  rallyFortDowngrade: boolean;
  rallyFortUsePotion: boolean;
  rallyFortFallbackTeam: boolean;
  rallyFortFallbackTeamNum: number;
  rallyFortFallbackTroopType: 'any' | 'infantry' | 'cavalry' | 'archer';
  rallyFortTroopType: 'any' | 'infantry' | 'cavalry' | 'archer';
  shareGemEnabled: boolean;
  shareGemStopCondition: 'spiral' | 'count5' | 'count10' | 'count15' | 'count100';
  gemGatherEnabled: boolean;
  gemGatherMode: 'normal' | 'focus' | 'mixed';
  gemGatherTeams: number[];
  gemGatherTeamPage: TeamPageChoice;
  gemGatherActiveHours: number;
  gemGatherRestHours: number;
  gemGatherMixRatio: number;
  gemGatherMaxDistance: number;
  gemGatherSharedOnly: boolean;
  gemGatherHomeX: number;
  gemGatherHomeY: number;
  /** 滑动搜索后额外等待秒数（默认 0）。用于慢速模拟器给渲染更长时间 */
  gemGatherExtraSwipePauseSec: number;
  gemSearchWeights: { spiral: number; reverseSpiral: number; randomWalk: number; snake: number };
  autoCaveExplore: boolean;
  nightMode: boolean;
  joinRallyEnabled: boolean;
  joinRallyTeam: number;
  joinRallyTeamPage: TeamPageChoice;
  joinRallyTargetFort: boolean;
  joinRallyTargetLohar: boolean;
  joinRallyMaxDistance: number;
  joinRallyUsePotion: boolean;
  joinRallyUseDefaultTeam: boolean;
  produceMaterialEnabled: boolean;
  produceMaterialType: 'leather' | 'iron' | 'ebony' | 'bone';
  claimAllianceTerritoryEnabled: boolean;
  attackDetectEnabled: boolean;
  autoShieldEnabled: boolean;
  autoSwitchAccount: boolean;
  switchMode: 'per-round' | 'per-time' | 'fort-mode' | 'combo-gem';
  switchIntervalMinutes: number | number[];
  switchProfileIds: string[];  // dev: 最多 4 个；prod: 最多 2 个
}

export const DEFAULT_HOME_FEATURES: HomeFeatures = {
  collectResources: true,
  collectResourcesIntervalMinutes: DEFAULT_COLLECT_RESOURCES_INTERVAL_MINUTES,
  upgradeBuildings: true,
  selectedBuildings: ['', '', '', '', ''],
  autoResearch: false,
  selectedTechs: ['', '', '', '', ''],
  gatherResources: false,
  gatherTasks: [
    { type: '农田', level: 5 },
    { type: '伐木场', level: 4 },
    { type: '石矿', level: 3 },
    { type: '金矿', level: 2 },
    { type: '', level: 1 },
    { type: '', level: 1 },
    { type: '', level: 1 },
  ],
  resourceGatherTeamPage: 'gather',
  trainTroops: false,
  trainTasks: { '兵营': 0, '马厩': 0, '靶场': 0, '攻城武器厂': 0 },
  autoExplore: false,
  exploreCount: 3,
  autoWorldChat: false,
  worldChatMessages: ['', '', ''],
  worldChatInterval: 300,
  helpTeammates: false,
  autoReconnectIntervalMinutes: 5,
  autoRallyFort: false,
  rallyFortLevel: 0,
  rallyFortTeam: 1,
  rallyFortTeamPage: 'attack',
  rallyFortDowngrade: true,
  rallyFortUsePotion: false,
  rallyFortFallbackTeam: false,
  rallyFortFallbackTeamNum: 2,
  rallyFortFallbackTroopType: 'any',
  rallyFortTroopType: 'any',
  shareGemEnabled: false,
  shareGemStopCondition: 'spiral',
  gemGatherEnabled: false,
  gemGatherMode: 'normal',
  gemGatherTeams: [1],
  gemGatherTeamPage: 'gather',
  gemGatherActiveHours: 3,
  gemGatherRestHours: 1,
  gemGatherMixRatio: 0.5,
  gemGatherMaxDistance: 100,
  gemGatherSharedOnly: false,
  gemGatherHomeX: 0,
  gemGatherHomeY: 0,
  gemGatherExtraSwipePauseSec: 0,
  gemSearchWeights: { spiral: 40, reverseSpiral: 40, randomWalk: 10, snake: 10 },
  autoCaveExplore: false,
  nightMode: false,
  joinRallyEnabled: false,
  joinRallyTeam: 1,
  joinRallyTeamPage: 'attack',
  joinRallyTargetFort: true,
  joinRallyTargetLohar: true,
  joinRallyMaxDistance: 50,
  joinRallyUsePotion: false,
  joinRallyUseDefaultTeam: false,
  produceMaterialEnabled: false,
  produceMaterialType: 'leather',
  claimAllianceTerritoryEnabled: false,
  attackDetectEnabled: false,
  autoShieldEnabled: false,
  autoSwitchAccount: false,
  switchMode: 'per-round',
  switchIntervalMinutes: 30,
  switchProfileIds: ['', ''],
};
