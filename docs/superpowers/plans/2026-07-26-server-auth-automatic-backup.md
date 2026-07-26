# Server Auth Automatic Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independently scheduled, encrypted, off-site backup and restore-verification system for the production `server-auth` SQLite database.

**Architecture:** Focused ESM modules under `server-auth/backup/` create an online SQLite snapshot, validate it, encrypt it with AES-256-GCM, and upload it to a private OSS bucket using ECS RAM-role temporary credentials. Hardened systemd one-shot services and timers schedule daily backups and monthly non-destructive restore verification; DingTalk receives signed failure alerts and monthly success proofs.

**Tech Stack:** Node.js 20 ESM, `better-sqlite3`, `ali-oss`, Node built-in `crypto`/`fetch`/`node:test`, systemd timers, Alibaba Cloud ECS RAM roles and OSS lifecycle rules.

---

## Scope and repository safety

The working tree already contains unrelated staged and unstaged changes. Every commit in this plan must use explicit pathspecs. Before each commit run `git diff --cached --name-only`; if it contains a path outside the current task, do not commit until the unrelated staged files are preserved and excluded without discarding their changes. Never run `git reset --hard`, `git checkout -- .`, `git clean`, or blanket `git add .`.

Execute implementation in an isolated worktree created via `superpowers:using-git-worktrees`, because the current `master` working tree is dirty. The implementation branch must start from commit `cf028fc` or a later commit containing the approved design.

## File map

**Create:**

- `server-auth/backup/config.mjs` — parse and validate environment configuration without logging secrets.
- `server-auth/backup/redact.mjs` — structured logging and secret redaction.
- `server-auth/backup/sqlite.mjs` — online snapshot and read-only database validation.
- `server-auth/backup/crypto.mjs` — versioned AES-256-GCM file format and SHA-256.
- `server-auth/backup/dingtalk.mjs` — signed DingTalk webhook client.
- `server-auth/backup/ecs-credentials.mjs` — ECS IMDSv2 RAM-role temporary credential retrieval.
- `server-auth/backup/oss.mjs` — OSS upload verification, listing, selection, and download.
- `server-auth/backup/workspace.mjs` — unique temporary workspace lifecycle.
- `server-auth/backup/backup-runner.mjs` — dependency-injected daily workflow.
- `server-auth/backup/verify-runner.mjs` — dependency-injected monthly verification workflow.
- `server-auth/backup/backup.mjs` — daily CLI entry point.
- `server-auth/backup/verify-restore.mjs` — monthly CLI entry point.
- `server-auth/backup/*.test.mjs` — colocated Node test suites for every module/workflow.
- `deploy/systemd/slg-auth-backup.service`
- `deploy/systemd/slg-auth-backup.timer`
- `deploy/systemd/slg-auth-verify.service`
- `deploy/systemd/slg-auth-verify.timer`
- `deploy/systemd/slg-auth-backup.env.example`
- `docs/server-auth-backup-operations.md` — cloud setup, deployment, validation, restore, and rollback runbook.

**Modify:**

- `server-auth/package.json` — add backup/test scripts and `ali-oss` runtime dependency.
- `server-auth/package-lock.json` — lock the dependency.
- `docs/VPS-运维指南.md` — point backup operations to the new runbook.

## Stable interfaces

These signatures are fixed across tasks:

```js
loadBackupConfig(env) -> Config
redact(value, secrets) -> sanitizedValue
createLogger({ output, errorOutput, secrets, now }) -> { info, error }
createSnapshot({ sourcePath, destinationPath }) -> Promise<void>
validateSnapshot({ databasePath, requiredTables }) -> ValidationResult
encryptFile({ inputPath, outputPath, key, randomBytes }) -> Promise<EncryptionResult>
decryptFile({ inputPath, outputPath, key }) -> Promise<void>
sha256File(filePath) -> Promise<string>
signDingTalk({ timestamp, secret }) -> string
sendDingTalk({ webhook, secret, text, fetchImpl, now }) -> Promise<void>
getRamRoleCredentials({ fetchImpl, metadataBaseUrl }) -> Promise<Credentials>
createOssStore({ OSS, config, getCredentials }) -> OssStore
createWorkspace({ root, runId }) -> Promise<{ dir, snapshotPath, encryptedPath, restoredPath, cleanup }>
runBackup({ config, deps }) -> Promise<BackupResult>
runRestoreVerification({ config, deps }) -> Promise<VerificationResult>
```

