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
}

export interface StoredLicenseData {
  token: string;
  expiresAt: number;
  fingerprint: string;
  activatedAt: number;
  lastHeartbeatAt: number;
}
