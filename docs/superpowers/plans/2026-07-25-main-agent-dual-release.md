# 主版与代理商版双版本发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次命令以同一版本号构建并原子化发布主版与代理商版，代理商版仅隐藏购买和续费入口，两版分别从 OSS `/updates` 与 `/updates/agent` 更新。

**Architecture:** 用 `config/editions.json` 作为构建脚本、Electron 运行时和 Vite 构建的唯一 edition 配置源。构建协调器分别生成隔离的 main/agent 产物；发布模块先校验并上传两版不可变产物，最后切换两份 manifest，失败时恢复已切换 manifest。

**Tech Stack:** Node.js ESM、TypeScript、React 18、Vite 4、Electron 42、electron-builder 26、electron-updater 6、ali-oss、Jest/ts-jest、Node `node:test`

## Global Constraints

- Edition 仅允许精确值 `main` 与 `agent`，缺失或非法必须失败。
- 两版共用根 `package.json.version`、release notes、`appId=com.rok.automation`、`productName=ROK助手`、安装目录和用户数据。
- 主版安装包名为 `ROK助手 Setup <version>.exe`；代理商版为 `ROK助手-代理商版 Setup <version>.exe`。
- 主版更新目录保持 `https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates`；代理商版使用其 `/agent` 子目录。
- 代理商版只隐藏激活页“在线购买”和顶部“续费”；激活、邀请码、等级、剩余时间、同步授权和邀请好友不变。
- 发布只使用 OSS，不上传或删除 VPS 文件。
- 不修改插件 ID，不隔离现有许可证或 `~/.slg-automation` 数据。
- 当前工作区已有未提交改动；每个任务开始先检查目标文件 diff，只暂存本任务明确修改的路径，绝不 reset、checkout 或覆盖用户改动。

---

## File Structure

- Create `config/editions.json` — edition 的单一声明式配置源。
- Create `scripts/edition-config.mjs` — 读取、校验 edition 配置并生成 builder 参数。
- Create `scripts/edition-config.test.mjs` — edition 配置与命名测试。
- Create `scripts/build-editions.mjs` — 依次构建两个隔离产物目录。
- Create `scripts/build-editions.test.mjs` — 构建命令规划测试（不真实打包）。
- Create `electron/edition.ts` — Electron 从打包进 `dist` 的元数据读取 edition 和更新 URL。
- Create `electron/edition.test.ts` — 运行时元数据解析测试。
- Create `web/src/edition.ts` — Vite 编译期 edition 与语义化 UI capabilities。
- Create `web/src/edition.test.ts` — capabilities 测试。
- Create `web/vitest.config.ts` — 前端纯逻辑测试配置。
- Modify `web/src/vite-env.d.ts` — 声明 `VITE_APP_EDITION`。
- Modify `web/src/pages/Activation.tsx` — 按 capability 隐藏购买入口。
- Modify `web/src/App.tsx` — 按 capability 隐藏续费入口。
- Modify `web/package.json` — 增加 Vitest 测试命令和依赖。
- Modify `web/package-lock.json` — 锁定新增测试依赖。
- Modify `electron/main.ts` — 记录 edition，并在运行时显式设置 feed URL。
- Modify `package.json` — 新构建/发布命令；移除静态 publish URL 对构建变体的控制职责。
- Modify `package-lock.json` — 如根脚本依赖变化则同步；本计划不新增根依赖。
- Refactor `scripts/publish-release.mjs` — 只负责 CLI 与 OSS client 装配。
- Create `scripts/release-publisher.mjs` — 可注入 OSS client 的校验、上传、manifest 回滚逻辑。
- Create `scripts/release-publisher.test.mjs` — 发布顺序、失败和回滚测试。
- Modify `docs/VPS-运维指南.md` — 记录双版本 OSS 发布与验证命令。

---

### Task 1: 建立 edition 单一配置源

**Files:**
- Create: `config/editions.json`
- Create: `scripts/edition-config.mjs`
- Create: `scripts/edition-config.test.mjs`

**Interfaces:**
- Produces: `loadEditions(rootDir): Record<'main'|'agent', EditionConfig>`
- Produces: `getEdition(name, rootDir): EditionConfig`
- `EditionConfig` fields: `id`, `artifactName`, `outputDir`, `updateUrl`, `remotePrefix`, `capabilities.showPurchaseEntry`, `capabilities.showRenewEntry`.

