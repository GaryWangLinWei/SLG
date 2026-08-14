export interface LicenseStatus {
  activated: boolean;
  expiresAt?: number;
  isExpired: boolean;
  isOffline: boolean;
  graceRemainingMinutes?: number;
  deviceFingerprint?: string;
  tier?: 'basic' | 'pro';
  lastUnboundAt?: number;              // 最近一次解绑时间（用于前端冷却文案）
  fingerprintMismatch?: boolean;      // 设备指纹不匹配
  storedFingerprint?: string;          // 存储的指纹（用于对比）
  clockRollback?: boolean;             // 检测到本地时钟回拨
  trustedNow?: number;                 // 服务端可信当前时间(ms)，前端用于显示剩余时间，避免被本地时钟误导
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
  lastUnboundAt?: number;
}

export interface StoredLicenseData {
  token: string;
  expiresAt: number;
  fingerprint: string;
  activatedAt: number;
  lastHeartbeatAt: number;
  tier: 'basic' | 'pro';
  lastUnboundAt?: number;
  /** 最后一次成功心跳时的服务端时间（ms），用于可信时间推算 */
  serverNowAt?: number;
  /** 最后一次成功心跳时的本地墙钟（ms） */
  serverNowLocalAt?: number;
  /** 最后一次可信验证时间（ms，本地时间域，用于时钟回拨检测） */
  lastVerifiedAt?: number;
  /** 锚点建立时的本地墙钟（ms），用于判断 mono 锚点是否属于本进程 */
  monoWallAt?: number;
  /** 锚点建立时的单调时钟读数（ms），用于防墙钟冻结 */
  monoAt?: number;
}
