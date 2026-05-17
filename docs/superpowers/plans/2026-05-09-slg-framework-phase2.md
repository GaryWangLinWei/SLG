# SLG自动化框架 - Phase 2: SLG通用插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现SLG游戏通用插件，包含常用自动化操作模板（收集资源、升级建筑、自动出征等），完善插件上下文API

**Architecture:** 所有业务逻辑封装在SLG通用插件中，通过PluginContext API与核心引擎交互

**Tech Stack:** Node.js 20+, TypeScript 5, Jest

---

## Task 1: 完善 PluginContext API

**Files:**
- Modify: `core/plugin/PluginContext.ts`
- Test: `core/plugin/PluginContext.test.ts`

**Step 1: Add more context methods**

```typescript
// Add to PluginContext.ts
async swipe(x1: number, y1: number, x2: number, y2: number, duration: number = 500): Promise<void> {
  await this.device.swipe(x1, y1, x2, y2, duration);
}

async inputText(text: string): Promise<void> {
  await this.device.inputText(text);
}

async waitForImage(templatePath: string, timeout: number = 30, threshold: number = 0.8): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout * 1000) {
    if (await this.findImage(templatePath, threshold)) {
      return true;
    }
    await this.sleep(0.5);
  }
  return false;
}

async waitWhileImage(templatePath: string, timeout: number = 30, threshold: number = 0.8): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout * 1000) {
    if (!(await this.findImage(templatePath, threshold))) {
      return true;
    }
    await this.sleep(0.5);
  }
  return false;
}

getConfig<T = any>(key: string, defaultValue?: T): T {
  return this.config[key] ?? defaultValue;
}
```

**Step 2: Write tests for new methods**

```typescript
// core/plugin/PluginContext.test.ts
import { PluginContext } from './PluginContext';
import { Device } from '../device';
import { Vision } from '../vision';

describe('PluginContext', () => {
  let mockDevice: jest.Mocked<Device>;
  let mockVision: jest.Mocked<Vision>;
  let context: PluginContext;

  beforeEach(() => {
    mockDevice = {
      tap: jest.fn(),
      swipe: jest.fn(),
      inputText: jest.fn(),
      sleep: jest.fn(),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('fake'))
    } as any;
    
    mockVision = {
      findImage: jest.fn()
    } as any;
    
    context = new PluginContext(mockDevice, mockVision, { testKey: 'testValue' });
  });

  it('should call device tap', async () => {
    await context.tap(100, 200);
    expect(mockDevice.tap).toHaveBeenCalledWith(100, 200);
  });

  it('should call device swipe', async () => {
    await context.swipe(0, 0, 100, 100, 300);
    expect(mockDevice.swipe).toHaveBeenCalledWith(0, 0, 100, 100, 300);
  });

  it('should get config value', () => {
    expect(context.getConfig('testKey')).toBe('testValue');
    expect(context.getConfig('nonExistent', 'default')).toBe('default');
  });
});
```

**Step 3: Run tests**

Run: `npx jest core/plugin/PluginContext.test.ts -v`
Expected: All tests pass

**Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

**Step 5: Commit**

```bash
git add core/plugin/PluginContext.ts core/plugin/PluginContext.test.ts
git commit -m "feat: expand PluginContext API with additional methods"
```

---

## Task 2: 创建SLG通用插件基础结构

**Files:**
- Create: `plugins/slg-common/types.ts`
- Create: `plugins/slg-common/config.ts`
- Create: `plugins/slg-common/index.ts`

**Step 1: Define SLG action types**

```typescript
// plugins/slg-common/types.ts
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
```

**Step 2: Define default config**

```typescript
// plugins/slg-common/config.ts
import { SlgPluginConfig } from './types';

export const DEFAULT_CONFIG: SlgPluginConfig = {
  buildings: [],
  resources: [],
  armies: [],
  collectInterval: 5 * 60, // 5 minutes
  upgradeInterval: 10 * 60 // 10 minutes
};
```

**Step 3: Create plugin base structure**

