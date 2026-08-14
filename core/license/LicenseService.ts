import { LicenseStatus, ActivationResult, HeartbeatResult, StoredLicenseData } from './types';
import { loadLicense, loadLicenseSync, saveLicense, clearLicense } from './LicenseStorage';
import { generateFingerprint, verifyFingerprint, verifyFingerprintSync } from './DeviceFingerprint';
import { evaluateLicense, ClockReading } from './clockTrust';
import { performance } from 'perf_hooks';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Auth server config - can be overridden by env
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'http://106.15.11.158:3456';

// 离线宽限：最后一次成功心跳后，允许断网/服务端不可用的最长时间。
// 仅用于容忍网络抖动和服务端短暂故障，到期后立即失效（不会额外宽限）。
const GRACE_PERIOD = 12 * 60 * 60 * 1000;

class LicenseService {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  // 本进程启动点：单调时钟在进程重启后归零，用它判断存储的 mono 锚点是否属于本进程
  private readonly sessionStartWall = Date.now();
  private readonly sessionStartMono = performance.now();
  // 是否已有一次"时钟异常自愈心跳"在进行中，避免高频 getStatus 重复发起
  private recoveryInProgress = false;

  private readClock(): ClockReading {
    return {
      wallNow: Date.now(),
      monoNow: performance.now(),
      sessionStartWall: this.sessionStartWall,
      sessionStartMono: this.sessionStartMono,
    };
  }

  async getStatus(): Promise<LicenseStatus> {
    const stored = await loadLicense();

    if (!stored) {
      return { activated: false, isExpired: true, isOffline: false };
    }

    // Verify fingerprint matches current device
    const fingerprintMatches = await verifyFingerprint(stored.fingerprint);
    if (!fingerprintMatches) {
      // 指纹不匹配时，不直接清除许可证，而是标记为失效
      // 这样 ActivationPage 可以提示用户"设备指纹不匹配，请联系客服"
      return {
        activated: false,
        isExpired: false,
        isOffline: false,
        fingerprintMismatch: true,
        storedFingerprint: stored.fingerprint,
      };
    }

    const evalResult = evaluateLicense(stored, this.readClock(), GRACE_PERIOD);

    // 时钟异常自愈：检测到 clockRollback 时在后台触发一次心跳（非阻塞、去抖）。
    // 用户运行中把系统时间调回正确后，无需等 1 小时定时心跳或重启即可解除异常。
    // 纯后端/无人值守场景（前端未主动 syncStatus）也能自愈。
    if (evalResult.clockRollback && !this.recoveryInProgress) {
      this.recoveryInProgress = true;
      this.heartbeat()
        .catch(() => {})
        .finally(() => {
          this.recoveryInProgress = false;
        });
    }

    return {
      activated: true,
      expiresAt: stored.expiresAt,
      isExpired: evalResult.isExpired,
      isOffline: evalResult.isOffline,
      clockRollback: evalResult.clockRollback,
      trustedNow: evalResult.trustedNow,
      graceRemainingMinutes: evalResult.isOffline ? 0 : Math.ceil(evalResult.graceRemainingMs / 60000),
      deviceFingerprint: stored.fingerprint,
      tier: stored.tier || 'basic',
      lastUnboundAt: stored.lastUnboundAt,
    };
  }

  // Synchronous license check for use in non-async callbacks (e.g. checkStop)
  getStatusSync() {
    const stored = loadLicenseSync();
    if (!stored) return { activated: false, isExpired: true, isOffline: false };

    if (!verifyFingerprintSync(stored.fingerprint)) {
      return { activated: false, isExpired: true, isOffline: false };
    }

    const evalResult = evaluateLicense(stored, this.readClock(), GRACE_PERIOD);
    return {
      activated: true,
      isExpired: evalResult.isExpired,
      isOffline: evalResult.isOffline,
    };
  }

