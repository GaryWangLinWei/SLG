import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const PRIMARY = 'new-secret-primary';
const LEGACY = 'legacy-secret-old';
let verifyTokenWithRotation;

test('新密钥签发的 token 可通过校验', async () => {
  ({ verifyTokenWithRotation } = await import('../dist/services/HeartbeatService.js'));
  const token = jwt.sign({ codeId: 42 }, PRIMARY, { expiresIn: '1h' });
  const decoded = verifyTokenWithRotation(token, PRIMARY, LEGACY);
  assert.equal(decoded.codeId, 42);
});

test('旧密钥签发的 token 在提供 legacy 密钥时仍可通过（轮换过渡）', async () => {
  ({ verifyTokenWithRotation } = await import('../dist/services/HeartbeatService.js'));
  const token = jwt.sign({ codeId: 7 }, LEGACY, { expiresIn: '1h' });
  const decoded = verifyTokenWithRotation(token, PRIMARY, LEGACY);
  assert.equal(decoded.codeId, 7);
});

test('未知密钥签发的 token 校验失败', async () => {
  ({ verifyTokenWithRotation } = await import('../dist/services/HeartbeatService.js'));
  const token = jwt.sign({ codeId: 1 }, 'unknown-secret', { expiresIn: '1h' });
  assert.throws(() => verifyTokenWithRotation(token, PRIMARY, LEGACY));
});

test('未配置 legacy 时，旧密钥签发的 token 校验失败', async () => {
  ({ verifyTokenWithRotation } = await import('../dist/services/HeartbeatService.js'));
  const token = jwt.sign({ codeId: 3 }, LEGACY, { expiresIn: '1h' });
  assert.throws(() => verifyTokenWithRotation(token, PRIMARY));
});
