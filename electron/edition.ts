import * as fs from 'fs';

export type PackagedEdition = {
  id: 'main' | 'agent';
  updateUrl: string;
};

export function parsePackagedEdition(raw: unknown): PackagedEdition {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid packaged edition metadata');
  const { id, updateUrl } = raw as Record<string, unknown>;
  if (id !== 'main' && id !== 'agent') throw new Error(`Invalid packaged edition id: ${String(id)}`);
  if (typeof updateUrl !== 'string' || !updateUrl.startsWith('https://')) {
    throw new Error(`Invalid packaged edition update URL: ${String(updateUrl)}`);
  }
  return { id, updateUrl };
}

export function loadPackagedEdition(filePath: string): PackagedEdition {
  return parsePackagedEdition(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}
