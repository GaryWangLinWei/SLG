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
}

export interface StoredLicenseData {
  token: string;
  expiresAt: number;
  fingerprint: string;
  activatedAt: number;
  lastHeartbeatAt: number;
  tier: 'basic' | 'pro';
}
