export interface PluginAction {
  id: string;
  name: string;
  description: string;
  run: (ctx: any) => Promise<void>;
}

export interface PluginConfig {
  [key: string]: {
    type: 'string' | 'number' | 'boolean';
    default: any;
    description: string;
  };
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  actions: PluginAction[];
  config?: PluginConfig;
  onLoad?: () => Promise<void>;
  onUnload?: () => Promise<void>;
}
