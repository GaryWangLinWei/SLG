import { persistRunningSession, readRunningSession } from './runningIntent';

const stopped = { running: false, accountId: null };
const running = { running: true, accountId: 'account-a' };

describe('readRunningSession', () => {
  test('restores the Electron session including its owner account', async () => {
    const getRunningSession = jest.fn().mockResolvedValue(running);

    await expect(readRunningSession(true, getRunningSession, stopped)).resolves.toEqual(running);
  });

  test('rejects a running Electron session without an owner', async () => {
    const getRunningSession = jest.fn().mockResolvedValue({ running: true, accountId: null });

    await expect(readRunningSession(true, getRunningSession, stopped)).rejects.toThrow('运行账号缺失');
  });

  test('uses the browser fallback outside Electron', async () => {
    const getRunningSession = jest.fn();

    await expect(readRunningSession(false, getRunningSession, running)).resolves.toEqual(running);
    expect(getRunningSession).not.toHaveBeenCalled();
  });
});

describe('persistRunningSession', () => {
  test('atomically persists and verifies the requested Electron session', async () => {
    const setRunningSession = jest.fn().mockResolvedValue(running);

    await expect(persistRunningSession(true, setRunningSession, running)).resolves.toEqual(running);
    expect(setRunningSession).toHaveBeenCalledWith(running);
  });

  test('rejects a mismatched acknowledgement', async () => {
    const setRunningSession = jest.fn().mockResolvedValue(stopped);

    await expect(persistRunningSession(true, setRunningSession, running)).rejects.toThrow('Electron 运行会话写入验证失败');
  });
});