- [ ] **Step 1: 先确认目标路径没有用户改动**

Run: `git status --short -- config scripts/edition-config.mjs scripts/edition-config.test.mjs`
Expected: 新文件尚不存在；如出现已有文件，先阅读并合并，不覆盖。

- [ ] **Step 2: 写失败测试**

Create `scripts/edition-config.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getEdition, loadEditions } from './edition-config.mjs';

test('defines exactly main and agent editions', () => {
  assert.deepEqual(Object.keys(loadEditions()).sort(), ['agent', 'main']);
});

test('main and agent keep one app identity but use distinct artifacts and feeds', () => {
  const main = getEdition('main');
  const agent = getEdition('agent');
  assert.equal(main.artifactName, 'ROK助手 Setup ${version}.exe');
  assert.equal(agent.artifactName, 'ROK助手-代理商版 Setup ${version}.exe');
  assert.equal(main.updateUrl, 'https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates');
  assert.equal(agent.updateUrl, 'https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates/agent');
  assert.notEqual(main.outputDir, agent.outputDir);
});

test('agent hides only purchase and renew entries', () => {
  assert.deepEqual(getEdition('agent').capabilities, {
    showPurchaseEntry: false,
    showRenewEntry: false,
  });
});

test('rejects missing and unknown editions', () => {
  assert.throws(() => getEdition(''), /APP_EDITION must be main or agent/);
  assert.throws(() => getEdition('dealer'), /APP_EDITION must be main or agent/);
});
```

- [ ] **Step 3: 运行测试并确认失败**

Run: `node --test scripts/edition-config.test.mjs`
Expected: FAIL，提示找不到 `edition-config.mjs`。

- [ ] **Step 4: 写最小配置和解析器**

Create `config/editions.json`：

```json
{
  "main": {
    "id": "main",
    "artifactName": "ROK助手 Setup ${version}.exe",
    "outputDir": "release/main",
    "updateUrl": "https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates",
    "remotePrefix": "updates",
    "capabilities": { "showPurchaseEntry": true, "showRenewEntry": true }
  },
  "agent": {
    "id": "agent",
    "artifactName": "ROK助手-代理商版 Setup ${version}.exe",
    "outputDir": "release/agent",
    "updateUrl": "https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates/agent",
    "remotePrefix": "updates/agent",
    "capabilities": { "showPurchaseEntry": false, "showRenewEntry": false }
  }
}
```

Create `scripts/edition-config.mjs`，使用 `readFileSync(new URL('../config/editions.json', import.meta.url))` 读取 JSON；校验键恰为 `main/agent`、每个 URL/目录/文件名非空、outputDir/updateUrl/remotePrefix 两两不同；`getEdition` 对非法值抛出精确错误 `APP_EDITION must be main or agent, received: <value>`。

- [ ] **Step 5: 运行测试**

Run: `node --test scripts/edition-config.test.mjs`
Expected: 4 tests PASS。

- [ ] **Step 6: 提交**

```bash
git add config/editions.json scripts/edition-config.mjs scripts/edition-config.test.mjs
git commit -m "feat(release): define main and agent editions"
```

---

### Task 2: 为前端提供编译期 capabilities

**Files:**
- Create: `web/src/edition.ts`
- Create: `web/src/edition.test.ts`
- Create: `web/vitest.config.ts`
- Modify: `web/src/vite-env.d.ts`
- Modify: `web/package.json`
- Modify: `web/package-lock.json`

**Interfaces:**
- Produces: `type AppEdition = 'main' | 'agent'`
- Produces: `resolveEdition(value: string | undefined): AppEdition`
- Produces: `getEditionCapabilities(edition): Readonly<{showPurchaseEntry:boolean; showRenewEntry:boolean}>`
- Produces: `appEdition`, `editionCapabilities` constants.

- [ ] **Step 1: 检查目标文件当前 diff**

Run: `git diff -- web/package.json web/package-lock.json web/src/vite-env.d.ts`
Expected: 了解现有用户改动；只做增量合并。

- [ ] **Step 2: 安装并锁定 Vitest**

