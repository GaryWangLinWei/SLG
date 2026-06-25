import { Plugin } from './types';
import { PluginContext } from './PluginContext';
import { Device } from '../device';
import { Vision } from '../vision';
import { YoloDetector } from '../vision/YoloDetector';

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private device: Device;
  private vision: Vision;
  private yoloDetector?: YoloDetector;
  private stateDetector?: YoloDetector;

  constructor(device: Device, vision: Vision, yoloDetector?: YoloDetector, stateDetector?: YoloDetector) {
    this.device = device;
    this.vision = vision;
    this.yoloDetector = yoloDetector;
    this.stateDetector = stateDetector;
  }

  register(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin);
    if (plugin.onLoad) {
      plugin.onLoad();
    }
  }

  unregister(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin && plugin.onUnload) {
      plugin.onUnload();
    }
    this.plugins.delete(pluginId);
  }

  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  listPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  async runAction(
    pluginId: string,
    actionId: string,
    config: Record<string, any> = {},
    checkStop?: () => void,
    logCallback?: (msg: string) => void
  ): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);

    const action = plugin.actions.find(a => a.id === actionId);
    if (!action) throw new Error(`Action ${actionId} not found in plugin ${pluginId}`);

    const ctx = new PluginContext(this.device, this.vision, config, checkStop, logCallback, this.yoloDetector, this.stateDetector);
    await action.run(ctx, config);
  }
}
