import { readRunningIntent } from './runningIntent';

describe('readRunningIntent', () => {
  test('reads the Electron session intent when the API is available', async () => {
    const getRunningIntent = jest.fn().mockResolvedValue(true);

    await expect(readRunningIntent(getRunningIntent, false)).resolves.toBe(true);
    expect(getRunningIntent).toHaveBeenCalledTimes(1);
  });

  test('uses the browser fallback without calling Electron', async () => {
    await expect(readRunningIntent(undefined, true)).resolves.toBe(true);
  });

  test('propagates Electron read failures', async () => {
    const error = new Error('IPC unavailable');
    const getRunningIntent = jest.fn().mockRejectedValue(error);

    await expect(readRunningIntent(getRunningIntent, false)).rejects.toBe(error);
  });
});
