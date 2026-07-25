import { createExclusiveOperation } from './exclusiveOperation';

describe('createExclusiveOperation', () => {
  test('rejects overlapping runs while an operation is pending', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = jest.fn(() => pending);
    const exclusiveOperation = createExclusiveOperation(operation);

    const firstRun = exclusiveOperation.run();
    expect(exclusiveOperation.isLocked()).toBe(true);

    const secondRun = exclusiveOperation.run();
    await expect(secondRun).resolves.toBe(false);
    expect(operation).toHaveBeenCalledTimes(1);

    release();
    await expect(firstRun).resolves.toBe(true);
    expect(exclusiveOperation.isLocked()).toBe(false);
  });

  test('releases the lock when an operation rejects', async () => {
    const error = new Error('operation failed');
    const operation = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);
    const exclusiveOperation = createExclusiveOperation(operation);

    await expect(exclusiveOperation.run()).rejects.toBe(error);
    expect(exclusiveOperation.isLocked()).toBe(false);
    await expect(exclusiveOperation.run()).resolves.toBe(true);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
