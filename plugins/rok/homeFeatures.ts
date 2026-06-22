export type TeamPageChoice = 'gather' | 'attack' | 'other';

export const DEFAULT_COLLECT_RESOURCES_INTERVAL_MINUTES = 240;
export const MIN_COLLECT_RESOURCES_INTERVAL_MINUTES = 2;

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
  autoRallyFort: boolean;
  rallyFortLevel: number;
  rallyFortTeam: number;
  rallyFortTeamPage: TeamPageChoice;
  rallyFortDowngrade: boolean;
  gemGatherEnabled: boolean;
  gemGatherFocusMode: boolean;
  gemGatherTeams: number[];
  gemGatherTeamPage: TeamPageChoice;
  gemGatherActiveHours: number;
  gemGatherRestHours: number;
  autoCaveExplore: boolean;
  nightMode: boolean;
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
  autoRallyFort: false,
  rallyFortLevel: 0,
  rallyFortTeam: 1,
  rallyFortTeamPage: 'attack',
  rallyFortDowngrade: true,
  gemGatherEnabled: false,
  gemGatherFocusMode: false,
  gemGatherTeams: [1],
  gemGatherTeamPage: 'gather',
  gemGatherActiveHours: 2,
  gemGatherRestHours: 1,
  autoCaveExplore: false,
  nightMode: false,
};
