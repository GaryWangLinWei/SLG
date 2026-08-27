/**
 * 拟人滑动轨迹生成（纯函数，无 IO）。
 *
 * 为什么需要它：`adb shell input swipe` 只能画匀速直线，而把一次滑动拆成多条
 * input swipe 更糟——每条都是独立的"按下→抬起"手势，段间抬手会让游戏把短段当成
 * 点击、并在每段末尾触发一次惯性。
 *
 * 这里改为生成一整串 `input motionevent DOWN/MOVE/UP` 事件，由
 * `joinMotioneventCmd()` 拼成**一次** shell 调用执行（与 AdbDevice.dragNoFling
 * 同一套已在生产验证的模式）：手势的连续性取决于事件序列里不出现 UP，
 * 而非进程边界，因此整条轨迹是一个不间断的手势。时序由设备端 sleep 控制。
 */

export type SwipeProfileMode =
  /** 抬手时保持高速，触发游戏的惯性滑行（甩地图） */
  | 'fling'
  /** 抬手前减速静止，位移严格等于拖拽距离（精确落位） */
  | 'precision';

export interface SwipeProfilePoint {
  x: number;
  y: number;
}

export interface SwipeEvent {
  type: 'DOWN' | 'MOVE' | 'UP';
  x: number;
  y: number;
  /** 发出该事件前的设备端 sleep 毫秒；0 = 紧接上一条 */
  sleepMs: number;
}

export interface SwipeProfileInput {
  from: SwipeProfilePoint;
  to: SwipeProfilePoint;
  mode: SwipeProfileMode;
  /** 手指移动的目标总时长 */
  durationMs: number;
  /** MOVE 事件数量，用 pointCountForDistance() 按距离推算 */
  pointCount: number;
  /** 路径偏离直线的幅度上限（垂直方向） */
  curvenessPx: number;
  /** 省略时用 Math.random 取种子；固定它可复现轨迹（测试用） */
  seed?: number;
  /** DOWN 之后、第一个 MOVE 之前的停顿，默认 50-120ms 随机 */
  beginHoldMs?: number;
  /** precision 模式抬手前的静止时长，默认按 duration 推算并钳在 120-250ms */
  endHoldMs?: number;
  /** 每点叠加的垂直微噪声幅度 */
  noisePx?: number;
}

/**
 * 每条 `input` 命令在设备端的固有开销（Java 进程启动 + 事件注入）。
 * 计算 MOVE 间隔时从目标间隔里扣掉它，总时长才接近传入的 durationMs。
 */
export const INPUT_OVERHEAD_MS = 20;

/** MOVE 之间的最小 sleep，避免扣完开销后变成 0 导致事件挤在一帧 */
const MIN_GAP_MS = 3;

/**
 * 单条命令串的长度上限。Windows 下 exec 走 `cmd.exe /c`，硬上限 8191 字符；
 * 留出 adb 前缀和余量。60 点的轨迹约 2.8KB，正常情况远不会触顶。
 */
export const SWIPE_MAX_CMD_CHARS = 7400;

/** 点数上下限：太少不像连续手势，太多徒增命令长度和 input 开销 */
const MIN_POINTS = 24;
const MAX_POINTS = 60;
/** 每多少像素一个 MOVE 点 */
const PX_PER_POINT = 20;

/** 按滑动距离推算 MOVE 点数 */
export function pointCountForDistance(distancePx: number): number {
  const n = Math.round(distancePx / PX_PER_POINT);
  return Math.max(MIN_POINTS, Math.min(MAX_POINTS, n));
}

/**
 * 点数还要受时长约束：每条 `input` 命令在设备端至少花 INPUT_OVERHEAD_MS，
 * N 个事件的时间地板就是 N×overhead。若按距离取的点数超出时长预算，
 * 所有间隔都会被压到 MIN_GAP_MS，实际耗时远超传入的 duration
 * （1280px/500ms 取 60 点时实测要 ~1.4s），调用方的节奏就失真了。
 *
 * 因此取"距离想要的点数"与"时长供得起的点数"的较小值。下限 12 是为了
 * 极短时长下仍保有连续手势的形态（旧分段实现也才 3-5 段）。
 */
export function effectivePointCount(distancePx: number, durationMs: number): number {
  const budget = Math.max(12, Math.floor(durationMs / INPUT_OVERHEAD_MS));
  return Math.min(pointCountForDistance(distancePx), budget);
}

