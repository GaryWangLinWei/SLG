import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FORMAT_VERSION, MAGIC, decryptFile, encryptFile } from './crypto.mjs';

const HEADER_LENGTH = 12;
const NONCE_OFFSET = HEADER_LENGTH;
const TAG_OFFSET = NONCE_OFFSET + 12;
const CIPHERTEXT_OFFSET = TAG_OFFSET + 16;

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'slg-backup-crypto-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.db');
  const encrypted = path.join(directory, 'input.db.enc');
  const decrypted = path.join(directory, 'restored.db');
  const plaintext = Buffer.from('sensitive sqlite database contents\0\xff', 'latin1');
  const key = randomBytes(32);
  await writeFile(input, plaintext);
  return { directory, input, encrypted, decrypted, plaintext, key };
}

async function assertDecryptRejectsAndCleans({ encrypted, decrypted, key }, mutate) {
  const object = Buffer.from(await readFile(encrypted));
  await writeFile(decrypted, 'stale-or-partial plaintext');
  const replacement = await mutate(object);
  await writeFile(encrypted, replacement ?? object);
  await assert.rejects(decryptFile(encrypted, decrypted, key));
  await assert.rejects(readFile(decrypted), { code: 'ENOENT' });
}

test('exports the fixed format identity and round-trips binary data', async (t) => {
  const f = await fixture(t);
  assert.equal(FORMAT_VERSION, 1);
  assert.deepEqual(MAGIC, Buffer.from('SLGBAK01'));

  await encryptFile(f.input, f.encrypted, f.key);
  await decryptFile(f.encrypted, f.decrypted, f.key);

  assert.deepEqual(await readFile(f.decrypted), f.plaintext);
});

test('returns SHA-256 of the complete encrypted object', async (t) => {
  const f = await fixture(t);
  const sha256 = await encryptFile(f.input, f.encrypted, f.key, () => Buffer.alloc(12, 7));
  const object = await readFile(f.encrypted);
  assert.equal(sha256, createHash('sha256').update(object).digest('hex'));
  assert.deepEqual(object.subarray(0, 8), MAGIC);
});

test('uses a different nonce for each encryption', async (t) => {
  const f = await fixture(t);
  const second = path.join(f.directory, 'second.enc');
  await encryptFile(f.input, f.encrypted, f.key);
  await encryptFile(f.input, second, f.key);
  const firstObject = await readFile(f.encrypted);
  const secondObject = await readFile(second);
  assert.notDeepEqual(firstObject.subarray(NONCE_OFFSET, TAG_OFFSET), secondObject.subarray(NONCE_OFFSET, TAG_OFFSET));
});

test('rejects keys that are not exactly 32 bytes and cleans output', async (t) => {
  const f = await fixture(t);
  await assert.rejects(encryptFile(f.input, f.encrypted, Buffer.alloc(31)), /32 bytes/i);
  await assert.rejects(readFile(f.encrypted), { code: 'ENOENT' });
  await writeFile(f.decrypted, 'sensitive');
  await assert.rejects(decryptFile(f.input, f.decrypted, Buffer.alloc(33)), /32 bytes/i);
  await assert.rejects(readFile(f.decrypted), { code: 'ENOENT' });
});

test('rejects a wrong key and removes incomplete plaintext', async (t) => {
  const f = await fixture(t);
  await encryptFile(f.input, f.encrypted, f.key);
  await writeFile(f.decrypted, 'sensitive');
  await assert.rejects(decryptFile(f.encrypted, f.decrypted, randomBytes(32)));
  await assert.rejects(readFile(f.decrypted), { code: 'ENOENT' });
});

for (const [name, offset] of [
  ['ciphertext', CIPHERTEXT_OFFSET],
  ['nonce', NONCE_OFFSET],
  ['tag', TAG_OFFSET],
  ['version', 8],
  ['reserved header byte', 11],
]) {
  test(`rejects ${name} tampering and removes incomplete plaintext`, async (t) => {
    const f = await fixture(t);
    await encryptFile(f.input, f.encrypted, f.key);
    await assertDecryptRejectsAndCleans(f, (object) => { object[offset] ^= 1; });
  });
}

test('rejects an incorrect magic value', async (t) => {
  const f = await fixture(t);
  await encryptFile(f.input, f.encrypted, f.key);
  await assertDecryptRejectsAndCleans(f, (object) => { object[0] ^= 1; });
});

for (const [name, length] of [
  ['empty input', 0],
  ['partial fixed header', HEADER_LENGTH - 1],
  ['missing nonce bytes', TAG_OFFSET - 1],
  ['missing tag bytes', CIPHERTEXT_OFFSET - 1],
]) {
  test(`rejects truncation: ${name}`, async (t) => {
    const f = await fixture(t);
    await encryptFile(f.input, f.encrypted, f.key);
    await assertDecryptRejectsAndCleans(f, (object) => object.subarray(0, length));
  });
}

test('rejects exceptional nonce and tag lengths without reading out of bounds', async (t) => {
  const f = await fixture(t);
  await encryptFile(f.input, f.encrypted, f.key);
  for (const offset of [9, 10]) {
    await assertDecryptRejectsAndCleans(f, (object) => { object[offset] = 255; });
    await encryptFile(f.input, f.encrypted, f.key);
  }
});
