import { licenseService } from './LicenseService';
import * as storage from './LicenseStorage';

// 一份带有效锚点的本地许可证（未过期）
function makeStored() {
  const now = Date.now();
  return {
    token: 'fake-token',
    expiresAt: now + 3 * 86400000, // 3 天后过期
    fingerprint: 'fp-test',
    activatedAt: now - 86400000,
    lastHeartbeatAt: now - 3600000,
    tier: 'basic' as const,
    serverNowAt: now - 3600000,
    serverNowLocalAt: now - 3600000,
    lastVerifiedAt: now - 3600000,
  };
}

describe('heartbeat 服务端故障处理', () => {
  let loadSpy: jest.SpyInstance;
  let saveSpy: jest.SpyInstance;
  let clearSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    loadSpy = jest.spyOn(storage, 'loadLicense').mockResolvedValue(makeStored());
    saveSpy = jest.spyOn(storage, 'saveLicense').mockResolvedValue(undefined);
    clearSpy = jest.spyOn(storage, 'clearLicense').mockResolvedValue(undefined);
    // 指纹校验直接通过
    jest.spyOn(require('./DeviceFingerprint'), 'verifyFingerprint').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('服务端 401（许可证过期/无效）→ 清空本地许可证', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: '许可证已过期' }),
    } as any);

    const result = await licenseService.heartbeat();

    expect(result.success).toBe(false);
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  test('服务端 500（临时故障）→ 不清空许可证，按离线处理', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal error' }),
    } as any);

    const result = await licenseService.heartbeat();

    expect(result.success).toBe(false);
    expect(result.isOffline).toBe(true);
    expect(clearSpy).not.toHaveBeenCalled();
  });

  test('网络异常（fetch reject）→ 不清空许可证，按离线处理', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await licenseService.heartbeat();

    expect(result.success).toBe(false);
    expect(result.isOffline).toBe(true);
    expect(clearSpy).not.toHaveBeenCalled();
  });
});
