import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadEnvFile } from './env-file.mjs';

test('loads variables from an env file without overriding existing values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-env-'));
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, '# release credentials\nOSS_KEY_ID=file-id\nOSS_KEY_SECRET="file-secret"\n');
  const target = { OSS_KEY_ID: 'process-id' };

  loadEnvFile(envPath, target);

  assert.deepEqual(target, {
    OSS_KEY_ID: 'process-id',
    OSS_KEY_SECRET: 'file-secret',
  });
});
