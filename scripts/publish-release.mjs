import OSS from 'ali-oss';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const RELEASE_DIR = 'release';
const VERSION = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

const files = [
  'latest.yml',
  `ROK助手 Setup ${VERSION}.exe`,
  `ROK助手 Setup ${VERSION}.exe.blockmap`,
];

if (!process.env.OSS_KEY_ID || !process.env.OSS_KEY_SECRET) {
  console.error('✗ 缺 .env: OSS_KEY_ID / OSS_KEY_SECRET');
  process.exit(1);
}

// ─── 1. 上传 OSS ─────────────────────────────
const client = new OSS({
  region: 'oss-cn-shanghai',
  accessKeyId: process.env.OSS_KEY_ID,
  accessKeySecret: process.env.OSS_KEY_SECRET,
  bucket: 'slg-updates',
});

for (const f of files) {
  const local = path.join(RELEASE_DIR, f);
  if (!fs.existsSync(local)) {
    console.error(`✗ 缺文件: ${local}`);
    process.exit(1);
  }
  console.log(`↑ OSS: ${f}`);
  await client.put(`updates/${f}`, local, { timeout: 10 * 60 * 1000 });
}
console.log('✓ OSS 上传完成');

// ─── 2. 上传 VPS（过渡期，兼容 <=1.1.2）──────
const scpTargets = files.map(f => `"${path.join(RELEASE_DIR, f)}"`).join(' ');
console.log(`↑ VPS: ${files.join(', ')}`);
execSync(
  `scp ${scpTargets} root@106.15.11.158:/root/server-auth/updates/`,
  { stdio: 'inherit' }
);
console.log('✓ VPS 上传完成');

console.log(`\n发布完成: v${VERSION}`);
console.log('验证:');
console.log(`  OSS:  https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates/latest.yml`);
console.log(`  VPS:  http://106.15.11.158:3456/updates/latest.yml`);