```typescript
// plugins/slg-common/index.ts
import { Plugin } from '../../core/plugin';
import { DEFAULT_CONFIG } from './config';
import { SlgPluginConfig } from './types';

export const SlgCommonPlugin: Plugin = {
  id: 'com.slg.common',
  name: 'SLG通用插件',
  version: '1.0.0',
  description: '适用于大多数SLG游戏的通用自动化插件',
  author: 'SLG Auto Framework',
  
  config: {
    collectInterval: {
      type: 'number',
      default: DEFAULT_CONFIG.collectInterval,
      description: '资源收集间隔（秒）'
    },
    upgradeInterval: {
      type: 'number',
      default: DEFAULT_CONFIG.upgradeInterval,
      description: '建筑升级检查间隔（秒）'
    }
  },

  actions: [
    // Actions will be added in subsequent tasks
  ],

  onLoad: async () => {
    console.log('[SLG Common Plugin] 插件已加载');
  },

  onUnload: async () => {
    console.log('[SLG Common Plugin] 插件已卸载');
  }
};
```

**Step 4: Add export to plugins index**

Create `plugins/index.ts`:
```typescript
export { ExamplePlugin } from './example';
export { SlgCommonPlugin } from './slg-common';
```

**Step 5: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

**Step 6: Commit**

```bash
git add plugins/slg-common/types.ts plugins/slg-common/config.ts plugins/slg-common/index.ts plugins/index.ts
git commit -m "feat: add SLG common plugin base structure"
```

---

## Task 3: 实现资源收集操作

**Files:**
- Modify: `plugins/slg-common/index.ts`
- Create: `plugins/slg-common/actions/collectResources.ts`
- Test: `plugins/slg-common/actions/collectResources.test.ts`

**Step 1: Create collectResources action**

```typescript
// plugins/slg-common/actions/collectResources.ts
import { PluginContext } from '../../../core/plugin';
import { ResourceConfig } from '../types';

export async function collectResources(
  ctx: PluginContext,
  resources: ResourceConfig[]
): Promise<void> {
  ctx.log('开始收集资源...');

  for (const resource of resources) {
    ctx.log(`收集 ${resource.name}...`);
    
    if (resource.templateImage) {
      const found = await ctx.waitForImage(resource.templateImage, 5);
      if (!found) {
        ctx.log(`未找到 ${resource.name}，跳过`);
        continue;
      }
      await ctx.tapImage(resource.templateImage);
    } else {
      await ctx.tap(resource.collectButton.x, resource.collectButton.y);
    }
    
    await ctx.sleep(1);
    
    // Tap back to main screen if needed
    await ctx.sleep(0.5);
  }

  ctx.log('资源收集完成');
}
```

**Step 2: Add log method to PluginContext**

```typescript
// Add to PluginContext.ts
log(message: string): void {
  console.log(`[PluginContext] ${message}`);
}
```

**Step 3: Register action in plugin**

```typescript
// Add to plugins/slg-common/index.ts
import { collectResources } from './actions/collectResources';

// In actions array:
{
  id: 'collect-resources',
  name: '收集资源',
  description: '遍历所有资源建筑并收集产出',
  run: async (ctx) => {
    const resources = ctx.getConfig('resources', []);
    await collectResources(ctx, resources);
  }
}
```

**Step 4: Write tests**

