// 可信时间计算：所有到期/离线判断都基于"可信时间"，不直接信任本地墙钟。
//
// 可信时间来源优先级：
// 1. 最后一次成功心跳带回来的服务端时间 serverNowAt，加上自那以后本地经过的单调差值
//    （差值用本地墙钟差近似，但配合回拨检测兜底）。
// 2. 没有服务端锚点时（老数据/从未心跳）回退到本地墙钟 now。
//
// 回拨检测：本地 now 不得早于最后一次验证时间 lastVerifiedAt 超过容差，
// 否则判定时钟被回拨，不信任本地时间，按过期/需重新验证处理。

export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5 分钟容差（NTP 校时等）

export interface ClockAnchor {
  expiresAt: number;
  /** 最后一次成功心跳时的服务端时间（ms） */
  serverNowAt?: number;
  /** 最后一次成功心跳时的本地墙钟（ms）；也用于本地时钟回拨检测 */
  serverNowLocalAt?: number;
  /** 最后一次可信验证时间（ms，本地时间域；老数据兜底，优先级低于 serverNowLocalAt） */
  lastVerifiedAt?: number;
}

export interface LicenseEvalResult {
  activated: boolean;
  isExpired: boolean;
  isOffline: boolean;
  clockRollback: boolean;
  /** 推算出的可信当前时间 */
  trustedNow: number;
  /** 离线宽限剩余毫秒（仅离线时为 0，在线时为剩余量） */
  graceRemainingMs: number;
}

/**
 * 计算可信当前时间。
 */
export function computeTrustedNow(anchor: ClockAnchor, now: number): number {
  if (
    typeof anchor.serverNowAt === 'number' &&
    typeof anchor.serverNowLocalAt === 'number'
  ) {
    return anchor.serverNowAt + (now - anchor.serverNowLocalAt);
  }
  return now;
}

/**
 * 基于可信时间评估许可证状态。纯函数，便于测试。
 *
 * @param stored 本地存储的许可证（含时间锚点）；null 表示未激活
 * @param now    当前本地墙钟 Date.now()
 * @param gracePeriodMs 离线宽限（ms）
 */
export function evaluateLicense(
  stored: ClockAnchor | null,
  now: number,
  gracePeriodMs: number
): LicenseEvalResult {
  if (!stored) {
    return {
      activated: false,
      isExpired: true,
      isOffline: false,
      clockRollback: false,
      trustedNow: now,
      graceRemainingMs: 0,
    };
  }

  // 回拨检测：本地时间不得早于"最后一次验证时的本地时间"超过容差。
  // 必须在同一时间域（本地墙钟）比较；优先用 serverNowLocalAt，老数据回退到 lastVerifiedAt。
  const localAnchor =
    typeof stored.serverNowLocalAt === 'number'
      ? stored.serverNowLocalAt
      : stored.lastVerifiedAt;
  let clockRollback = false;
  if (
    typeof localAnchor === 'number' &&
    now < localAnchor - CLOCK_SKEW_TOLERANCE_MS
  ) {
    clockRollback = true;
  }

  const trustedNow = computeTrustedNow(stored, now);

  // 回拨时不信任本地时间，直接按过期/需重新验证处理
  const isExpired = clockRollback || trustedNow > stored.expiresAt;

  // 离线判断：可信时间与最后一次服务端时间的差值（同一时间域）
  const lastVerifiedServer =
    typeof stored.serverNowAt === 'number'
      ? stored.serverNowAt
      : trustedNow;
  const timeSinceHeartbeat = trustedNow - lastVerifiedServer;
  const isOffline = timeSinceHeartbeat > gracePeriodMs;
  const graceRemainingMs = Math.max(0, gracePeriodMs - timeSinceHeartbeat);

  return {
    activated: true,
    isExpired,
    // 已过期的许可证不再显示为离线（与原逻辑一致）
    isOffline: isExpired ? false : isOffline,
    clockRollback,
    trustedNow,
    graceRemainingMs,
  };
}
