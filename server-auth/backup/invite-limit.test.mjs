import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let processInviteCode, getDb, closeDb, tmpDir;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'invite-'));
  process.env.DB_PATH = join(tmpDir, 'auth.db');
  ({ processInviteCode } = await import('../dist/services/ActivationCodeService.js'));
  ({ getDb } = await import('../dist/services/AuthDatabase.js'));
  ({ closeDb } = await import('../dist/services/AuthDatabase.js'));
  getDb().prepare(`
    INSERT INTO activation_codes (code, duration_days, status, type, created_at, created_by)
    VALUES ('INV-TEST', 3, 'unused', 'invite', ?, ?)
  `).run(Date.now(), 'inviter-fp');
});

after(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

test('不能使用自己的邀请码（拦截自邀请）', () => {
  const r = processInviteCode('INV-TEST', 'inviter-fp');
  assert.equal(r.success, false);
  assert.match(r.error, /自己/);
});

test('邀请码最多被 5 个不同邀请人使用，第 6 个被拒', () => {
  for (let i = 1; i <= 5; i++) {
    const r = processInviteCode('INV-TEST', `invitee-${i}`);
    assert.equal(r.success, true, `第 ${i} 个邀请人应成功: ${r.error}`);
  }
  const sixth = processInviteCode('INV-TEST', 'invitee-6');
  assert.equal(sixth.success, false);
  assert.match(sixth.error, /上限/);
});

test('同一邀请人不能重复领取邀请奖励', () => {
  const first = processInviteCode('INV-TEST', 'invitee-1');
  assert.equal(first.success, false);
  assert.match(first.error, /已领取/);
});
