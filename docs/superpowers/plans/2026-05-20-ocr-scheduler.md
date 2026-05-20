# OCR 智能调度 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Tesseract.js OCR 读取队列速览面板中的建造/训练/研究倒计时，替代固定间隔轮询，实现精准调度。

**Architecture:** 新建 `core/ocr/` 模块封装 Tesseract.js 及倒计时解析；新建 `read-queue-overview` action 完成截图+OCR+解析；前端 Home 页主循环改为 OCR 驱动的调度模式（最近到期优先 + 系数 0.6 + 30 分上限 + 随机抖动）。

**Tech Stack:** Tesseract.js (纯 JS OCR)、sharp (图像裁剪)、现有 ADB/PluginContext 基础设施

---

### Task 1: 安装 tesseract.js 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 tesseract.js**

```bash
npm install tesseract.js
```

- [ ] **Step 2: 验证安装**

```bash
node -e "const Tesseract = require('tesseract.js'); console.log('OK:', typeof Tesseract.createWorker)"
```
Expected: `OK: function`

- [ ] **Step 3: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore: add tesseract.js dependency for OCR countdown reading"
```

---

### Task 2: 新建 core/ocr/OcrService.ts

**Files:**
- Create: `core/ocr/OcrService.ts`
- Test: `core/ocr/OcrService.test.ts`

`OcrService` 封装 Tesseract.js worker，提供单次文本识别。单例模式，worker 懒加载后缓存复用。

- [ ] **Step 1: 编写 OcrService**

```ts
// core/ocr/OcrService.ts
import Tesseract from 'tesseract.js';

type OcrWorker = Tesseract.Worker;

class OcrService {
  private worker: OcrWorker | null = null;

  private async getWorker(): Promise<OcrWorker> {
    if (!this.worker) {
      this.worker = await Tesseract.createWorker('eng');
    }
    return this.worker;
  }

  /**
   * 识别图像中的文本。imagePath 为本地 PNG 文件路径。
   */
  async readText(imagePath: string): Promise<string> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(imagePath);
    return data.text.trim();
  }

  async destroy(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

export const ocrService = new OcrService();
```

- [ ] **Step 2: 编写测试**

```ts
// core/ocr/OcrService.test.ts
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ocrService } from './OcrService';

