import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp as realMkdtemp,
  readFile,
  rm as realRm,
  stat as realStat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRedactor, writeLog } from './log.mjs';
import { buildObjectKey, runBackup, runRestoreVerification } from './workflow.mjs';

const FAKE_KEY = Buffer.alloc(32, 5);
const FAKE_SECRET = 'SEC-fake-workflow-test';
const FAKE_WEBHOOK = 'https://example.com/hook?access_token=fake-token';

function baseConfig(overrides = {}) {
  return {
    dbPath: '/abs/auth.db',
    ossRegion: 'oss-fake',
    ossBucket: 'fake-bucket',
    ossPrefix: 'daily/',
    encryptionKey: FAKE_KEY,
    dingtalkWebhook: FAKE_WEBHOOK,
    dingtalkSecret: FAKE_SECRET,
    instanceId: 'test-node',
    ...overrides,
  };
}

function makeStream() {
  const events = [];
  const chunks = [];
  const stream = {
    write(chunk) {
      chunks.push(chunk);
      const text = chunks.join('');
      const lines = text.split('\n');
      // keep tail if unfinished
      chunks.length = 0;
      if (!text.endsWith('\n')) chunks.push(lines.pop());
      for (const line of lines) {
        if (line) events.push(JSON.parse(line));
      }
    },
  };
  return { stream, events };
}

async function withTempRoot(fn) {
  const root = await realMkdtemp(join(tmpdir(), 'workflow-test-'));
  try {
    await fn(root);
  } finally {
    await realRm(root, { recursive: true, force: true });
  }
}

function makeDailyFakes(root, overrides = {}) {
  const { stream, events } = makeStream();
  const config = baseConfig(overrides.config);
  const sqliteCalls = [];
  const cryptoCalls = [];
  const dingtalkCalls = [];
  const putCalls = [];
  const headCalls = [];
  const listCalls = [];
  const getCalls = [];
  const mkdtempCalls = [];
  const rmCalls = [];
  const safeCalls = [];

  const sqlite = {
    async createOnlineSnapshot(src, dst) {
      sqliteCalls.push(['createOnlineSnapshot', src, dst]);
      if (overrides.snapshotError) throw overrides.snapshotError;
      await writeFile(dst, 'plaintext-snapshot-bytes');
    },
    verifySnapshot(path) {
      sqliteCalls.push(['verifySnapshot', path]);
      if (overrides.integrityError) throw overrides.integrityError;
      return { integrity: 'ok', size: 4096, tables: ['activation_codes', 'device_bindings', 'remote_sessions'] };
    },
  };

  const cryptoImpl = {
    async encryptFile(src, dst, key) {
      cryptoCalls.push(['encryptFile', src, dst, key]);
      if (overrides.encryptError) throw overrides.encryptError;
      await writeFile(dst, 'encrypted-body');
      return overrides.sha256 ?? 'a'.repeat(64);
    },
    async decryptFile(src, dst, key) {
      cryptoCalls.push(['decryptFile', src, dst, key]);
      if (overrides.decryptError) throw overrides.decryptError;
      await writeFile(dst, 'plaintext-restored-body');
    },
  };

  const ossClient = {
    async put(name, path, opts) {
      putCalls.push({ name, path, opts });
      if (overrides.putError) throw overrides.putError;
    },
    async head(name) {
      headCalls.push(name);
      if (overrides.headError) throw overrides.headError;
      if (overrides.headResponse) return overrides.headResponse;
      const last = putCalls[putCalls.length - 1];
      const size = last ? (await realStat(last.path)).size : 0;
      return { meta: { ...(last?.opts?.meta ?? {}) }, res: { headers: { 'content-length': String(size) } } };
    },
    async list(q) {
      listCalls.push(q);
      if (overrides.listError) throw overrides.listError;
      return (overrides.listResponses ?? [{ objects: [], isTruncated: false }]).shift();
    },
    async get(name, dest) {
      getCalls.push({ name, dest });
      if (overrides.getError) throw overrides.getError;
      await writeFile(dest, 'encrypted-body');
    },
  };

  const oss = {
    async listLatestBackup(client, prefix) {
      // Delegate to fake list to keep behavior explicit.
      const response = await client.list({ prefix });
      const objects = response?.objects ?? [];
      let latest = null;
      for (const obj of objects) {
        if (typeof obj?.name !== 'string' || !obj.name.endsWith('.db.enc')) continue;
        if (!latest || obj.name > latest.name) latest = obj;
      }
      return latest;
    },
    async downloadAndVerify(client, obj, dest, expectedSha) {
      const name = typeof obj === 'string' ? obj : obj.name;
      await client.get(name, dest);
      // Skip actual SHA verification; tests supply pre-computed matching SHAs.
      const data = await readFile(dest);
      if (overrides.downloadShaMismatch) {
        throw new Error(`Downloaded object SHA-256 mismatch: expected=${expectedSha}`);
      }
      return { sha256: expectedSha, size: data.length };
    },
  };

  const dingtalk = {
    async sendDingtalk(opts) {
      dingtalkCalls.push(opts);
      if (overrides.notifyError) throw overrides.notifyError;
      return { status: 200 };
    },
  };

  const now = overrides.now ?? new Date('2026-07-26T19:15:00Z'); // Shanghai 2026-07-27 03:15
  const deps = {
    loadConfig: () => config,
    assertSafeDatabasePath: async (path) => {
      safeCalls.push(path);
      if (overrides.preflightError) throw overrides.preflightError;
    },
    ossClient,
    sqlite,
    crypto: cryptoImpl,
    oss,
    dingtalk,
    log: { writeLog, createRedactor },
    logStream: stream,
    clock: () => new Date(now.getTime()),
    randomUUID: () => overrides.runId ?? 'run-uuid-fake',
    mkdtemp: async (prefix) => {
      const dir = await realMkdtemp(join(root, prefix));
      mkdtempCalls.push(dir);
      return dir;
    },
    rm: async (path, opts) => {
      rmCalls.push([path, opts]);
      if (overrides.rmError) throw overrides.rmError;
      await realRm(path, opts);
    },
    stat: async (path) => realStat(path),
  };
  return {
    deps, events, config,
    sqliteCalls, cryptoCalls, dingtalkCalls,
    putCalls, headCalls, listCalls, getCalls,
    mkdtempCalls, rmCalls, safeCalls,
  };
}

