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

// 象限：0=右下, 1=左下, 2=左上, 3=右上
const QUAD_DIRS: Array<{ hx: number; vy: number }> = [
  { hx:  1, vy:  1 },
  { hx: -1, vy:  1 },
  { hx: -1, vy: -1 },
  { hx:  1, vy: -1 },
];

const CW_ORDER  = [0, 1, 2, 3];
const CCW_ORDER = [0, 3, 2, 1];

function transitionDir(fromQ: number, toQ: number): { dx: number; dy: number } {
  const from = QUAD_DIRS[fromQ];
  const to = QUAD_DIRS[toQ];
  if (from.hx !== to.hx) return { dx: to.hx, dy: 0 };
  return { dx: 0, dy: to.vy };
}

export class SnakeStrategy implements GemSearchStrategy {
  readonly name = 'snake';
  private quadOrder: number[];
  private quadIndex = 0;
  private row = 0;
  private colInRow = 0;
  private phase: 'row' | 'vnudge' | 'transition' | 'done' = 'row';
  private transitionCol = 0;

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
      const dx = this.row % 2 === 0 ? hx : -hx;
      const step = makeStep(centerX, centerY, halfW, halfH, dx, 0);
      this.colInRow++;
      if (this.colInRow >= 4) {
        this.colInRow = 0;
        if (this.row < 5) {
          this.phase = 'vnudge';
        } else {
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