The required table list is:

```js
export const REQUIRED_TABLES = [
  'activation_codes',
  'device_bindings',
  'heartbeat_logs',
  'invitations',
  'remote_codes',
  'remote_logs',
  'remote_sessions',
  'remote_devices',
];
```

---

### Task 1: Establish backup test harness and dependencies

**Files:**
- Modify: `server-auth/package.json`
- Modify: `server-auth/package-lock.json`
- Create: `server-auth/backup/smoke.test.mjs`

- [ ] **Step 1: Add a failing smoke test**

```js
// server-auth/backup/smoke.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKUP_FORMAT_VERSION } from './crypto.mjs';

test('backup modules load as ESM', () => {
  assert.equal(BACKUP_FORMAT_VERSION, 1);
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run from `server-auth/`:

```bash
node --test backup/smoke.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `backup/crypto.mjs`.

- [ ] **Step 3: Add scripts and dependency**

Update `server-auth/package.json` scripts and dependencies:

```json
{
  "scripts": {
    "dev": "ts-node index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test:backup": "node --test backup/*.test.mjs",
    "backup:run": "node backup/backup.mjs",
    "backup:verify": "node backup/verify-restore.mjs"
  },
  "dependencies": {
    "ali-oss": "^6.23.0"
  }
}
```

Run from `server-auth/`:

```bash
npm install
```

Create the minimal export:

```js
// server-auth/backup/crypto.mjs
export const BACKUP_FORMAT_VERSION = 1;
```

- [ ] **Step 4: Run smoke test and build**

```bash
npm run test:backup
npm run build
```

Expected: smoke test PASS; TypeScript build PASS.

- [ ] **Step 5: Commit only dependency and harness files**

```bash
git add -- server-auth/package.json server-auth/package-lock.json server-auth/backup/smoke.test.mjs server-auth/backup/crypto.mjs
git diff --cached --name-only
git commit -m "test(auth): add backup module harness"
```

---

### Task 2: Validate configuration and redact secrets

**Files:**
- Create: `server-auth/backup/config.mjs`
- Create: `server-auth/backup/config.test.mjs`
- Create: `server-auth/backup/redact.mjs`
- Create: `server-auth/backup/redact.test.mjs`

- [ ] **Step 1: Write failing configuration tests**

Cover a valid configuration and rejection of missing values, relative DB paths, invalid Base64/non-32-byte keys, non-HTTPS DingTalk URLs, prefixes not ending in `/`, and non-positive timeouts. Use a temporary regular database file and a symlink test guarded by platform support.

```js
const validEnv = {
  BACKUP_DB_PATH: dbPath,
  BACKUP_OSS_REGION: 'oss-cn-shanghai',
  BACKUP_OSS_BUCKET: 'slg-auth-backups-example',
  BACKUP_OSS_PREFIX: 'daily/',
  BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  DINGTALK_WEBHOOK: 'https://oapi.dingtalk.com/robot/send?access_token=secret-token',
  DINGTALK_SECRET: 'SECsecret',
};
assert.equal(loadBackupConfig(validEnv).databasePath, dbPath);
assert.throws(() => loadBackupConfig({ ...validEnv, BACKUP_DB_PATH: './auth.db' }), /absolute/);
assert.throws(() => loadBackupConfig({ ...validEnv, BACKUP_ENCRYPTION_KEY: Buffer.alloc(31).toString('base64') }), /32 bytes/);
```

- [ ] **Step 2: Write failing redaction tests**

```js
const secrets = ['access_token=abc', 'SECsecret', 'temporary-token'];
const sanitized = redact({ message: 'failed access_token=abc', nested: ['SECsecret'] }, secrets);
assert.deepEqual(sanitized, { message: 'failed [REDACTED]', nested: ['[REDACTED]'] });
```

Also assert `createLogger()` emits exactly one JSON object per line with `timestamp`, `level`, `runId`, `stage`, and no secret substrings.

- [ ] **Step 3: Run tests and verify failures**

```bash
node --test backup/config.test.mjs backup/redact.test.mjs
```

Expected: FAIL because exports do not exist.

- [ ] **Step 4: Implement strict config parsing**

