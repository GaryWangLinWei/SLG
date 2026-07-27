import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  REQUIRED_TABLES,
  createOnlineSnapshot,
  verifySnapshot,
} from './sqlite.mjs';

function createSchema(db, tables = REQUIRED_TABLES) {
  for (const table of tables) {
    db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, value TEXT)`);
  }
}

async function withTempDir(run) {
  const directory = await mkdtemp(join(tmpdir(), 'sqlite-backup-test-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('online snapshot includes committed WAL data while source connection remains open', async () => {
  await withTempDir(async (directory) => {
    const sourcePath = join(directory, 'source.db');
    const snapshotPath = join(directory, 'snapshot.db');
    const source = new Database(sourcePath);
    try {
      source.pragma('journal_mode = WAL');
      source.pragma('wal_autocheckpoint = 0');
      createSchema(source);
      source.prepare('INSERT INTO activation_codes (value) VALUES (?)').run('committed-in-wal');

      await createOnlineSnapshot(sourcePath, snapshotPath);

      const snapshot = new Database(snapshotPath, { readonly: true });
      try {
        assert.equal(
          snapshot.prepare('SELECT value FROM activation_codes').pluck().get(),
          'committed-in-wal',
        );
      } finally {
        snapshot.close();
      }
    } finally {
      source.close();
    }
  });
});

test('verifySnapshot rejects a zero-byte database', async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, 'empty.db');
    await writeFile(path, Buffer.alloc(0));
    assert.throws(() => verifySnapshot(path), /empty|zero|size/i);
  });
});

test('verifySnapshot rejects a corrupt SQLite file', async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, 'corrupt.db');
    await writeFile(path, 'not a sqlite database');
    assert.throws(() => verifySnapshot(path), /sqlite|database|malformed/i);
  });
});

test('verifySnapshot rejects a snapshot missing a required table', async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, 'missing-table.db');
    const db = new Database(path);
    try {
      createSchema(db, REQUIRED_TABLES.slice(0, -1));
    } finally {
      db.close();
    }
    assert.throws(() => verifySnapshot(path), /remote_sessions/);
  });
});

test('verifySnapshot rejects a database whose integrity check is not uniquely ok', async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, 'integrity-failure.db');
    const db = new Database(path);
    try {
      createSchema(db);
      db.exec('CREATE INDEX damaged_index ON activation_codes(value)');
      db.pragma('writable_schema = ON');
      try {
        db.prepare("UPDATE sqlite_master SET rootpage = 999999 WHERE name = 'damaged_index'").run();
      } catch {
        // The deliberate schema corruption may be reported while finalizing the statement.
      }
    } finally {
      db.close();
    }
    const file = await open(path, 'r+');
    try {
      await file.write(Buffer.alloc(512, 0xff), 0, 512, 8192);
    } finally {
      await file.close();
    }

    assert.throws(
      () => verifySnapshot(path),
      (error) => /integrity/i.test(error?.message ?? ''),
    );
  });
});

test('verifySnapshot returns size and table inventory for a valid snapshot', async () => {
  await withTempDir(async (directory) => {
    const path = join(directory, 'valid.db');
    const db = new Database(path);
    try {
      createSchema(db);
    } finally {
      db.close();
    }

    const result = verifySnapshot(path);
    assert.equal(result.integrity, 'ok');
    assert.ok(result.size > 0);
    assert.deepEqual(result.tables, [...REQUIRED_TABLES].sort());
  });
});
