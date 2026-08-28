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

function makeUsedCode(
  fingerprint: string,
  expiresAt: number,
  tier: 'basic' | 'pro' = 'basic'
): { id: number; code: string } {
  const [c] = generateCodes(1, 30, tier);
  const now = Date.now();
  const db = getDb();
  db.prepare("UPDATE activation_codes SET status='used', used_at=?, expires_at=? WHERE id=?")
    .run(now, expiresAt, c.id);
  db.prepare('INSERT INTO device_bindings (activation_code_id, device_fingerprint, bound_at, last_heartbeat_at) VALUES (?,?,?,?)')
    .run(c.id, fingerprint, now, now);
  return { id: c.id, code: c.code };
}

/** 把一枚已绑定的码变成"已自助解绑、可重绑"状态 */
function unbindForRebind(id: number) {
  const db = getDb();
  db.prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id);
  db.prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), id);
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

test('rebind onto a device holding a same-tier active code merges the remaining time', () => {
  const future = Date.now() + 10 * 86400000;
  const busy = makeUsedCode('busy-device', future);          // 目标设备已有 ~10 天 basic
  const { id, code } = makeUsedCode('old-device-2', future); // 待重绑的码本身也剩 ~10 天
  unbindForRebind(id);

  const res = useCode(code, 'busy-device');
  expect(res.success).toBe(true);
  // 合并：本码到期日 + 设备剩余（~10 天）
  expect(res.expiresAt!).toBeGreaterThan(future + 9.9 * 86400000);
  expect(res.expiresAt!).toBeLessThan(future + 10.1 * 86400000);

  const db = getDb();
  // 到期日已写回数据库
  expect((db.prepare('SELECT expires_at FROM activation_codes WHERE id=?').get(id) as any).expires_at)
    .toBe(res.expiresAt);
  // 设备上只剩新码这一条绑定
  const rows = db.prepare('SELECT activation_code_id FROM device_bindings WHERE device_fingerprint=?').all('busy-device') as any[];
  expect(rows).toHaveLength(1);
  expect(rows[0].activation_code_id).toBe(id);
  // 被吞并的旧码已退役成砖码，不能再拿去别处激活
  expect((db.prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(busy.id) as any).last_unbound_at)
    .toBeNull();
});

test('rebind onto a different-tier device takes over without merging, leaving the old code usable', () => {
  const future = Date.now() + 10 * 86400000;
  const busy = makeUsedCode('mixed-device', future, 'basic'); // 设备上是 basic
  const { id, code } = makeUsedCode('old-device-pro', future, 'pro');
  unbindForRebind(id);
  // 旧 basic 码此前也曾自助解绑过，本身处于可重绑状态
  getDb().prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), busy.id);

  const res = useCode(code, 'mixed-device');
  expect(res.success).toBe(true);
  expect(res.tier).toBe('pro');
  // tier 不同不累加：沿用本码原到期日
  expect(res.expiresAt).toBe(future);

  const db = getDb();
  const rows = db.prepare('SELECT activation_code_id FROM device_bindings WHERE device_fingerprint=?').all('mixed-device') as any[];
  expect(rows).toHaveLength(1);
  expect(rows[0].activation_code_id).toBe(id);
  // 时长没有被吞并，旧 basic 码不应被退役
  expect((db.prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(busy.id) as any).last_unbound_at)
    .not.toBeNull();
});

