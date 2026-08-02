import { getDb } from './AuthDatabase';

const MAX_LOGS_PER_DEVICE = 500;
const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

export interface RemoteLogEntry {
  id: number;
  deviceId: string;
  message: string;
  level: string;
  timestamp: number;
}

class RemoteLogService {
  /** 批量写入日志，并在同一事务内裁剪到每设备最近 500 条 */
  insertLogs(deviceId: string, activationCode: string, logs: Array<{ message: string; level: string; timestamp: number }>): void {
    if (logs.length === 0) return;
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO remote_logs (device_id, activation_code, message, level, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    const trim = db.prepare(`
      DELETE FROM remote_logs
      WHERE device_id = ?
        AND id NOT IN (
          SELECT id FROM remote_logs WHERE device_id = ?
          ORDER BY timestamp DESC LIMIT 500
        )
    `);
    const insertAndTrim = db.transaction((items: typeof logs) => {
      for (const item of items) stmt.run(deviceId, activationCode, item.message, item.level, item.timestamp);
      trim.run(deviceId, deviceId);
    });
    insertAndTrim(logs);
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

  /** 清空指定设备的所有历史日志（点击"开始"时电脑端触发） */
  clearDevice(deviceId: string): void {
    const db = getDb();
    db.prepare(`DELETE FROM remote_logs WHERE device_id = ?`).run(deviceId);
  }

  /** 兜底清理：删除 30 天前的日志（覆盖不再上线的陈旧设备） */
  cleanup(): void {
    const db = getDb();
    const cutoff = Date.now() - LOG_RETENTION_MS;
    db.prepare(`DELETE FROM remote_logs WHERE timestamp < ?`).run(cutoff);
  }
}

export const remoteLogService = new RemoteLogService();

// 每小时兜底清理一次；unref() 避免阻塞进程退出（测试进程不会因此挂起）。
// 与旧的"凌晨 3 点 setTimeout"相比：重启最多延迟 1 小时；try/catch 保证异常不会杀死调度。
const sweepTimer = setInterval(() => {
  try {
    remoteLogService.cleanup();
  } catch (e) {
    console.error('[RemoteLogService] 定时清理失败:', e);
  }
}, 60 * 60 * 1000);
sweepTimer.unref();
