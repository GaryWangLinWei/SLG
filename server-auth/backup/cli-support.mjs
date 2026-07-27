/**
 * Build the secrets list for a redactor used by the CLI top-level catch.
 *
 * Includes:
 *   - Raw string forms of BACKUP_ENCRYPTION_KEY, DINGTALK_WEBHOOK, DINGTALK_SECRET
 *   - The decoded 32-byte Buffer of BACKUP_ENCRYPTION_KEY (so createRedactor
 *     expands utf8/base64/hex forms of the raw key bytes)
 *
 * Silently skips the Buffer entry when the key is not valid base64 or does
 * not decode to exactly 32 bytes. Missing env fields are omitted entirely.
 */
export function buildCliRedactorSecrets(env) {
  const secrets = [];
  const key = env?.BACKUP_ENCRYPTION_KEY;
  const webhook = env?.DINGTALK_WEBHOOK;
  const secret = env?.DINGTALK_SECRET;
  if (typeof key === 'string' && key.length > 0) secrets.push(key);
  if (typeof webhook === 'string' && webhook.length > 0) secrets.push(webhook);
  if (typeof secret === 'string' && secret.length > 0) secrets.push(secret);

  if (typeof key === 'string' && key.length > 0) {
    const base64Shape = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if (base64Shape.test(key)) {
      try {
        const buffer = Buffer.from(key, 'base64');
        if (buffer.length === 32 && buffer.toString('base64') === key) {
          secrets.push(buffer);
        }
      } catch {
        // ignore: invalid base64 falls through and the Buffer is not added
      }
    }
  }
  return secrets;
}

/** Default STS token refresh interval used by createOssClient (60 minutes). */
export const DEFAULT_STS_REFRESH_MS = 60 * 60 * 1000;

const STS_REFRESH_MIN_SEC = 60;
const STS_REFRESH_MAX_SEC = 24 * 60 * 60;

/**
 * Resolve the OSS STS token refresh interval, in milliseconds, from the
 * BACKUP_OSS_STS_REFRESH_SEC environment variable. Returns the default when
 * the variable is absent or blank. Throws on non-integers, negatives, and
 * values outside [60, 86400] seconds.
 *
 * Assembly-layer helper (used by backup.mjs / verify-restore.mjs). Adding it
 * to loadConfig would force a schema change on the Task 1 config tests, so
 * we keep it in cli-support.mjs and thread the resolved ms value into the
 * OSS client factory via a second `options` argument.
 */
export function resolveStsRefreshIntervalMs(env) {
  const raw = env?.BACKUP_OSS_STS_REFRESH_SEC;
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_STS_REFRESH_MS;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`BACKUP_OSS_STS_REFRESH_SEC must be a positive integer number of seconds, got ${JSON.stringify(raw)}`);
  }
  const seconds = Number(trimmed);
  if (!Number.isSafeInteger(seconds) || seconds < STS_REFRESH_MIN_SEC || seconds > STS_REFRESH_MAX_SEC) {
    throw new Error(
      `BACKUP_OSS_STS_REFRESH_SEC must be between ${STS_REFRESH_MIN_SEC} and ${STS_REFRESH_MAX_SEC} seconds, got ${seconds}`,
    );
  }
  return seconds * 1000;
}
