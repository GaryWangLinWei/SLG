import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unbind-'));
process.env.DB_PATH = path.join(tempDir, 'auth.db');

import { getDb, closeDb } from './AuthDatabase';
import { useCode, generateCodes } from './ActivationCodeService';
import { generateToken, deleteDevice } from './HeartbeatService';
import { unbindCode, markCodeRebindable } from './ActivationCodeService';

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
  // 剩余时间不补、last_unbound_at 不被清空
  const row = getDb().prepare('SELECT expires_at, last_unbound_at FROM activation_codes WHERE id=?').get(id) as any;
  expect(row.expires_at).toBe(future);
  expect(row.last_unbound_at).not.toBeNull();
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

test('reactivating on same device that already holds the binding succeeds', () => {
  const future = Date.now() + 10 * 86400000;
  const { code } = makeUsedCode('same-device', future);
  // 未删绑定、未改 last_unbound_at —— 走"已绑当前设备"分支
  const res = useCode(code, 'same-device');
  expect(res.success).toBe(true);
  expect(res.expiresAt).toBe(future);
});

test('unique index prevents two codes binding the same device (concurrent rebind backstop)', () => {
  const future = Date.now() + 10 * 86400000;
  const a = makeUsedCode('dev-a', future);
  const b = makeUsedCode('dev-b', future);
  const db = getDb();
  // 两个码都解绑为可重绑
  db.prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(a.id);
  db.prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(b.id);
  db.prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), a.id);
  db.prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), b.id);

  expect(useCode(a.code, 'target-device').success).toBe(true);
  // 第二个码重绑到同一设备：SELECT 预检或唯一索引兜底，都应拒绝而非抛错
  const res = useCode(b.code, 'target-device');
  expect(res.success).toBe(false);
  expect(res.code).toBe('DEVICE_ALREADY_BOUND');
  expect(db.prepare('SELECT COUNT(*) n FROM device_bindings WHERE device_fingerprint=?').get('target-device')).toEqual({ n: 1 });
});

test('unbindCode deletes binding, sets last_unbound_at, writes audit, clears remote_*', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('unbind-dev', future);
  const db = getDb();
  db.prepare('INSERT INTO remote_devices (device_id, short_id, password_hash, salt, activation_code, updated_at) VALUES (?,?,?,?,?,?)')
    .run('unbind-dev', 's1', 'h', 's', 'unbind-dev', Date.now());

  const token = generateToken(id);
  const res = unbindCode(token, 'unbind-dev', '1.2.3.4');
  expect(res.success).toBe(true);

  const code = db.prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(id) as any;
  expect(code.last_unbound_at).not.toBeNull();
  expect(db.prepare('SELECT COUNT(*) n FROM device_bindings WHERE activation_code_id=?').get(id)).toEqual({ n: 0 });
  expect(db.prepare('SELECT COUNT(*) n FROM remote_devices WHERE device_id=?').get('unbind-dev')).toEqual({ n: 0 });
  const log = db.prepare('SELECT source, ip_address FROM unbind_logs WHERE activation_code_id=?').get(id) as any;
  expect(log.source).toBe('user');
  expect(log.ip_address).toBe('1.2.3.4');
});

test('unbindCode enforces 30-day cooldown', () => {
  const future = Date.now() + 10 * 86400000;
  const { id, code } = makeUsedCode('cd-dev', future);
  const db = getDb();
  const token = generateToken(id);
  unbindCode(token, 'cd-dev');
  // 重新绑定到原设备以模拟"解绑→重绑"
  db.prepare('INSERT INTO device_bindings (activation_code_id, device_fingerprint, bound_at, last_heartbeat_at) VALUES (?,?,?,?)')
    .run(id, 'cd-dev', Date.now(), Date.now());

  const res = unbindCode(token, 'cd-dev');
  expect(res.success).toBe(false);
  expect(res.code).toBe('COOLDOWN_ACTIVE');
  expect(res.retryAfterMs).toBeGreaterThan(29 * 86400000);
  void code;
});

test('unbindCode is idempotent when already unbound, returns prior lastUnboundAt', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('idem-dev', future);
  const token = generateToken(id);
  const first = unbindCode(token, 'idem-dev');
  const recorded = (getDb().prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(id) as any).last_unbound_at;
  expect(first.lastUnboundAt).toBe(recorded);

  const again = unbindCode(token, 'idem-dev');
  expect(again.success).toBe(true);
  expect(again.alreadyUnbound).toBe(true);
  expect(again.lastUnboundAt).toBe(recorded);
  // 幂等不应重复写审计
  expect(getDb().prepare('SELECT COUNT(*) n FROM unbind_logs WHERE activation_code_id=?').get(id)).toEqual({ n: 1 });
});

