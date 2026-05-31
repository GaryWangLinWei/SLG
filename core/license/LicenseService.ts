import { LicenseStatus, ActivationResult, HeartbeatResult, StoredLicenseData } from './types';
import { loadLicense, loadLicenseSync, saveLicense, clearLicense } from './LicenseStorage';
import { generateFingerprint, verifyFingerprint, verifyFingerprintSync } from './DeviceFingerprint';

// Auth server config - can be overridden by env
const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'http://106.15.11.158:3456';

class LicenseService {
  private heartbeatTimer: NodeJS.Timeout | null = null;

  async getStatus(): Promise<LicenseStatus> {
    const stored = await loadLicense();

    if (!stored) {
      return { activated: false, isExpired: true, isOffline: false };
    }

    // Verify fingerprint matches current device
    const fingerprintMatches = await verifyFingerprint(stored.fingerprint);
    if (!fingerprintMatches) {
      await clearLicense();
      return { activated: false, isExpired: true, isOffline: false };
    }

    const now = Date.now();
    const isExpired = now > stored.expiresAt;

    const GRACE_PERIOD = 24 * 60 * 60 * 1000;
    const timeSinceHeartbeat = now - stored.lastHeartbeatAt;
    const isOffline = timeSinceHeartbeat > GRACE_PERIOD;
    const graceRemainingMs = Math.max(0, GRACE_PERIOD - timeSinceHeartbeat);

    return {
      activated: true,
      expiresAt: stored.expiresAt,
      isExpired,
      isOffline: isExpired ? false : isOffline,
      graceRemainingMinutes: isOffline ? 0 : Math.ceil(graceRemainingMs / 60000),
      deviceFingerprint: stored.fingerprint,
    };
  }

  // Synchronous license check for use in non-async callbacks (e.g. checkStop)
  getStatusSync() {
    const stored = loadLicenseSync();
    if (!stored) return { activated: false, isExpired: true };

    if (!verifyFingerprintSync(stored.fingerprint)) {
      return { activated: false, isExpired: true };
    }

    return {
      activated: true,
      isExpired: Date.now() > stored.expiresAt,
    };
  }

  async activate(activationCode: string, inviteCode?: string): Promise<ActivationResult> {
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

      // Safety: never let expiration go backward from existing license
      const existing = await loadLicense();
      const safeExpiresAt = existing
        ? Math.max(data.expiresAt, existing.expiresAt)
        : data.expiresAt;

      const licenseData: StoredLicenseData = {
        token: data.token,
        expiresAt: safeExpiresAt,
        fingerprint,
        activatedAt: existing?.activatedAt || Date.now(),
        lastHeartbeatAt: Date.now(),
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
        await saveLicense({ ...stored, lastHeartbeatAt: Date.now(), expiresAt: updatedExpiresAt });
        return { success: true, isOffline: false, expiresAt: updatedExpiresAt };
      }

      return { success: false, isOffline: false, error: (await response.json() as any).error || '心跳验证失败' };
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

  async init(): Promise<void> {
    const status = await this.getStatus();
    if (status.activated && !status.isExpired) {
      await this.heartbeat().catch(() => {});
      this.startHeartbeatInterval();
    }
  }
}

export const licenseService = new LicenseService();
