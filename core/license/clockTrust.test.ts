import {
  evaluateLicense,
  CLOCK_SKEW_TOLERANCE_MS,
  ClockReading,
} from './clockTrust';

// 固定的"当前"本地时间，避免用真实 Date.now()
const NOW = Date.UTC(2026, 7, 2, 13, 0, 0); // 2026-08-02 13:00:00Z
const DAY = 86400000;
const HOUR = 3600000;
const GRACE = 24 * HOUR;

// 进程在"NOW - 2 小时"启动，启动时 wall=NOW-2h, mono=0
const SESSION_START_WALL = NOW - 2 * HOUR;

/** 构造一次时钟读数 */
function reading(wallNow: number, monoNow: number): ClockReading {
  return { wallNow, monoNow, sessionStartWall: SESSION_START_WALL, sessionStartMono: 0 };
}

function baseAnchor(overrides: Record<string, number> = {}) {
  return {
    // 服务端在"NOW - 1 小时"通过一次心跳，并在那时记录了 mono 锚点
    serverNowAt: NOW - HOUR,
    serverNowLocalAt: NOW - HOUR,
    lastVerifiedAt: NOW - HOUR,
    // 心跳时 wall=NOW-1h，mono=1h（进程已运行 1h）
    monoWallAt: NOW - HOUR,
    monoAt: HOUR,
    ...overrides,
  };
}