// ---------- buildObjectKey ----------

test('buildObjectKey formats YYYY/MM path and Asia/Shanghai timestamp with +0800', () => {
  // UTC 2026-07-26T19:15:00Z is Asia/Shanghai 2026-07-27T03:15:00+0800
  const date = new Date(Date.UTC(2026, 6, 26, 19, 15, 0));
  assert.equal(
    buildObjectKey('daily/', date),
    'daily/2026/07/auth-20260727T031500+0800.db.enc',
  );
  // Prefix carries through unchanged (must already end with trailing slash).
  assert.equal(
    buildObjectKey('backups/prod-daily/', date),
    'backups/prod-daily/2026/07/auth-20260727T031500+0800.db.enc',
  );
});

test('buildObjectKey uses Asia/Shanghai even for UTC-midnight-crossing values', () => {
  // UTC 2026-12-31T23:00:00Z → Shanghai 2027-01-01 07:00:00 (year and month roll)
  const date = new Date(Date.UTC(2026, 11, 31, 23, 0, 0));
  assert.equal(
    buildObjectKey('daily/', date),
    'daily/2027/01/auth-20270101T070000+0800.db.enc',
  );
});

test('buildObjectKey rejects invalid inputs', () => {
  assert.throws(() => buildObjectKey('', new Date()), /prefix/i);
  assert.throws(() => buildObjectKey('daily/', 'not-a-date'), /date/i);
  assert.throws(() => buildObjectKey('daily/', new Date(NaN)), /date/i);
});

// ---------- runBackup: daily happy path ----------

test('runBackup emits stages in fixed order preflight→snapshot→integrity→encrypt→upload→verify-upload→cleanup', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root);
    const result = await runBackup(t.deps, {});
    const stages = t.events.filter((e) => e.status === 'ok').map((e) => e.stage);
    assert.deepEqual(stages, [
      'preflight', 'snapshot', 'integrity', 'encrypt', 'upload', 'verify-upload', 'cleanup',
    ]);
    assert.equal(result.runId, 'run-uuid-fake');
    assert.equal(
      result.objectKey,
      'daily/2026/07/auth-20260727T031500+0800.db.enc',
    );
    assert.equal(result.sha256, 'a'.repeat(64));
    assert.equal(result.snapshotSize, 4096);
  });
});

