import {
  evaluateLicense,
  CLOCK_SKEW_TOLERANCE_MS,
} from './clockTrust';

// 固定的"当前"本地时间，避免用真实 Date.now()
const NOW = Date.UTC(2026, 7, 2, 13, 0, 0); // 2026-08-02 13:00:00Z
const DAY = 86400000;
const GRACE = 24 * 60 * 60 * 1000;

function baseAnchor(overrides: Record<string, number> = {}) {
  return {
    // 服务端在"NOW - 1 小时"通过一次心跳
    serverNowAt: NOW - 3600000,
    serverNowLocalAt: NOW - 3600000,
    lastVerifiedAt: NOW - 3600000,
    ...overrides,
  };
}

describe('evaluateLicense', () => {
  test('未激活视为过期', () => {
    const r = evaluateLicense(null, NOW, GRACE);
    expect(r.activated).toBe(false);
    expect(r.isExpired).toBe(true);
  });

  test('正常在线、未过期、刚心跳过 → 有效', () => {
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...baseAnchor() },
      NOW,
      GRACE
    );
    expect(r.activated).toBe(true);
    expect(r.isExpired).toBe(false);
    expect(r.isOffline).toBe(false);
    expect(r.clockRollback).toBe(false);
  });

  test('本地时钟回拨超过容差 → 判定为篡改，不信任本地时间', () => {
    // 最后验证时间是 NOW，把本地时钟拨回到 12 天前
    const rolledBackNow = NOW - 12 * DAY;
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...baseAnchor({ lastVerifiedAt: NOW }) },
      rolledBackNow,
      GRACE
    );
    expect(r.clockRollback).toBe(true);
    // 回拨时不能因为 now 变小而让宽限/到期变成"有效"
    expect(r.isExpired).toBe(true);
  });

  test('回拨本地时钟不能让已过期的许可证复活（即便有服务端锚点）', () => {
    // 许可证在服务端看来已过期 30 分钟
    const expiresAt = NOW - 3600000 + 30 * 60000;
    const r = evaluateLicense(
      { expiresAt, ...baseAnchor() },
      // 本地时钟回拨到许可证到期之前，想"续命"
      expiresAt - 60 * 60000,
      GRACE
    );
    // 回拨被检测，且按过期处理
    expect(r.clockRollback).toBe(true);
    expect(r.isExpired).toBe(true);
  });

  test('超过 24h 未成功心跳 → 离线', () => {
    const r = evaluateLicense(
      {
        expiresAt: NOW + 3 * DAY,
        ...baseAnchor({
          serverNowAt: NOW - 25 * 3600000,
          serverNowLocalAt: NOW - 25 * 3600000,
          lastVerifiedAt: NOW - 25 * 3600000,
        }),
      },
      NOW,
      GRACE
    );
    expect(r.isOffline).toBe(true);
    expect(r.isExpired).toBe(false);
  });

  test('没有服务端锚点（老数据/从未心跳）时回退到本地墙钟，但仍检测回拨', () => {
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, lastVerifiedAt: NOW - 3600000 },
      NOW,
      GRACE
    );
    expect(r.trustedNow).toBe(NOW);
    expect(r.isExpired).toBe(false);
  });

  test('容差范围内的小幅时钟波动不算回拨', () => {
    const r = evaluateLicense(
      {
        expiresAt: NOW + 3 * DAY,
        ...baseAnchor({ lastVerifiedAt: NOW }),
      },
      NOW - CLOCK_SKEW_TOLERANCE_MS / 2,
      GRACE
    );
    expect(r.clockRollback).toBe(false);
  });
});
