import { persistRunningIntent, readRunningIntent } from './runningIntent';

describe('readRunningIntent', () => {
  test('reads the Electron session intent when the API is available', async () => {
    const getRunningIntent = jest.fn().mockResolvedValue(true);

    await expect(readRunningIntent(true, getRunningIntent, false)).resolves.toBe(true);
    expect(getRunningIntent).toHaveBeenCalledTimes(1);
  });

  test('rejects when Electron does not expose the running intent API', async () => {
    await expect(readRunningIntent(true, undefined, false)).rejects.toThrow(
      'Electron 运行状态 API 不可用',
    );
  });

  test('uses the browser fallback outside Electron', async () => {
    const getRunningIntent = jest.fn().mockResolvedValue(false);

    await expect(readRunningIntent(false, getRunningIntent, true)).resolves.toBe(true);
    expect(getRunningIntent).not.toHaveBeenCalled();
  });

  test('propagates Electron read failures', async () => {
    const error = new Error('IPC unavailable');
    const getRunningIntent = jest.fn().mockRejectedValue(error);

    await expect(readRunningIntent(true, getRunningIntent, false)).rejects.toBe(error);
  });
});

describe('persistRunningIntent', () => {
  test('persists and returns the requested Electron intent', async () => {
    const setRunningIntent = jest.fn().mockResolvedValue(true);

    await expect(persistRunningIntent(true, setRunningIntent, true)).resolves.toBe(true);
    expect(setRunningIntent).toHaveBeenCalledWith(true);
  });

  test('rejects when Electron does not expose the running intent API', async () => {
    await expect(persistRunningIntent(true, undefined, true)).rejects.toThrow(
      'Electron 运行状态 API 不可用',
    );
  });

  test.each([undefined, 'true', 1, false])(
    'rejects an invalid Electron acknowledgement: %p',
    async acknowledgement => {
      const setRunningIntent = jest.fn().mockResolvedValue(acknowledgement);

      await expect(persistRunningIntent(true, setRunningIntent, true)).rejects.toThrow(
        'Electron 运行状态写入验证失败',
      );
    },
  );

  test('uses the requested value outside Electron without calling IPC', async () => {
    const setRunningIntent = jest.fn().mockResolvedValue(false);

    await expect(persistRunningIntent(false, setRunningIntent, true)).resolves.toBe(true);
    expect(setRunningIntent).not.toHaveBeenCalled();
  });
});
