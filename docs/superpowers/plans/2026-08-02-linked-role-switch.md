# 连体号切号 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增"连体号"切法——同一游戏账号下主号与连体角色互切；4 种触发时机不变，切法由当前/目标 profile 的类型与编号决定。

**Architecture:** 给每个 profile 的 `accountSwitch` 加 `targetType: 'account' | 'linked'`，连体号也填主号编号。抽出纯函数 `resolveSwitchKind` 按决策表返回 OCR 或连体方向。新建 `switchLinkedRole(ctx, direction)`，主→连体点右侧 (909,334)，连体→主点左侧 (320,334)，其余流程共用 `waitForCityAfterLogin`。前端传当前+目标的编号与类型，并在槽位 UI 用禁用规则阻止连体接连体、连体无主号配对。

**Tech Stack:** TypeScript, Jest + ts-jest（`plugins/`）, React + Vite 前端, sharp 模板匹配。

参考 spec：`docs/superpowers/specs/2026-08-02-linked-role-switch-design.md`

---

## File Structure

- **Modify** `plugins/rok/index.ts` — 类型加 `targetType`；默认值；import；`switch-account` action 用 `resolveSwitchKind` 分支。
- **Modify** `plugins/rok/actions/switchAccount.ts` — 导出 `waitForCityAfterLogin`，常规流程末尾复用。
- **Create** `plugins/rok/actions/switchLinkedRole.ts` — 连体切换流程（带 direction）。
- **Create** `plugins/rok/actions/switchLinkedRole.test.ts` — 流程测试。
- **Create** `plugins/rok/actions/switchAccountKind.test.ts` — `resolveSwitchKind` 决策表测试。
- **Modify** `web/src/pages/Config.tsx` — 账号类型选择，连体不禁用编号输入。
- **Modify** `web/src/pages/Home.tsx` — 缓存 targetType；调度循环传 current/target 参数；连体槽位角标 + option 禁用规则。

---

## Task 1: 数据模型加 targetType

**Files:**
- Modify: `plugins/rok/index.ts:172-174`
- Modify: `plugins/rok/index.ts:323-325`

- [ ] **Step 1: 修改类型**

把 `plugins/rok/index.ts:172-174` 改成：

```ts
  accountSwitch: {
    accountName: string;   // 账号编号，连体号填主号相同的编号
    targetType: 'account' | 'linked';  // account=常规主号，linked=连体号
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
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add plugins/rok/index.ts
git commit -m "feat(plugin): add accountSwitch.targetType for linked-role switch"
```

---

## Task 2: 抽出 waitForCityAfterLogin

**Files:**
- Modify: `plugins/rok/actions/switchAccount.ts`

- [ ] **Step 1: 新增导出函数**

在 `switchAccount.ts` 第 17 行 `const SURE_SWITCH_TEMPLATE = ...` 之后、`REGION1` 之前插入：

```ts
/**
 * 点击"确认登录"后的通用进城等待：等 15s → 点 TAP_REGION → 等 20s → 每 2s 轮询城内最多 60s。
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

- [ ] **Step 2: switchAccountOnce 末尾改为调用它**

把 `switchAccount.ts` 当前第 138-165 行整体替换为：

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

## Task 3: 决策纯函数 resolveSwitchKind（TDD）

**Files:**
- Create: `plugins/rok/actions/switchAccountKind.ts`
- Create: `plugins/rok/actions/switchAccountKind.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `plugins/rok/actions/switchAccountKind.test.ts`：

