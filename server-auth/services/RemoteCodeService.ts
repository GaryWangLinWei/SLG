import { getDb } from './AuthDatabase';
import { randomBytes } from 'crypto';

const CODE_TTL_MS = 10 * 60 * 1000;       // 验证码 10 分钟过期
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 会话 24 小时过期

export interface GenerateCodeResult {
  code: string;
  expiresAt: number;
}

export interface VerifyCodeResult {
  success: boolean;
  sessionToken?: string;
  deviceId?: string;
  expiresAt?: number;
  error?: string;
}

class RemoteCodeService {
  /** 生成 6 位数字验证码，绑定设备 */
  generateCode(deviceId: string, activationCode: string): GenerateCodeResult {
    const db = getDb();
    // 删除该设备未使用的旧验证码
    db.prepare(`DELETE FROM remote_codes WHERE device_id = ? AND used = 0`).run(deviceId);
    // 生成 6 位数字（0~999999，左侧补 0）
    const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const now = Date.now();
    const expiresAt = now + CODE_TTL_MS;
    db.prepare(`
      INSERT INTO remote_codes (code, device_id, activation_code, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(code, deviceId, activationCode, now, expiresAt);
    return { code, expiresAt };
  }

  /** 验证验证码，通过则生成 session token */
  verifyCode(code: string): VerifyCodeResult {
    const db = getDb();
    const row: any = db.prepare(`
      SELECT id, device_id, expires_at, used FROM remote_codes WHERE code = ?
    `).get(code);
    if (!row) return { success: false, error: '验证码不存在' };
    if (row.used) return { success: false, error: '验证码已使用' };
    if (Date.now() > row.expires_at) return { success: false, error: '验证码已过期' };

    // 标记已使用
    db.prepare(`UPDATE remote_codes SET used = 1, used_at = ? WHERE id = ?`).run(Date.now(), row.id);
    // 生成 session token
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    db.prepare(`
      INSERT INTO remote_sessions (session_token, device_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionToken, row.device_id, Date.now(), expiresAt);
    return { success: true, sessionToken, deviceId: row.device_id, expiresAt };
  }

  /** 验证 session token 是否有效 */
  verifySession(sessionToken: string): { valid: boolean; deviceId?: string } {
    const db = getDb();
    const row: any = db.prepare(`
      SELECT device_id, expires_at FROM remote_sessions WHERE session_token = ?
    `).get(sessionToken);
    if (!row) return { valid: false };
    if (Date.now() > row.expires_at) return { valid: false };
    return { valid: true, deviceId: row.device_id };
  }

  /** 清理过期的验证码和会话（每小时调用） */
  cleanup(): void {
    const db = getDb();
    const now = Date.now();
    db.prepare(`DELETE FROM remote_codes WHERE expires_at < ?`).run(now);
    db.prepare(`DELETE FROM remote_sessions WHERE expires_at < ?`).run(now);
  }
}

export const remoteCodeService = new RemoteCodeService();

// 每小时清理一次过期数据
setInterval(() => remoteCodeService.cleanup(), 60 * 60 * 1000);
