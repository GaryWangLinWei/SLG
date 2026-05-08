import { SlgPluginConfig } from './types';

export const DEFAULT_CONFIG: SlgPluginConfig = {
  buildings: [],
  resources: [],
  armies: [],
  collectInterval: 5 * 60, // 5 minutes
  upgradeInterval: 10 * 60 // 10 minutes
};