```ts
import { resolveSwitchKind } from './switchAccountKind';

describe('resolveSwitchKind 切法决策', () => {
  test('主号(常规) → 同编号连体号 → main-to-linked', () => {
    expect(resolveSwitchKind({
      currentName: '241872258', currentType: 'account',
      targetName: '241872258', targetType: 'linked',
    })).toEqual({ kind: 'linked', direction: 'main-to-linked' });
  });

  test('连体号 → 同编号主号(常规) → linked-to-main', () => {
    expect(resolveSwitchKind({
      currentName: '241872258', currentType: 'linked',
      targetName: '241872258', targetType: 'account',
    })).toEqual({ kind: 'linked', direction: 'linked-to-main' });
  });

  test('常规 → 常规 同编号 → OCR（至少一方需 linked 才走连体）', () => {
    expect(resolveSwitchKind({
      currentName: '241872258', currentType: 'account',
      targetName: '241872258', targetType: 'account',
    })).toEqual({ kind: 'ocr' });
  });

  test('编号不同 → OCR（即使一方是连体号）', () => {
    expect(resolveSwitchKind({
      currentName: '111', currentType: 'linked',
      targetName: '222', targetType: 'account',
    })).toEqual({ kind: 'ocr' });
  });

  test('编号带空格也能匹配', () => {
    expect(resolveSwitchKind({
      currentName: ' 241872258 ', currentType: 'account',
      targetName: '241872258', targetType: 'linked',
    })).toEqual({ kind: 'linked', direction: 'main-to-linked' });
  });

  test('空编号 → OCR（避免误判连体）', () => {
    expect(resolveSwitchKind({
      currentName: '', currentType: 'account',
      targetName: '', targetType: 'linked',
    })).toEqual({ kind: 'ocr' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest plugins/rok/actions/switchAccountKind.test.ts --runInBand`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

创建 `plugins/rok/actions/switchAccountKind.ts`：

```ts
export type AccountType = 'account' | 'linked';
export type LinkedDirection = 'main-to-linked' | 'linked-to-main';

export interface SwitchKindInput {
  currentName: string;
  currentType: AccountType;
  targetName: string;
  targetType: AccountType;
}

export type SwitchKind =
  | { kind: 'ocr' }
  | { kind: 'linked'; direction: LinkedDirection };

/**
 * 决定切号物理方式：
 * - 当前与目标编号相同（非空）、且至少一方是连体号 → 连体流程；
 *   direction 由当前类型决定（当前是常规主号→主号切连体；当前是连体→连体切主号）。
 * - 其余情况走 OCR 切账号。
 */
export function resolveSwitchKind(input: SwitchKindInput): SwitchKind {
  const cur = (input.currentName || '').trim();
  const tgt = (input.targetName || '').trim();
  const sameAccount = !!cur && cur === tgt;
  const isLinkedSwitch = sameAccount && (input.currentType === 'linked' || input.targetType === 'linked');
  if (!isLinkedSwitch) return { kind: 'ocr' };

  const direction: LinkedDirection = input.currentType === 'account' && input.targetType === 'linked'
    ? 'main-to-linked'
    : 'linked-to-main';
  return { kind: 'linked', direction };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest plugins/rok/actions/switchAccountKind.test.ts --runInBand`
Expected: PASS（6 个测试）。

- [ ] **Step 5: Commit**

```bash
git add plugins/rok/actions/switchAccountKind.ts plugins/rok/actions/switchAccountKind.test.ts
git commit -m "feat(plugin): add resolveSwitchKind decision function"
```

---

## Task 4: 实现 switchLinkedRole（TDD）

**Files:**
- Create: `plugins/rok/actions/switchLinkedRole.ts`
- Create: `plugins/rok/actions/switchLinkedRole.test.ts`

坐标：头像 (63,51)；设置 (1358,743)；主号/连体角色入口 (320,334)/(909,334)；确认登录区域 x=864,y=598,w=304,h=82；关闭角色管理 (1366,105)、设置 (1394,55)、玩家页 (1454,88)。

- [ ] **Step 1: 写失败测试**

创建 `plugins/rok/actions/switchLinkedRole.test.ts`：

