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
