# OSS 更新分发迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 electron-updater 全量包分发从 VPS 迁移到阿里云 OSS，1.1.3 版本起客户端从 OSS 拉更新，VPS 只在过渡期继续供 ≤1.1.2 老客户端使用。

**Architecture:** `package.json` 的 `publish.url` 指向 OSS 默认域名（无需备案）；新增 `scripts/publish-release.mjs` 一条命令同时上传 OSS + VPS；OSS 与 VPS 的 `latest.yml` 内容相同（相对路径），electron-updater 通过内嵌 `app-update.yml` 拼接实际下载 URL。

**Tech Stack:** electron-builder、ali-oss（Node SDK）、dotenv、scp

---

## 前置条件（人工操作，不在自动化任务内）

在跑 Task 1 之前，用户需先在阿里云控制台完成：

1. 建 bucket `slg-updates`（华东 1 / 杭州，公共读，标准存储，版本控制关闭）
2. 建 RAM 子用户 `slg-oss-uploader`，权限限定 `slg-updates/updates/*` 的 `PutObject / GetObject / DeleteObject`，拿到 AccessKeyId / Secret
3. 手动往 OSS 的 `updates/` 目录传入种子文件 `ROK助手 Setup 1.1.2.exe` 及其 `.blockmap`（差量更新链的第一环）

种子文件从 VPS 拉取到本地：

```bash
mkdir -p release
scp "root@106.15.11.158:/root/server-auth/updates/ROK助手 Setup 1.1.2.exe" "release/"
scp "root@106.15.11.158:/root/server-auth/updates/ROK助手 Setup 1.1.2.exe.blockmap" "release/"
```

然后 OSS 控制台上传这两个文件到 `slg-updates/updates/` 路径。

上述完成后再从 Task 1 开始。

---

### Task 1: 安装依赖 + 环境变量

**Files:**
- Modify: `package.json`（devDependencies 追加 `ali-oss` `dotenv`）
- Create: `.env`（不入 git，已在 `.gitignore` 内）

- [ ] **Step 1: 安装依赖**

```bash
npm i -D ali-oss dotenv
```

Expected: `package.json` `devDependencies` 出现 `ali-oss` 和 `dotenv`，`node_modules` 下能看到 `ali-oss`。

- [ ] **Step 2: 创建 .env**

在项目根 `D:\SLG\.env` 写入（替换为实际 key）：

```
OSS_KEY_ID=LTAI5t...
OSS_KEY_SECRET=xxx
```

- [ ] **Step 3: 验证 .env 不会入 git**

Run: `git status --ignored | grep .env`
Expected: `.env` 出现在 Ignored files 列表下。

- [ ] **Step 4: Commit 依赖变更**

```bash
git add package.json package-lock.json
git commit -m "chore: 引入 ali-oss + dotenv 用于 OSS 发布脚本"
```

---

### Task 2: 修改 package.json 的 publish.url

**Files:**
- Modify: `package.json` — `build.publish.url` 段

- [ ] **Step 1: 修改 publish.url**

找到 `package.json` 中的 `"publish": { ... }` 段，把 `url` 改成：

```json
"publish": {
  "provider": "generic",
  "url": "https://slg-updates.oss-cn-hangzhou.aliyuncs.com/updates"
}
```

- [ ] **Step 2: 添加发布 script**

在 `package.json` 的 `scripts` 段追加一条（放在 `electron:build:win` 之后）：

```json
"electron:publish:win": "npm run electron:build:win && node scripts/publish-release.mjs"
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: publish.url 切到阿里云 OSS，新增 electron:publish:win"
```

---

### Task 3: 写发布脚本 scripts/publish-release.mjs

**Files:**
- Create: `scripts/publish-release.mjs`

- [ ] **Step 1: 写脚本**

创建 `D:\SLG\scripts\publish-release.mjs`：

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

if (!process.env.OSS_KEY_ID || !process.env.OSS_KEY_SECRET) {
  console.error('✗ 缺 .env: OSS_KEY_ID / OSS_KEY_SECRET');
  process.exit(1);
}

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

- [ ] **Step 2: 语法检查**

Run: `node --check scripts/publish-release.mjs`
Expected: 无输出（无语法错误）。

- [ ] **Step 3: 干跑校验（缺 release 文件应报错）**

Run: `node scripts/publish-release.mjs`
Expected: 报 `✗ 缺文件: release\latest.yml`（因为还没 build），并 exit 1。这就证明前置检查正常。

- [ ] **Step 4: Commit**

```bash
git add scripts/publish-release.mjs
git commit -m "feat: 新增 publish-release.mjs 发布脚本，同时上传 OSS + VPS"
```

---

### Task 4: 更新 VPS 运维指南

**Files:**
- Modify: `docs/VPS-运维指南.md` — Electron 客户端发布章节

