import { createLoopCancellationPredicate, guardedCreateTask, isCurrentLoopGeneration } from './loopGeneration';

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

describe('guardedCreateTask', () => {
  test('stops a task returned after its generation was cancelled and never runs it', async () => {
    let resolveCreate!: (value: { success: true; task: { id: string } }) => void;
    const create = jest.fn(() => new Promise<{ success: true; task: { id: string } }>(resolve => {
      resolveCreate = resolve;
    }));
    const stop = jest.fn().mockResolvedValue(undefined);
    const run = jest.fn();
    let cancelled = false;

    const pending = guardedCreateTask(create, stop, () => cancelled)
      .then(result => run(result.task!.id));
    cancelled = true;
    resolveCreate({ success: true, task: { id: 'late-task' } });

    await expect(pending).rejects.toThrow('loop generation cancelled');
    expect(stop).toHaveBeenCalledWith('late-task');
    expect(run).not.toHaveBeenCalled();
  });

  test('does not create a task when already cancelled', async () => {
    const create = jest.fn();
    const stop = jest.fn();

    await expect(guardedCreateTask(create, stop, () => true)).rejects.toThrow('loop generation cancelled');
    expect(create).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
});