`loadBackupConfig(env)` must return decoded `encryptionKey: Buffer`, immutable strings, defaults `metadataBaseUrl=http://100.100.100.200/latest`, `workspaceRoot=/var/lib/slg-auth-backup/tmp`, and `instanceName=slg-auth-production`. It must use `lstatSync` to reject symlinks and non-regular files and must never include secret values in thrown messages.

- [ ] **Step 5: Implement recursive redaction and JSON logger**

Handle strings, errors, arrays, plain objects, `undefined`, and circular references. Replace exact secret occurrences with `[REDACTED]`; serialize errors as `{ name, message, stack }` after redaction.

- [ ] **Step 6: Run focused and aggregate tests**

```bash
node --test backup/config.test.mjs backup/redact.test.mjs
npm run test:backup
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -- server-auth/backup/config.mjs server-auth/backup/config.test.mjs server-auth/backup/redact.mjs server-auth/backup/redact.test.mjs
git commit -m "feat(auth): validate backup configuration"
```

---

### Task 3: Create and validate SQLite snapshots

**Files:**
- Create: `server-auth/backup/sqlite.mjs`
- Create: `server-auth/backup/sqlite.test.mjs`

- [ ] **Step 1: Write failing WAL snapshot test**

Create a temporary source DB, set WAL, create all `REQUIRED_TABLES`, insert one activation code, then call `createSnapshot()` while the source connection remains open. Assert the snapshot contains the committed row.

```js
await createSnapshot({ sourcePath, destinationPath });
const result = validateSnapshot({ databasePath: destinationPath, requiredTables: REQUIRED_TABLES });
assert.equal(result.integrity, 'ok');
assert.equal(result.tableCounts.activation_codes, 1);
```

- [ ] **Step 2: Write failing validation tests**

Test zero-byte input, corrupt bytes, and a valid SQLite DB missing `remote_devices`. Assert errors name the failed check but never return row contents.

- [ ] **Step 3: Verify tests fail**

```bash
node --test backup/sqlite.test.mjs
```

Expected: FAIL because `sqlite.mjs` is missing.

- [ ] **Step 4: Implement online backup and read-only validation**

Use `new Database(sourcePath, { readonly: true, fileMustExist: true })` and `await source.backup(destinationPath)`. Ensure both handles close in `finally`. Validate via a read-only connection, `PRAGMA integrity_check`, `sqlite_master`, and `SELECT count(*)` for each required table. Return only counts, file size, and `integrity: 'ok'`.

- [ ] **Step 5: Run tests**

```bash
node --test backup/sqlite.test.mjs
npm run test:backup
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add -- server-auth/backup/sqlite.mjs server-auth/backup/sqlite.test.mjs
git commit -m "feat(auth): create consistent sqlite snapshots"
```

---

### Task 4: Implement versioned AES-256-GCM files

**Files:**
- Modify: `server-auth/backup/crypto.mjs`
- Create: `server-auth/backup/crypto.test.mjs`

- [ ] **Step 1: Write failing round-trip and format tests**

Fix the binary format exactly:

```text
bytes 0..7   ASCII "SLGAUTHB"
byte 8       version 1
byte 9       nonce length 12
byte 10      tag length 16
bytes 11..22 nonce
bytes 23..38 authentication tag
bytes 39..   ciphertext
AAD          UTF-8 "SLG-AUTH-BACKUP:v1"
```

Assert round-trip equality, distinct ciphertexts/nonces for two encryptions, and returned `sha256`, `encryptedSize`, `plaintextSize`, and `formatVersion`.

- [ ] **Step 2: Write tampering tests**

Mutate the magic, version, nonce, tag, and ciphertext one at a time. Every mutation must reject without leaving a usable output plaintext file.

- [ ] **Step 3: Verify failures**

```bash
node --test backup/crypto.test.mjs
```

Expected: FAIL because encryption functions are missing.

- [ ] **Step 4: Implement streaming encryption/decryption**

Use `createCipheriv('aes-256-gcm', key, nonce)` and `createDecipheriv`. Write to a sibling `*.partial` path with mode `0600`, fsync/close it, then rename atomically. On failure remove partial and destination files. Compute SHA-256 over the final encrypted file.

- [ ] **Step 5: Run tests**

