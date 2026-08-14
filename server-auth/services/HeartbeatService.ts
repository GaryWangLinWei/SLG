import { getDb } from './AuthDatabase';
import * as jwt from 'jsonwebtoken';
import { CONFIG } from '../config';
import { webSocketHub } from './WebSocketHub';

export interface HeartbeatResult {
  success: boolean;
  valid?: boolean;
  expiresAt?: number;
  serverNow?: number;
  tier?: 'basic' | 'pro';
  lastUnboundAt?: number | null;
  error?: string;
}

/**
 * 带轮换支持的 JWT 校验：先试主密钥，失败再试旧密钥（过渡期）。
 * 全部失败时抛出主密钥校验的原始错误。
 */
export function verifyTokenWithRotation(token: string, primary: string, legacy?: string): { codeId: number } {
  try {
    return jwt.verify(token, primary) as { codeId: number };
  } catch (e) {
    if (legacy && legacy !== primary) {
      try {
        return jwt.verify(token, legacy) as { codeId: number };
      } catch { /* 保持抛出主密钥错误 */ }
    }
    throw e;
  }
}

export function verifyAndHeartbeat(token: string, deviceFingerprint: string, ip?: string): HeartbeatResult {
  const db = getDb();
  const now = Date.now();

  try {
    // Verify JWT
    const decoded = verifyTokenWithRotation(token, CONFIG.JWT_SECRET, CONFIG.JWT_SECRET_LEGACY || undefined) as any;
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

    return { success: true, valid: true, expiresAt: code.expires_at, serverNow: now, tier: code.tier || 'basic', lastUnboundAt: code.last_unbound_at ?? null };
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

export function getActiveDevices(limit: number = 10, offset: number = 0, search?: string): { devices: any[]; total: number } {
  const db = getDb();
  // 先取所有激活绑定，按绑定时间降序
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

  let devices = Array.from(grouped.values());

  // 搜索：匹配设备指纹或绑定的激活码
  if (search && search.trim()) {
    const keyword = search.trim().toLowerCase();
    devices = devices.filter(d =>
      d.device_fingerprint.toLowerCase().includes(keyword) ||
      d.codes.some((c: any) => c.code.toLowerCase().includes(keyword))
    );
  }

  const total = devices.length;
  return { devices: devices.slice(offset, offset + limit), total };
}

export function deleteDevice(fingerprint: string): number {
  const db = getDb();
  // 先收集受影响的码，删除后才能把它们标记为可换机
  const affected = db.prepare(
    'SELECT activation_code_id FROM device_bindings WHERE device_fingerprint = ?'
  ).all(fingerprint) as { activation_code_id: number }[];

  const now = Date.now();
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM device_bindings WHERE device_fingerprint = ?').run(fingerprint);
    db.prepare('DELETE FROM invitations WHERE invitee_fingerprint = ? OR inviter_fingerprint = ?').run(fingerprint, fingerprint);
    for (const row of affected) {
      db.prepare('UPDATE activation_codes SET last_unbound_at = ? WHERE id = ?').run(now, row.activation_code_id);
      db.prepare(`
        INSERT INTO unbind_logs (activation_code_id, device_fingerprint, source, ip_address, created_at)
        VALUES (?, ?, 'admin', NULL, ?)
      `).run(row.activation_code_id, fingerprint, now);
    }
  });
  transaction();

  if (affected.length > 0) {
    try { webSocketHub.kick(fingerprint); } catch (e) { console.error('[deleteDevice] kick failed:', e); }
  }
  return affected.length;
}
