import { getDb } from './AuthDatabase';
import * as jwt from 'jsonwebtoken';
import { CONFIG } from '../config';

export interface HeartbeatResult {
  success: boolean;
  valid?: boolean;
  expiresAt?: number;
  error?: string;
}

export function verifyAndHeartbeat(token: string, deviceFingerprint: string, ip?: string): HeartbeatResult {
  const db = getDb();
  const now = Date.now();

  try {
    // Verify JWT
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET) as any;
    const codeId = decoded.codeId;

    // Get activation code
    const code = db.prepare('SELECT * FROM activation_codes WHERE id = ?').get(codeId) as any;
    if (!code || code.status !== 'used') {
      return { success: false, error: '无效的许可证' };
    }

    if (now > code.expires_at) {
      return { success: false, error: '许可证已过期' };
    }

    // Verify device binding
    const binding = db.prepare('SELECT * FROM device_bindings WHERE activation_code_id = ? AND device_fingerprint = ?').get(codeId, deviceFingerprint) as any;
    if (!binding) {
      return { success: false, error: '设备不匹配' };
    }

    // Update heartbeat
    db.prepare('UPDATE device_bindings SET last_heartbeat_at = ? WHERE id = ?').run(now, binding.id);
    db.prepare('INSERT INTO heartbeat_logs (activation_code_id, device_fingerprint, heartbeat_at, ip_address) VALUES (?, ?, ?, ?)').run(codeId, deviceFingerprint, now, ip);

    return { success: true, valid: true, expiresAt: code.expires_at };
  } catch (e: any) {
    if (e.name === 'TokenExpiredError') {
      return { success: false, error: 'Token已过期' };
    }
    return { success: false, error: '无效的Token' };
  }
}

export function generateToken(codeId: number): string {
  return jwt.sign({ codeId }, CONFIG.JWT_SECRET, { expiresIn: '1y' });
}

export function getActiveDevices(limit: number = 50): any[] {
  const db = getDb();
  // 先取所有激活绑定，按绑定时��降序
  const allBindings = db.prepare(`
    SELECT
      b.device_fingerprint,
      b.bound_at,
      b.last_heartbeat_at,
      c.code,
      c.expires_at
    FROM device_bindings b
    JOIN activation_codes c ON b.activation_code_id = c.id
    WHERE c.status = 'used'
    ORDER BY b.last_heartbeat_at DESC
  `).all() as any[];

  // 按指纹分组
  const grouped = new Map<string, any>();
  for (const row of allBindings) {
    if (!grouped.has(row.device_fingerprint)) {
      grouped.set(row.device_fingerprint, {
        device_fingerprint: row.device_fingerprint,
        last_heartbeat_at: row.last_heartbeat_at,
        expires_at: row.expires_at,
        codes: [] as { code: string; bound_at: number }[],
      });
    }
    const device = grouped.get(row.device_fingerprint)!;
    if (row.last_heartbeat_at > device.last_heartbeat_at) {
      device.last_heartbeat_at = row.last_heartbeat_at;
    }
    if (row.expires_at > device.expires_at) {
      device.expires_at = row.expires_at;
    }
    device.codes.push({ code: row.code, bound_at: row.bound_at });
  }

  return Array.from(grouped.values()).slice(0, limit);
}

export function deleteDevice(fingerprint: string): number {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM device_bindings WHERE device_fingerprint = ?').run(fingerprint);
    db.prepare('DELETE FROM invitations WHERE invitee_fingerprint = ? OR inviter_fingerprint = ?').run(fingerprint, fingerprint);
  });
  transaction();
  return 1; // always returns success since it's a cleanup operation
}
