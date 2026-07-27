import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  createOssClient,
  uploadAndVerify,
  listLatestBackup,
  downloadAndVerify,
  fetchStsCredentialsFromImds,
  METADATA_KEYS,
} from './oss.mjs';

class FakeOss {
  static lastOptions = null;
  constructor(options) {
    FakeOss.lastOptions = options;
    this.options = options;
    this.putCalls = [];
    this.headCalls = [];
    this.listCalls = [];
    this.getCalls = [];
    this.headResponse = null;
    this.listResponses = [];
    this.getHandler = null;
  }
  async put(name, file, options) {
    this.putCalls.push({ name, file, options });
    return { name, res: { status: 200 } };
  }
  async head(name) {
    this.headCalls.push(name);
    if (!this.headResponse) throw new Error('FakeOss headResponse not configured');
    return this.headResponse;
  }
  async list(query) {
    this.listCalls.push(query);
    if (this.listResponses.length === 0) throw new Error('FakeOss listResponses exhausted');
    return this.listResponses.shift();
  }
  async get(name, dest) {
    this.getCalls.push({ name, dest });
    if (this.getHandler) await this.getHandler(name, dest);
  }
}

const validMeta = () => ({
  'format-version': '1',
  'sha256': 'a'.repeat(64),
  'snapshot-size': '4096',
  'created-at': '2026-07-27T00:00:00.000Z',
  'run-id': 'run-fake-0001',
});

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'oss-test-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('metadata keys are the fixed hyphenated set', () => {
  assert.deepEqual([...METADATA_KEYS].sort(),
    ['created-at', 'format-version', 'run-id', 'sha256', 'snapshot-size']);
});

test('createOssClient configures authorizationV4 and refreshSTSToken from credentials provider', async () => {
  let calls = 0;
  const provider = async () => {
    calls += 1;
    return {
      accessKeyId: `AK-fake-${calls}`,
      accessKeySecret: `SK-fake-${calls}`,
      securityToken: `ST-fake-${calls}`,
      expiration: '2026-07-27T01:00:00Z',
    };
  };
  const client = await createOssClient({ region: 'oss-fake-region', bucket: 'fake-bucket', credentialsProvider: provider }, FakeOss);
  assert.ok(client instanceof FakeOss);
  assert.equal(FakeOss.lastOptions.region, 'oss-fake-region');
  assert.equal(FakeOss.lastOptions.bucket, 'fake-bucket');
  assert.equal(FakeOss.lastOptions.authorizationV4, true);
  assert.equal(FakeOss.lastOptions.accessKeyId, 'AK-fake-1');
  assert.equal(FakeOss.lastOptions.accessKeySecret, 'SK-fake-1');
  assert.equal(FakeOss.lastOptions.stsToken, 'ST-fake-1');
  assert.equal(typeof FakeOss.lastOptions.refreshSTSToken, 'function');
  const refreshed = await FakeOss.lastOptions.refreshSTSToken();
  assert.deepEqual(refreshed, { accessKeyId: 'AK-fake-2', accessKeySecret: 'SK-fake-2', stsToken: 'ST-fake-2' });
});

test('createOssClient requires a Client constructor and credentials provider', async () => {
  await assert.rejects(() => createOssClient({ region: 'r', bucket: 'b', credentialsProvider: async () => ({}) }, undefined), /Client/);
  await assert.rejects(() => createOssClient({ region: 'r', bucket: 'b' }, FakeOss), /credentialsProvider/);
});

test('uploadAndVerify sends metadata headers and matches HEAD size and each metadata field', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'x.db.enc');
    const payload = Buffer.alloc(4096, 0x42);
    await writeFile(file, payload);
    const meta = validMeta();
    const client = new FakeOss({});
    client.headResponse = { meta: { ...meta }, res: { headers: { 'content-length': String(payload.length) } } };
    const result = await uploadAndVerify(client, 'daily/x.db.enc', file, meta);
    assert.equal(client.putCalls.length, 1);
    assert.equal(client.putCalls[0].name, 'daily/x.db.enc');
    assert.deepEqual(client.putCalls[0].options.meta, meta);
    assert.equal(client.headCalls[0], 'daily/x.db.enc');
    assert.equal(result.size, payload.length);
  });
});