```ts
import * as path from 'path';
import { switchLinkedRole } from './switchLinkedRole';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as locationUtil from '../utils/location';

jest.mock('../utils/location', () => ({ getCurrentLocation: jest.fn() }));

function makeCtx(overrides: Partial<any> = {}): any {
  const taps: Array<{ x: number; y: number }> = [];
  const ctx = {
    taps,
    sleep: jest.fn(async () => {}),
    tap: jest.fn(async (x: number, y: number) => { taps.push({ x, y }); }),
    log: jest.fn(),
    findImageWithLocation: jest.fn(),
    ...overrides,
  };
  return ctx;
}

const ICON_ROLE = path.join(getTemplatesDir(), 'icon_role.png');
const BTN_SURELOGIN = path.join(getTemplatesDir(), 'btn_surelogin.png');

beforeEach(() => { (locationUtil.getCurrentLocation as jest.Mock).mockResolvedValue('city'); });

test('main-to-linked：点右侧连体角色 (909,334)', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) => {
      if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
      if (p === BTN_SURELOGIN) return { found: true, x: 1000, y: 640, confidence: 0.9 };
      return { found: false, x: 0, y: 0, confidence: 0 };
    }),
  });
  const result = await switchLinkedRole(ctx as any, 'main-to-linked');
  expect(result).toBe('success');
  expect(ctx.taps).toContainEqual({ x: 909, y: 334 });
  expect(ctx.taps).not.toContainEqual({ x: 320, y: 334 });
  expect(ctx.taps).not.toContainEqual({ x: 1394, y: 55 });
  expect(ctx.taps).not.toContainEqual({ x: 1454, y: 88 });
});

test('linked-to-main：点左侧主号 (320,334)', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) => {
      if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
      if (p === BTN_SURELOGIN) return { found: true, x: 1000, y: 640, confidence: 0.9 };
      return { found: false, x: 0, y: 0, confidence: 0 };
    }),
  });
  const result = await switchLinkedRole(ctx as any, 'linked-to-main');
  expect(result).toBe('success');
  expect(ctx.taps).toContainEqual({ x: 320, y: 334 });
  expect(ctx.taps).not.toContainEqual({ x: 909, y: 334 });
});

test('找不到角色按钮：关闭设置与玩家页，返回 not_found', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) =>
      p === ICON_ROLE ? { found: false, x: 0, y: 0, confidence: 0.2 }
      : { found: false, x: 0, y: 0, confidence: 0 }),
  });
  const result = await switchLinkedRole(ctx as any, 'main-to-linked');
  expect(result).toBe('not_found');
  expect(ctx.taps).toContainEqual({ x: 1394, y: 55 });
  expect(ctx.taps).toContainEqual({ x: 1454, y: 88 });
  expect(ctx.taps).not.toContainEqual({ x: 1366, y: 105 });
  expect(ctx.taps).not.toContainEqual({ x: 909, y: 334 });
});

test('找不到确认登录：关闭角色管理、设置、玩家页，返回 not_found', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) =>
      p === ICON_ROLE ? { found: true, x: 200, y: 300, confidence: 0.9 }
      : p === BTN_SURELOGIN ? { found: false, x: 0, y: 0, confidence: 0.2 }
      : { found: false, x: 0, y: 0, confidence: 0 }),
  });
  const result = await switchLinkedRole(ctx as any, 'main-to-linked');
  expect(result).toBe('not_found');
  expect(ctx.taps).toContainEqual({ x: 909, y: 334 });
  expect(ctx.taps).toContainEqual({ x: 1366, y: 105 });
  expect(ctx.taps).toContainEqual({ x: 1394, y: 55 });
  expect(ctx.taps).toContainEqual({ x: 1454, y: 88 });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest plugins/rok/actions/switchLinkedRole.test.ts --runInBand`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

创建 `plugins/rok/actions/switchLinkedRole.ts`：

