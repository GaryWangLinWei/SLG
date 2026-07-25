import { isCurrentLoopGeneration } from './loopGeneration';

describe('isCurrentLoopGeneration', () => {
  test('allows cleanup only for the current loop generation', () => {
    expect(isCurrentLoopGeneration(4, 4)).toBe(true);
  });

  test('rejects cleanup from an older loop generation', () => {
    expect(isCurrentLoopGeneration(4, 5)).toBe(false);
  });
});
