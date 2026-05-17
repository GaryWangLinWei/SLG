import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { StoredLicenseData } from './types';
import { generateFingerprint } from './DeviceFingerprint';

// Config directory
const CONFIG_DIR = join(homedir(), '.slg-automation');
const LICENSE_FILE = join(CONFIG_DIR, 'license.json');

// Encryption config
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT = 'slg-automation-salt-2025';

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

async function getKey(): Promise<Buffer> {
  // Derive key from device fingerprint - same machine can always decrypt its own license
  const fingerprint = await generateFingerprint();
  return scryptSync(fingerprint, SALT, 32);
}

export async function loadLicense(): Promise<StoredLicenseData | null> {
  ensureDir();

  if (!existsSync(LICENSE_FILE)) {
    return null;
  }

  try {
    const encryptedData = JSON.parse(readFileSync(LICENSE_FILE, 'utf-8'));
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');
    const encryptedText = Buffer.from(encryptedData.data, 'hex');

    const key = await getKey();
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    (decipher as any).setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return JSON.parse(decrypted.toString());
  } catch (e) {
    // Corrupted or from another machine - delete and start fresh
    try {
      if (existsSync(LICENSE_FILE)) {
        writeFileSync(LICENSE_FILE, '');
      }
    } catch { /* ignore */ }
    return null;
  }
}

export async function saveLicense(data: StoredLicenseData): Promise<void> {
  ensureDir();

  const key = await getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const text = JSON.stringify(data);
  let encrypted = cipher.update(text, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = (cipher as any).getAuthTag();

  const encryptedData = {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted.toString('hex')
  };

  writeFileSync(LICENSE_FILE, JSON.stringify(encryptedData, null, 2));
}

export async function clearLicense(): Promise<void> {
  ensureDir();
  if (existsSync(LICENSE_FILE)) {
    writeFileSync(LICENSE_FILE, '');
  }
}
