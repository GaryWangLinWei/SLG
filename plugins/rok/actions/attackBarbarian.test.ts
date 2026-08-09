import {
  levelRange,
  fallbackOrderWithinRange,
  pickRandomLevel,
  AttackLevelMode,
} from './attackBarbarian';

describe('levelRange', () => {
  const cases: Array<[number, AttackLevelMode, number[]]> = [
    [10, 'fixed', [10]],
    [10, 'plusMinus1', [9, 10, 11]],
    [10, 'plusMinus2', [8, 9, 10, 11, 12]],
    [1, 'plusMinus1', [1, 2]],          // clamp 下界
    [40, 'plusMinus2', [38, 39, 40]],   // clamp 上界
    [2, 'plusMinus2', [1, 2, 3, 4]],
  ];
  it.each(cases)('目标 %p / %s → %p', (target, mode, expected) => {
    expect(levelRange(target, 40, mode)).toEqual(expected);
  });
});

describe('fallbackOrderWithinRange', () => {
  it('起点 9，范围 9-11：先 9，再 10、11（不越出范围）', () => {
    const range = new Set([9, 10, 11]);
    expect(fallbackOrderWithinRange(9, range)).toEqual([9, 10, 11]);
  });
  it('起点 11，范围 9-11：11,10,9', () => {
    const range = new Set([9, 10, 11]);
    expect(fallbackOrderWithinRange(11, range)).toEqual([11, 10, 9]);
  });
  it('fixed 模式范围只有一个等级', () => {
    const range = new Set([10]);
    expect(fallbackOrderWithinRange(10, range)).toEqual([10]);
  });
  it('±2 范围、起点 8（贴下界）：8 之后按就近，7 不在范围内，所以 9,10,11,12', () => {
    const range = new Set([8, 9, 10, 11, 12]);
    expect(fallbackOrderWithinRange(8, range)).toEqual([8, 9, 10, 11, 12]);
  });
});

describe('pickRandomLevel', () => {
  it('用注入的 rng 选择候选', () => {
    const candidates = [8, 9, 10, 11, 12];
    expect(pickRandomLevel(candidates, () => 0)).toBe(8);
    expect(pickRandomLevel(candidates, () => 0.99)).toBe(12);
    expect(pickRandomLevel(candidates, () => 0.5)).toBe(10);
  });
  it('固定模式候选唯一，必返回该等级', () => {
    expect(pickRandomLevel([10], () => 0.99)).toBe(10);
  });
});