```ts
import * as path from 'path';
import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { waitForCityAfterLogin } from './switchAccount';
import { LinkedDirection } from './switchAccountKind';

export type SwitchLinkedRoleResult = 'success' | 'not_found' | 'switched_load_timeout';

const AVATAR_TAP = { x: 63, y: 51 };
const SETTINGS_BTN = { x: 1358, y: 743 };
const MAIN_CHAR_BTN = { x: 320, y: 334 };    // 主号在左
const LINKED_CHAR_BTN = { x: 909, y: 334 };  // 连体角色在右
const CLOSE_ROLE_BTN = { x: 1366, y: 105 };
const CLOSE_SETTINGS_BTN = { x: 1394, y: 55 };
const CLOSE_PLAYER_BTN = { x: 1454, y: 88 };

const SURELOGIN_SEARCH_REGION = { x: 864, y: 598, width: 1168 - 864, height: 680 - 598 };
const ICON_ROLE_TEMPLATE = path.join(getTemplatesDir(), 'icon_role.png');
const BTN_SURELOGIN_TEMPLATE = path.join(getTemplatesDir(), 'btn_surelogin.png');

/**
 * 连体号切换：头像 → 设置 → 角色管理 → 选目标角色 → 确认登录 → 等进城。
 * @param direction main-to-linked=主号切到连体角色(点右侧)；linked-to-main=连体切回主号(点左侧)。
 */
export async function switchLinkedRole(ctx: PluginContext, direction: LinkedDirection): Promise<SwitchLinkedRoleResult> {
  ctx.log(`=== 切换连体号角色 direction=${direction} ===`);

  ctx.log(`  [1/5] 点头像 (${AVATAR_TAP.x},${AVATAR_TAP.y})`);
  await ctx.tap(AVATAR_TAP.x, AVATAR_TAP.y);
  await ctx.sleep(0.5);

  ctx.log(`  [2/5] 点设置 (${SETTINGS_BTN.x},${SETTINGS_BTN.y})`);
  await ctx.tap(SETTINGS_BTN.x, SETTINGS_BTN.y);
  await ctx.sleep(1);

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

  const target = direction === 'main-to-linked' ? LINKED_CHAR_BTN : MAIN_CHAR_BTN;
  ctx.log(`  [4/5] 点${direction === 'main-to-linked' ? '连体角色(右)' : '主号(左)'} (${target.x},${target.y})`);
  await ctx.tap(target.x, target.y);
  await ctx.sleep(1);

  const sureLogin = await ctx.findImageWithLocation(
    BTN_SURELOGIN_TEMPLATE, 0.7, undefined, undefined, undefined, SURELOGIN_SEARCH_REGION,
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

注意 `findImageWithLocation` 第 6 个参数为搜索区域 `{ x, y, width, height }`。

- [ ] **Step 4: 运行确认通过**

Run: `npx jest plugins/rok/actions/switchLinkedRole.test.ts --runInBand`
Expected: PASS（4 个测试）。

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 6: Commit**

```bash
git add plugins/rok/actions/switchLinkedRole.ts plugins/rok/actions/switchLinkedRole.test.ts
git commit -m "feat(plugin): add switchLinkedRole for 连体号 character switch"
```

---

## Task 5: switch-account action 接入决策

**Files:**
- Modify: `plugins/rok/index.ts`

- [ ] **Step 1: 加 import**

搜索 `import { switchAccount } from './actions/switchAccount';`，在其下加：

```ts
import { switchLinkedRole } from './actions/switchLinkedRole';
import { resolveSwitchKind } from './actions/switchAccountKind';
```

- [ ] **Step 2: 替换 action**

把 `plugins/rok/index.ts` 中 `id: 'switch-account'` 的 action（约 934-947 行）整体替换为：

```ts
    {
      id: 'switch-account',
      name: '切换账号',
      description: '切换游戏账号，或在同一账号下切换连体号角色',
      run: async (ctx, params) => {
        const currentName = (params?.currentName as string) ?? '';
        const currentType = ((params?.currentType as 'account' | 'linked') ?? 'account');
        const targetName = (params?.targetName as string) ?? '';
        const targetType = ((params?.targetType as 'account' | 'linked') ?? 'account');

        const decision = resolveSwitchKind({ currentName, currentType, targetName, targetType });
        let result: string;
        if (decision.kind === 'linked') {
          result = await switchLinkedRole(ctx, decision.direction);
        } else {
          if (!targetName) {
            ctx.log('❌ 未提供 targetName');
            return;
          }
          result = await switchAccount(ctx, targetName);
        }
        ctx.log(`切换账号: ${result}`);
      }
    },
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add plugins/rok/index.ts
git commit -m "feat(plugin): route switch-account by resolveSwitchKind"
```

---

## Task 6: 配置页账号类型选择

**Files:**
- Modify: `web/src/pages/Config.tsx`

连体号也填编号，不禁用输入框。

- [ ] **Step 1: 加 state**

在 `Config.tsx:43` `const [accountSwitchName, setAccountSwitchName] ...` 下加：

```ts
  const [accountTargetType, setAccountTargetType] = useState<'account' | 'linked'>('account');
```

- [ ] **Step 2: 加载读取 targetType**

在 `loadConfig`（约 62 行）和 `switchConfig`（约 93 行）读取 accountName 的同一处增加：

```ts
        setAccountTargetType((res.config as any).accountSwitch?.targetType ?? 'account');
