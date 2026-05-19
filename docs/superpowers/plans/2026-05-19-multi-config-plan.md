# 多账号配置 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 坐标配置页支持保存最多 5 份命名配置，同一 ADB 设备下快速切换不同游戏角色布局。

**Architecture:** ConfigService 内部存储格式从单对象改为 `{ activeConfigName, configs }` 字典，loadConfig 签名不变（返回激活配置），新增 profile 管理方法。前端 Config 页顶部加配置选择器，Home 页只读显示当前配置名。

**Tech Stack:** TypeScript，无新依赖

---

### Task 1: ConfigService — 多配置存储

**Files:**
- Modify: `server/services/ConfigService.ts`
- Modify: `server/services/ConfigService.test.ts`（如存在）

- [ ] **Step 1: 定义存储格式类型和文件读写方法**

在 `server/services/ConfigService.ts` 中，替换 `loadConfig`/`saveConfig` 的内部实现，新增 profile 管理方法。

首先，在 import 之后、class 之前，替换原来的 `loadConfig` / `saveConfig` / `deleteConfig` 方法为以下完整实现：

读完现有文件 `server/services/ConfigService.ts`（83 行），用以下内容替换整个文件：

```ts
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

  /**
   * 读取多配置文件，自动迁移旧格式。
   */
  private async readMultiConfig(accountId: string): Promise<MultiConfigFile> {
    try {
      const data = await fs.readFile(this.configFile(accountId), 'utf-8');
      const parsed = JSON.parse(data);

      // 检测旧格式：根层级有 buildingPositions 但没有 configs
      if (parsed.configs === undefined) {
        // 自动迁移旧格式
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

  /**
   * 加载激活的配置（签名不变，Home 页/任务执行兼容）
   */
  async loadConfig(accountId: string): Promise<RokConfig> {
    const multi = await this.readMultiConfig(accountId);
    const saved = multi.configs[multi.activeConfigName];
    if (saved) {
      const merged = deepMerge(DEFAULT_ROK_CONFIG, saved);
      return applyOverrides(merged, saved);
    }
    return { ...DEFAULT_ROK_CONFIG };
  }

  /**
   * 加载指定名称的配置
   */
  async loadConfigByName(accountId: string, name: string): Promise<RokConfig> {
    const multi = await this.readMultiConfig(accountId);
    const saved = multi.configs[name];
    if (saved) {
      const merged = deepMerge(DEFAULT_ROK_CONFIG, saved);
      return applyOverrides(merged, saved);
    }
    return { ...DEFAULT_ROK_CONFIG };
  }

  /**
   * 保存配置到指定名称
   */
  async saveConfig(accountId: string, name: string, config: Partial<RokConfig>): Promise<void> {
    const multi = await this.readMultiConfig(accountId);

    // 已有配置则合并，新配置基于默认值
    const existing = multi.configs[name] || {};
    const merged = deepMerge(existing as Record<string, any>, config) as Partial<RokConfig>;
    multi.configs[name] = merged;

    await this.writeMultiConfig(accountId, multi);
  }

  /**
   * 列出所有 profile 名称及当前激活
   */
  async listProfiles(accountId: string): Promise<{ profiles: string[]; active: string }> {
    const multi = await this.readMultiConfig(accountId);
    return {
      profiles: Object.keys(multi.configs),
      active: multi.activeConfigName
    };
  }

  /**
   * 切换激活配置
   */
  async switchProfile(accountId: string, name: string): Promise<void> {
    const multi = await this.readMultiConfig(accountId);
    if (!multi.configs[name]) {
      throw new Error(`配置 "${name}" 不存在`);
    }
    multi.activeConfigName = name;
    await this.writeMultiConfig(accountId, multi);
  }

  /**
   * 删除配置（最后一个不允许删除）
   */
  async deleteProfile(accountId: string, name: string): Promise<void> {
    const multi = await this.readMultiConfig(accountId);
    const names = Object.keys(multi.configs);

    if (names.length <= 1) {
      throw new Error('无法删除最后一个配置');
    }

    delete multi.configs[name];

    // 如果删除的是激活配置，自动切换到第一个
    if (multi.activeConfigName === name) {
      multi.activeConfigName = Object.keys(multi.configs)[0];
    }

    await this.writeMultiConfig(accountId, multi);
  }

  /**
   * 重命名配置
   */
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

  /**
   * 创建新配置（校验上限）
   */
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
```

- [ ] **Step 2: 类型检查后端**