/** mulberry32：小巧的可复现 PRNG，让同 seed 的轨迹完全一致 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 速度剖面：给定归一化时间 u∈[0,1]，返回该刻的相对速度。
 *
 * 两种模式共用"起步加速 + 中段匀速"，区别只在尾段：
 * fling 尾段几乎不减速（抬手瞬间速度高 → 游戏据此计算惯性），
 * precision 尾段降到近零（抬手时速度为 0 → 不触发惯性）。
 */
function speedAt(u: number, mode: SwipeProfileMode): number {
  // 起步：0→0.2 从 0.3 线性加速到 1.0（人不会瞬间到全速）
  if (u < 0.2) return 0.3 + (u / 0.2) * 0.7;

  if (mode === 'fling') {
    // 末段 0.8→1.0 只从 1.0 缓降到 0.9，保住出口速度
    if (u > 0.8) return 1.0 - ((u - 0.8) / 0.2) * 0.1;
    return 1.0;
  }

  // precision：末段 0.75→1.0 从 1.0 减到 0.05
  if (u > 0.75) return 1.0 - ((u - 0.75) / 0.25) * 0.95;
  return 1.0;
}

/**
 * 三次贝塞尔求值。控制点由调用方沿垂直方向偏移生成，
 * 因此曲线在主轴上的投影保持单调（不会走回头路）。
 */
function cubicBezier(
  p0: SwipeProfilePoint,
  c1: SwipeProfilePoint,
  c2: SwipeProfilePoint,
  p3: SwipeProfilePoint,
  t: number
): SwipeProfilePoint {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
  };
}

/**
 * 生成完整事件序列：[DOWN, MOVE×pointCount, UP]。
 *
 * 末个 MOVE 与 UP 的坐标都强制等于 `to`：即使系统合并/丢弃了尾部 MOVE，
 * UP 自带终点坐标，落位不受影响（对 fling 反而形成更大的末段位移）。
 */
