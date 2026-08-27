import {
  planSwipeProfile,
  joinMotioneventCmd,
  estimateCmdChars,
  exitVelocityPxPerSec,
  pointCountForDistance,
  effectivePointCount,
  SWIPE_MAX_CMD_CHARS,
  SwipeEvent,
} from './swipeProfile';

/** 默认参数下生成一条轨迹，seed 固定保证可复现 */
function plan(over: Partial<Parameters<typeof planSwipeProfile>[0]> = {}): SwipeEvent[] {
  return planSwipeProfile({
    from: { x: 1300, y: 700 },
    to: { x: 300, y: 200 },
    mode: 'fling',
    durationMs: 500,
    pointCount: 30,
    curvenessPx: 40,
    seed: 12345,
    ...over,
  });
}

/** 事件序列的总时长（含各事件前的 sleep，不含 input 进程开销） */
function totalSleepMs(events: SwipeEvent[]): number {
  return events.reduce((sum, e) => sum + e.sleepMs, 0);
}

describe('planSwipeProfile - 序列结构', () => {
  it('生成 [DOWN, MOVE×N, UP]，首事件无 sleep', () => {
    const events = plan({ pointCount: 30 });
    expect(events).toHaveLength(32); // DOWN + 30 MOVE + UP
    expect(events[0].type).toBe('DOWN');
    expect(events[0].sleepMs).toBe(0);
    expect(events[events.length - 1].type).toBe('UP');
    expect(events.filter(e => e.type === 'MOVE')).toHaveLength(30);
    // 恰好一个 DOWN、一个 UP —— 中途抬手就会断成多手势
    expect(events.filter(e => e.type === 'DOWN')).toHaveLength(1);
    expect(events.filter(e => e.type === 'UP')).toHaveLength(1);
  });

  it('起点等于 from，终点与 UP 精确等于 to', () => {
    const events = plan({ from: { x: 1300, y: 700 }, to: { x: 300, y: 200 } });
    expect(events[0]).toMatchObject({ x: 1300, y: 700 });

    const last = events[events.length - 1];
    const lastMove = events[events.length - 2];
    expect(last).toMatchObject({ x: 300, y: 200 });
    expect(lastMove).toMatchObject({ x: 300, y: 200 });
  });

  it('DOWN 之后停顿 50-120ms 再发第一个 MOVE（人的反应时间）', () => {
    for (const seed of [1, 7, 99, 12345, 777777]) {
      const firstMove = plan({ seed }).find(e => e.type === 'MOVE')!;
      expect(firstMove.sleepMs).toBeGreaterThanOrEqual(50);
      expect(firstMove.sleepMs).toBeLessThanOrEqual(120);
    }
  });

  it('所有 sleep 非负，MOVE 间隔有下限（不塞出负数或 0 间隔）', () => {
    const events = plan({ durationMs: 120, pointCount: 60 }); // 极端：时长紧、点数多
    expect(events.every(e => e.sleepMs >= 0)).toBe(true);
    const moves = events.filter(e => e.type === 'MOVE').slice(1); // 首 MOVE 是起手停顿
    expect(moves.every(e => e.sleepMs >= 3)).toBe(true);
  });

  it('总时长与 durationMs 同量级（起手停顿之外不失控）', () => {
    const events = plan({ durationMs: 500, pointCount: 30 });
    const total = totalSleepMs(events);
    // 设备端 sleep 总量 = duration 扣掉每条 input 的进程开销，再加起手停顿；
    // 只断言量级，避免把开销补偿的实现细节钉死
    expect(total).toBeGreaterThan(100);
    expect(total).toBeLessThan(700);
  });
});

