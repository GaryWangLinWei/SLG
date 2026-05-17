import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { CONFIG } from '../config';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dir = dirname(CONFIG.DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    db = new Database(CONFIG.DB_PATH);
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function initTables() {
  const database = db!;

  database.exec(`
    CREATE TABLE IF NOT EXISTS activation_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      duration_days INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'unused',
      created_at INTEGER NOT NULL,
      used_at INTEGER,
      expires_at INTEGER,
      created_by TEXT DEFAULT 'system'
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS device_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activation_code_id INTEGER NOT NULL,
      device_fingerprint TEXT NOT NULL,
      bound_at INTEGER NOT NULL,
      last_heartbeat_at INTEGER,
      FOREIGN KEY (activation_code_id) REFERENCES activation_codes(id),
      UNIQUE(activation_code_id, device_fingerprint)
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS heartbeat_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activation_code_id INTEGER NOT NULL,
      device_fingerprint TEXT NOT NULL,
      heartbeat_at INTEGER NOT NULL,
      ip_address TEXT,
      FOREIGN KEY (activation_code_id) REFERENCES activation_codes(id)
    )
  `);

  database.exec('CREATE INDEX IF NOT EXISTS idx_codes_status ON activation_codes(status)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_codes_code ON activation_codes(code)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_bindings_fingerprint ON device_bindings(device_fingerprint)');
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