test('runBackup on daily success sends no notification and returns metadata', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root);
    await runBackup(t.deps, {});
    assert.equal(t.dingtalkCalls.length, 0);
    assert.equal(t.putCalls.length, 1);
    // Metadata contains the fixed key set.
    const meta = t.putCalls[0].opts.meta;
    assert.deepEqual(Object.keys(meta).sort(), [
      'created-at', 'format-version', 'run-id', 'sha256', 'snapshot-size',
    ]);
    assert.equal(meta['format-version'], '1');
    assert.equal(meta['sha256'], 'a'.repeat(64));
    assert.equal(meta['snapshot-size'], '4096');
    assert.equal(meta['run-id'], 'run-uuid-fake');
    // created-at is ISO-8601 UTC.
    assert.match(meta['created-at'], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

test('runBackup writes ciphertext to a path distinct from the snapshot path', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root);
    await runBackup(t.deps, {});
    const snapshot = t.sqliteCalls.find((c) => c[0] === 'createOnlineSnapshot');
    const encrypt = t.cryptoCalls.find((c) => c[0] === 'encryptFile');
    assert.ok(snapshot && encrypt);
    assert.notEqual(snapshot[2], encrypt[2], 'encrypt destination must differ from snapshot path');
  });
});

// ---------- runBackup: daily failure at each business stage ----------

for (const [stageName, overrides] of [
  ['preflight', { preflightError: new Error('preflight boom') }],
  ['snapshot', { snapshotError: new Error('snapshot boom') }],
  ['integrity', { integrityError: new Error('integrity boom') }],
  ['encrypt', { encryptError: new Error('encrypt boom') }],
  ['upload', { putError: new Error('upload boom') }],
  ['verify-upload', { headError: new Error('head boom') }],
]) {
  test(`runBackup failure at ${stageName} stops later business stages and still cleans up + notifies`, async () => {
    await withTempRoot(async (root) => {
      const t = makeDailyFakes(root, overrides);
      await assert.rejects(runBackup(t.deps, {}), /boom/);
      // Failing stage is logged with status=fail.
      const fail = t.events.find((e) => e.status === 'fail');
      assert.ok(fail, 'expected a fail event');
      assert.equal(fail.stage, stageName);
      // Later business stages must not appear (only preceding oks and the fail stage).
      const businessOrder = ['preflight','snapshot','integrity','encrypt','upload','verify-upload'];
      const stopIndex = businessOrder.indexOf(stageName);
      const expectedOks = businessOrder.slice(0, stopIndex);
      const okBusinessStages = t.events
        .filter((e) => e.status === 'ok' && businessOrder.includes(e.stage))
        .map((e) => e.stage);
      assert.deepEqual(okBusinessStages, expectedOks);
      // No business stage past the failing one may appear as ok.
      for (const later of businessOrder.slice(stopIndex + 1)) {
        assert.ok(!okBusinessStages.includes(later), `later stage ${later} must not run`);
      }
      // Cleanup must still run.
      const cleanupOk = t.events.find((e) => e.stage === 'cleanup');
      assert.ok(cleanupOk);
      // Daily failure sends a notification.
      assert.equal(t.dingtalkCalls.length, 1);
      // Sensitive values are not leaked in the notification text.
      const text = t.dingtalkCalls[0].text ?? '';
      assert.doesNotMatch(text, /SEC-fake-workflow-test/);
      assert.doesNotMatch(text, /access_token=fake-token/);
      assert.doesNotMatch(text, /example\.com\/hook/);
    });
  });
}

test('runBackup preserves main error when cleanup itself fails and logs cleanup=warn', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root, {
      snapshotError: new Error('snapshot boom'),
      rmError: new Error('rm boom'),
    });
    const err = await assert.rejects(runBackup(t.deps, {}), /snapshot boom/);
    void err;
    const cleanupEvent = t.events.find((e) => e.stage === 'cleanup');
    assert.equal(cleanupEvent?.status, 'warn');
  });
});

test('runBackup preserves main error when the failure notification itself fails', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root, {
      snapshotError: new Error('snapshot boom'),
      notifyError: new Error('notify boom'),
    });
    await assert.rejects(runBackup(t.deps, {}), /snapshot boom/);
    // A warning about the notify failure must be logged (so it is not silently swallowed).
    const notifyWarn = t.events.find((e) => e.stage === 'notify' && e.status === 'warn');
    assert.ok(notifyWarn);
  });
});