describe('planSwipeProfile - 轨迹形状', () => {
  it('主轴投影单调递进，不出现回退', () => {
    for (const seed of [1, 42, 2024, 55555]) {
      const events = plan({ seed });
      // 主轴 = from→to 方向的单位向量投影
      const dx = 300 - 1300;
      const dy = 200 - 700;
      const len = Math.hypot(dx, dy);
      const proj = events.map(e => ((e.x - 1300) * dx + (e.y - 700) * dy) / len);
      for (let i = 1; i < proj.length; i++) {
        expect(proj[i]).toBeGreaterThanOrEqual(proj[i - 1] - 1e-9);
      }
    }
  });

  it('路径偏离直线（曲线化），偏移量受 curvenessPx 约束', () => {
    const events = plan({ curvenessPx: 40, seed: 2024 });
    const dx = 300 - 1300;
    const dy = 200 - 700;
    const len = Math.hypot(dx, dy);
    // 每点到 from→to 直线的垂直距离
    const perp = events.map(e => Math.abs((e.x - 1300) * dy - (e.y - 700) * dx) / len);
    const maxPerp = Math.max(...perp);

    expect(maxPerp).toBeGreaterThan(5);   // 确实不是直线
    expect(maxPerp).toBeLessThan(40 * 1.6); // 不超过 curveness 的合理放大
  });

  it('curvenessPx 越大偏离越远', () => {
    const perpMax = (curvenessPx: number) => {
      const events = plan({ curvenessPx, seed: 888 });
      const dx = 300 - 1300, dy = 200 - 700;
      const len = Math.hypot(dx, dy);
      return Math.max(...events.map(e => Math.abs((e.x - 1300) * dy - (e.y - 700) * dx) / len));
    };
    expect(perpMax(60)).toBeGreaterThan(perpMax(15));
  });

  it('坐标全为整数（motionevent 不接受小数）', () => {
    const events = plan();
    expect(events.every(e => Number.isInteger(e.x) && Number.isInteger(e.y))).toBe(true);
  });

  it('坐标非负：负数会被 input motionevent 当成选项解析', () => {
    // 贴着左上角的滑动，曲线偏移方向可能把中间点推到负值
    for (const seed of [1, 2, 3, 17, 404, 9999]) {
      const events = planSwipeProfile({
        from: { x: 5, y: 6 },
        to: { x: 600, y: 8 },
        mode: 'fling',
        durationMs: 500,
        pointCount: 30,
        curvenessPx: 50,
        seed,
      });
      expect(events.every(e => e.x >= 0 && e.y >= 0)).toBe(true);
    }
  });
});

describe('planSwipeProfile - fling 尾', () => {
  it('抬手前几乎不停顿，出口速度足以触发惯性', () => {
    for (const seed of [3, 31, 999, 12345]) {
      const events = plan({ mode: 'fling', seed });
      const up = events[events.length - 1];
      expect(up.sleepMs).toBeLessThanOrEqual(25);
      expect(exitVelocityPxPerSec(events)).toBeGreaterThan(400);
    }
  });

  it('末段仍在高速移动：最后 20% 事件承担显著位移', () => {
    const events = plan({ mode: 'fling', pointCount: 30, seed: 12345 });
    const moves = events.filter(e => e.type !== 'DOWN');
    const tailStart = Math.floor(moves.length * 0.8);
    let tailDist = 0;
    for (let i = tailStart + 1; i < moves.length; i++) {
      tailDist += Math.hypot(moves[i].x - moves[i - 1].x, moves[i].y - moves[i - 1].y);
    }
    const totalDist = Math.hypot(300 - 1300, 200 - 700);
    // 匀速时末 20% 恰好占 20%；fling 尾不减速，应接近或超过该比例
    expect(tailDist / totalDist).toBeGreaterThan(0.12);
  });
});