test('unbindCode stores NULL ip when ip omitted', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('noip-dev', future);
  const res = unbindCode(generateToken(id), 'noip-dev');
  expect(res.success).toBe(true);
  const log = getDb().prepare('SELECT ip_address FROM unbind_logs WHERE activation_code_id=?').get(id) as any;
  expect(log.ip_address).toBeNull();
});

test('unbindCode rejects invalid token with INVALID_TOKEN 401', () => {
  const res = unbindCode('not-a-real-token', 'whatever-dev');
  expect(res.success).toBe(false);
  expect(res.code).toBe('INVALID_TOKEN');
  expect(res.httpStatus).toBe(401);
});

test('unbindCode rejects expired code', () => {
  const past = Date.now() - 86400000;
  const { id } = makeUsedCode('exp-dev', past);
  const res = unbindCode(generateToken(id), 'exp-dev');
  expect(res.success).toBe(false);
  expect(res.code).toBe('CODE_EXPIRED');
  expect(res.httpStatus).toBe(409);
});

test('unbindCode rejects fingerprint mismatch with 403 code', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('real-dev', future);
  const token = generateToken(id);
  const res = unbindCode(token, 'attacker-dev');
  expect(res.success).toBe(false);
  expect(res.code).toBe('FINGERPRINT_MISMATCH');
});

test('unbindCode rejects trial code', () => {
  const now = Date.now();
  const db = getDb();
  const r = db.prepare("INSERT INTO activation_codes (code, duration_days, status, type, tier, created_at, used_at, expires_at) VALUES ('TX1',1,'used','trial','basic',?,?,?)")
    .run(now, now, now + 86400000);
  const id = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO device_bindings (activation_code_id, device_fingerprint, bound_at, last_heartbeat_at) VALUES (?,?,?,?)')
    .run(id, 'trial-dev', now, now);
  const res = unbindCode(generateToken(id), 'trial-dev');
  expect(res.success).toBe(false);
  expect(res.code).toBe('TRIAL_CODE');
});

test('deleteDevice returns real count, writes last_unbound_at and admin audit', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('adm-dev', future);
  const count = deleteDevice('adm-dev');
  expect(count).toBe(1);
  const db = getDb();
  const code = db.prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(id) as any;
  expect(code.last_unbound_at).not.toBeNull();
  const log = db.prepare('SELECT source FROM unbind_logs WHERE activation_code_id=?').get(id) as any;
  expect(log.source).toBe('admin');
  // 绑定确实被删
  expect(db.prepare('SELECT COUNT(*) n FROM device_bindings WHERE device_fingerprint=?').get('adm-dev')).toEqual({ n: 0 });
});

test('deleteDevice on unknown fingerprint returns 0 and writes no audit', () => {
  const before = (getDb().prepare('SELECT COUNT(*) n FROM unbind_logs').get() as any).n;
  const count = deleteDevice('no-such-device');
  expect(count).toBe(0);
  const after = (getDb().prepare('SELECT COUNT(*) n FROM unbind_logs').get() as any).n;
  expect(after).toBe(before);
});

test('markCodeRebindable succeeds for used code without binding', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('brick-dev', future);
  getDb().prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id); // 历史砖码
  const res = markCodeRebindable(id);
  expect(res.success).toBe(true);
  const code = getDb().prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(id) as any;
  expect(code.last_unbound_at).not.toBeNull();
});

test('markCodeRebindable rejects code that still has a binding', () => {
  const future = Date.now() + 10 * 86400000;
  const { id } = makeUsedCode('bound-dev', future);
  const res = markCodeRebindable(id);
  expect(res.success).toBe(false);
  expect(res.code).toBe('MARKREBIND_STILL_BOUND');
});

test('markCodeRebindable rejects unused code and unknown id', () => {
  const db = getDb();
  const [c] = generateCodes(1, 30, 'basic'); // unused
  const unusedRes = markCodeRebindable(c.id);
  expect(unusedRes.success).toBe(false);
  expect(unusedRes.code).toBe('CODE_NOT_USED');

  const revoked = makeUsedCode('rev-dev', Date.now() + 86400000);
  db.prepare("UPDATE activation_codes SET status='revoked' WHERE id=?").run(revoked.id);
  const revokedRes = markCodeRebindable(revoked.id);
  expect(revokedRes.success).toBe(false);
  expect(revokedRes.code).toBe('CODE_NOT_USED');

  const missingRes = markCodeRebindable(99999999);
  expect(missingRes.success).toBe(false);
  expect(missingRes.code).toBe('CODE_NOT_FOUND');
});
