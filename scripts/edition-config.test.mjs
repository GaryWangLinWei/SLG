import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getEdition, loadEditions } from './edition-config.mjs';

// 注意：这份 fixture 同时是第 36 行"仓库真实配置"的期望值，
// 所以改 config/editions.json 后必须同步这里。
const validEditions = {
  main: {
    id: 'main',
    artifactName: 'ROK助手 Setup ${version}.exe',
    outputDir: 'release/main',
    updateUrl: 'https://updates.slgbot.com/updates',
    remotePrefix: 'updates',
    capabilities: { showPurchaseEntry: true, showRenewEntry: true },
  },
  agent: {
    id: 'agent',
    artifactName: 'ROK助手-代理商版 Setup ${version}.exe',
    outputDir: 'release/agent',
    updateUrl: 'https://updates.slgbot.com/updates/agent',
    remotePrefix: 'updates/agent',
    capabilities: { showPurchaseEntry: false, showRenewEntry: false },
  },
};

async function writeConfig(config) {
  const root = await mkdtemp(path.join(tmpdir(), 'edition-config-'));
  await mkdir(path.join(root, 'config'));
  await writeFile(path.join(root, 'config', 'editions.json'), JSON.stringify(config));
  return root;
}

test('loads the repository main and agent editions', async () => {
  assert.deepEqual(await loadEditions(), validEditions);
});

test('loads editions from rootDir when supplied', async () => {
  const root = await writeConfig(validEditions);
  assert.deepEqual(await loadEditions(root), validEditions);
  assert.deepEqual(await getEdition('agent', root), validEditions.agent);
});

test('rejects invalid edition structure and duplicate release destinations', async () => {
  const invalidCases = [
    { ...validEditions, extra: validEditions.main },
    { ...validEditions, main: { ...validEditions.main, artifactName: '' } },
    { ...validEditions, agent: { ...validEditions.agent, capabilities: { ...validEditions.agent.capabilities, showRenewEntry: 'no' } } },
    { ...validEditions, agent: { ...validEditions.agent, outputDir: validEditions.main.outputDir } },
    { ...validEditions, agent: { ...validEditions.agent, updateUrl: validEditions.main.updateUrl } },
    { ...validEditions, agent: { ...validEditions.agent, remotePrefix: validEditions.main.remotePrefix } },
  ];

  for (const config of invalidCases) {
    const root = await writeConfig(config);
    await assert.rejects(loadEditions(root));
  }
});

test('getEdition rejects names other than main or agent', async () => {
  await assert.rejects(
    getEdition('partner'),
    { message: 'APP_EDITION must be main or agent, received: partner' },
  );
});
