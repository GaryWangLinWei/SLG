#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEdition } from './edition-config.mjs';
import { initializeAgent, publishRelease, validateRelease } from './release-publisher.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const editions = await Promise.all(['main', 'agent'].map((id) => getEdition(id)));
const args = new Set(process.argv.slice(2));

function printDryRun(items) {
  console.log(`Dry run: version ${pkg.version}; no OSS client created`);
  for (const item of items) {
    console.log(`${item.edition.id}: ${item.edition.updateUrl}`);
    for (const artifact of item.artifacts) console.log(`  ${artifact.localPath} -> ${artifact.key}`);
    console.log(`  ${item.manifestPath} -> ${item.manifestKey}`);
  }
}

try {
  if (args.has('--dry-run')) {
    printDryRun(validateRelease({ rootDir, version: pkg.version, editions }));
  } else {
    if (args.size > 1 || (args.size === 1 && !args.has('--initialize-agent'))) throw new Error('Usage: publish-release.mjs [--dry-run|--initialize-agent]');
    if (!process.env.OSS_KEY_ID || !process.env.OSS_KEY_SECRET) throw new Error('OSS_KEY_ID and OSS_KEY_SECRET are required');
    const { default: OSS } = await import('ali-oss');
    const client = new OSS({ region: 'oss-cn-shanghai', bucket: 'slg-updates', accessKeyId: process.env.OSS_KEY_ID, accessKeySecret: process.env.OSS_KEY_SECRET });
    const options = { client, rootDir, version: pkg.version, editions, logger: console };
    if (args.has('--initialize-agent')) await initializeAgent(options);
    else await publishRelease(options);
  }
} catch (error) {
  console.error(`Release failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
