import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DAY = 86400000;
let remoteLogService, getDb, closeDb, tmpDir;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'retention-'));
  process.env.DB_PATH = join(tmpDir, 'auth.db');
  ({ remoteLogService } = await import('../dist/services/RemoteLogService.js'));
  ({ getDb, closeDb } = await import('../dist/services/AuthDatabase.js'));
  getDb(); // 初始化表结构
});

after(() => {
  if (closeDb) closeDb(); // 释放 SQLite 句柄，否则 Windows 上无法删除临时目录
  rmSync(tmpDir, { recursive: true, force: true });
});

function push(deviceId, n, tsOffset = 0) {
  const now = Date.now();
  const logs = Array.from({ length: n }, (_, i) => ({
    message: `log-${deviceId}-${i}`,
    level: 'info',
    timestamp: now + tsOffset + i,
  }));
  remoteLogService.insertLogs(deviceId, 'TEST-CODE', logs);
}

function count(deviceId) {
  return remoteLogService.getLogs(deviceId, 1000000).length;
}

test('插入 600 条后仅保留最近 500 条', () => {
  push('d1', 600);
  assert.equal(count('d1'), 500);
});

test('多设备各自独立裁剪', () => {
  push('d2', 600);
  push('d3', 600);
  assert.equal(count('d2'), 500);
  assert.equal(count('d3'), 500);
});

test('恰好 500 条时不删', () => {
  push('d4', 500);
  assert.equal(count('d4'), 500);
});

test('501 条删 1 条', () => {
  push('d5', 501);
  assert.equal(count('d5'), 500);
});

test('时间戳乱序仍按 timestamp 保留最近 500 条', () => {
  const firstBatchMinTs = Date.now();
  push('d6', 500);
  push('d6', 100, -1000000); // 100 条更旧时间戳的日志
  assert.equal(count('d6'), 500); // 应保留最先插入的 500 条（时间戳更新）
  const kept = remoteLogService.getLogs('d6', 1000000);
  assert.ok(
    kept.every((log) => log.timestamp >= firstBatchMinTs),
    '保留的 500 条应全部来自第一批（时间戳 ≥ 首批最小时间戳）'
  );
});

test('30 天前的日志被兜底清理删除', () => {
  push('d7', 10);
  getDb().prepare('UPDATE remote_logs SET timestamp = ? WHERE device_id = ?')
    .run(Date.now() - 31 * DAY, 'd7');
  remoteLogService.cleanup();
  assert.equal(count('d7'), 0);
});
