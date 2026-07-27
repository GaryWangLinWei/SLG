import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const UNIT_DIR = resolve(REPO_ROOT, 'deploy', 'systemd');

const FILES = {
  backupService: resolve(UNIT_DIR, 'slg-auth-backup.service'),
  backupTimer: resolve(UNIT_DIR, 'slg-auth-backup.timer'),
  verifyService: resolve(UNIT_DIR, 'slg-auth-verify.service'),
  verifyTimer: resolve(UNIT_DIR, 'slg-auth-verify.timer'),
  envExample: resolve(UNIT_DIR, 'slg-auth-backup.env.example'),
  opsDoc: resolve(REPO_ROOT, 'docs', 'server-auth-backup-operations.md'),
};

async function readUnit(path) {
  return readFile(path, 'utf8');
}

/**
 * Parse a systemd unit file into a map of section → key → array of values.
 * Enough for static assertions; not a full systemd parser.
 */
function parseUnit(text) {
  const sections = new Map();
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    if (!current) throw new Error(`Directive before any section: ${raw}`);
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const bucket = sections.get(current);
    const list = bucket.get(key) ?? [];
    list.push(value);
    bucket.set(key, list);
  }
  return sections;
}

function firstValue(sections, section, key) {
  const bucket = sections.get(section);
  if (!bucket) return undefined;
  const list = bucket.get(key);
  return list ? list[0] : undefined;
}

// ---------- Daily timer ----------

test('daily timer runs at exactly 03:15 Asia/Shanghai with persistent replay and random jitter', async () => {
  const text = await readUnit(FILES.backupTimer);
  const unit = parseUnit(text);
  assert.equal(firstValue(unit, 'Timer', 'OnCalendar'), '*-*-* 03:15:00 Asia/Shanghai',
    'daily timer must schedule at 03:15:00 Asia/Shanghai');
  assert.equal(firstValue(unit, 'Timer', 'Persistent'), 'true',
    'daily timer must be Persistent=true so missed runs replay after reboot');
  const jitter = firstValue(unit, 'Timer', 'RandomizedDelaySec');
  assert.ok(jitter !== undefined, 'daily timer must set RandomizedDelaySec');
  const jitterSeconds = parseInt(jitter, 10);
  assert.ok(Number.isFinite(jitterSeconds) && jitterSeconds > 0,
    `daily timer RandomizedDelaySec must be a positive integer, got ${jitter}`);
  assert.equal(firstValue(unit, 'Install', 'WantedBy'), 'timers.target',
    'daily timer must be enabled through timers.target');
});

// ---------- Monthly timer ----------

test('monthly timer runs on day 01 at 04:15 Asia/Shanghai with persistent replay and random jitter', async () => {
  const text = await readUnit(FILES.verifyTimer);
  const unit = parseUnit(text);
  assert.equal(firstValue(unit, 'Timer', 'OnCalendar'), '*-*-01 04:15:00 Asia/Shanghai',
    'monthly timer must schedule at 04:15:00 Asia/Shanghai on the first of each month');
  assert.equal(firstValue(unit, 'Timer', 'Persistent'), 'true',
    'monthly timer must be Persistent=true so missed runs replay after reboot');
  const jitter = firstValue(unit, 'Timer', 'RandomizedDelaySec');
  assert.ok(jitter !== undefined, 'monthly timer must set RandomizedDelaySec');
  const jitterSeconds = parseInt(jitter, 10);
  assert.ok(Number.isFinite(jitterSeconds) && jitterSeconds > 0,
    `monthly timer RandomizedDelaySec must be a positive integer, got ${jitter}`);
  assert.equal(firstValue(unit, 'Install', 'WantedBy'), 'timers.target',
    'monthly timer must be enabled through timers.target');
});

// ---------- Shared service hardening ----------

const REQUIRED_SERVICE_DIRECTIVES = {
  Type: 'oneshot',
  User: 'root',
  UMask: '0077',
  TimeoutStartSec: '15min',
  EnvironmentFile: '/etc/slg-auth-backup.env',
  NoNewPrivileges: 'true',
  PrivateTmp: 'true',
  ProtectSystem: 'strict',
  ProtectHome: 'read-only',
};

const EXEC_START_PREFIX = '/usr/bin/flock -n /run/lock/slg-auth-backup.lock /usr/bin/node';

