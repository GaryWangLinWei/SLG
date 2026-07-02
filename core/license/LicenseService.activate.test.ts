import { licenseService } from './LicenseService';
import * as storage from './LicenseStorage';

describe('activate 时钟回拨防护', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('本地时钟回拨时，拒绝激活且不联系服务器', async () => {
    // 现存许可证的锚点在"未来"，本地 now 早于锚点 → clockRollback
    const future = Date.now() + 10 * 86400000; // 10 天后
    jest.spyOn(storage, 'loadLicense').mockResolvedValue({
      token: 'fake',
      expiresAt: future + 86400000,
      fingerprint: 'fp',
      activatedAt: future,
      lastHeartbeatAt: future,
      tier: 'basic',
      serverNowAt: future,
      serverNowLocalAt: future, // 本地锚点在未来 → now 早于它 = 回拨
      lastVerifiedAt: future,
    } as any);

    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await licenseService.activate('ANY-CODE');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/时间|时钟|clock/i);
    // 关键：回拨状态下不得联网、不得写许可证
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