- [ ] **Step 1: 找到当前发布章节**

在 `docs/VPS-运维指南.md` 里定位 `## Electron 客户端发布` 这一节（约行 134~161）。

- [ ] **Step 2: 替换整节内容**

把整节替换为：

```markdown
## Electron 客户端发布

### 1. 修改版本号 + 发行说明

编辑 `package.json`（项目根）：
- `version` 字段递增（如 `1.1.2` → `1.1.3`）
- `build.releaseInfo.releaseNotes` 更新为本版更新内容

### 2. 一键构建 + 发布

```bash
npm run electron:publish:win
```

脚本会：
1. 构建 exe（产物在 `release/`）
2. 上传 `latest.yml / exe / exe.blockmap` 到阿里云 OSS
3. 同步上传一份到 VPS `/root/server-auth/updates/`（过渡期兼容 ≤1.1.2 老客户端）

### 3. 验证

```
https://slg-updates.oss-cn-hangzhou.aliyuncs.com/updates/latest.yml
http://106.15.11.158:3456/updates/latest.yml
```

两处 `latest.yml` 内容应一致，`version` 字段为新版。

### 4. 何时停 VPS 上传

`pm2 logs slg-auth` 观察 VPS `/updates/latest.yml` 的 GET 请求：连续 2 周没有 ≤1.1.2 客户端拉取时，可从 `scripts/publish-release.mjs` 删掉 VPS scp 段，VPS `/updates` 目录清空。

### 关于差量更新

electron-updater 用旧版 `.blockmap` 计算 diff，只下载改动的块（几十 MB，不是 300 MB）。**OSS 和 VPS 上的旧版 exe + blockmap 都不要删**，否则新用户升级会变全量。
```

- [ ] **Step 3: Commit**

```bash
git add docs/VPS-运维指南.md
git commit -m "docs: 更新发布章节，改用 OSS + 新脚本"
```

---

### Task 5: 首次发布 1.1.3 验证

**Files:**
- Modify: `package.json` — `version` `1.1.2` → `1.1.3`，`releaseInfo.releaseNotes` 更新

**前置：** 用户已按"前置条件"完成 OSS bucket + 种子文件上传。

- [ ] **Step 1: 改版本号**

`package.json`：`"version": "1.1.2"` → `"version": "1.1.3"`

- [ ] **Step 2: 改 releaseNotes**

`package.json` 的 `build.releaseInfo.releaseNotes` 改成：

```
1.1.3更新内容
1. 更新分发切换到阿里云 OSS，下载速度大幅提升
```

- [ ] **Step 3: 构建并发布**

```bash
npm run electron:publish:win
```

Expected: 脚本依次打印 `↑ OSS: latest.yml`、`↑ OSS: ROK助手 Setup 1.1.3.exe`、`↑ OSS: ROK助手 Setup 1.1.3.exe.blockmap`、`✓ OSS 上传完成`、`↑ VPS: ...`、`✓ VPS 上传完成`、`发布完成: v1.1.3`。

- [ ] **Step 4: 双端验证 latest.yml**

```bash
curl -s https://slg-updates.oss-cn-hangzhou.aliyuncs.com/updates/latest.yml
curl -s http://106.15.11.158:3456/updates/latest.yml
```

Expected: 两处返回 yaml 内容一致，`version: 1.1.3`。

- [ ] **Step 5: 客户端实测**

在装有 1.1.2 的机器上启动 exe，等自动更新弹窗弹出，观察下载速度。

Expected: 下载速度明显高于 3 Mbps（走 VPS 时的极限）。1.1.2 走 VPS 完成升级；再从 1.1.3 到未来 1.1.4+ 走 OSS。

- [ ] **Step 6: Commit 版本号**

```bash
git add package.json
git commit -m "release: v1.1.3 更新分发切换到 OSS"
```

---

## Self-Review

**Spec coverage：**
- OSS bucket 建立与配置 → 前置条件章节
- 种子文件上传（1.1.2 exe + blockmap）→ 前置条件章节
- `package.json` publish.url 改动 → Task 2
- 上传脚本 → Task 3
- 依赖 + `.env` → Task 1
- 运维指南更新 → Task 4
- 首次发布 1.1.3 验证 → Task 5
- 过渡期何时停 VPS → Task 4 文档说明
- 回滚方案 → spec 有，运维层面操作，无代码任务
- 成本估算 → spec 有，无代码任务

**Placeholder scan：** 无 TBD / TODO / 类似 Task N。所有代码块完整。

**Type consistency：** bucket 名 `slg-updates`、region `oss-cn-hangzhou`、目录 `updates/`、脚本路径 `scripts/publish-release.mjs`、env 变量 `OSS_KEY_ID` / `OSS_KEY_SECRET` 全文一致。

无问题。