```typescript
// plugins/slg-common/actions/collectResources.test.ts
import { collectResources } from './collectResources';
import { PluginContext } from '../../../core/plugin';
import { ResourceConfig } from '../types';

describe('collectResources', () => {
  let mockCtx: jest.Mocked<PluginContext>;
  let testResources: ResourceConfig[];

  beforeEach(() => {
    mockCtx = {
      log: jest.fn(),
      tap: jest.fn(),
      tapImage: jest.fn(),
      sleep: jest.fn(),
      waitForImage: jest.fn().mockResolvedValue(true)
    } as any;

    testResources = [
      { name: '金矿', collectButton: { x: 100, y: 200 } },
      { name: '农田', collectButton: { x: 150, y: 250 } }
    ];
  });

  it('should collect all resources', async () => {
    await collectResources(mockCtx, testResources);
    
    expect(mockCtx.log).toHaveBeenCalledWith('开始收集资源...');
    expect(mockCtx.log).toHaveBeenCalledWith('收集 金矿...');
    expect(mockCtx.log).toHaveBeenCalledWith('收集 农田...');
    expect(mockCtx.tap).toHaveBeenCalledTimes(2);
  });

  it('should skip resource if template not found', async () => {
    mockCtx.waitForImage.mockResolvedValue(false);
    
    testResources[0].templateImage = 'gold-mine.png';
    await collectResources(mockCtx, testResources);
    
    expect(mockCtx.log).toHaveBeenCalledWith('未找到 金矿，跳过');
  });
});
```

**Step 5: Run tests and verify compilation**

Run: `npx jest plugins/slg-common/actions/collectResources.test.ts -v`
Run: `npx tsc --noEmit`
Expected: Tests pass, no TypeScript errors

**Step 6: Commit**

```bash
git add plugins/slg-common/actions/collectResources.ts plugins/slg-common/actions/collectResources.test.ts core/plugin/PluginContext.ts
git commit -m "feat: add collect resources action"
```

---

## Task 4: 实现建筑升级操作

**Files:**
- Create: `plugins/slg-common/actions/upgradeBuildings.ts`
- Modify: `plugins/slg-common/index.ts`
- Test: `plugins/slg-common/actions/upgradeBuildings.test.ts`

**Step 1: Create upgradeBuildings action**

```typescript
// plugins/slg-common/actions/upgradeBuildings.ts
import { PluginContext } from '../../../core/plugin';
import { BuildingConfig } from '../types';

export async function upgradeBuildings(
  ctx: PluginContext,
  buildings: BuildingConfig[]
): Promise<void> {
  ctx.log('开始检查建筑升级...');

  const sortedBuildings = [...buildings].sort((a, b) => b.upgradePriority - a.upgradePriority);

  for (const building of sortedBuildings) {
    ctx.log(`检查 ${building.name}...`);
    
    await ctx.tap(building.position.x, building.position.y);
    await ctx.sleep(1.5);
    
    // Look for upgrade button
    const upgradeButton = ctx.getConfig<{ x: number; y: number }>('upgradeButtonPosition');
    if (upgradeButton) {
      await ctx.tap(upgradeButton.x, upgradeButton.y);
      await ctx.sleep(1);
      ctx.log(`尝试升级 ${building.name}`);
    }
    
    // Back to main
    const backButton = ctx.getConfig<{ x: number; y: number }>('backButtonPosition');
    if (backButton) {
      await ctx.tap(backButton.x, backButton.y);
      await ctx.sleep(0.5);
    }
  }

  ctx.log('建筑升级检查完成');
}
```

**Step 2: Register action in plugin**

```typescript
// Add to plugins/slg-common/index.ts imports
import { upgradeBuildings } from './actions/upgradeBuildings';

// Add to actions array
{
  id: 'upgrade-buildings',
  name: '升级建筑',
  description: '按优先级检查并升级建筑',
  run: async (ctx) => {
    const buildings = ctx.getConfig('buildings', []);
    await upgradeBuildings(ctx, buildings);
  }
}
```

**Step 3: Write tests**