```bash
node --test backup/crypto.test.mjs
npm run test:backup
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add -- server-auth/backup/crypto.mjs server-auth/backup/crypto.test.mjs
git commit -m "feat(auth): encrypt database backups"
```

---

### Task 5: Add DingTalk signed notifications

**Files:**
- Create: `server-auth/backup/dingtalk.mjs`
- Create: `server-auth/backup/dingtalk.test.mjs`

- [ ] **Step 1: Write failing fixed-vector signature test**

Use a fixed timestamp and secret. Independently calculate the expected HMAC in the test:

```js
const expected = encodeURIComponent(
  createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64'),
);
assert.equal(signDingTalk({ timestamp, secret }), expected);
```

- [ ] **Step 2: Write request and failure tests**

Inject `fetchImpl`; assert POST JSON is `{ msgtype: 'text', text: { content } }`, URL has `timestamp` and `sign`, and non-2xx or DingTalk `{ errcode: nonzero }` rejects with a sanitized error.

- [ ] **Step 3: Verify failures**

```bash
node --test backup/dingtalk.test.mjs
```

Expected: FAIL because module is missing.

- [ ] **Step 4: Implement the signed client**

Validate `https:` URL, append parameters through `URL.searchParams`, use a 10-second `AbortSignal.timeout`, and never put the final signed URL in an error message.

- [ ] **Step 5: Run and commit**

```bash
node --test backup/dingtalk.test.mjs
npm run test:backup
git add -- server-auth/backup/dingtalk.mjs server-auth/backup/dingtalk.test.mjs
git commit -m "feat(auth): send signed backup alerts"
```

---

### Task 6: Retrieve RAM-role credentials through ECS IMDSv2

**Files:**
- Create: `server-auth/backup/ecs-credentials.mjs`
- Create: `server-auth/backup/ecs-credentials.test.mjs`

- [ ] **Step 1: Write failing request-sequence test**

Mock three fetches:

1. `PUT /latest/api/token` with header `X-aliyun-ecs-metadata-token-ttl-seconds: 21600`;
2. `GET /latest/meta-data/ram/security-credentials/` with returned token header;
3. `GET /latest/meta-data/ram/security-credentials/<encoded-role>` with token header.

Assert return shape:

```js
{
  accessKeyId: 'STS.test',
  accessKeySecret: 'secret',
  stsToken: 'token',
  expiration: '2026-07-27T00:00:00Z',
  roleName: 'SlgAuthBackupRole'
}
```

- [ ] **Step 2: Write failure tests**

Reject missing role, non-200 response, malformed JSON, `Code !== 'Success'`, missing fields, and credentials expiring within five minutes. Assert secrets never appear in error messages.

- [ ] **Step 3: Verify failures**

```bash
node --test backup/ecs-credentials.test.mjs
```

Expected: FAIL because module is missing.

- [ ] **Step 4: Implement strict IMDSv2 retrieval**

Use only injected `metadataBaseUrl` (default link-local address), URL-encode role names, 5-second request timeouts, and no IMDSv1 fallback. Validate expiration against injected `now` for deterministic tests.

- [ ] **Step 5: Run and commit**

```bash
node --test backup/ecs-credentials.test.mjs
npm run test:backup
git add -- server-auth/backup/ecs-credentials.mjs server-auth/backup/ecs-credentials.test.mjs
git commit -m "feat(auth): load ECS role credentials"
```

---

### Task 7: Implement private OSS storage adapter

**Files:**
- Create: `server-auth/backup/oss.mjs`
- Create: `server-auth/backup/oss.test.mjs`

- [ ] **Step 1: Write failing upload-verification tests**

Inject a fake `OSS` constructor and credentials provider. Assert the client receives `region`, `bucket`, `accessKeyId`, `accessKeySecret`, `stsToken`, `secure: true`, and `refreshSTSToken`. Assert `put()` metadata contains `format-version`, `sha256`, `plaintext-size`, `created-at`, and `run-id`, then `head()` must match content length and every expected metadata value.

- [ ] **Step 2: Write failing list/download tests**

Test paginated `listV2` traversal under `daily/`, filtering only `.db.enc` objects, deterministic latest selection by key, empty-list failure, and streamed download to a `*.partial` file followed by atomic rename.

- [ ] **Step 3: Verify failures**

```bash
node --test backup/oss.test.mjs
```

Expected: FAIL because module is missing.