test('uploadAndVerify fails when HEAD size does not match local file', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'x.db.enc');
    await writeFile(file, Buffer.alloc(4096, 0));
    const client = new FakeOss({});
    client.headResponse = { meta: { ...validMeta() }, res: { headers: { 'content-length': '4095' } } };
    await assert.rejects(uploadAndVerify(client, 'k', file, validMeta()), /size/i);
  });
});

test('uploadAndVerify fails when any single metadata field mismatches', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'x.db.enc');
    const payload = Buffer.alloc(64, 1);
    await writeFile(file, payload);
    for (const field of METADATA_KEYS) {
      const meta = validMeta();
      const remote = { ...meta, [field]: 'tampered-value' };
      const client = new FakeOss({});
      client.headResponse = { meta: remote, res: { headers: { 'content-length': String(payload.length) } } };
      await assert.rejects(uploadAndVerify(client, 'k', file, meta), new RegExp(field));
    }
  });
});

test('uploadAndVerify rejects incomplete metadata shape', async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, 'x.db.enc');
    await writeFile(file, Buffer.alloc(1));
    const client = new FakeOss({});
    const incomplete = validMeta();
    delete incomplete['run-id'];
    await assert.rejects(uploadAndVerify(client, 'k', file, incomplete), /run-id/);
    const withExtra = { ...validMeta(), unexpected: 'x' };
    await assert.rejects(uploadAndVerify(client, 'k', file, withExtra), /Metadata/i);
  });
});

test('listLatestBackup paginates and selects the latest .db.enc by object key', async () => {
  const client = new FakeOss({});
  client.listResponses = [
    {
      objects: [
        { name: 'daily/2026/07/20/backup-2026-07-20T00-00-00Z.db.enc', size: 1 },
        { name: 'daily/2026/07/21/backup-2026-07-21T00-00-00Z.db.enc', size: 1 },
        { name: 'daily/2026/07/21/ignore.txt', size: 1 },
      ],
      isTruncated: true,
      nextMarker: 'marker-2',
    },
    {
      objects: [
        { name: 'daily/2026/07/22/backup-2026-07-22T00-00-00Z.db.enc', size: 1 },
        { name: 'daily/2026/07/22/backup-2026-07-22T12-00-00Z.db.enc', size: 1 },
        { name: 'daily/2026/07/22/backup-2026-07-22T12-00-00Z.db.enc.tmp', size: 1 },
      ],
      isTruncated: false,
    },
  ];
  const latest = await listLatestBackup(client, 'daily/');
  assert.equal(latest.name, 'daily/2026/07/22/backup-2026-07-22T12-00-00Z.db.enc');
  assert.equal(client.listCalls.length, 2);
  assert.equal(client.listCalls[0].prefix, 'daily/');
  assert.equal(client.listCalls[1].marker, 'marker-2');
});

test('listLatestBackup returns null when there is no matching .db.enc object', async () => {
  const client = new FakeOss({});
  client.listResponses = [{ objects: [{ name: 'daily/junk.txt', size: 1 }], isTruncated: false }];
  const latest = await listLatestBackup(client, 'daily/');
  assert.equal(latest, null);
});

test('downloadAndVerify accepts the expected SHA-256 and returns the digest', async () => {
  await withTempDir(async (dir) => {
    const dest = join(dir, 'out.db.enc');
    const payload = Buffer.from('encrypted-backup-body');
    const sha = createHash('sha256').update(payload).digest('hex');
    const client = new FakeOss({});
    client.getHandler = async (_name, path) => { await writeFile(path, payload); };
    const result = await downloadAndVerify(client, { name: 'daily/backup.db.enc' }, dest, sha);
    assert.equal(result.sha256, sha);
    assert.equal((await readFile(dest)).toString(), 'encrypted-backup-body');
  });
});

