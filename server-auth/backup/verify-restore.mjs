#!/usr/bin/env node
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import OSS from 'ali-oss';

import { assertSafeDatabasePath, loadConfig } from './config.mjs';
import { createRedactor, writeLog } from './log.mjs';
import { createOnlineSnapshot, verifySnapshot } from './sqlite.mjs';
import { decryptFile, encryptFile } from './crypto.mjs';
import {
  createOssClient,
  downloadAndVerify,
  fetchStsCredentialsFromImds,
  listLatestBackup,
} from './oss.mjs';
import { sendDingtalk } from './dingtalk.mjs';
import { runRestoreVerification } from './workflow.mjs';

function tempRoot(name) {
  return mkdtemp(join(tmpdir(), name));
}

function main() {
  return (async () => {
    const config = loadConfig(process.env);
    const ossClient = await createOssClient(
      {
        region: config.ossRegion,
        bucket: config.ossBucket,
        credentialsProvider: fetchStsCredentialsFromImds,
      },
      OSS,
    );
    const deps = {
      loadConfig: () => config,
      assertSafeDatabasePath,
      ossClient,
      sqlite: { createOnlineSnapshot, verifySnapshot },
      crypto: { encryptFile, decryptFile },
      oss: { listLatestBackup, downloadAndVerify },
      dingtalk: { sendDingtalk },
      log: { writeLog, createRedactor },
      logStream: process.stdout,
      clock: () => new Date(),
      randomUUID,
      mkdtemp: (prefix) => tempRoot(prefix),
      rm,
      stat,
    };
    return runRestoreVerification(deps, process.env);
  })();
}

main().catch((error) => {
  const secrets = [
    process.env.BACKUP_ENCRYPTION_KEY,
    process.env.DINGTALK_WEBHOOK,
    process.env.DINGTALK_SECRET,
  ].filter(Boolean);
  const redact = createRedactor(secrets);
  const payload = redact({
    level: 'error',
    entry: 'verify-restore.mjs',
    message: error?.message ?? String(error),
    name: error?.name ?? 'Error',
    stack: error?.stack,
  });
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
