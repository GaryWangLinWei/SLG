import { createLoopCancellationPredicate, isCurrentLoopGeneration } from './loopGeneration';

describe('isCurrentLoopGeneration', () => {
  test('allows cleanup only for the current loop generation', () => {
    expect(isCurrentLoopGeneration(4, 4)).toBe(true);
  });

  test('rejects cleanup from an older loop generation', () => {
    expect(isCurrentLoopGeneration(4, 5)).toBe(false);
  });
});

describe('createLoopCancellationPredicate', () => {
  test('keeps an old generation cancelled after stop and a new start resets the global flag', () => {
    let stopped = false;
    let currentGeneration = 1;
    const oldRunStopped = createLoopCancellationPredicate(
      1,
      () => currentGeneration,
      () => stopped,
    );

    stopped = true;
    currentGeneration = 2;
    stopped = false;

    expect(oldRunStopped()).toBe(true);
  });
});