describe('planSwipeProfile - precision 尾', () => {
  it('抬手前静止 120-250ms，压掉惯性', () => {
    for (const seed of [3, 31, 999, 12345]) {
      const events = plan({ mode: 'precision', seed });
      const up = events[events.length - 1];
      expect(up.sleepMs).toBeGreaterThanOrEqual(120);
      expect(up.sleepMs).toBeLessThanOrEqual(250);
    }
  });

  it('出口速度远低于 fling', () => {
    const f = exitVelocityPxPerSec(plan({ mode: 'fling', seed: 4242 }));
    const p = exitVelocityPxPerSec(plan({ mode: 'precision', seed: 4242 }));
    expect(p).toBeLessThan(f / 2);
  });

  it('末段减速：最后 20% 事件位移明显小于 fling', () => {
    const tailDist = (mode: 'fling' | 'precision') => {
      const moves = plan({ mode, pointCount: 30, seed: 12345 }).filter(e => e.type !== 'DOWN');
      const tailStart = Math.floor(moves.length * 0.8);
      let d = 0;
      for (let i = tailStart + 1; i < moves.length; i++) {
        d += Math.hypot(moves[i].x - moves[i - 1].x, moves[i].y - moves[i - 1].y);
      }
      return d;
    };
    expect(tailDist('precision')).toBeLessThan(tailDist('fling'));
  });

  it('终点依然精确（减速不牺牲落位）', () => {
    const events = plan({ mode: 'precision', to: { x: 300, y: 200 } });
    expect(events[events.length - 1]).toMatchObject({ x: 300, y: 200 });
  });
});

describe('planSwipeProfile - 速度剖面确实生效', () => {
  /** 逐事件速度：位移 / (该事件前的 sleep + input 固有开销) */
  function speeds(events: SwipeEvent[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < events.length; i++) {
      const d = Math.hypot(events[i].x - events[i - 1].x, events[i].y - events[i - 1].y);
      out.push(d / (events[i].sleepMs + 20));
    }
    return out;
  }

  it('不是匀速：速度有明显起伏（曾因位置与时间同步推进而退化成恒速）', () => {
    const s = speeds(plan({ mode: 'fling', durationMs: 1200, pointCount: 30, seed: 7 }));
    const mid = s.slice(2, -2); // 掐掉起手停顿和抬手那两端
    expect(Math.max(...mid) / Math.min(...mid)).toBeGreaterThan(1.5);
  });

  it('fling：起步慢、中段快，末段不减速', () => {
    const s = speeds(plan({ mode: 'fling', durationMs: 1200, pointCount: 30, seed: 7 }));
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const start = avg(s.slice(1, 5));      // 跳过第一个（含起手停顿）
    const middle = avg(s.slice(12, 18));
    const end = avg(s.slice(-4, -1));

    expect(start).toBeLessThan(middle);          // 起步加速
    expect(end).toBeGreaterThan(middle * 0.7);   // 末段仍在高速
  });

  it('precision：末段速度明显低于中段', () => {
    const s = speeds(plan({ mode: 'precision', durationMs: 1200, pointCount: 30, seed: 7 }));
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const middle = avg(s.slice(12, 18));
    const end = avg(s.slice(-4, -1));

    expect(end).toBeLessThan(middle * 0.5);
  });

  it('时长充裕时 MOVE 间隔不被压到下限（剖面才有表达空间）', () => {
    const events = plan({ durationMs: 1200, pointCount: 24 });
    const gaps = events.filter(e => e.type === 'MOVE').slice(1).map(e => e.sleepMs);
    expect(Math.min(...gaps)).toBeGreaterThan(3);
  });
});

describe('pointCountForDistance', () => {
  it('按距离自适应，钳在 24-60', () => {
    expect(pointCountForDistance(1280)).toBe(60); // 城寨螺旋，撞上限
    expect(pointCountForDistance(1120)).toBe(56); // 宝石螺旋
    expect(pointCountForDistance(790)).toBe(40);  // 科技翻页
    expect(pointCountForDistance(504)).toBe(25);  // 队列面板
    expect(pointCountForDistance(60)).toBe(24);   // 短滑动撞下限
  });
});

