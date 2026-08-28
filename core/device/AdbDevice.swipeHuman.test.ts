import { AdbDevice } from './AdbDevice';

/**
 * stub 出一个不碰真实 adb 的设备：
 * execShell 抓连续手势的整串命令，execAdb 抓走 input swipe 的调用。
 */
function stub(opts: { failShell?: boolean } = {}) {
  const dev: any = new AdbDevice('x');
  const shellCmds: string[] = [];
  const adbCmds: string[] = [];

  dev.execShell = async (c: string) => {
    shellCmds.push(c);
    // 只让手势主体失败，兜底补发的 UP 仍需成功
    if (opts.failShell && c.includes('DOWN')) throw new Error('motionevent 不可用');
    return { stdout: '', stderr: '' };
  };
  dev.execAdb = async (c: string) => { adbCmds.push(c); };
  dev.jitterCoord = (v: number) => v; // 去掉抖动才能断言精确坐标

  return { dev, shellCmds, adbCmds };
}

/** 从整串命令里按顺序取出所有 motionevent 事件 */
function events(cmd: string): Array<{ type: string; x: number; y: number }> {
  return [...cmd.matchAll(/motionevent (DOWN|MOVE|UP) (\d+) (\d+)/g)].map(m => ({
    type: m[1],
    x: Number(m[2]),
    y: Number(m[3]),
  }));
}

describe('AdbDevice.swipeHuman - 单次连续手势', () => {
  it('整串命令走一次 execShell，不产生多次 adb 往返', async () => {
    const { dev, shellCmds, adbCmds } = stub();
    await dev.swipeHuman(1300, 700, 300, 200, 500);

    expect(shellCmds).toHaveLength(1);
    expect(adbCmds).toHaveLength(0);
  });

  it('序列恰好一个 DOWN、一个 UP —— 中途不抬手', async () => {
    const { dev, shellCmds } = stub();
    await dev.swipeHuman(1300, 700, 300, 200, 500);
    const evs = events(shellCmds[0]);

    expect(evs.filter(e => e.type === 'DOWN')).toHaveLength(1);
    expect(evs.filter(e => e.type === 'UP')).toHaveLength(1);
    expect(evs[0].type).toBe('DOWN');
    expect(evs[evs.length - 1].type).toBe('UP');
    // 点数受时长预算约束（duration 还带 ±20% 抖动），只断言远多于旧分段的 3-5 段
    expect(evs.filter(e => e.type === 'MOVE').length).toBeGreaterThanOrEqual(12);
  });

  it('时序由设备端 sleep 控制', async () => {
    const { dev, shellCmds } = stub();
    await dev.swipeHuman(1300, 700, 300, 200, 500);
    expect(shellCmds[0]).toMatch(/sleep [\d.]+; input motionevent MOVE/);
  });

  it('起点抖动不影响位移（终点按位移推算，不是各自抖）', async () => {
    const { dev, shellCmds } = stub();
    // 放开起点抖动，同时关掉位移抖动，单独验证这个机制
    dev.jitterCoord = (v: number) => v + 5;
    await dev.swipeHuman(1300, 700, 300, 200, 500, 'fling', 1, 0);
    const evs = events(shellCmds[0]);
    const down = evs[0];
    const up = evs[evs.length - 1];

    expect(down).toMatchObject({ x: 1305, y: 705 }); // 起点整体平移了
    expect(down.x - up.x).toBe(1000);                // 位移不受影响
    expect(down.y - up.y).toBe(500);
  });

  it('位移沿滑动方向抖动：距离有波动，方向不歪', async () => {
    const dys: number[] = [];
    const dxs: number[] = [];
    for (let i = 0; i < 200; i++) {
      const { dev, shellCmds } = stub();
      await dev.swipeHuman(850, 225, 850, 675, 500); // 竖直滑动，dy=450
      const evs = events(shellCmds[0]);
      const down = evs[0];
      const up = evs[evs.length - 1];
      dys.push(up.y - down.y);
      dxs.push(up.x - down.x);
    }
    // 距离有波动
    expect(new Set(dys).size).toBeGreaterThan(3);
    // 但仍在 ±2% 附近（450 * 0.02 = 9px）
    expect(Math.min(...dys)).toBeGreaterThanOrEqual(450 - 10);
    expect(Math.max(...dys)).toBeLessThanOrEqual(450 + 10);
    // 竖直滑动的横向位移恒为 0——方向没被抖歪
    expect(new Set(dxs)).toEqual(new Set([0]));
  });

  it('distJitter=0 时位移严格等于传入值', async () => {
    const dys = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const { dev, shellCmds } = stub();
      await dev.swipeHuman(850, 225, 850, 675, 500, 'fling', 1, 0);
      const evs = events(shellCmds[0]);
      dys.add(evs[evs.length - 1].y - evs[0].y);
    }
    expect(dys).toEqual(new Set([450]));
  });

  it('distJitter 越大波动越大', async () => {
    const spread = async (distJitter: number) => {
      const dys: number[] = [];
      for (let i = 0; i < 200; i++) {
        const { dev, shellCmds } = stub();
        await dev.swipeHuman(850, 225, 850, 675, 500, 'fling', 1, distJitter);
        const evs = events(shellCmds[0]);
        dys.push(evs[evs.length - 1].y - evs[0].y);
      }
      return Math.max(...dys) - Math.min(...dys);
    };
    expect(await spread(0.1)).toBeGreaterThan(await spread(0.01));
  });

  it('水平滑动的位移抖动同样不歪斜', async () => {
    const { dev, shellCmds } = stub();
    await dev.swipeHuman(1200, 450, 400, 450, 500);
    const evs = events(shellCmds[0]);
    // 纵向位移恒为 0
    expect(evs[evs.length - 1].y - evs[0].y).toBe(0);
  });

  it('随机化关闭时位移不抖', async () => {
    const dys = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const { dev, shellCmds } = stub();
      dev.setRandomizationEnabled(false);
      await dev.swipeHuman(850, 225, 850, 675, 500);
      const evs = events(shellCmds[0]);
      dys.add(evs[evs.length - 1].y - evs[0].y);
    }
    expect(dys).toEqual(new Set([450]));
  });

  it('轨迹是曲线：水平滑动时 y 不恒定', async () => {
    const { dev, shellCmds } = stub();
    await dev.swipeHuman(1300, 700, 300, 700, 500);
    const ys = events(shellCmds[0]).map(e => e.y);

    expect(new Set(ys).size).toBeGreaterThan(1);
  });

  it('curveScale=0 得到直线', async () => {
    const { dev, shellCmds } = stub();
    await dev.swipeHuman(1300, 700, 300, 700, 500, 'fling', 0);
    const ys = events(shellCmds[0]).map(e => e.y);

    expect(new Set(ys).size).toBe(1);
  });

  it('curveScale 越大偏离越远', async () => {
    const perpMax = async (curveScale: number) => {
      const { dev, shellCmds } = stub();
      await dev.swipeHuman(1300, 700, 300, 700, 500, 'fling', curveScale);
      return Math.max(...events(shellCmds[0]).map(e => Math.abs(e.y - 700)));
    };
    expect(await perpMax(2)).toBeGreaterThan(await perpMax(0.5));
  });

  it('命令串长度在安全范围内', async () => {
    const { dev, shellCmds } = stub();
    await dev.swipeHuman(1599, 899, 100, 100, 2000);
    expect(shellCmds[0].length).toBeLessThan(7400);
  });
});

