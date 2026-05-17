import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { RokConfig, DEFAULT_ROK_CONFIG } from '../../plugins/rok';
import { CONFIG_DIR, CONFIGS_DIR, accountService } from './AccountService';

const LEGACY_CONFIG_FILE = path.join(CONFIG_DIR, 'rok-config.json');

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

class ConfigService {
  private configFile(accountId: string): string {
    return path.join(CONFIGS_DIR, `${accountId}.json`);
  }

  async loadConfig(accountId: string): Promise<RokConfig> {
    try {
      const data = await fs.readFile(this.configFile(accountId), 'utf-8');
      const saved = JSON.parse(data) as Partial<RokConfig>;
      const merged = deepMerge(DEFAULT_ROK_CONFIG, saved);
      // buildingPositions & resourceTypes are dictionaries where keys should
      // be replaced entirely, not merged with defaults
      if (saved.buildingPositions) {
        merged.buildingPositions = saved.buildingPositions;
      }
      if (saved.resourceCollect?.resourceTypes) {
        merged.resourceCollect.resourceTypes = saved.resourceCollect.resourceTypes;
      }
      // availableTechs 始终从代码默认值取，不受旧配置覆盖
      merged.techResearch.availableTechs = DEFAULT_ROK_CONFIG.techResearch.availableTechs;
      return merged;
    } catch {
      return { ...DEFAULT_ROK_CONFIG };
    }
  }

  async saveConfig(accountId: string, config: Partial<RokConfig>): Promise<void> {
    await fs.mkdir(CONFIGS_DIR, { recursive: true });
    await fs.writeFile(this.configFile(accountId), JSON.stringify(config, null, 2), 'utf-8');
  }

  async deleteConfig(accountId: string): Promise<void> {
    await fs.unlink(this.configFile(accountId)).catch(() => {});
  }
}

export const configService = new ConfigService();

/**
 * 启动时自动迁移：把旧的 rok-config.json 转为「默认账号」并移动到 configs/{id}.json
 * 触发条件：旧文件存在 + accounts.json 不存在
 */
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