export function planSwipeProfile(input: SwipeProfileInput): SwipeEvent[] {
  const {
    from,
    to,
    mode,
    durationMs,
    pointCount,
    curvenessPx,
    seed,
    beginHoldMs,
    endHoldMs,
    noisePx = 1.5,
  } = input;

  const rng = mulberry32(seed ?? Math.floor(Math.random() * 0x7fffffff));

  const n = Math.max(1, Math.round(pointCount));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // 单位垂直向量：曲线偏移和噪声都沿它施加，保证主轴投影单调
  const px = -dy / len;
  const py = dx / len;

  // 控制点在 1/3、2/3 处各偏一个量；60% 同侧（弓形），40% 异侧（S 形）
  const sameSide = rng() < 0.6;
  const mag1 = curvenessPx * (0.55 + 0.45 * rng());
  const mag2 = curvenessPx * (0.55 + 0.45 * rng());
  const dir1 = rng() < 0.5 ? -1 : 1;
  const dir2 = sameSide ? dir1 : -dir1;

  const c1: SwipeProfilePoint = {
    x: from.x + dx * 0.33 + px * mag1 * dir1,
    y: from.y + dy * 0.33 + py * mag1 * dir1,
  };
  const c2: SwipeProfilePoint = {
    x: from.x + dx * 0.66 + px * mag2 * dir2,
    y: from.y + dy * 0.66 + py * mag2 * dir2,
  };

  // 把速度剖面积分成累积距离曲线：q[i] 是第 i 个事件时已走过的路程（未归一化）。
  // 事件在**时间**上等间隔（i/n），位置则按 q 推进——所以速度剖面体现为
  // 点距的疏密：慢的地方点挨得近，快的地方点拉得开。
  // 注意别把 q 同时当成时间进度，那样位置和时间同步推进，速度就成了恒定值。
  const q: number[] = [0];
  for (let i = 1; i <= n; i++) {
    const uMid = (i - 0.5) / n;
    q.push(q[i - 1] + speedAt(uMid, mode));
  }
  const qTotal = q[n] || 1;

  // precision 的抬手静止时长从总时长里扣，剩下的才是移动时间
  const endHold =
    mode === 'precision'
      ? Math.round(endHoldMs ?? Math.max(120, Math.min(250, durationMs * 0.25)))
      : Math.round(endHoldMs ?? (15 + rng() * 10)); // fling：抬手前几乎不停
  const beginHold = Math.round(beginHoldMs ?? 50 + rng() * 70);
  const activeMs = Math.max(1, durationMs - (mode === 'precision' ? endHold : 0));

  const events: SwipeEvent[] = [
    { type: 'DOWN', x: Math.round(from.x), y: Math.round(from.y), sleepMs: 0 },
  ];

  let prevTime = 0;
  let prevProj = 0;

  for (let i = 1; i <= n; i++) {
    const t = q[i] / qTotal;
    const pt = cubicBezier(from, c1, c2, to, t);

    let x: number;
    let y: number;
    if (i === n) {
      // 末点精确落在终点，不加噪声
      x = Math.round(to.x);
      y = Math.round(to.y);
    } else {
      // 三角形分布噪声（两次 random 相加），比均匀分布更集中在小幅度
      const noise = (rng() + rng() - 1) * noisePx;
      // 负坐标会让 `input motionevent` 把参数当成选项解析，钳到 0。
      // 正向越界不用管：手指滑出屏幕边缘对拖动是正常行为，事件照常投递。
      x = Math.max(0, Math.round(pt.x + px * noise));
      y = Math.max(0, Math.round(pt.y + py * noise));
    }

    // 单调性兜底：垂直偏移理论上不影响主轴投影，浮点+取整仍可能让相邻点持平回退
    const proj = ((x - from.x) * dx + (y - from.y) * dy) / len;
    if (proj < prevProj) {
      x = Math.round(from.x + (dx * prevProj) / len);
      y = Math.round(from.y + (dy * prevProj) / len);
    } else {
      prevProj = proj;
    }

    // 事件在时间上等间隔；位置的疏密才是速度剖面
    const targetTime = activeMs * (i / n);
    const gap = targetTime - prevTime;
    prevTime = targetTime;

    const sleepMs =
      i === 1 ? beginHold : Math.max(MIN_GAP_MS, Math.round(gap - INPUT_OVERHEAD_MS));

    events.push({ type: 'MOVE', x, y, sleepMs });
  }

  events.push({
    type: 'UP',
    x: Math.round(to.x),
    y: Math.round(to.y),
    sleepMs: endHold,
  });

  return events;
}

/** 单个事件渲染成 shell 片段 */
function renderEvent(e: SwipeEvent): string {
  const cmd = `input motionevent ${e.type} ${e.x} ${e.y}`;
  return e.sleepMs > 0 ? `sleep ${(e.sleepMs / 1000).toFixed(3)}; ${cmd}` : cmd;
}

/**
 * 把事件序列拼成一条 shell 命令，交给 execShell 一次执行。
 * 格式与 AdbDevice.dragNoFling 一致：`; ` 分隔，时序靠设备端 sleep。
 */
export function joinMotioneventCmd(events: SwipeEvent[]): string {
  return events.map(renderEvent).join('; ');
}

/** 预估命令串长度（与 joinMotioneventCmd 的实际输出等长），供长度守卫和测试用 */
export function estimateCmdChars(events: SwipeEvent[]): number {
  return joinMotioneventCmd(events).length;
}

/**
 * 抬手瞬间的速度（px/s）：取最后一个 MOVE→UP 的位移除以其间隔。
 * 游戏的 VelocityTracker 就是据此判断要不要惯性滑行，测试用它区分两种尾段。
 */
export function exitVelocityPxPerSec(events: SwipeEvent[]): number {
  if (events.length < 2) return 0;
  const up = events[events.length - 1];
  const prev = events[events.length - 2];
  const dist = Math.hypot(up.x - prev.x, up.y - prev.y);
  // UP 与末个 MOVE 同坐标时，用末两个 MOVE 的位移代表出口速度
  if (dist === 0 && events.length >= 3) {
    const prev2 = events[events.length - 3];
    const d2 = Math.hypot(prev.x - prev2.x, prev.y - prev2.y);
    const gapMs = Math.max(1, prev.sleepMs + INPUT_OVERHEAD_MS + up.sleepMs);
    return (d2 / gapMs) * 1000;
  }
  const gapMs = Math.max(1, up.sleepMs + INPUT_OVERHEAD_MS);
  return (dist / gapMs) * 1000;
}