describe('evaluateLicense (单调时钟)', () => {
  test('未激活视为过期', () => {
    const r = evaluateLicense(null, reading(NOW, 2 * HOUR), GRACE);
    expect(r.activated).toBe(false);
    expect(r.isExpired).toBe(true);
  });

  test('正常在线、未过期、刚心跳过 → 有效', () => {
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...baseAnchor() },
      reading(NOW, 2 * HOUR),
      GRACE
    );
    expect(r.isExpired).toBe(false);
    expect(r.isOffline).toBe(false);
    expect(r.clockRollback).toBe(false);
    // 锚点在 NOW-1h，现在 mono 已走 1h → trustedNow = NOW
    expect(r.trustedNow).toBe(NOW);
  });

  test('冻结本地墙钟但单调时钟继续走 → 宽限照常流逝，最终离线', () => {
    // 锚点在 NOW-1h。攻击者把墙钟冻结在锚点时刻，但真实已过 25 小时（mono=26h）
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...baseAnchor() },
      reading(NOW - HOUR, 26 * HOUR), // wall 冻在锚点，mono 却走了 25h
      GRACE
    );
    // 用单调时钟：trustedNow 推进到锚点后 25h → 超过 24h 宽限
    expect(r.isOffline).toBe(true);
    expect(r.trustedNow).toBe(NOW - HOUR + 25 * HOUR);
  });

  test('精确回拨墙钟到锚点 + 冻结 → 仍按单调时钟判定离线', () => {
    // 与上一个攻击相同：wall 回到锚点，mono 真实流逝
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...baseAnchor() },
      reading(NOW - HOUR, 25 * HOUR + 1000),
      GRACE
    );
    expect(r.isOffline).toBe(true);
  });

  test('大幅回拨墙钟 → 判定回拨篡改，按过期处理', () => {
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...baseAnchor() },
      reading(NOW - 12 * DAY, 2 * HOUR),
      GRACE
    );
    expect(r.clockRollback).toBe(true);
    expect(r.isExpired).toBe(true);
  });

  test('回拨墙钟不能让已过期许可证复活', () => {
    const expiresAt = NOW - HOUR + 30 * 60000; // 锚点后 30 分钟过期
    const r = evaluateLicense(
      { expiresAt, ...baseAnchor() },
      reading(expiresAt - HOUR, 2 * HOUR), // 墙钟拨回到期前
      GRACE
    );
    // 墙钟回拨被检测或单调时钟显示已过期 → 总之 isExpired
    expect(r.isExpired).toBe(true);
  });

  test('超过 24h 未成功心跳（正常流逝）→ 离线', () => {
    const r = evaluateLicense(
      {
        expiresAt: NOW + 3 * DAY,
        ...baseAnchor({
          serverNowAt: NOW - 25 * HOUR,
          serverNowLocalAt: NOW - 25 * HOUR,
          lastVerifiedAt: NOW - 25 * HOUR,
          monoWallAt: NOW - 25 * HOUR,
          monoAt: 0,
        }),
      },
      reading(NOW, 27 * HOUR),
      GRACE
    );
    expect(r.isOffline).toBe(true);
    expect(r.isExpired).toBe(false);
  });

  test('容差范围内墙钟/单调偏差不算回拨', () => {
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...baseAnchor() },
      // wall 比预期慢 2 分钟（在容差内），mono 正常
      reading(NOW - 2 * 60 * 1000, 2 * HOUR),
      GRACE
    );
    expect(r.clockRollback).toBe(false);
    expect(r.isExpired).toBe(false);
  });

  test('老数据无 mono 锚点（上个进程留下）→ 用迁移基线接续，不失效', () => {
    // 锚点早于本进程启动（3h 前的心跳），进程已运行 2h，墙钟正常走到 NOW
    const r = evaluateLicense(
      {
        expiresAt: NOW + 3 * DAY,
        serverNowAt: NOW - 3 * HOUR,
        serverNowLocalAt: NOW - 3 * HOUR,
        lastVerifiedAt: NOW - 3 * HOUR,
      },
      reading(NOW, 2 * HOUR),
      GRACE
    );
    expect(r.activated).toBe(true);
    expect(r.isExpired).toBe(false);
    // preSessionWall(1h) + inSessionMono(2h) = 3h，与墙钟流逝一致
    expect(r.trustedNow).toBe(NOW);
    expect(r.isOffline).toBe(false);
  });

  test('跨进程重启：mono 锚点来自上个进程 → 忽略 mono，用墙钟接续但不判篡改', () => {
    // 当前进程在 SESSION_START_WALL 启动。锚点 monoWallAt 早于本进程启动 → 上个进程的
    const r = evaluateLicense(
      {
        expiresAt: NOW + 3 * DAY,
        serverNowAt: NOW - HOUR,
        serverNowLocalAt: NOW - HOUR,
        lastVerifiedAt: NOW - HOUR,
        monoWallAt: NOW - 3 * HOUR, // 早于本进程启动(NOW-2h)
        monoAt: 5 * HOUR,           // 上个进程的 mono，本进程无意义
      },
      reading(NOW, 2 * HOUR),
      GRACE
    );
    // 不能因为 mono 读数看起来"倒退"而误判；正常用墙钟接续
    expect(r.clockRollback).toBe(false);
    expect(r.isExpired).toBe(false);
  });

  test('跨会话冻结攻击：回拨到上个会话锚点并冻结、断网 10 天 → 仍应判离线', () => {
    // 上个会话最后心跳：墙钟 = 锚点 = NOW-3h（早于本进程启动 NOW-2h）
    // 攻击者把墙钟回拨到该锚点并冻结，但本进程已真实运行 10 天（mono=10天）
    const TEN_DAYS = 10 * DAY;
    const r = evaluateLicense(
      {
        expiresAt: NOW + 30 * DAY, // 远未到期，排除到期因素
        serverNowAt: NOW - 3 * HOUR,
        serverNowLocalAt: NOW - 3 * HOUR,
        lastVerifiedAt: NOW - 3 * HOUR,
        monoWallAt: NOW - 3 * HOUR, // 上个进程的锚点
        monoAt: 5 * HOUR,
      },
      reading(NOW - 3 * HOUR, TEN_DAYS), // wall 冻结在锚点，mono 走了 10 天
      GRACE
    );
    expect(r.isOffline).toBe(true);
    expect(r.isExpired).toBe(false);
  });
});
