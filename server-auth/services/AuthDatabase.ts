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

  // 邀请关系表
  database.exec(`
    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_code_id INTEGER NOT NULL,
      inviter_fingerprint TEXT NOT NULL,
      invitee_fingerprint TEXT NOT NULL,
      inviter_bonus_days INTEGER NOT NULL,
      invitee_bonus_days INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (invite_code_id) REFERENCES activation_codes(id)
    )
  `);

  // activation_codes 新增 type 字段
  try {
    database.exec(`ALTER TABLE activation_codes ADD COLUMN type TEXT NOT NULL DEFAULT 'normal'`);
  } catch { /* 字段已存在，忽略 */ }

  // activation_codes 新增 tier 字段
  try {
    database.exec(`ALTER TABLE activation_codes ADD COLUMN tier TEXT NOT NULL DEFAULT 'basic'`);
  } catch { /* 字段已存在，忽略 */ }

  // 远程控制 - 验证码表
  database.exec(`
    CREATE TABLE IF NOT EXISTS remote_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      device_id TEXT NOT NULL,
      activation_code TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0,
      used_at INTEGER
    )
  `);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_remote_codes_code ON remote_codes(code)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_remote_codes_device ON remote_codes(device_id)`);

  // 远程控制 - 云端日志表
  database.exec(`
    CREATE TABLE IF NOT EXISTS remote_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      activation_code TEXT NOT NULL,
      message TEXT NOT NULL,
      level TEXT DEFAULT 'info',
      timestamp INTEGER NOT NULL
    )
  `);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_remote_logs_device ON remote_logs(device_id, timestamp DESC)`);

  // 远程控制 - 会话表（手机端验证码兑换后的 session token）
  database.exec(`
    CREATE TABLE IF NOT EXISTS remote_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token TEXT UNIQUE NOT NULL,
      device_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_remote_sessions_token ON remote_sessions(session_token)`);

  database.exec('CREATE INDEX IF NOT EXISTS idx_codes_status ON activation_codes(status)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_codes_code ON activation_codes(code)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_bindings_fingerprint ON device_bindings(device_fingerprint)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON invitations(inviter_fingerprint)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_invitations_invitee ON invitations(invitee_fingerprint)');
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
