import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';

export const METADATA_KEYS = Object.freeze([
  'format-version',
  'sha256',
  'snapshot-size',
  'created-at',
  'run-id',
]);

const IMDS_HOST = 'http://100.100.100.200';
const IMDS_TOKEN_TTL_SECONDS = 21600;

function assertMetadataShape(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('Metadata must be an object');
  }
  const keys = Object.keys(metadata);
  for (const key of METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(metadata, key) ||
        typeof metadata[key] !== 'string' ||
        metadata[key] === '') {
      throw new Error(`Metadata field ${key} must be a non-empty string`);
    }
  }
  for (const key of keys) {
    if (!METADATA_KEYS.includes(key)) {
      throw new Error(`Metadata field ${key} is not allowed`);
    }
  }
}

export async function createOssClient(config, Client) {
  if (typeof Client !== 'function') {
    throw new TypeError('Client constructor is required');
  }
  const provider = config?.credentialsProvider;
  if (typeof provider !== 'function') {
    throw new TypeError('credentialsProvider must be a function');
  }
  const initial = await provider();
  assertCredentials(initial);
  const refreshInterval = Number.isFinite(config?.refreshSTSTokenIntervalMs) && config.refreshSTSTokenIntervalMs > 0
    ? config.refreshSTSTokenIntervalMs
    : 60 * 60 * 1000;
  const options = {
    region: config.region,
    internal: config.internal !== false,
    bucket: config.bucket,
    accessKeyId: initial.accessKeyId,
    accessKeySecret: initial.accessKeySecret,
    stsToken: initial.securityToken,
    authorizationV4: true,
    secure: true,
    refreshSTSToken: async () => {
      const refreshed = await provider();
      assertCredentials(refreshed);
      return {
        accessKeyId: refreshed.accessKeyId,
        accessKeySecret: refreshed.accessKeySecret,
        stsToken: refreshed.securityToken,
      };
    },
    refreshSTSTokenInterval: refreshInterval,
    timeout: 600000,
  };
  return new Client(options);
}

function assertCredentials(credentials) {
  for (const key of ['accessKeyId', 'accessKeySecret', 'securityToken']) {
    if (typeof credentials?.[key] !== 'string' || credentials[key] === '') {
      throw new Error(`STS credential field ${key} must be a non-empty string`);
    }
  }
}

export async function uploadAndVerify(client, objectKey, localPath, metadata) {
  assertMetadataShape(metadata);
  const fileStat = await stat(localPath);
  await client.put(objectKey, localPath, { meta: { ...metadata } });
  const head = await client.head(objectKey);
  const headers = head?.res?.headers ?? {};
  const remoteSize = Number(headers['content-length']);
  if (!Number.isFinite(remoteSize) || remoteSize !== fileStat.size) {
    throw new Error(`Uploaded object size mismatch: local=${fileStat.size} remote=${headers['content-length']}`);
  }
  const remoteMeta = head?.meta ?? {};
  for (const key of METADATA_KEYS) {
    if (remoteMeta[key] !== metadata[key]) {
      throw new Error(`Uploaded metadata field ${key} mismatch: expected=${metadata[key]} remote=${remoteMeta[key]}`);
    }
  }
  return { size: fileStat.size, metadata: { ...metadata } };
}

export async function listLatestBackup(client, prefix) {
  if (typeof prefix !== 'string' || prefix === '') {
    throw new TypeError('prefix must be a non-empty string');
  }
  let latest = null;
  let marker;
  do {
    const query = { prefix, 'max-keys': 1000 };
    if (marker) query.marker = marker;
    const response = await client.list(query);
    const objects = Array.isArray(response?.objects) ? response.objects : [];
    for (const obj of objects) {
      if (typeof obj?.name !== 'string') continue;
      if (!obj.name.endsWith('.db.enc')) continue;
      if (!latest || obj.name > latest.name) latest = obj;
    }
    if (!response?.isTruncated) break;
    marker = response.nextMarker;
    if (!marker) break;
  } while (true);
  return latest;
}

export async function downloadAndVerify(client, object, destinationPath, expectedSha256) {
  if (typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedSha256)) {
    throw new TypeError('expectedSha256 must be a 64-character hex string');
  }
  const name = typeof object === 'string' ? object : object?.name;
  if (typeof name !== 'string' || name === '') {
    throw new TypeError('object must be an object key or an object descriptor with a name');
  }
  try {
    await client.get(name, destinationPath);
    const data = await readFile(destinationPath);
    const actual = createHash('sha256').update(data).digest('hex');
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error(`Downloaded object SHA-256 mismatch: expected=${expectedSha256} actual=${actual}`);
    }
    return { sha256: actual, size: data.length };
  } catch (error) {
    // rm with force ignores ENOENT; swallow cleanup errors so the original failure surfaces.
    await rm(destinationPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function assertResponseOk(response, url) {
  if (!response || response.ok !== true) {
    const status = response?.status ?? 'unknown';
    throw new Error(`IMDS request failed for ${url}: status=${status}`);
  }
}

function assertNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`IMDS response field ${field} must be a non-empty string`);
  }
}

export async function fetchStsCredentialsFromImds({ fetchImpl = fetch, timeoutMs = 500 } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }
  const tokenUrl = `${IMDS_HOST}/latest/api/token`;
  const tokenResponse = await fetchWithTimeout(fetchImpl, tokenUrl, {
    method: 'PUT',
    headers: { 'X-aliyun-ecs-metadata-token-ttl-seconds': String(IMDS_TOKEN_TTL_SECONDS) },
  }, timeoutMs);
  assertResponseOk(tokenResponse, tokenUrl);
  const token = (await tokenResponse.text()).trim();
  assertNonEmpty(token, 'metadata-token');

  const roleUrl = `${IMDS_HOST}/latest/meta-data/ram/security-credentials/`;
  const roleResponse = await fetchWithTimeout(fetchImpl, roleUrl, {
    method: 'GET',
    headers: { 'X-aliyun-ecs-metadata-token': token },
  }, timeoutMs);
  assertResponseOk(roleResponse, roleUrl);
  const role = (await roleResponse.text()).trim();
  assertNonEmpty(role, 'role-name');
  if (role.includes('/') || role.includes('\n')) {
    throw new Error('IMDS role name contains unsafe characters');
  }

  const credentialsUrl = `${IMDS_HOST}/latest/meta-data/ram/security-credentials/${role}`;
  const credentialsResponse = await fetchWithTimeout(fetchImpl, credentialsUrl, {
    method: 'GET',
    headers: { 'X-aliyun-ecs-metadata-token': token },
  }, timeoutMs);
  assertResponseOk(credentialsResponse, credentialsUrl);
  const payload = await credentialsResponse.json();

  if (payload?.Code !== 'Success') {
    throw new Error(`IMDS credentials Code is not Success: ${payload?.Code}`);
  }
  for (const field of ['AccessKeyId', 'AccessKeySecret', 'SecurityToken', 'Expiration']) {
    assertNonEmpty(payload[field], field);
  }
  return {
    accessKeyId: payload.AccessKeyId,
    accessKeySecret: payload.AccessKeySecret,
    securityToken: payload.SecurityToken,
    expiration: payload.Expiration,
  };
}