test('rebind succeeds on a device whose existing binding is expired, clearing the stale binding', () => {
  const past = Date.now() - 5 * 86400000;
  // 该设备残留着一个已过期码的绑定
  const stale = makeUsedCode('expired-device', past);
  // 一枚刚解绑、仍在有效期内的码
  const future = Date.now() + 10 * 86400000;
  const { id, code } = makeUsedCode('old-device-x', future);
  getDb().prepare('DELETE FROM device_bindings WHERE activation_code_id=?').run(id);
  getDb().prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), id);

  const res = useCode(code, 'expired-device');
  expect(res.success).toBe(true);
  expect(res.expiresAt).toBe(future);
  // 过期旧绑定已被清掉，设备现在只绑新码
  const rows = getDb().prepare('SELECT activation_code_id FROM device_bindings WHERE device_fingerprint=?').all('expired-device') as any[];
  expect(rows).toHaveLength(1);
  expect(rows[0].activation_code_id).toBe(id);
  // 过期码本身仍是 used 但无绑定（不强制改它状态）
  const staleBinding = getDb().prepare('SELECT 1 FROM device_bindings WHERE activation_code_id=?').get(stale.id);
  expect(staleBinding).toBeUndefined();
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

test('two sequential rebinds onto one device keep a single binding and stack the time', () => {
  const future = Date.now() + 10 * 86400000;
  const a = makeUsedCode('dev-a', future);
  const b = makeUsedCode('dev-b', future);
  const db = getDb();
  // 两个码都解绑为可重绑
  unbindForRebind(a.id);
  unbindForRebind(b.id);

  expect(useCode(a.code, 'target-device').success).toBe(true);
  // 第二个码重绑到同一设备：同 tier，走合并而非拒绝
  const res = useCode(b.code, 'target-device');
  expect(res.success).toBe(true);
  expect(res.expiresAt!).toBeGreaterThan(future + 9.9 * 86400000);
  // 设备始终只有一条绑定，且指向最后重绑的码
  const rows = db.prepare('SELECT activation_code_id FROM device_bindings WHERE device_fingerprint=?').all('target-device') as any[];
  expect(rows).toHaveLength(1);
  expect(rows[0].activation_code_id).toBe(b.id);
  // 先前那张码的时长已被吞并，退役成砖码
  expect((db.prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(a.id) as any).last_unbound_at)
    .toBeNull();
});

test('first activation retires the absorbed old code so its time cannot be reused', () => {
  const future = Date.now() + 10 * 86400000;
  const old = makeUsedCode('stack-device', future);
  // 旧码曾自助解绑过 —— 漏洞前提：这类码被吞并后仍可重激活
  getDb().prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), old.id);
  const oldCode = (getDb().prepare('SELECT code FROM activation_codes WHERE id=?').get(old.id) as any).code;

  // 一枚全新未用码激活到同一设备，同 tier → 累加旧码剩余
  const [fresh] = generateCodes(1, 30, 'basic');
  const res = useCode(fresh.code, 'stack-device');
  expect(res.success).toBe(true);
  expect(res.expiresAt!).toBeGreaterThan(Date.now() + 39 * 86400000); // ~10 + 30 天

  // 旧码已退役：不能再在别的干净设备上激活
  expect((getDb().prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(old.id) as any).last_unbound_at)
    .toBeNull();
  const reuse = useCode(oldCode, 'another-clean-device');
  expect(reuse.success).toBe(false);
  expect(reuse.code).toBe('CODE_NOT_REBINDABLE');
});

test('first activation with a different tier does not absorb, so the old code stays usable', () => {
  const future = Date.now() + 10 * 86400000;
  const old = makeUsedCode('tier-switch-device', future, 'basic');
  getDb().prepare('UPDATE activation_codes SET last_unbound_at=? WHERE id=?').run(Date.now(), old.id);

  // pro 新码激活到 basic 设备：不累加（重置）
  const [fresh] = generateCodes(1, 30, 'pro');
  const res = useCode(fresh.code, 'tier-switch-device');
  expect(res.success).toBe(true);
  expect(res.tier).toBe('pro');
  expect(res.expiresAt!).toBeLessThan(Date.now() + 31 * 86400000);

  // 旧 basic 码时长未被吞并，仍应保持可重绑
  expect((getDb().prepare('SELECT last_unbound_at FROM activation_codes WHERE id=?').get(old.id) as any).last_unbound_at)
    .not.toBeNull();
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