// Helper: create a simple test image with known text is impractical without real
// fonts in CI. Instead test that the service initializes correctly.
describe('OcrService', () => {
  afterAll(async () => {
    await ocrService.destroy();
  });

  it('should create worker and return empty string for blank image', async () => {
    // Create a tiny blank PNG
    const tmpPath = path.join(os.tmpdir(), 'ocr-blank-test.png');
    await sharp({
      create: { width: 100, height: 30, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).png().toFile(tmpPath);

    const text = await ocrService.readText(tmpPath);
    await fs.unlink(tmpPath).catch(() => {});

    // Blank white image should return empty or near-empty text
    expect(typeof text).toBe('string');
    expect(text.length).toBeLessThan(5);
  }, 15000);

  it('should be singleton (same instance)', () => {
    const { ocrService: same } = require('./OcrService');
    expect(same).toBe(ocrService);
  });
});
```

- [ ] **Step 3: 运行测试验证**

```bash
npx jest core/ocr/OcrService.test.ts --no-coverage
```
Expected: 2 tests pass

- [ ] **Step 4: 提交**

```bash
git add core/ocr/OcrService.ts core/ocr/OcrService.test.ts
git commit -m "feat: add OcrService wrapping Tesseract.js"
```

---

### Task 3: 新建 core/ocr/parseCountdown.ts

**Files:**
- Create: `core/ocr/parseCountdown.ts`
- Test: `core/ocr/parseCountdown.test.ts`

纯函数，解析倒计时文本为秒数。支持 `1天10:09:20`、`2:30:00`、`45:30` 三种格式，含 OCR 容错。

- [ ] **Step 1: 编写 parseCountdown**

```ts
// core/ocr/parseCountdown.ts

/**
 * 解析倒计时文本为剩余秒数。
 * 支持格式:
 *   "1天10:09:20" → 122960
 *   "2:30:00"      → 9000
 *   "45:30"        → 2730
 *   "15"           → 15
 *
 * OCR 容错:
 *   - "1夭" → "1天"
 *   - 冒号可能被识别为 "." 或 "："
 *   - 尾部杂讯过滤
 *
 * 返回 null 表示无法解析（空闲、非倒计时文本等）。
 */
export function parseCountdown(text: string): number | null {
  // Normalize: fix common OCR errors
  let t = text
    .replace(/夭/g, '天')
    .replace(/\./g, ':')
    .replace(/：/g, ':')
    .replace(/[^0-9天:：. ]/g, '')
    .trim();

  if (!t) return null;

  let days = 0;

  // Extract days if present
  const dayMatch = t.match(/(\d+)\s*天/);
  if (dayMatch) {
    days = parseInt(dayMatch[1], 10);
    t = t.replace(dayMatch[0], '').trim();
  }

  // Parse remaining H:MM:SS or M:SS or SS
  const parts = t.split(':').map(s => parseInt(s, 10)).filter(n => !isNaN(n));

  if (parts.length === 0) return null;

  let seconds = days * 86400;

  if (parts.length === 3) {
    seconds += parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds += parts[0] * 60 + parts[1];
  } else {
    seconds += parts[0];
  }

  return seconds;
}
```

- [ ] **Step 2: 编写测试**

```ts
// core/ocr/parseCountdown.test.ts
import { parseCountdown } from './parseCountdown';

describe('parseCountdown', () => {
  it('parses days + HH:MM:SS', () => {
    expect(parseCountdown('1天10:09:20')).toBe(122960);
    expect(parseCountdown('2天00:00:00')).toBe(172800);
  });

  it('parses HH:MM:SS', () => {
    expect(parseCountdown('2:30:00')).toBe(9000);
    expect(parseCountdown('1:00:00')).toBe(3600);
    expect(parseCountdown('0:05:30')).toBe(330);
  });

  it('parses MM:SS', () => {
    expect(parseCountdown('45:30')).toBe(2730);
    expect(parseCountdown('05:00')).toBe(300);
  });

  it('parses bare seconds', () => {
    expect(parseCountdown('15')).toBe(15);
    expect(parseCountdown('59')).toBe(59);
  });

  it('handles OCR errors: 夭 → 天', () => {
    expect(parseCountdown('1夭10:09:20')).toBe(122960);
  });

  it('handles OCR errors: dots instead of colons', () => {
    expect(parseCountdown('2.30.00')).toBe(9000);
  });

  it('handles OCR errors: fullwidth colons', () => {
    expect(parseCountdown('45：30')).toBe(2730);
  });

  it('handles OCR errors: trailing noise', () => {
    expect(parseCountdown(' 2:30:00 ')).toBe(9000);
  });

  it('returns null for non-numeric text', () => {
    expect(parseCountdown('空闲')).toBeNull();
    expect(parseCountdown('')).toBeNull();
    expect(parseCountdown('abc')).toBeNull();
  });

  it('returns 0 for zero', () => {
    expect(parseCountdown('0:00:00')).toBe(0);
    expect(parseCountdown('00:00')).toBe(0);
  });
});
```

- [ ] **Step 3: 运行测试验证**

```bash
npx jest core/ocr/parseCountdown.test.ts --no-coverage
```
Expected: all tests pass

- [ ] **Step 4: 提交**

```bash
git add core/ocr/parseCountdown.ts core/ocr/parseCountdown.test.ts
git commit -m "feat: add parseCountdown for OCR countdown text parsing"
```

---

### Task 4: 新建 read-queue-overview action

**Files:**
- Create: `plugins/rok/actions/readQueueOverview.ts`
- Modify: `plugins/rok/index.ts` (add config + register action)

创建 `read-queue-overview` action：点击速览按钮 → 截取 3 个倒计时区域 → OCR → 解析 → 以结构化日志输出结果。

- [ ] **Step 1: 创建 action 文件**

```ts
// plugins/rok/actions/readQueueOverview.ts
import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import * as fs from 'fs/promises';
import { ocrService } from '../../../core/ocr/OcrService';
import { parseCountdown } from '../../../core/ocr/parseCountdown';

export interface QueueTimers {
  build: number | null;   // 剩余秒数，null=未识别/空闲，0=已完成
  train: number | null;
  research: number | null;
}

export async function readQueueOverview(
  ctx: PluginContext,
  config: RokConfig
): Promise<QueueTimers> {
  const qo = config.queueOverview;
  if (!qo) {
    ctx.log('[OCR] queueOverview 未配置');
    return { build: null, train: null, research: null };
  }

  ctx.log('[OCR] 打开队列速览面板');
  await ctx.tap(qo.openButton.x, qo.openButton.y);
  await ctx.sleep(1);

  const result: QueueTimers = { build: null, train: null, research: null };

  for (const [key, region] of Object.entries(qo.rows) as [keyof QueueTimers, { x: number; y: number; w: number; h: number }][]) {
    ctx.log(`[OCR] 读取 ${key} 倒计时 (${region.x},${region.y} ${region.w}x${region.h})`);
    try {
      const regionPath = await ctx.captureRegion(region.x, region.y, region.w, region.h);
      const text = await ocrService.readText(regionPath);
      await fs.unlink(regionPath).catch(() => {});
      const seconds = parseCountdown(text);
      ctx.log(`[OCR] ${key} 原始="${text}" → ${seconds !== null ? seconds + 's' : '空闲/未识别'}`);
      result[key] = seconds;
    } catch (e: any) {
      ctx.log(`[OCR] ${key} 读取失败: ${e.message}`);
      result[key] = null;
    }
  }

  // 关闭面板：优先用关闭按钮，否则用返回按钮
  if (qo.closeButton) {
    await ctx.tap(qo.closeButton.x, qo.closeButton.y);
  } else {
    await ctx.tap(config.backButton.x, config.backButton.y);
  }
  await ctx.sleep(0.5);

  // 结构化日志，供前端解析
  ctx.log(`[OCR-RESULT] build=${result.build} train=${result.train} research=${result.research}`);

  return result;
}
```

- [ ] **Step 2: 在 plugins/rok/index.ts 中添加配置和注册 action**

在 `RokConfig` 接口中（`}` 前）添加：

```ts
  // 队列速览 OCR（读取建造/训练/研究倒计时）
  queueOverview?: {
    openButton: { x: number; y: number };
    closeButton?: { x: number; y: number };
    rows: {
      build: { x: number; y: number; w: number; h: number };
      train: { x: number; y: number; w: number; h: number };
      research: { x: number; y: number; w: number; h: number };
    };
  };
```

在 `DEFAULT_ROK_CONFIG` 中（`};` 前）添加：

```ts
  // ========== 队列速览 OCR ==========
  queueOverview: undefined,