Run: `npm --prefix web install --save-dev vitest@^2.1.9`
Expected: `web/package.json` 增加 `vitest`，lockfile 更新；不要升级无关依赖。

在 `web/package.json` scripts 中加入：

```json
"test": "vitest run"
```

Create `web/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 3: 写失败测试**

Create `web/src/edition.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { getEditionCapabilities, resolveEdition } from './edition';

describe('edition capabilities', () => {
  it('keeps both commercial entries in main', () => {
    expect(getEditionCapabilities('main')).toEqual({
      showPurchaseEntry: true,
      showRenewEntry: true,
    });
  });

  it('hides only both commercial entries in agent', () => {
    expect(getEditionCapabilities('agent')).toEqual({
      showPurchaseEntry: false,
      showRenewEntry: false,
    });
  });

  it('rejects missing or unknown build editions', () => {
    expect(() => resolveEdition(undefined)).toThrow(/VITE_APP_EDITION/);
    expect(() => resolveEdition('dealer')).toThrow(/VITE_APP_EDITION/);
  });
});
```

- [ ] **Step 4: 确认测试失败**

Run: `npm --prefix web test -- --run src/edition.test.ts`
Expected: FAIL，找不到 `./edition`。

- [ ] **Step 5: 实现纯逻辑与构建期常量**

Create `web/src/edition.ts`：定义冻结的 `CAPABILITIES` 映射；`resolveEdition` 只接受 `main/agent`；最后导出：

```ts
export const appEdition = resolveEdition(import.meta.env.VITE_APP_EDITION);
export const editionCapabilities = getEditionCapabilities(appEdition);
```

Modify `web/src/vite-env.d.ts`：

```ts
interface ImportMetaEnv {
  readonly VITE_APP_EDITION: 'main' | 'agent';
}
interface ImportMeta { readonly env: ImportMetaEnv; }
```

- [ ] **Step 6: 测试与类型检查**

Run: `npm --prefix web test -- --run src/edition.test.ts`
Expected: 3 tests PASS。

Run: `npm --prefix web run build -- --mode production` with environment `VITE_APP_EDITION=main` (PowerShell: `$env:VITE_APP_EDITION='main'; npm --prefix web run build`)
Expected: TypeScript 与 Vite build PASS。

- [ ] **Step 7: 提交**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts web/src/vite-env.d.ts web/src/edition.ts web/src/edition.test.ts
git commit -m "feat(web): add edition capabilities"
```

---

### Task 3: 按 capability 隐藏两个商业入口

**Files:**
- Modify: `web/src/pages/Activation.tsx:174-180`
- Modify: `web/src/App.tsx:216`
- Test: `web/src/edition.test.ts`

**Interfaces:**
- Consumes: `editionCapabilities` from `web/src/edition.ts`.

- [ ] **Step 1: 检查用户对两个组件的未提交改动**

Run: `git diff -- web/src/App.tsx web/src/pages/Activation.tsx`
Expected: 保留全部既有改动，只在目标渲染点增量编辑。

- [ ] **Step 2: 先扩充能力契约测试**

在 `web/src/edition.test.ts` 增加测试，断言 capability 对象精确只有两个键：

```ts
expect(Object.keys(getEditionCapabilities('agent')).sort()).toEqual([
  'showPurchaseEntry',
  'showRenewEntry',
]);
```

Run: `npm --prefix web test -- --run src/edition.test.ts`
Expected: PASS；该测试锁定“只隐藏两处”的边界。

- [ ] **Step 3: 修改激活页**

在 `Activation.tsx` 导入 `editionCapabilities`，将现有购买段落包为：

```tsx
{editionCapabilities.showPurchaseEntry && (
  <p className="mt-4 text-center text-xs text-slate-400">
    还没有激活码？
    <a href="https://pay.ldxp.cn/shop/LVBXLAH4" target="_blank" rel="noopener noreferrer"
      className="text-emerald-600 hover:text-emerald-500 ml-1">
      在线购买
    </a>
  </p>
)}
```

不要改表单、邀请码、错误状态或激活 API。

- [ ] **Step 4: 修改顶部栏**

在 `App.tsx` 导入 `editionCapabilities`，只将第 216 行改为：

```tsx
{editionCapabilities.showRenewEntry && <RenewButton />}
```

