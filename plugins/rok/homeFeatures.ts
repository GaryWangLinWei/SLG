export interface HomeFeatures {
  collectResources: boolean;
  upgradeBuildings: boolean;
  selectedBuildings: string[];
  autoResearch: boolean;
  selectedTechs: string[];
  gatherResources: boolean;
  gatherTasks: { type: string; level: number }[];
  trainTroops: boolean;
  trainTasks: Record<string, number>;
  autoExplore: boolean;
  exploreCount: number;
  autoWorldChat: boolean;
  worldChatMessages: string[];
  worldChatInterval: number;
  helpTeammates: boolean;
  autoRallyFort: boolean;
  rallyFortTasks: { level: number; team: number }[];
  rallyFortInterval: number;
  loopInterval: number;
}

export const DEFAULT_HOME_FEATURES: HomeFeatures = {
  collectResources: true,
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
  trainTroops: false,
  trainTasks: { '兵营': 0, '马厩': 0, '靶场': 0, '攻城武器厂': 0 },
  autoExplore: false,
  exploreCount: 3,
  autoWorldChat: false,
  worldChatMessages: ['', '', ''],
  worldChatInterval: 300,
  helpTeammates: false,
  autoRallyFort: false,
  rallyFortTasks: [
    { level: 5, team: 1 },
    { level: 5, team: 2 },
    { level: 5, team: 3 },
    { level: 5, team: 4 },
    { level: 5, team: 5 },
  ],
  rallyFortInterval: 600,
  loopInterval: 300,
};
