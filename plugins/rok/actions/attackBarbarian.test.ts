import { neighborLevelOrder } from './attackBarbarian';

describe('neighborLevelOrder', () => {
  it('目标 10 → 9,11,8,12', () => {
    expect(neighborLevelOrder(10, 40)).toEqual([9, 11, 8, 12]);
  });
  it('目标 2 → 1,3,4（去掉越界的 0）', () => {
    expect(neighborLevelOrder(2, 40)).toEqual([1, 3, 4]);
  });
  it('目标 1 → 2,3', () => {
    expect(neighborLevelOrder(1, 40)).toEqual([2, 3]);
  });
  it('目标 40 → 39,38（去掉 41,42）', () => {
    expect(neighborLevelOrder(40, 40)).toEqual([39, 38]);
  });
  it('目标 39 → 38,40,37（去掉 41）', () => {
    expect(neighborLevelOrder(39, 40)).toEqual([38, 40, 37]);
  });
});
