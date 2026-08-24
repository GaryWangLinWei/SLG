import { AdbDevice } from './AdbDevice';

/** 抓出整串命令里所有 motionevent 的 y 坐标，按发出顺序排列 */
function eventYs(cmd: string): number[] {
  return [...cmd.matchAll(/motionevent (?:DOWN|MOVE|UP) \d+ (\d+)/g)].map(m => Number(m[1]));
}

function stub() {
  const dev: any = new AdbDevice('x');
  let cmd = '';
  dev.execShell = async (c: string) => { cmd = c; return { stdout: '', stderr: '' }; };
  dev.jitterCoord = (v: number) => v; // 去掉随机抖动，才能断言精确坐标
  return { dev, read: () => cmd };
}

describe('AdbDevice.dragNoFling', () => {
  it('slop 引导段不计入测量位移', async () => {
    const { dev, read } = stub();
    await dev.dragNoFling(800, 700, 800, 196, 500, 500, 8, 70);
    const ys = eventYs(read());

    expect(ys[0]).toBe(700);        // DOWN
    expect(ys[1]).toBe(630);        // 引导段，被列表吞掉
    expect(ys[ys.length - 1]).toBe(126); // UP
    // 引导段终点 -> 终点 = 严格 504，与 slopPx、步数无关
    expect(ys[1] - ys[ys.length - 1]).toBe(504);
  });

  it('slopPx 为 0 时不发引导段，位移仍严格等于拖拽距离', async () => {
    const { dev, read } = stub();
    await dev.dragNoFling(800, 700, 800, 196, 500, 0, 8, 0);
    const ys = eventYs(read());

    expect(ys[0]).toBe(700);
    expect(ys[1]).toBe(637);        // 直接进入第一步，无引导
    expect(ys[0] - ys[ys.length - 1]).toBe(504);
  });

  it('路径为直线：所有事件 x 相同', async () => {
    const { dev, read } = stub();
    await dev.dragNoFling(800, 700, 800, 196, 500, 500, 8, 70);
    const xs = [...read().matchAll(/motionevent (?:DOWN|MOVE|UP) (\d+) \d+/g)].map(m => Number(m[1]));
    expect(new Set(xs).size).toBe(1);
  });

  it('moveMs 摊成等间隔停顿插在每步 MOVE 前', async () => {
    const { dev, read } = stub();
    await dev.dragNoFling(800, 700, 800, 196, 500, 500, 8, 70);
    const gaps = [...read().matchAll(/sleep ([\d.]+); input motionevent MOVE/g)].map(m => Number(m[1]));
    expect(gaps).toHaveLength(8);              // 引导段不带停顿
    expect(gaps.every(g => g === 0.063)).toBe(true); // 500ms / 8
  });

  it('抬手前静止 holdMs', async () => {
    const { dev, read } = stub();
    await dev.dragNoFling(800, 700, 800, 196, 500, 500, 8, 70);
    expect(read()).toMatch(/sleep 0\.50; input motionevent UP/);
  });
});