```bash
npx tsc --noEmit
```

Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add server/services/ConfigService.ts
git commit -m "feat: add multi-config storage support to ConfigService"
```

---

### Task 2: Config routes — 新增 API 端点

**Files:**
- Modify: `server/routes/config.ts`

- [ ] **Step 1: 替换路由文件**

用以下内容替换 `server/routes/config.ts`：

```ts
import Router from 'koa-router';
import { configService } from '../services/ConfigService';

const router = new Router({ prefix: '/api/config' });

// GET /api/config/rok?accountId=xxx — 返回激活配置（兼容旧版）
// GET /api/config/rok?accountId=xxx&name=yyy — 返回指定配置
router.get('/rok', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  const name = ctx.query.name as string | undefined;

  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }

  const config = name
    ? await configService.loadConfigByName(accountId, name)
    : await configService.loadConfig(accountId);
  ctx.body = { success: true, config };
});

// PUT /api/config/rok?accountId=xxx&name=yyy — 保存配置
router.put('/rok', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  const name = ctx.query.name as string;

  if (!accountId || !name) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 和 name 必填' };
    return;
  }

  const config = ctx.request.body;
  if (!config || typeof config !== 'object') {
    ctx.status = 400;
    ctx.body = { success: false, error: '请求体必须是 JSON 对象' };
    return;
  }

  await configService.saveConfig(accountId, name, config);
  ctx.body = { success: true };
});

// GET /api/config/rok/profiles?accountId=xxx — 列出所有配置
router.get('/rok/profiles', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }

  const result = await configService.listProfiles(accountId);
  ctx.body = { success: true, ...result };
});

// POST /api/config/rok/switch?accountId=xxx — 切换激活配置
router.post('/rok/switch', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }

  const { name } = ctx.request.body || {};
  if (!name) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'name 必填' };
    return;
  }

  try {
    await configService.switchProfile(accountId, name);
    ctx.body = { success: true };
  } catch (e: any) {
    ctx.status = 400;
    ctx.body = { success: false, error: e.message };
  }
});

// POST /api/config/rok/create?accountId=xxx — 创建新配置
router.post('/rok/create', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }

  const { name } = ctx.request.body || {};
  if (!name) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'name 必填' };
    return;
  }

  try {
    await configService.createProfile(accountId, name);
    ctx.body = { success: true };
  } catch (e: any) {
    ctx.status = 400;
    ctx.body = { success: false, error: e.message };
  }
});

// DELETE /api/config/rok?accountId=xxx&name=yyy — 删除配置
router.delete('/rok', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  const name = ctx.query.name as string;

  if (!accountId || !name) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 和 name 必填' };
    return;
  }

  try {
    await configService.deleteProfile(accountId, name);
    ctx.body = { success: true };
  } catch (e: any) {
    ctx.status = 400;
    ctx.body = { success: false, error: e.message };
  }
});

// POST /api/config/rok/rename?accountId=xxx — 重命名配置
router.post('/rok/rename', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }

  const { oldName, newName } = ctx.request.body || {};
  if (!oldName || !newName) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'oldName 和 newName 必填' };
    return;
  }

  try {
    await configService.renameProfile(accountId, oldName, newName);
    ctx.body = { success: true };
  } catch (e: any) {
    ctx.status = 400;
    ctx.body = { success: false, error: e.message };
  }
});

export default router;
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit
```

Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add server/routes/config.ts
git commit -m "feat: add multi-config API endpoints"
```

---

### Task 3: 前端 API client — 新增方法

**Files:**
- Modify: `web/src/api/client.ts`

- [ ] **Step 1: 在 `config` 对象中添加新方法**

在 `web/src/api/client.ts` 中找到 `config:` 块（约第 150-158 行），替换为：

```ts
  config: {
    getRokConfig: (accountId: string, name?: string) => {
      const params = new URLSearchParams({ accountId });
      if (name) params.set('name', name);
      return request<{ success: boolean; config: Record<string, any> }>(`/config/rok?${params}`);
    },
    saveRokConfig: (accountId: string, config: Record<string, any>, name: string) =>
      request<{ success: boolean }>(`/config/rok?accountId=${accountId}&name=${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify(config)
      }),
    getProfiles: (accountId: string) =>
      request<{ success: boolean; profiles: string[]; active: string }>(`/config/rok/profiles?accountId=${accountId}`),
    switchProfile: (accountId: string, name: string) =>
      request<{ success: boolean }>(`/config/rok/switch?accountId=${accountId}`, {
        method: 'POST',
        body: JSON.stringify({ name })
      }),
    createProfile: (accountId: string, name: string) =>
      request<{ success: boolean }>(`/config/rok/create?accountId=${accountId}`, {
        method: 'POST',
        body: JSON.stringify({ name })
      }),
    deleteProfile: (accountId: string, name: string) =>
      request<{ success: boolean }>(`/config/rok?accountId=${accountId}&name=${encodeURIComponent(name)}`, {
        method: 'DELETE'
      }),
    renameProfile: (accountId: string, oldName: string, newName: string) =>
      request<{ success: boolean }>(`/config/rok/rename?accountId=${accountId}`, {
        method: 'POST',
        body: JSON.stringify({ oldName, newName })
      })
  },
