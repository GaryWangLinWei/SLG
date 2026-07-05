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
    expect(step.fromY).toBe(450 + 225);
    expect(step.toY).toBe(450 - 225);

    // 步长升到 2: 左 2 次
    step = s.next()!;
    expect(step.fromX).toBe(800 - 400);
    expect(step.toX).toBe(800 + 400);
    step = s.next()!;
    expect(step.fromX).toBe(800 - 400);

    // 步长仍是 2: 上 2 次
    step = s.next()!;
    expect(step.fromY).toBe(450 - 225);
    step = s.next()!;
    expect(step.fromY).toBe(450 - 225);

    // 步长升到 3: 右 3 次
    step = s.next()!;
    expect(step.fromX).toBe(800 + 400);
  });

  it('name = "spiral"', () => {
    const s = new SpiralStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    expect(s.name).toBe('spiral');
  });
});
