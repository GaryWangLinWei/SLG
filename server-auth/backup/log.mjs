const MASK = '[REDACTED]';
const BINARY_MASK = '[BINARY REDACTED]';

function isBinary(value) {
  return Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function secretStrings(secrets) {
  const values = new Set();
  for (const secret of secrets) {
    if (Buffer.isBuffer(secret) || ArrayBuffer.isView(secret) || secret instanceof ArrayBuffer) {
      const buffer = Buffer.isBuffer(secret)
        ? secret
        : Buffer.from(secret.buffer ?? secret, secret.byteOffset ?? 0, secret.byteLength);
      values.add(buffer.toString('utf8'));
      values.add(buffer.toString('base64'));
      values.add(buffer.toString('hex'));
    } else if (typeof secret === 'string') {
      values.add(secret);
    }
  }
  return [...values].filter(Boolean).sort((a, b) => b.length - a.length);
}

function replaceSecrets(value, secrets) {
  let result = value;
  for (const secret of secrets) {
    result = result.split(secret).join(MASK);
  }
  return result;
}

export function createRedactor(secrets) {
  const active = secretStrings(secrets);

  const redact = (value) => {
    if (typeof value === 'string') {
      return replaceSecrets(value, active);
    }
    if (isBinary(value)) {
      return BINARY_MASK;
    }
    if (value instanceof Error) {
      return serializeError(value, redact);
    }
    if (Array.isArray(value)) {
      return value.map(redact);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
    }
    return value;
  };

  return redact;
}

export function serializeError(error, redact) {
  if (!(error instanceof Error)) {
    return redact(error);
  }

  const result = {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...Object.fromEntries(Object.entries(error)),
  };
  return redact(result);
}

function validateEvent(event) {
  for (const field of ['runId', 'stage', 'status']) {
    if (typeof event?.[field] !== 'string' || event[field].trim() === '') {
      throw new Error(`Log event ${field} must be a non-empty string`);
    }
  }
}

export function writeLog(stream, event, redact) {
  validateEvent(event);
  const record = redact({ ...event, timestamp: new Date().toISOString() });
  stream.write(`${JSON.stringify(record)}\n`);
}