  async activate(activationCode: string, inviteCode?: string): Promise<ActivationResult> {
    // 时钟回拨防护：若本地许可证显示系统时间被篡改，拒绝激活/续费。
    // 否则用户可在错误时间下通过输入激活码重新进入，绕过时间校验，
    // 且写入的锚点会被错误的本地墙钟污染。必须先校准时间并联网验证。
    const existingForCheck = await loadLicense().catch(() => null);
    if (existingForCheck) {
      const evalResult = evaluateLicense(existingForCheck, this.readClock(), GRACE_PERIOD);
      if (evalResult.clockRollback) {
        return {
          success: false,
          error: '系统时间异常，请校准到正确的网络时间并联网后重试',
        };
      }
    }

    const fingerprint = await generateFingerprint();

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/api/auth/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: activationCode, fingerprint, inviteCode })
      });

      let data: any = {};
      try { data = await response.json(); } catch { /* 响应非 JSON */ }

      if (!response.ok) {
        return { success: false, error: data?.error || '激活失败，请检查激活码' };
      }

      // Safety: never let expiration go backward from existing license (same tier only)
      const existing = await loadLicense();
      const newTier = (data.tier || 'basic') as 'basic' | 'pro';
      const oldTier = existing?.tier || 'basic';
      const tierChanged = oldTier !== newTier;
      // 同 tier 累加 → 保留更晚的到期时间；不同 tier → 用服务端返回的时间（可能重置）
      const safeExpiresAt = (existing && !tierChanged)
        ? Math.max(data.expiresAt, existing.expiresAt)
        : data.expiresAt;

      const nowLocal = Date.now();
      const licenseData: StoredLicenseData = {
        token: data.token,
        expiresAt: safeExpiresAt,
        fingerprint,
        activatedAt: existing?.activatedAt || nowLocal,
        lastHeartbeatAt: nowLocal,
        tier: newTier,
        lastUnboundAt: typeof data.lastUnboundAt === 'number' ? data.lastUnboundAt : undefined,
        // 激活响应携带服务端时间；旧服务端不返回时用本地时间兜底
        serverNowAt: data.serverNow ?? nowLocal,
        serverNowLocalAt: nowLocal,
        lastVerifiedAt: nowLocal,
        // 单调时钟锚点（本进程），防墙钟冻结/精确回拨
        monoWallAt: nowLocal,
        monoAt: performance.now(),
      };

      await saveLicense(licenseData);
      this.startHeartbeatInterval();

      return {
        success: true,
        expiresAt: safeExpiresAt,
        inviteBonus: data.inviteBonus,
        inviteError: data.inviteError,
        inviterBonusDays: data.inviterBonusDays,
        inviteeBonusDays: data.inviteeBonusDays,
      };
    } catch (e: any) {
      return { success: false, error: '无法连接授权服务器，请检查网络: ' + e.message };
    }
  }

  // 预览激活码信息（续费前使用）
  async preview(activationCode: string): Promise<{ success: boolean; durationDays?: number; changeType?: 'same' | 'up' | 'down'; error?: string }> {
    try {
      const response = await fetch(`${AUTH_SERVER_URL}/api/auth/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: activationCode })
      });
      const data = await response.json() as any;
      if (!response.ok) {
        return { success: false, error: data?.error || '无法预览激活码' };
      }
      return data;
    } catch (e: any) {
      return { success: false, error: '无法连接授权服务器: ' + e.message };
    }
  }

  async heartbeat(): Promise<HeartbeatResult> {
    const stored = await loadLicense();
    if (!stored) {
      return { success: false, isOffline: false, error: '未激活' };
    }

    try {
      const response = await fetch(`${AUTH_SERVER_URL}/api/auth/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${stored.token}`
        },
        body: JSON.stringify({ fingerprint: stored.fingerprint })
      });

      if (response.ok) {
        const data = await response.json() as any;
        const updatedExpiresAt = data?.expiresAt && data.expiresAt > stored.expiresAt
          ? data.expiresAt : stored.expiresAt;
        const updatedTier = (data?.tier || data?.status?.tier) as ('basic' | 'pro') | undefined;
        const nowLocal = Date.now();
        // 服务端时间权威：以服务端返回的 serverNow 为可信时间锚点
        const serverNow = typeof data?.serverNow === 'number' ? data.serverNow : nowLocal;
        await saveLicense({
          ...stored,
          lastHeartbeatAt: nowLocal,
          expiresAt: updatedExpiresAt,
          serverNowAt: serverNow,
          serverNowLocalAt: nowLocal,
          // 回拨检测用本地时间域（与 getStatus 中的 Date.now() 同域）
          lastVerifiedAt: nowLocal,
          // 单调时钟锚点（本进程），每次成功心跳刷新，防墙钟冻结/精确回拨
          monoWallAt: nowLocal,
          monoAt: performance.now(),
          ...(updatedTier ? { tier: updatedTier } : {}),
          ...(typeof data?.lastUnboundAt === 'number' ? { lastUnboundAt: data.lastUnboundAt } : {}),
        });
        return {
          success: true,
          isOffline: false,
          expiresAt: updatedExpiresAt,
          serverNow,
          lastUnboundAt: typeof data?.lastUnboundAt === 'number' ? data.lastUnboundAt : stored.lastUnboundAt,
        };
      }

      // 只有服务端明确以 401 拒绝（过期/无效/设备不匹配）才让本地许可证失效，
      // 这样联网时用户回拨时钟会被服务端权威结果拦下。
      // 5xx（服务端临时故障/重启）不能清空，否则一次服务器抖动就把所有用户踢下线。
      let errMsg = '心跳验证失败';
      try {
        const errData = await response.json() as any;
        errMsg = errData?.error || errMsg;
      } catch { /* 响应非 JSON */ }

      if (response.status === 401) {
        await clearLicense();
        return { success: false, isOffline: false, error: errMsg };
      }
      // 5xx / 其他非预期状态：按离线处理，保留本地许可证，等下次心跳
      return { success: false, isOffline: true, error: errMsg };
    } catch {
      return { success: false, isOffline: true, error: '离线模式 - 无法连接授权服务器' };
    }
  }

  startHeartbeatInterval(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => { this.heartbeat().catch(() => {}); }, 60 * 60 * 1000);
  }

  stopHeartbeatInterval(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  async deactivate(): Promise<void> {
    this.stopHeartbeatInterval();
    await clearLicense();
  }

  /**
   * 请求云端解绑本机。只负责网络请求并返回结果，不清除本地 license、
   * 不碰 RemoteClient —— 由调用方（本地路由层）在成功/401 后决定清本地与停远程。
   */
  async unbind(): Promise<{
    success: boolean;
    alreadyUnbound?: boolean;
    activationCode?: string;
    code?: string;
    error?: string;
    retryAfterMs?: number;
    status?: number;
  }> {
    const stored = await loadLicense();
    if (!stored) {
      return { success: false, code: 'NOT_ACTIVATED', error: '未激活', status: 400 };
    }
    try {
      const response = await fetch(`${AUTH_SERVER_URL}/api/auth/unbind`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${stored.token}`,
        },
        body: JSON.stringify({ fingerprint: stored.fingerprint }),
      });
      let data: any = {};
      try { data = await response.json(); } catch { /* 非 JSON */ }
      if (response.ok) {
        return { success: true, alreadyUnbound: data?.alreadyUnbound, activationCode: data?.activationCode };
      }
      return {
        success: false,
        code: data?.code,
        error: data?.error || '解绑失败',
        retryAfterMs: data?.retryAfterMs,
        status: response.status,
      };
    } catch {
      return { success: false, code: 'NETWORK_ERROR', error: '无法连接授权服务器，请检查网络', status: 502 };
    }
  }

  async init(): Promise<void> {
    // 清理历史版本明文落盘的设备指纹文件。
    // 指纹是解密 license.json 的密钥来源，明文存放会让本机用户能直接解密并篡改。
    try {
      const legacyFile = join(homedir(), '.slg-automation', '设备指纹.txt');
      if (existsSync(legacyFile)) unlinkSync(legacyFile);
    } catch { /* 删除失败不影响正常使用 */ }

    const status = await this.getStatus();
    // 只要许可证存在且指纹匹配（不是设备不匹配），就尝试一次启动心跳：
    // - 正常情况：例行校验；
    // - 时钟异常/离线：可能是用户之前改了时间、现在已恢复，心跳成功能用服务端权威
    //   时间重写被污染的本地锚点，实现自愈；若确实过期，服务端返回 401 会清空许可证。
    if (status.activated || status.clockRollback || status.isOffline) {
      await this.heartbeat().catch(() => {});
      this.startHeartbeatInterval();
    }
  }
}

export const licenseService = new LicenseService();
