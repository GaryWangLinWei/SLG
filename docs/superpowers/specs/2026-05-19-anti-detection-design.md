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

### 涉及文件

| 文件 | 改动 |
|------|------|
| `core/device/AdbDevice.ts` | 主要改动，加随机化逻辑 + 配置方法 |
| `web/src/pages/Home.tsx` | loopInterval ±10% 波动 |