test('runBackup daily happy path with cleanup rm failure still returns success but logs warn', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root, { rmError: new Error('rm boom') });
    const result = await runBackup(t.deps, {});
    assert.equal(result.runId, 'run-uuid-fake');
    const cleanupEvent = t.events.find((e) => e.stage === 'cleanup');
    assert.equal(cleanupEvent?.status, 'warn');
    // Still no notification since main path succeeded.
    assert.equal(t.dingtalkCalls.length, 0);
  });
});

test('runBackup redacts encryption key / dingtalk secret / webhook in every log event', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root, {
      // Force a failure path so the error object also flows through the log.
      snapshotError: Object.assign(new Error(`fail with secret ${FAKE_SECRET}`), {
        webhook: FAKE_WEBHOOK,
      }),
    });
    await assert.rejects(runBackup(t.deps, {}), /fail with secret/);
    const serialized = JSON.stringify(t.events);
    assert.doesNotMatch(serialized, /SEC-fake-workflow-test/);
    assert.doesNotMatch(serialized, /access_token=fake-token/);
    // Encryption key must never appear in any encoding.
    assert.doesNotMatch(serialized, new RegExp(FAKE_KEY.toString('base64').replace(/\+/g, '\\+')));
    assert.doesNotMatch(serialized, new RegExp(FAKE_KEY.toString('hex')));
  });
});

test('runBackup verify-upload fails if HEAD size does not match local encrypted file', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root, {
      headResponse: {
        meta: {
          'format-version': '1',
          'sha256': 'a'.repeat(64),
          'snapshot-size': '4096',
          'created-at': '2026-07-27T03:15:00.000+0800',
          'run-id': 'run-uuid-fake',
        },
        res: { headers: { 'content-length': '1' } }, // wrong
      },
    });
    await assert.rejects(runBackup(t.deps, {}), /size/i);
    const fail = t.events.find((e) => e.status === 'fail');
    assert.equal(fail?.stage, 'verify-upload');
  });
});

test('runBackup verify-upload fails if any metadata field mismatches', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root);
    // Override head so its meta.sha256 differs from what upload registered.
    const originalPut = t.deps.ossClient.put;
    t.deps.ossClient.put = async (name, path, opts) => {
      await originalPut(name, path, opts);
      const size = String((await realStat(path)).size);
      t.deps.ossClient.head = async () => ({
        meta: {
          'format-version': '1',
          'sha256': 'b'.repeat(64), // wrong
          'snapshot-size': '4096',
          'created-at': opts.meta['created-at'],
          'run-id': opts.meta['run-id'],
        },
        res: { headers: { 'content-length': size } },
      });
    };
    await assert.rejects(runBackup(t.deps, {}), /sha256|metadata/i);
    const fail = t.events.find((e) => e.status === 'fail');
    assert.equal(fail?.stage, 'verify-upload');
  });
});

test('runBackup uses the injected randomUUID and clock for runId and object key', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root, {
      runId: 'run-uuid-injected-99',
      now: new Date(Date.UTC(2026, 0, 31, 16, 0, 0)), // Shanghai 2026-02-01 00:00 → month roll
    });
    const result = await runBackup(t.deps, {});
    assert.equal(result.runId, 'run-uuid-injected-99');
    assert.equal(result.objectKey, 'daily/2026/02/auth-20260201T000000+0800.db.enc');
  });
});

// ---------- runRestoreVerification: monthly ----------

test('runRestoreVerification downloads the latest object, verifies, and notifies success without touching production DB', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root, {
      listResponses: [{
        objects: [
          { name: 'daily/2026/06/auth-20260601T031500+0800.db.enc', size: 100 },
          { name: 'daily/2026/07/auth-20260701T031500+0800.db.enc', size: 100 },
        ],
        isTruncated: false,
      }],
    });
    // Provide a HEAD response with valid metadata for the latest object.
    t.deps.ossClient.head = async (name) => ({
      meta: {
        'format-version': '1',
        'sha256': 'c'.repeat(64),
        'snapshot-size': '4096',
        'created-at': '2026-07-01T03:15:00.000+0800',
        'run-id': 'daily-runid-42',
      },
      res: { headers: { 'content-length': '100' } },
      name,
    });
    const result = await runRestoreVerification(t.deps, {});
    // No verifySnapshot call must reference the production DB path.
    const verifyCalls = t.sqliteCalls.filter((c) => c[0] === 'verifySnapshot');
    assert.ok(verifyCalls.length >= 1);
    for (const [, path] of verifyCalls) {
      assert.notEqual(path, t.config.dbPath);
    }
    // No createOnlineSnapshot on production DB either.
    const snapCalls = t.sqliteCalls.filter((c) => c[0] === 'createOnlineSnapshot');
    assert.equal(snapCalls.length, 0);
    // Success notification is sent.
    assert.equal(t.dingtalkCalls.length, 1);
    const text = t.dingtalkCalls[0].text;
    // Success notification includes basename only, integrity, and no full path or secrets.
    assert.ok(text.includes('auth-20260701T031500+0800.db.enc'));
    assert.doesNotMatch(text, /daily\/2026\/07\//);
    assert.doesNotMatch(text, /SEC-fake-workflow-test/);
    // Result contains the latest object key and integrity.
    assert.equal(result.objectKey, 'daily/2026/07/auth-20260701T031500+0800.db.enc');
    assert.equal(result.integrity, 'ok');
  });
});