- [ ] **Step 4: Implement adapter**

Export `buildObjectKey({ prefix, now })`, `uploadVerified()`, `listBackupObjects()`, `latestBackupObject()`, and `downloadVerified()`. Normalize ali-oss response header casing. Reject public ACL manipulation; the adapter exposes no delete API.

- [ ] **Step 5: Run and commit**

```bash
node --test backup/oss.test.mjs
npm run test:backup
git add -- server-auth/backup/oss.mjs server-auth/backup/oss.test.mjs
git commit -m "feat(auth): store encrypted backups in OSS"
```

---

### Task 8: Manage unique workspaces and cleanup

**Files:**
- Create: `server-auth/backup/workspace.mjs`
- Create: `server-auth/backup/workspace.test.mjs`

- [ ] **Step 1: Write failing lifecycle tests**

Assert workspace names contain only a supplied safe run ID, all paths remain under the configured root, permissions are `0700`, cleanup removes the directory on success and simulated failure, and path traversal run IDs are rejected.

- [ ] **Step 2: Verify failures**

```bash
node --test backup/workspace.test.mjs
```

Expected: FAIL because module is missing.

- [ ] **Step 3: Implement workspace lifecycle**

Create root and unique run directory with `mode: 0o700`; expose fixed child names `snapshot.db`, `backup.db.enc`, and `restored.db`; cleanup uses recursive forced removal only after verifying the resolved directory is a direct child of the configured root.

- [ ] **Step 4: Run and commit**

```bash
node --test backup/workspace.test.mjs
npm run test:backup
git add -- server-auth/backup/workspace.mjs server-auth/backup/workspace.test.mjs
git commit -m "feat(auth): isolate backup workspaces"
```

---

### Task 9: Orchestrate the daily backup workflow

**Files:**
- Create: `server-auth/backup/backup-runner.mjs`
- Create: `server-auth/backup/backup-runner.test.mjs`

- [ ] **Step 1: Write failing successful-flow test**

Inject spies for workspace, snapshot, validation, encryption, OSS, notification, logger, and clock. Assert exact order:

```text
workspace → snapshot → validate → encrypt → uploadVerified → cleanup
```

Assert no DingTalk message on success and result includes only `runId`, object key, sizes, SHA-256, and duration.

- [ ] **Step 2: Write one failing test per stage**

For failures in `snapshot`, `integrity`, `encrypt`, `upload`, and `verify-upload`, assert:

- later stages are not called;
- cleanup is always called once;
- one signed failure notification is attempted;
- original error is rethrown even when notification also fails;
- logs and notification text contain no configured secret or database content.

- [ ] **Step 3: Verify failures**

```bash
node --test backup/backup-runner.test.mjs
```

Expected: FAIL because runner is missing.

- [ ] **Step 4: Implement workflow with explicit stage tracking**

Use `try/catch/finally`, update `stage` before each operation, and collect cleanup/notification failures as secondary errors. Do not upload when validation fails. Generate the run ID and object key from one injected clock reading.

- [ ] **Step 5: Run and commit**

```bash
node --test backup/backup-runner.test.mjs
npm run test:backup
git add -- server-auth/backup/backup-runner.mjs server-auth/backup/backup-runner.test.mjs
git commit -m "feat(auth): orchestrate daily database backups"
```

---

### Task 10: Orchestrate monthly restore verification

**Files:**
- Create: `server-auth/backup/verify-runner.mjs`
- Create: `server-auth/backup/verify-runner.test.mjs`

- [ ] **Step 1: Write failing successful-flow test**

Assert exact order:

```text
workspace → latestBackupObject → downloadVerified → sha256 check → decrypt → validate → success notification → cleanup
```

Assert no production DB path is passed to decrypt or validation and no OSS mutation method is called.

- [ ] **Step 2: Write failure tests**

Cover empty Bucket, metadata mismatch, SHA mismatch, authentication failure, SQLite corruption, missing table, DingTalk success-message failure, and cleanup failure. Validation failures send one failure alert; success sends exactly one proof containing backup creation time, object key, `ok`, and duration but no table data.

- [ ] **Step 3: Verify failures**

```bash
node --test backup/verify-runner.test.mjs
```

Expected: FAIL because runner is missing.

- [ ] **Step 4: Implement non-destructive workflow**

