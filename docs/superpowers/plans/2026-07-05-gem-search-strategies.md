# 宝石采集多样化搜索策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把宝石采集的单一方形螺旋搜索替换成 4 种策略的加权随机池（原螺旋 40% / 反向螺旋 40% / 随机游走 10% / 蛇形扫描 10%），弱化宏观轨迹规律以对抗检测。

**Architecture:** 新建 `plugins/rok/utils/gemSearchStrategies.ts`，把"下一次滑动"抽象成 `GemSearchStrategy.next()` 迭代器接口。四个策略类各自维护内部状态，`gatherGem.ts` 主循环只调用 `pickStrategy()` + `strategy.next()`，不再关心具体走法。原 `SpiralState` 拆成"通用参数（中心/halfW/halfH/maxAttempts/moveCount/checkedCenter）" + "策略实例"两部分。

**Tech Stack:** TypeScript, ts-jest, 现有 `PluginContext.swipe` API。

参考 spec：`docs/superpowers/specs/2026-07-05-gem-search-strategies-design.md`。

---

## File Structure

- **Create:** `plugins/rok/utils/gemSearchStrategies.ts` — 4 个策略类 + `pickStrategy()` 工厂 + `GemSearchStrategy` 接口 + `SwipeStep` 类型
- **Create:** `plugins/rok/utils/gemSearchStrategies.test.ts` — 策略单元测试
- **Modify:** `plugins/rok/actions/gatherGem.ts` — `SpiralState` → `SearchState`，`searchAndClickGem` 内层循环换成 `strategy.next()`；`createSpiralState` 保留但内部换成新结构
- **Modify:** `plugins/rok/actions/gatherGem.test.ts` — 因 `SpiralState` 字段变化，调整现有测试

---

## Task 1: 定义策略接口与"原螺旋"策略（TDD）

**Files:**
- Create: `plugins/rok/utils/gemSearchStrategies.ts`
- Test: `plugins/rok/utils/gemSearchStrategies.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `plugins/rok/utils/gemSearchStrategies.test.ts`:

```ts
import { SpiralStrategy } from './gemSearchStrategies';

