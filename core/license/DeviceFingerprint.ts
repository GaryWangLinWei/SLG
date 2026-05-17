import { createHash } from 'crypto';
import { platform, hostname, userInfo, cpus } from 'os';

/**
 * Generate a device fingerprint based on hardware characteristics
 * This is NOT cryptographically secure - it's for binding a license to a machine
 */
export async function generateFingerprint(): Promise<string> {
  try {
    // Gather hardware identifiers - we combine multiple to reduce collision chance
    // Fallbacks ensure we always get something even if some info is unavailable

    // CPU info - use model + cores count as fallback since serial may require admin
    const cpuInfo = cpus();
    const cpuId = cpuInfo[0]?.model || 'unknown-cpu';
    const coreCount = cpuInfo.length || 4;

    // Platform + hostname
    const osPlatform = platform();
    const host = hostname();

    // User info (fallback to empty string if fails)
    let userName = '';
    try {
      userName = userInfo().username || '';
    } catch { /* ignore */ }

    // Combine all and hash
    const raw = `${cpuId}|${coreCount}|${osPlatform}|${host}|${userName}`;
    const hash = createHash('sha256')
      .update(raw)
      .digest('hex')
      .slice(0, 32); // Shorten to 32 chars for readability

    return hash;
  } catch (e) {
    // If anything fails, return a basic fingerprint
    const fallback = `${platform()}|${hostname()}|${cpus()[0]?.model || 'unknown'}`;
    return createHash('sha256').update(fallback).digest('hex').slice(0, 32);
  }
}

/**
 * Verify that a stored fingerprint matches the current device
 */
export async function verifyFingerprint(storedFingerprint: string): Promise<boolean> {
  const current = await generateFingerprint();
  return storedFingerprint === current;
}