describe('AdbDevice.swipeHuman - 模式', () => {
  it("默认 fling：抬手前几乎不停顿，保住出口速度", async () => {
    const { dev, shellCmds } = stub();
    await dev.swipeHuman(1300, 700, 300, 200, 500);

    const tail = shellCmds[0].match(/sleep ([\d.]+); input motionevent UP/);
    if (tail) expect(Number(tail[1])).toBeLessThanOrEqual(0.025);
  });

  it("precision：抬手前静止 ≥120ms，压掉惯性", async () => {
    const { dev, shellCmds } = stub();
    await dev.swipeHuman(1300, 700, 300, 200, 500, 'precision');

    const tail = shellCmds[0].match(/sleep ([\d.]+); input motionevent UP/);
    expect(tail).not.toBeNull();
    expect(Number(tail![1])).toBeGreaterThanOrEqual(0.12);
  });

  it('两种模式的终点都精确落在目标（关掉位移抖动时）', async () => {
    for (const mode of ['fling', 'precision'] as const) {
      const { dev, shellCmds } = stub();
      await dev.swipeHuman(1300, 700, 300, 200, 500, mode, 1, 0);
      const evs = events(shellCmds[0]);
      expect(evs[evs.length - 1]).toMatchObject({ x: 300, y: 200 });
    }
  });

  it('位移抖动开启时，末个 MOVE 与 UP 仍落在同一点', async () => {
    for (const mode of ['fling', 'precision'] as const) {
      const { dev, shellCmds } = stub();
      await dev.swipeHuman(1300, 700, 300, 200, 500, mode);
      const evs = events(shellCmds[0]);
      const up = evs[evs.length - 1];
      const lastMove = evs[evs.length - 2];
      expect(lastMove).toMatchObject({ x: up.x, y: up.y });
    }
  });
});

describe('AdbDevice.swipeHuman - 失败处理', () => {
  it('失败时补发 UP 防手指卡住，并把错误抛给调用方', async () => {
    const { dev, shellCmds, adbCmds } = stub({ failShell: true });

    await expect(dev.swipeHuman(1300, 700, 300, 200, 500)).rejects.toThrow('motionevent 不可用');

    expect(shellCmds).toHaveLength(2);
    // 补发的 UP 必须落在手势自己的终点上（位移带抖动，不能写死坐标）
    const gestureEnd = events(shellCmds[0]).slice(-1)[0];
    expect(shellCmds[1]).toBe(`input motionevent UP ${gestureEnd.x} ${gestureEnd.y}`);
    // 不静默退回分段实现——那是 swipe() 的行为，这里要让调用方知道
    expect(adbCmds).toHaveLength(0);
  });
});

describe('AdbDevice.swipe - 保持原样', () => {
  it('未受新方法影响：仍走 execAdb 的分段 input swipe', async () => {
    const { dev, shellCmds, adbCmds } = stub();
    await dev.swipe(1300, 700, 300, 200, 500);

    expect(shellCmds).toHaveLength(0);
    expect(adbCmds.length).toBeGreaterThanOrEqual(3); // 3-5 段
    expect(adbCmds.every(c => c.includes('input swipe'))).toBe(true);
  });

  it('随机化关闭时仍是单条 input swipe', async () => {
    const { dev, adbCmds } = stub();
    dev.setRandomizationEnabled(false);
    await dev.swipe(1300, 700, 300, 200, 500);

    expect(adbCmds).toHaveLength(1);
    expect(adbCmds[0]).toContain('input swipe 1300 700 300 200 500');
  });
});
