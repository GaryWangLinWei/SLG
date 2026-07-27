import { basename, join } from 'node:path';

import { sanitizeErrorForLog as defaultSanitize } from './sanitize-error.mjs';

/** Fixed daily-backup stages, evaluated in order. `cleanup` always runs. */
export const DAILY_STAGES = Object.freeze([
  'preflight', 'snapshot', 'integrity', 'encrypt', 'upload', 'verify-upload',
]);

export const FORMAT_VERSION = 1;
const METADATA_KEYS = ['format-version', 'sha256', 'snapshot-size', 'created-at', 'run-id'];

// ---- Object key ---------------------------------------------------------

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

/**
 * Compute the Asia/Shanghai wall-clock components (Y/M/D h:m:s) of a UTC Date
 * without importing any timezone library. We do this by shifting the date by
 * +8h and then reading UTC accessors — this is exact because Shanghai has no
 * DST and a fixed +08:00 offset.
 */
function shanghaiParts(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

export function buildObjectKey(prefix, date) {
  if (typeof prefix !== 'string' || prefix === '') {
    throw new TypeError('prefix must be a non-empty string');
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('date must be a valid Date');
  }
  const p = shanghaiParts(date);
  const stamp =
    `${p.year}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}${pad(p.second)}+0800`;
  return `${prefix}${p.year}/${pad(p.month)}/auth-${stamp}.db.enc`;
}

// ---- Helpers ------------------------------------------------------------

function collectSecrets(config) {
  const secrets = [];
  if (config?.encryptionKey) secrets.push(config.encryptionKey);
  if (config?.dingtalkSecret) secrets.push(config.dingtalkSecret);
  if (config?.dingtalkWebhook) secrets.push(config.dingtalkWebhook);
  return secrets;
}

function attachAdditional(primary, secondary) {
  if (!secondary) return;
  const list = Array.isArray(primary.additionalErrors) ? primary.additionalErrors : [];
  list.push(secondary);
  primary.additionalErrors = list;
  if (!primary.cause) primary.cause = secondary;
}

function tagStage(error, stage) {
  if (error && typeof error === 'object' && !('stage' in error)) {
    try { error.stage = stage; } catch { /* frozen error: ignore */ }
  }
  return error;
}

async function safeLog(deps, event, redact) {
  try {
    const sanitize = deps.sanitizeErrorForLog ?? defaultSanitize;
    const outbound = event?.error !== undefined
      ? { ...event, error: sanitize(event.error) }
      : event;
    deps.log.writeLog(deps.logStream, outbound, redact);
  } catch {
    // Never let logging kill the workflow.
  }
}

async function safeNotify(deps, config, text, redact, runId) {
  try {
    await deps.dingtalk.sendDingtalk({
      webhook: config.dingtalkWebhook,
      secret: config.dingtalkSecret,
      text,
    });
    await safeLog(deps, { runId, stage: 'notify', status: 'ok' }, redact);
    return null;
  } catch (error) {
    await safeLog(
      deps,
      { runId, stage: 'notify', status: 'warn', error },
      redact,
    );
    return error;
  }
}

async function safeCleanup(deps, tempDir, runId, redact) {
  try {
    await deps.rm(tempDir, { recursive: true, force: true });
    await safeLog(deps, { runId, stage: 'cleanup', status: 'ok' }, redact);
    return null;
  } catch (error) {
    await safeLog(
      deps,
      { runId, stage: 'cleanup', status: 'warn', error },
      redact,
    );
    return error;
  }
}

function verifyRemoteHead(head, expectedMeta, localSize) {
  const headers = head?.res?.headers ?? {};
  const remoteSize = Number(headers['content-length']);
  if (!Number.isFinite(remoteSize) || remoteSize !== localSize) {
    throw new Error(
      `Uploaded object size mismatch: local=${localSize} remote=${headers['content-length']}`,
    );
  }
  const remoteMeta = head?.meta ?? {};
  for (const key of METADATA_KEYS) {
    if (remoteMeta[key] !== expectedMeta[key]) {
      throw new Error(
        `Uploaded metadata field ${key} mismatch: expected=${expectedMeta[key]} remote=${remoteMeta[key]}`,
      );
    }
  }
}

// ---- Daily workflow -----------------------------------------------------

export async function runBackup(deps, env) {
  const config = deps.loadConfig(env);
  const redact = deps.log.createRedactor(collectSecrets(config));
  const runId = deps.randomUUID();
  const startedAt = deps.clock();

  const tempDir = await deps.mkdtemp('slg-auth-backup-');
  const snapshotPath = join(tempDir, 'snapshot.db');
  const encryptedPath = join(tempDir, 'snapshot.db.enc.tmp');

  let primaryError;
  let result;
  try {
    // preflight
    try {
      await deps.assertSafeDatabasePath(config.dbPath);
      await safeLog(deps, { runId, stage: 'preflight', status: 'ok' }, redact);
    } catch (error) {
      tagStage(error, 'preflight');
      primaryError = error;
      await safeLog(deps, { runId, stage: 'preflight', status: 'fail', error }, redact);
      throw error;
    }

    // snapshot
    try {
      await deps.sqlite.createOnlineSnapshot(config.dbPath, snapshotPath);
      await safeLog(deps, { runId, stage: 'snapshot', status: 'ok' }, redact);
    } catch (error) {
      tagStage(error, 'snapshot');
      primaryError = error;
      await safeLog(deps, { runId, stage: 'snapshot', status: 'fail', error }, redact);
      throw error;
    }

    // integrity
    let snapshotSize;
    try {
      const integrity = deps.sqlite.verifySnapshot(snapshotPath);
      snapshotSize = integrity.size;
      await safeLog(deps, { runId, stage: 'integrity', status: 'ok', size: snapshotSize }, redact);
    } catch (error) {
      tagStage(error, 'integrity');
      primaryError = error;
      await safeLog(deps, { runId, stage: 'integrity', status: 'fail', error }, redact);
      throw error;
    }

    // encrypt
    let sha256;
    try {
      sha256 = await deps.crypto.encryptFile(snapshotPath, encryptedPath, config.encryptionKey);
      await safeLog(deps, { runId, stage: 'encrypt', status: 'ok' }, redact);
    } catch (error) {
      tagStage(error, 'encrypt');
      primaryError = error;
      await safeLog(deps, { runId, stage: 'encrypt', status: 'fail', error }, redact);
      throw error;
    }

    // upload
    const objectKey = buildObjectKey(config.ossPrefix, startedAt);
    const metadata = {
      'format-version': String(FORMAT_VERSION),
      'sha256': sha256,
      'snapshot-size': String(snapshotSize),
      'created-at': startedAt.toISOString(),
      'run-id': runId,
    };
    try {
      await deps.ossClient.put(objectKey, encryptedPath, { meta: { ...metadata } });
      await safeLog(deps, { runId, stage: 'upload', status: 'ok', objectKey }, redact);
    } catch (error) {
      tagStage(error, 'upload');
      primaryError = error;
      await safeLog(deps, { runId, stage: 'upload', status: 'fail', error, objectKey }, redact);
      throw error;
    }

    // verify-upload
    try {
      const head = await deps.ossClient.head(objectKey);
      const encryptedStat = await deps.stat(encryptedPath);
      verifyRemoteHead(head, metadata, encryptedStat.size);
      await safeLog(deps, { runId, stage: 'verify-upload', status: 'ok', objectKey }, redact);
    } catch (error) {
      tagStage(error, 'verify-upload');
      primaryError = error;
      await safeLog(
        deps,
        { runId, stage: 'verify-upload', status: 'fail', error, objectKey },
        redact,
      );
      throw error;
    }

    const finishedAt = deps.clock();
    result = {
      runId,
      objectKey,
      sha256,
      snapshotSize,
      createdAt: startedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  } catch (error) {
    if (!primaryError) primaryError = error;
  } finally {
    // Cleanup always runs; failures degrade to warn but never overwrite primary.
    const cleanupError = await safeCleanup(deps, tempDir, runId, redact);
    if (cleanupError && primaryError) attachAdditional(primaryError, cleanupError);
  }

  if (primaryError) {
    const sanitize = deps.sanitizeErrorForLog ?? defaultSanitize;
    const safeErr = sanitize(primaryError);
    const text = redact(
      `[SLG-AUTH-BACKUP] daily FAIL runId=${runId} stage=${primaryError.stage ?? 'unknown'} ` +
      `error=${safeErr?.message ?? String(safeErr)}`,
    );
    const notifyError = await safeNotify(deps, config, text, redact, runId);
    if (notifyError) attachAdditional(primaryError, notifyError);
    throw primaryError;
  }

  return result;
}

// ---- Monthly restore verification --------------------------------------

export async function runRestoreVerification(deps, env) {
  const config = deps.loadConfig(env);
  const redact = deps.log.createRedactor(collectSecrets(config));
  const runId = deps.randomUUID();
  const startedAt = deps.clock();

  const tempDir = await deps.mkdtemp('slg-auth-verify-');
  const downloadPath = join(tempDir, 'download.db.enc');
  const decryptedPath = join(tempDir, 'restored.db');

  let primaryError;
  let result;
  try {
    // list
    let latest;
    try {
      latest = await deps.oss.listLatestBackup(deps.ossClient, config.ossPrefix);
      if (!latest) throw new Error('No backup objects found under prefix');
      await safeLog(
        deps,
        { runId, stage: 'list', status: 'ok', objectKey: latest.name },
        redact,
      );
    } catch (error) {
      tagStage(error, 'list');
      primaryError = error;
      await safeLog(deps, { runId, stage: 'list', status: 'fail', error }, redact);
      throw error;
    }

    // head + metadata sanity
    let head;
    let expectedSha;
    try {
      head = await deps.ossClient.head(latest.name);
      const meta = head?.meta ?? {};
      for (const key of METADATA_KEYS) {
        if (typeof meta[key] !== 'string' || meta[key] === '') {
          throw new Error(`Remote metadata field ${key} is missing`);
        }
      }
      if (meta['format-version'] !== String(FORMAT_VERSION)) {
        throw new Error(
          `Remote format-version mismatch: expected=${FORMAT_VERSION} actual=${meta['format-version']}`,
        );
      }
      const headers = head?.res?.headers ?? {};
      const remoteSize = Number(headers['content-length']);
      if (Number.isFinite(latest.size) && Number.isFinite(remoteSize) && latest.size !== remoteSize) {
        throw new Error(
          `Remote content-length mismatch: list=${latest.size} head=${remoteSize}`,
        );
      }
      expectedSha = meta['sha256'];
      await safeLog(deps, { runId, stage: 'head', status: 'ok', objectKey: latest.name }, redact);
    } catch (error) {
      tagStage(error, 'head');
      primaryError = error;
      await safeLog(deps, { runId, stage: 'head', status: 'fail', error }, redact);
      throw error;
    }

    // download + SHA verify
    let downloadInfo;
    try {
      downloadInfo = await deps.oss.downloadAndVerify(deps.ossClient, latest, downloadPath, expectedSha);
      await safeLog(deps, { runId, stage: 'download', status: 'ok', size: downloadInfo.size }, redact);
    } catch (error) {
      tagStage(error, 'download');
      primaryError = error;
      await safeLog(deps, { runId, stage: 'download', status: 'fail', error }, redact);
      throw error;
    }

    // decrypt
    try {
      await deps.crypto.decryptFile(downloadPath, decryptedPath, config.encryptionKey);
      await safeLog(deps, { runId, stage: 'decrypt', status: 'ok' }, redact);
    } catch (error) {
      tagStage(error, 'decrypt');
      primaryError = error;
      await safeLog(deps, { runId, stage: 'decrypt', status: 'fail', error }, redact);
      throw error;
    }

    // verify snapshot (never touches production DB)
    let integrityResult;
    try {
      if (decryptedPath === config.dbPath) {
        throw new Error('Refusing to verify snapshot at the production database path');
      }
      integrityResult = deps.sqlite.verifySnapshot(decryptedPath);
      await safeLog(
        deps,
        { runId, stage: 'verify-restore', status: 'ok', integrity: integrityResult.integrity },
        redact,
      );
    } catch (error) {
      tagStage(error, 'verify-restore');
      primaryError = error;
      await safeLog(deps, { runId, stage: 'verify-restore', status: 'fail', error }, redact);
      throw error;
    }

    const finishedAt = deps.clock();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    result = {
      runId,
      objectKey: latest.name,
      integrity: integrityResult.integrity,
      createdAt: head?.meta?.['created-at'] ?? null,
      verifiedAt: finishedAt.toISOString(),
      durationMs,
    };
  } catch (error) {
    if (!primaryError) primaryError = error;
  } finally {
    const cleanupError = await safeCleanup(deps, tempDir, runId, redact);
    if (cleanupError && primaryError) attachAdditional(primaryError, cleanupError);
  }

  if (primaryError) {
    const sanitize = deps.sanitizeErrorForLog ?? defaultSanitize;
    const safeErr = sanitize(primaryError);
    const text = redact(
      `[SLG-AUTH-BACKUP] monthly VERIFY FAIL runId=${runId} stage=${primaryError.stage ?? 'unknown'} error=${safeErr?.message ?? String(safeErr)}`,
    );
    const notifyError = await safeNotify(deps, config, text, redact, runId);
    if (notifyError) attachAdditional(primaryError, notifyError);
    throw primaryError;
  }

  const successText = redact(
    `[SLG-AUTH-BACKUP] monthly VERIFY OK` +
    ` object=${basename(result.objectKey)}` +
    ` integrity=${result.integrity}` +
    ` created-at=${result.createdAt ?? 'unknown'}` +
    ` verified-at=${result.verifiedAt}` +
    ` duration=${result.durationMs}ms`,
  );
  await safeNotify(deps, config, successText, redact, runId);
  return result;
}