test('runRestoreVerification fails when no backup objects exist and notifies failure', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root, {
      listResponses: [{ objects: [], isTruncated: false }],
    });
    await assert.rejects(runRestoreVerification(t.deps, {}), /no backup|latest|empty/i);
    assert.equal(t.dingtalkCalls.length, 1);
    // Failure notification must still avoid sensitive values.
    const text = t.dingtalkCalls[0].text;
    assert.doesNotMatch(text, /SEC-fake-workflow-test/);
  });
});

test('runRestoreVerification fails when format-version does not match', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root, {
      listResponses: [{
        objects: [{ name: 'daily/2026/07/auth-20260701T031500+0800.db.enc', size: 100 }],
        isTruncated: false,
      }],
    });
    t.deps.ossClient.head = async () => ({
      meta: {
        'format-version': '99', // wrong
        'sha256': 'c'.repeat(64),
        'snapshot-size': '4096',
        'created-at': '2026-07-01T03:15:00.000+0800',
        'run-id': 'daily-runid-42',
      },
      res: { headers: { 'content-length': '100' } },
    });
    await assert.rejects(runRestoreVerification(t.deps, {}), /format|version/i);
    assert.equal(t.dingtalkCalls.length, 1);
  });
});

test('runRestoreVerification fails when SHA mismatch is detected during download', async () => {
  await withTempRoot(async (root) => {
    const t = makeDailyFakes(root, {
      listResponses: [{
        objects: [{ name: 'daily/2026/07/auth-20260701T031500+0800.db.enc', size: 100 }],
        isTruncated: false,
      }],
      downloadShaMismatch: true,
    });
    t.deps.ossClient.head = async () => ({
      meta: {
        'format-version': '1',
        'sha256': 'c'.repeat(64),
        'snapshot-size': '4096',
        'created-at': '2026-07-01T03:15:00.000+0800',
        'run-id': 'daily-runid-42',
      },
      res: { headers: { 'content-length': '100' } },
    });
    await assert.rejects(runRestoreVerification(t.deps, {}), /SHA/i);
    assert.equal(t.dingtalkCalls.length, 1);
  });
});

test('runRestoreVerification cleans up its temp dir on both success and failure', async () => {
  await withTempRoot(async (root) => {
    // success path
    const tOk = makeDailyFakes(root, {
      listResponses: [{
        objects: [{ name: 'daily/2026/07/auth-20260701T031500+0800.db.enc', size: 100 }],
        isTruncated: false,
      }],
    });
    tOk.deps.ossClient.head = async () => ({
      meta: {
        'format-version': '1',
        'sha256': 'c'.repeat(64),
        'snapshot-size': '4096',
        'created-at': '2026-07-01T03:15:00.000+0800',
        'run-id': 'daily-runid-42',
      },
      res: { headers: { 'content-length': '100' } },
    });
    await runRestoreVerification(tOk.deps, {});
    assert.equal(tOk.rmCalls.length, 1);
    for (const dir of tOk.mkdtempCalls) {
      await assert.rejects(realStat(dir), (e) => e.code === 'ENOENT');
    }
    // failure path
    const tFail = makeDailyFakes(root, { listResponses: [{ objects: [], isTruncated: false }] });
    await assert.rejects(runRestoreVerification(tFail.deps, {}));
    assert.equal(tFail.rmCalls.length, 1);
    for (const dir of tFail.mkdtempCalls) {
      await assert.rejects(realStat(dir), (e) => e.code === 'ENOENT');
    }
  });
});
