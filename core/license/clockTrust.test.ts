import {
  evaluateLicense,
  CLOCK_SKEW_TOLERANCE_MS,
  ClockReading,
} from './clockTrust';

// 固定的"当前"真实时间
const NOW = Date.UTC(2026, 7, 2, 13, 0, 0); // 2026-08-02 13:00:00Z
const DAY = 86400000;
const HOUR = 3600000;
const GRACE = 24 * HOUR;

/**
 * 构造一次自洽的时钟读数：进程已运行 uptime ms，墙钟正常运行。
 * wallNow 是当前墙钟；sessionStartWall = wallNow - uptime（启动时的墙钟）；
 * monoNow = uptime（mono 从 0 开始）。
 */
function clk(wallNow: number, uptime: number): ClockReading {
  return {
    wallNow,
    monoNow: uptime,
    sessionStartWall: wallNow - uptime,
    sessionStartMono: 0,
  };
}

/** 一次"墙钟正常、心跳发生在 hbAgo 之前"的锚点 */
function anchor(hbAgo: number, now: number) {
  const uptime = hbAgo + HOUR; // 进程在心跳前 1h 启动
  return {
    anchor: {
      serverNowAt: now - hbAgo,
      serverNowLocalAt: now - hbAgo,
      lastVerifiedAt: now - hbAgo,
      monoWallAt: now - hbAgo,
      monoAt: HOUR, // 心跳时进程已运行 1h
    },
    clock: clk(now, uptime),
  };
}