```typescript
// plugins/slg-common/actions/upgradeBuildings.test.ts
import { upgradeBuildings } from './upgradeBuildings';
import { PluginContext } from '../../../core/plugin';
import { BuildingConfig } from '../types';

describe('upgradeBuildings', () => {
  let mockCtx: jest.Mocked<PluginContext>;
  let testBuildings: BuildingConfig[];

  beforeEach(() => {
    mockCtx = {
      log: jest.fn(),
      tap: jest.fn(),
      sleep: jest.fn(),
      getConfig: jest.fn((key) => {
        if (key === 'upgradeButtonPosition') return { x: 500, y: 800 };
        if (key === 'backButtonPosition') return { x: 50, y: 50 };
        return undefined;
      })
    } as any;

    testBuildings = [
      { name: '市政厅', position: { x: 200, y: 300 }, upgradePriority: 10 },
      { name: '兵营', position: { x: 300, y: 400 }, upgradePriority: 5 }
    ];
  });

  it('should upgrade buildings by priority order', async () => {
    await upgradeBuildings(mockCtx, testBuildings);
    
    expect(mockCtx.log).toHaveBeenCalledWith('开始检查建筑升级...');
    expect(mockCtx.tap).toHaveBeenCalled();
    expect(mockCtx.log).toHaveBeenCalledWith('尝试升级 市政厅');
    expect(mockCtx.log).toHaveBeenCalledWith('建筑升级检查完成');
  });
});
```

**Step 4: Run tests and verify compilation**

Run: `npx jest plugins/slg-common/actions/upgradeBuildings.test.ts -v`
Run: `npx tsc --noEmit`
Expected: Tests pass, no TypeScript errors

**Step 5: Commit**

```bash
git add plugins/slg-common/actions/upgradeBuildings.ts plugins/slg-common/actions/upgradeBuildings.test.ts plugins/slg-common/index.ts
git commit -m "feat: add upgrade buildings action"
```

---

## Task 5: 实现循环执行器

**Files:**
- Create: `plugins/slg-common/actions/loop.ts`
- Modify: `plugins/slg-common/index.ts`
- Test: `plugins/slg-common/actions/loop.test.ts`

**Step 1: Create loop action executor**

```typescript
// plugins/slg-common/actions/loop.ts
import { PluginContext } from '../../../core/plugin';

export interface LoopConfig {
  action: (ctx: PluginContext) => Promise<void>;
  intervalSeconds: number;
  maxIterations?: number;
  stopOnError?: boolean;
}

export async function runLoop(
  ctx: PluginContext,
  config: LoopConfig
): Promise<void> {
  let iteration = 0;
  const maxIterations = config.maxIterations ?? Infinity;

  ctx.log(`开始循环执行，间隔: ${config.intervalSeconds}秒, 最大次数: ${maxIterations === Infinity ? '无限' : maxIterations}`);

  while (iteration < maxIterations) {
    iteration++;
    ctx.log(`--- 第 ${iteration} 次执行 ---`);

    try {
      await config.action(ctx);
    } catch (error) {
      ctx.log(`执行出错: ${error}`);
      if (config.stopOnError) {
        ctx.log('因错误停止循环');
        throw error;
      }
    }

    if (iteration < maxIterations) {
      ctx.log(`等待 ${config.intervalSeconds} 秒后继续...`);
      await ctx.sleep(config.intervalSeconds);
    }
  }

  ctx.log('循环执行完成');
}
```

**Step 2: Add loop actions to plugin**

```typescript
// Add to plugins/slg-common/index.ts imports
import { runLoop } from './actions/loop';

// Add to actions array
{
  id: 'loop-collect',
  name: '循环收集资源',
  description: '定时循环收集资源',
  run: async (ctx) => {
    const collectInterval = ctx.getConfig('collectInterval', 300);
    const resources = ctx.getConfig('resources', []);
    
    await runLoop(ctx, {
      action: (c) => import('./actions/collectResources').then(m => m.collectResources(c, resources)),
      intervalSeconds: collectInterval
    });
  }
},
{
  id: 'loop-upgrade',
  name: '循环升级建筑',
  description: '定时循环检查并升级建筑',
  run: async (ctx) => {
    const upgradeInterval = ctx.getConfig('upgradeInterval', 600);
    const buildings = ctx.getConfig('buildings', []);
    
    await runLoop(ctx, {
      action: (c) => import('./actions/upgradeBuildings').then(m => m.upgradeBuildings(c, buildings)),
      intervalSeconds: upgradeInterval
    });
  }
}
```

**Step 3: Write tests**