describe('SpiralStrategy', () => {
  it('方向序列 右→下→左→上，每 2 次换向后步长 +1', () => {
    const s = new SpiralStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });

    // step 1: 右 1 次
    let step = s.next()!;
    expect(step.fromX).toBe(800 + 400);
    expect(step.toX).toBe(800 - 400);
    expect(step.fromY).toBe(450);

    // step 1: 下 1 次
    step = s.next()!;
    expect(step.fromY).toBe(450 - 225);
    expect(step.toY).toBe(450 + 225);

    // 步长升到 2: 左 2 次
    step = s.next()!;
    expect(step.fromX).toBe(800 - 400);
    expect(step.toX).toBe(800 + 400);
    step = s.next()!;
    expect(step.fromX).toBe(800 - 400);

    // 步长仍是 2: 上 2 次
    step = s.next()!;
    expect(step.fromY).toBe(450 + 225);
    step = s.next()!;
    expect(step.fromY).toBe(450 + 225);

    // 步长升到 3: 右 3 次
    step = s.next()!;
    expect(step.fromX).toBe(800 + 400);
  });

  it('name = "spiral"', () => {
    const s = new SpiralStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    expect(s.name).toBe('spiral');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd D:/SLG && npx jest plugins/rok/utils/gemSearchStrategies.test.ts`
Expected: FAIL (`Cannot find module './gemSearchStrategies'`)

- [ ] **Step 3: 实现接口与 SpiralStrategy**

创建 `plugins/rok/utils/gemSearchStrategies.ts`:

```ts
export interface SwipeStep {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface StrategyOpts {
  centerX: number;
  centerY: number;
  halfW: number;
  halfH: number;
}

export interface GemSearchStrategy {
  readonly name: string;
  next(): SwipeStep | null;
}

// 方向向量：右→下→左→上 顺时针
const DIRS = [
  { dx:  1, dy:  0 }, // 右
  { dx:  0, dy:  1 }, // 下
  { dx: -1, dy:  0 }, // 左
  { dx:  0, dy: -1 }, // 上
];

function makeStep(cx: number, cy: number, halfW: number, halfH: number, dx: number, dy: number): SwipeStep {
  // 从"远离中心"侧起，滑向"靠近中心"侧
  // dx: from = cx + dx*halfW, to = cx - dx*halfW
  // dy 同理，只是当 dx≠0 时 fromY = toY = cy（水平滑动）
  const fromX = dx !== 0 ? cx + dx * halfW : cx;
  const toX   = dx !== 0 ? cx - dx * halfW : cx;
  const fromY = dy !== 0 ? cy + dy * halfH : cy;
  const toY   = dy !== 0 ? cy - dy * halfH : cy;
  return { fromX, fromY, toX, toY };
}

export class SpiralStrategy implements GemSearchStrategy {
  readonly name = 'spiral';
  private step = 1;
  private dirIndex = 0;    // DIRS 索引
  private dirSwipes = 0;   // 当前方向已滑几次

  constructor(private opts: StrategyOpts) {}

  next(): SwipeStep {
    if (this.dirSwipes >= this.step) {
      // 换向：每 2 个方向后步长 +1
      if (this.dirIndex % 2 === 1) this.step++;
      this.dirIndex = (this.dirIndex + 1) % 4;
      this.dirSwipes = 0;
    }
    const d = DIRS[this.dirIndex];
    this.dirSwipes++;
    return makeStep(this.opts.centerX, this.opts.centerY, this.opts.halfW, this.opts.halfH, d.dx, d.dy);
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd D:/SLG && npx jest plugins/rok/utils/gemSearchStrategies.test.ts`
Expected: PASS 2

- [ ] **Step 5: 提交**

```bash
cd D:/SLG
git add plugins/rok/utils/gemSearchStrategies.ts plugins/rok/utils/gemSearchStrategies.test.ts
git commit -m "feat(gem-search): 抽出策略接口 + SpiralStrategy"
```

---

## Task 2: 反向螺旋 ReverseSpiralStrategy（TDD）

**Files:**
- Modify: `plugins/rok/utils/gemSearchStrategies.ts`
- Modify: `plugins/rok/utils/gemSearchStrategies.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `gemSearchStrategies.test.ts`:

```ts
import { ReverseSpiralStrategy } from './gemSearchStrategies';

describe('ReverseSpiralStrategy', () => {
  it('方向序列 左→上→右→下，每 2 次换向后步长 +1', () => {
    const s = new ReverseSpiralStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });

    // 左 1
    let step = s.next()!;
    expect(step.fromX).toBe(800 - 400);
    expect(step.toX).toBe(800 + 400);

    // 上 1
    step = s.next()!;
    expect(step.fromY).toBe(450 + 225);
    expect(step.toY).toBe(450 - 225);

    // 右 2
    step = s.next()!;
    expect(step.fromX).toBe(800 + 400);
    step = s.next()!;
    expect(step.fromX).toBe(800 + 400);

    // 下 2
    step = s.next()!;
    expect(step.fromY).toBe(450 - 225);
    step = s.next()!;
    expect(step.fromY).toBe(450 - 225);
  });

  it('name = "reverse-spiral"', () => {
    const s = new ReverseSpiralStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    expect(s.name).toBe('reverse-spiral');
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd D:/SLG && npx jest plugins/rok/utils/gemSearchStrategies.test.ts`
Expected: FAIL (`ReverseSpiralStrategy is not exported`)

- [ ] **Step 3: 实现 ReverseSpiralStrategy**

追加到 `gemSearchStrategies.ts`:

```ts
// 反向方向序列：左→上→右→下
const REVERSE_DIRS = [
  { dx: -1, dy:  0 }, // 左
  { dx:  0, dy: -1 }, // 上
  { dx:  1, dy:  0 }, // 右
  { dx:  0, dy:  1 }, // 下
];

export class ReverseSpiralStrategy implements GemSearchStrategy {
  readonly name = 'reverse-spiral';
  private step = 1;
  private dirIndex = 0;
  private dirSwipes = 0;

  constructor(private opts: StrategyOpts) {}

  next(): SwipeStep {
    if (this.dirSwipes >= this.step) {
      if (this.dirIndex % 2 === 1) this.step++;
      this.dirIndex = (this.dirIndex + 1) % 4;
      this.dirSwipes = 0;
    }
    const d = REVERSE_DIRS[this.dirIndex];
    this.dirSwipes++;
    return makeStep(this.opts.centerX, this.opts.centerY, this.opts.halfW, this.opts.halfH, d.dx, d.dy);
  }
}
```

- [ ] **Step 4: 验证通过**

Run: `cd D:/SLG && npx jest plugins/rok/utils/gemSearchStrategies.test.ts`
Expected: PASS 4

- [ ] **Step 5: 提交**

```bash
cd D:/SLG
git add plugins/rok/utils/gemSearchStrategies.ts plugins/rok/utils/gemSearchStrategies.test.ts
git commit -m "feat(gem-search): ReverseSpiralStrategy"
```

---

## Task 3: 随机游走 RandomWalkStrategy（TDD）

**规则：** 首步 4 方向随机；后续步禁止选"上一步反方向"（防原地摆动），剩 3 方向等概率。

**Files:**
- Modify: `plugins/rok/utils/gemSearchStrategies.ts`
- Modify: `plugins/rok/utils/gemSearchStrategies.test.ts`

- [ ] **Step 1: 写失败测试**

追加：

```ts
import { RandomWalkStrategy } from './gemSearchStrategies';

describe('RandomWalkStrategy', () => {
  it('首步用 Math.random 选 4 方向之一', () => {
    // 0.6 * 4 = 2.4 → floor = 2 → DIRS[2] = 左 (dx=-1)
    jest.spyOn(Math, 'random').mockReturnValueOnce(0.6);
    const s = new RandomWalkStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    const step = s.next()!;
    expect(step.fromX).toBe(800 - 400);
    expect(step.toX).toBe(800 + 400);
    jest.restoreAllMocks();
  });

  it('后续步不选"上一步的反方向"', () => {
    // 首步：0 → 右 (dx=1)
    // 第二步禁止 左 (DIRS[2])。候选顺序 [右, 下, 上]（跳过左）。0.5*3=1.5→floor=1 → 下
    jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0)     // 首步右
      .mockReturnValueOnce(0.5);  // 第二步在剩 3 个里选 index 1
    const s = new RandomWalkStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    s.next(); // 首步：右
    const step = s.next()!;
    // 下：fromY = cy - halfH*(+1) = 450 - 225；toY = 450 + 225
    expect(step.fromY).toBe(450 - 225);
    expect(step.toY).toBe(450 + 225);
    jest.restoreAllMocks();
  });

  it('name = "random-walk"', () => {
    const s = new RandomWalkStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    expect(s.name).toBe('random-walk');
  });
});
```

- [ ] **Step 2: 验证失败**

Run: `cd D:/SLG && npx jest plugins/rok/utils/gemSearchStrategies.test.ts`
Expected: FAIL (`RandomWalkStrategy is not exported`)

- [ ] **Step 3: 实现**

追加到 `gemSearchStrategies.ts`:

```ts
export class RandomWalkStrategy implements GemSearchStrategy {
  readonly name = 'random-walk';
  private lastDirIndex: number | null = null;

  constructor(private opts: StrategyOpts) {}

  next(): SwipeStep {
    let chosen: number;
    if (this.lastDirIndex === null) {
      chosen = Math.floor(Math.random() * 4);
    } else {
      // 禁止方向：与上一步反向（DIRS 中 (i+2)%4 恒为反向）
      const forbidden = (this.lastDirIndex + 2) % 4;
      const candidates = [0, 1, 2, 3].filter(i => i !== forbidden);
      chosen = candidates[Math.floor(Math.random() * candidates.length)];
    }
    this.lastDirIndex = chosen;
    const d = DIRS[chosen];
    return makeStep(this.opts.centerX, this.opts.centerY, this.opts.halfW, this.opts.halfH, d.dx, d.dy);
  }
}
```

- [ ] **Step 4: 验证通过**

Run: `cd D:/SLG && npx jest plugins/rok/utils/gemSearchStrategies.test.ts`
Expected: PASS 7

- [ ] **Step 5: 提交**

```bash
cd D:/SLG
git add plugins/rok/utils/gemSearchStrategies.ts plugins/rok/utils/gemSearchStrategies.test.ts
git commit -m "feat(gem-search): RandomWalkStrategy"
```

---

## Task 4: 蛇形扫描 SnakeStrategy（TDD）

**规则：** 4 象限扫描，起始象限 4 选 1 随机 + 顺/逆时针 2 选 1 随机（共 8 种起始配置）。单象限走法（以右下为例，远离中心 = 右+下）：

- 第 1、3、5 行：右 4 段
- 第 2、4、6 行：左 4 段
- 每行末尾：下 1 格（第 6 行末尾 → 4 段过渡到下一个象限）

其他象限对称：
- **右下**：横起始"右"，纵起始"下"
- **左下**：横起始"左"，纵起始"下"
- **左上**：横起始"左"，纵起始"上"
- **右上**：横起始"右"，纵起始"上"

跨象限过渡 4 段的方向由环绕顺序决定：顺时针序列 = 右下→左下→左上→右上；逆时针 = 右下→右上→左上→左下。**过渡方向 = 从当前象限指向下一象限的横向 or 纵向方向**（相邻象限差一个坐标轴）。

一个象限走 6 行 × 4 段 + 5 次纵向 = 29 次 + 过渡 4 段 = 33 次。4 象限 = 132 次调用，之后 `next()` 返回 `null`。

**Files:**
- Modify: `plugins/rok/utils/gemSearchStrategies.ts`
- Modify: `plugins/rok/utils/gemSearchStrategies.test.ts`

- [ ] **Step 1: 写失败测试**

追加：

```ts
import { SnakeStrategy } from './gemSearchStrategies';

describe('SnakeStrategy', () => {
  it('name = "snake"', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const s = new SnakeStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    expect(s.name).toBe('snake');
    jest.restoreAllMocks();
  });

  it('从右下象限、顺时针开始：第 1 行是右 4 段', () => {
    // 0.0 → 象限 index 0 = 右下；0.0 → 顺时针
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const s = new SnakeStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    for (let i = 0; i < 4; i++) {
      const step = s.next()!;
      expect(step.fromX).toBe(800 + 400); // 右滑：from 在中心右
      expect(step.toX).toBe(800 - 400);
      expect(step.fromY).toBe(450);
    }
    jest.restoreAllMocks();
  });

  it('第 1 行 4 段后是纵向 1 格（下）', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const s = new SnakeStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    for (let i = 0; i < 4; i++) s.next();
    const nudge = s.next()!;
    // 下：fromY = cy - halfH，toY = cy + halfH
    expect(nudge.fromY).toBe(450 - 225);
    expect(nudge.toY).toBe(450 + 225);
    jest.restoreAllMocks();
  });

  it('第 2 行是左 4 段', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const s = new SnakeStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    for (let i = 0; i < 5; i++) s.next(); // 消耗第 1 行 + 1 次纵向
    for (let i = 0; i < 4; i++) {
      const step = s.next()!;
      expect(step.fromX).toBe(800 - 400); // 左滑
      expect(step.toX).toBe(800 + 400);
    }
    jest.restoreAllMocks();
  });

  it('4 象限总共 132 步，之后返回 null', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const s = new SnakeStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    for (let i = 0; i < 132; i++) {
      expect(s.next()).not.toBeNull();
    }
    expect(s.next()).toBeNull();
    jest.restoreAllMocks();
  });
});
```

- [ ] **Step 2: 验证失败**

Run: `cd D:/SLG && npx jest plugins/rok/utils/gemSearchStrategies.test.ts`
Expected: FAIL (`SnakeStrategy is not exported`)

- [ ] **Step 3: 实现**

追加到 `gemSearchStrategies.ts`:

```ts
// 象限：0=右下, 1=左下, 2=左上, 3=右上
// 每个象限的 (横向起始方向 dx, 纵向方向 dy)
const QUAD_DIRS: Array<{ hx: number; vy: number }> = [
  { hx:  1, vy:  1 }, // 右下：右 + 下
  { hx: -1, vy:  1 }, // 左下：左 + 下
  { hx: -1, vy: -1 }, // 左上：左 + 上
  { hx:  1, vy: -1 }, // 右上：右 + 上
];

// 象限环绕顺序
const CW_ORDER  = [0, 1, 2, 3]; // 顺时针：右下→左下→左上→右上
const CCW_ORDER = [0, 3, 2, 1]; // 逆时针：右下→右上→左上→左下

/** 相邻两象限之间的过渡方向（当前 → 下一个）。返回 {dx, dy}，恰有一个非零。 */
function transitionDir(fromQ: number, toQ: number): { dx: number; dy: number } {
  const from = QUAD_DIRS[fromQ];
  const to = QUAD_DIRS[toQ];
  if (from.hx !== to.hx) return { dx: to.hx, dy: 0 };  // 横向过渡
  return { dx: 0, dy: to.vy };                          // 纵向过渡
}

export class SnakeStrategy implements GemSearchStrategy {
  readonly name = 'snake';
  private quadOrder: number[];
  private quadIndex = 0;      // 当前在 quadOrder 中的下标
  private row = 0;            // 当前象限行号 0..5
  private colInRow = 0;       // 当前行已走段数 0..4
  private phase: 'row' | 'vnudge' | 'transition' | 'done' = 'row';
  private transitionCol = 0;  // 过渡阶段已走段数 0..4

  constructor(private opts: StrategyOpts) {
    const start = Math.floor(Math.random() * 4);
    const cw = Math.random() < 0.5;
    const base = cw ? CW_ORDER : CCW_ORDER;
    const shift = base.indexOf(start);
    this.quadOrder = [...base.slice(shift), ...base.slice(0, shift)];
  }

  next(): SwipeStep | null {
    if (this.phase === 'done') return null;
    const { centerX, centerY, halfW, halfH } = this.opts;
    const q = this.quadOrder[this.quadIndex];
    const { hx, vy } = QUAD_DIRS[q];

    if (this.phase === 'row') {
      // 第 row 行的横向方向：偶数行 = 象限起始横向，奇数行 = 反向
      const dx = this.row % 2 === 0 ? hx : -hx;
      const step = makeStep(centerX, centerY, halfW, halfH, dx, 0);
      this.colInRow++;
      if (this.colInRow >= 4) {
        this.colInRow = 0;
        if (this.row < 5) {
          this.phase = 'vnudge';
        } else {
          // 第 6 行走完 → 过渡到下一象限
          this.phase = 'transition';
        }
      }
      return step;
    }

    if (this.phase === 'vnudge') {
      const step = makeStep(centerX, centerY, halfW, halfH, 0, vy);
      this.row++;
      this.phase = 'row';
      return step;
    }

    // transition
    const nextQuadIdx = this.quadIndex + 1;
    if (nextQuadIdx >= this.quadOrder.length) {
      this.phase = 'done';
      return null;
    }
    const trans = transitionDir(q, this.quadOrder[nextQuadIdx]);
    const step = makeStep(centerX, centerY, halfW, halfH, trans.dx, trans.dy);
    this.transitionCol++;
    if (this.transitionCol >= 4) {
      this.transitionCol = 0;
      this.quadIndex = nextQuadIdx;
      this.row = 0;
      this.phase = 'row';
    }
    return step;
  }
}
```

- [ ] **Step 4: 验证通过**

Run: `cd D:/SLG && npx jest plugins/rok/utils/gemSearchStrategies.test.ts`
Expected: PASS 12

- [ ] **Step 5: 提交**

```bash
cd D:/SLG
git add plugins/rok/utils/gemSearchStrategies.ts plugins/rok/utils/gemSearchStrategies.test.ts
git commit -m "feat(gem-search): SnakeStrategy"
```

---

## Task 5: 策略工厂 pickStrategy 加权抽取（TDD）

**Files:**
- Modify: `plugins/rok/utils/gemSearchStrategies.ts`
- Modify: `plugins/rok/utils/gemSearchStrategies.test.ts`

- [ ] **Step 1: 写失败测试**

追加：

```ts
import { pickStrategy } from './gemSearchStrategies';

describe('pickStrategy', () => {
  const opts = { centerX: 800, centerY: 450, halfW: 400, halfH: 225 };

  it('random < 0.4 → spiral', () => {
    jest.spyOn(Math, 'random').mockReturnValueOnce(0.2);
    expect(pickStrategy(opts).name).toBe('spiral');
    jest.restoreAllMocks();
  });

  it('0.4 <= random < 0.8 → reverse-spiral', () => {
    jest.spyOn(Math, 'random').mockReturnValueOnce(0.5);
    expect(pickStrategy(opts).name).toBe('reverse-spiral');
    jest.restoreAllMocks();
  });

  it('0.8 <= random < 0.9 → random-walk', () => {
    jest.spyOn(Math, 'random').mockReturnValueOnce(0.85);
    expect(pickStrategy(opts).name).toBe('random-walk');
    jest.restoreAllMocks();
  });

  it('random >= 0.9 → snake', () => {
    // 首次 mock 决定策略；后续 mock 用于 SnakeStrategy 构造函数内的 random
    jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0.95)
      .mockReturnValue(0);
    expect(pickStrategy(opts).name).toBe('snake');
    jest.restoreAllMocks();
  });
});
```

- [ ] **Step 2: 验证失败**

Run: `cd D:/SLG && npx jest plugins/rok/utils/gemSearchStrategies.test.ts`
Expected: FAIL (`pickStrategy is not exported`)

- [ ] **Step 3: 实现**

追加到 `gemSearchStrategies.ts`:

```ts
export function pickStrategy(opts: StrategyOpts): GemSearchStrategy {
  const r = Math.random();
  if (r < 0.4) return new SpiralStrategy(opts);
  if (r < 0.8) return new ReverseSpiralStrategy(opts);
  if (r < 0.9) return new RandomWalkStrategy(opts);
  return new SnakeStrategy(opts);
}
```

- [ ] **Step 4: 验证通过**

Run: `cd D:/SLG && npx jest plugins/rok/utils/gemSearchStrategies.test.ts`
Expected: PASS 16

- [ ] **Step 5: 提交**

```bash
cd D:/SLG
git add plugins/rok/utils/gemSearchStrategies.ts plugins/rok/utils/gemSearchStrategies.test.ts
git commit -m "feat(gem-search): pickStrategy 加权工厂"
```

---

## Task 6: gatherGem.ts 接入策略池

把 `SpiralState` 里的螺旋专有字段（`step`/`dirIndex`/`dirSwipes`）替换成 `strategy: GemSearchStrategy`。保持导出名 `SpiralState` 和 `createSpiralState`，避免 `gatherGemFocus.ts` 和 test 改名。

**Files:**
- Modify: `plugins/rok/actions/gatherGem.ts`
- Modify: `plugins/rok/actions/gatherGem.test.ts`

- [ ] **Step 1: 更新单元测试**

替换 `plugins/rok/actions/gatherGem.test.ts` 里第 38-63 行的 `createSpiralState` 测试为：

```ts
describe('gatherGem 搜索状态', () => {
  it('初始化通用参数（中心、halfW/H、maxAttempts）并挂载策略实例', () => {
    const randomSpy = jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0.25) // centerX = 780
      .mockReturnValueOnce(0.8)  // centerY = 465
      .mockReturnValueOnce(1)    // maxAttempts = 110%
      .mockReturnValueOnce(0);   // pickStrategy → spiral (且后续 Snake 用不到)

    const state = createSpiralState({
      gemGather: {
        spiralSwipeRatio: 0.5,
        spiralSwipeRatioH: 0.6,
        searchMaxAttempts: 30,
      },
    } as any);

    expect(state.centerX).toBe(780);
    expect(state.centerY).toBe(465);
    expect(state.maxAttempts).toBe(33);
    expect(state.halfW).toBe(Math.round(1600 * 0.6 / 2));
    expect(state.halfH).toBe(Math.round(900 * 0.5 / 2));
    expect(state.strategy.name).toBe('spiral');
    expect(state.moveCount).toBe(0);
    expect(state.checkedCenter).toBe(false);

    randomSpy.mockRestore();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd D:/SLG && npx jest plugins/rok/actions/gatherGem.test.ts`
Expected: FAIL（`state.strategy` 不存在等）

- [ ] **Step 3: 改造 SpiralState 接口和 createSpiralState**

在 `plugins/rok/actions/gatherGem.ts` 顶部（`getTeamButtons` import 之后）追加：

```ts
import { GemSearchStrategy, pickStrategy } from '../utils/gemSearchStrategies';
```

替换 176-207 行（`SPIRAL_DIRECTIONS`/`SPIRAL_DIR_NAMES` 常量、`SpiralState` 接口、`createSpiralState` 函数、以及后面 `maxAttempts` 计算的尾部）为：

```ts
export interface SpiralState {
  moveCount: number;
  checkedCenter: boolean;
  centerX: number;
  centerY: number;
  halfW: number;
  halfH: number;
  maxAttempts: number;
  strategy: GemSearchStrategy;
}

export function createSpiralState(config: RokConfig): SpiralState {
  const gg = config.gemGather;
  const centerX = 800 + Math.round((Math.random() * 2 - 1) * 40);
  const centerY = 450 + Math.round((Math.random() * 2 - 1) * 25);
  const maxAttemptScale = 0.9 + Math.random() * 0.2;
  const halfW = Math.round(1600 * (gg.spiralSwipeRatioH ?? gg.spiralSwipeRatio) / 2);
  const halfH = Math.round(900 * gg.spiralSwipeRatio / 2);
  const strategy = pickStrategy({ centerX, centerY, halfW, halfH });
  return {
    moveCount: 0,
    checkedCenter: false,
    centerX,
    centerY,
    halfW,
    halfH,
    maxAttempts: Math.round(gg.searchMaxAttempts * maxAttemptScale),
    strategy,
  };
}
```

（`SPIRAL_DIRECTIONS`/`SPIRAL_DIR_NAMES` 常量整体删除。）

- [ ] **Step 4: 改造 searchAndClickGem 内层循环**

替换 337-375 行的 `while (!gemFound ...)` 双层循环为：

```ts
if (!gemFound) {
  ctx.log(`  [搜索] 策略: ${spiralState.strategy.name}`);
}

while (!gemFound && spiralState.moveCount < spiralState.maxAttempts) {
  const step = spiralState.strategy.next();
  if (!step) {
    ctx.log(`  [搜索] 策略 ${spiralState.strategy.name} 已耗尽`);
    break;
  }
  spiralState.moveCount++;
  await ctx.swipe(step.fromX, step.fromY, step.toX, step.toY, 500, false);
  await ctx.sleep(nextGemSearchPauseSeconds());

  const detections = await ctx.detectWithScreenshot(0.35);
  ctx.log(`  [搜索] step ${spiralState.moveCount}/${spiralState.maxAttempts} 找到 ${detections.length} 个宝石候选`);
  const validDet = detections.find(d => !isInChatZone(d.x, d.y));
  if (validDet) {
    if (await isGemOccupied(ctx, validDet.x, validDet.y)) {
      ctx.log(`  宝石 (${validDet.x}, ${validDet.y}) 已被占用，继续搜索`);
    } else {
      gemX = validDet.x; gemY = validDet.y;
      ctx.log(`  找到空闲宝石矿 (${gemX}, ${gemY}) confidence: ${validDet.confidence.toFixed(3)}`);
      gemFound = true;
    }
  }
}
```

- [ ] **Step 5: 运行两个测试文件全部通过**

Run: `cd D:/SLG && npx jest plugins/rok/actions/gatherGem.test.ts plugins/rok/utils/gemSearchStrategies.test.ts`
Expected: 全部 PASS

- [ ] **Step 6: 类型检查**

Run: `cd D:/SLG && npx tsc --noEmit`
Expected: 无输出（无错误）

- [ ] **Step 7: 全量测试**

Run: `cd D:/SLG && npm test`
Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
cd D:/SLG
git add plugins/rok/actions/gatherGem.ts plugins/rok/actions/gatherGem.test.ts
git commit -m "refactor(gem): searchAndClickGem 接入策略池"
```

---

## Task 7: 最终手工验证清单

- [ ] **Step 1: 快速冒烟**

启动前端 + 后端，跑一次宝石采集，观察日志：

```
[搜索] 策略: spiral | reverse-spiral | random-walk | snake
[搜索] step N/... 找到 X 个宝石候选
```

多跑 5-10 次，验证 4 种策略名都出现过（权重上 spiral/reverse 各 ~40%，其他各 ~10%）。

- [ ] **Step 2: 蛇形和随机游走目视检查**

看模拟器画面，确认蛇形滑动确实呈之字形跨象限、随机游走不会立刻回头（宏观上有明显位移）。

- [ ] **Step 3: 提交最终确认**

无代码改动则跳过。若发现问题，回到相关 Task 修复。

---

## Self-Review Notes

- ✅ Spec 4 种策略 + 权重（40/40/10/10）全部有对应 Task
- ✅ 蛇形起始 8 种配置（4 象限 × 2 环绕方向）在 SnakeStrategy 构造函数中实现
- ✅ 随机游走"不回头"规则在 RandomWalkStrategy 中显式过滤
- ✅ 现有 `gatherGemFocus.ts` 通过导出名 `SpiralState`/`createSpiralState` 保持兼容，无需修改
- ✅ 测试文件里现有 3 个 describe 中，`createSpiralState` 那个改成新字段；其他两个（等待时间、debug SVG）不受影响
- ✅ 每个 Task 都是 TDD（失败测试 → 实现 → 通过）+ 独立 commit