```

添加 import：

```ts
import { readQueueOverview } from './actions/readQueueOverview';
```

在 `actions` 数组末尾添加：

```ts
    {
      id: 'read-queue-overview',
      name: '读取队列倒计时',
      description: '打开队列速览面板，OCR 读取建造/训练/研究倒计时',
      run: async (ctx) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        await readQueueOverview(ctx, config);
      }
    },
```

- [ ] **Step 3: TypeScript 编译检查**

```bash
npx tsc --noEmit 2>&1
```
Expected: no errors from new files

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/actions/readQueueOverview.ts plugins/rok/index.ts
git commit -m "feat: add read-queue-overview action with OCR countdown reading"
```

---

### Task 5: 改造 Home.tsx 主循环为 OCR 调度模式

**Files:**
- Modify: `web/src/pages/Home.tsx`

将固定间隔轮询改为 OCR 驱动调度。核心变化：
- 循环开头先 OCR 队列倒计时
- 根据倒计时决定执行哪些 action
- 收集资源改为 4 小时间隔
- 等待时间为最近到期倒计时 × 0.6，上限 30 分钟，加随机抖动
- idle-drag 行为保持不变

- [ ] **Step 1: 替换主循环逻辑**

找到 `handleStartAll` 函数中的循环体（约第 357-513 行，从 `(async () => {` 到 `})();` 的 while 循环），整体替换为：

