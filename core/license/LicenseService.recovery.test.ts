import { licenseService } from './LicenseService';
import * as storage from './LicenseStorage';

describe('时钟异常后的自愈', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('本地锚点被污染、时间恢复正常后，心跳成功可纠正锚点并解除异常', async () => {
    // 当前真实墙钟（已恢复正常）
    const realNow = Date.now();
    // 污染的锚点：serverNowAt 是服务端真实时间(1h前)，但 serverNowLocalAt 是 30 天前的假时间
    const polluted = {
      token: 'fake-token',
      expiresAt: realNow + 55 * 86400000,
      fingerprint: 'fp-test',
      activatedAt: realNow - 86400000,
      lastHeartbeatAt: realNow - 3600000,
      tier: 'pro' as const,
      serverNowAt: realNow - 3600000,          // 服务端 1h 前
      serverNowLocalAt: realNow - 30 * 86400000, // 本地锚点被污染到 30 天前
      lastVerifiedAt: realNow - 30 * 86400000,
      monoWallAt: realNow - 30 * 86400000,
      monoAt: 0,
    };

    const loadSpy = jest.spyOn(storage, 'loadLicense').mockResolvedValue(polluted as any);
    jest.spyOn(storage, 'loadLicenseSync').mockReturnValue(polluted as any);
    const saveSpy = jest.spyOn(storage, 'saveLicense').mockResolvedValue(undefined as any);
    jest.spyOn(require('./DeviceFingerprint'), 'verifyFingerprint').mockResolvedValue(true);
    jest.spyOn(require('./DeviceFingerprint'), 'verifyFingerprintSync').mockReturnValue(true);

    // 服务端确认有效，返回当前真实时间
    const serverNow = realNow;
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, expiresAt: polluted.expiresAt, serverNow, tier: 'pro' }),
    } as any);

    // 心跳成功
    const result = await licenseService.heartbeat();
    expect(result.success).toBe(true);

    // 锚点必须被纠正：serverNowLocalAt 写回当前真实墙钟，不再是 30 天前
    const saved = saveSpy.mock.calls[0][0];
    expect(saved.serverNowLocalAt).toBeGreaterThan(realNow - 60000);
    expect(saved.serverNowLocalAt).toBeLessThan(realNow + 60000);
    expect(saved.serverNowAt).toBe(serverNow);
    // 模拟纠正后重新评估：用新锚点，应不再判时钟异常
    loadSpy.mockRestore();
    jest.spyOn(storage, 'loadLicense').mockResolvedValue(saved as any);
    jest.spyOn(storage, 'loadLicenseSync').mockReturnValue(saved as any);
    const status = await licenseService.getStatus();
    expect(status.clockRollback).toBe(false);
    expect(status.isExpired).toBe(false);
  });
});
