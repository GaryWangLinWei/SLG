# 更新分发迁移到阿里云 OSS

## 背景

当前 electron-updater 全量包托管在 VPS（`106.15.11.158:3456/updates`），VPS 带宽 3 Mbps、免费流量 20 GB/月。每次发版单个包 ~300 MB，导致：

- 用户下载慢（3 Mbps ≈ 375 KB/s，全量要 13 分钟）
- 多用户并发时 VPS 被打满
- 月流量频繁超免费额度，产生额外成本

即便 `blockmap` 差量已配置正确，**首装用户永远拉全量**，VPS 也扛不住。

## 目标

把更新包分发挪到阿里云 OSS，VPS 只保留授权服务。存量老客户端（≤1.1.2）通过 VPS 拿到"有新版"提示 → 升级到 1.1.3 → 之后所有更新走 OSS。

## 架构

```
用户 exe (>=1.1.3)  ──▶  OSS 公网直连（exe / blockmap / latest.yml）
用户 exe (<=1.1.2)  ──▶  VPS /updates → 升级到 1.1.3 → 之后走 OSS

发布：
  npm run electron:publish:win
        ├─ build (electron-builder)
        ├─ 上传 OSS  (供 1.1.3+)
        └─ scp 上传 VPS  (过渡期，供 <=1.1.2)
```

关键点：

- **1.1.3 是切换版**：`publish.url` 内嵌 OSS 地址，此后从 1.1.3 升到 1.1.4+ 全走 OSS
- OSS 与 VPS 上的 `latest.yml` 内容一致（相对路径 `path: ROK助手 Setup x.x.x.exe`），electron-updater 拼接自己的 `publish.url` 得到最终 URL，同一份 yml 双端通用
- 活跃用户全部升到 1.1.3+ 后，VPS 上传步骤可停，`/updates` 清空

## OSS 配置

- Bucket 名：`slg-updates`（全局唯一，可改）
- 区域：华东 1（杭州），与 VPS 同区
- 存储类型：标准存储
- 读写权限：**公共读**（匿名 GET，PUT 需 AccessKey）
- 版本控制：关闭
- 默认访问域名：`https://slg-updates.oss-cn-hangzhou.aliyuncs.com/updates/`（**无需备案**）

### Bucket 内目录结构

```
slg-updates/
└── updates/
    ├── latest.yml
    ├── ROK助手 Setup 1.1.3.exe
    ├── ROK助手 Setup 1.1.3.exe.blockmap
    ├── ROK助手 Setup 1.1.2.exe          ← 至少保留 1 个旧版本
    └── ROK助手 Setup 1.1.2.exe.blockmap  ← 差量更新必需（旧版 blockmap 计算 diff）
```

### RAM 子用户

- 控制台 → RAM → 子用户 `slg-oss-uploader`
- 权限限定 `slg-updates/updates/*` 下 `PutObject / GetObject / DeleteObject`
- AccessKeyId + Secret 只显示一次，存本地 `.env`，不入 git

## 改动清单

### 1. `package.json`

改 `publish.url`：

```json
"publish": {
  "provider": "generic",
  "url": "https://slg-updates.oss-cn-hangzhou.aliyuncs.com/updates"
}
```

新增 script：

```json
"electron:publish:win": "npm run electron:build:win && node scripts/publish-release.mjs"
```

### 2. 依赖

```bash
npm i -D ali-oss dotenv
```

### 3. `.env`（项目根，加入 `.gitignore`）

```
OSS_KEY_ID=LTAI5t...
OSS_KEY_SECRET=xxx
```

### 4. `scripts/publish-release.mjs`

```js
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

// ─── 1. 上传 OSS ─────────────────────────────
const client = new OSS({
  region: 'oss-cn-hangzhou',
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
console.log(`  OSS:  https://slg-updates.oss-cn-hangzhou.aliyuncs.com/updates/latest.yml`);
console.log(`  VPS:  http://106.15.11.158:3456/updates/latest.yml`);
```

## 首次切换流程（1.1.2 → 1.1.3）

1. 控制台建 bucket `slg-updates`（华东杭州，公共读），建 RAM 子用户
2. 项目根加 `.env`，`.gitignore` 加 `.env`
3. `npm i -D ali-oss dotenv`
4. `package.json` 改 `publish.url` → OSS 地址，`version` 改到 `1.1.3`
5. 写入 `scripts/publish-release.mjs`
6. **手动往 OSS 传一份 1.1.2 的旧 exe + blockmap**（差量更新的种子文件）：
   ```bash
   ssh root@106.15.11.158 "cat '/root/server-auth/updates/ROK助手 Setup 1.1.2.exe'" > "release/ROK助手 Setup 1.1.2.exe"
   ssh root@106.15.11.158 "cat '/root/server-auth/updates/ROK助手 Setup 1.1.2.exe.blockmap'" > "release/ROK助手 Setup 1.1.2.exe.blockmap"
   ```
   然后 OSS 控制台上传，或跑一次专门的种子上传脚本
7. `npm run electron:publish:win` 构建并发布 1.1.3

## 常规发版流程（1.1.4+）

改 `package.json` 的 `version` 和 `releaseInfo.releaseNotes` → `npm run electron:publish:win`。一条命令走完 build + OSS + VPS 双传。

## 验证

```bash
# OSS
curl https://slg-updates.oss-cn-hangzhou.aliyuncs.com/updates/latest.yml
# 应返回 yaml，version 是新版

# VPS（过渡期）
curl http://106.15.11.158:3456/updates/latest.yml
# 应返回同样内容

# 客户端实测：装有旧版本的机器打开 exe → 弹"发现新版本" → 下载速度应明显高于 3Mbps
```

## 回滚

**OSS 发错了：**
- OSS 控制台里把旧版 `latest.yml` 覆盖回来
- 本地保留每次发版的 `release/` 目录便于重传

**新版本 exe 有 bug：**
- 同上，`latest.yml` 指回旧版本
- 坏版本 exe 可删，但保留其 blockmap 以维持差量链

## VPS 过渡期何时停

看 VPS `pm2 logs slg-auth` 里 `/updates/latest.yml` 的 GET 请求：
- 连续 2 周没有 <=1.1.2 客户端请求 → 活跃用户全升级完
- 从 `publish-release.mjs` 删掉 VPS scp 段，VPS `/updates` 清空

## 成本估算

- 存储：3 版本 × 300M ≈ 1G × 0.12 元/月 = **0.12 元/月**
- 流量（全量情况）：每周 1 版本、100 用户 = 30G × 0.5 元/GB = **15 元/月**
- 差量生效后单包 30~80M：**5 元/月左右**
- 请求次数忽略

## 关键文件

| 文件 | 改动 |
|------|------|
| `package.json` | `publish.url` 改 OSS；新增 `electron:publish:win` script；`devDependencies` 加 `ali-oss` `dotenv` |
| `scripts/publish-release.mjs` | 新建 |
| `.env` | 新建（不入 git）|
| `.gitignore` | 加 `.env` |
| `docs/VPS-运维指南.md` | 更新 Electron 客户端发布章节，改成用新脚本 |
