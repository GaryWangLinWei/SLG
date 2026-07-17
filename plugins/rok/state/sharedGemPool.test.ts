import { sharedGemPool } from './sharedGemPool';

describe('sharedGemPool', () => {
  beforeEach(() => sharedGemPool.clearAll());

  test('addUnique 去重', () => {
    expect(sharedGemPool.addUnique('A', { x: 100, y: 200 })).toBe(true);
    expect(sharedGemPool.addUnique('A', { x: 100, y: 200 })).toBe(false);
    expect(sharedGemPool.size('A')).toBe(1);
  });

  test('账号隔离', () => {
    sharedGemPool.addUnique('A', { x: 1, y: 2 });
    sharedGemPool.addUnique('B', { x: 3, y: 4 });
    expect(sharedGemPool.size('A')).toBe(1);
    expect(sharedGemPool.size('B')).toBe(1);
    expect(sharedGemPool.has('A', { x: 3, y: 4 })).toBe(false);
  });

  test('pop 出队', () => {
    sharedGemPool.addUnique('A', { x: 1, y: 2 });
    sharedGemPool.addUnique('A', { x: 3, y: 4 });
    expect(sharedGemPool.pop('A')).toEqual({ x: 1, y: 2 });
    expect(sharedGemPool.size('A')).toBe(1);
    expect(sharedGemPool.pop('A')).toEqual({ x: 3, y: 4 });
    expect(sharedGemPool.pop('A')).toBeUndefined();
  });

  test('clearAll / clear', () => {
    sharedGemPool.addUnique('A', { x: 1, y: 2 });
    sharedGemPool.addUnique('B', { x: 3, y: 4 });
    sharedGemPool.clear('A');
    expect(sharedGemPool.size('A')).toBe(0);
    expect(sharedGemPool.size('B')).toBe(1);
    sharedGemPool.clearAll();
    expect(sharedGemPool.size('B')).toBe(0);
  });
});
