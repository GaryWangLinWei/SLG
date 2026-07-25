import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

function expandedArtifact(edition, version) {
  return edition.artifactName.replace('${version}', version);
}

export function validateRelease({ rootDir, version, editions }) {
  const items = editions.map((edition) => {
    const directory = path.resolve(rootDir, edition.outputDir);
    const manifestPath = path.join(directory, 'latest.yml');
    if (!fs.existsSync(manifestPath)) throw new Error(`Missing release file: ${manifestPath}`);
    const manifest = YAML.parse(fs.readFileSync(manifestPath, 'utf8'));
    const artifactName = expandedArtifact(edition, version);
    if (manifest.version !== version) throw new Error(`${edition.id} manifest version ${manifest.version} does not match ${version}`);
    if (manifest.path !== artifactName) throw new Error(`${edition.id} manifest path ${manifest.path} does not match ${artifactName}`);
    const artifactPath = path.join(directory, artifactName);
    const blockmapPath = `${artifactPath}.blockmap`;
    for (const file of [artifactPath, blockmapPath]) if (!fs.existsSync(file)) throw new Error(`Missing release file: ${file}`);
    return {
      edition,
      version,
      manifestPath,
      manifestKey: `${edition.remotePrefix}/latest.yml`,
      artifacts: [
        { key: `${edition.remotePrefix}/${artifactName}`, localPath: artifactPath },
        { key: `${edition.remotePrefix}/${artifactName}.blockmap`, localPath: blockmapPath },
      ],
    };
  });
  if (new Set(items.map((item) => item.version)).size !== 1) throw new Error('Edition versions do not match');
  return items;
}

async function oldManifest(client, key) {
  try {
    const result = await client.get(key);
    return Buffer.isBuffer(result) ? result : result?.content ?? result?.res?.data ?? null;
  } catch (error) {
    if (error?.status === 404 || error?.code === 'NoSuchKey') return null;
    throw error;
  }
}

export async function publishRelease({ client, rootDir, version, editions, logger = console }) {
  const items = validateRelease({ rootDir, version, editions });
  const old = new Map();
  for (const item of items) {
    const previous = await oldManifest(client, item.manifestKey);
    if (!previous) throw new Error(`Old manifest required for ${item.edition.id}; use --initialize-agent for the first agent release`);
    old.set(item.edition.id, previous);
  }
  for (const item of items) for (const artifact of item.artifacts) {
    await client.put(artifact.key, artifact.localPath);
    await client.head(artifact.key);
  }
  const switched = [];
  try {
    for (const item of items) {
      await client.put(item.manifestKey, item.manifestPath);
      switched.push(item);
    }
  } catch (publishError) {
    const rollbackErrors = [];
    for (const item of [...switched].reverse()) {
      try { await client.put(item.manifestKey, old.get(item.edition.id)); }
      catch (error) { rollbackErrors.push(`rollback failed for ${item.edition.id}: ${error.message}`); }
    }
    const suffix = rollbackErrors.length ? `; ${rollbackErrors.join('; ')}` : '';
    throw new Error(`publish failed: ${publishError.message}${suffix}`);
  }
  for (const item of items) logger.log(`${item.edition.id}: ${item.edition.updateUrl}/latest.yml`);
  return items;
}

export async function initializeAgent({ client, rootDir, version, editions, logger = console }) {
  const items = validateRelease({ rootDir, version, editions });
  const agent = items.find((item) => item.edition.id === 'agent');
  if (!agent) throw new Error('Agent edition is not configured');
  for (const artifact of agent.artifacts) {
    await client.put(artifact.key, artifact.localPath);
    await client.head(artifact.key);
  }
  await client.put(agent.manifestKey, agent.manifestPath);
  logger.log(`agent initialized: ${agent.edition.updateUrl}/latest.yml`);
}