function assertServiceHardening(unit, label) {
  for (const [key, expected] of Object.entries(REQUIRED_SERVICE_DIRECTIVES)) {
    assert.equal(firstValue(unit, 'Service', key), expected,
      `${label}: expected [Service] ${key}=${expected}`);
  }
  const execStart = firstValue(unit, 'Service', 'ExecStart');
  assert.ok(execStart, `${label}: ExecStart must be set`);
  assert.ok(execStart.startsWith(EXEC_START_PREFIX),
    `${label}: ExecStart must start with "${EXEC_START_PREFIX}", got "${execStart}"`);

  // ReadOnlyPaths must contain /root/server-auth
  const readOnly = (unit.get('Service')?.get('ReadOnlyPaths') ?? []).join(' ').split(/\s+/).filter(Boolean);
  assert.ok(readOnly.includes('/root/server-auth'),
    `${label}: ReadOnlyPaths must include /root/server-auth (got ${JSON.stringify(readOnly)})`);

  // ReadWritePaths must contain both /tmp and /run/lock
  const readWrite = (unit.get('Service')?.get('ReadWritePaths') ?? []).join(' ').split(/\s+/).filter(Boolean);
  for (const required of ['/tmp', '/run/lock']) {
    assert.ok(readWrite.includes(required),
      `${label}: ReadWritePaths must include ${required} (got ${JSON.stringify(readWrite)})`);
  }
}

test('daily backup service hardens execution and uses shared flock via /usr/bin/node', async () => {
  const text = await readUnit(FILES.backupService);
  const unit = parseUnit(text);
  assertServiceHardening(unit, 'slg-auth-backup.service');
});

test('monthly verify service hardens execution and uses shared flock via /usr/bin/node', async () => {
  const text = await readUnit(FILES.verifyService);
  const unit = parseUnit(text);
  assertServiceHardening(unit, 'slg-auth-verify.service');
});

test('both service files share the exact same flock lock path so overlapping runs never collide', async () => {
  const [backup, verify] = await Promise.all([readUnit(FILES.backupService), readUnit(FILES.verifyService)]);
  const backupExec = firstValue(parseUnit(backup), 'Service', 'ExecStart');
  const verifyExec = firstValue(parseUnit(verify), 'Service', 'ExecStart');
  assert.match(backupExec, /\/usr\/bin\/flock -n \/run\/lock\/slg-auth-backup\.lock /);
  assert.match(verifyExec, /\/usr\/bin\/flock -n \/run\/lock\/slg-auth-backup\.lock /);
});

// ---------- Secret leakage guard ----------

// Patterns that would only appear if someone pasted a real credential into a unit file.
const CREDENTIAL_LEAK_PATTERNS = [
  { name: 'AccessKeyId literal', re: /LTAI[0-9A-Za-z]{12,}/ },
  { name: 'AccessKeySecret assignment', re: /accessKeySecret\s*=\s*[A-Za-z0-9]{16,}/i },
  { name: 'STS token literal', re: /stsToken\s*=\s*[A-Za-z0-9+/=]{40,}/i },
  { name: 'DingTalk webhook access_token', re: /access_token=[0-9a-f]{40,}/i },
  { name: 'DingTalk sign secret prefix', re: /SEC[0-9a-f]{40,}/ },
  { name: 'Bearer token', re: /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}/ },
];

for (const [name, path] of [
  ['slg-auth-backup.service', FILES.backupService],
  ['slg-auth-verify.service', FILES.verifyService],
  ['slg-auth-backup.timer', FILES.backupTimer],
  ['slg-auth-verify.timer', FILES.verifyTimer],
]) {
  test(`${name} contains no real credentials`, async () => {
    const text = await readUnit(path);
    for (const { name: patternName, re } of CREDENTIAL_LEAK_PATTERNS) {
      assert.doesNotMatch(text, re, `${name}: matched credential pattern "${patternName}"`);
    }
  });
}

// ---------- env.example: variable names only, safe placeholders ----------

test('env.example lists every required variable name once as an assignment', async () => {
  const text = await readUnit(FILES.envExample);
  const required = [
    'BACKUP_DB_PATH',
    'BACKUP_OSS_REGION',
    'BACKUP_OSS_BUCKET',
    'BACKUP_OSS_PREFIX',
    'BACKUP_ENCRYPTION_KEY',
    'DINGTALK_WEBHOOK',
    'DINGTALK_SECRET',
  ];
  for (const name of required) {
    // Must appear as an assignment (allow surrounding whitespace and optional export prefix).
    assert.match(text, new RegExp(`(^|\\n)\\s*(?:export\\s+)?${name}\\s*=`, 'm'),
      `env.example must define ${name} as an assignment`);
  }
});

test('env.example contains no real credentials — placeholders only', async () => {
  const text = await readUnit(FILES.envExample);
  // Same leak patterns as service files.
  for (const { name: patternName, re } of CREDENTIAL_LEAK_PATTERNS) {
    assert.doesNotMatch(text, re, `env.example: matched credential pattern "${patternName}"`);
  }
  // The BACKUP_ENCRYPTION_KEY value must not look like a real Base64-encoded 32-byte key.
  // A safe placeholder is either empty, `<...>`, `REPLACE_ME`, etc. Reject strings that
  // decode to exactly 32 bytes and roundtrip cleanly.
  const keyLine = text.split(/\r?\n/).find((l) => /^\s*(?:export\s+)?BACKUP_ENCRYPTION_KEY\s*=/.test(l));
  assert.ok(keyLine, 'env.example must set BACKUP_ENCRYPTION_KEY');
  const rawValue = keyLine.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
  if (rawValue) {
    const base64Shape = /^[A-Za-z0-9+/]+=*$/;
    if (base64Shape.test(rawValue)) {
      const decoded = Buffer.from(rawValue, 'base64');
      const roundtrips = decoded.toString('base64') === rawValue;
      assert.ok(!(roundtrips && decoded.length === 32),
        'env.example BACKUP_ENCRYPTION_KEY must not be a real 32-byte Base64 key');
    }
  }
  // Do not export AK/SK — they must come from IMDS at runtime, never from env.
  assert.doesNotMatch(text, /(^|\n)\s*(?:export\s+)?BACKUP_OSS_ACCESS_KEY_ID\s*=/,
    'env.example must not export a static OSS access key id');
  assert.doesNotMatch(text, /(^|\n)\s*(?:export\s+)?BACKUP_OSS_ACCESS_KEY_SECRET\s*=/,
    'env.example must not export a static OSS access key secret');
});

