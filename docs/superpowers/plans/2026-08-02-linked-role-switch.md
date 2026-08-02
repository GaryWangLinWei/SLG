# 连体号切号 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在账号调度中新增"连体号"切法——切到同一游戏账号下的另一个角色；"何时切"沿用现有 4 种触发时机，"怎么切"由目标 profile 的账号类型决定。

**Architecture:** 给每个 profile 的 `accountSwitch` 增加 `targetType: 'account' | 'linked'`（默认 `'account'`）。新建 `switchLinkedRole` action 实现连体角色切换流程，并把常规切号里"点登录之后等进城"的逻辑抽成共享函数 `waitForCityAfterLogin`。前端 `accountSwitchLoop` 读取目标 profile 的 `targetType` 决定传哪个 action 参数；配置页提供账号类型选择，调度卡片对连体号槽位显示"连体"角标。

**Tech Stack:** TypeScript, Node/Koa 后端, Jest + ts-jest（`plugins/`、`core/`、`web/src/utils/`）, React + Vite 前端, sharp 模板匹配。

参考 spec：`docs/superpowers/specs/2026-08-02-linked-role-switch-design.md`

---

## File Structure

- **Modify** `plugins/rok/index.ts` — `accountSwitch` 类型加 `targetType`；默认值加 `targetType: 'account'`；`switch-account` action 按 `targetType` 分支。
- **Modify** `plugins/rok/actions/switchAccount.ts` — 抽出 `waitForCityAfterLogin` 导出，`switchAccountOnce` 末尾改为调用它（行为不变）。
- **Create** `plugins/rok/actions/switchLinkedRole.ts` — 连体角色切换流程。
- **Create** `plugins/rok/actions/switchLinkedRole.test.ts` — 流程单元测试。
- **Modify** `web/src/pages/Config.tsx` — 新增"账号类型"选择 state、加载、保存、UI；连体时禁用清空账号编号。
- **Modify** `web/src/pages/Home.tsx` — 拉取 profile 的 `targetType` 缓存；调度循环按类型传参；连体槽位显示"连体"角标。

后端测试在 root 用 `npx jest <path> --runInBand`。前端没有 pages 层单测脚手架（root jest 只覆盖 `web/src/utils`），前端改动靠 `cd web && npm run build`（tsc 类型检查）+ 手动验证。

---

## Task 1: 数据模型加 targetType

**Files:**
- Modify: `plugins/rok/index.ts:172-174`（类型）
- Modify: `plugins/rok/index.ts:323-325`（默认值）

- [ ] **Step 1: 修改类型定义**

把 `plugins/rok/index.ts:172-174` 的 `accountSwitch` 改成：

```ts
  accountSwitch: {
    accountName: string;   // 账号编号，如 "241872258"，空 = 不参与切号
    targetType: 'account' | 'linked';  // 切到该 profile 时的切法：常规账号 OCR / 连体号角色
  };
```

- [ ] **Step 2: 修改默认值**

把 `plugins/rok/index.ts:323-325` 改成：

```ts
  accountSwitch: {
    accountName: '',
    targetType: 'account',
  },
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错（ConfigService 用 `Partial<RokConfig>` 合并，老配置缺 `targetType` 不报错；合并后由 `DEFAULT_ROK_CONFIG` 补默认值）。

- [ ] **Step 4: Commit**

```bash
git add plugins/rok/index.ts
git commit -m "feat(plugin): add accountSwitch.targetType for linked-role switch"
```

---

## Task 2: 抽出 waitForCityAfterLogin 共享函数

**Files:**
- Modify: `plugins/rok/actions/switchAccount.ts`

- [ ] **Step 1: 新增导出函数并让 switchAccountOnce 复用**

在 `plugins/rok/actions/switchAccount.ts` 中，紧接 `const SURE_SWITCH_TEMPLATE = ...`（第 17 行）之后、`REGION1` 之前，加入以下函数：

```ts
/**
 * 点击"确认登录"按钮后的通用进城等待逻辑：
 * 等 15s → 随机点 TAP_REGION → 等 20s → 每 2s 轮询城内，最多 60s。
 * 常规账号切换与连体号切换共用。
 */
