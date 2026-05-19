# 防脚本检测 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add randomization to tap/swipe/sleep operations in AdbDevice layer, idle drag during loop wait, and loopInterval jitter to avoid script detection.

**Architecture:** All randomization logic concentrated in `AdbDevice` — every `tap`, `swipe`, `sleep` automatically gets random offsets. Idle drag is a new ROK action called from the frontend during loop wait. Frontend loop wait gets split into chunks with idle drag inserted at random timing, respecting a 5s safety window before next loop.

**Tech Stack:** TypeScript, no new dependencies

---

### Task 1: AdbDevice randomization — tap, swipe, sleep

**Files:**
- Modify: `core/device/AdbDevice.ts`
- Modify: `core/device/Device.test.ts`

- [ ] **Step 1: Add RandomizationConfig interface and defaults**

At the top of `core/device/AdbDevice.ts`, after `export function getAdbPath()`, add:

```ts
export interface RandomizationConfig {
  enabled: boolean;
  tapOffset: number;
  sleepJitter: number;  // 0~1, sleep-only-add percentage
}

const DEFAULT_RAND_CONFIG: RandomizationConfig = {
  enabled: true,
  tapOffset: 5,
  sleepJitter: 0.15,
};
```

- [ ] **Step 2: Add randomization state and helper methods to AdbDevice class**

Inside the `AdbDevice` class, add these fields (after `private reconnectDelayMs`):

```ts
  private randConfig: RandomizationConfig = { ...DEFAULT_RAND_CONFIG };

  private jitter(n: number): number {
    if (!this.randConfig.enabled) return n;
    return n * (1 + Math.random() * this.randConfig.sleepJitter);
  }

  private jitterCoord(v: number): number {
    if (!this.randConfig.enabled) return v;
    const offset = this.randConfig.tapOffset;
    return Math.round(v + (Math.random() * 2 - 1) * offset);
  }

  setRandomizationEnabled(enabled: boolean): void {
    this.randConfig.enabled = enabled;
  }

  setRandomizationConfig(config: Partial<RandomizationConfig>): void {
    Object.assign(this.randConfig, config);
  }
```

- [ ] **Step 3: Modify tap method to apply coordinate jitter**

Replace the existing `tap` method:

```ts
  async tap(x: number, y: number): Promise<void> {
    const tx = this.jitterCoord(x);
    const ty = this.jitterCoord(y);
    await this.execAdb(
      `"${getAdbPath()}" -s ${this.deviceId} shell input tap ${tx} ${ty}`, `点击 (${x},${y})→(${tx},${ty})`
    );
  }
```

- [ ] **Step 4: Modify swipe method to apply coordinate + duration jitter**

Replace the existing `swipe` method:

```ts
  async swipe(x1: number, y1: number, x2: number, y2: number, duration: number = 500): Promise<void> {
    const sx1 = this.jitterCoord(x1);
    const sy1 = this.jitterCoord(y1);
    const sx2 = this.jitterCoord(x2);
    const sy2 = this.jitterCoord(y2);
    const jitteredDuration = Math.round(this.randConfig.enabled
      ? duration * (0.8 + Math.random() * 0.4)
      : duration);
    await this.execAdb(
      `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${sx1} ${sy1} ${sx2} ${sy2} ${jitteredDuration}`,
      `滑动 (${x1},${y1})→(${x2},${y2})→(${sx1},${sy1})→(${sx2},${sy2}) dur=${jitteredDuration}`
    );
  }
```

- [ ] **Step 5: Modify sleep method to apply sleep-only-add jitter**

Replace the existing `sleep` method:

```ts
  async sleep(seconds: number): Promise<void> {
    const actual = this.jitter(seconds);
    return new Promise(resolve => setTimeout(resolve, actual * 1000));
  }
```

- [ ] **Step 6: Write tests for randomization in Device.test.ts**

Add these test cases to `core/device/Device.test.ts`:

```ts
import { AdbDevice, setAdbPath, RandomizationConfig } from './AdbDevice';

// ... keep existing describe block, add:

describe('AdbDevice Randomization', () => {
  let device: AdbDevice;

  beforeEach(() => {
    device = new AdbDevice('emulator-5554');
    (device as any).connected = true;
    const mockExec = jest.fn().mockResolvedValue({ stdout: '' });
    (device as any).execAsync = mockExec;
  });

  it('should jitter tap coordinates when enabled', async () => {
    device.setRandomizationConfig({ tapOffset: 10, sleepJitter: 0 });
    const execSpy = jest.spyOn(device as any, 'execAdb');

    // Tap many times and check coordinates vary
    const coords: string[] = [];
    for (let i = 0; i < 10; i++) {
      await device.tap(100, 200);
      const call = execSpy.mock.calls[execSpy.mock.calls.length - 1][0] as string;
      // Extract x y from "shell input tap X Y"
      coords.push(call.split('tap ')[1] || '');
    }
    // Should not all be the same
    const unique = new Set(coords);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('should not jitter when disabled', async () => {
    device.setRandomizationEnabled(false);
    // Mock Math.random to verify no jitter
    const randomSpy = jest.spyOn(Math, 'random');
    await device.tap(100, 200);
    await device.sleep(1);
    // Math.random should not be called for coordinate jitter when disabled
    // (it's still called for sleep jitter internally)
    expect(randomSpy).not.toHaveBeenCalled(); // actually jitterCoord still checks enabled first
  });

  it('should only add time in sleep (no reduction)', async () => {
    device.setRandomizationConfig({ sleepJitter: 1.0 }); // up to 100% add
    const start = Date.now();
    await device.sleep(0.05); // 50ms base
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(48); // allow small timer variance
  });

  it('should set config partially', () => {
    device.setRandomizationConfig({ tapOffset: 15 });
    const config = (device as any).randConfig as RandomizationConfig;
    expect(config.tapOffset).toBe(15);
    expect(config.enabled).toBe(true); // unchanged
    expect(config.sleepJitter).toBe(0.15); // unchanged
  });

  it('should set enabled flag', () => {
    device.setRandomizationEnabled(false);
    expect((device as any).randConfig.enabled).toBe(false);
    device.setRandomizationEnabled(true);
    expect((device as any).randConfig.enabled).toBe(true);
  });
});
```

