# Anti-Detection Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在核心层（AdbDevice + PluginContext）集中加强防脚本检测能力，模拟人类操作特征。

**Architecture:** 所有随机化逻辑集中在核心层，action 代码零改动。AdbDevice 负责 tap 按压模拟、swipe 曲线化、sleep 范围；PluginContext 负责微停顿；Home.tsx 负责子循环抖动和 idle-drag 参数调整。

**Tech Stack:** TypeScript, Jest, ADB

---

### Task 1: AdbDevice — 偏移量 + Tap 模拟按压

**Files:**
- Modify: `core/device/AdbDevice.ts:26-29` (DEFAULT_RAND_CONFIG)
- Modify: `core/device/AdbDevice.ts:189-195` (tap method)

- [ ] **Step 1: 改 tapOffset 默认值 5 → 7**

```typescript
// core/device/AdbDevice.ts:26-30
const DEFAULT_RAND_CONFIG: RandomizationConfig = {
  enabled: true,
  tapOffset: 7,
  sleepJitter: 0.15,
};
```

- [ ] **Step 2: tap 改为模拟按压（input swipe x y x y duration）**

```typescript
// core/device/AdbDevice.ts:189-195，替换 tap 方法：
async tap(x: number, y: number): Promise<void> {
  const tx = this.jitterCoord(x);
  const ty = this.jitterCoord(y);
  if (this.randConfig.enabled) {
    const pressDuration = 50 + Math.floor(Math.random() * 100); // 50-150ms
    await this.execAdb(
      `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${tx} ${ty} ${tx} ${ty} ${pressDuration}`,
      `按压 (${x},${y})→(${tx},${ty}) dur=${pressDuration}`
    );
  } else {
    await this.execAdb(
      `"${getAdbPath()}" -s ${this.deviceId} shell input tap ${tx} ${ty}`,
      `点击 (${x},${y})→(${tx},${ty})`
    );
  }
}
```

- [ ] **Step 3: 运行现有测试确认不破坏**

```bash
npx jest core/device/Device.test.ts --no-coverage
```

- [ ] **Step 4: Commit**

```bash
git add core/device/AdbDevice.ts
git commit -m "feat: tap 模拟按压 (50-150ms) + tapOffset 5→7px"
```

---

### Task 2: AdbDevice — Sleep 随机范围

**Files:**
- Modify: `core/device/AdbDevice.ts:221-224` (sleep 方法)
- Modify: `core/device/Device.ts` (接口签名，如果有声明)

- [ ] **Step 1: 更新 Device 接口 + AdbDevice.sleep**

`core/device/Device.ts:14` 接口签名：
```typescript
// 改前: sleep(seconds: number): Promise<void>;
// 改后:
sleep(seconds: number, maxSeconds?: number): Promise<void>;
```

- [ ] **Step 2: 改 AdbDevice.sleep 支持 maxSeconds 参数**

```typescript
// core/device/AdbDevice.ts:221-224，替换 sleep 方法：
async sleep(seconds: number, maxSeconds?: number): Promise<void> {
  let base: number;
  if (maxSeconds !== undefined && maxSeconds > seconds) {
    base = seconds + Math.random() * (maxSeconds - seconds);
  } else {
    base = seconds;
  }
  const actual = this.jitter(base);
  return new Promise(resolve => setTimeout(resolve, actual * 1000));
}
```

- [ ] **Step 3: 运行测试**

```bash
npx jest core/device/Device.test.ts --no-coverage
```

- [ ] **Step 4: Commit**

```bash
git add core/device/AdbDevice.ts core/device/Device.ts
git commit -m "feat: sleep 支持 maxSeconds 随机范围"
```

---

### Task 3: AdbDevice — Swipe 曲线化

**Files:**
- Modify: `core/device/AdbDevice.ts:201-213` (swipe 方法)

- [ ] **Step 1: 实现分段曲线 swipe**

```typescript
// core/device/AdbDevice.ts:201-213，替换 swipe 方法：
async swipe(x1: number, y1: number, x2: number, y2: number, duration: number = 500): Promise<void> {
  const sx1 = this.jitterCoord(x1);
  const sy1 = this.jitterCoord(y1);
  const sx2 = this.jitterCoord(x2);
  const sy2 = this.jitterCoord(y2);
  const jitteredDuration = Math.round(this.randConfig.enabled
    ? duration * (0.8 + Math.random() * 0.4)
    : duration);

  if (!this.randConfig.enabled) {
    // 无随机化：直接一次性 swipe
    await this.execAdb(
      `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${sx1} ${sy1} ${sx2} ${sy2} ${jitteredDuration}`,
      `滑动 (${x1},${y1})→(${x2},${y2}) dur=${jitteredDuration}`
    );
    return;
  }

  // 分段曲线：3-5 段，每段终点加 ±7px 垂直偏移
  const segments = 3 + Math.floor(Math.random() * 3); // 3-5
  const segDuration = Math.round(jitteredDuration / segments);
  let cx = sx1, cy = sy1;

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const nx = Math.round(sx1 + (sx2 - sx1) * t);
    const ny = Math.round(sy1 + (sy2 - sy1) * t + (Math.random() * 2 - 1) * 7);
    await this.execAdb(
      `"${getAdbPath()}" -s ${this.deviceId} shell input swipe ${cx} ${cy} ${nx} ${ny} ${segDuration}`,
      `曲线滑动段${i}/${segments} (${cx},${cy})→(${nx},${ny})`
    );
    cx = nx;
    cy = ny;
  }
}
```

- [ ] **Step 2: 运行测试**

