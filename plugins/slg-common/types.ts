export interface Position {
  x: number;
  y: number;
}

export interface BuildingConfig {
  name: string;
  position: Position;
  upgradePriority: number;
}

export interface ResourceConfig {
  name: string;
  collectButton: Position;
  templateImage?: string;
}

export interface ArmyConfig {
  name: string;
  position: Position;
  targetPosition: Position;
}

export interface SlgPluginConfig {
  buildings: BuildingConfig[];
  resources: ResourceConfig[];
  armies: ArmyConfig[];
  collectInterval: number;
  upgradeInterval: number;
}
