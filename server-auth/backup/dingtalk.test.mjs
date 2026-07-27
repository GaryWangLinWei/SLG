import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { signDingtalk, sendDingtalk } from './dingtalk.mjs';

const FAKE_SECRET = 'SEC-fake-test-vector-not-real';
const FAKE_TIMESTAMP = 1700000000000;
// Independently derived expected signature — the test asserts the implementation matches.
const EXPECTED_SIGN = createHmac('sha256', FAKE_SECRET)
  .update(`${FAKE_TIMESTAMP}\n${FAKE_SECRET}`).digest('base64');
// A hardcoded literal vector kept for regression protection against future refactors.
const HARDCODED_VECTOR_TS = 1000000000000;
const HARDCODED_VECTOR_SECRET = 'secret-A';
const HARDCODED_VECTOR_SIGN = 'yRdlCGp7F55mtZhVZr3L8qZtxWleZ7YEWKe15KRW+NY=';

test('signDingtalk returns HMAC-SHA256 base64 of `${timestamp}\\n${secret}`', () => {
  const sign = signDingtalk(FAKE_TIMESTAMP, FAKE_SECRET);
  assert.equal(sign, EXPECTED_SIGN);
  // Independent hardcoded vector — locks in the exact algorithm.
  assert.equal(signDingtalk(HARDCODED_VECTOR_TS, HARDCODED_VECTOR_SECRET), HARDCODED_VECTOR_SIGN);
});

test('signDingtalk rejects non-string secret or non-finite timestamp', () => {
  assert.throws(() => signDingtalk('later', FAKE_SECRET), /timestamp/i);
  assert.throws(() => signDingtalk(FAKE_TIMESTAMP, ''), /secret/i);
});

test('sendDingtalk posts URL-encoded timestamp and sign, JSON text body, and returns response info', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => '{"errcode":0,"errmsg":"ok"}' };
  };
  const result = await sendDingtalk({
    webhook: 'https://oapi.dingtalk.com/robot/send?access_token=fake-token',
    secret: FAKE_SECRET,
    text: 'backup ok',
    fetchImpl,
    now: () => FAKE_TIMESTAMP,
  });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('timestamp'), String(FAKE_TIMESTAMP));
  assert.equal(url.searchParams.get('sign'), EXPECTED_SIGN);
  // The raw URL must contain the URL-encoded sign (e.g. `%3D` when base64 padding is present).
  assert.match(calls[0].url, /timestamp=\d+/);
  assert.ok(calls[0].url.includes(`sign=${encodeURIComponent(EXPECTED_SIGN)}`),
    `raw URL must contain URL-encoded sign, got: ${calls[0].url}`);
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[0].init.headers['Content-Type'] ?? calls[0].init.headers['content-type'] ?? '', /application\/json/i);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.msgtype, 'text');
  assert.equal(body.text.content, 'backup ok');
  assert.equal(result.status, 200);
});

test('sendDingtalk rejects non-2xx HTTP responses', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'oops' });
  await assert.rejects(sendDingtalk({
    webhook: 'https://oapi.dingtalk.com/robot/send?access_token=fake-token',
    secret: FAKE_SECRET, text: 'backup fail', fetchImpl, now: () => FAKE_TIMESTAMP,
  }), /500/);
});

test('sendDingtalk rejects when webhook is not HTTPS', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '' });
  await assert.rejects(sendDingtalk({
    webhook: 'http://oapi.dingtalk.com/robot/send?access_token=fake', secret: FAKE_SECRET,
    text: 'x', fetchImpl, now: () => FAKE_TIMESTAMP,
  }), /HTTPS/i);
});

test('sendDingtalk rejects blank text bodies to enforce redaction upstream', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '' });
  for (const bad of ['', '   ', null, undefined]) {
    await assert.rejects(sendDingtalk({
      webhook: 'https://oapi.dingtalk.com/robot/send?access_token=fake', secret: FAKE_SECRET,
      text: bad, fetchImpl, now: () => FAKE_TIMESTAMP,
    }), /text/i);
  }
});
