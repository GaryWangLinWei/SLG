import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';

export const FORMAT_VERSION = 1;
export const MAGIC = Buffer.from('SLGBAK01');

const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const FIXED_HEADER_LENGTH = 12;
const AAD = Buffer.from('SLG-AUTH-BACKUP:v1', 'utf8');

function validateKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('Encryption key must be a Buffer of exactly 32 bytes');
  }
}

async function removeOutput(outputPath) {
  await rm(outputPath, { force: true }).catch(() => {});
}

export async function encryptFile(inputPath, outputPath, key, randomBytesFn = randomBytes) {
  try {
    validateKey(key);
    const nonce = randomBytesFn(NONCE_LENGTH);
    if (!Buffer.isBuffer(nonce) || nonce.length !== NONCE_LENGTH) {
      throw new Error(`Nonce generator must return ${NONCE_LENGTH} bytes`);
    }

    const plaintext = await readFile(inputPath);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LENGTH });
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const header = Buffer.concat([
      MAGIC,
      Buffer.from([FORMAT_VERSION, NONCE_LENGTH, TAG_LENGTH, 0]),
      nonce,
      tag,
    ]);
    const encryptedObject = Buffer.concat([header, ciphertext]);
    await writeFile(outputPath, encryptedObject);
    return createHash('sha256').update(encryptedObject).digest('hex');
  } catch (error) {
    await removeOutput(outputPath);
    throw error;
  }
}

export async function decryptFile(inputPath, outputPath, key) {
  try {
    validateKey(key);
    const encryptedObject = await readFile(inputPath);
    if (encryptedObject.length < FIXED_HEADER_LENGTH) throw new Error('Truncated backup header');
    if (!encryptedObject.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid backup magic');

    const version = encryptedObject[8];
    const nonceLength = encryptedObject[9];
    const tagLength = encryptedObject[10];
    const reserved = encryptedObject[11];
    if (version !== FORMAT_VERSION) throw new Error(`Unsupported backup format version: ${version}`);
    if (nonceLength !== NONCE_LENGTH) throw new Error(`Invalid nonce length: ${nonceLength}`);
    if (tagLength !== TAG_LENGTH) throw new Error(`Invalid authentication tag length: ${tagLength}`);
    if (reserved !== 0) throw new Error('Invalid reserved header byte');

    const nonceEnd = FIXED_HEADER_LENGTH + nonceLength;
    const tagEnd = nonceEnd + tagLength;
    if (nonceEnd < FIXED_HEADER_LENGTH || tagEnd < nonceEnd || encryptedObject.length < tagEnd) {
      throw new Error('Truncated backup authentication data');
    }
    const nonce = encryptedObject.subarray(FIXED_HEADER_LENGTH, nonceEnd);
    const tag = encryptedObject.subarray(nonceEnd, tagEnd);
    const ciphertext = encryptedObject.subarray(tagEnd);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_LENGTH });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    await writeFile(outputPath, plaintext);
  } catch (error) {
    await removeOutput(outputPath);
    throw error;
  }
}
