import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-trial-'));
process.env.DB_PATH = path.join(tempDir, 'auth.db');

const { closeDb, getDb } = require('./AuthDatabase') as typeof import('./AuthDatabase');
const { useCode } = require('./ActivationCodeService') as typeof import('./ActivationCodeService');

test.after(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('TRIAL-3DAYS still grants three days of Basic access', () => {
  const before = Date.now();
  const result = useCode('TRIAL-3DAYS', 'new-basic-device');
  const after = Date.now();

  assert.equal(result.success, true);
  assert.equal(result.tier, 'basic');
  assert.ok(result.expiresAt);
  assert.ok(result.expiresAt >= before + 3 * 24 * 60 * 60 * 1000);
  assert.ok(result.expiresAt <= after + 3 * 24 * 60 * 60 * 1000);
});

test('TRIAL-PRO-1DAY grants one day of Pro access only once per device', () => {
  const before = Date.now();
  const first = useCode('TRIAL-PRO-1DAY', 'new-pro-device');
  const after = Date.now();

  assert.equal(first.success, true);
  assert.equal(first.tier, 'pro');
  assert.ok(first.expiresAt);
  assert.ok(first.expiresAt >= before + 24 * 60 * 60 * 1000);
  assert.ok(first.expiresAt <= after + 24 * 60 * 60 * 1000);

  const row = getDb().prepare(`
    SELECT ac.duration_days, ac.type, ac.tier
    FROM activation_codes ac
    JOIN device_bindings db ON db.activation_code_id = ac.id
    WHERE db.device_fingerprint = ?
  `).get('new-pro-device') as { duration_days: number; type: string; tier: string };
  assert.deepEqual(row, { duration_days: 1, type: 'trial', tier: 'pro' });

  assert.deepEqual(useCode('TRIAL-PRO-1DAY', 'new-pro-device'), {
    success: false,
    error: '试用码仅限新用户使用',
  });
});
