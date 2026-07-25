import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDITION_NAMES = ['main', 'agent'];
const EDITION_FIELDS = ['id', 'artifactName', 'outputDir', 'updateUrl', 'remotePrefix', 'capabilities'];
const CAPABILITY_FIELDS = ['showPurchaseEntry', 'showRenewEntry'];
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function hasExactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function validateEditions(editions) {
  if (!hasExactKeys(editions, EDITION_NAMES)) {
    throw new Error('Edition config must contain exactly main and agent');
  }

  for (const name of EDITION_NAMES) {
    const edition = editions[name];
    if (!hasExactKeys(edition, EDITION_FIELDS) || edition.id !== name) {
      throw new Error(`Invalid ${name} edition fields`);
    }

    for (const field of ['artifactName', 'outputDir', 'updateUrl', 'remotePrefix']) {
      if (typeof edition[field] !== 'string' || edition[field].trim() === '') {
        throw new Error(`${name}.${field} must be a non-empty string`);
      }
    }

    if (!hasExactKeys(edition.capabilities, CAPABILITY_FIELDS)
      || CAPABILITY_FIELDS.some((field) => typeof edition.capabilities[field] !== 'boolean')) {
      throw new Error(`Invalid ${name} capabilities`);
    }
  }

  for (const field of ['outputDir', 'updateUrl', 'remotePrefix']) {
    if (editions.main[field] === editions.agent[field]) {
      throw new Error(`Edition ${field} values must be different`);
    }
  }
}

export async function loadEditions(rootDir = moduleRoot) {
  const configPath = path.join(rootDir, 'config', 'editions.json');
  const editions = JSON.parse(await readFile(configPath, 'utf8'));
  validateEditions(editions);
  return editions;
}

export async function getEdition(name, rootDir) {
  if (!EDITION_NAMES.includes(name)) {
    throw new Error(`APP_EDITION must be main or agent, received: ${name}`);
  }
  return (await loadEditions(rootDir))[name];
}
