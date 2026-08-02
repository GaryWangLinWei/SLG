export interface LicenseStatus {
  activated: boolean;
  expiresAt?: number;
  isExpired: boolean;
  isOffline: boolean;
  graceRemainingMinutes?: number;
  deviceFingerprint?: string;
  tier?: 'basic' | 'pro';
  fingerprintMismatch?: boolean;      // 设备指纹不匹配
  storedFingerprint?: string;          // 存储的指纹（用于对比）
  clockRollback?: boolean;             // 检测到本地时钟回拨
}

export interface ActivationData {
  token: string;
  expiresAt: number;
  fingerprint: string;
  activatedAt: number;
  lastHeartbeatAt: number;
}

export interface ActivationResult {
  success: boolean;
  error?: string;
  expiresAt?: number;
  renewType?: string;
  inviteBonus?: boolean;
  inviteError?: string;
  inviterBonusDays?: number;
  inviteeBonusDays?: number;
}

export interface HeartbeatResult {
  success: boolean;
  isOffline: boolean;
  error?: string;
  expiresAt?: number;
  serverNow?: number;
}

export interface StoredLicenseData {
  token: string;
  expiresAt: number;
  fingerprint: string;
  activatedAt: number;
  lastHeartbeatAt: number;
  tier: 'basic' | 'pro';
  /** 最后一次成功心跳时的服务端时间（ms），用于可信时间推算 */
  serverNowAt?: number;
  /** 最后一次成功心跳时的本地墙钟（ms） */
  serverNowLocalAt?: number;
  /** 最后一次可信验证时间（ms，单调下限，用于时钟回拨检测） */
  lastVerifiedAt?: number;
}
