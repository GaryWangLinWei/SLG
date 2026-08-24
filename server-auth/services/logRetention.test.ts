import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-retention-'));
process.env.DB_PATH = path.join(tempDir, 'auth.db');

import { getDb, closeDb } from './AuthDatabase';
import { cleanupHeartbeatLogs, HEARTBEAT_LOG_RETENTION_MS } from './HeartbeatService';
import { remoteLogService, MAX_LOGS_PER_DEVICE } from './RemoteLogService';
import { generateCodes } from './ActivationCodeService';

afterAll(() => { closeDb(); fs.rmSync(tempDir, { recursive: true, force: true }); });

// heartbeat_logs 有指向 activation_codes 的外键，先备一个真实的码
let codeId: number;
beforeAll(() => { codeId = generateCodes(1, 30, 'basic')[0].id; });

beforeEach(() => {
  getDb().prepare('DELETE FROM heartbeat_logs').run();
  getDb().prepare('DELETE FROM remote_logs').run();
});

const DAY = 86400000;

function insertHeartbeatLog(heartbeatAt: number): void {
  getDb()
    .prepare('INSERT INTO heartbeat_logs (activation_code_id, device_fingerprint, heartbeat_at, ip_address) VALUES (?,?,?,?)')
    .run(codeId, 'dev-1', heartbeatAt, '1.2.3.4');
}

function heartbeatLogCount(): number {
  return (getDb().prepare('SELECT COUNT(*) n FROM heartbeat_logs').get() as any).n;
}

describe('heartbeat_logs 保留策略', () => {
  it('删除超过保留期的心跳日志，保留期内的不动', () => {
    const now = Date.now();
    insertHeartbeatLog(now - HEARTBEAT_LOG_RETENTION_MS - DAY); // 过期
    insertHeartbeatLog(now - HEARTBEAT_LOG_RETENTION_MS - 1000); // 刚过期
    insertHeartbeatLog(now - DAY); // 保留
    insertHeartbeatLog(now); // 保留

    const deleted = cleanupHeartbeatLogs();

    expect(deleted).toBe(2);
    expect(heartbeatLogCount()).toBe(2);
  });

  it('保留期可传参覆盖', () => {
    const now = Date.now();
    insertHeartbeatLog(now - 2 * DAY);
    insertHeartbeatLog(now);

    expect(cleanupHeartbeatLogs(DAY)).toBe(1);
    expect(heartbeatLogCount()).toBe(1);
  });

  it('没有过期日志时不删任何东西', () => {
    insertHeartbeatLog(Date.now());
    expect(cleanupHeartbeatLogs()).toBe(0);
    expect(heartbeatLogCount()).toBe(1);
  });
});

describe('remote_logs 每设备条数上限', () => {
  it('裁剪到 MAX_LOGS_PER_DEVICE 条，且保留的是最新的', () => {
    const base = Date.now();
    const logs = Array.from({ length: MAX_LOGS_PER_DEVICE + 5 }, (_, i) => ({
      message: `msg-${i}`, level: 'info', timestamp: base + i,
    }));

    remoteLogService.insertLogs('dev-1', 'CODE-1', logs);

    const kept = remoteLogService.getLogs('dev-1', MAX_LOGS_PER_DEVICE + 50);
    expect(kept).toHaveLength(MAX_LOGS_PER_DEVICE);
    // getLogs 返回时间正序，最后一条应是最新写入的
    expect(kept[kept.length - 1].message).toBe(`msg-${MAX_LOGS_PER_DEVICE + 4}`);
    expect(kept[0].message).toBe('msg-5');
  });
});
