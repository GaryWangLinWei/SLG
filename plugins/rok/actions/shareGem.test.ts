import { formatCoordForLog, shouldClickVerifiedGem, pickNearestToHome } from './gatherGem';
import * as shareGemModule from './shareGem';
import { sharedGemPool } from '../state/sharedGemPool';

describe('组合采集宝石确认流程', () => {
  beforeEach(() => sharedGemPool.clearAll());

  test('skipVerifiedGemClick 开启时二次确认后不点击宝石', () => {
    expect(shouldClickVerifiedGem({ skipVerifiedGemClick: true })).toBe(false);
  });

  test('坐标日志使用 x/y 标签而不是连续数字串', () => {
    expect(formatCoordForLog('X:1027 Y:329')).toBe('x: 1027 y: 329');
  });

  test('将 OCR 紧凑数字坐标按消费端一致规则切分：7 位按 x3+y4', () => {
    expect(formatCoordForLog('1050345')).toBe('x: 105 y: 345');
    expect(formatCoordForLog('2791605')).toBe('x: 279 y: 1605');
  });

  test('组合模式可把小号坐标写入跨账号共享池', () => {
    const addToPool = shareGemModule.addSharedGemCoordToPool as (
      accountId: string,
      coordText: string,
      poolAccountId?: string
    ) => Array<{ x: number; y: number }>;

    expect(addToPool('small-account', 'X:1027 Y:329', 'combo-gem')).toEqual([{ x: 1027, y: 329 }]);
    expect(sharedGemPool.snapshot('combo-gem')).toEqual([{ x: 1027, y: 329 }]);
    expect(sharedGemPool.snapshot('small-account')).toEqual([]);
  });

  test('组合模式可把 OCR 紧凑数字坐标写入共享池', () => {
    expect(shareGemModule.addSharedGemCoordToPool('small-account', '976302', 'combo-gem')).toEqual([{ x: 976, y: 302 }]);
    expect(sharedGemPool.snapshot('combo-gem')).toEqual([{ x: 976, y: 302 }]);
  });

  test('组合模式回归：7 位紧凑坐标的 3+4 与 4+3 两个候选都写入共享池，交由消费端验证', () => {
    expect(shareGemModule.addSharedGemCoordToPool('small-account', '2791605', 'combo-gem')).toEqual([
      { x: 279, y: 1605 },
      { x: 2791, y: 605 },
    ]);
    expect(sharedGemPool.snapshot('combo-gem')).toEqual([
      { x: 279, y: 1605 },
      { x: 2791, y: 605 },
    ]);
  });

  test('带标签的坐标只写入一个精确候选', () => {
    expect(shareGemModule.addSharedGemCoordToPool('small-account', 'X:279 Y:1605', 'combo-gem')).toEqual([{ x: 279, y: 1605 }]);
    expect(sharedGemPool.snapshot('combo-gem')).toEqual([{ x: 279, y: 1605 }]);
  });

  test('提供主城堡坐标时，纯数字歧义只写入离主城堡更近的候选', () => {
    const addToPool = shareGemModule.addSharedGemCoordToPool as (
      accountId: string,
      coordText: string,
      poolAccountId?: string,
      homeCoord?: { x: number; y: number }
    ) => Array<{ x: number; y: number }>;
    expect(addToPool('small-account', '2791605', 'combo-gem', { x: 500, y: 1000 })).toEqual([{ x: 279, y: 1605 }]);
    expect(sharedGemPool.snapshot('combo-gem')).toEqual([{ x: 279, y: 1605 }]);
  });

  test('主城堡坐标使 4+3 候选更近时，写入 4+3 候选', () => {
    const addToPool = shareGemModule.addSharedGemCoordToPool as (
      accountId: string,
      coordText: string,
      poolAccountId?: string,
      homeCoord?: { x: number; y: number }
    ) => Array<{ x: number; y: number }>;
    expect(addToPool('small-account', '2791605', 'combo-gem', { x: 2790, y: 600 })).toEqual([{ x: 2791, y: 605 }]);
    expect(sharedGemPool.snapshot('combo-gem')).toEqual([{ x: 2791, y: 605 }]);
  });

  test('pickNearestToHome 按欧氏距离选择最近候选', () => {
    expect(pickNearestToHome(
      [{ x: 279, y: 1605 }, { x: 2791, y: 605 }],
      { x: 500, y: 1000 }
    )).toEqual({ x: 279, y: 1605 });
    expect(pickNearestToHome(
      [{ x: 279, y: 1605 }, { x: 2791, y: 605 }],
      { x: 2790, y: 600 }
    )).toEqual({ x: 2791, y: 605 });
  });
});