```bash
npx jest core/device/Device.test.ts --no-coverage
```

- [ ] **Step 3: Commit**

```bash
git add core/device/AdbDevice.ts
git commit -m "feat: swipe 曲线化，3-5 段微弧路径"
```

---

### Task 4: PluginContext — 微停顿

**Files:**
- Modify: `core/plugin/PluginContext.ts:27-37` (tap 和 sleep 方法)

- [ ] **Step 1: sleep 结束时 5% 概率追加 0.3-0.8s**

```typescript
// core/plugin/PluginContext.ts:33-37，替换 sleep 方法：
async sleep(seconds: number, maxSeconds?: number): Promise<void> {
  this.checkCancellation();
  await this.device.sleep(seconds, maxSeconds);
  // 5% 概率追加微停顿，模拟注意力分散
  if (Math.random() < 0.05) {
    await this.device.sleep(0.3 + Math.random() * 0.5); // 0.3-0.8s
  }
  this.checkCancellation();
}
```

- [ ] **Step 2: tap 后 10% 概率追加 0.2-0.5s**

```typescript
// core/plugin/PluginContext.ts:27-31，替换 tap 方法：
async tap(x: number, y: number): Promise<void> {
  this.checkCancellation();
  this.logOutput(`[TAP] (${x}, ${y})`);
  await this.device.tap(x, y);
  // 10% 概率追加微停顿，模拟操作犹豫
  if (Math.random() < 0.10) {
    await this.device.sleep(0.2 + Math.random() * 0.3); // 0.2-0.5s
  }
}
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add core/plugin/PluginContext.ts
git commit -m "feat: PluginContext tap/sleep 微停顿（5%/10% 概率）"
```

---

### Task 5: Home.tsx — 子循环抖动 + Idle-drag 调整

**Files:**
- Modify: `web/src/pages/Home.tsx:416-419` (gatherLoop 等待)
- Modify: `web/src/pages/Home.tsx:451` (helpLoop 等待)
- Modify: `web/src/pages/Home.tsx:483` (collectLoop 等待)
- Modify: `web/src/pages/Home.tsx:722-724` (idle-drag 触发条件)

- [ ] **Step 1: 子循环时间抖动**

gatherLoop (line 416-419) — 替换固定循环等待：
```typescript
// 替换 line 416-419
const jitteredInterval = features.loopInterval * (0.85 + Math.random() * 0.3);
const startWait = Date.now();
while (!loopStopped && (Date.now() - startWait) < jitteredInterval * 1000) {
  await sleep(1);
}
```

helpLoop (line 451) — 替换固定 60s：
```typescript
// 替换 line 451
const helpInterval = 60 * (0.85 + Math.random() * 0.3); // 51-69s
const startWait = Date.now();
while (!loopStopped && (Date.now() - startWait) < helpInterval * 1000) {
  await sleep(1);
}
```

collectLoop (line 483) — 替换固定 4h：
```typescript
// 替换 line 483
const collectInterval = 4 * 3600 * (0.85 + Math.random() * 0.3); // 3.4-4.6h
const startWait = Date.now();
while (!loopStopped && (Date.now() - startWait) < collectInterval * 1000) {
  await sleep(1);
}
```

- [ ] **Step 2: Idle-drag 参数调整（>120s, 40%）**

```typescript
// line 724，替换触发条件
if (dragWindow > 120 && Math.random() < 0.4) {
```

- [ ] **Step 3: 类型检查**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: 子循环 ±15% 时间抖动 + idle-drag 120s/40%"
```

---

### Task 6: 测试更新 + 最终验证

**Files:**
- Modify: `core/device/Device.test.ts`

- [ ] **Step 1: 新增 tap 按压测试**

```typescript
// 在 AdbDevice Randomization describe 块内追加：
it('should use swipe for tap when randomization enabled', async () => {
  device.setRandomizationEnabled(true);
  const execSpy = jest.spyOn(device as any, 'execAdb');
  await device.tap(100, 200);
  const cmd = execSpy.mock.calls[0][0] as string;
  expect(cmd).toContain('swipe');
  expect(cmd).not.toContain('tap');
  execSpy.mockRestore();
});

it('should use tap command when randomization disabled', async () => {
  device.setRandomizationEnabled(false);
  const execSpy = jest.spyOn(device as any, 'execAdb');
  await device.tap(100, 200);
  const cmd = execSpy.mock.calls[0][0] as string;
  expect(cmd).toContain('tap');
  expect(cmd).not.toContain('swipe');
  execSpy.mockRestore();
});
```

- [ ] **Step 2: 新增 sleep 范围测试**

```typescript
it('should sleep within range when maxSeconds is provided', async () => {
  device.setRandomizationConfig({ sleepJitter: 0 });
  const start = Date.now();
  await device.sleep(0.1, 0.3); // 100-300ms
  const elapsed = Date.now() - start;
  expect(elapsed).toBeGreaterThanOrEqual(95);
  expect(elapsed).toBeLessThan(500); // generous upper bound for CI
});

it('should sleep at least min when maxSeconds is provided', async () => {
  device.setRandomizationConfig({ sleepJitter: 0 });
  const start = Date.now();
  await device.sleep(0.05, 0.2);
  const elapsed = Date.now() - start;
  expect(elapsed).toBeGreaterThanOrEqual(48);
});
```

- [ ] **Step 3: 运行全部测试**

```bash
npx jest --no-coverage
```

- [ ] **Step 4: 全量类型检查**

```bash
npx tsc --noEmit && cd web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add core/device/Device.test.ts
git commit -m "test: tap 按压 + sleep 范围测试用例"
```
