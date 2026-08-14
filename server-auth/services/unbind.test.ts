import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbind-'));
process.env.DB_PATH = path.join(tempDir, 'auth.db');

import { getDb, closeDb } from './AuthDatabase';
import { useCode, generateCodes } from './ActivationCodeService';

afterAll(() => { closeDb(); fs.rmSync(tempDir, { recursive: true, force: true }); });

function makeUsedCode(fingerprint: string, expiresAt: number): { id: number; code: string } {
  const [c] = generateCodes(1, 30, 'basic');
  const now = Date.now();
  const db = getDb();
  db.prepare("UPDATE activation_codes SET status='used', used_at=?, expires_at=? WHERE id=?")
    .run(now, expiresAt, c.id);
  db.prepare('INSERT INTO device_bindings (activation_code_id, device_fingerprint, bound_at, last_heartbeat_at) VALUES (?,?,?,?)')
    .run(c.id, fingerprint, now, now);
  return { id: c.id, code: c.code };
}

test('rebind allowed after last_unbound_at set, keeps expires_at/tier', () => {
  const future = Date.now() + 10 * 86400000;
  const { id, code } = makeUsedCode('old-device', future);
  getDb().prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id);
  getDb().prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), id);

  const res = useCode(code, 'new-device');
  expect(res.success).toBe(true);
  expect(res.expiresAt).toBe(future);
  const binding = getDb().prepare('SELECT device_fingerprint FROM device_bindings WHERE activation_code_id=?').get(id) as any;
  expect(binding.device_fingerprint).toBe('new-device');
});

test('rebind rejected when last_unbound_at is NULL (renewal brick)', () => {
  const future = Date.now() + 10 * 86400000;
  const { id, code } = makeUsedCode('old-device', future);
  getDb().prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id);

  const res = useCode(code, 'new-device');
  expect(res.success).toBe(false);
  expect(res.code).toBe('CODE_NOT_REBINDABLE');
});

test('rebind rejected when new device already has another binding', () => {
  const future = Date.now() + 10 * 86400000;
  makeUsedCode('busy-device', future);
  const { id, code } = makeUsedCode('old-device-2', future);
  getDb().prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id);
  getDb().prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), id);

  const res = useCode(code, 'busy-device');
  expect(res.success).toBe(false);
  expect(res.code).toBe('DEVICE_ALREADY_BOUND');
});

test('rebind rejected when code expired', () => {
  const past = Date.now() - 86400000;
  const { id, code } = makeUsedCode('old-device-3', past);
  getDb().prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id);
  getDb().prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), id);

  const res = useCode(code, 'new-device-3');
  expect(res.success).toBe(false);
  expect(res.code).toBe('CODE_EXPIRED');
});
