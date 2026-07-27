import { lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
const REQUIRED = ['BACKUP_DB_PATH','BACKUP_OSS_REGION','BACKUP_OSS_BUCKET','BACKUP_OSS_PREFIX','BACKUP_ENCRYPTION_KEY','DINGTALK_WEBHOOK','DINGTALK_SECRET'];
export function loadConfig(env) {
  for (const name of REQUIRED) if (typeof env[name] !== 'string' || env[name].trim() === '') throw new Error(`Missing required environment variable: ${name}`);
  if (!isAbsolute(env.BACKUP_DB_PATH)) throw new Error('BACKUP_DB_PATH must be absolute');
  const encoded=env.BACKUP_ENCRYPTION_KEY;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) || Buffer.from(encoded,'base64').toString('base64') !== encoded) throw new Error('BACKUP_ENCRYPTION_KEY must be valid Base64');
  const encryptionKey=Buffer.from(encoded,'base64'); if (encryptionKey.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must decode to 32 bytes');
  let webhook; try { webhook=new URL(env.DINGTALK_WEBHOOK); } catch { throw new Error('DINGTALK_WEBHOOK must be a valid HTTPS URL'); }
  if (webhook.protocol !== 'https:') throw new Error('DINGTALK_WEBHOOK must use HTTPS');
  const prefix=env.BACKUP_OSS_PREFIX.replace(/^\/+/, '').replace(/\/+$/, '');
  return { dbPath:env.BACKUP_DB_PATH, ossRegion:env.BACKUP_OSS_REGION.trim(), ossBucket:env.BACKUP_OSS_BUCKET.trim(), ossPrefix:`${prefix}/`, encryptionKey, dingtalkWebhook:env.DINGTALK_WEBHOOK, dingtalkSecret:env.DINGTALK_SECRET, instanceId:env.INSTANCE_ID || '' };
}
export async function assertSafeDatabasePath(path) { const stat=await lstat(path); if (stat.isSymbolicLink()) throw new Error('Database path must not be a symbolic link'); if (!stat.isFile()) throw new Error('Database path must be a regular file'); }
