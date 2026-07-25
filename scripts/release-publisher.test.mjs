import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEdition } from './edition-config.mjs';
import { publishRelease, validateRelease } from './release-publisher.mjs';

async function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-release-'));
  const version = '1.2.0';
  const editions = await Promise.all(['main', 'agent'].map((id) => getEdition(id)));
  for (const edition of editions) {
    const dir = path.join(rootDir, edition.outputDir);
    fs.mkdirSync(dir, { recursive: true });
    const exe = edition.artifactName.replace('${version}', version);
    fs.writeFileSync(path.join(dir, exe), 'exe');
    fs.writeFileSync(path.join(dir, `${exe}.blockmap`), 'blockmap');
    fs.writeFileSync(path.join(dir, 'latest.yml'), `version: ${version}\npath: ${exe}\nsha512: test\nreleaseDate: '2026-07-25T00:00:00.000Z'\n`);
  }
  return { rootDir, version, editions };
}

function fakeClient(events, failPut) {
  return {
    async get(key) { return { content: Buffer.from(`old:${key}`) }; },
    async put(key, value) { events.push({ type: 'put', key, value }); if (failPut?.(key, events)) throw new Error('boom'); },
    async head(key) { events.push({ type: 'head', key }); },
  };
}

test('uploads immutable files then main and agent manifests', async () => {
  const data = await fixture(); const events = [];
  await publishRelease({ client: fakeClient(events), ...data, logger: { log() {} } });
  assert.deepEqual(events.filter((e) => e.type === 'put').map((e) => e.key), [
    'updates/ROK助手 Setup 1.2.0.exe', 'updates/ROK助手 Setup 1.2.0.exe.blockmap',
    'updates/agent/ROK助手-代理商版 Setup 1.2.0.exe', 'updates/agent/ROK助手-代理商版 Setup 1.2.0.exe.blockmap',
    'updates/latest.yml', 'updates/agent/latest.yml',
  ]);
});

test('missing local file performs zero puts', async () => {
  const data = await fixture(); const events = [];
  fs.rmSync(path.join(data.rootDir, data.editions[0].outputDir, 'latest.yml'));
  await assert.rejects(publishRelease({ client: fakeClient(events), ...data }));
  assert.equal(events.filter((e) => e.type === 'put').length, 0);
});

test('artifact failure performs zero manifest puts', async () => {
  const data = await fixture(); const events = [];
  await assert.rejects(publishRelease({ client: fakeClient(events, (key) => key.endsWith('.blockmap')), ...data }));
  assert.equal(events.filter((e) => e.type === 'put' && e.key.endsWith('latest.yml')).length, 0);
});

test('agent manifest failure restores old main manifest', async () => {
  const data = await fixture(); const events = []; let failed = false;
  await assert.rejects(publishRelease({ client: fakeClient(events, (key) => { if (key === 'updates/agent/latest.yml' && !failed) { failed = true; return true; } return false; }), ...data }));
  assert.equal(events.filter((e) => e.type === 'put' && e.key === 'updates/latest.yml').length, 2);
});

test('reports publish and rollback failures together', async () => {
  const data = await fixture(); const events = []; let agentFailed = false;
  await assert.rejects(publishRelease({ client: fakeClient(events, (key, all) => {
    if (key === 'updates/agent/latest.yml' && !agentFailed) { agentFailed = true; return true; }
    return key === 'updates/latest.yml' && all.filter((e) => e.type === 'put' && e.key === key).length === 2;
  }), ...data }), /publish failed.*rollback failed for main/);
});

test('validateRelease returns normalized items', async () => {
  assert.equal(validateRelease(await fixture()).length, 2);
});