不要条件化等级、剩余时间、同步按钮或邀请好友。

- [ ] **Step 5: 验证两个 edition 的前端构建**

Run (PowerShell): `$env:VITE_APP_EDITION='main'; npm --prefix web run build`
Expected: PASS。

Run (PowerShell): `$env:VITE_APP_EDITION='agent'; npm --prefix web run build`
Expected: PASS。

Run: `npm --prefix web test`
Expected: 全部 Vitest PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/App.tsx web/src/pages/Activation.tsx web/src/edition.test.ts
git commit -m "feat(web): hide commercial entries in agent edition"
```

---

### Task 4: 固化 Electron edition 元数据和更新源

**Files:**
- Create: `electron/edition.ts`
- Create: `electron/edition.test.ts`
- Modify: `electron/main.ts:1-20,288-290,315-365`

**Interfaces:**
- Produces: `parsePackagedEdition(raw: unknown): PackagedEdition`
- Produces: `loadPackagedEdition(filePath: string): PackagedEdition`
- `PackagedEdition = { id:'main'|'agent'; updateUrl:string }`.

- [ ] **Step 1: 检查 main.ts 用户改动**

Run: `git diff -- electron/main.ts`
Expected: 当前已有未提交改动；逐块合并，禁止整文件覆盖。

- [ ] **Step 2: 写失败测试**

Create `electron/edition.test.ts`：

```ts
import { parsePackagedEdition } from './edition';

describe('parsePackagedEdition', () => {
  it('accepts main and agent metadata', () => {
    expect(parsePackagedEdition({ id: 'main', updateUrl: 'https://example.com/updates' }).id).toBe('main');
    expect(parsePackagedEdition({ id: 'agent', updateUrl: 'https://example.com/updates/agent' }).id).toBe('agent');
  });
  it('rejects invalid ids and non-https feeds', () => {
    expect(() => parsePackagedEdition({ id: 'dealer', updateUrl: 'https://example.com' })).toThrow();
    expect(() => parsePackagedEdition({ id: 'main', updateUrl: 'http://example.com' })).toThrow();
  });
});
```

注意根 Jest 当前 roots 不含 `electron`。将 `jest.config.js` roots 增加 `'<rootDir>/electron'`，测试仍只匹配 `*.test.ts`。

- [ ] **Step 3: 运行并确认失败**

Run: `npx jest electron/edition.test.ts --runInBand`
Expected: FAIL，找不到 `./edition`。

- [ ] **Step 4: 实现元数据解析**

`electron/edition.ts` 使用结构校验，不信任 JSON；仅接受 `main/agent` 和 HTTPS URL。`loadPackagedEdition` 用 `fs.readFileSync` 读取由构建脚本生成的 `dist/app-edition.json`。

- [ ] **Step 5: 接入 main.ts**

在 `electron/main.ts` 启动时从 `path.join(__dirname, '..', 'app-edition.json')` 加载。开发模式若文件不存在，明确使用：

```ts
const edition = isDev
  ? { id: 'main' as const, updateUrl: 'https://slg-updates.oss-cn-shanghai.aliyuncs.com/updates' }
  : loadPackagedEdition(path.join(__dirname, '..', 'app-edition.json'));
