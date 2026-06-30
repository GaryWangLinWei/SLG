import { getDb } from './AuthDatabase';

const MAX_LOGS_PER_DEVICE = 10000;
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

export interface RemoteLogEntry {
  id: number;
  deviceId: string;
  message: string;
  level: string;
  timestamp: number;
}

class RemoteLogService {
  /** 批量写入日志 */
  insertLogs(deviceId: string, activationCode: string, logs: Array<{ message: string; level: string; timestamp: number }>): void {
    if (logs.length === 0) return;
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO remote_logs (device_id, activation_code, message, level, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((items: typeof logs) => {
      for (const item of items) stmt.run(deviceId, activationCode, item.message, item.level, item.timestamp);
    });
    insertMany(logs);
  }

  /** 查询设备最近 N 条日志（按时间倒序） */
  getLogs(deviceId: string, limit: number = 200): RemoteLogEntry[] {
    const db = getDb();
    const rows: any[] = db.prepare(`
      SELECT id, device_id as deviceId, message, level, timestamp
      FROM remote_logs
      WHERE device_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(deviceId, limit);
    return rows.reverse(); // 返回时按时间正序
  }

  /** 清理：删除 7 天前的日志 + 单设备超过 10000 条的部分 */
  cleanup(): void {
    const db = getDb();
    const cutoff = Date.now() - LOG_RETENTION_MS;
    db.prepare(`DELETE FROM remote_logs WHERE timestamp < ?`).run(cutoff);

    // 单设备最多保留最近 10000 条
    const devices: any[] = db.prepare(`
      SELECT device_id, COUNT(*) as cnt FROM remote_logs GROUP BY device_id HAVING cnt > ?
    `).all(MAX_LOGS_PER_DEVICE);

    for (const d of devices) {
      db.prepare(`
        DELETE FROM remote_logs
        WHERE device_id = ?
          AND id NOT IN (
            SELECT id FROM remote_logs WHERE device_id = ?
            ORDER BY timestamp DESC LIMIT ?
          )
      `).run(d.device_id, d.device_id, MAX_LOGS_PER_DEVICE);
    }
  }
}

export const remoteLogService = new RemoteLogService();

// 每天凌晨 3 点清理一次
function scheduleNextCleanup() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    remoteLogService.cleanup();
    scheduleNextCleanup();
  }, next.getTime() - now.getTime());
}
scheduleNextCleanup();
