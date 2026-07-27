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
