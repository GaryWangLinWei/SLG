import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStsRefreshIntervalMs, DEFAULT_STS_REFRESH_MS } from './cli-support.mjs';

test('resolveStsRefreshIntervalMs returns default when env var is absent or blank', () => {
  assert.equal(resolveStsRefreshIntervalMs({}), DEFAULT_STS_REFRESH_MS);
  assert.equal(resolveStsRefreshIntervalMs({ BACKUP_OSS_STS_REFRESH_SEC: '' }), DEFAULT_STS_REFRESH_MS);
  assert.equal(resolveStsRefreshIntervalMs({ BACKUP_OSS_STS_REFRESH_SEC: '   ' }), DEFAULT_STS_REFRESH_MS);
});

test('resolveStsRefreshIntervalMs default is one hour', () => {
  assert.equal(DEFAULT_STS_REFRESH_MS, 60 * 60 * 1000);
});

test('resolveStsRefreshIntervalMs accepts seconds within [60, 86400] and converts to ms', () => {
  assert.equal(resolveStsRefreshIntervalMs({ BACKUP_OSS_STS_REFRESH_SEC: '60' }), 60_000);
  assert.equal(resolveStsRefreshIntervalMs({ BACKUP_OSS_STS_REFRESH_SEC: '900' }), 900_000);
  assert.equal(resolveStsRefreshIntervalMs({ BACKUP_OSS_STS_REFRESH_SEC: '86400' }), 86_400_000);
});

test('resolveStsRefreshIntervalMs rejects out-of-range and non-integer values', () => {
  for (const bad of ['0', '59', '86401', '999999', '-1', '3.14', 'abc', 'NaN', 'Infinity']) {
    assert.throws(
      () => resolveStsRefreshIntervalMs({ BACKUP_OSS_STS_REFRESH_SEC: bad }),
      /BACKUP_OSS_STS_REFRESH_SEC/,
      `expected reject for value ${bad}`,
    );
  }
});
