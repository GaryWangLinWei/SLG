import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-trial-'));
process.env.DB_PATH = path.join(tempDir, 'auth.db');

import { getDb, closeDb } from './AuthDatabase';
import { useCode } from './ActivationCodeService';

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('TRIAL-3DAYS still grants three days of Basic access', () => {
  const before = Date.now();
  const result = useCode('TRIAL-3DAYS', 'new-basic-device');
  const after = Date.now();

  expect(result.success).toBe(true);
  expect(result.tier).toBe('basic');
  expect(result.expiresAt).toBeGreaterThanOrEqual(before + 3 * 86400000);
  expect(result.expiresAt).toBeLessThanOrEqual(after + 3 * 86400000);
});

test('TRIAL-PRO-1DAY grants one day of Pro access only once per device', () => {
  const before = Date.now();
  const first = useCode('TRIAL-PRO-1DAY', 'new-pro-device');
  const after = Date.now();

  expect(first.success).toBe(true);
  expect(first.tier).toBe('pro');
  expect(first.expiresAt).toBeGreaterThanOrEqual(before + 86400000);
  expect(first.expiresAt).toBeLessThanOrEqual(after + 86400000);

  const row = getDb().prepare(`
    SELECT ac.duration_days, ac.type, ac.tier
    FROM activation_codes ac
    JOIN device_bindings db ON db.activation_code_id = ac.id
    WHERE db.device_fingerprint = ?
  `).get('new-pro-device') as { duration_days: number; type: string; tier: string };
  expect(row).toEqual({ duration_days: 1, type: 'trial', tier: 'pro' });

  const again = useCode('TRIAL-PRO-1DAY', 'new-pro-device');
  expect(again.success).toBe(false);
  expect(again.error).toBe('试用码仅限新用户使用');
});