```typescript
// plugins/slg-common/actions/loop.test.ts
import { runLoop, LoopConfig } from './loop';
import { PluginContext } from '../../../core/plugin';

describe('runLoop', () => {
  let mockCtx: jest.Mocked<PluginContext>;
  let mockAction: jest.Mock;

  beforeEach(() => {
    mockCtx = {
      log: jest.fn(),
      sleep: jest.fn().mockResolvedValue(undefined)
    } as any;
    mockAction = jest.fn().mockResolvedValue(undefined);
  });

  it('should run action specified number of times', async () => {
    const config: LoopConfig = {
      action: mockAction,
      intervalSeconds: 1,
      maxIterations: 3
    };

    await runLoop(mockCtx, config);
    
    expect(mockAction).toHaveBeenCalledTimes(3);
    expect(mockCtx.sleep).toHaveBeenCalledTimes(2); // Only sleep between iterations
  });

  it('should stop on error when stopOnError is true', async () => {
    const error = new Error('Test error');
    mockAction.mockRejectedValue(error);

    const config: LoopConfig = {
      action: mockAction,
      intervalSeconds: 1,
      maxIterations: 3,
      stopOnError: true
    };

    await expect(runLoop(mockCtx, config)).rejects.toThrow('Test error');
    expect(mockAction).toHaveBeenCalledTimes(1);
  });
});
```

**Step 4: Run tests and verify compilation**

Run: `npx jest plugins/slg-common/actions/loop.test.ts -v`
Run: `npx tsc --noEmit`
Expected: Tests pass, no TypeScript errors

**Step 5: Commit**

```bash
git add plugins/slg-common/actions/loop.ts plugins/slg-common/actions/loop.test.ts plugins/slg-common/index.ts
git commit -m "feat: add loop execution support"
```

---

## Task 6: 更新主入口测试SLG通用插件

**Files:**
- Modify: `src/index.ts`

**Step 1: Update main entry to test SLG plugin**

```typescript
// src/index.ts
import { AdbDevice } from '../core/device';
import { Vision } from '../core/vision';
import { PluginManager } from '../core/plugin';
import { SlgCommonPlugin } from '../plugins/slg-common';

async function main() {
  console.log('========================================');
  console.log('   SLG 自动化框架 v1.0');
  console.log('========================================');
  console.log();
  
  const device = new AdbDevice();
  console.log('[系统] 正在连接Android设备...');
  const connected = await device.connect();
  
  if (!connected) {
    console.log('[错误] 未找到设备，请连接Android设备或启动模拟器');
    console.log('[提示] 请确保ADB已配置，设备已开启开发者选项和USB调试');
    process.exit(1);
  }
  
  console.log('[系统] 设备连接成功！');
  console.log();
  
  const vision = new Vision();
  const pluginManager = new PluginManager(device, vision);
  
  console.log('[系统] 加载插件...');
  pluginManager.register(SlgCommonPlugin);
  console.log(`[系统] 已加载插件: ${pluginManager.listPlugins().map(p => `${p.name} v${p.version}`).join(', ')}`);
  console.log();
  
  console.log('可用操作:');
  SlgCommonPlugin.actions.forEach(action => {
    console.log(`  - ${action.name}: ${action.description}`);
  });
  console.log();
  
  console.log('[提示] 可以通过修改配置来定义具体游戏的建筑位置和资源位置');
  console.log('[提示] 下一步将添加Web管理界面来配置和运行这些操作');
  console.log();
  console.log('Phase 2 完成！SLG通用插件已就绪。');
}

main().catch(console.error);
```

**Step 2: Run to verify it works**

Run: `npm run dev`
Expected: Shows framework welcome message, plugin info, and available actions

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: update main entry with SLG plugin demo"
```

---

## Phase 2 完成检查

- [ ] PluginContext API 完善（swipe, inputText, waitForImage, waitWhileImage, getConfig, log）
- [ ] SLG通用插件基础结构（类型定义, 默认配置）
- [ ] 资源收集操作实现及测试
- [ ] 建筑升级操作实现及测试
- [ ] 循环执行器实现及测试
- [ ] 主入口更新，SLG插件演示