describe('effectivePointCount', () => {
  it('时长供不起时按时长预算削减点数', () => {
    // 1280px 想要 60 点，但 500ms 只够 25 点（每条 input 约 20ms）
    expect(effectivePointCount(1280, 500)).toBe(25);
  });

  it('时长充裕时保留按距离推算的点数', () => {
    expect(effectivePointCount(790, 850)).toBe(40);   // 42 点预算 > 40
    expect(effectivePointCount(546, 1000)).toBe(27);  // 50 点预算 > 27
  });

  it('极短时长仍保底 12 点（旧分段实现才 3-5 段）', () => {
    expect(effectivePointCount(1280, 100)).toBe(12);
  });

  it('削减后实际耗时回到 duration 量级', () => {
    const n = effectivePointCount(1280, 500);
    const events = planSwipeProfile({
      from: { x: 1440, y: 450 },
      to: { x: 160, y: 450 },
      mode: 'fling',
      durationMs: 500,
      pointCount: n,
      curvenessPx: 50,
      seed: 7,
    });
    // 设备端 sleep 总量 + 每条 input 的固有开销 ≈ duration（放宽到 2 倍以内）
    const sleepMs = events.reduce((s, e) => s + e.sleepMs, 0);
    const realMs = sleepMs + events.length * 20;
    expect(realMs).toBeLessThan(500 * 2);
  });
});

describe('joinMotioneventCmd', () => {
  it('拼成单条 shell 命令，格式与 dragNoFling 一致', () => {
    const cmd = joinMotioneventCmd(plan({ pointCount: 24 }));
    expect(cmd).toMatch(/^input motionevent DOWN \d+ \d+/);
    expect(cmd).toMatch(/sleep [\d.]+; input motionevent MOVE \d+ \d+/);
    expect(cmd).toMatch(/input motionevent UP \d+ \d+$/);
    // 整串是一次 shell 调用：靠 '; ' 串起来，中途没有 adb 往返
    expect(cmd.split('; input motionevent').length - 1).toBe(25); // 24 MOVE + 1 UP
  });

  it('sleep 为 0 的事件不产生 sleep 前缀', () => {
    const cmd = joinMotioneventCmd([
      { type: 'DOWN', x: 100, y: 100, sleepMs: 0 },
      { type: 'MOVE', x: 200, y: 150, sleepMs: 0 },
      { type: 'UP', x: 200, y: 150, sleepMs: 20 },
    ]);
    expect(cmd).toBe('input motionevent DOWN 100 100; input motionevent MOVE 200 150; sleep 0.020; input motionevent UP 200 150');
  });

  it('最大点数 + 四位坐标时命令串仍在安全长度内', () => {
    const events = planSwipeProfile({
      from: { x: 1599, y: 899 },
      to: { x: 1000, y: 100 },
      mode: 'fling',
      durationMs: 1000,
      pointCount: 60,
      curvenessPx: 60,
      seed: 1,
    });
    const cmd = joinMotioneventCmd(events);
    expect(cmd.length).toBeLessThan(SWIPE_MAX_CMD_CHARS);
    expect(estimateCmdChars(events)).toBe(cmd.length);
  });
});

describe('确定性', () => {
  it('同 seed 完全一致', () => {
    expect(plan({ seed: 4242 })).toEqual(plan({ seed: 4242 }));
  });

  it('不同 seed 轨迹不同', () => {
    expect(plan({ seed: 1 })).not.toEqual(plan({ seed: 2 }));
  });

  it('不传 seed 时仍生成合法轨迹', () => {
    const events = planSwipeProfile({
      from: { x: 800, y: 700 },
      to: { x: 800, y: 200 },
      mode: 'fling',
      durationMs: 500,
      pointCount: 24,
      curvenessPx: 25,
    });
    expect(events[0].type).toBe('DOWN');
    expect(events[events.length - 1]).toMatchObject({ type: 'UP', x: 800, y: 200 });
  });
});