export async function waitForCityAfterLogin(ctx: PluginContext): Promise<'success' | 'switched_load_timeout'> {
  ctx.log(`  等待 15s 进入开始界面`);
  await ctx.sleep(15);

  const tx = randInt(TAP_REGION.x1, TAP_REGION.x2);
  const ty = randInt(TAP_REGION.y1, TAP_REGION.y2);
  ctx.log(`  点击 (${tx}, ${ty}) 进入游戏`);
  await ctx.tap(tx, ty);

  ctx.log(`  等待 20s 加载...`);
  await ctx.sleep(20);

  ctx.log(`  每 2s 轮询进城，最多 60s`);
  const pollStart = Date.now();
  while (Date.now() - pollStart < 60_000) {
    await ctx.sleep(2);
    const loc = await getCurrentLocation(ctx);
    if (loc === 'city') {
      ctx.log(`  ✅ 已回到城内，切号成功`);
      return 'success';
    }
  }
  ctx.log(`  ❌ 账号已切换，但 60s 内未检测到城内界面`);
  return 'switched_load_timeout';
}
```

- [ ] **Step 2: 替换 switchAccountOnce 末尾的重复逻辑**

删除 `plugins/rok/actions/switchAccount.ts` 中第 140 行 `ctx.log(\`  ✅ 已点击登录...\`);` 之后、第 165 行 `return 'switched_load_timeout';`（含）之前的整段等待逻辑，并替换为调用共享函数。把当前第 138-165 行整体替换成：

```ts
  ctx.log(`  [6/6] 点登录 (${sureSwitch.x}, ${sureSwitch.y})`);
  await ctx.tap(sureSwitch.x, sureSwitch.y);
  ctx.log(`  ✅ 已点击登录，账号切换完成；继续等待新账号进入城内`);

  return await waitForCityAfterLogin(ctx);
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add plugins/rok/actions/switchAccount.ts
git commit -m "refactor(switch-account): extract waitForCityAfterLogin for reuse"
```

---

## Task 3: 实现 switchLinkedRole（TDD）

**Files:**
- Create: `plugins/rok/actions/switchLinkedRole.ts`
- Create: `plugins/rok/actions/switchLinkedRole.test.ts`

连体号流程坐标（spec 第 5 步）：

| 步骤 | 坐标 / 模板 |
|---|---|
| 点头像 | (63, 51) |
| 点设置 | (1358, 743) |
| 角色按钮 | 模板 `icon_role.png`（阈值 0.75） |
| 点连体账号 | (909, 334) |
| 确认登录 | 在区域 x=864, y=598, w=304, h=82 内匹配 `btn_surelogin.png`（阈值 0.7） |
| 关闭角色管理 | (1366, 105) |
| 关闭设置 | (1394, 55) |
| 关闭玩家页 | (1454, 88) |

- [ ] **Step 1: 写失败测试**

创建 `plugins/rok/actions/switchLinkedRole.test.ts`：

```ts
import * as path from 'path';
import { switchLinkedRole } from './switchLinkedRole';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as locationUtil from '../utils/location';

jest.mock('../utils/location', () => ({
  getCurrentLocation: jest.fn(),
}));

function makeCtx(overrides: Partial<any> = {}): any {
  const taps: Array<{ x: number; y: number }> = [];
  const logs: string[] = [];
  const ctx = {
    taps,
    logs,
    sleep: jest.fn(async () => {}),
    tap: jest.fn(async (x: number, y: number) => { taps.push({ x, y }); }),
    log: jest.fn((m: string) => { logs.push(m); }),
    findImageWithLocation: jest.fn(),
    captureRegion: jest.fn(),
    ...overrides,
  };
  return ctx;
}

const ICON_ROLE = path.join(getTemplatesDir(), 'icon_role.png');
const BTN_SURELOGIN = path.join(getTemplatesDir(), 'btn_surelogin.png');

beforeEach(() => {
  (locationUtil.getCurrentLocation as jest.Mock).mockResolvedValue('city');
});

test('成功路径：点头像→设置→角色→连体账号→确认登录→进城', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) => {
      if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
      if (p === BTN_SURELOGIN) return { found: true, x: 1000, y: 640, confidence: 0.9 };
      return { found: false, x: 0, y: 0, confidence: 0 };
    }),
  });

  const result = await switchLinkedRole(ctx as any);
  expect(result).toBe('success');

  // 关键点击：头像(63,51)、设置(1358,743)、角色图标位置、连体账号(909,334)、确认登录位置
  expect(ctx.taps).toContainEqual({ x: 63, y: 51 });
  expect(ctx.taps).toContainEqual({ x: 1358, y: 743 });
  expect(ctx.taps).toContainEqual({ x: 200, y: 300 });
  expect(ctx.taps).toContainEqual({ x: 909, y: 334 });
  expect(ctx.taps).toContainEqual({ x: 1000, y: 640 });
  // 成功路径不应点击任何关闭按钮
  expect(ctx.taps).not.toContainEqual({ x: 1394, y: 55 });
  expect(ctx.taps).not.toContainEqual({ x: 1454, y: 88 });
  expect(ctx.taps).not.toContainEqual({ x: 1366, y: 105 });
});

test('找不到角色按钮时依次关闭设置和玩家页，返回 not_found', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) => {
      if (p === ICON_ROLE) return { found: false, x: 0, y: 0, confidence: 0.2 };
      return { found: false, x: 0, y: 0, confidence: 0 };
    }),
  });

  const result = await switchLinkedRole(ctx as any);
  expect(result).toBe('not_found');
  // 关闭设置(1394,55) → 关闭玩家页(1454,88)；不应点到角色管理关闭(1366,105)
  expect(ctx.taps).toContainEqual({ x: 1394, y: 55 });
  expect(ctx.taps).toContainEqual({ x: 1454, y: 88 });
  expect(ctx.taps).not.toContainEqual({ x: 1366, y: 105 });
  expect(ctx.taps).not.toContainEqual({ x: 909, y: 334 });
});

test('找不到确认登录按钮时依次关闭角色管理、设置、玩家页，返回 not_found', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) => {
      if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
      if (p === BTN_SURELOGIN) return { found: false, x: 0, y: 0, confidence: 0.2 };
      return { found: false, x: 0, y: 0, confidence: 0 };
    }),
  });

  const result = await switchLinkedRole(ctx as any);
  expect(result).toBe('not_found');
  expect(ctx.taps).toContainEqual({ x: 200, y: 300 });
  expect(ctx.taps).toContainEqual({ x: 909, y: 334 });
  // 三个关闭按钮都要点
  expect(ctx.taps).toContainEqual({ x: 1366, y: 105 });
  expect(ctx.taps).toContainEqual({ x: 1394, y: 55 });
  expect(ctx.taps).toContainEqual({ x: 1454, y: 88 });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest plugins/rok/actions/switchLinkedRole.test.ts --runInBand`
Expected: FAIL，报错 `Cannot find module './switchLinkedRole'`。

- [ ] **Step 3: 实现 switchLinkedRole**

创建 `plugins/rok/actions/switchLinkedRole.ts`：

```ts
import * as path from 'path';
import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { waitForCityAfterLogin } from './switchAccount';

export type SwitchLinkedRoleResult = 'success' | 'not_found' | 'switched_load_timeout';

const AVATAR_TAP = { x: 63, y: 51 };
const SETTINGS_BTN = { x: 1358, y: 743 };
const LINKED_ACCOUNT_BTN = { x: 909, y: 334 };
const CLOSE_ROLE_BTN = { x: 1366, y: 105 };
const CLOSE_SETTINGS_BTN = { x: 1394, y: 55 };
const CLOSE_PLAYER_BTN = { x: 1454, y: 88 };

// 确认登录按钮的搜索区域（spec: (864,598)-(1168,680)）
const SURELOGIN_SEARCH_REGION = { x: 864, y: 598, width: 1168 - 864, height: 680 - 598 };

const ICON_ROLE_TEMPLATE = path.join(getTemplatesDir(), 'icon_role.png');
const BTN_SURELOGIN_TEMPLATE = path.join(getTemplatesDir(), 'btn_surelogin.png');

/**
 * 连体号切换：头像 → 设置 → 角色管理 → 连体账号 → 确认登录 → 等进城。
 * 与常规账号切换不同，不走用户中心/OCR，而是切到同一游戏账号下的另一个角色。
 */
export async function switchLinkedRole(ctx: PluginContext): Promise<SwitchLinkedRoleResult> {
  ctx.log(`=== 切换连体号角色 ===`);

  // 1. 点头像
  ctx.log(`  [1/5] 点头像 (${AVATAR_TAP.x},${AVATAR_TAP.y})`);
  await ctx.tap(AVATAR_TAP.x, AVATAR_TAP.y);
  await ctx.sleep(0.5);

  // 2. 点设置
  ctx.log(`  [2/5] 点设置 (${SETTINGS_BTN.x},${SETTINGS_BTN.y})`);
  await ctx.tap(SETTINGS_BTN.x, SETTINGS_BTN.y);
  await ctx.sleep(1);

  // 3. 找角色按钮
  const roleIcon = await ctx.findImageWithLocation(ICON_ROLE_TEMPLATE, 0.75);
  ctx.log(`  [3/5] icon_role.png found=${roleIcon.found} conf=${roleIcon.confidence.toFixed(3)}`);
  if (!roleIcon.found) {
    ctx.log(`  ❌ 未找到角色按钮，关闭设置和玩家页后结束`);
    await ctx.tap(CLOSE_SETTINGS_BTN.x, CLOSE_SETTINGS_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_PLAYER_BTN.x, CLOSE_PLAYER_BTN.y);
    return 'not_found';
  }
  await ctx.tap(roleIcon.x, roleIcon.y);
  await ctx.sleep(1);

  // 4. 点连体账号
  ctx.log(`  [4/5] 点连体账号 (${LINKED_ACCOUNT_BTN.x},${LINKED_ACCOUNT_BTN.y})`);
  await ctx.tap(LINKED_ACCOUNT_BTN.x, LINKED_ACCOUNT_BTN.y);
  await ctx.sleep(1);

  // 5. 在指定区域内匹配确认登录按钮
  const sureLogin = await ctx.findImageWithLocation(
    BTN_SURELOGIN_TEMPLATE,
    0.7,
    undefined,
    undefined,
    undefined,
    SURELOGIN_SEARCH_REGION,
  );
  ctx.log(`  [5/5] btn_surelogin.png found=${sureLogin.found} conf=${sureLogin.confidence.toFixed(3)}`);
  if (!sureLogin.found) {
    ctx.log(`  ❌ 未找到连体号确认登录按钮，依次关闭角色管理、设置、玩家页`);
    await ctx.tap(CLOSE_ROLE_BTN.x, CLOSE_ROLE_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_SETTINGS_BTN.x, CLOSE_SETTINGS_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_PLAYER_BTN.x, CLOSE_PLAYER_BTN.y);
    return 'not_found';
  }
  ctx.log(`  [5/5] 点确认登录 (${sureLogin.x},${sureLogin.y})`);
  await ctx.tap(sureLogin.x, sureLogin.y);

  return await waitForCityAfterLogin(ctx);
}
```

注意：`findImageWithLocation` 的签名是 `(templatePath, threshold?, scales?, normalize?, channel?, searchRegion?)`（见 `core/plugin/PluginContext.ts:77-84`），第 6 个参数为搜索区域，区域字段为 `{ x, y, width, height }`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest plugins/rok/actions/switchLinkedRole.test.ts --runInBand`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 6: Commit**

```bash
git add plugins/rok/actions/switchLinkedRole.ts plugins/rok/actions/switchLinkedRole.test.ts
git commit -m "feat(plugin): add switchLinkedRole action for 连体号 character switch"
```

---

## Task 4: switch-account action 按 targetType 分支

**Files:**
- Modify: `plugins/rok/index.ts`（顶部 import 区与 `switch-account` action，约 934-947 行）

- [ ] **Step 1: 加 import**

在 `plugins/rok/index.ts` 顶部已有 `import { switchAccount } from './actions/switchAccount';` 附近（搜索该行），加一行：

```ts
import { switchLinkedRole } from './actions/switchLinkedRole';
```

- [ ] **Step 2: 改 action run 分支**

把 `plugins/rok/index.ts:934-947` 的 `switch-account` action 整体替换为：

```ts
    {
      id: 'switch-account',
      name: '切换账号',
      description: '通过用户中心切换账号，或切换到同一账号下的连体号角色',
      run: async (ctx, params) => {
        const targetType = (params?.targetType as 'account' | 'linked') ?? 'account';
        if (targetType === 'linked') {
          const result = await switchLinkedRole(ctx);
          ctx.log(`切换账号: ${result}`);
          return;
        }
        const targetName = params?.targetName as string | undefined;
        if (!targetName) {
          ctx.log('❌ 未提供 targetName');
          return;
        }
        const result = await switchAccount(ctx, targetName);
        ctx.log(`切换账号: ${result}`);
      }
    },
```

前端成功判定依赖日志前缀 `切换账号:`，两种切法保持一致。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add plugins/rok/index.ts
git commit -m "feat(plugin): branch switch-account by targetType (account/linked)"
```

---

## Task 5: 配置页（Config.tsx）账号类型选择

**Files:**
- Modify: `web/src/pages/Config.tsx`

- [ ] **Step 1: 加 state**

在 `web/src/pages/Config.tsx:43` 的 `const [accountSwitchName, setAccountSwitchName] = useState<string>('');` 下面加：

```ts
  const [accountTargetType, setAccountTargetType] = useState<'account' | 'linked'>('account');
```

- [ ] **Step 2: 加载时读取 targetType**

在 `loadConfig`（约第 62 行）和 `switchConfig`（约第 93 行）中，读取 `accountName` 的同一处增加读取 `targetType`。

把 `loadConfig` 中的：

```ts
        setAccountSwitchName((res.config as any).accountSwitch?.accountName ?? '');
```

替换为：

```ts
        setAccountSwitchName((res.config as any).accountSwitch?.accountName ?? '');
        setAccountTargetType((res.config as any).accountSwitch?.targetType ?? 'account');
```

把 `switchConfig` 中的：

```ts
        setAccountSwitchName((res.config as any).accountSwitch?.accountName ?? '');
        accountSwitchNameSyncedRef.current = (res.config as any).accountSwitch?.accountName ?? '';
```

替换为：

```ts
        setAccountSwitchName((res.config as any).accountSwitch?.accountName ?? '');
        setAccountTargetType((res.config as any).accountSwitch?.targetType ?? 'account');
        accountSwitchNameSyncedRef.current = (res.config as any).accountSwitch?.accountName ?? '';
```

- [ ] **Step 3: 保存时带上 targetType**

把 `autoSave`（约第 178 行）中的：

```ts
      await api.config.saveRokConfig(currentAccountId, { buildingPositions: bp, accountSwitch: { accountName: accountSwitchName } } as any, configName);
```

替换为：

```ts
      await api.config.saveRokConfig(currentAccountId, { buildingPositions: bp, accountSwitch: { accountName: accountSwitchName, targetType: accountTargetType } } as any, configName);
```

- [ ] **Step 4: 选连体号时清空并禁用账号编号**

把账号编号输入框（约第 369-377 行）替换为下面这段，在它前面加上账号类型选择：

```tsx
        {/* 账号类型 + 账号编号（与配置同一行） */}
        <label className="text-sm text-slate-600 whitespace-nowrap ml-2">类型:</label>
        <select
          value={accountTargetType}
          onChange={(e) => {
            const v = e.target.value as 'account' | 'linked';
            setAccountTargetType(v);
            if (v === 'linked') setAccountSwitchName('');
            autoSave(buildingPositions);
          }}
          className="px-2 py-1 text-sm border border-slate-300 rounded"
        >
          <option value="account">常规账号</option>
          <option value="linked">连体号</option>
        </select>
        <label className="text-sm text-slate-600 whitespace-nowrap ml-2">账号编号:</label>
        <input
          type="text"
          value={accountSwitchName}
          onChange={(e) => setAccountSwitchName(e.target.value)}
          onBlur={() => autoSave(buildingPositions)}
          disabled={accountTargetType === 'linked'}
          placeholder={accountTargetType === 'linked' ? '连体号无需编号' : '请输入'}
          className="px-2 py-1 text-sm border border-slate-300 rounded w-40 disabled:bg-slate-100 disabled:text-slate-400"
        />
```

注意：原来的 `<label ...>账号编号:</label>` 和 `<input .../>` 要整段替换掉，不要重复。

- [ ] **Step 5: 前端类型检查 + 构建**

Run: `cd web && npm run build`
Expected: `tsc` 通过并完成 Vite 构建，无类型错误。

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Config.tsx
git commit -m "feat(web): add account type selector (account/linked) in Config page"
```

---

## Task 6: Home.tsx 拉取 targetType 并在调度循环中使用

**Files:**
- Modify: `web/src/pages/Home.tsx`

需要改三处：(a) 定义 profile targetType 缓存并在两处加载 profile 的地方填充；(b) `accountSwitchLoop` 按 targetType 决定 task 参数与跳过逻辑；(c) 槽位 UI 显示"连体"角标，并让连体号即使没编号也可被选中。

- [ ] **Step 1: 找 state 定义并加缓存**

在 `Home.tsx` 中搜索 `const [profileAccountNames`，在其下方新增一行：

```ts
  const [profileTargetTypes, setProfileTargetTypes] = useState<Record<string, 'account' | 'linked'>>({});
```

- [ ] **Step 2: 两处加载 profile 时填充 targetType**

第一处（约第 608-616 行，挂载/账号切换时）。把：

```ts
          const map: Record<string, string> = {};
          await Promise.all(pRes.profiles.map(async (p: string) => {
            try {
              const cfg = await api.config.getRokConfig(currentAccountId, p);
              map[p] = ((cfg.config as any)?.accountSwitch?.accountName || '').trim();
            } catch { map[p] = ''; }
          }));
          setProfileAccountNames(map);
```

替换为：

```ts
          const map: Record<string, string> = {};
          const typeMap: Record<string, 'account' | 'linked'> = {};
          await Promise.all(pRes.profiles.map(async (p: string) => {
            try {
              const cfg = await api.config.getRokConfig(currentAccountId, p);
              map[p] = ((cfg.config as any)?.accountSwitch?.accountName || '').trim();
              typeMap[p] = ((cfg.config as any)?.accountSwitch?.targetType === 'linked') ? 'linked' : 'account';
            } catch { map[p] = ''; typeMap[p] = 'account'; }
          }));
          setProfileAccountNames(map);
          setProfileTargetTypes(typeMap);
```

第二处（约第 631-638 行，focus/visibility 刷新）做同样替换：把 `const map: Record<string,string> = {}; ... setProfileAccountNames(map);` 换成带 `typeMap` 的版本（与上面相同的代码块）。

- [ ] **Step 3: accountSwitchLoop 按 targetType 传参**

把 `Home.tsx:1243-1251` 这一段：

```ts
            const cfgRes = await api.config.getRokConfig(currentAccountId, nextProfile);
            const targetName = (cfgRes.config as any)?.accountSwitch?.accountName || '';
            if (!targetName) {
              pushLog(`⚠️ profile "${nextProfile}" 未填账号编号，跳过`);
              switchTargetIdx = (switchTargetIdx + 1) % validIds.length;
            } else {
              let ok = false;
              for (let attempt = 1; attempt <= 2 && !isStopped(); attempt++) {
                const cr = await createTask(currentAccountId, 'com.rok.automation', 'switch-account', { targetName });
```

替换为：

```ts
            const cfgRes = await api.config.getRokConfig(currentAccountId, nextProfile);
            const targetType: 'account' | 'linked' = (cfgRes.config as any)?.accountSwitch?.targetType === 'linked' ? 'linked' : 'account';
            const targetName = (cfgRes.config as any)?.accountSwitch?.accountName || '';
            if (targetType === 'account' && !targetName) {
              pushLog(`⚠️ profile "${nextProfile}" 未填账号编号，跳过`);
              switchTargetIdx = (switchTargetIdx + 1) % validIds.length;
            } else {
              let ok = false;
              for (let attempt = 1; attempt <= 2 && !isStopped(); attempt++) {
                const taskParams = targetType === 'linked'
                  ? { targetType: 'linked' as const }
                  : { targetName };
                const cr = await createTask(currentAccountId, 'com.rok.automation', 'switch-account', taskParams);
```

注意：这个 `if/else` 块的后续内容（`if (!cr.success) break;` 及之后的重试、成功判定、`switchProfile` 等）保持不变，只是缩进层级没变（仍是同一个 `else` 内）。确认替换后 `createTask` 调用只有一处、不再出现旧的 `{ targetName }` 字面量。

- [ ] **Step 4: 槽位 option 对连体号解禁**

把槽位 `<select>` 内渲染 option 的部分（约第 2649-2656 行）：

```tsx
                              {configNames.filter(p => !others.includes(p)).map(p => {
                                const hasAccount = !!(profileAccountNames[p] || '').trim();
                                return (
                                  <option key={p} value={p} disabled={!hasAccount}>
                                    {p}{hasAccount ? '' : '（未填编号）'}
                                  </option>
                                );
                              })}
```

替换为：

```tsx
                              {configNames.filter(p => !others.includes(p)).map(p => {
                                const isLinked = profileTargetTypes[p] === 'linked';
                                const hasAccount = isLinked || !!(profileAccountNames[p] || '').trim();
                                return (
                                  <option key={p} value={p} disabled={!hasAccount}>
                                    {p}{isLinked ? '（连体）' : (hasAccount ? '' : '（未填编号）')}
                                  </option>
                                );
                              })}
```

- [ ] **Step 5: 槽位卡片显示"连体"角标**

在槽位卡片头部（约第 2631-2636 行），目前右侧只有 `#{i+1}`。把：

```tsx
                            <div className="flex items-center justify-between mb-1">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`}></span> {isActive ? '当前' : '待切换'}
                              </span>
                              <span className="text-[10px] text-slate-300">#{i + 1}</span>
                            </div>
```

替换为：

```tsx
                            <div className="flex items-center justify-between mb-1">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`}></span> {isActive ? '当前' : '待切换'}
                              </span>
                              <span className="flex items-center gap-1">
                                {profileName && profileTargetTypes[profileName] === 'linked' && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700">连体</span>
                                )}
                                <span className="text-[10px] text-slate-300">#{i + 1}</span>
                              </span>
                            </div>
```

- [ ] **Step 6: tooltip 补连体号说明（可选但推荐）**

搜索文案"在两个账号配置方案之间自动切换"（约第 2550、2573 行的 tooltip），在其中"组合采集"说明之后补一句：

```
连体号：切到同一游戏账号下的另一个角色（在配置页把账号类型设为"连体号"），触发时机仍由上方模式决定。
```

两处 tooltip 文案相同，都补上。

- [ ] **Step 7: 前端类型检查 + 构建**

Run: `cd web && npm run build`
Expected: `tsc` 通过、Vite 构建成功。

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(web): support linked-role target in account schedule loop and slot badge"
```

---

## Task 7: 全量验证

- [ ] **Step 1: 运行相关后端测试**

Run: `npx jest plugins/rok/actions/switchLinkedRole.test.ts --runInBand`
Expected: 3 个测试全部 PASS。

- [ ] **Step 2: 根项目类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 3: 前端构建**

Run: `cd web && npm run build`
Expected: tsc + Vite 构建成功。

- [ ] **Step 4: 手动验证（真机/模拟器）**

1. 启动 `npm run server` 与 `cd web && npm run dev`。
2. 新建或编辑一个 profile，在配置页把"类型"切到"连体号"，确认账号编号输入框被禁用并显示"连体号无需编号"，保存。
3. 在首页账号调度卡片选两个槽位：一个常规账号、一个连体号 profile，确认连体号槽位右上角出现紫色"连体"角标、option 文本带"（连体）"，且即使没填编号也能选中（不被禁用）。
4. 选"按时间轮换"，设为 1 分钟，开启自动切号。先等它从常规号切到连体号，观察日志：
   - 切连体号时 task 参数应为 `{ targetType: 'linked' }`，action 日志为 `=== 切换连体号角色 ===`，走 5 步流程，成功后出现 `切换账号: success`，随后前端激活连体号 profile。
5. 再等它从连体号切回常规号，确认走的是常规 OCR 流程（`=== 切换账号 target=... ===`）。
6. 异常路径：在没进入角色管理的界面触发一次连体切号，确认 action 返回 `not_found`、日志提示关闭弹窗，前端不推进 profile。

---

## Self-Review 结论

- **Spec 覆盖**：数据模型 targetType（Task 1）、配置页类型选择与连体禁用编号（Task 5）、抽出进城共享函数（Task 2）、连体流程 action（Task 3）、action 分支（Task 4）、调度循环按类型传参 + 连体无编号不跳过（Task 6 Step 3）、槽位"连体"角标 + tooltip（Task 6 Step 4-6）、失败关闭弹窗返回 not_found（Task 3 测试/实现）、测试（Task 3、7）均已覆盖。
- **类型一致**：`targetType` 在 `RokConfig.accountSwitch`、Config.tsx state、Home.tsx 缓存与 task params 中统一为 `'account' | 'linked'`；action 日志前缀统一为 `切换账号:`。
- **占位符**：无 TBD/TODO；每个代码步骤均给出完整代码。
