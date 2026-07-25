import { formatCoordForLog, shouldClickVerifiedGem } from './gatherGem';
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

  test('将 OCR 紧凑数字坐标按四位 X 和剩余 Y 格式化', () => {
    expect(formatCoordForLog('1050345')).toBe('x: 1050 y: 345');
  });

  test('组合模式可把小号坐标写入跨账号共享池', () => {
    const addToPool = shareGemModule.addSharedGemCoordToPool as (
      accountId: string,
      coordText: string,
      poolAccountId?: string
    ) => boolean;

    expect(addToPool('small-account', 'X:1027 Y:329', 'combo-gem')).toBe(true);
    expect(sharedGemPool.snapshot('combo-gem')).toEqual([{ x: 1027, y: 329 }]);
    expect(sharedGemPool.snapshot('small-account')).toEqual([]);
  });

  test('组合模式可把 OCR 紧凑数字坐标写入共享池', () => {
    expect(shareGemModule.addSharedGemCoordToPool('small-account', '976302', 'combo-gem')).toBe(true);
    expect(sharedGemPool.snapshot('combo-gem')).toEqual([{ x: 976, y: 302 }]);
  });
});
