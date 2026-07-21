import { sharedGemPool } from '../state/sharedGemPool';
import { addCollectedCoord } from './collectSharedGemCoords';

describe('addCollectedCoord', () => {
  beforeEach(() => sharedGemPool.clearAll());

  test('已消耗坐标不计为本页新增', () => {
    const accountId = 'A';
    const coord = { x: 100, y: 200 };
    sharedGemPool.addUnique(accountId, coord);
    sharedGemPool.pop(accountId);

    expect(addCollectedCoord(accountId, coord)).toBe(false);
    expect(sharedGemPool.size(accountId)).toBe(0);
  });
});