```

即两处 `setAccountSwitchName(...)` 之后各加一行上面的 `setAccountTargetType(...)`。

- [ ] **Step 3: 保存带上 targetType**

把 `autoSave`（约 178 行）中的：

```ts
      await api.config.saveRokConfig(currentAccountId, { buildingPositions: bp, accountSwitch: { accountName: accountSwitchName } } as any, configName);
```

替换为：

```ts
      await api.config.saveRokConfig(currentAccountId, { buildingPositions: bp, accountSwitch: { accountName: accountSwitchName, targetType: accountTargetType } } as any, configName);
```

- [ ] **Step 4: UI 加类型选择（编号输入保持可用）**

把当前"账号编号"那一行（约 368-377 行）：

```tsx
        {/* 账号编号（与配置同一行） */}
        <label className="text-sm text-slate-600 whitespace-nowrap ml-2">账号编号:</label>
        <input
          type="text"
          value={accountSwitchName}
          onChange={(e) => setAccountSwitchName(e.target.value)}
          onBlur={() => autoSave(buildingPositions)}
          placeholder="请输入"
          className="px-2 py-1 text-sm border border-slate-300 rounded w-40"
        />
```

替换为：

```tsx
        {/* 账号类型 + 账号编号（与配置同一行） */}
        <label className="text-sm text-slate-600 whitespace-nowrap ml-2">类型:</label>
        <select
          value={accountTargetType}
          onChange={(e) => {
            setAccountTargetType(e.target.value as 'account' | 'linked');
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
          placeholder={accountTargetType === 'linked' ? '填主号相同的编号' : '请输入'}
          className="px-2 py-1 text-sm border border-slate-300 rounded w-40"
        />
```

- [ ] **Step 5: 前端构建类型检查**

Run: `cd web && npm run build`
Expected: tsc + Vite 构建成功。

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Config.tsx
git commit -m "feat(web): add account type selector in Config page"
```

---

## Task 7: Home.tsx 缓存 targetType、调度传参、槽位 UI 规则

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 加 targetType 缓存 state**

搜索 `const [profileAccountNames`，在其下加：

```ts
  const [profileTargetTypes, setProfileTargetTypes] = useState<Record<string, 'account' | 'linked'>>({});
```

- [ ] **Step 2: 两处加载 profile 时填充 typeMap**

第一处约 608-616 行，第二处约 631-638 行，两处都把：

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
              typeMap[p] = (cfg.config as any)?.accountSwitch?.targetType === 'linked' ? 'linked' : 'account';
            } catch { map[p] = ''; typeMap[p] = 'account'; }
          }));
          setProfileAccountNames(map);
          setProfileTargetTypes(typeMap);
```

- [ ] **Step 3: accountSwitchLoop 传 current/target 参数**

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
            const targetName = ((cfgRes.config as any)?.accountSwitch?.accountName || '').trim();
            const currentName = (profileAccountNames[activeConfigName] || '').trim();
            const currentType: 'account' | 'linked' = profileTargetTypes[activeConfigName] ?? 'account';
            if (targetType === 'account' && !targetName) {
              pushLog(`⚠️ profile "${nextProfile}" 未填账号编号，跳过`);
              switchTargetIdx = (switchTargetIdx + 1) % validIds.length;
            } else {
              let ok = false;
              for (let attempt = 1; attempt <= 2 && !isStopped(); attempt++) {
                const cr = await createTask(currentAccountId, 'com.rok.automation', 'switch-account', {
                  currentName, currentType, targetName, targetType,
                });
```

说明：`activeConfigName`、`profileAccountNames`、`profileTargetTypes` 在该循环作用域可见（若 TS 提示闭包取值问题，改用对应的 ref：`activeConfigNameRef.current` 替代 `activeConfigName`）。其余重试与成功判定逻辑不动。

- [ ] **Step 4: 槽位 option 禁用规则与文本**

