import { licenseService } from './LicenseService';
import * as storage from './LicenseStorage';

describe('getStatus 检测到时钟异常时后台自愈', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('clockRollback 时在后台触发一次心跳（不阻塞 getStatus 返回）', async () => {
    const realNow = Date.now();
    // 锚点被污染：serverNowLocalAt 比 serverNowAt 早 30 天，二次偏差检测会判 clockRollback
    const polluted = {
      token: 'fake-token',
      expiresAt: realNow + 55 * 86400000,
      fingerprint: 'fp-test',
      activatedAt: realNow - 86400000,
      lastHeartbeatAt: realNow - 3600000,
      tier: 'pro' as const,
      serverNowAt: realNow - 3600000,
      serverNowLocalAt: realNow - 30 * 86400000,
      lastVerifiedAt: realNow - 30 * 86400000,
      monoWallAt: realNow - 30 * 86400000,
      monoAt: 0,
    };

    jest.spyOn(storage, 'loadLicense').mockResolvedValue(polluted as any);
    jest.spyOn(require('./DeviceFingerprint'), 'verifyFingerprint').mockResolvedValue(true);

    // 心跳调用：用一个可被外部 resolve 的 promise 模拟网络往返
    let resolveHeartbeat: (v: any) => void = () => {};
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
      () =>
        new Promise(resolve => {
          resolveHeartbeat = resolve;
        }) as any
    );

    // getStatus 应尽快返回（不 await 心跳）
    const status = await licenseService.getStatus();
    expect(status.clockRollback).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 已在后台发起心跳，不阻塞

    // 让心跳成功返回，锚点应被纠正（saveLicense 被调用）
    const saveSpy = jest.spyOn(storage, 'saveLicense').mockResolvedValue(undefined as any);
    resolveHeartbeat({
      ok: true,
      status: 200,
      json: async () => ({ success: true, expiresAt: polluted.expiresAt, serverNow: realNow, tier: 'pro' }),
    });
    // 等待后台微任务/回调完成
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 10));

    expect(saveSpy).toHaveBeenCalled();
    const saved = saveSpy.mock.calls[0][0];
    expect(saved.serverNowAt).toBe(realNow);
  });
});
