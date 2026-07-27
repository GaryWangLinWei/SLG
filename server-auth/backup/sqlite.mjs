import { statSync } from 'node:fs';
import Database from 'better-sqlite3';

import { assertSafeDatabasePath } from './config.mjs';

export const REQUIRED_TABLES = [
  'activation_codes',
  'device_bindings',
  'remote_sessions',
];

export async function createOnlineSnapshot(sourcePath, destinationPath) {
  await assertSafeDatabasePath(sourcePath);
  let source;
  try {
    source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    await source.backup(destinationPath);
  } finally {
    source?.close();
  }
}

export function verifySnapshot(path, requiredTables = REQUIRED_TABLES) {
  const size = statSync(path).size;
  if (size <= 0) {
    throw new Error('Snapshot database is empty');
  }

  let database;
  try {
    database = new Database(path, { readonly: true, fileMustExist: true });
    let integrityRows;
    try {
      integrityRows = database.pragma('integrity_check', { simple: false });
    } catch (error) {
      throw new Error('Snapshot database integrity check failed', { cause: error });
    }
    if (integrityRows.length !== 1 || integrityRows[0].integrity_check !== 'ok') {
      throw new Error('Snapshot database integrity check failed');
    }

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all();
    for (const table of requiredTables) {
      if (!tables.includes(table)) {
        throw new Error(`Snapshot database is missing required table: ${table}`);
      }
      database.prepare(`SELECT 1 FROM "${table.replaceAll('"', '""')}" LIMIT 1`).get();
    }

    return { integrity: 'ok', size, tables };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Snapshot database')) {
      throw error;
    }
    throw new Error('Snapshot database integrity check failed', { cause: error });
  } finally {
    if (database) {
      try {
        database.close();
      } catch (error) {
        throw new Error('Snapshot database integrity check failed while closing', { cause: error });
      }
    }
  }
}