```

在 `ready` 中、首次检查更新之前：

```ts
console.log(`[Electron] edition=${edition.id} updateUrl=${edition.updateUrl}`);
autoUpdater.setFeedURL({ provider: 'generic', url: edition.updateUrl });
```

在手动和定时检查前记录 edition；`error` handler 改为记录 `err.message` 后再发送 idle，不向 UI 暴露密钥或激活信息。

- [ ] **Step 6: 测试和类型检查**

Run: `npx jest electron/edition.test.ts --runInBand`
Expected: 2 tests PASS。

Run: `npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add jest.config.js electron/edition.ts electron/edition.test.ts electron/main.ts
git commit -m "feat(electron): load edition-specific update feed"
```

---

### Task 5: 实现隔离的双版本构建协调器

**Files:**
- Create: `scripts/build-editions.mjs`
- Create: `scripts/build-editions.test.mjs`
- Modify: `package.json:13-16,25-27,81-84`

**Interfaces:**
- Consumes: `getEdition` from `scripts/edition-config.mjs`.
- Produces: `createBuildPlan(version): BuildStep[]` for tests.
- Produces directories: `release/main/` and `release/agent/`, each containing `latest.yml`, exe, blockmap.

- [ ] **Step 1: 检查 package.json 当前改动**

Run: `git diff -- package.json`
Expected: 保留当前 1.1.8 version/releaseNotes 等用户改动；只增量改 scripts/build 配置。

- [ ] **Step 2: 写构建计划失败测试**

Create `scripts/build-editions.test.mjs`，断言：

```js
const plan = createBuildPlan('1.2.0');
assert.deepEqual(plan.map(x => x.edition), ['main', 'agent']);
assert.equal(plan[0].env.VITE_APP_EDITION, 'main');
assert.equal(plan[1].env.VITE_APP_EDITION, 'agent');
assert.equal(plan[0].metadata.id, 'main');
assert.notEqual(plan[0].outputDir, plan[1].outputDir);
assert.match(plan[1].artifactName, /代理商版/);
```

Run: `node --test scripts/build-editions.test.mjs`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现可测试计划与 CLI**

`build-editions.mjs` 必须：

1. 导出纯函数 `createBuildPlan(version)`；
2. CLI 依次处理 main、agent；
3. 每个 edition 执行 web build，环境包含 `VITE_APP_EDITION=<id>`；
4. 执行根 `tsc` 与现有资源复制；
5. 写入 `dist/app-edition.json`，内容只含 `{ "id", "updateUrl" }`；
6. 调用 electron-builder 时显式覆盖 `directories.output`、`artifactName`、generic publish URL；
7. 每步使用 `spawnSync(..., { stdio:'inherit', env })`，非零退出立即抛错；
8. 构建完验证预期 exe、blockmap、latest.yml 存在；
9. 任一失败整条命令非零退出。

不要清理整个 `release/`；只在构建对应 edition 前清理 `release/main` 或 `release/agent`，并在删除前验证路径解析后位于仓库 `release` 目录内。

- [ ] **Step 4: 更新 npm scripts**

保留开发命令，新增/调整：

```json
"electron:build:win": "node scripts/build-editions.mjs",
"electron:publish:win": "node scripts/build-editions.mjs && node scripts/publish-release.mjs",
"test:release": "node --test scripts/*.test.mjs"
```

静态 `build.publish.url` 可保留主版兼容默认值，但双版本构建必须始终由 CLI override；在配置中显式加入主版 `artifactName`，确保单独运行 electron-builder 仍生成现有主版名称。

- [ ] **Step 5: 运行轻量测试（不真实打包）**

Run: `node --test scripts/edition-config.test.mjs scripts/build-editions.test.mjs`
Expected: 全部 PASS。

Run: `npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add package.json scripts/build-editions.mjs scripts/build-editions.test.mjs
git commit -m "feat(build): produce isolated main and agent installers"
```

---

### Task 6: 实现可回滚的 OSS 双渠道发布模块

**Files:**
- Create: `scripts/release-publisher.mjs`
- Create: `scripts/release-publisher.test.mjs`
- Refactor: `scripts/publish-release.mjs`

**Interfaces:**
- Produces: `validateRelease({rootDir, version, editions})`.
- Produces: `publishRelease({client, rootDir, version, editions, logger})`.
- OSS client contract: `put(key, localPathOrBuffer, options)`, `get(key)`, `head(key)`.

- [ ] **Step 1: 检查发布脚本用户改动**

Run: `git diff -- scripts/publish-release.mjs`
Expected: 若有用户改动，保留并迁移到薄 CLI；删除 VPS 行为是本任务批准范围。

- [ ] **Step 2: 写发布顺序失败测试**

用内存 fake client 记录事件。覆盖：

```js
assert.deepEqual(events.map(e => e.key), [
  'updates/ROK助手 Setup 1.2.0.exe',
  'updates/ROK助手 Setup 1.2.0.exe.blockmap',
  'updates/agent/ROK助手-代理商版 Setup 1.2.0.exe',
  'updates/agent/ROK助手-代理商版 Setup 1.2.0.exe.blockmap',
  'updates/latest.yml',
  'updates/agent/latest.yml',
]);
```

另写三个测试：

- 本地缺文件时零次 `put`；
- 任一 artifact `put/head` 失败时零次 manifest `put`；
- 第二份 manifest 失败时再次 `put('updates/latest.yml', oldMainBuffer)`，并最终 reject；
- 回滚也失败时错误消息同时含 `publish failed` 与 `rollback failed for main`。

测试 fixture 用 `mkdtempSync` 创建临时 `release/main|agent` 文件，并写最小 `latest.yml`：

```yaml
version: 1.2.0
path: ROK助手 Setup 1.2.0.exe
sha512: test
releaseDate: '2026-07-25T00:00:00.000Z'
```

- [ ] **Step 3: 运行并确认失败**

Run: `node --test scripts/release-publisher.test.mjs`
Expected: FAIL，找不到模块。

- [ ] **Step 4: 实现本地预检**

`validateRelease` 在建立 OSS client 或上传前完成：

- 读取每个 edition 的 `latest.yml`；
- 用 `yaml` 解析 manifest（复用 electron-builder 已有依赖不可依赖其嵌套路径；如根无直接 `yaml`，在根 devDependencies 增加固定兼容版本并更新 lockfile）；
- 校验 `version === package.json.version`；
- 校验 `path` 精确等于配置展开后的 artifactName；
- 校验 exe、`${exe}.blockmap`、latest.yml 都存在；
- 校验两个 edition 的版本相同。

返回规范化发布项，不在上传阶段重新猜文件名。

- [ ] **Step 5: 实现两阶段上传与回滚**

`publishRelease` 顺序：

1. 调 `validateRelease`；
2. `get` 两个旧 manifest；不存在时记录 `null`（首次代理商发布允许不存在）；
3. 上传四个不可变文件，每个 `put` 后 `head`；
4. 依次上传 main、agent manifest；
5. manifest 失败时，仅恢复已成功切换且原 manifest 存在的渠道；若原 manifest 不存在，报告该首次发布渠道需要人工确认，不执行危险 delete；
6. 汇总原始错误和每个回滚结果后 reject；
7. 成功时打印两个验证 URL。

为满足代理商首次发布的整体失败语义，发布顺序固定为 **agent manifest 先、main manifest 后**：若 agent 首次 manifest 成功但 main 失败，因为无旧 agent manifest 且不能安全 delete，状态无法自动恢复。因此在首次代理商上线前，运维需先放置一个不高于当前版本且引用已存在代理商产物的基线 manifest，或允许本脚本通过 `--initialize-agent` 明确初始化。实现时采用更安全的前置条件：正常发布要求两个旧 manifest 都存在；另提供一次性 `--initialize-agent`，只在 agent 目录产物已上传且 main manifest 不变时创建 agent 基线，随后再运行正式双发布。该初始化命令也必须只操作 OSS。

- [ ] **Step 6: 将现有脚本缩为 CLI**

`publish-release.mjs`：

- 检查 `OSS_KEY_ID/OSS_KEY_SECRET`；
- 创建现有上海 region、`slg-updates` bucket client；
- 不导入 `child_process`，不解析 `--oss-only`，没有 SCP/VPS 分支；
- 默认调用 `publishRelease`；
- `--initialize-agent` 调用单独初始化函数；
- 捕获错误，打印不含凭据的摘要并设置 `process.exitCode=1`。

- [ ] **Step 7: 运行发布模块测试**

Run: `node --test scripts/release-publisher.test.mjs scripts/edition-config.test.mjs scripts/build-editions.test.mjs`
Expected: 全部 PASS，无真实网络请求。

- [ ] **Step 8: 提交**

```bash
git add scripts/publish-release.mjs scripts/release-publisher.mjs scripts/release-publisher.test.mjs package.json package-lock.json
git commit -m "feat(release): publish both OSS channels with rollback"
```

---

### Task 7: 更新运维文档并执行完整静态验证

**Files:**
- Modify: `docs/VPS-运维指南.md:134-213`
- Test: all files above

**Interfaces:**
- Documents commands: `npm run electron:build:win`, `npm run electron:publish:win`, `node scripts/publish-release.mjs --initialize-agent`.

- [ ] **Step 1: 增量更新发布文档**

将 Electron 发布章节改为：

```text
首次启用代理商渠道：
1. npm run electron:build:win
2. node scripts/publish-release.mjs --initialize-agent
3. 检查 /updates/agent/latest.yml
4. npm run electron:publish:win

