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

import { ReverseSpiralStrategy } from './gemSearchStrategies';

describe('ReverseSpiralStrategy', () => {
  it('方向序列 左→下→右→上（逆时针），每 2 次换向后步长 +1', () => {
    const s = new ReverseSpiralStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });

    // 左 1 (dx=-1): fromX = 800 + (-1)*400 = 400, toX = 800 - (-1)*400 = 1200
    let step = s.next()!;
    expect(step.fromX).toBe(400);
    expect(step.toX).toBe(1200);

    // 下 1 (dy=1): fromY = 450 + 225 = 675, toY = 450 - 225 = 225
    step = s.next()!;
    expect(step.fromY).toBe(675);
    expect(step.toY).toBe(225);

    // 右 2 (dx=1): fromX = 800 + 400 = 1200
    step = s.next()!;
    expect(step.fromX).toBe(1200);
    step = s.next()!;
    expect(step.fromX).toBe(1200);

    // 上 2 (dy=-1): fromY = 450 - 225 = 225
    step = s.next()!;
    expect(step.fromY).toBe(225);
    step = s.next()!;
    expect(step.fromY).toBe(225);
  });

  it('name = "reverse-spiral"', () => {
    const s = new ReverseSpiralStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    expect(s.name).toBe('reverse-spiral');
  });
});

import { RandomWalkStrategy } from './gemSearchStrategies';

describe('RandomWalkStrategy', () => {
  it('首步用 Math.random 选 4 方向之一', () => {
    jest.spyOn(Math, 'random').mockReturnValueOnce(0.6);
    const s = new RandomWalkStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    const step = s.next()!;
    expect(step.fromX).toBe(400);
    expect(step.toX).toBe(1200);
    jest.restoreAllMocks();
  });

  it('后续步不选"上一步的反方向"', () => {
    jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.5);
    const s = new RandomWalkStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    s.next();
    const step = s.next()!;
    expect(step.fromY).toBe(675);
    expect(step.toY).toBe(225);
    jest.restoreAllMocks();
  });

  it('name = "random-walk"', () => {
    const s = new RandomWalkStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    expect(s.name).toBe('random-walk');
  });
});

import { SnakeStrategy } from './gemSearchStrategies';

describe('SnakeStrategy', () => {
  it('name = "snake"', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const s = new SnakeStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    expect(s.name).toBe('snake');
    jest.restoreAllMocks();
  });

  it('从右下象限、顺时针开始：第 1 行是右 4 段', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const s = new SnakeStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    for (let i = 0; i < 4; i++) {
      const step = s.next()!;
      expect(step.fromX).toBe(1200);
      expect(step.toX).toBe(400);
      expect(step.fromY).toBe(450);
    }
    jest.restoreAllMocks();
  });

  it('第 1 行 4 段后是纵向 1 格（下）', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const s = new SnakeStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    for (let i = 0; i < 4; i++) s.next();
    const nudge = s.next()!;
    expect(nudge.fromY).toBe(675);
    expect(nudge.toY).toBe(225);
    jest.restoreAllMocks();
  });

  it('第 2 行是左 4 段', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const s = new SnakeStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    for (let i = 0; i < 5; i++) s.next();
    for (let i = 0; i < 4; i++) {
      const step = s.next()!;
      expect(step.fromX).toBe(400);
      expect(step.toX).toBe(1200);
    }
    jest.restoreAllMocks();
  });

  it('4 象限总共 128 步，之后返回 null', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const s = new SnakeStrategy({ centerX: 800, centerY: 450, halfW: 400, halfH: 225 });
    for (let i = 0; i < 128; i++) {
      expect(s.next()).not.toBeNull();
    }
    expect(s.next()).toBeNull();
    jest.restoreAllMocks();
  });
});

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
    jest.spyOn(Math, 'random')
      .mockReturnValueOnce(0.95)
      .mockReturnValue(0);
    expect(pickStrategy(opts).name).toBe('snake');
    jest.restoreAllMocks();
  });
});
