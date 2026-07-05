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
  const fromX = dx !== 0 ? cx + dx * halfW : cx;
  const toX   = dx !== 0 ? cx - dx * halfW : cx;
  const fromY = dy !== 0 ? cy + dy * halfH : cy;
  const toY   = dy !== 0 ? cy - dy * halfH : cy;
  return { fromX, fromY, toX, toY };
}

export class SpiralStrategy implements GemSearchStrategy {
  readonly name = 'spiral';
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
    const d = DIRS[this.dirIndex];
    this.dirSwipes++;
    return makeStep(this.opts.centerX, this.opts.centerY, this.opts.halfW, this.opts.halfH, d.dx, d.dy);
  }
}

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

export class RandomWalkStrategy implements GemSearchStrategy {
  readonly name = 'random-walk';
  private lastDirIndex: number | null = null;

  constructor(private opts: StrategyOpts) {}

  next(): SwipeStep {
    let chosen: number;
    if (this.lastDirIndex === null) {
      chosen = Math.floor(Math.random() * 4);
    } else {
      const forbidden = (this.lastDirIndex + 2) % 4;
      const candidates = [0, 1, 2, 3].filter(i => i !== forbidden);
      chosen = candidates[Math.floor(Math.random() * candidates.length)];
    }
    this.lastDirIndex = chosen;
    const d = DIRS[chosen];
    return makeStep(this.opts.centerX, this.opts.centerY, this.opts.halfW, this.opts.halfH, d.dx, d.dy);
  }
}
