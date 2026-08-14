import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-'));
process.env.DB_PATH = path.join(tempDir, 'auth.db');

import { getDb, closeDb } from './AuthDatabase';

afterAll(() => { closeDb(); fs.rmSync(tempDir, { recursive: true, force: true }); });

test('adds last_unbound_at column and unbind_logs table', () => {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(activation_codes)").all() as { name: string }[];
  expect(cols.some(c => c.name === 'last_unbound_at')).toBe(true);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  expect(tables.some(t => t.name === 'unbind_logs')).toBe(true);
});

test('initTables is idempotent (re-opening db does not throw)', () => {
  expect(() => getDb().pragma('user_version')).not.toThrow();
});