```

- [ ] **Step 2: 类型检查前端**

```bash
cd web && npx tsc --noEmit
```

Expected: 无新增错误（24 个预存错误可忽略）

- [ ] **Step 3: Commit**

```bash
git add web/src/api/client.ts
git commit -m "feat: add multi-config API methods to frontend client"
```

---

### Task 4: Config 页面 — 配置管理 UI

**Files:**
- Modify: `web/src/pages/Config.tsx`

- [ ] **Step 1: 添加状态变量**

在 `ConfigPage` 组件内部的现有状态声明之后（约第 29 行后），添加新的配置相关状态：

找到：
```ts
  const [selectedSection, setSelectedSection] = useState<'buildings' | 'resources'>('buildings');
```

在其后添加：
```ts
  // 多配置相关状态
  const [configName, setConfigName] = useState('默认配置');
  const [configNames, setConfigNames] = useState<string[]>([]);
  const [activeConfigName, setActiveConfigName] = useState('');
```

- [ ] **Step 2: 添加 loadProfiles 和 switchConfig 函数**

在 `loadConfig` 函数之后（约第 51 行），添加：

```ts
  const loadProfiles = useCallback(async () => {
    if (!currentAccountId) return;
    try {
      const res = await api.config.getProfiles(currentAccountId);
      if (res.success) {
        setConfigNames(res.profiles);
        setActiveConfigName(res.active);
        setConfigName(res.active);
      }
    } catch { /* ignore */ }
  }, [currentAccountId]);

  const switchConfig = async (name: string) => {
    if (!currentAccountId || name === configName) return;
    try {
      await api.config.switchProfile(currentAccountId, name);
      setConfigName(name);
      setActiveConfigName(name);
      // 加载新配置的建筑坐标
      const res = await api.config.getRokConfig(currentAccountId, name);
      if (res.success && res.config) {
        if (res.config.buildingPositions) {
          const entries = Object.entries(res.config.buildingPositions as Record<string, { x: number; y: number }>);
          setBuildingPositions(entries.map(([name, pos]) => ({ name, x: pos.x, y: pos.y })));
        } else {
          setBuildingPositions([]);
        }
        if (res.config.resources) setResources(res.config.resources);
        else setResources([]);
      }
    } catch (e: any) {
      setMessage(e.message || '切换失败');
    }
  };
```

- [ ] **Step 3: 修改 loadConfig 和 useEffect，加入 loadProfiles**

将 `useEffect` 行（约第 53 行）：
```ts
  useEffect(() => { checkStatus(); loadConfig(); }, [checkStatus, loadConfig]);
```
改为：
```ts
  useEffect(() => { checkStatus(); loadConfig(); loadProfiles(); }, [checkStatus, loadConfig, loadProfiles]);
```

- [ ] **Step 4: 修改 handleSave，加入 configName**

将 `handleSave` 函数（约第 146-154 行）中的：
```ts
      const result = await api.config.saveRokConfig(currentAccountId, buildConfig());
```
改为：
```ts
      const result = await api.config.saveRokConfig(currentAccountId, buildConfig(), configName);
```

- [ ] **Step 5: 添加新建/重命名/删除处理函数**

在 `handleSave` 函数之后（约第 154 行后），添加：

```ts
  const handleCreateProfile = async () => {
    const name = window.prompt('请输入新配置名称：');
    if (!name || !name.trim()) return;
    if (!currentAccountId) return;
    try {
      await api.config.createProfile(currentAccountId, name.trim());
      setMessage(`配置「${name.trim()}」已创建`);
      await loadProfiles();
    } catch (e: any) {
      setMessage(e.message || '创建失败');
    }
  };

  const handleRenameProfile = async () => {
    const newName = window.prompt(`重命名「${configName}」为：`);
    if (!newName || !newName.trim()) return;
    if (!currentAccountId) return;
    try {
      await api.config.renameProfile(currentAccountId, configName, newName.trim());
      setMessage(`已重命名为「${newName.trim()}」`);
      setConfigName(newName.trim());
      await loadProfiles();
    } catch (e: any) {
      setMessage(e.message || '重命名失败');
    }
  };

  const handleDeleteProfile = async () => {
    if (!window.confirm(`确定删除配置「${configName}」？此操作不可恢复。`)) return;
    if (!currentAccountId) return;
    try {
      await api.config.deleteProfile(currentAccountId, configName);
      setMessage(`配置「${configName}」已删除`);
      await loadProfiles();
      // 重新加载激活配置
      const res2 = await api.config.getProfiles(currentAccountId);
      if (res2.success && res2.active) {
        setConfigName(res2.active);
        setActiveConfigName(res2.active);
        await loadConfig();
      }
    } catch (e: any) {
      setMessage(e.message || '删除失败');
    }
  };
