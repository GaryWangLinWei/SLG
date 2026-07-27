/**
 * sanitizeErrorForLog — mask sensitive credential-shaped substrings inside an
 * error's message + stack before it is handed to the log writer or notification
 * body.
 *
 * This is defense-in-depth on top of `createRedactor`. The redactor only masks
 * *known* secrets (the ones we loaded from env). When an OSS or DingTalk error
 * embeds a fresh STS token, a signed URL, or an Authorization header into the
 * error message, those values are strings we never see at config-load time —
 * so this helper masks them by *shape*.
 *
 * Field patterns handled:
 *   - stsToken=…, accessKeyId=…, accessKeySecret=… (case-insensitive)
 *   - Authorization: …
 *   - X-aliyun-ecs-metadata-token: …
 *   - x-oss-security-token: …
 *   - OSS signed URL query: OSSAccessKeyId=…, Signature=…, Expires=…, sign=…,
 *     x-oss-signature=…
 *
 * Non-sensitive context (status codes, object keys, request IDs) is preserved
 * so operators can still triage the failure.
 */

const MASK = '[REDACTED]';

// Field=value patterns. Value ends at whitespace, comma, quote, or line end.
// The delimiter class explicitly includes CR/LF so multi-line dumps don't leak
// tokens into the next line. Trailing punctuation like `.`, `)`, `]`, or `,`
// is stripped from the boundary so error dumps like `Authorization=Bearer XYZ,`
// keep the trailing comma readable.
const FIELD_VALUE_PATTERNS = [
  /(\bstsToken\s*=\s*)[^\s,'"\r\n)\]]+/gi,
  /(\baccessKeyId\s*=\s*)[^\s,'"\r\n)\]]+/gi,
  /(\baccessKeySecret\s*=\s*)[^\s,'"\r\n)\]]+/gi,
  // Aliyun v4 signature: `Credential=<AK>/<date>/<region>/oss/aliyun_v4_request`
  /(\bCredential\s*=\s*)[^\s,'"\r\n)\]]+/gi,
];

// IMDS + OSS security-token headers first: strict single-token, so masking
// them shortens the string before the greedier Authorization rule runs.
const HEADER_PATTERNS_STRICT = [
  /(\bX-aliyun-ecs-metadata-token\s*[:=]\s*)[^\s,'"\r\n)\]]+/gi,
  /(\bx-oss-security-token\s*[:=]\s*)[^\s,'"\r\n)\]]+/gi,
];

// Authorization value can be multi-token (`Bearer XYZ`, `OSS4-HMAC-SHA256
// Credential=…, Signature=…`), so we accept whitespace inside the value but
// stop at either end-of-line, a comma, or the start of another header-shaped
// name-followed-by-`:` or `=`.
const AUTHORIZATION_PATTERN =
  /(\bAuthorization\s*[:=]\s*)[^\r\n,]+?(?=\s+[A-Za-z][\w-]*\s*[:=]|\s*[,\r\n]|$)/gi;

// OSS signed-URL query keys. Matches both `?Key=Value&…` and `&Key=Value`.
const OSS_QUERY_KEYS = ['OSSAccessKeyId', 'Signature', 'Expires', 'sign', 'x-oss-signature'];

const OSS_QUERY_PATTERNS = OSS_QUERY_KEYS.map(
  (key) => new RegExp(`(\\b${key}=)[^&\\s'"\\r\\n)\\]]+`, 'gi'),
);

function maskString(input) {
  if (typeof input !== 'string' || input === '') return input;
  let out = input;
  for (const pattern of FIELD_VALUE_PATTERNS) {
    out = out.replace(pattern, `$1${MASK}`);
  }
  for (const pattern of HEADER_PATTERNS_STRICT) {
    out = out.replace(pattern, `$1${MASK}`);
  }
  out = out.replace(AUTHORIZATION_PATTERN, `$1${MASK}`);
  for (const pattern of OSS_QUERY_PATTERNS) {
    out = out.replace(pattern, `$1${MASK}`);
  }
  return out;
}

/** Public wrapper for tests + non-Error inputs. */
export function sanitizeString(value) {
  return maskString(value);
}

/**
 * Return a new Error whose `.message` and `.stack` (and any own string props)
 * have credential-shaped substrings masked. Preserves error class, cause,
 * numeric/boolean fields, and non-string arrays/objects unchanged.
 */
export function sanitizeErrorForLog(input) {
  if (input === null || input === undefined) return input;

  // Non-Error inputs → wrap so the caller always sees an Error afterwards.
  if (!(input instanceof Error)) {
    if (typeof input === 'string') {
      return new Error(maskString(input));
    }
    if (typeof input === 'object') {
      const message = typeof input.message === 'string' ? maskString(input.message) : String(input);
      const wrapped = new Error(message);
      for (const [key, value] of Object.entries(input)) {
        if (key === 'message' || key === 'stack' || key === 'name') continue;
        try {
          wrapped[key] = typeof value === 'string' ? maskString(value) : value;
        } catch {
          // ignore read-only assignment
        }
      }
      return wrapped;
    }
    return new Error(maskString(String(input)));
  }

  const sanitized = new Error(maskString(input.message ?? ''));
  // Preserve identity of the concrete Error subclass name.
  try { sanitized.name = input.name ?? 'Error'; } catch { /* frozen */ }
  if (typeof input.stack === 'string') {
    sanitized.stack = maskString(input.stack);
  }
  // Copy own enumerable properties, masking string values.
  for (const [key, value] of Object.entries(input)) {
    if (key === 'message' || key === 'stack' || key === 'name') continue;
    try {
      sanitized[key] = typeof value === 'string' ? maskString(value) : value;
    } catch {
      // ignore assignment failures on frozen fields
    }
  }
  if (input.cause !== undefined) {
    try { sanitized.cause = input.cause; } catch { /* ignore */ }
  }
  return sanitized;
}
