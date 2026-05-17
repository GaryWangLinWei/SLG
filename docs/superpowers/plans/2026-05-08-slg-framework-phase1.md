# SLG自动化框架 - Phase 1: 核心基础能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建最小可用的核心引擎，包括ADB设备连接、基础操作、图像模板匹配、插件系统原型

**Architecture:** Node.js + TypeScript 模块化架构，核心层与业务逻辑分离，设备抽象层支持未来扩展

**Tech Stack:** Node.js 20+, TypeScript 5+, OpenCV4Node.js, ADB, Jest

---

## Task 1: 项目初始化与基础配置

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `core/types/index.ts`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "slg-auto-framework",
  "version": "0.1.0",
  "description": "SLG game automation framework based on image recognition",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "test": "jest",
    "lint": "eslint src/**/*.ts"
  },
  "keywords": ["slg", "automation", "opencv", "adb"],
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "jest": "^29.5.0",
    "ts-jest": "^29.1.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "opencv4nodejs": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*", "core/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules
dist
*.log
.DS_Store
storage/screenshots/*
storage/templates/*
storage/db/*
.env
*.tmp
```

- [ ] **Step 4: Create core types**

```typescript
// core/types/index.ts
export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageMatchResult {
  found: boolean;
  confidence: number;
  location: Point;
  rect: Rect;
}

export interface DeviceInfo {
  id: string;
  model: string;
  resolution: { width: number; height: number };
}
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: All dependencies installed successfully

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore core/types/index.ts
git commit -m "feat: project init with base config and types"
```

---

## Task 2: ADB设备管理器 - 基础接口

**Files:**
- Create: `core/device/Device.ts`
- Create: `core/device/AdbDevice.ts`
- Create: `core/device/index.ts`
- Test: `core/device/Device.test.ts`

- [ ] **Step 1: Write failing test for Device interface**

```typescript
// core/device/Device.test.ts
import { Device } from './Device';

describe('Device Interface', () => {
  it('should have connect method', () => {
    const device: Device = {} as Device;
    expect(typeof device.connect).toBe('function');
  });

  it('should have disconnect method', () => {
    const device: Device = {} as Device;
    expect(typeof device.disconnect).toBe('function');
  });

  it('should have screenshot method', () => {
    const device: Device = {} as Device;
    expect(typeof device.screenshot).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest core/device/Device.test.ts -v`
Expected: FAIL with various errors (functions not defined)

- [ ] **Step 3: Implement Device interface**

```typescript
// core/device/Device.ts
import { Point, Rect } from '../types';

export interface Device {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getDeviceInfo(): Promise<{ width: number; height: number }>;
  
  screenshot(savePath?: string): Promise<Buffer>;
  tap(x: number, y: number): Promise<void>;
  tapPoint(point: Point): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, duration?: number): Promise<void>;
  inputText(text: string): Promise<void>;
  sleep(seconds: number): Promise<void>;
}
```

- [ ] **Step 4: Implement AdbDevice stub**

```typescript
// core/device/AdbDevice.ts
import { Device } from './Device';
import { Point } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class AdbDevice implements Device {
  private connected: boolean = false;
  private deviceId: string;

  constructor(deviceId?: string) {
    this.deviceId = deviceId || '';
  }

  async connect(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('adb devices');
      const devices = stdout.split('\n')
        .filter(line => line.includes('\tdevice'))
        .map(line => line.split('\t')[0]);
      
      if (devices.length > 0) {
        this.deviceId = this.deviceId || devices[0];
        this.connected = true;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getDeviceInfo(): Promise<{ width: number; height: number }> {
    return { width: 1080, height: 1920 };
  }

  async screenshot(savePath?: string): Promise<Buffer> {
    throw new Error('Not implemented');
  }

  async tap(x: number, y: number): Promise<void> {
    if (!this.connected) throw new Error('Device not connected');
    await execAsync(`adb -s ${this.deviceId} shell input tap ${x} ${y}`);
  }

  async tapPoint(point: Point): Promise<void> {
    await this.tap(point.x, point.y);
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, duration: number = 500): Promise<void> {
    if (!this.connected) throw new Error('Device not connected');
    await execAsync(`adb -s ${this.deviceId} shell input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`);
  }

  async inputText(text: string): Promise<void> {
    if (!this.connected) throw new Error('Device not connected');
    await execAsync(`adb -s ${this.deviceId} shell input text "${text}"`);
  }

  async sleep(seconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }
}
```

- [ ] **Step 5: Create index export**

```typescript
// core/device/index.ts
export { Device } from './Device';
export { AdbDevice } from './AdbDevice';
```

- [ ] **Step 6: Run test to verify it compiles**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add core/device/Device.ts core/device/AdbDevice.ts core/device/index.ts core/device/Device.test.ts
git commit -m "feat: add Device interface and AdbDevice base implementation"
```

---

## Task 3: 实现截图功能

**Files:**
- Modify: `core/device/AdbDevice.ts`
- Test: `core/device/AdbDevice.screenshot.test.ts`

- [ ] **Step 1: Write failing test for screenshot**

```typescript
// core/device/AdbDevice.screenshot.test.ts
import { AdbDevice } from './AdbDevice';
import * as fs from 'fs';
import * as path from 'path';

describe('AdbDevice Screenshot', () => {
  let device: AdbDevice;
  
  beforeEach(() => {
    device = new AdbDevice();
  });

  it('should return Buffer from screenshot', async () => {
    jest.spyOn(device as any, 'connected', 'get').mockReturnValue(true);
    
    const mockExec = jest.fn().mockResolvedValue({ stdout: Buffer.from('fake-screenshot-data') });
    (device as any).execAsync = mockExec;
    
    const result = await device.screenshot();
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest core/device/AdbDevice.screenshot.test.ts -v`
Expected: FAIL (screenshot throws not implemented)

- [ ] **Step 3: Implement screenshot method**

```typescript
// Add to AdbDevice.ts, replace existing screenshot method
async screenshot(savePath?: string): Promise<Buffer> {
  if (!this.connected) throw new Error('Device not connected');
  
  const remotePath = '/sdcard/screen.png';
  await execAsync(`adb -s ${this.deviceId} shell screencap -p ${remotePath}`);
  
  if (savePath) {
    await execAsync(`adb -s ${this.deviceId} pull ${remotePath} ${savePath}`);
    return fs.promises.readFile(savePath);
  } else {
    const { stdout } = await execAsync(`adb -s ${this.deviceId} shell cat ${remotePath}`);
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  }
}
```

Also add import: `import * as fs from 'fs';`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add core/device/AdbDevice.ts core/device/AdbDevice.screenshot.test.ts
git commit -m "feat: implement screenshot functionality"
```

---

## Task 4: 图像识别模块 - 模板匹配

**Files:**
- Create: `core/vision/Vision.ts`
- Create: `core/vision/index.ts`
- Test: `core/vision/Vision.test.ts`

- [ ] **Step 1: Write failing test for findImage**

```typescript
// core/vision/Vision.test.ts
import { Vision } from './Vision';
import * as cv from 'opencv4nodejs';

describe('Vision Template Matching', () => {
  let vision: Vision;

  beforeEach(() => {
    vision = new Vision();
  });

  it('should have findImage method', () => {
    expect(typeof vision.findImage).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest core/vision/Vision.test.ts -v`
Expected: FAIL (Vision not defined)

- [ ] **Step 3: Implement Vision class**

```typescript
// core/vision/Vision.ts
import * as cv from 'opencv4nodejs';
import { ImageMatchResult, Rect, Point } from '../types';

export class Vision {
  async findImage(
    screenshotPath: string,
    templatePath: string,
    threshold: number = 0.8
  ): Promise<ImageMatchResult> {
    const screenshot = await cv.imreadAsync(screenshotPath);
    const template = await cv.imreadAsync(templatePath);
    
    const matched = screenshot.matchTemplate(template, cv.TM_CCOEFF_NORMED);
    const minMax = matched.minMaxLoc();
    
    const confidence = minMax.maxVal;
    const found = confidence >= threshold;
    
    const location: Point = {
      x: minMax.maxLoc.x,
      y: minMax.maxLoc.y
    };
    
    const rect: Rect = {
      x: minMax.maxLoc.x,
      y: minMax.maxLoc.y,
      width: template.cols,
      height: template.rows
    };
    
    return {
      found,
      confidence,
      location: {
        x: location.x,
        y: location.y
      }
    };
  }
}
```

- [ ] **Step 4: Create vision index**

```typescript
// core/vision/index.ts
export { Vision } from './Vision';
```

- [ ] **Step 5: Run test to verify it compiles**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add core/vision/Vision.ts core/vision/index.ts core/vision/Vision.test.ts
git commit -m "feat: add Vision module with template matching"
```

---

## Task 5: 最小化插件系统

**Files:**
- Create: `core/plugin/PluginContext.ts`
- Create: `core/plugin/PluginManager.ts`
- Create: `core/plugin/types.ts`
- Create: `core/plugin/index.ts`

- [ ] **Step 1: Define plugin types**

```typescript
// core/plugin/types.ts
export interface PluginAction {
  id: string;
  name: string;
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
```

- [ ] **Step 2: Implement PluginContext**

```typescript
// core/plugin/PluginContext.ts
import { Device } from '../device';
import { Vision } from '../vision';

export class PluginContext {
  constructor(
    private device: Device,
    private vision: Vision,
    private config: Record<string, any> = {}
  ) {}

  async tap(x: number, y: number): Promise<void> {
    await this.device.tap(x, y);
  }

  async sleep(seconds: number): Promise<void> {
    await this.device.sleep(seconds);
  }

  async findImage(templatePath: string, threshold: number = 0.8): Promise<boolean> {
    const screenshotBuffer = await this.device.screenshot();
    const result = await this.vision.findImage(screenshotBuffer.toString('base64'), templatePath);
    return result.found;
  }

  async tapImage(templatePath: string, threshold: number = 0.8): Promise<boolean> {
    const screenshotPath = await this.device.screenshot();
    const result = await this.vision.findImage(screenshotPath, templatePath);
    if (result.found) {
      await this.device.tap(result.location.x + result.rect.width / 2, result.location.y + result.rect.height / 2);
      return true;
    }
    return false;
  }
}
```

- [ ] **Step 3: Implement PluginManager**

```typescript
// core/plugin/PluginManager.ts
import { Plugin } from './types';
import { PluginContext } from './PluginContext';
import { Device } from '../device';
import { Vision } from '../vision';

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private device: Device;
  private vision: Vision;

  constructor(device: Device, vision: Vision) {
    this.device = device;
    this.vision = vision;
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

  async runAction(pluginId: string, actionId: string, config: Record<string, any> = {}): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);

    const action = plugin.actions.find(a => a.id === actionId);
    if (!action) throw new Error(`Action ${actionId} not found in plugin ${pluginId}`);

    const ctx = new PluginContext(this.device, this.vision, config);
    await action.run(ctx);
  }
}
```

- [ ] **Step 4: Create plugin index**

```typescript
// core/plugin/index.ts
export { Plugin, PluginAction, PluginConfig } from './types';
export { PluginContext } from './PluginContext';
export { PluginManager } from './PluginManager';
```

- [ ] **Step 5: Run test to verify it compiles**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add core/plugin/types.ts core/plugin/PluginContext.ts core/plugin/PluginManager.ts core/plugin/index.ts
git commit -m "feat: add minimal plugin system"
```

---

## Task 6: 示例插件与运行入口

**Files:**
- Create: `plugins/example/index.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Create example plugin**

```typescript
// plugins/example/index.ts
import { Plugin } from '../../core/plugin';

export const ExamplePlugin: Plugin = {
  id: 'com.example.demo',
  name: '示例插件',
  version: '1.0.0',
  description: '演示如何创建插件',
  actions: [
    {
      id: 'hello-world',
      name: 'Hello World',
      run: async (ctx) => {
        console.log('Hello from plugin!');
        await ctx.sleep(1);
        console.log('Done!');
      }
    }
  ]
};
```

- [ ] **Step 2: Create main entry point**

```typescript
// src/index.ts
import { AdbDevice } from '../core/device';
import { Vision } from '../core/vision';
import { PluginManager } from '../core/plugin';
import { ExamplePlugin } from '../plugins/example';

async function main() {
  console.log('SLG Auto Framework starting...');
  
  const device = new AdbDevice();
  const connected = await device.connect();
  
  if (!connected) {
    console.log('No device found. Please connect an Android device/emulator.');
    process.exit(1);
  }
  
  console.log('Device connected successfully!');
  
  const vision = new Vision();
  const pluginManager = new PluginManager(device, vision);
  
  pluginManager.register(ExamplePlugin);
  console.log('Registered plugins:', pluginManager.listPlugins().map(p => p.name));
  
  console.log('Running example action...');
  await pluginManager.runAction('com.example.demo', 'hello-world');
  
  console.log('Done!');
}

main().catch(console.error);
```

- [ ] **Step 3: Run to verify it compiles**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add plugins/example/index.ts src/index.ts
git commit -m "feat: add example plugin and main entry point"
```

---

## Phase 1 完成检查

- [ ] 项目基础配置完成
- [ ] ADB设备连接与基础操作实现
- [ ] 截图功能实现
- [ ] 图像模板匹配实现
- [ ] 最小化插件系统完成
- [ ] 示例插件与运行入口完成
