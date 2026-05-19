# 防脚本检测 — 设计文档

日期: 2026-05-19

## 问题

当前所有 tap/swipe/sleep 操作使用精确固定值和坐标，容易被游戏检测到脚本行为。

## 设计

### 1. AdbDevice 层随机化

**文件:** `core/device/AdbDevice.ts`

所有对外暴露的操作自动加随机偏移，任何调用方都受保护。

**Tap 点击 (`tap(x, y)`):**
- x/y 坐标各加 ±`tapOffset` px 随机偏移，默认 5px
- 公式：`x' = x + randomInt(-offset, offset)`，`y' = y + randomInt(-offset, offset)`

**Swipe 滑动 (`swipe(x1, y1, x2, y2, duration)`):**
- 起终点坐标各加 ±`tapOffset` px
- 滑动时长加 ±20% 随机抖动

**Sleep 等待 (`sleep(seconds)`):**
- 只加不减：`seconds' = seconds * (1 + random(0, jitterPercent))`，默认 15%
- 加时范围 0~15%，保证不低于基准值，防止画面未切换导致后续检测失败

**可配参数：**
```ts
interface RandomizationConfig {
  enabled: boolean;      // 默认 true
  tapOffset: number;     // 默认 5 (px)
  sleepJitter: number;   // 默认 0.15 (0~15% 加时)
}
```

**接口：**
```ts
class AdbDevice {
  setRandomizationEnabled(enabled: boolean): void;
  setRandomizationConfig(config: Partial<RandomizationConfig>): void;
}
```

### 2. Action 层

无需额外改动。所有 action 通过 `ctx.tap()` / `ctx.sleep()` / `ctx.swipe()` 调用，底层自动加偏移。

### 3. 行为层 — loopInterval 波动

**文件:** `web/src/pages/Home.tsx`

主循环中 `loopInterval`（默认 300s）每次轮询后加 ±10% 随机波动：

```ts
const actualInterval = loopInterval * (0.9 + Math.random() * 0.2);
```

### 4. 等待期随机拖拽（idle drag）

**文件:** `plugins/rok/actions/idleDrag.ts` (新建) + `plugins/rok/index.ts`

在循环等待期间插入随机拖拽，模拟人在滑动浏览城池。

**行为：**
- 在等待期内随机执行 1-3 次拖拽
- 每次拖拽的时间点随机分布
- 拖拽方向随机（上下左右），距离随机（200~800px），速度随机（300~1200ms）
- 城内城外不限制，可自由切换

**实现方式：**

新建 `idleDrag` action：

```ts
export async function idleDrag(ctx: PluginContext): Promise<void> {
  const dragCount = 1 + Math.floor(Math.random() * 3); // 1-3 次
  for (let i = 0; i < dragCount; i++) {
    // 随机方向 + 随机距离 + 随机速度
    const x1 = 200 + Math.random() * 680;   // 200~880
    const y1 = 200 + Math.random() * 800;   // 200~1000
    const x2 = x1 + (Math.random() - 0.5) * 800;
    const y2 = y1 + (Math.random() - 0.5) * 800;
    const duration = 300 + Math.random() * 900; // 300~1200ms
    await ctx.swipe(x1, y1, x2, y2, duration);
    // 拖拽间隔随机
    await ctx.sleep(2 + Math.random() * 4);
  }
}
```

**前端触发：**

`Home.tsx` 的主循环等待期间，随机时间点调用 `idle-drag` action（通过 API），将等待拆分为"等待一段 → 调用拖拽 → 等待剩余"。

### 涉及文件

| 文件 | 改动 |
|------|------|
| `core/device/AdbDevice.ts` | 主要改动，tap/swipe/sleep 加随机偏移 |
| `plugins/rok/actions/idleDrag.ts` | 新建，随机拖拽 action |
| `plugins/rok/index.ts` | 注册 idle-drag action |
| `web/src/pages/Home.tsx` | loopInterval ±10% 波动 + 等待期插入 idleDrag |
