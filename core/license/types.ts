export interface LicenseStatus {
  activated: boolean;
  expiresAt?: number;
  isExpired: boolean;
  isOffline: boolean;
  graceRemainingMinutes?: number;
  deviceFingerprint?: string;
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
  renewType?: 'same' | 'up' | 'down';  // same=续费累加, up/down=时间重置
}

export interface HeartbeatResult {
  success: boolean;
  isOffline: boolean;
  error?: string;
}

export interface StoredLicenseData {
  token: string;
  expiresAt: number;
  fingerprint: string;
  activatedAt: number;
  lastHeartbeatAt: number;
}
