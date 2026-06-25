import { PluginManager, Plugin } from '../../core/plugin';
import { Vision } from '../../core/vision';
import { YoloDetector } from '../../core/vision/YoloDetector';
import { getModelsDir } from '../../core/resourcePath';
import { SlgCommonPlugin } from '../../plugins/slg-common';
import { RiseOfKingdomsPlugin } from '../../plugins/rok';
import { deviceService } from './DeviceService';
import { configService } from './ConfigService';
import * as path from 'path';

const ALL_PLUGINS: Plugin[] = [
  SlgCommonPlugin,
  RiseOfKingdomsPlugin
];

class PluginService {
  private managers = new Map<string, PluginManager>();
  private vision = new Vision();
  private yoloDetector: YoloDetector | null = null;
  private stateDetector: YoloDetector | null = null;
  private heroDetector: YoloDetector | null = null;

  async initYoloDetector(): Promise<void> {
    const modelPath = path.join(getModelsDir(), 'gem.onnx');
    try {
      this.yoloDetector = await YoloDetector.create(modelPath);
      console.log('[PluginService] YOLO detector initialized');
    } catch (err: any) {
      console.warn('[PluginService] YOLO model not found at', modelPath, '- YOLO detection disabled:', err.message);
      this.yoloDetector = null;
    }

    const stateModelPath = path.join(getModelsDir(), 'state.onnx');
    try {
      this.stateDetector = await YoloDetector.create(stateModelPath);
      console.log('[PluginService] state detector initialized');
    } catch (err: any) {
      console.warn('[PluginService] state model not found at', stateModelPath, '- state detection disabled:', err.message);
      this.stateDetector = null;
    }

    const heroModelPath = path.join(getModelsDir(), 'hero.onnx');
    try {
      this.heroDetector = await YoloDetector.create(heroModelPath);
      console.log('[PluginService] hero detector initialized');
    } catch (err: any) {
      console.warn('[PluginService] hero model not found at', heroModelPath, '- hero detection disabled:', err.message);
      this.heroDetector = null;
    }
  }

  /**
   * 拿到指定账号的 PluginManager。设备必须已连接。
   * 每次调用都重建，确保 device 引用是最新的（对应 Phase 1 行为：device 重连后重建 manager）。
   */
  private buildManager(accountId: string): PluginManager {
    const device = deviceService.getDevice(accountId);
    if (!device) throw new Error(`账号 ${accountId} 设备未连接，请先连接`);

    const manager = new PluginManager(device, this.vision, this.yoloDetector ?? undefined, this.stateDetector ?? undefined, this.heroDetector ?? undefined);
    ALL_PLUGINS.forEach(p => manager.register(p));
    return manager;
  }

  getPluginManager(accountId: string): PluginManager {
    // 总是重建以确保 device 是当前连接的实例（与原 ensureInitialized 行为一致）
    const manager = this.buildManager(accountId);
    this.managers.set(accountId, manager);
    return manager;
  }

  listPlugins(): Plugin[] {
    return ALL_PLUGINS;
  }

  getPluginConfigSchema(pluginId: string): Record<string, any> {
    const plugin = ALL_PLUGINS.find(p => p.id === pluginId);
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);
    return plugin.config || {};
  }

  async getPluginDefaultConfig(accountId: string, pluginId: string) {
    if (pluginId === 'com.rok.automation') {
      return await configService.loadConfig(accountId);
    }
    return null;
  }

  async getRokFullConfig(accountId: string) {
    return await configService.loadConfig(accountId);
  }

  removeAccount(accountId: string): void {
    this.managers.delete(accountId);
  }
}

export const pluginService = new PluginService();
