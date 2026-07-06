import { getDb } from './AuthDatabase';
import { randomBytes, pbkdf2Sync } from 'crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // sessionToken 30 天滑动续期
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 32;

/** 32 位设备指纹 → 9 位识别码（前 9 位大写） */
function toShortId(deviceId: string): string {
  return deviceId.slice(0, 9).toUpperCase();
}

function hashPassword(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, 'sha256').toString('hex');
}

export interface SetPasswordResult {
  success: boolean;
  shortId?: string;
  error?: string;
}

export interface VerifyPasswordResult {
  success: boolean;
  sessionToken?: string;
  deviceId?: string;
  expiresAt?: number;
  error?: string;
}

class RemoteDeviceService {
  /** 电脑端设置/修改访问密码 */
  setPassword(deviceId: string, activationCode: string, password: string): SetPasswordResult {
    if (!/^\d{6}$/.test(password)) {
      return { success: false, error: '密码必须是 6 位数字' };
    }
    const db = getDb();
    const salt = randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const shortId = toShortId(deviceId);
    db.prepare(`
      INSERT INTO remote_devices (device_id, short_id, password_hash, salt, activation_code, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        password_hash = excluded.password_hash,
        salt = excluded.salt,
        activation_code = excluded.activation_code,
        updated_at = excluded.updated_at
    `).run(deviceId, shortId, hash, salt, activationCode, Date.now());
    return { success: true, shortId };
  }

  /** 查询设备是否已设置密码 */
  hasPassword(deviceId: string): boolean {
    const db = getDb();
    const row = db.prepare(`SELECT 1 FROM remote_devices WHERE device_id = ?`).get(deviceId);
    return !!row;
  }

  /** 手机端登录：短识别码 + 密码 → sessionToken */
  verifyPassword(shortId: string, password: string): VerifyPasswordResult {
    if (!/^[A-Z0-9]{9}$/.test(shortId.toUpperCase())) {
      return { success: false, error: '识别码格式错误' };
    }
    if (!/^\d{6}$/.test(password)) {
      return { success: false, error: '密码格式错误' };
    }
    const db = getDb();
    const row: any = db.prepare(`
      SELECT device_id, password_hash, salt FROM remote_devices WHERE short_id = ?
    `).get(shortId.toUpperCase());
    if (!row) return { success: false, error: '识别码不存在' };
    const expected = hashPassword(password, row.salt);
    if (expected !== row.password_hash) return { success: false, error: '密码错误' };
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    db.prepare(`
      INSERT INTO remote_sessions (session_token, device_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionToken, row.device_id, Date.now(), expiresAt);
    return { success: true, sessionToken, deviceId: row.device_id, expiresAt };
  }

  /** 验证 session token，通过则滑动续期 30 天 */
  verifySession(sessionToken: string): { valid: boolean; deviceId?: string } {
    const db = getDb();
    const row: any = db.prepare(`
      SELECT device_id, expires_at FROM remote_sessions WHERE session_token = ?
    `).get(sessionToken);
    if (!row) return { valid: false };
    if (Date.now() > row.expires_at) return { valid: false };
    // 滑动续期
    const newExpires = Date.now() + SESSION_TTL_MS;
    db.prepare(`UPDATE remote_sessions SET expires_at = ? WHERE session_token = ?`).run(newExpires, sessionToken);
    return { valid: true, deviceId: row.device_id };
  }

  /** 清理过期会话（每小时） */
  cleanup(): void {
    const db = getDb();
    db.prepare(`DELETE FROM remote_sessions WHERE expires_at < ?`).run(Date.now());
  }
}

export const remoteDeviceService = new RemoteDeviceService();
setInterval(() => remoteDeviceService.cleanup(), 60 * 60 * 1000);