// ---------- I-1: service units must NOT be enable-able on their own ----------

// Only the timers should be enabled with `systemctl enable --now`. The
// services are pure oneshot payloads that the timer pulls in via
// `[Timer] Unit=`. Giving them an `[Install]` section would let an
// operator enable the service directly, which bypasses the schedule and
// creates a boot-time run.
for (const [name, path] of [
  ['slg-auth-backup.service', FILES.backupService],
  ['slg-auth-verify.service', FILES.verifyService],
]) {
  test(`${name} declares no [Install] section (timer is the entry point)`, async () => {
    const text = await readUnit(path);
    const unit = parseUnit(text);
    assert.ok(!unit.has('Install'),
      `${name} must not declare an [Install] section — the timer pulls it in via [Timer] Unit=`);
    // Also guard against a stray WantedBy anywhere in the file.
    assert.doesNotMatch(text, /(^|\n)\s*WantedBy\s*=/,
      `${name} must not contain WantedBy= anywhere`);
  });
}

// The timers, in contrast, must keep their [Install] WantedBy=timers.target
// so `systemctl enable --now slg-auth-backup.timer` activates the schedule.
for (const [name, path] of [
  ['slg-auth-backup.timer', FILES.backupTimer],
  ['slg-auth-verify.timer', FILES.verifyTimer],
]) {
  test(`${name} keeps [Install] WantedBy=timers.target for enable`, async () => {
    const unit = parseUnit(await readUnit(path));
    assert.equal(firstValue(unit, 'Install', 'WantedBy'), 'timers.target',
      `${name} must remain enable-able through timers.target`);
  });
}

// ---------- M-3: timers must not force-couple to the service ----------

// The dependency graph should be: enabling the timer schedules runs; each
// scheduled run activates the service via [Timer] Unit=. A `Requires=` in
// the timer's [Unit] section forces the service to start whenever the
// timer starts, defeating the whole point of scheduling.
for (const [name, path] of [
  ['slg-auth-backup.timer', FILES.backupTimer],
  ['slg-auth-verify.timer', FILES.verifyTimer],
]) {
  test(`${name} has no Requires= that would force-start the service`, async () => {
    const unit = parseUnit(await readUnit(path));
    const requires = unit.get('Unit')?.get('Requires');
    assert.equal(requires, undefined,
      `${name} must not declare [Unit] Requires= (schedule owns the trigger)`);
  });
}

// ---------- M-5: ops doc §5 step 12 language matches implementation ----------

test('ops doc §5 step 12 lists the concrete leak categories, not just "any full object path"', async () => {
  const text = await readUnit(FILES.opsDoc);
  const lines = text.split(/\r?\n/);
  const stepMatches = lines.filter((l) => /12\..*钉钉|钉钉群收到.*monthly VERIFY OK/.test(l));
  assert.ok(stepMatches.length > 0, 'ops doc §5 step 12 must exist and mention the monthly success line');
  const stepContext = stepMatches.join('\n');
  // The old wording was "不含任何完整对象路径"; the fix must instead
  // enumerate the categories actually enforced by sanitizeErrorForLog +
  // createRedactor: bucket name, full object key, AK/SK, Signature, STS token.
  for (const keyword of ['bucket', '完整', 'AK/SK', 'Signature', 'STS']) {
    assert.match(stepContext, new RegExp(keyword),
      `ops doc §5 step 12 must mention ${keyword}`);
  }
});

// ---------- M-6: ops doc §8 find command uses explicit grouping ----------

test('ops doc §8 uses grouped find for the stray WAL/SHM sweep', async () => {
  const text = await readUnit(FILES.opsDoc);
  // Explicit \( ... \) grouping avoids -maxdepth applying only to the
  // first branch when POSIX operator precedence is applied.
  assert.match(text,
    /find\s+\/root\/server-auth\s+-maxdepth\s+1\s+\\\(\s*-name\s+'auth\.db-wal'\s+-o\s+-name\s+'auth\.db-shm'\s*\\\)\s+-print/,
    'ops doc §8 must group the -name predicates and end with -print');
});
