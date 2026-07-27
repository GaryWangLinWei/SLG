import { statSync } from 'node:fs';
import Database from 'better-sqlite3';

import { assertSafeDatabasePath } from './config.mjs';

export const REQUIRED_TABLES = [
  'activation_codes',
  'device_bindings',
  'remote_sessions',
];

export function assertIntegrityResult(rows) {
  if (rows.length !== 1 || rows[0].integrity_check !== 'ok') {
    throw new Error('Snapshot database integrity check failed');
  }
}

export function closePreservingError(database, primaryError) {
  if (!database) {
    if (primaryError) throw primaryError;
    return;
  }
  try {
    database.close();
  } catch (closeError) {
    if (primaryError) {
      primaryError.cause ??= closeError;
      throw primaryError;
    }
    throw new Error('Snapshot database close failed', { cause: closeError });
  }
  if (primaryError) throw primaryError;
}

export async function createOnlineSnapshot(sourcePath, destinationPath) {
  await assertSafeDatabasePath(sourcePath);
  let source;
  let primaryError;
  try {
    source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    await source.backup(destinationPath);
  } catch (error) {
    primaryError = error;
  } finally {
    closePreservingError(source, primaryError);
  }
}

export function verifySnapshot(path, requiredTables = REQUIRED_TABLES) {
  const size = statSync(path).size;
  if (size <= 0) throw new Error('Snapshot database is empty');

  let database;
  let result;
  let primaryError;
  try {
    database = new Database(path, { readonly: true, fileMustExist: true });
    let integrityRows;
    try {
      integrityRows = database.pragma('integrity_check', { simple: false });
    } catch (error) {
      throw new Error('Snapshot database integrity check failed', { cause: error });
    }
    assertIntegrityResult(integrityRows);

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
    result = { integrity: 'ok', size, tables };
  } catch (error) {
    primaryError = error instanceof Error && error.message.startsWith('Snapshot database')
      ? error
      : new Error('Snapshot database integrity check failed', { cause: error });
  } finally {
    closePreservingError(database, primaryError);
  }
  return result;
}