```ts
    (async () => {
      let round = 0;
      let bottomBarChecked = false;
      let lastCollectTime = 0;
      const COLLECT_INTERVAL = 4 * 3600; // 4小时

      while (!loopStopped) {
        round++;
        setLogs(prev => { const next = [...prev, `[${new Date().toLocaleTimeString()}] 🔄 第${round}轮`]; saveLoopState(currentAccountId); return next; });

        const ids: string[] = [];

        const handleLicenseExpired = () => {
          setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⛔ 许可证已到期，停止运行`]);
          loopStopped = true;
          setExpiredMessage('激活码已到期，请重新激活');
          refreshStatus();
        };

        const runTask = async (actionId: string, config?: Record<string, any>): Promise<string[]> => {
          if (loopStopped) return [];
          try {
            const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', actionId, config);
            if (createResult.success) {
              ids.push(createResult.task.id);
              runningTaskIdsRef.current = [...ids];
              setRunningTaskIds([...ids]);
              const runResult = await api.tasks.run(createResult.task.id);
              const logs = runResult.task?.logs ?? [];

              const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
              const hasExpiredError = runResult.task?.error && /license.*expir|许可证.*过/i.test(runResult.task.error);
              if (hasExpiredLog || hasExpiredError) {
                handleLicenseExpired();
                return logs;
              }

              setLogs(prev => { const next = [...prev, `[${new Date().toLocaleTimeString()}] ✅ ${createResult.task.actionId} 完成`]; saveLoopState(currentAccountId); return next; });
              return logs;
            }
          } catch (e: any) {
            const isLicenseExpired =
              e?.data?.error === 'LICENSE_EXPIRED' ||
              e?.status === 403 ||
              (e?.message && /license.*expir|许可证.*过/i.test(e.message));
            if (isLicenseExpired) {
              handleLicenseExpired();
              return [];
            }
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 执行失败: ${e}`]);
          }
          return [];
        };

        const parseOcrResult = (logs: string[]): { build: number | null; train: number | null; research: number | null } => {
          const line = logs.find(l => l.startsWith('[OCR-RESULT]'));
          if (!line) return { build: null, train: null, research: null };
          const match = line.match(/build=(-?\d+|null)\s+train=(-?\d+|null)\s+research=(-?\d+|null)/);
          if (!match) return { build: null, train: null, research: null };
          const parse = (s: string) => s === 'null' ? null : parseInt(s, 10);
          return { build: parse(match[1]), train: parse(match[2]), research: parse(match[3]) };
        };

        if (!bottomBarChecked) {
          await runTask('ensure-bottom-bar');
          bottomBarChecked = true;
        }

        // Step 1: OCR 队列倒计时
        const ocrLogs = await runTask('read-queue-overview');
        const timers = parseOcrResult(ocrLogs);

        if (loopStopped) break;

        // Step 2: 执行到期/就绪的 action
        const hasUpgrade = features.upgradeBuildings &&
          features.selectedBuildings.some((b: string, i: number) => b && !loopCompletedBuildings[i]);
        const hasResearch = features.autoResearch &&
          features.selectedTechs.some((t: string, i: number) => t && !loopCompletedTechs[i]);
        const hasTrain = features.trainTroops &&
          (Object.values(features.trainTasks as Record<string, number>) as number[]).some(v => v > 0);

        if (hasUpgrade && timers.build !== null && timers.build <= 0) {
          const targetBuildings = features.selectedBuildings
            .filter((b: string, i: number) => b && !loopCompletedBuildings[i]);
          if (targetBuildings.length > 0) {
            const logs = await runTask('upgrade-buildings', { targetBuildings });
            let changed = false;
            features.selectedBuildings.forEach((b: string, i: number) => {
              if (b && !loopCompletedBuildings[i] && logs.some((l: string) => l.includes(`✅ ${b} 升级成功`))) {
                loopCompletedBuildings[i] = true;
                changed = true;
              }
            });
            if (changed) setFeatures(prev => ({ ...prev, completedBuildings: [...loopCompletedBuildings] }));
          }
        }

        if (loopStopped) break;

        if (hasResearch && timers.research !== null && timers.research <= 0) {
          if (!buildingOptions.includes('学院')) {
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 未标记学院位置，跳过研究科技`]);
          } else {
            const techs = features.selectedTechs.filter((t: string, i: number) => t && !loopCompletedTechs[i]);
            if (techs.length > 0) {
              const logs = await runTask('research-tech-queue', { targetTechs: techs, researchBuilding: '学院' });
              let changed = false;
              features.selectedTechs.forEach((t: string, i: number) => {
                if (t && !loopCompletedTechs[i] && logs.some((l: string) => l.includes(`✅ ${t} 研究成功`))) {
                  loopCompletedTechs[i] = true;
                  changed = true;
                }
              });
              if (changed) setFeatures(prev => ({ ...prev, completedTechs: [...loopCompletedTechs] }));
            }
          }
        }

        if (loopStopped) break;

        if (hasTrain && timers.train !== null && timers.train <= 0) {
          const tasks = features.trainTasks as Record<string, number>;
          const trainQueue = ['兵营', '马厩', '靶场', '攻城武器厂']
            .filter(b => (tasks[b] ?? 0) > 0)
            .map(b => ({ building: b, tier: tasks[b] }));
          if (trainQueue.length > 0) await runTask('train-troops', { trainQueue });
        }

        // Step 3: 收集资源（4小时间隔）
        const now = Date.now() / 1000;
        if (features.collectResources && (now - lastCollectTime >= COLLECT_INTERVAL)) {
          await runTask('collect-resources');
          lastCollectTime = now;
        }

        // Step 4: 执行帮助盟友 & 城外采集（每次检查时执行，和现在一样）
        if (features.helpTeammates && !loopStopped) {
          await runTask('help-teammates');
        }

        if (features.gatherResources && !loopStopped) {
          const gatherTasks = features.gatherTasks
            .map((t: { type: string; level: number }, i: number) => ({ ...t, team: i + 1 }))
            .filter((t: { type: string; level: number; team: number }) => t.type);
          if (gatherTasks.length > 0) await runTask('gather-resources', { gatherTasks });
        }

        if (features.autoExplore && !loopStopped) {
          if (!buildingOptions.includes('斥候营地')) {
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 未标记斥候营地位置，跳过自动探索`]);
          } else {
            await runTask('explore', { maxScouts: features.exploreCount });
          }
        }

        if (loopStopped) break;

        // Step 5: 计算下次唤醒时间
        const allTimers = [timers.build, timers.train, timers.research].filter(t => t !== null && t > 0) as number[];
        const minTimer = allTimers.length > 0 ? Math.min(...allTimers) : null;

        let nextWake: number;
        if (minTimer !== null) {
          nextWake = Math.min(minTimer * 0.6, 1800); // 系数 0.6，上限 30 分钟
        } else {
          nextWake = 1800; // 无活跃队列，30 分钟后再查
        }
        // 随机抖动 -30s ~ +120s
        nextWake += -30 + Math.random() * 150;
        nextWake = Math.max(60, nextWake); // 最少等 60 秒

        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏳ 下次检查 ${nextWake.toFixed(0)} 秒后 (build=${timers.build}s train=${timers.train}s research=${timers.research}s)`]);

        // 等待期间随机拖拽（和现在一样）
        const dragSafetyMargin = 5;
        const dragWindow = nextWake - dragSafetyMargin;
        if (dragWindow > 15) {
          const dragDelay = 5 + Math.random() * (dragWindow * 0.7);
          const startWait = Date.now();
          while (!loopStopped && (Date.now() - startWait) < dragDelay * 1000) {
            await sleep(1);
          }
          if (!loopStopped) {
            try { await runTask('idle-drag'); } catch {}
          }
          while (!loopStopped && (Date.now() - startWait) < nextWake * 1000) {
            await sleep(1);
          }
        } else {
          const startWait = Date.now();
          while (!loopStopped && (Date.now() - startWait) < nextWake * 1000) {
            await sleep(1);
          }
        }
      }
      loopRunning = false;
      clearLoopState();
      runningTaskIdsRef.current = [];
      setTaskRunning(false);
      setRunningTaskIds([]);
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏹️ 循环已停止`]);
    })();
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd web && npx tsc --noEmit 2>&1
```
Expected: no new errors from Home.tsx

- [ ] **Step 3: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: replace fixed-interval loop with OCR-driven smart scheduler"
```

---

### Task 6: 最终验证

**Files:** 无新文件

- [ ] **Step 1: 全量 TypeScript 编译检查**

```bash
npx tsc --noEmit && cd web && npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 2: 运行所有测试**

```bash
npx jest --no-coverage
```
Expected: all tests pass (including new OCR tests)

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: final verification - tsc + tests pass"
```