把约 2649-2656 行：

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
                                const accName = (profileAccountNames[p] || '').trim();
                                const hasAccount = isLinked || !!accName;
                                // 规则1：相邻槽位不能都是连体号（环形，2 槽互为邻居）
                                const prevIdx = (i - 1 + MAX_SWITCH_SLOTS) % MAX_SWITCH_SLOTS;
                                const nextIdx = (i + 1) % MAX_SWITCH_SLOTS;
                                const neighborLinked = [prevIdx, nextIdx].some(j => {
                                  const np = ids[j];
                                  return np && np !== p && profileTargetTypes[np] === 'linked';
                                });
                                // 规则3：连体号必须有同编号的常规主号被选中
                                const hasLinkedMaster = !isLinked || ids.some(sp =>
                                  !!sp && sp !== p &&
                                  profileTargetTypes[sp] === 'account' &&
                                  (profileAccountNames[sp] || '').trim() === accName
                                );
                                const disabled = !hasAccount || (isLinked && (neighborLinked || !hasLinkedMaster));
                                let suffix = '';
                                if (isLinked) suffix = '（连体）';
                                else if (!accName) suffix = '（未填编号）';
                                return (
                                  <option key={p} value={p} disabled={disabled}>
                                    {p}{suffix}
                                  </option>
                                );
                              })}
```

注意：这里 `ids` 是该 IIFE 内的数组，`i` 是 map 的索引；`MAX_SWITCH_SLOTS`、`profileAccountNames`、`profileTargetTypes`、`configNames` 均在作用域内。

- [ ] **Step 5: 槽位卡片"连体"角标**

把约 2631-2636 行：

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

- [ ] **Step 6: tooltip 补说明**

搜索文案"在两个账号配置方案之间自动切换"（约 2550、2573 行两处），在"组合采集"说明后补一句：

```
连体号：在同一游戏账号的主号与连体角色间切换（配置页把类型设为"连体号"并填主号编号）；触发时机仍由上方模式决定。
```

两处都补。

- [ ] **Step 7: 前端构建**

Run: `cd web && npm run build`
Expected: tsc + Vite 构建成功。若 `activeConfigName` 在 accountSwitchLoop 闭包中报"引用值可能陈旧"，改用 `activeConfigNameRef.current`。

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(web): support linked-role switch in schedule loop and slot UI rules"
```

---

## Task 8: 全量验证

- [ ] **Step 1: 相关后端测试**

Run: `npx jest plugins/rok/actions/switchAccountKind.test.ts plugins/rok/actions/switchLinkedRole.test.ts --runInBand`
Expected: 全部 PASS。

- [ ] **Step 2: 根类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 3: 前端构建**

Run: `cd web && npm run build`
Expected: 成功。

- [ ] **Step 4: 手动验证（真机/模拟器）**

1. 配置页：建主号 profile（类型常规，编号 N）、连体号 profile（类型连体号，编号 N）。确认连体号编号框可编辑且提示"填主号相同的编号"。
2. 账号调度卡片选两槽：主号 + 连体号。确认连体号槽位有紫色"连体"角标、option 带"（连体）"。
3. UI 规则验证：
   - 尝试在相邻槽位选第二个连体号 → 该 option 被禁用。
   - 连体号在没有同编号主号被选中时 → 被禁用。
4. 按时间轮换设 1 分钟开启：
   - 主号→连体：日志出现 `=== 切换连体号角色 direction=main-to-linked ===`，第 4 步点右侧 (909,334)，成功后 `切换账号: success`，激活连体 profile。
   - 连体→主号：`direction=linked-to-main`，第 4 步点左侧 (320,334)，成功切回。
5. 选一个编号不同的常规 profile 作为目标，确认走 OCR 流程（`=== 切换账号 target=... ===`）。
6. 异常：在没有角色管理的界面触发连体切换，确认返回 `not_found`、关闭弹窗、不推进 profile。

---

## Self-Review 结论

- **Spec 覆盖**：targetType 模型(Task1)、进城函数(Task2)、决策表(Task3)、连体流程双方向(Task4)、action 接线(Task5)、配置页连体仍填编号(Task6)、调度传 current/target(Task7 Step3)、UI 三条禁用规则(Task7 Step4)、连体角标(Task7 Step5)、tooltip(Task7 Step6)、失败关闭弹窗(Task4 测试/实现)、测试(Task3/4/8)均覆盖。
- **类型/命名一致**：`targetType`、`resolveSwitchKind`、`direction: 'main-to-linked'|'linked-to-main'`、task 参数 `{currentName,currentType,targetName,targetType}` 在前后端统一；主号左 (320,334)、连体右 (909,334) 全文一致。
- **占位符**：无 TBD/TODO，代码步骤完整。