The runner may only use workspace paths for downloads and restored plaintext. It must compare downloaded SHA-256 to object metadata before decrypting and always clean up.

- [ ] **Step 5: Run and commit**

```bash
node --test backup/verify-runner.test.mjs
npm run test:backup
git add -- server-auth/backup/verify-runner.mjs server-auth/backup/verify-runner.test.mjs
git commit -m "feat(auth): verify backup restorability"
```

---

### Task 11: Add production CLI entry points

**Files:**
- Create: `server-auth/backup/backup.mjs`
- Create: `server-auth/backup/verify-restore.mjs`
- Create: `server-auth/backup/entrypoints.test.mjs`

- [ ] **Step 1: Write failing child-process entry-point tests**

Run each entry point with an intentionally missing config in a child Node process. Assert nonzero exit, one structured JSON error line, and no raw environment values. Add a `BACKUP_DRY_WIRING_TEST=1` injection seam that loads all production dependencies but stops before metadata/OSS access and exits zero with `{"stage":"wiring","status":"ok"}`.

- [ ] **Step 2: Verify failures**

```bash
node --test backup/entrypoints.test.mjs
```

Expected: FAIL because entry points are missing.

- [ ] **Step 3: Wire production dependencies**

Import `ali-oss`, config, logger, RAM credentials, OSS adapter, SQLite, crypto, workspace, DingTalk, and the appropriate runner. Set `process.exitCode = 1` on failure; do not call `process.exit()` before streams flush. Handle `unhandledRejection` and `uncaughtException` with redacted structured logging.

- [ ] **Step 4: Run scripts and build**

```bash
node --test backup/entrypoints.test.mjs
npm run test:backup
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -- server-auth/backup/backup.mjs server-auth/backup/verify-restore.mjs server-auth/backup/entrypoints.test.mjs
git commit -m "feat(auth): add backup command entry points"
```

---

### Task 12: Add hardened systemd services and timers

**Files:**
- Create: `deploy/systemd/slg-auth-backup.service`
- Create: `deploy/systemd/slg-auth-backup.timer`
- Create: `deploy/systemd/slg-auth-verify.service`
- Create: `deploy/systemd/slg-auth-verify.timer`
- Create: `deploy/systemd/slg-auth-backup.env.example`
- Create: `deploy/systemd/systemd-units.test.mjs`

- [ ] **Step 1: Write failing static unit tests**

Parse units as text and assert both services contain:

```ini
Type=oneshot
EnvironmentFile=/etc/slg-auth-backup.env
UMask=0077
TimeoutStartSec=15min
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/slg-auth-backup
ExecStart=/usr/bin/flock --nonblock /run/lock/slg-auth-backup.lock ...
```

Assert timers contain `Persistent=true`, `RandomizedDelaySec=5m`, daily `OnCalendar=*-*-* 03:15:00 Asia/Shanghai`, and monthly `OnCalendar=*-*-01 04:15:00 Asia/Shanghai`.

- [ ] **Step 2: Verify failure**

```bash
node --test deploy/systemd/systemd-units.test.mjs
```

Expected: FAIL because units are missing.

- [ ] **Step 3: Implement units**

Use absolute entry-point paths under `/root/server-auth/backup/`. Set `WorkingDirectory=/root/server-auth`, `StateDirectory=slg-auth-backup`, and `ReadOnlyPaths=/root/server-auth`. Do not use `ProtectKernelTunables` or network namespace restrictions that could break DNS, TLS, or IMDS until verified on VPS.

The environment example contains variable names and safe examples only; it must not contain real secrets.

- [ ] **Step 4: Validate locally and on Linux**

```bash
node --test deploy/systemd/systemd-units.test.mjs
```

Expected: PASS. During VPS deployment additionally run:

```bash
systemd-analyze verify /etc/systemd/system/slg-auth-backup.service /etc/systemd/system/slg-auth-backup.timer /etc/systemd/system/slg-auth-verify.service /etc/systemd/system/slg-auth-verify.timer
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -- deploy/systemd/slg-auth-backup.service deploy/systemd/slg-auth-backup.timer deploy/systemd/slg-auth-verify.service deploy/systemd/slg-auth-verify.timer deploy/systemd/slg-auth-backup.env.example deploy/systemd/systemd-units.test.mjs
git commit -m "ops(auth): schedule encrypted database backups"
```

