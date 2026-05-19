import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { RokConfig, DEFAULT_ROK_CONFIG } from '../../plugins/rok';
import { CONFIG_DIR, CONFIGS_DIR, accountService } from './AccountService';

const LEGACY_CONFIG_FILE = path.join(CONFIG_DIR, 'rok-config.json');
const MAX_PROFILES = 5;

interface MultiConfigFile {
  activeConfigName: string;
  configs: Record<string, Partial<RokConfig>>;
}

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target } as Record<string, any>;
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) &&
        tv && typeof tv === 'object' && !Array.isArray(tv)) {
      result[key as string] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      result[key as string] = sv;
    }
  }
  return result as T;
}

function applyOverrides(merged: RokConfig, saved: Partial<RokConfig>): RokConfig {
  if (saved.buildingPositions) {
    merged.buildingPositions = saved.buildingPositions;
  }
  if (saved.resourceCollect?.resourceTypes) {
    merged.resourceCollect.resourceTypes = saved.resourceCollect.resourceTypes;
  }
  merged.techResearch.availableTechs = DEFAULT_ROK_CONFIG.techResearch.availableTechs;
  return merged;
}

class ConfigService {
  private configFile(accountId: string): string {
    return path.join(CONFIGS_DIR, `${accountId}.json`);
  }

  private async readMultiConfig(accountId: string): Promise<MultiConfigFile> {
    try {
      const data = await fs.readFile(this.configFile(accountId), 'utf-8');
      const parsed = JSON.parse(data);

      if (parsed.configs === undefined) {
        const migrated: MultiConfigFile = {
          activeConfigName: '默认配置',
          configs: { '默认配置': parsed }
        };
        await this.writeMultiConfig(accountId, migrated);
        return migrated;
      }

      return parsed as MultiConfigFile;
    } catch {
      return { activeConfigName: '默认配置', configs: {} };
    }
  }

  private async writeMultiConfig(accountId: string, data: MultiConfigFile): Promise<void> {
    await fs.mkdir(CONFIGS_DIR, { recursive: true });
    await fs.writeFile(this.configFile(accountId), JSON.stringify(data, null, 2), 'utf-8');
  }

  async loadConfig(accountId: string): Promise<RokConfig> {
    const multi = await this.readMultiConfig(accountId);
    const saved = multi.configs[multi.activeConfigName];
    if (saved) {
      const merged = deepMerge(DEFAULT_ROK_CONFIG, saved);
      return applyOverrides(merged, saved);
    }
    return { ...DEFAULT_ROK_CONFIG };
  }

  async loadConfigByName(accountId: string, name: string): Promise<RokConfig> {
    const multi = await this.readMultiConfig(accountId);
    const saved = multi.configs[name];
    if (saved) {
      const merged = deepMerge(DEFAULT_ROK_CONFIG, saved);
      return applyOverrides(merged, saved);
    }
    return { ...DEFAULT_ROK_CONFIG };
  }

  async saveConfig(accountId: string, name: string, config: Partial<RokConfig>): Promise<void> {
    const multi = await this.readMultiConfig(accountId);
    const existing = multi.configs[name] || {};
    const merged = deepMerge(existing as Record<string, any>, config) as Partial<RokConfig>;
    multi.configs[name] = merged;
    await this.writeMultiConfig(accountId, multi);
  }

  async listProfiles(accountId: string): Promise<{ profiles: string[]; active: string }> {
    const multi = await this.readMultiConfig(accountId);
    return {
      profiles: Object.keys(multi.configs),
      active: multi.activeConfigName
    };
  }

  async switchProfile(accountId: string, name: string): Promise<void> {
    const multi = await this.readMultiConfig(accountId);
    if (!multi.configs[name]) {
      throw new Error(`配置 "${name}" 不存在`);
    }
    multi.activeConfigName = name;
    await this.writeMultiConfig(accountId, multi);
  }

  async deleteProfile(accountId: string, name: string): Promise<void> {
    const multi = await this.readMultiConfig(accountId);
    if (!multi.configs[name]) {
      throw new Error(`配置 "${name}" 不存在`);
    }
    const names = Object.keys(multi.configs);
    if (names.length <= 1) {
      throw new Error('无法删除最后一个配置');
    }
    delete multi.configs[name];
    if (multi.activeConfigName === name) {
      multi.activeConfigName = Object.keys(multi.configs)[0];
    }
    await this.writeMultiConfig(accountId, multi);
  }

  async renameProfile(accountId: string, oldName: string, newName: string): Promise<void> {
    const multi = await this.readMultiConfig(accountId);
    if (!multi.configs[oldName]) {
      throw new Error(`配置 "${oldName}" 不存在`);
    }
    if (multi.configs[newName]) {
      throw new Error(`配置 "${newName}" 已存在`);
    }
    multi.configs[newName] = multi.configs[oldName];
    delete multi.configs[oldName];
    if (multi.activeConfigName === oldName) {
      multi.activeConfigName = newName;
    }
    await this.writeMultiConfig(accountId, multi);
  }

  async createProfile(accountId: string, name: string): Promise<void> {
    const multi = await this.readMultiConfig(accountId);
    if (Object.keys(multi.configs).length >= MAX_PROFILES) {
      throw new Error(`最多只能保存 ${MAX_PROFILES} 个配置`);
    }
    if (multi.configs[name]) {
      throw new Error(`配置 "${name}" 已存在`);
    }
    multi.configs[name] = {};
    await this.writeMultiConfig(accountId, multi);
  }

  async deleteAccountConfig(accountId: string): Promise<void> {
    await fs.unlink(this.configFile(accountId)).catch(() => {});
  }
}

export const configService = new ConfigService();

export async function migrateLegacyConfig(): Promise<void> {
  const accountsFile = path.join(CONFIG_DIR, 'accounts.json');
  if (!existsSync(LEGACY_CONFIG_FILE) || existsSync(accountsFile)) return;

  try {
    await fs.mkdir(CONFIGS_DIR, { recursive: true });
    const account = await accountService.createAccount({
      name: '默认账号',
      deviceId: '127.0.0.1:7555'
    });
    const newPath = path.join(CONFIGS_DIR, `${account.id}.json`);
    await fs.rename(LEGACY_CONFIG_FILE, newPath);
    console.log(`✅ 已迁移旧配置到账号「默认账号」(${account.id}) → ${newPath}`);
  } catch (e) {
    console.error('迁移旧配置失败:', e);
  }
}
