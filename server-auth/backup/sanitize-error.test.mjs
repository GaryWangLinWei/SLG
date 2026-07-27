import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeErrorForLog } from './sanitize-error.mjs';

// --- Simple field=value patterns ---

test('sanitizeErrorForLog masks stsToken value in message and stack', () => {
  const error = new Error('OSS PUT failed stsToken=CAIS0wJ1q6Ft5B2yfSjIr5DBIe/qgpNS87yYVE');
  error.stack = `Error: PUT failed stsToken=CAIS0wJ1q6Ft5B2yfSjIr5DBIe/qgpNS87yYVE\n    at handler (oss.mjs:1:1)`;
  const sanitized = sanitizeErrorForLog(error);
  assert.doesNotMatch(sanitized.message, /CAIS0wJ1q6Ft5B2yfSjIr5DBIe\/qgpNS87yYVE/);
  assert.doesNotMatch(sanitized.stack, /CAIS0wJ1q6Ft5B2yfSjIr5DBIe\/qgpNS87yYVE/);
  assert.match(sanitized.message, /stsToken=\[REDACTED\]/);
  assert.match(sanitized.stack, /stsToken=\[REDACTED\]/);
});

test('sanitizeErrorForLog masks accessKeyId, accessKeySecret, Authorization header, and IMDS token', () => {
  const message = [
    'Signature calculation failed:',
    'accessKeyId=LTAI5tFakeExampleKeyId0000',
    'accessKeySecret=FakeSecretValueThatIsLongEnoughXYZ',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.PayloadValueHere.SignatureBits',
    'X-aliyun-ecs-metadata-token: 22a5b3c1d9e7f4-example-imds-token-XYZ',
  ].join(' ');
  const sanitized = sanitizeErrorForLog(new Error(message));
  assert.doesNotMatch(sanitized.message, /LTAI5tFakeExampleKeyId0000/);
  assert.doesNotMatch(sanitized.message, /FakeSecretValueThatIsLongEnoughXYZ/);
  assert.doesNotMatch(sanitized.message, /eyJhbGciOiJIUzI1NiJ9\.PayloadValueHere\.SignatureBits/);
  assert.doesNotMatch(sanitized.message, /22a5b3c1d9e7f4-example-imds-token-XYZ/);
  assert.match(sanitized.message, /accessKeyId=\[REDACTED\]/);
  assert.match(sanitized.message, /accessKeySecret=\[REDACTED\]/);
  assert.match(sanitized.message, /Authorization:\s*\[REDACTED\]/);
  assert.match(sanitized.message, /X-aliyun-ecs-metadata-token:\s*\[REDACTED\]/);
});

// --- OSS signed URL parameters ---

test('sanitizeErrorForLog masks OSS signed URL query parameters', () => {
  const url = 'https://fake-bucket.oss-cn-fake.aliyuncs.com/daily/2026/07/x.db.enc' +
    '?OSSAccessKeyId=LTAI5tFakeExampleAK00000' +
    '&Signature=ThisSignatureShouldBeMaskedXYZ%3D' +
    '&Expires=1735689600' +
    '&sign=fake-sign-value';
  const sanitized = sanitizeErrorForLog(new Error(`GET ${url} failed with 403`));
  assert.doesNotMatch(sanitized.message, /LTAI5tFakeExampleAK00000/);
  assert.doesNotMatch(sanitized.message, /ThisSignatureShouldBeMaskedXYZ/);
  assert.doesNotMatch(sanitized.message, /1735689600/);
  assert.doesNotMatch(sanitized.message, /fake-sign-value/);
  assert.match(sanitized.message, /OSSAccessKeyId=\[REDACTED\]/);
  assert.match(sanitized.message, /Signature=\[REDACTED\]/);
  assert.match(sanitized.message, /Expires=\[REDACTED\]/);
  assert.match(sanitized.message, /sign=\[REDACTED\]/);
});

// --- Header dump copied into message ---

test('sanitizeErrorForLog masks headers copied into an error message (ali-oss style)', () => {
  // ali-oss sometimes formats the response header dump into error.message. Simulate that.
  const dump = [
    'Response headers dumped into message:',
    '  Authorization: OSS4-HMAC-SHA256 Credential=LTAI-example/20260727/oss-cn-x/oss/aliyun_v4_request, Signature=examplesig',
    '  x-oss-security-token: STS.NUgYrLnoLrQnstsTokenValueExample',
  ].join('\n');
  const sanitized = sanitizeErrorForLog(new Error(dump));
  assert.doesNotMatch(sanitized.message, /LTAI-example\/20260727/);
  assert.doesNotMatch(sanitized.message, /examplesig/);
  assert.doesNotMatch(sanitized.message, /STS\.NUgYrLnoLrQnstsTokenValueExample/);
  assert.match(sanitized.message, /Authorization:\s*\[REDACTED\]/);
  assert.match(sanitized.message, /x-oss-security-token:\s*\[REDACTED\]/i);
});

// --- Non-sensitive content is preserved ---

test('sanitizeErrorForLog preserves non-sensitive context and other error fields', () => {
  const error = Object.assign(new Error('403 Forbidden: putObject key=daily/2026/07/x.db.enc requestId=REQ-abc'), {
    code: 'InvalidArgument',
    statusCode: 403,
    requestId: 'REQ-abc',
  });
  const sanitized = sanitizeErrorForLog(error);
  // Preserved information for operators.
  assert.match(sanitized.message, /403 Forbidden/);
  assert.match(sanitized.message, /putObject/);
  assert.match(sanitized.message, /key=daily\/2026\/07\/x\.db\.enc/);
  assert.equal(sanitized.code, 'InvalidArgument');
  assert.equal(sanitized.statusCode, 403);
  assert.equal(sanitized.requestId, 'REQ-abc');
  // Instance type preservation: still an Error so createRedactor path treats it as one.
  assert.ok(sanitized instanceof Error);
});

test('sanitizeErrorForLog handles non-Error inputs (string and object) safely', () => {
  const s = sanitizeErrorForLog('boom stsToken=leak-value here');
  assert.ok(s instanceof Error);
  assert.doesNotMatch(s.message, /leak-value/);
  assert.match(s.message, /stsToken=\[REDACTED\]/);

  const o = sanitizeErrorForLog({ message: 'accessKeySecret=leak', code: 'X' });
  assert.ok(o instanceof Error);
  assert.doesNotMatch(o.message, /leak/);
  assert.equal(o.code, 'X');
});

test('sanitizeErrorForLog returns non-Error for null/undefined without throwing', () => {
  const a = sanitizeErrorForLog(null);
  const b = sanitizeErrorForLog(undefined);
  // Whatever it returns, no leaked secrets and no throw.
  assert.ok(a === null || a === undefined || a instanceof Error);
  assert.ok(b === null || b === undefined || b instanceof Error);
});