test('downloadAndVerify fails when computed SHA-256 does not match expected', async () => {
  await withTempDir(async (dir) => {
    const dest = join(dir, 'out.db.enc');
    const client = new FakeOss({});
    client.getHandler = async (_name, path) => { await writeFile(path, 'tampered'); };
    const wrong = createHash('sha256').update('original').digest('hex');
    await assert.rejects(
      downloadAndVerify(client, 'daily/backup.db.enc', dest, wrong),
      /SHA-256 mismatch/i,
    );
  });
});

test('fetchStsCredentialsFromImds fetches token, role, and credentials strictly', async () => {
  const calls = [];
  const responses = new Map([
    ['PUT http://100.100.100.200/latest/api/token', { ok: true, status: 200, text: async () => 'imds-fake-token' }],
    ['GET http://100.100.100.200/latest/meta-data/ram/security-credentials/', { ok: true, status: 200, text: async () => 'FakeRoleName' }],
    ['GET http://100.100.100.200/latest/meta-data/ram/security-credentials/FakeRoleName', { ok: true, status: 200, json: async () => ({ Code: 'Success', AccessKeyId: 'AK-fake-imds', AccessKeySecret: 'SK-fake-imds', SecurityToken: 'ST-fake-imds', Expiration: '2026-07-27T02:00:00Z', LastUpdated: '2026-07-27T00:00:00Z' }) }],
  ]);
  const fetchImpl = async (url, init) => {
    calls.push({ method: (init?.method ?? 'GET').toUpperCase(), url, headers: init?.headers ?? {} });
    return responses.get(`${(init?.method ?? 'GET').toUpperCase()} ${url}`);
  };
  const creds = await fetchStsCredentialsFromImds({ fetchImpl, timeoutMs: 25 });
  assert.deepEqual(creds, { accessKeyId: 'AK-fake-imds', accessKeySecret: 'SK-fake-imds', securityToken: 'ST-fake-imds', expiration: '2026-07-27T02:00:00Z' });
  assert.equal(calls[0].method, 'PUT');
  assert.match(String(calls[0].headers['X-aliyun-ecs-metadata-token-ttl-seconds']), /^\d+$/);
  assert.equal(calls[1].headers['X-aliyun-ecs-metadata-token'], 'imds-fake-token');
  assert.equal(calls[2].headers['X-aliyun-ecs-metadata-token'], 'imds-fake-token');
});

test('fetchStsCredentialsFromImds rejects on non-Success Code or missing fields', async () => {
  const tokenRes = { ok: true, status: 200, text: async () => 'imds-fake-token' };
  const roleRes = { ok: true, status: 200, text: async () => 'FakeRoleName' };

  const badCode = async () => ({ ok: true, status: 200, json: async () => ({ Code: 'Failed', AccessKeyId: 'x', AccessKeySecret: 'y', SecurityToken: 'z', Expiration: 'w' }) });
  const missing = async () => ({ ok: true, status: 200, json: async () => ({ Code: 'Success', AccessKeyId: '', AccessKeySecret: 'y', SecurityToken: 'z', Expiration: 'w' }) });

  const makeFetch = (credFn) => async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'PUT' && url.endsWith('/api/token')) return tokenRes;
    if (method === 'GET' && url.endsWith('/security-credentials/')) return roleRes;
    return credFn(url);
  };

  await assert.rejects(fetchStsCredentialsFromImds({ fetchImpl: makeFetch(badCode), timeoutMs: 25 }), /Code/);
  await assert.rejects(fetchStsCredentialsFromImds({ fetchImpl: makeFetch(missing), timeoutMs: 25 }), /AccessKeyId/);
});