日常同步发布：
1. 更新根 package.json 的 version 和 releaseNotes
2. npm run electron:publish:win
3. 检查 /updates/latest.yml 与 /updates/agent/latest.yml 版本一致
```

明确：

- 产物位于 `release/main`、`release/agent`；
- 只使用 OSS；
- `--oss-only` 和 VPS SCP 已移除；
- manifest 最后上传，失败会尝试回滚；
- 不要手工删除旧 blockmap；
- 验证两个 URL 和两个安装包文件名。

- [ ] **Step 2: 运行所有针对性测试**

Run: `node --test scripts/*.test.mjs`
Expected: 全部 PASS。

Run: `npx jest electron/edition.test.ts --runInBand`
Expected: PASS。

Run: `npm --prefix web test`
Expected: PASS。

Run: `npx tsc --noEmit`
Expected: PASS。

Run (PowerShell): `$env:VITE_APP_EDITION='main'; npm --prefix web run build`
Expected: PASS。

Run (PowerShell): `$env:VITE_APP_EDITION='agent'; npm --prefix web run build`
Expected: PASS。

- [ ] **Step 3: 检查 diff 和敏感信息**

Run: `git diff --check`
Expected: 无 whitespace error。

Run: `git status --short`
Expected: 只出现本计划文件和用户原有未提交文件；确认没有 `.env`、OSS key、安装包或 `release/` 产物被暂存。

- [ ] **Step 4: 提交文档**

```bash
git add docs/VPS-运维指南.md
git commit -m "docs: document dual-edition OSS release"
```

---

### Task 8: Windows 真实双包验收（发布前手动门禁）

**Files:**
- Generated only: `release/main/*`, `release/agent/*`（不得提交）

**Interfaces:**
- Consumes completed build command and produces release-ready artifacts.

- [ ] **Step 1: 确认没有正在运行的 ROK助手**

必要时由用户执行：`! Get-Process electron,node -ErrorAction SilentlyContinue`
Expected: 不强制杀死不明进程；确认归属后再清理。

- [ ] **Step 2: 构建两个真实安装包**

Run: `npm run electron:build:win`
Expected: main 与 agent 均构建成功；任一失败命令整体非零。

- [ ] **Step 3: 检查产物与 manifest**

Run: `node scripts/publish-release.mjs --dry-run`
Expected: 只做本地校验，列出两个版本、相同 version、各自 URL 和六个文件，不访问或修改 OSS。若 Task 6 尚未包含 `--dry-run`，在 Task 6 CLI 中一并实现为 `validateRelease` 后退出。

- [ ] **Step 4: 安装主版并人工验证**

确认：显示激活页“在线购买”和顶部“续费”；产品名为 ROK助手；许可证和配置可读；更新日志显示 edition=main 和 `/updates`。

- [ ] **Step 5: 用代理商版覆盖安装并人工验证**

确认：没有第二个卸载项/快捷方式；购买和续费消失；激活码、邀请码、等级、剩余时间、同步授权、邀请好友仍存在；许可证和配置保留；更新日志显示 edition=agent 和 `/updates/agent`。

- [ ] **Step 6: 用主版反向覆盖并复验**

确认两个商业入口恢复，应用身份和数据不变，更新日志回到 main feed。

- [ ] **Step 7: 发布前最终门禁**

首次代理商渠道先执行初始化流程；以后执行 `npm run electron:publish:win`。这是外部 OSS 写入操作，执行前必须得到用户当次明确授权；不得因计划获批自动发布。

---

## Self-Review Result

- Spec coverage: 构建身份、文件名、UI 两处差异、独立 feed、OSS-only、整体失败、回滚、日志、测试和覆盖安装均有对应任务。
- Placeholder scan: 无 TBD/TODO/“稍后实现”；Task 6 明确解决代理商首次无旧 manifest 时无法回滚的问题。
- Type consistency: `main|agent`、`showPurchaseEntry/showRenewEntry`、`updateUrl/remotePrefix/artifactName/outputDir` 在各任务保持一致。
- Scope: 单一发布能力纵向切片，构建、UI、updater 和发布器必须共同交付，拆成多个独立计划会产生不可发布的中间状态，因此保留一个计划。