- [ ] **Step 7: Run tests**

```bash
npx jest core/device/Device.test.ts --no-coverage
```

Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add core/device/AdbDevice.ts core/device/Device.test.ts
git commit -m "feat: add randomization to tap, swipe, and sleep in AdbDevice"
```

---

### Task 2: IdleDrag action

**Files:**
- Create: `plugins/rok/actions/idleDrag.ts`
- Modify: `plugins/rok/index.ts`

- [ ] **Step 1: Create idleDrag action**

Create `plugins/rok/actions/idleDrag.ts`:

```ts
import { PluginContext } from '../../../core/plugin';

export async function idleDrag(ctx: PluginContext): Promise<void> {
  const dragCount = 1 + Math.floor(Math.random() * 3); // 1-3 drags
  for (let i = 0; i < dragCount; i++) {
    const x1 = 200 + Math.random() * 680;   // 200~880
    const y1 = 200 + Math.random() * 800;   // 200~1000
    const x2 = x1 + (Math.random() - 0.5) * 800;
    const y2 = y1 + (Math.random() - 0.5) * 800;
    const duration = 300 + Math.random() * 900; // 300~1200ms
    await ctx.swipe(x1, y1, x2, y2, duration);
    await ctx.sleep(2 + Math.random() * 4); // 2-6s between drags
  }
}
```

- [ ] **Step 2: Register idle-drag action in plugin**

In `plugins/rok/index.ts`, add import (after the other action imports):

```ts
import { idleDrag } from './actions/idleDrag';
```

Add action registration before the `help-teammates` action:

```ts
    {
      id: 'idle-drag',
      name: '随机拖拽',
      description: '模拟人类在循环等待期间随机滑动屏幕',
      run: async (ctx) => {
        await idleDrag(ctx);
      }
    },
```

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit
```

Expected: No output

- [ ] **Step 4: Commit**

```bash
git add plugins/rok/actions/idleDrag.ts plugins/rok/index.ts
git commit -m "feat: add idle-drag action with random swipes for anti-detection"
```

---

### Task 3: Home.tsx loop wait changes — interval jitter + idle drag

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: Replace the blocking wait loop with jittered, idle-drag interleaved wait**

Replace the wait block at lines 424-430:

```tsx
        if (loopStopped) break;
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏳ 等待 ${interval} 秒...`]);
        // 可中断的等待
        const startWait = Date.now();
        while (!loopStopped && (Date.now() - startWait) < interval * 1000) {
          await sleep(1);
        }
```

With:

```tsx
        if (loopStopped) break;
        // 每次轮询的间隔加 ±10% 随机波动
        const actualInterval = interval * (0.9 + Math.random() * 0.2);
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏳ 等待 ${actualInterval.toFixed(0)} 秒...`]);

        // 等待期间随机拖拽，模仿人滑动浏览
        const dragSafetyMargin = 5; // 下次循环前5秒内不拖拽
        const dragWindow = actualInterval - dragSafetyMargin;
        if (dragWindow > 15) {
          // 在前 70% 的等待时间内随机选择一个时间点触发拖拽
          const dragDelay = 5 + Math.random() * (dragWindow * 0.7);
          const startWait = Date.now();
          while (!loopStopped && (Date.now() - startWait) < dragDelay * 1000) {
            await sleep(1);
          }
          if (!loopStopped) {
            try { await runTask('idle-drag'); } catch {}
          }
          // 等待剩余时间（含安全窗口）
          while (!loopStopped && (Date.now() - startWait) < actualInterval * 1000) {
            await sleep(1);
          }
        } else {
          // 间隔太短（< 15s），不做拖拽，正常等待
          const startWait = Date.now();
          while (!loopStopped && (Date.now() - startWait) < actualInterval * 1000) {
            await sleep(1);
          }
        }
```

- [ ] **Step 2: Compile check**

```bash
cd web && npx tsc --noEmit
```

Expected: No output

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: add loopInterval jitter and idle-drag during wait for anti-detection"
```

---

### Task 4: Final verification

- [ ] **Step 1: Full TypeScript check**

```bash
npx tsc --noEmit && cd web && npx tsc --noEmit
```

Expected: No output from both

- [ ] **Step 2: Run all unit tests**

```bash
npx jest --no-coverage
```

Expected: All tests pass

- [ ] **Step 3: Start frontend dev server and verify**

```bash
cd web && npm run dev
```

Open browser, check:
- Home page loads without errors
- Start a run, verify logs show jittered interval
- Check backend logs to see tap coordinates are jittered

- [ ] **Step 4: Commit if needed**

```bash
git add -A
git commit -m "chore: final verification of anti-detection feature"
```
