import { v4 as uuidv4 } from 'uuid';
import { getDb } from './AuthDatabase';

export interface ActivationCode {
  id: number;
  code: string;
  duration_days: number;
  status: 'unused' | 'used' | 'revoked' | 'exported';
  created_at: number;
  used_at?: number;
  expires_at?: number;
  created_by: string;
}

function generateCode(): string {
  return uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
}

export function generateCodes(count: number, durationDays: number = 30): ActivationCode[] {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO activation_codes (code, duration_days, status, created_at, created_by)
    VALUES (?, ?, 'unused', ?, 'admin')
  `);

  const codes: ActivationCode[] = [];

  for (let i = 0; i < count; i++) {
    const code = generateCode();
    const now = Date.now();

    try {
      const result = insert.run(code, durationDays, now);
      codes.push({
        id: result.lastInsertRowid as number,
        code,
        duration_days: durationDays,
        status: 'unused',
        created_at: now,
        created_by: 'admin'
      });
    } catch (e) {
      i--; // Retry on unique constraint violation
    }
  }

  return codes;
}

export function getCode(code: string): ActivationCode | null {
  const db = getDb();
  return db.prepare('SELECT * FROM activation_codes WHERE code = ?').get(code) as ActivationCode | null;
}

export function getAllCodes(limit: number = 100, offset: number = 0, status?: string): ActivationCode[] {
  const db = getDb();
  if (status) {
    return db.prepare('SELECT * FROM activation_codes WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(status, limit, offset) as ActivationCode[];
  }
  return db.prepare('SELECT * FROM activation_codes ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as ActivationCode[];
}

export function revokeCode(id: number): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE activation_codes SET status = ? WHERE id = ?').run('revoked', id);
  return result.changes > 0;
}

export function useCode(code: string, deviceFingerprint: string): { success: boolean; expiresAt?: number; error?: string; renewType?: string } {
  const db = getDb();
  const now = Date.now();

  const activationCode = getCode(code);
  if (!activationCode) {
    return { success: false, error: '激活码不存在' };
  }

  if (activationCode.status === 'revoked') {
    return { success: false, error: '激活码已被吊销' };
  }

  if (activationCode.status === 'used') {
    // 同一设备续费
    const existingBinding = db.prepare('SELECT * FROM device_bindings WHERE device_fingerprint = ? LIMIT 1').get(deviceFingerprint) as any;

    if (existingBinding) {
      const usedElsewhere = db.prepare('SELECT * FROM device_bindings WHERE activation_code_id = ? AND device_fingerprint != ?').get(activationCode.id, deviceFingerprint);
      if (usedElsewhere) {
        return { success: false, error: '该激活码已绑定到其他设备' };
      }

      // 时间累加
      const remainingMs = Math.max(0, existingBinding.expires_at - now);
      const newExpiresAt = now + remainingMs + activationCode.duration_days * 24 * 60 * 60 * 1000;

      db.prepare(`UPDATE device_bindings SET activation_code_id = ?, last_heartbeat_at = ? WHERE device_fingerprint = ?`)
        .run(activationCode.id, now, deviceFingerprint);

      return { success: true, expiresAt: newExpiresAt, renewType: 'same' };
    }

    return { success: false, error: '激活码已被使用' };
  }

  // 首次激活：绑定设备
  // Check for existing device bindings to accumulate remaining time (renewal with new code)
  const existingBinding = db.prepare(`
    SELECT ac.expires_at
    FROM device_bindings db
    JOIN activation_codes ac ON db.activation_code_id = ac.id
    WHERE db.device_fingerprint = ?
    ORDER BY ac.expires_at DESC
    LIMIT 1
  `).get(deviceFingerprint) as { expires_at?: number } | undefined;

  let remainingMs = 0;
  if (existingBinding?.expires_at) {
    remainingMs = Math.max(0, existingBinding.expires_at - now);
  }

  const expiresAt = now + remainingMs + activationCode.duration_days * 24 * 60 * 60 * 1000;

  const updateCode = db.prepare(`
    UPDATE activation_codes SET status = 'used', used_at = ?, expires_at = ? WHERE id = ?
  `);

  const insertBinding = db.prepare(`
    INSERT INTO device_bindings (activation_code_id, device_fingerprint, bound_at, last_heartbeat_at)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    updateCode.run(now, expiresAt, activationCode.id);
    insertBinding.run(activationCode.id, deviceFingerprint, now, now);
  });

  try {
    transaction();
    return { success: true, expiresAt };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export function getStats(): {
  total: number;
  unused: number;
  used: number;
  revoked: number;
  exported: number;
} {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'unused' THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) as used,
      SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) as revoked,
      SUM(CASE WHEN status = 'exported' THEN 1 ELSE 0 END) as exported
    FROM activation_codes
  `).get() as any;

  return {
    total: row.total || 0,
    unused: row.unused || 0,
    used: row.used || 0,
    revoked: row.revoked || 0,
    exported: row.exported || 0
  };
}

// 查询激活码信息（不消耗，仅用于续费前确认）
export function previewCode(code: string) {
  const activationCode = getCode(code);
  if (!activationCode) {
    return { success: false, error: '激活码不存在' };
  }
  if (activationCode.status === 'revoked') {
    return { success: false, error: '激活码已被吊销' };
  }
  if (activationCode.status === 'used') {
    return { success: false, error: '激活码已被使用' };
  }

  return {
    success: true,
    durationDays: activationCode.duration_days || 30,
  };
}

// 获取指定 ID 的激活码
export function getCodesByIds(ids: number[]): ActivationCode[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM activation_codes WHERE id IN (${placeholders})`).all(...ids) as ActivationCode[];
}

// 导出激活码为 TXT，每行一个激活码
export function exportCodes(ids?: number[]): string {
  const db = getDb();
  let rows: ActivationCode[];

  if (ids && ids.length > 0) {
    rows = getCodesByIds(ids).filter(c => c.status === 'unused');
  } else {
    rows = db.prepare("SELECT * FROM activation_codes WHERE status = 'unused' ORDER BY created_at DESC").all() as ActivationCode[];
  }

  // 标记为 exported
  const update = db.prepare('UPDATE activation_codes SET status = ? WHERE id = ?');
  const transaction = db.transaction(() => {
    for (const row of rows) {
      update.run('exported', row.id);
    }
  });
  transaction();

  // 生成 TXT，每行一个激活码
  return rows.map(r => r.code).join('\n');
}
