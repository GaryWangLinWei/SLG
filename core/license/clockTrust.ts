// 可信时间计算：到期/离线判断基于"可信时间"，同时用单调时钟防止墙钟冻结/精确回拨。
//
// 为什么需要单调时钟：
//   仅用 Date.now() 时，攻击者把墙钟"精确回拨到上次心跳时刻"或直接冻结，
//   可信时间增量就被清零，24h 离线宽限永远走不完。performance.now()/hrtime
//   不受墙钟回拨影响，冻结墙钟时它仍正常流逝。
//
// 可信流逝（锚点之后经过了多久）取两者的较大值：
//   elapsed = max(wallElapsed, monoElapsed)
//   - 正常情况两者一致；
//   - 冻结/回拨墙钟时 wallElapsed 变小，monoElapsed 仍为真实流逝，宽限照常走完；
//   - 前拨墙钟时 wallElapsed 偏大，只会更快到期，不是安全问题。
//
// 跨进程重启：performance.now() 重启归零，因此存储的 mono 锚点来自"本进程"才有效。
// 通过对比 monoWallAt（锚点记录时的墙钟）与 sessionStartWall（本进程启动墙钟）判断：
// 若锚点早于本进程启动，说明是上个进程的 mono，忽略它，退回到墙钟逻辑（不判篡改）。

export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5 分钟容差（NTP 校时等）

/** 一次时钟读数：墙钟 + 单调时钟 + 本进程启动点 */
export interface ClockReading {
  wallNow: number;
  monoNow: number;
  sessionStartWall: number;
  sessionStartMono: number;
}

export interface ClockAnchor {
  expiresAt: number;
  /** 最后一次成功心跳时的服务端时间（ms） */
  serverNowAt?: number;
  /** 最后一次成功心跳时的本地墙钟（ms） */
  serverNowLocalAt?: number;
  /** 最后一次可信验证时间（ms，本地时间域；老数据兜底） */
  lastVerifiedAt?: number;
  /** 锚点建立时的本地墙钟（ms），用于判断 mono 是否属于本进程 */
  monoWallAt?: number;
  /** 锚点建立时的单调时钟读数（ms） */
  monoAt?: number;
}

export interface LicenseEvalResult {
  activated: boolean;
  isExpired: boolean;
  isOffline: boolean;
  clockRollback: boolean;
  trustedNow: number;
  graceRemainingMs: number;
}

/**
 * 计算锚点之后可信的流逝毫秒数。
 * 取墙钟流逝与单调流逝的较大值，防墙钟冻结/回拨。
 */
export function computeElapsed(anchor: ClockAnchor, clock: ClockReading): number {
  if (typeof anchor.serverNowLocalAt !== 'number') return 0;

  // 情况 1：mono 锚点属于本进程（锚点建立在本进程启动之后）。
  // 直接用本进程 mono 差值，墙钟冻结/回拨也不影响。
  if (
    typeof anchor.monoAt === 'number' &&
    typeof anchor.monoWallAt === 'number' &&
    anchor.monoWallAt >= clock.sessionStartWall - CLOCK_SKEW_TOLERANCE_MS
  ) {
    const monoElapsed = clock.monoNow - anchor.monoAt;
    // 同时参考墙钟，取较大值（前拨墙钟只会更快到期，无害）。
    const wallElapsed = clock.wallNow - anchor.serverNowLocalAt;
    return Math.max(monoElapsed, wallElapsed, 0);
  }

  // 情况 2：mono 锚点来自上个进程（或老数据无锚点）。
  // 把本进程启动点作为新基线迁移：
  //   elapsed = 锚点 → 本进程启动（墙钟流逝，钳到 0 防重启间隙回拨）
  //           + 本进程启动 → 现在（本进程 mono 流逝，冻结墙钟也守得住）
  // 这样"跨会话冻结"攻击中本进程已真实运行的时间不会被清零。
  const preSessionWall = Math.max(0, clock.sessionStartWall - anchor.serverNowLocalAt);
  const inSessionMono = clock.monoNow - clock.sessionStartMono;
  const migrated = preSessionWall + inSessionMono;

  const wallElapsed = clock.wallNow - anchor.serverNowLocalAt;
  return Math.max(migrated, wallElapsed, 0);
}

/**
 * 计算可信当前时间。
 */
export function computeTrustedNow(
  anchor: ClockAnchor,
  clock: ClockReading
): number {
  if (typeof anchor.serverNowAt === 'number') {
    return anchor.serverNowAt + computeElapsed(anchor, clock);
  }
  return clock.wallNow;
}

/**
 * 基于可信时间评估许可证状态。纯函数，便于测试。
 *
 * @param stored 本地存储的许可证（含时间锚点）；null 表示未激活
 * @param clock  当前时钟读数
 * @param gracePeriodMs 离线宽限（ms）
 */
export function evaluateLicense(
  stored: ClockAnchor | null,
  clock: ClockReading,
  gracePeriodMs: number
): LicenseEvalResult {
  if (!stored) {
    return {
      activated: false,
      isExpired: true,
      isOffline: false,
      clockRollback: false,
      trustedNow: clock.wallNow,
      graceRemainingMs: 0,
    };
  }

  // 回拨检测：本地墙钟不得早于锚点墙钟超过容差。
  // 注意：即便这里没触发（精确回拨到锚点），单调时钟仍会让宽限照常流逝。
  const localAnchor =
    typeof stored.serverNowLocalAt === 'number'
      ? stored.serverNowLocalAt
      : stored.lastVerifiedAt;
  let clockRollback = false;
  if (
    typeof localAnchor === 'number' &&
    clock.wallNow < localAnchor - CLOCK_SKEW_TOLERANCE_MS
  ) {
    clockRollback = true;
  }

  const elapsed = computeElapsed(stored, clock);
  const trustedNow =
    typeof stored.serverNowAt === 'number'
      ? stored.serverNowAt + elapsed
      : clock.wallNow;

  // 回拨时不信任本地时间，直接按过期处理
  const isExpired = clockRollback || trustedNow > stored.expiresAt;

  // 离线判断：可信流逝超过宽限
  const isOffline = elapsed > gracePeriodMs;
  const graceRemainingMs = Math.max(0, gracePeriodMs - elapsed);

  return {
    activated: true,
    isExpired,
    isOffline: isExpired ? false : isOffline,
    clockRollback,
    trustedNow,
    graceRemainingMs,
  };
}