```

- [ ] **Step 6: 在页面顶部（连接/截图按钮行之前）添加配置管理栏**

在 `<h1 className="text-2xl font-bold mb-2">坐标配置</h1>` 之后，`{message && ...}` 之前（约第 171-172 行之间），插入：

```tsx
      {/* 配置管理栏 */}
      <div className="flex items-center gap-3 mb-4 bg-gray-800 rounded-lg p-3">
        <span className="text-sm text-gray-400">配置：</span>
        <select
          value={configName}
          onChange={e => switchConfig(e.target.value)}
          className="px-3 py-1.5 bg-gray-700 rounded text-sm border border-gray-600 min-w-[140px]"
        >
          {configNames.map(name => (
            <option key={name} value={name}>{name}{name === activeConfigName ? ' (当前)' : ''}</option>
          ))}
        </select>
        <button
          onClick={handleCreateProfile}
          disabled={configNames.length >= 5}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >新建</button>
        <button
          onClick={handleRenameProfile}
          className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-sm"
        >重命名</button>
        <button
          onClick={handleDeleteProfile}
          disabled={configNames.length <= 1}
          className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >删除</button>
        <span className="text-xs text-gray-500 ml-auto">{configNames.length}/5</span>
      </div>
```

- [ ] **Step 7: 类型检查前端**

```bash
cd web && npx tsc --noEmit
```

Expected: 无新增错误

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/Config.tsx
git commit -m "feat: add config profile selector and management to Config page"
```

---

### Task 5: Home 页 — 显示当前账号和配置名

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 添加状态和加载逻辑**

在 `const { currentAccountId } = useAccount();`（第 114 行）改为同时获取 accounts 列表，用于显示账号名：

```ts
  const { currentAccountId, accounts } = useAccount();
```

在现有 useState 声明区域（约第 115-130 行之间），添加配置名状态：

```ts
  const [activeConfigName, setActiveConfigName] = useState('');
```

在组件内找一个现有的 `useEffect`（可在 `loadBuildingOptions` 的 useEffect 附近），添加一个新的 useEffect 来加载配置名：

```ts
  useEffect(() => {
    if (!currentAccountId) return;
    api.config.getProfiles(currentAccountId).then(res => {
      if (res.success) setActiveConfigName(res.active);
    }).catch(() => {});
  }, [currentAccountId]);
```

- [ ] **Step 2: 在 header 区域添加账号名和配置名显示**

在 Home 页面的 header 区域（约第 491-503 行），找到 `<h1>` 和状态指示器之间的位置。将 header 左侧改为包含账号和配置信息：

找到：
```tsx
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold text-blue-400">万国觉醒自动化助手</h1>
```

改为：
```tsx
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-blue-400">万国觉醒自动化助手</h1>
            {currentAccountId && (
              <span className="text-sm text-gray-400">
                👤 {accounts.find(a => a.id === currentAccountId)?.name || currentAccountId}
                {activeConfigName && <span className="ml-2">| 📐 {activeConfigName}</span>}
              </span>
            )}
          </div>
```

- [ ] **Step 3: 类型检查前端**

```bash
cd web && npx tsc --noEmit
```

Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: show active config name on Home page"
```

---

### Task 6: 最终验证

- [ ] **Step 1: 全量 TypeScript 检查**

```bash
npx tsc --noEmit && cd web && npx tsc --noEmit
```

Expected: 后端无错误；前端仅预存的 24 个错误，无新增

- [ ] **Step 2: 运行后端测试**

```bash
npx jest --no-coverage
```

Expected: 预存测试通过（1 个 screenshot 相关测试可能因无设备失败，可忽略）

- [ ] **Step 3: 启动前后端验证**

```bash
# 终端 1：后端
npm run server

# 终端 2：前端
cd web && npm run dev
```

打开浏览器，验证：
- Config 页：配置选择器出现，新建/重命名/删除可用
- 最多 5 个上限校验生效
- 切换配置后建筑坐标正确加载
- Home 页显示当前配置名
- 旧格式配置自动迁移为「默认配置」

- [ ] **Step 4: Commit（如有改动）**

```bash
git add -A
git commit -m "chore: final verification of multi-config feature"
```
