# 宝石采集 — 多样化滑动搜索策略

## 背景

`plugins/rok/actions/gatherGem.ts` 目前用固定的方形螺旋搜索宝石：方向序列永远是 右→下→左→上，步长逐层扩大，每段固定 `halfW`/`halfH`，滑动时长固定 500ms。

`AdbDevice` 已经用贝塞尔曲线让单次滑动轨迹带抖动，但**方向序列 / 距离 / 时长**三个宏观特征是死的，长期观测容易被识别。

## 目标

引入策略池，每轮宝石搜索随机挑一种策略，让宏观轨迹不再单一。

## 策略池

每轮开始时按权重抽一种：

| 策略 | 权重 |
|---|---|
| 原螺旋 | 40% |
| 反向螺旋 | 40% |
| 随机游走 | 10% |
| 蛇形扫描 | 10% |

### 1. 原螺旋（现有）

方向序列 右→下→左→上，每 2 个方向后步长 +1，段长 = `halfW`/`halfH`。逻辑保持不变，只是抽出到策略文件。

### 2. 反向螺旋

方向序列 左→上→右→下，其余同原螺旋（步长增长规则一致）。

### 3. 随机游走

- 首步：4 个方向等概率选一个
- 后续步：从 4 个方向去掉"上一步的反方向"（防止原地摆动），剩 3 个方向等概率选一个
- 段长固定 `halfW`（水平方向）或 `halfH`（垂直方向）
- 无内部终止条件，跑到 `maxAttempts` 为止

### 4. 蛇形扫描

以屏幕中心为原点分 4 象限，逐象限扫描。

**象限顺序：** 初始时随机 permutation 4 象限（24 种排列之一）。

**单象限走法**（以右上象限为例，走 6 行 × 4 段）：

```
循环 6 次：
  横向 4 段 halfW（第 1、3、5 行朝右；第 2、4、6 行朝左，即之字）
  纵向 1 格 halfH（朝远离中心方向 — 右上象限就朝上）
第 6 行末尾额外横向 4 段 halfW → 走入相邻象限
```

第 6 行走完后的横向 4 段起到"跨象限过渡"作用，然后进入下一个象限继续 6 行扫描。

## 接口

新文件 `plugins/rok/utils/gemSearchStrategies.ts`：

```ts
export interface GemSearchStrategy {
  readonly name: string;
  next(): SwipeStep | null;  // null = 策略自然结束
}

export interface SwipeStep {
  fromX: number; fromY: number;
  toX: number; toY: number;
}

export function pickStrategy(
  centerX: number, centerY: number,
  halfW: number, halfH: number,
): GemSearchStrategy;
```

四个策略类各自实现 `next()`，内部维护迭代状态（步数、方向、象限进度等）。

## `gatherGem.ts` 改造点

- 用 `searchState: { strategy, moveCount }` 替代现在的 `spiralState`
- 每轮找宝石开始时调 `pickStrategy(cx, cy, halfW, halfH)` 抽策略，`ctx.log` 输出策略名（便于调试）
- 内层 while 循环改成：`const step = strategy.next(); if (!step) break;` 然后 `await ctx.swipe(step.fromX, step.fromY, step.toX, step.toY, 500, false)`
- 中心点初次检测 (`checkedCenter`) 保留在策略外
- `maxAttempts` 保持不变

## 验证

- 编译通过（`npx tsc --noEmit`）
- 手动跑几轮宝石采集，日志里能看到 4 种策略都出现过
- 蛇形和随机游走的路径大致符合预期（不出屏、不卡死）

## 关键文件

- `plugins/rok/utils/gemSearchStrategies.ts` — 新建
- `plugins/rok/actions/gatherGem.ts` — 主循环改造，去掉旧 spiralState