describe('evaluateLicense (单调时钟)', () => {
  test('未激活视为过期', () => {
    const r = evaluateLicense(null, clk(NOW, 0), GRACE);
    expect(r.activated).toBe(false);
    expect(r.isExpired).toBe(true);
  });

  test('正常在线、未过期、1h 前心跳 → 有效', () => {
    const { anchor: a, clock } = anchor(HOUR, NOW);
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...a },
      clock,
      GRACE
    );
    expect(r.isExpired).toBe(false);
    expect(r.isOffline).toBe(false);
    expect(r.clockRollback).toBe(false);
    expect(r.trustedNow).toBe(NOW);
  });

  test('冻结本地墙钟但单调时钟继续走 25h → 判定时钟篡改并拦下', () => {
    // 25h 前心跳正常（服务端/本地都是 NOW-25h），之后墙钟被冻结在该时刻，
    // 但进程 mono 真实走了 26h。
    const hb = NOW - 25 * HOUR;
    const frozenClock: ClockReading = {
      wallNow: hb, // 墙钟冻结
      monoNow: 26 * HOUR,
      sessionStartWall: NOW - 26 * HOUR, // 启动时墙钟还正常
      sessionStartMono: 0,
    };
    const r = evaluateLicense(
      {
        expiresAt: NOW + 30 * DAY,
        serverNowAt: hb,
        serverNowLocalAt: hb,
        lastVerifiedAt: hb,
        monoWallAt: hb,
        monoAt: HOUR, // 心跳时进程已运行 1h
      },
      frozenClock,
      GRACE
    );
    // 可信时间走到真实 NOW，与冻结的墙钟差 25h → 篡改
    expect(r.trustedNow).toBe(NOW);
    expect(r.clockRollback).toBe(true);
    expect(r.isExpired).toBe(true);
  });

  test('精确回拨墙钟到锚点并冻结 → 判定时钟篡改', () => {
    const { anchor: a, clock } = anchor(HOUR, NOW);
    // 在正常时钟基础上把墙钟回拨到锚点
    const tampered: ClockReading = {
      ...clock,
      wallNow: NOW - HOUR,
    };
    const r = evaluateLicense(
      { expiresAt: NOW + 30 * DAY, ...a },
      tampered,
      GRACE
    );
    expect(r.clockRollback).toBe(true);
    expect(r.isExpired).toBe(true);
  });

  test('大幅回拨墙钟 12 天 → 第一次回拨检测就拦下', () => {
    const { anchor: a, clock } = anchor(HOUR, NOW);
    const tampered: ClockReading = { ...clock, wallNow: NOW - 12 * DAY };
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...a },
      tampered,
      GRACE
    );
    expect(r.clockRollback).toBe(true);
    expect(r.isExpired).toBe(true);
  });

  test('回拨墙钟不能让已过期许可证复活', () => {
    const { anchor: a, clock } = anchor(HOUR, NOW);
    const expiresAt = NOW - 30 * 60 * 1000; // 30 分钟前已过期
    const tampered: ClockReading = { ...clock, wallNow: expiresAt - HOUR };
    const r = evaluateLicense({ expiresAt, ...a }, tampered, GRACE);
    expect(r.isExpired).toBe(true);
  });

  test('正常流逝超过 24h 未成功心跳 → 离线（不到期）', () => {
    const { anchor: a, clock } = anchor(25 * HOUR, NOW);
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...a },
      clock,
      GRACE
    );
    expect(r.isOffline).toBe(true);
    expect(r.isExpired).toBe(false);
    expect(r.clockRollback).toBe(false);
    expect(r.trustedNow).toBe(NOW);
  });

  test('容差范围内（2 分钟）的墙钟偏慢不算篡改', () => {
    const { anchor: a, clock } = anchor(HOUR, NOW);
    const slow: ClockReading = { ...clock, wallNow: NOW - 2 * 60 * 1000 };
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...a },
      slow,
      GRACE
    );
    expect(r.clockRollback).toBe(false);
    expect(r.isExpired).toBe(false);
  });

  test('老数据无 mono 锚点（上个进程留下）→ 用迁移基线接续，不失效', () => {
    // 上个进程 3h 前的心跳，本进程运行 2h，墙钟正常
    const a = {
      serverNowAt: NOW - 3 * HOUR,
      serverNowLocalAt: NOW - 3 * HOUR,
      lastVerifiedAt: NOW - 3 * HOUR,
    };
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...a },
      clk(NOW, 2 * HOUR),
      GRACE
    );
    expect(r.activated).toBe(true);
    expect(r.isExpired).toBe(false);
    // preSessionWall(1h) + inSessionMono(2h) = 3h，与墙钟一致
    expect(r.trustedNow).toBe(NOW);
    expect(r.isOffline).toBe(false);
  });

  test('跨进程重启：旧 mono 锚点来自上个进程 → 忽略旧 mono，用墙钟接续不误判', () => {
    // 当前进程 2h 前启动；锚点是 3h 前（上个进程），其 monoAt 是上个进程的值
    const oldAnchor = {
      serverNowAt: NOW - 3 * HOUR,
      serverNowLocalAt: NOW - 3 * HOUR,
      lastVerifiedAt: NOW - 3 * HOUR,
      monoWallAt: NOW - 3 * HOUR,
      monoAt: 8 * HOUR, // 上个进程的 mono，无意义
    };
    const r = evaluateLicense(
      { expiresAt: NOW + 3 * DAY, ...oldAnchor },
      clk(NOW, 2 * HOUR),
      GRACE
    );
    expect(r.clockRollback).toBe(false);
    expect(r.isExpired).toBe(false);
    expect(r.trustedNow).toBe(NOW);
  });

  test('跨会话冻结攻击：回拨到上个会话锚点并冻结、断网 10 天 → 拦下', () => {
    // 上个会话在 10 天前留下锚点；攻击者在锚点时刻启动新进程并冻结墙钟，
    // 但本进程 mono 真实运行了 10 天。
    const anchorTime = NOW - 10 * DAY;
    const frozenClock: ClockReading = {
      wallNow: anchorTime,
      monoNow: 10 * DAY,
      sessionStartWall: anchorTime,
      sessionStartMono: 0,
    };
    const r = evaluateLicense(
      {
        expiresAt: NOW + 30 * DAY,
        serverNowAt: anchorTime,
        serverNowLocalAt: anchorTime,
        lastVerifiedAt: anchorTime,
        monoWallAt: anchorTime,
        monoAt: 0,
      },
      frozenClock,
      GRACE
    );
    // 可信时间 = 锚点 + 10 天(mono) = NOW，与冻结墙钟差 10 天 → 篡改
    expect(r.trustedNow).toBe(NOW);
    expect(r.clockRollback).toBe(true);
    expect(r.isExpired).toBe(true);
  });

  test('改时间后重启+心跳：本地墙钟比服务端慢 30 天 → 判时钟异常', () => {
    // 复现真实场景：回拨 30 天后才重启并心跳，锚点本地时间被污染。
    // 服务端返回真实时间；本地锚点和当前墙钟都是假时间。
    const realServerNow = NOW;
    const fakeLocalNow = NOW - 30 * DAY;
    const fakeClock: ClockReading = {
      wallNow: fakeLocalNow,
      monoNow: 10 * 60 * 1000,
      sessionStartWall: fakeLocalNow - 10 * 60 * 1000,
      sessionStartMono: 0,
    };
    const r = evaluateLicense(
      {
        expiresAt: realServerNow + 55 * DAY,
        serverNowAt: realServerNow - 10 * 60 * 1000,
        serverNowLocalAt: fakeLocalNow - 10 * 60 * 1000,
        lastVerifiedAt: fakeLocalNow - 10 * 60 * 1000,
        monoWallAt: fakeLocalNow - 10 * 60 * 1000,
        monoAt: 0,
      },
      fakeClock,
      GRACE
    );
    expect(r.clockRollback).toBe(true);
    expect(r.isExpired).toBe(true);
    expect(r.trustedNow).toBeGreaterThan(realServerNow - 60 * 1000);
  });

  test('极老数据缺 serverNowLocalAt（只有 lastHeartbeatAt）→ 用 lastHeartbeatAt 兜底，冻结墙钟仍拦下', () => {
    const anchorTime = NOW - 25 * HOUR;
    const frozenClock: ClockReading = {
      wallNow: anchorTime,
      monoNow: 25 * HOUR,
      sessionStartWall: anchorTime,
      sessionStartMono: 0,
    };
    const r = evaluateLicense(
      { expiresAt: NOW + 30 * DAY, lastHeartbeatAt: anchorTime } as any,
      frozenClock,
      GRACE
    );
    // 无 serverNowAt → trustedNow 退回墙钟；但有本地锚点且墙钟冻结、mono 流逝，
    // 离线宽限照常走完
    expect(r.isOffline).toBe(true);
  });
});