---

### Task 13: Document cloud setup, deployment, recovery, and rollback

**Files:**
- Create: `docs/server-auth-backup-operations.md`
- Modify: `docs/VPS-运维指南.md`

- [ ] **Step 1: Write the OSS and RAM setup section**

Include exact console outcomes:

- private Standard bucket in `oss-cn-shanghai` with globally unique name;
- lifecycle rule limited to `daily/`, delete current objects after 14 days;
- ECS role `SlgAuthBackupRole` attached only to this instance;
- custom policy replacing `${BUCKET}` with the actual bucket:

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:PutObject", "oss:GetObject", "oss:ListObjects"],
      "Resource": [
        "acs:oss:*:*:${BUCKET}",
        "acs:oss:*:*:${BUCKET}/daily/*"
      ]
    }
  ]
}
```

Explicitly state not to grant `AliyunOSSFullAccess` and not to add `oss:DeleteObject`.

- [ ] **Step 2: Document DingTalk and key provisioning**

Generate the key on a trusted terminal:

```bash
openssl rand -base64 32
```

Store it in `/etc/slg-auth-backup.env` and separately in the password manager. Show `install -m 600 -o root -g root` for the environment file without embedding secrets in shell history; recommend editing with `sudoedit` or an interactive root editor.

- [ ] **Step 3: Document deployment commands**

```bash
cd /root/server-auth
npm ci
install -d -m 700 /var/lib/slg-auth-backup/tmp
install -m 644 deploy/systemd/slg-auth-*.service deploy/systemd/slg-auth-*.timer /etc/systemd/system/
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/slg-auth-*.service /etc/systemd/system/slg-auth-*.timer
systemctl enable --now slg-auth-backup.timer slg-auth-verify.timer
systemctl list-timers 'slg-auth-*'
```

- [ ] **Step 4: Document manual acceptance and harmless alert test**

```bash
systemctl start slg-auth-backup.service
systemctl status slg-auth-backup.service --no-pager
journalctl -u slg-auth-backup.service -n 100 --no-pager
systemctl start slg-auth-verify.service
journalctl -u slg-auth-verify.service -n 100 --no-pager
curl -fsS http://127.0.0.1:3456/health
```

For the harmless failure test, temporarily copy the environment file, change only the bucket name in the copy, run the Node entry point with that environment in a one-off shell, confirm DingTalk receives the alert, then securely delete the copy. Do not alter the production timer environment file.

- [ ] **Step 5: Document real restore procedure**

Require stopping PM2, preserving `auth.db`, `auth.db-wal`, and `auth.db-shm` with timestamps, decrypting and validating in a separate root-only directory, installing with same-filesystem atomic rename, restoring owner/mode, starting PM2, checking `/health`, admin query, and one controlled activation flow. State that the operator must never restore while `slg-auth` is running.

- [ ] **Step 6: Document rollback**

```bash
systemctl disable --now slg-auth-backup.timer slg-auth-verify.timer
systemctl stop slg-auth-backup.service slg-auth-verify.service
```

Rollback removes only units/scripts after preserving logs and configuration securely; it must not delete OSS backups, lifecycle policy, the production DB, or the offline encryption key. Reverting the deployment does not require restarting `slg-auth` because the backup system is independent.

- [ ] **Step 7: Link from the existing VPS guide and commit**

Add a short section in `docs/VPS-运维指南.md` pointing to `docs/server-auth-backup-operations.md` and retaining the manual `.backup` procedure as emergency fallback.

```bash
git add -- docs/server-auth-backup-operations.md docs/VPS-运维指南.md
git commit -m "docs(auth): add database backup runbook"
```

---

### Task 14: Run full local verification and security checks

**Files:**
- Modify only if verification exposes a defect in files created by Tasks 1-13.

- [ ] **Step 1: Run all backup tests**

```bash
cd server-auth
npm run test:backup
```

Expected: all tests PASS with zero real network calls.

- [ ] **Step 2: Build server-auth**

```bash
npm run build
```

Expected: TypeScript build PASS.

- [ ] **Step 3: Run existing server-auth regression test**

```bash
node --test -r ts-node/register services/ActivationCodeService.test.ts
```

Expected: both trial-code tests PASS.

- [ ] **Step 4: Scan tracked changes for secrets and forbidden APIs**

From repository root:

```bash
git diff --check
git diff --name-only HEAD
git diff HEAD -- server-auth/backup deploy/systemd docs/server-auth-backup-operations.md | grep -Ei 'access_token=|SEC[A-Za-z0-9]{8,}|BEGIN .*PRIVATE KEY|AliyunOSSFullAccess|DeleteObject' && exit 1 || true
```

Expected: `git diff --check` has no errors and secret/forbidden scan emits no matches except explanatory documentation that is reviewed manually. Because documentation intentionally names forbidden permissions, replace the simple grep with a reviewed output if it matches those explanatory lines; no real token/key value may exist.

- [ ] **Step 5: Verify diff scope**

```bash
git status --short
git log --oneline cf028fc..HEAD
```

Expected: implementation commits contain only files listed in this plan; unrelated original working-tree changes remain untouched in the original worktree.

- [ ] **Step 6: Commit any verification-only fixes explicitly**

If verification changed files, stage each exact path by name. For example, when only the crypto module and its test changed:

```bash
git add -- server-auth/backup/crypto.mjs server-auth/backup/crypto.test.mjs
git commit -m "fix(auth): harden backup verification"
```

Use the actual exact paths that were changed; skip this commit when no fixes are needed.

---

### Task 15: Provision Alibaba Cloud and deploy to VPS

**Files:**
- No repository modification unless the runbook is found inaccurate.

This task performs outward-facing cloud changes. Confirm with the user immediately before creating the Bucket, RAM policy/role, binding the role, or installing/enabling production timers.

- [ ] **Step 1: Create and inspect the private Bucket**

Create the dedicated bucket in Shanghai with private ACL and Standard storage. Confirm public access blocking and static website hosting disabled. Record only the bucket name, not credentials.

- [ ] **Step 2: Configure and inspect lifecycle**

Create a lifecycle rule scoped to `daily/` that deletes current objects after 14 days. Re-open the rule and verify the prefix and period before continuing.

- [ ] **Step 3: Create least-privilege RAM policy and role**

Apply the reviewed policy from the runbook, bind `SlgAuthBackupRole` to the ECS instance, and verify there is no OSS full-access or delete permission.

- [ ] **Step 4: Prepare DingTalk and encryption secrets**

Create the signed robot, generate the 32-byte key, store its offline copy, and install `/etc/slg-auth-backup.env` as root mode `0600`. Never paste secrets into repository files or tool output.

- [ ] **Step 5: Deploy code and units**

Use the existing server-auth deployment method, run `npm ci`, install units, run `systemd-analyze verify`, and enable both timers. Do not restart PM2 unless normal code deployment requires it; backup-only files do not require an auth-service restart.

- [ ] **Step 6: Execute acceptance test**

Manually run backup and verify services. Confirm:

- encrypted private object exists under `daily/YYYY/MM/`;
- object metadata and size are present;
- no plaintext remains under `/var/lib/slg-auth-backup/tmp`;
- monthly verification succeeds and sends DingTalk success proof;
- harmless failure sends DingTalk alert;
- `/health` remains successful throughout;
- timers show the expected Shanghai schedule.

- [ ] **Step 7: Record deployment evidence without secrets**

Record date, unit status, next timer times, object key, lifecycle rule name, and successful health result in the deployment notes. Do not record Webhook, secret, temporary credentials, encryption key, activation codes, or device data.

- [ ] **Step 8: Exercise rollback only if acceptance fails**

Disable timers, stop one-shot services, preserve journal logs, and leave existing OSS backup objects intact. Restore no database because deployment never modifies production DB. Diagnose before re-enabling.

---

## Final completion criteria

The feature is complete only when all conditions hold:

- local backup tests, server-auth build, and existing activation-code regression tests pass;
- all changes match the approved design and contain no secrets;
- OSS Bucket is private, lifecycle is exactly 14 days under `daily/`, and RAM role lacks delete/full-access rights;
- one real encrypted backup uploads and verifies without stopping PM2;
- one real restore verification downloads, authenticates, decrypts, and validates a temporary DB;
- a harmless failure reaches DingTalk;
- no plaintext backup remains on VPS after either workflow;
- `/health` remains available;
- both systemd timers are enabled with expected next-run times;
- the offline encryption key copy has been confirmed.
