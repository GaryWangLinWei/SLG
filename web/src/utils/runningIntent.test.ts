import { readRunningIntent } from './runningIntent';

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
