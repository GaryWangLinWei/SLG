# 切号机制重设计实施计划（星标位置式角色切换 + 类型自动推导）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让同一游戏账号下的 N 个角色都能参与自动切号轮换，切号类型由系统从切号列表自动推导，用户不再需要手动选择"常规账号/连体号"。

**Architecture:** 用户在游戏内给参与调度的角色加星标；每个配置方案（profile）只填「游戏账号编号」+ 可选「星标序号」。前端把切号列表按账号编号分组，组内 ≥2 个方案的判为 role 型，据此算出显式切换步骤（`accountSwitch` / `roleSwitch`）一次性传给后端单个 action 顺序执行。角色定位改为纯坐标 + 翻页（零 OCR），点击已激活角色时走"空操作"分支逐层关界面退出。

**Tech Stack:** TypeScript / React 18 / Vite；后端 Koa + ts-node；测试用根 Jest（`ts-jest`，roots 覆盖 `core` `plugins` `server` `electron` `web/src/utils`）。

**Spec:** `docs/superpowers/specs/2026-08-21-role-switch-starred-position-design.md`

**构建前提：** web 前端构建/类型检查必须带 edition 环境变量，否则 `web/vite.config.ts` 直接 throw：

```bash
cd web && VITE_APP_EDITION=main npm run build
```

本计划中所有写作 `cd web && npm run build` 的步骤都按此执行。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `web/src/utils/accountSwitchPlan.ts` | 纯逻辑：类型推导、槽位校验、切换步骤计算、环向索引推进 | 新建 |
| `web/src/utils/accountSwitchPlan.test.ts` | 上述纯逻辑的单测 | 新建 |
| `plugins/rok/actions/switchRole.ts` | 位置式角色切换 action（零 OCR，含空操作分支） | 新建 |
| `plugins/rok/actions/switchRole.test.ts` | 角色切换的坐标/翻页/空操作分支单测 | 新建 |
| `plugins/rok/actions/switchLinkedRole.ts` | 旧的双坐标连体切换 | 删除 |
| `plugins/rok/actions/switchLinkedRole.test.ts` | 旧测试 | 删除 |
| `plugins/rok/actions/switchAccountKind.ts` | 旧的隐式方式推断 | 删除 |
| `plugins/rok/actions/switchAccountKind.test.ts` | 旧测试 | 删除 |
| `plugins/rok/actions/switchAccount.ts` | 账号切换（OCR 下拉）+ `waitForCityAfterLogin` | 不改 |
| `plugins/rok/index.ts` | `RokConfig.accountSwitch` 字段、`switch-account` action 参数与编排 | 修改 |
| `plugins/rok/homeFeatures.ts` | `switchIntervalMinutes` 类型统一为 `number[]` | 修改 |
| `web/src/pages/Config.tsx` | 删类型下拉、加星标序号输入 | 修改 |
| `web/src/pages/Home.tsx` | profile 元信息加载去重、槽位 UI 校验、切号循环改用步骤、环向推进 | 修改 |

**为什么纯逻辑放 `web/src/utils/`：** 根 `jest.config.js` 的 `roots` 已包含 `<rootDir>/web/src/utils`，放这里可直接用 `npx jest` 测；`web/vitest.config.ts` 的 `include` 是白名单（只 3 个文件），不要改它。

---

## Task 1: 纯逻辑模块——类型推导

**Files:**
- Create: `web/src/utils/accountSwitchPlan.ts`
- Test: `web/src/utils/accountSwitchPlan.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/utils/accountSwitchPlan.test.ts`：

```ts
import { deriveProfileKinds } from './accountSwitchPlan';

describe('deriveProfileKinds', () => {
  test('账号编号只出现一次 → account 型', () => {
    const kinds = deriveProfileKinds([
      { name: 'P1', accountName: '1001' },
      { name: 'P2', accountName: '1002' },
    ]);
    expect(kinds).toEqual({ P1: 'account', P2: 'account' });
  });

  test('同一账号编号出现两次 → 都是 role 型', () => {
    const kinds = deriveProfileKinds([
      { name: 'A', accountName: '1001' },
      { name: 'B1', accountName: '1002', starredIndex: 1 },
      { name: 'B2', accountName: '1002', starredIndex: 2 },
    ]);
    expect(kinds).toEqual({ A: 'account', B1: 'role', B2: 'role' });
  });

  test('账号编号首尾空格不影响分组', () => {
    const kinds = deriveProfileKinds([
      { name: 'B1', accountName: ' 1002 ', starredIndex: 1 },
      { name: 'B2', accountName: '1002', starredIndex: 2 },
    ]);
    expect(kinds).toEqual({ B1: 'role', B2: 'role' });
  });

  test('账号编号为空的 profile 不参与分组，判为 account 型', () => {
    const kinds = deriveProfileKinds([
      { name: 'X', accountName: '' },
      { name: 'Y', accountName: '   ' },
    ]);
    expect(kinds).toEqual({ X: 'account', Y: 'account' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest web/src/utils/accountSwitchPlan.test.ts --runInBand`
Expected: FAIL，报 `Cannot find module './accountSwitchPlan'`

- [ ] **Step 3: 写最小实现**

创建 `web/src/utils/accountSwitchPlan.ts`：

```ts
/**
 * 账号调度的纯逻辑：类型推导、槽位校验、切换步骤计算、环向索引推进。
 *
 * 设计要点：profile 不存储"类型"字段，类型完全由切号列表里的账号编号分组推导——
 * 某账号编号只出现 1 次 → account 型（只切账号，落点即正确角色）；
 * 出现 ≥2 次 → role 型（这些方案是同一账号下的不同角色，必须靠星标序号区分）。
 */

export type ProfileKind = 'account' | 'role';

export interface ProfileSwitchMeta {
  /** profile（配置方案）名 */
  name: string;
  /** 游戏账号编号 */
  accountName: string;
  /** 星标序号（1 开始），仅 role 型需要 */
  starredIndex?: number;
}

/** 按账号编号分组推导每个 profile 的类型。 */
export function deriveProfileKinds(profiles: ProfileSwitchMeta[]): Record<string, ProfileKind> {
  const countByAccount = new Map<string, number>();
  for (const p of profiles) {
    const acc = (p.accountName || '').trim();
    if (!acc) continue;
    countByAccount.set(acc, (countByAccount.get(acc) ?? 0) + 1);
  }
  const out: Record<string, ProfileKind> = {};
  for (const p of profiles) {
    const acc = (p.accountName || '').trim();
    out[p.name] = acc && (countByAccount.get(acc) ?? 0) >= 2 ? 'role' : 'account';
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest web/src/utils/accountSwitchPlan.test.ts --runInBand`
Expected: PASS，4 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add web/src/utils/accountSwitchPlan.ts web/src/utils/accountSwitchPlan.test.ts
git commit -m "feat(switch): derive profile kind from account grouping"
```

---

## Task 2: 纯逻辑模块——槽位校验

**Files:**
- Modify: `web/src/utils/accountSwitchPlan.ts`
- Test: `web/src/utils/accountSwitchPlan.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/utils/accountSwitchPlan.test.ts` 末尾追加（同时把顶部 import 改为 `import { deriveProfileKinds, validateSwitchProfiles } from './accountSwitchPlan';`）：

```ts
describe('validateSwitchProfiles', () => {
  test('全部合法时返回空数组', () => {
    expect(validateSwitchProfiles([
      { name: 'A', accountName: '1001' },
      { name: 'B1', accountName: '1002', starredIndex: 1 },
      { name: 'B2', accountName: '1002', starredIndex: 2 },
    ])).toEqual([]);
  });

  test('未填账号编号 → no-account', () => {
    expect(validateSwitchProfiles([
      { name: 'A', accountName: '' },
      { name: 'B', accountName: '1002' },
    ])).toEqual([{ profileName: 'A', reason: 'no-account' }]);
  });

  test('role 型缺星标序号 → missing-starred-index', () => {
    expect(validateSwitchProfiles([
      { name: 'B1', accountName: '1002', starredIndex: 1 },
      { name: 'B2', accountName: '1002' },
    ])).toEqual([{ profileName: 'B2', reason: 'missing-starred-index' }]);
  });

  test('role 型星标序号重复 → 两者都报 duplicate-starred-index', () => {
    expect(validateSwitchProfiles([
      { name: 'B1', accountName: '1002', starredIndex: 3 },
      { name: 'B2', accountName: '1002', starredIndex: 3 },
    ])).toEqual([
      { profileName: 'B1', reason: 'duplicate-starred-index' },
      { profileName: 'B2', reason: 'duplicate-starred-index' },
    ]);
  });

  test('星标序号非正整数 → invalid-starred-index', () => {
    expect(validateSwitchProfiles([
      { name: 'B1', accountName: '1002', starredIndex: 0 },
      { name: 'B2', accountName: '1002', starredIndex: 2 },
    ])).toEqual([{ profileName: 'B1', reason: 'invalid-starred-index' }]);
  });

  test('account 型填了星标序号也不报错（忽略）', () => {
    expect(validateSwitchProfiles([
      { name: 'A', accountName: '1001', starredIndex: 9 },
      { name: 'B', accountName: '1002' },
    ])).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest web/src/utils/accountSwitchPlan.test.ts --runInBand`
Expected: FAIL，报 `validateSwitchProfiles is not a function`

- [ ] **Step 3: 写最小实现**

在 `web/src/utils/accountSwitchPlan.ts` 末尾追加：

```ts
export type SlotIssueReason =
  | 'no-account'
  | 'missing-starred-index'
  | 'invalid-starred-index'
  | 'duplicate-starred-index';

export interface SlotIssue {
  profileName: string;
  reason: SlotIssueReason;
}

/**
 * 校验切号列表：account 型只要求填了账号编号；
 * role 型（同账号多方案）额外要求星标序号为正整数且组内互不相同。
 */
export function validateSwitchProfiles(profiles: ProfileSwitchMeta[]): SlotIssue[] {
  const kinds = deriveProfileKinds(profiles);
  const issues: SlotIssue[] = [];

  // 先算出每个账号组里重复的星标序号
  const dupIndexesByAccount = new Map<string, Set<number>>();
  const seenByAccount = new Map<string, Set<number>>();
  for (const p of profiles) {
    const acc = (p.accountName || '').trim();
    if (!acc || kinds[p.name] !== 'role') continue;
    if (typeof p.starredIndex !== 'number' || !Number.isInteger(p.starredIndex) || p.starredIndex < 1) continue;
    const seen = seenByAccount.get(acc) ?? new Set<number>();
    if (seen.has(p.starredIndex)) {
      const dup = dupIndexesByAccount.get(acc) ?? new Set<number>();
      dup.add(p.starredIndex);
      dupIndexesByAccount.set(acc, dup);
    }
    seen.add(p.starredIndex);
    seenByAccount.set(acc, seen);
  }

  for (const p of profiles) {
    const acc = (p.accountName || '').trim();
    if (!acc) {
      issues.push({ profileName: p.name, reason: 'no-account' });
      continue;
    }
    if (kinds[p.name] !== 'role') continue;
    if (p.starredIndex === undefined || p.starredIndex === null) {
      issues.push({ profileName: p.name, reason: 'missing-starred-index' });
      continue;
    }
    if (!Number.isInteger(p.starredIndex) || p.starredIndex < 1) {
      issues.push({ profileName: p.name, reason: 'invalid-starred-index' });
      continue;
    }
    if (dupIndexesByAccount.get(acc)?.has(p.starredIndex)) {
      issues.push({ profileName: p.name, reason: 'duplicate-starred-index' });
    }
  }
  return issues;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest web/src/utils/accountSwitchPlan.test.ts --runInBand`
Expected: PASS，10 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add web/src/utils/accountSwitchPlan.ts web/src/utils/accountSwitchPlan.test.ts
git commit -m "feat(switch): validate switch slots for starred index"
```

---

## Task 3: 纯逻辑模块——切换步骤与环向推进

**Files:**
- Modify: `web/src/utils/accountSwitchPlan.ts`
- Test: `web/src/utils/accountSwitchPlan.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/src/utils/accountSwitchPlan.test.ts` 末尾追加（顶部 import 改为 `import { buildSwitchSteps, deriveProfileKinds, nextSwitchTargetIdx, validateSwitchProfiles } from './accountSwitchPlan';`）：

```ts
describe('buildSwitchSteps', () => {
  const A = { name: 'A', accountName: '1001' };
  const B1 = { name: 'B1', accountName: '1002', starredIndex: 1 };
  const B2 = { name: 'B2', accountName: '1002', starredIndex: 2 };
  const all = [A, B1, B2];

  test('A → B1（跨账号 role 型）：先切账号再切角色', () => {
    expect(buildSwitchSteps(A, B1, all)).toEqual({
      accountSwitch: { accountName: '1002' },
      roleSwitch: { starredIndex: 1 },
    });
  });

  test('B1 → B2（同账号 role 型）：只切角色', () => {
    expect(buildSwitchSteps(B1, B2, all)).toEqual({
      roleSwitch: { starredIndex: 2 },
    });
  });

  test('B2 → A（目标 account 型）：只切账号', () => {
    expect(buildSwitchSteps(B2, A, all)).toEqual({
      accountSwitch: { accountName: '1001' },
    });
  });

  test('目标 role 型且账号相同也总是带 roleSwitch（切账号无法选落点，必须补切）', () => {
    const steps = buildSwitchSteps(B2, B1, all);
    expect(steps.accountSwitch).toBeUndefined();
    expect(steps.roleSwitch).toEqual({ starredIndex: 1 });
  });

  test('当前 profile 未知（首轮无 active）：role 型给出完整两步', () => {
    expect(buildSwitchSteps(undefined, B1, all)).toEqual({
      accountSwitch: { accountName: '1002' },
      roleSwitch: { starredIndex: 1 },
    });
  });

  test('两个 account 型同账号编号不会发生（分组即 role），跨账号 account 型只切账号', () => {
    const C = { name: 'C', accountName: '1003' };
    expect(buildSwitchSteps(A, C, [A, C])).toEqual({
      accountSwitch: { accountName: '1003' },
    });
  });
});

describe('nextSwitchTargetIdx', () => {
  test('环向推进到下一格', () => {
    expect(nextSwitchTargetIdx(['A', 'B', 'C'], 'A')).toBe(1);
    expect(nextSwitchTargetIdx(['A', 'B', 'C'], 'B')).toBe(2);
  });

  test('最后一格回绕到 0', () => {
    expect(nextSwitchTargetIdx(['A', 'B', 'C'], 'C')).toBe(0);
  });

  test('当前 active 不在列表里 → 0', () => {
    expect(nextSwitchTargetIdx(['A', 'B'], 'Z')).toBe(0);
  });

  test('空列表 → 0', () => {
    expect(nextSwitchTargetIdx([], 'A')).toBe(0);
  });

  test('四槽轮换完整走一圈', () => {
    const ids = ['A', 'B1', 'B2', 'C'];
    expect(nextSwitchTargetIdx(ids, 'A')).toBe(1);
    expect(nextSwitchTargetIdx(ids, 'B1')).toBe(2);
    expect(nextSwitchTargetIdx(ids, 'B2')).toBe(3);
    expect(nextSwitchTargetIdx(ids, 'C')).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest web/src/utils/accountSwitchPlan.test.ts --runInBand`
Expected: FAIL，报 `buildSwitchSteps is not a function`

- [ ] **Step 3: 写最小实现**

在 `web/src/utils/accountSwitchPlan.ts` 末尾追加：

```ts
export interface SwitchSteps {
  /** 目标账号与当前不同时存在 */
  accountSwitch?: { accountName: string };
  /** 目标是 role 型时总是存在 */
  roleSwitch?: { starredIndex: number };
}

/**
 * 算出从 current 切到 target 需要的显式步骤。
 *
 * 规则（与 spec 2.3 一致）：
 * - 目标 account 型 → 只切账号（切过去落点即正确角色）。
 * - 目标 role 型 → 账号不同则先切账号；然后**总是**位置切角色。
 *   "总是"是必需的：切账号只会落在该账号最近使用的角色上，
 *   而轮换每轮结束时该账号的最近使用角色都不是下一轮的目标。
 */
export function buildSwitchSteps(
  current: ProfileSwitchMeta | undefined,
  target: ProfileSwitchMeta,
  profiles: ProfileSwitchMeta[],
): SwitchSteps {
  const kinds = deriveProfileKinds(profiles);
  const targetAcc = (target.accountName || '').trim();
  const currentAcc = (current?.accountName || '').trim();
  const steps: SwitchSteps = {};

  if (!currentAcc || currentAcc !== targetAcc) {
    steps.accountSwitch = { accountName: targetAcc };
  }
  if (kinds[target.name] === 'role' && typeof target.starredIndex === 'number') {
    steps.roleSwitch = { starredIndex: target.starredIndex };
  }
  return steps;
}

/**
 * 环向推进切号目标索引：返回 active 在 validIds 中的下一格。
 * 替代旧的 `findIndex(x => x !== nextProfile)`——那个写法只在恰好 2 个
 * 有效 profile 时正确，3+ 槽位时会跳到任意非当前项，轮换顺序不确定。
 */
export function nextSwitchTargetIdx(validIds: string[], activeName: string): number {
  if (validIds.length === 0) return 0;
  const idx = validIds.indexOf(activeName);
  if (idx < 0) return 0;
  return (idx + 1) % validIds.length;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest web/src/utils/accountSwitchPlan.test.ts --runInBand`
Expected: PASS，21 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add web/src/utils/accountSwitchPlan.ts web/src/utils/accountSwitchPlan.test.ts
git commit -m "feat(switch): build explicit switch steps and ring target advance"
```

---

## Task 4: 位置式角色切换 action

**Files:**
- Create: `plugins/rok/actions/switchRole.ts`
- Test: `plugins/rok/actions/switchRole.test.ts`

**背景：** 角色管理界面是 2 列 × 3 行 = 每屏 6 个格子的可滚动网格，星标区钉在列表顶部且按添加顺序排列不重排。旧实现 `switchLinkedRole.ts` 只认第一行左右两格（(320,334) / (909,334)），因此只能支持 2 个角色。

坐标表（1600×900，列沿用旧实现已验证的 x=320 / x=909，行间距 168px）：

| 位置 | 坐标 |
|---|---|
| 1 | (320, 334) |
| 2 | (909, 334) |
| 3 | (320, 502) |
| 4 | (909, 502) |
| 5 | (320, 670) |
| 6 | (909, 670) |

- [ ] **Step 1: 写失败测试**

创建 `plugins/rok/actions/switchRole.test.ts`：

```ts
import * as path from 'path';
import { switchRole } from './switchRole';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as locationUtil from '../utils/location';

jest.mock('../utils/location', () => ({ getCurrentLocation: jest.fn() }));

function makeCtx(overrides: Partial<any> = {}): any {
  const taps: Array<{ x: number; y: number }> = [];
  const swipes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const ctx = {
    taps,
    swipes,
    sleep: jest.fn(async () => {}),
    tap: jest.fn(async (x: number, y: number) => { taps.push({ x, y }); }),
    swipe: jest.fn(async (x1: number, y1: number, x2: number, y2: number) => { swipes.push({ x1, y1, x2, y2 }); }),
    log: jest.fn(),
    findImageWithLocation: jest.fn(),
    ...overrides,
  };
  return ctx;
}

const ICON_ROLE = path.join(getTemplatesDir(), 'icon_role.png');
const BTN_SURELOGIN = path.join(getTemplatesDir(), 'btn_surelogin.png');

/** 角色图标找到、确认登录也找到（真实切换成功路径） */
function findAllOk() {
  return jest.fn(async (p: string) => {
    if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
    if (p === BTN_SURELOGIN) return { found: true, x: 1000, y: 640, confidence: 0.9 };
    return { found: false, x: 0, y: 0, confidence: 0 };
  });
}

beforeEach(() => { (locationUtil.getCurrentLocation as jest.Mock).mockResolvedValue('city'); });

test('starredIndex=1 点第 1 号位 (320,334)，不翻页', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  const result = await switchRole(ctx as any, 1);
  expect(result).toBe('success');
  expect(ctx.taps).toContainEqual({ x: 320, y: 334 });
  // 只有归顶的下滑，没有向上翻页
  expect(ctx.swipes.every((s: any) => s.y2 > s.y1)).toBe(true);
});

test('starredIndex=4 点第 4 号位 (909,502)', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  const result = await switchRole(ctx as any, 4);
  expect(result).toBe('success');
  expect(ctx.taps).toContainEqual({ x: 909, y: 502 });
});

test('starredIndex=6 点第 6 号位 (320,670) —— 第 6 位是右列', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  const result = await switchRole(ctx as any, 6);
  expect(result).toBe('success');
  expect(ctx.taps).toContainEqual({ x: 909, y: 670 });
});

test('starredIndex=7 翻 1 页后点第 1 号位', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  const result = await switchRole(ctx as any, 7);
  expect(result).toBe('success');
  // 有向上滑（翻页）动作：y2 < y1
  expect(ctx.swipes.some((s: any) => s.y2 < s.y1)).toBe(true);
  expect(ctx.taps).toContainEqual({ x: 320, y: 334 });
});

test('starredIndex=13 翻 2 页', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  const result = await switchRole(ctx as any, 13);
  expect(result).toBe('success');
  const pageUps = ctx.swipes.filter((s: any) => s.y2 < s.y1);
  expect(pageUps.length).toBe(2);
});

test('空操作分支：点击后没出现确认登录 → already_active，逐层关 3 个界面', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async (p: string) => {
      if (p === ICON_ROLE) return { found: true, x: 200, y: 300, confidence: 0.9 };
      if (p === BTN_SURELOGIN) return { found: false, x: 0, y: 0, confidence: 0.2 };
      return { found: false, x: 0, y: 0, confidence: 0 };
    }),
  });
  const result = await switchRole(ctx as any, 2);
  expect(result).toBe('already_active');
  expect(ctx.taps).toContainEqual({ x: 1366, y: 105 });   // 关角色管理
  expect(ctx.taps).toContainEqual({ x: 1394, y: 55 });    // 关设置
  expect(ctx.taps).toContainEqual({ x: 1454, y: 88 });    // 关玩家页
});

test('找不到角色管理入口：关设置与玩家页，返回 not_found', async () => {
  const ctx = makeCtx({
    findImageWithLocation: jest.fn(async () => ({ found: false, x: 0, y: 0, confidence: 0.1 })),
  });
  const result = await switchRole(ctx as any, 1);
  expect(result).toBe('not_found');
  expect(ctx.taps).toContainEqual({ x: 1394, y: 55 });
  expect(ctx.taps).toContainEqual({ x: 1454, y: 88 });
  expect(ctx.taps).not.toContainEqual({ x: 320, y: 334 });
});

test('starredIndex 非正整数 → invalid_index，不做任何点击', async () => {
  const ctx = makeCtx({ findImageWithLocation: findAllOk() });
  expect(await switchRole(ctx as any, 0)).toBe('invalid_index');
  expect(await switchRole(ctx as any, -1)).toBe('invalid_index');
  expect(await switchRole(ctx as any, 1.5)).toBe('invalid_index');
  expect(ctx.taps).toEqual([]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest plugins/rok/actions/switchRole.test.ts --runInBand`
Expected: FAIL，报 `Cannot find module './switchRole'`

- [ ] **Step 3: 写最小实现**

创建 `plugins/rok/actions/switchRole.ts`：

```ts
import * as path from 'path';
import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { waitForCityAfterLogin } from './switchAccount';

export type SwitchRoleResult =
  | 'success'
  | 'already_active'          // 目标角色已是当前角色，点击无效果
  | 'not_found'
  | 'invalid_index'
  | 'switched_load_timeout';

const AVATAR_TAP = { x: 63, y: 51 };
const SETTINGS_BTN = { x: 1358, y: 743 };
const CLOSE_ROLE_BTN = { x: 1366, y: 105 };
const CLOSE_SETTINGS_BTN = { x: 1394, y: 55 };
const CLOSE_PLAYER_BTN = { x: 1454, y: 88 };

/** 角色管理网格：2 列 × 3 行，每屏 6 格。列 x 沿用旧实现已验证值，行间距 168px。 */
const ROLE_SLOT_POS = [
  { x: 320, y: 334 }, { x: 909, y: 334 },
  { x: 320, y: 502 }, { x: 909, y: 502 },
  { x: 320, y: 670 }, { x: 909, y: 670 },
];
const PAGE_SIZE = ROLE_SLOT_POS.length;

/** 翻页滑动：一次推进 3 行 = 504px。singleShot 避免惯性滚动导致位移不可控。 */
const SWIPE_X = 800;
const PAGE_UP_FROM_Y = 700;
const PAGE_UP_TO_Y = PAGE_UP_FROM_Y - 504;
const SWIPE_DURATION_MS = 800;
/** 归顶：连续下滑若干次，保证起点归一化到列表顶部。 */
const SCROLL_TOP_TIMES = 3;

const SURELOGIN_SEARCH_REGION = { x: 864, y: 598, width: 1168 - 864, height: 680 - 598 };
const ICON_ROLE_TEMPLATE = path.join(getTemplatesDir(), 'icon_role.png');
const BTN_SURELOGIN_TEMPLATE = path.join(getTemplatesDir(), 'btn_surelogin.png');

/**
 * 位置式角色切换：头像 → 设置 → 角色管理 → 归顶 → 按需翻页 → 点目标星标位 → 确认登录 → 等进城。
 *
 * 零 OCR：角色名可自定义（含繁体、符号）不可靠，服务器号同服可重复；
 * 星标区按添加顺序排列且不重排，因此星标序号是稳定索引。
 *
 * @param starredIndex 星标列表中的序号，从 1 开始。
 */
export async function switchRole(ctx: PluginContext, starredIndex: number): Promise<SwitchRoleResult> {
  ctx.log(`=== 切换角色 starredIndex=${starredIndex} ===`);

  if (!Number.isInteger(starredIndex) || starredIndex < 1) {
    ctx.log(`  ❌ 星标序号非法: ${starredIndex}`);
    return 'invalid_index';
  }

  ctx.log(`  [1/6] 点头像 (${AVATAR_TAP.x},${AVATAR_TAP.y})`);
  await ctx.tap(AVATAR_TAP.x, AVATAR_TAP.y);
  await ctx.sleep(0.5);

  ctx.log(`  [2/6] 点设置 (${SETTINGS_BTN.x},${SETTINGS_BTN.y})`);
  await ctx.tap(SETTINGS_BTN.x, SETTINGS_BTN.y);
  await ctx.sleep(1);

  const roleIcon = await ctx.findImageWithLocation(ICON_ROLE_TEMPLATE, 0.75);
  ctx.log(`  [3/6] icon_role.png found=${roleIcon.found} conf=${roleIcon.confidence.toFixed(3)}`);
  if (!roleIcon.found) {
    ctx.log(`  ❌ 未找到角色管理入口，关闭设置和玩家页后结束`);
    await ctx.tap(CLOSE_SETTINGS_BTN.x, CLOSE_SETTINGS_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_PLAYER_BTN.x, CLOSE_PLAYER_BTN.y);
    return 'not_found';
  }
  await ctx.tap(roleIcon.x, roleIcon.y);
  await ctx.sleep(1);

  // 归顶：起点归一化，否则翻页数无意义
  ctx.log(`  [4/6] 归顶（下滑 ${SCROLL_TOP_TIMES} 次）`);
  for (let i = 0; i < SCROLL_TOP_TIMES; i++) {
    await ctx.swipe(SWIPE_X, PAGE_UP_TO_Y, SWIPE_X, PAGE_UP_FROM_Y, SWIPE_DURATION_MS, false, true);
    await ctx.sleep(0.4);
  }

  const pageIdx = Math.floor((starredIndex - 1) / PAGE_SIZE);
  const slotIdx = (starredIndex - 1) % PAGE_SIZE;
  if (pageIdx > 0) {
    ctx.log(`  [5/6] 向下翻 ${pageIdx} 页`);
    for (let i = 0; i < pageIdx; i++) {
      await ctx.swipe(SWIPE_X, PAGE_UP_FROM_Y, SWIPE_X, PAGE_UP_TO_Y, SWIPE_DURATION_MS, false, true);
      await ctx.sleep(0.5);
    }
  }

  const target = ROLE_SLOT_POS[slotIdx];
  ctx.log(`  [5/6] 点第 ${slotIdx + 1} 号位 (${target.x},${target.y})`);
  await ctx.tap(target.x, target.y);
  await ctx.sleep(1.5);

  const sureLogin = await ctx.findImageWithLocation(
    BTN_SURELOGIN_TEMPLATE, 0.7, undefined, undefined, undefined, SURELOGIN_SEARCH_REGION,
  );
  ctx.log(`  [6/6] btn_surelogin.png found=${sureLogin.found} conf=${sureLogin.confidence.toFixed(3)}`);
  if (!sureLogin.found) {
    // 点击当前已激活的角色不会重新登录，界面原地不动 —— 判定已在目标角色，
    // 逐层关掉打开的 3 个界面回城，报 already_active（调用方视作成功）。
    ctx.log(`  ℹ️ 未出现确认登录，判定已在目标角色，关闭角色管理/设置/玩家页`);
    await ctx.tap(CLOSE_ROLE_BTN.x, CLOSE_ROLE_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_SETTINGS_BTN.x, CLOSE_SETTINGS_BTN.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_PLAYER_BTN.x, CLOSE_PLAYER_BTN.y);
    return 'already_active';
  }

  ctx.log(`  [6/6] 点确认登录 (${sureLogin.x},${sureLogin.y})`);
  await ctx.tap(sureLogin.x, sureLogin.y);
  return await waitForCityAfterLogin(ctx);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest plugins/rok/actions/switchRole.test.ts --runInBand`
Expected: PASS，8 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add plugins/rok/actions/switchRole.ts plugins/rok/actions/switchRole.test.ts
git commit -m "feat(switch): position-based role switch with no-op branch"
```

---

## Task 5: 删除旧的连体切换与方式推断

**Files:**
- Delete: `plugins/rok/actions/switchLinkedRole.ts`
- Delete: `plugins/rok/actions/switchLinkedRole.test.ts`
- Delete: `plugins/rok/actions/switchAccountKind.ts`
- Delete: `plugins/rok/actions/switchAccountKind.test.ts`

- [ ] **Step 1: 确认引用点只剩 index.ts**

Run: `grep -rn "switchLinkedRole\|switchAccountKind\|LinkedDirection" plugins core server electron web/src`
Expected: 只出现在 `plugins/rok/index.ts:33,34,984` 以及即将删除的 4 个文件里。若还有其他引用点，先处理那些引用再继续。

- [ ] **Step 2: 删除 4 个文件**

```bash
git rm plugins/rok/actions/switchLinkedRole.ts plugins/rok/actions/switchLinkedRole.test.ts plugins/rok/actions/switchAccountKind.ts plugins/rok/actions/switchAccountKind.test.ts
```

- [ ] **Step 3: 确认类型检查报错只来自 index.ts**

Run: `npx tsc --noEmit`
Expected: FAIL，报错集中在 `plugins/rok/index.ts`（找不到 `./actions/switchLinkedRole`、`./actions/switchAccountKind`）。Task 6 修掉。

- [ ] **Step 4: 暂不提交**

留到 Task 6 与 index.ts 改动一起提交，避免中间状态编译不过。

---

## Task 6: index.ts —— 配置字段与 action 编排

**Files:**
- Modify: `plugins/rok/index.ts:33-34`（import）
- Modify: `plugins/rok/index.ts:176-179`（`RokConfig.accountSwitch` 类型）
- Modify: `plugins/rok/index.ts:328-331`（`DEFAULT_ROK_CONFIG.accountSwitch`）
- Modify: `plugins/rok/index.ts:971-994`（`switch-account` action）

- [ ] **Step 1: 换 import**

把 `plugins/rok/index.ts:33-34` 这两行：

```ts
import { switchLinkedRole } from './actions/switchLinkedRole';
import { resolveSwitchKind } from './actions/switchAccountKind';
```

替换为：

```ts
import { switchRole } from './actions/switchRole';
```

- [ ] **Step 2: 改 `RokConfig.accountSwitch` 类型**

把 `plugins/rok/index.ts:176-179`：

```ts
  accountSwitch: {
    accountName: string;   // 账号编号，连体号填主号相同的编号
    targetType: 'account' | 'linked';  // account=常规主号，linked=连体号
  };
```

替换为：

```ts
  accountSwitch: {
    accountName: string;    // 游戏账号编号
    /**
     * 星标序号（1 开始），仅当同一账号编号有多个配置方案参与轮换时需要。
     * 类型（account/role）不存储，由切号列表按账号编号分组推导。
     */
    starredIndex?: number;
  };
```

- [ ] **Step 3: 改默认值**

把 `plugins/rok/index.ts:328-331`：

```ts
  accountSwitch: {
    accountName: '',
    targetType: 'account',
  },
```

替换为：

```ts
  accountSwitch: {
    accountName: '',
  },
```

- [ ] **Step 4: 重写 action**

把 `plugins/rok/index.ts:971-994` 整块：

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

替换为：

```ts
    {
      id: 'switch-account',
      name: '切换账号',
      description: '按显式步骤切换游戏账号和/或同账号下的星标角色',
      run: async (ctx, params) => {
        // 前端算好步骤传进来，这里只顺序执行，不再做隐式方式推断。
        const accountStep = params?.accountSwitch as { accountName?: string } | undefined;
        const roleStep = params?.roleSwitch as { starredIndex?: number } | undefined;

        if (!accountStep && !roleStep) {
          ctx.log('❌ 未提供任何切换步骤');
          ctx.log('切换账号: no_steps');
          return;
        }

        if (accountStep) {
          const targetName = (accountStep.accountName || '').trim();
          if (!targetName) {
            ctx.log('❌ accountSwitch 缺少 accountName');
            ctx.log('切换账号: no_steps');
            return;
          }
          const accResult = await switchAccount(ctx, targetName);
          if (accResult !== 'success' && accResult !== 'switched_load_timeout') {
            ctx.log(`切换账号: ${accResult}`);
            return;
          }
          if (accResult === 'switched_load_timeout') {
            ctx.log('  ⚠️ 账号已切换但未检测到进城');
          }
          if (!roleStep) {
            ctx.log(`切换账号: ${accResult}`);
            return;
          }
        }

        const starredIndex = roleStep?.starredIndex;
        if (typeof starredIndex !== 'number') {
          ctx.log('❌ roleSwitch 缺少 starredIndex');
          ctx.log('切换账号: no_steps');
          return;
        }
        const roleResult = await switchRole(ctx, starredIndex);
        if (roleResult === 'already_active') {
          ctx.log('  ℹ️ 目标角色已是当前角色，跳过登录');
        }
        // already_active 对调用方等价于成功：日志保持 "切换账号: success" 前缀，
        // Home.tsx 的成功判定依赖 includes('切换账号: success')。
        ctx.log(`切换账号: ${roleResult === 'already_active' ? 'success (角色已在目标位置)' : roleResult}`);
      }
    },
```

- [ ] **Step 5: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无输出（`web/src/pages/Home.tsx` 与 `Config.tsx` 不在根 tsconfig 范围内，它们的报错在 Task 8-10 由 `cd web && npm run build` 覆盖）

- [ ] **Step 6: 跑插件测试**

Run: `npx jest plugins/rok/actions --runInBand`
Expected: PASS（`switchRole.test.ts` 全绿；旧的 `switchLinkedRole.test.ts` / `switchAccountKind.test.ts` 已删除不再运行）

- [ ] **Step 7: 提交**

```bash
git add plugins/rok/index.ts plugins/rok/actions
git commit -m "feat(switch): wire explicit switch steps, drop linked-role kind inference"
```

---

## Task 7: homeFeatures —— `switchIntervalMinutes` 类型统一

**Files:**
- Modify: `plugins/rok/homeFeatures.ts:94`（类型）
- Modify: `plugins/rok/homeFeatures.ts:180`（默认值）

**背景：** 现在是 `number | number[]` 双形态，UI（`Home.tsx:2924-2937`）与调度器（`Home.tsx:913-915`）各写一次转换。统一为 `number[]`。

- [ ] **Step 1: 改类型**

把 `plugins/rok/homeFeatures.ts:94`：

```ts
  switchIntervalMinutes: number | number[];
```

替换为：

```ts
  /** 每个槽位各自的切号间隔（分钟），下标与 switchProfileIds 对应 */
  switchIntervalMinutes: number[];
```

- [ ] **Step 2: 改默认值**

把 `plugins/rok/homeFeatures.ts:180`：

```ts
  switchIntervalMinutes: 30,
```

替换为：

```ts
  switchIntervalMinutes: [30, 30],
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/homeFeatures.ts
git commit -m "refactor(switch): unify switchIntervalMinutes to number[]"
```

**注意：** 老配置里 `switchIntervalMinutes` 可能是 `number`。Task 9 的 UI 与 Task 10 的调度器都要用一个归一化辅助函数读它，不能直接当数组用。

---

## Task 8: Config 页 —— 删类型下拉、加星标序号

**Files:**
- Modify: `web/src/pages/Config.tsx:43-44`（state）
- Modify: `web/src/pages/Config.tsx:63-66`（loadConfig）
- Modify: `web/src/pages/Config.tsx:97-101`（switchConfig）
- Modify: `web/src/pages/Config.tsx:128-144`（targetType 的 debounce effect）
- Modify: `web/src/pages/Config.tsx:203`（autoSave）
- Modify: `web/src/pages/Config.tsx:398-418`（UI）

- [ ] **Step 1: 换 state**

把 `web/src/pages/Config.tsx:43-44`：

```ts
  const [accountSwitchName, setAccountSwitchName] = useState<string>('');
  const [accountTargetType, setAccountTargetType] = useState<'account' | 'linked'>('account');
```

替换为：

```ts
  const [accountSwitchName, setAccountSwitchName] = useState<string>('');
  // 星标序号：空字符串表示未填（account 型不需要）
  const [accountStarredIndex, setAccountStarredIndex] = useState<string>('');
```

- [ ] **Step 2: 改 loadConfig 读取**

把 `web/src/pages/Config.tsx:63-66`：

```ts
        setAccountSwitchName((res.config as any).accountSwitch?.accountName ?? '');
        const loadedType = (res.config as any).accountSwitch?.targetType === 'linked' ? 'linked' : 'account';
        setAccountTargetType(loadedType);
        accountTargetTypeSyncedRef.current = loadedType;
```

替换为：

```ts
        setAccountSwitchName((res.config as any).accountSwitch?.accountName ?? '');
        const loadedIdx = (res.config as any).accountSwitch?.starredIndex;
        const loadedIdxStr = typeof loadedIdx === 'number' ? String(loadedIdx) : '';
        setAccountStarredIndex(loadedIdxStr);
        accountStarredIndexSyncedRef.current = loadedIdxStr;
```

- [ ] **Step 3: 改 switchConfig 读取**

把 `web/src/pages/Config.tsx:97-101`：

```ts
        setAccountSwitchName((res.config as any).accountSwitch?.accountName ?? '');
        const loadedType = (res.config as any).accountSwitch?.targetType === 'linked' ? 'linked' : 'account';
        setAccountTargetType(loadedType);
        accountSwitchNameSyncedRef.current = (res.config as any).accountSwitch?.accountName ?? '';
        accountTargetTypeSyncedRef.current = loadedType;
```

替换为：

```ts
        setAccountSwitchName((res.config as any).accountSwitch?.accountName ?? '');
        const loadedIdx = (res.config as any).accountSwitch?.starredIndex;
        const loadedIdxStr = typeof loadedIdx === 'number' ? String(loadedIdx) : '';
        setAccountStarredIndex(loadedIdxStr);
        accountSwitchNameSyncedRef.current = (res.config as any).accountSwitch?.accountName ?? '';
        accountStarredIndexSyncedRef.current = loadedIdxStr;
```

- [ ] **Step 4: 替换 targetType 的 debounce effect**

把 `web/src/pages/Config.tsx:128-144` 这一整块（targetType 的 synced ref + useEffect）：

```ts
  const accountTargetTypeSyncedRef = useRef<'account' | 'linked' | null>(null);
```

……直到该 `useEffect` 的 `}, [accountTargetType, currentAccountId, configName]);` 结束，整体替换为：

```ts
  // 星标序号 debounce 保存：与账号编号同样处理，输入停顿 600ms 后写入
  const accountStarredIndexSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentAccountId) return;
    if (accountStarredIndexSyncedRef.current === null) {
      accountStarredIndexSyncedRef.current = accountStarredIndex;
      return;
    }
    if (accountStarredIndexSyncedRef.current === accountStarredIndex) return;
    const t = setTimeout(() => {
      accountStarredIndexSyncedRef.current = accountStarredIndex;
      autoSave(buildingPositions);
    }, 600);
    return () => clearTimeout(t);
  }, [accountStarredIndex, currentAccountId, configName]);
```

**注意：** 保留 `accountSwitchNameSyncedRef` 那一块（`Config.tsx:111-126`）不动，只替换 targetType 那一块。

- [ ] **Step 5: 改 autoSave 写入**

把 `web/src/pages/Config.tsx:203`：

```ts
      await api.config.saveRokConfig(currentAccountId, { buildingPositions: bp, accountSwitch: { accountName: accountSwitchName, targetType: accountTargetType } } as any, configName);
```

替换为：

```ts
      const parsedIdx = parseInt(accountStarredIndex, 10);
      const accountSwitch: { accountName: string; starredIndex?: number } = { accountName: accountSwitchName };
      if (Number.isInteger(parsedIdx) && parsedIdx >= 1) accountSwitch.starredIndex = parsedIdx;
      await api.config.saveRokConfig(currentAccountId, { buildingPositions: bp, accountSwitch } as any, configName);
```

- [ ] **Step 6: 改 UI**

把 `web/src/pages/Config.tsx:398-418`：

```tsx
        {/* 账号类型 + 账号编号（与配置同一行） */}
        <label className="text-sm text-slate-600 whitespace-nowrap ml-2">类型:</label>
        <select
          value={accountTargetType}
          onChange={(e) => {
            setAccountTargetType(e.target.value as 'account' | 'linked');
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
      </div>
```

替换为：

```tsx
        {/* 账号编号 + 星标序号（与配置同一行） */}
        <label className="text-sm text-slate-600 whitespace-nowrap ml-2">账号编号:</label>
        <input
          type="text"
          value={accountSwitchName}
          onChange={(e) => setAccountSwitchName(e.target.value)}
          onBlur={() => autoSave(buildingPositions)}
          placeholder="请输入"
          className="px-2 py-1 text-sm border border-slate-300 rounded w-40"
        />
        <label className="text-sm text-slate-600 whitespace-nowrap ml-2" title="同一账号有多个方案参与轮换时必填：游戏内「角色管理 → 星标角色」列表中的第几个">
          星标序号:
        </label>
        <input
          type="number"
          min={1}
          value={accountStarredIndex}
          onChange={(e) => setAccountStarredIndex(e.target.value)}
          onBlur={() => autoSave(buildingPositions)}
          placeholder="同账号多角色必填"
          className="px-2 py-1 text-sm border border-slate-300 rounded w-32"
        />
      </div>
```

- [ ] **Step 7: 前端构建通过**

Run: `cd web && npm run build`
Expected: 若只剩 `Home.tsx` 相关的 `profileTargetTypes` / `switchIntervalMinutes` 报错，属预期（Task 9-11 修）；`Config.tsx` 自身不应有报错。

- [ ] **Step 8: 提交**

```bash
git add web/src/pages/Config.tsx
git commit -m "feat(config): replace account type dropdown with starred index"
```

---

## Task 9: Home 页 —— profile 元信息加载去重

**Files:**
- Modify: `web/src/pages/Home.tsx:494-495`（state）
- Modify: `web/src/pages/Home.tsx:629-682`（两处重复的加载逻辑）

**背景：** `Home.tsx:637-645` 与 `662-670` 是两段几乎相同的 `Promise.all` 拉取；同时 `profileTargetTypes` 要换成 `profileStarredIndexes`。

- [ ] **Step 1: 换 state**

把 `web/src/pages/Home.tsx:494-495` 两行（`profileAccountNames` 与 `profileTargetTypes` 的 `useState`）替换为：

```ts
  const [profileAccountNames, setProfileAccountNames] = useState<Record<string, string>>({});
  const [profileStarredIndexes, setProfileStarredIndexes] = useState<Record<string, number | undefined>>({});
```

- [ ] **Step 2: 抽出共用加载函数**

在 `web/src/pages/Home.tsx` 里 `handleConfigSwitch` 定义之前（约 683 行前）插入：

```ts
  // profile 的账号编号 / 星标序号缓存刷新。原先在初始化 effect 与 focus effect 里
  // 各写了一遍几乎相同的 Promise.all，这里合并为单一入口。
  const refreshProfileSwitchMeta = useCallback(async (): Promise<string[] | null> => {
    if (!currentAccountId) return null;
    try {
      const pRes = await api.config.getProfiles(currentAccountId);
      if (!pRes.success) return null;
      setConfigNames(pRes.profiles);
      const nameMap: Record<string, string> = {};
      const idxMap: Record<string, number | undefined> = {};
      await Promise.all(pRes.profiles.map(async (p: string) => {
        try {
          const cfg = await api.config.getRokConfig(currentAccountId, p);
          nameMap[p] = ((cfg.config as any)?.accountSwitch?.accountName || '').trim();
          const idx = (cfg.config as any)?.accountSwitch?.starredIndex;
          idxMap[p] = typeof idx === 'number' ? idx : undefined;
        } catch { nameMap[p] = ''; idxMap[p] = undefined; }
      }));
      setProfileAccountNames(nameMap);
      setProfileStarredIndexes(idxMap);
      return pRes.profiles;
    } catch { return null; }
  }, [currentAccountId]);
```

**注意：** 确认文件顶部 import 里已有 `useCallback`；若没有，加进 `import { ... } from 'react'`。

- [ ] **Step 3: 初始化 effect 改用它**

把 `web/src/pages/Home.tsx:629-647` 这块（`try { const pRes = await api.config.getProfiles(...) ... } catch {}`，即 Step 2 前那段带 `typeMap` 的）替换为：

```ts
      try {
        const profiles = await refreshProfileSwitchMeta();
        if (profiles && !activeConfigName) {
          const pRes = await api.config.getProfiles(currentAccountId);
          if (pRes.success) setActiveConfigName(pRes.active);
        }
      } catch {}
```

同时把该 effect 的依赖数组从 `[currentAccountId]` 改为 `[currentAccountId, refreshProfileSwitchMeta]`。

- [ ] **Step 4: focus effect 改用它**

把 `web/src/pages/Home.tsx:653-682` 整个 effect 替换为：

```ts
  // 窗口重新获得焦点、或从其它页面切回 Home 时，重拉 profile 的账号编号/星标序号缓存，
  // 使账号调度下拉里的禁用状态与提示跟着更新。
  useEffect(() => {
    if (!currentAccountId) return;
    refreshProfileSwitchMeta();
    const onFocus = () => { refreshProfileSwitchMeta(); };
    const onVis = () => { if (document.visibilityState === 'visible') refreshProfileSwitchMeta(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [currentAccountId, location.pathname, refreshProfileSwitchMeta]);
```

- [ ] **Step 5: 确认 `profileTargetTypes` 已无引用**

Run: `grep -n "profileTargetTypes\|setProfileTargetTypes" web/src/pages/Home.tsx`
Expected: 只剩 `2871` 与 `2890,2898,2905` 附近的槽位 UI（Task 10 处理）。若出现在其他地方，一并改成 `profileStarredIndexes` 或删除。

- [ ] **Step 6: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "refactor(home): dedupe profile switch meta loading"
```

---

## Task 10: Home 页 —— 槽位 UI 校验重写

**Files:**
- Modify: `web/src/pages/Home.tsx:2856-2958`（槽位渲染）
- Modify: `web/src/pages/Home.tsx` 顶部 import

**背景：** 删除全部连体配对约束（`neighborLinked` 相邻禁连体、`hasLinkedMaster` 连体必须配主号），改为基于 `validateSwitchProfiles` 的统一校验。

- [ ] **Step 1: 加 import**

在 `web/src/pages/Home.tsx` 的 import 区加：

```ts
import { buildSwitchSteps, deriveProfileKinds, nextSwitchTargetIdx, validateSwitchProfiles, type ProfileSwitchMeta } from '../utils/accountSwitchPlan';
```

- [ ] **Step 2: 在组件内加派生值**

在槽位 UI 之前（比如紧跟 `refreshProfileSwitchMeta` 定义之后）插入：

```ts
  // 把某组 profile 名映射成校验用的元信息
  const toSwitchMeta = useCallback((names: string[]): ProfileSwitchMeta[] =>
    names.filter(Boolean).map(n => ({
      name: n,
      accountName: profileAccountNames[n] || '',
      starredIndex: profileStarredIndexes[n],
    })), [profileAccountNames, profileStarredIndexes]);
```

- [ ] **Step 3: 替换槽位下拉的选项判定**

把 `web/src/pages/Home.tsx:2889-2917`（`{configNames.filter(...).map(p => { ... })}` 整块，含 `isLinked` / `neighborLinked` / `hasLinkedMaster` / `disabled` / `suffix` 的计算与 `<option>` 返回）替换为：

```tsx
                              {configNames.filter(p => !others.includes(p)).map(p => {
                                // 把 p 放进当前槽位后的假设列表，用统一校验判断这个选择是否可行
                                const hypothetical = ids.slice();
                                hypothetical[i] = p;
                                const issues = validateSwitchProfiles(toSwitchMeta(hypothetical));
                                const own = issues.find(x => x.profileName === p);
                                const accName = (profileAccountNames[p] || '').trim();
                                const starIdx = profileStarredIndexes[p];
                                let suffix = '';
                                if (own?.reason === 'no-account') suffix = '（未填编号）';
                                else if (own?.reason === 'missing-starred-index') suffix = '（需填星标序号）';
                                else if (own?.reason === 'invalid-starred-index') suffix = '（星标序号非法）';
                                else if (own?.reason === 'duplicate-starred-index') suffix = '（星标序号重复）';
                                else if (typeof starIdx === 'number') suffix = `（账号 ${accName} · 星标#${starIdx}）`;
                                else if (accName) suffix = `（账号 ${accName}）`;
                                return (
                                  <option key={p} value={p} disabled={!!own}>
                                    {p}{suffix}
                                  </option>
                                );
                              })}
```

- [ ] **Step 4: 替换槽位徽标**

把 `web/src/pages/Home.tsx:2871-2873`：

```tsx
                                {profileName && profileTargetTypes[profileName] === 'linked' && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700">连体</span>
                                )}
```

替换为：

```tsx
                                {profileName && slotKinds[profileName] === 'role' && typeof profileStarredIndexes[profileName] === 'number' && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700">
                                    角色#{profileStarredIndexes[profileName]}
                                  </span>
                                )}
```

并在 `Step 3` 所在的 IIFE 内、`return ids.map(...)` 之前加：

```tsx
                    const slotKinds = deriveProfileKinds(toSwitchMeta(ids));
                    const slotIssues = validateSwitchProfiles(toSwitchMeta(ids));
```

- [ ] **Step 5: 在提示行显示当前配置的问题**

把 `web/src/pages/Home.tsx:2958` 那行提示：

```tsx
              <p className="mt-2 text-xs text-amber-600/70">💡 切号后自动加载对应方案的全部功能设置 · 共 {MAX_SWITCH_SLOTS} 个账号参与轮换{MAX_SWITCH_SLOTS > 2 && <span className="text-amber-500">（开发模式）</span>}</p>
```

替换为：

```tsx
              <p className="mt-2 text-xs text-amber-600/70">💡 切号后自动加载对应方案的全部功能设置 · 共 {MAX_SWITCH_SLOTS} 个身份参与轮换{MAX_SWITCH_SLOTS > 2 && <span className="text-amber-500">（开发模式）</span>}</p>
              {(() => {
                const issues = validateSwitchProfiles(toSwitchMeta((features.switchProfileIds || []).slice(0, MAX_SWITCH_SLOTS)));
                if (issues.length === 0) return null;
                const texts = issues.map(x => {
                  if (x.reason === 'no-account') return `${x.profileName}: 未填账号编号`;
                  if (x.reason === 'missing-starred-index') return `${x.profileName}: 同账号多角色需在配置页填星标序号`;
                  if (x.reason === 'invalid-starred-index') return `${x.profileName}: 星标序号必须是 ≥1 的整数`;
                  return `${x.profileName}: 星标序号与同账号其它方案重复`;
                });
                return <p className="mt-1 text-xs text-rose-600">⚠️ {texts.join('；')}</p>;
              })()}
```

- [ ] **Step 6: 前端构建**

Run: `cd web && npm run build`
Expected: 若只剩 `switchIntervalMinutes` / `accountSwitchLoop` 相关报错，属预期（Task 11-12 修）。

- [ ] **Step 7: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): replace linked pairing constraints with unified slot validation"
```

---

## Task 11: Home 页 —— 切号循环改用显式步骤 + 环向推进

**Files:**
- Modify: `web/src/pages/Home.tsx:1300-1374`（`accountSwitchLoop` 的 try 块）
- Modify: `web/src/pages/Home.tsx:902-905`（初始 `switchTargetIdx`）

- [ ] **Step 1: 改初始目标索引**

把 `web/src/pages/Home.tsx:902-905`：

```ts
    const initialIds = (featuresRef.current.switchProfileIds || []).filter((s: string) => !!s);
    switchTargetIdx = initialIds.findIndex((x: string) => x !== activeConfigNameRef.current);
    if (switchTargetIdx < 0) switchTargetIdx = 0;
```

替换为：

```ts
    const initialIds = (featuresRef.current.switchProfileIds || []).filter((s: string) => !!s);
    switchTargetIdx = nextSwitchTargetIdx(initialIds, activeConfigNameRef.current);
```

- [ ] **Step 2: 改切号执行体**

把 `web/src/pages/Home.tsx:1301-1315`（从 `const cfgRes = await api.config.getRokConfig(...)` 到 `createTask(...)` 的参数）这段：

```ts
            const cfgRes = await api.config.getRokConfig(currentAccountId, nextProfile);
            const targetType: 'account' | 'linked' = (cfgRes.config as any)?.accountSwitch?.targetType === 'linked' ? 'linked' : 'account';
            const targetName = ((cfgRes.config as any)?.accountSwitch?.accountName || '').trim();
            const currentProfile = activeConfigNameRef.current;
            const currentName = (profileAccountNames[currentProfile] || '').trim();
            const currentType: 'account' | 'linked' = profileTargetTypes[currentProfile] ?? 'account';
            if (targetType === 'account' && !targetName) {
```

替换为：

```ts
            const cfgRes = await api.config.getRokConfig(currentAccountId, nextProfile);
            const targetName = ((cfgRes.config as any)?.accountSwitch?.accountName || '').trim();
            const targetStarredIdx = (cfgRes.config as any)?.accountSwitch?.starredIndex;
            const currentProfile = activeConfigNameRef.current;
            // 用最新读到的目标配置覆盖缓存，避免 Config 页刚改完还没 refresh 就切号
            const metas: ProfileSwitchMeta[] = validIds.map((n: string) => n === nextProfile
              ? { name: n, accountName: targetName, starredIndex: typeof targetStarredIdx === 'number' ? targetStarredIdx : undefined }
              : { name: n, accountName: profileAccountNames[n] || '', starredIndex: profileStarredIndexes[n] });
            const targetMeta = metas.find(m => m.name === nextProfile)!;
            const currentMeta = metas.find(m => m.name === currentProfile);
            const steps = buildSwitchSteps(currentMeta, targetMeta, metas);
            if (!targetName) {
```

- [ ] **Step 3: 改跳过分支的推进方式**

把紧随其后的（原 `Home.tsx:1308-1309`）：

```ts
              pushLog(`⚠️ profile "${nextProfile}" 未填账号编号，跳过`);
              switchTargetIdx = (switchTargetIdx + 1) % validIds.length;
```

替换为：

```ts
              pushLog(`⚠️ profile "${nextProfile}" 未填账号编号，跳过`);
              switchTargetIdx = (switchTargetIdx + 1) % validIds.length;
            } else if (!steps.accountSwitch && !steps.roleSwitch) {
              pushLog(`⚠️ profile "${nextProfile}" 与当前身份无差异（可能缺星标序号），跳过`);
              switchTargetIdx = (switchTargetIdx + 1) % validIds.length;
```

- [ ] **Step 4: 改 createTask 参数**

把 `web/src/pages/Home.tsx` 里（原 1313-1315）：

```ts
                const cr = await createTask(currentAccountId, 'com.rok.automation', 'switch-account', {
                  currentName, currentType, targetName, targetType,
                });
```

替换为：

```ts
                pushLog(`  🔀 步骤: ${steps.accountSwitch ? `切账号→${steps.accountSwitch.accountName} ` : ''}${steps.roleSwitch ? `切角色→星标#${steps.roleSwitch.starredIndex}` : ''}`);
                const cr = await createTask(currentAccountId, 'com.rok.automation', 'switch-account', {
                  accountSwitch: steps.accountSwitch,
                  roleSwitch: steps.roleSwitch,
                });
```

- [ ] **Step 5: 改成功后的目标推进**

把 `web/src/pages/Home.tsx:1366-1368`：

```ts
                // 顺序不变，下次切换目标 = validIds 中不等于新 active 的位置
                switchTargetIdx = validIds.findIndex((x: string) => x !== nextProfile);
                if (switchTargetIdx < 0) switchTargetIdx = 0;
```

替换为：

```ts
                // 环向推进：下次目标 = 新 active 在 validIds 中的下一格
                switchTargetIdx = nextSwitchTargetIdx(validIds, nextProfile);
```

- [ ] **Step 6: 前端构建**

Run: `cd web && npm run build`
Expected: 若只剩 `switchIntervalMinutes` 相关报错，属预期（Task 12 修）。

- [ ] **Step 7: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): drive account switch by explicit steps with ring advance"
```

---

## Task 12: Home 页 —— 合并"载入新 profile 功能"的重复代码

**Files:**
- Modify: `web/src/pages/Home.tsx:684-733`（`handleConfigSwitch`）
- Modify: `web/src/pages/Home.tsx:1341-1361`（`accountSwitchLoop` 内的载入块）

**背景：** 两处都在做"下载目标 profile 的 homeFeatures → 合并 DEFAULT → `preserveGlobalFields` 注入 → 清空 completedBuildings/completedTechs"，逻辑重复且已经出现过一处改了另一处没改的风险。

- [ ] **Step 1: 抽出共用函数**

在 `web/src/pages/Home.tsx` 的 `handleConfigSwitch` 定义之前插入：

```ts
  // 载入指定 profile 的功能开关并合并进当前 features。
  // 返回合并后的对象，调用方决定是否还要写 featuresRef（切号循环需要，手动切换不需要）。
  const buildFeaturesForProfile = (hf: any) => preserveGlobalFields(featuresRef.current, padGatherTasks({
    ...DEFAULT_HOME_FEATURES,
    ...hf,
    gemGatherMode: migrateGemMode(hf),
    completedBuildings: [false, false, false, false, false],
    completedTechs: [false, false, false, false, false],
  }));
```

- [ ] **Step 2: `handleConfigSwitch` 改用它**

把 `web/src/pages/Home.tsx:703-727` 这段（`if (res.success && res.config?.homeFeatures) { setFeatures((prev) => { const merged = preserveGlobalFields(prev, padGatherTasks({...})) as any; ... }) } else {...}`）替换为：

```ts
      if (res.success && res.config?.homeFeatures) {
        const merged = buildFeaturesForProfile(res.config.homeFeatures) as any;
        // 若开启自动切号且新 active 不在 switchProfileIds → 找空槽填，无空槽覆盖槽 0
        if (merged.autoSwitchAccount) {
          const cur: string[] = (merged.switchProfileIds || []).slice(0, MAX_SWITCH_SLOTS);
          while (cur.length < MAX_SWITCH_SLOTS) cur.push('');
          if (!cur.includes(newName)) {
            const emptyIdx = cur.findIndex((s: string) => !s);
            const slotIdx = emptyIdx >= 0 ? emptyIdx : 0;
            cur[slotIdx] = newName;
            merged.switchProfileIds = cur;
          }
        }
        setFeatures(merged);
      } else {
        setFeatures((prev: typeof DEFAULT_FEATURES) => preserveGlobalFields(prev, { ...DEFAULT_FEATURES }));
      }
```

**注意：** 原来用的是 `setFeatures(prev => ...)` 读 `prev`，改后用 `featuresRef.current` 作为保留全局字段的来源。两者在切换瞬间等价（`featuresRef` 与 `features` 同步更新），但如果发现全局字段丢失，改回 `setFeatures(prev => preserveGlobalFields(prev, ...))` 形式并只抽出内层的 `padGatherTasks({...})` 部分。

- [ ] **Step 3: `accountSwitchLoop` 改用它**

把 `web/src/pages/Home.tsx:1348-1354` 这段：

```ts
                  const merged = preserveGlobalFields(featuresRef.current, padGatherTasks({
                    ...DEFAULT_HOME_FEATURES,
                    ...hf,
                    gemGatherMode: migrateGemMode(hf),
                    completedBuildings: [false, false, false, false, false],
                    completedTechs: [false, false, false, false, false],
                  }));
```

替换为：

```ts
                  const merged = buildFeaturesForProfile(hf);
```

- [ ] **Step 4: 前端构建**

Run: `cd web && npm run build`
Expected: 成功（若还有 `switchIntervalMinutes` 报错属预期，Task 13 修）

- [ ] **Step 5: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "refactor(home): share profile features loading between manual and auto switch"
```

---

## Task 13: Home 页 —— `switchIntervalMinutes` 归一化

**Files:**
- Modify: `web/src/pages/Home.tsx:913-915`（调度器读取）
- Modify: `web/src/pages/Home.tsx:2924-2937`（UI 读写）

- [ ] **Step 1: 加归一化辅助函数**

在 `web/src/pages/Home.tsx` 的 `preserveGlobalFields` 定义之后（约 414 行后）插入：

```ts
  // 老配置可能把 switchIntervalMinutes 存成单个 number，统一读成长度 = MAX_SWITCH_SLOTS 的数组
  const normalizeIntervals = (raw: unknown): number[] => {
    const fallback = typeof raw === 'number' ? raw : 30;
    const arr = Array.isArray(raw) ? raw.slice() : [];
    while (arr.length < MAX_SWITCH_SLOTS) arr.push(fallback);
    return arr.slice(0, MAX_SWITCH_SLOTS).map((v: any) => Math.max(1, parseInt(String(v), 10) || 30));
  };
```

- [ ] **Step 2: 改调度器读取**

把 `web/src/pages/Home.tsx:913-915`：

```ts
      const defaultMin = typeof feat.switchIntervalMinutes === 'number' ? feat.switchIntervalMinutes : 30;
      const intervals = Array.isArray(feat.switchIntervalMinutes) ? feat.switchIntervalMinutes : [];
      const minutes = Math.max(1, intervals[curIdx >= 0 ? curIdx : 0] ?? defaultMin);
```

替换为：

```ts
      const intervals = normalizeIntervals(feat.switchIntervalMinutes);
      const minutes = intervals[curIdx >= 0 ? curIdx : 0];
```

- [ ] **Step 3: 改 UI 读写**

把 `web/src/pages/Home.tsx:2924-2938`（`value={(() => {...})()}` 与 `onChange`）替换为：

```tsx
                                  value={normalizeIntervals(features.switchIntervalMinutes)[i]}
                                  onChange={(e) => {
                                    const cur = normalizeIntervals(features.switchIntervalMinutes);
                                    cur[i] = Math.max(1, parseInt(e.target.value, 10) || 30);
                                    setFeatures({ ...features, switchIntervalMinutes: cur });
                                  }}
```

- [ ] **Step 4: 前端构建通过**

Run: `cd web && npm run build`
Expected: 构建成功，无 TypeScript 报错

- [ ] **Step 5: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "refactor(home): normalize switchIntervalMinutes reads"
```
---

## Task 14: 全量校验

**Files:** 无改动，仅验证

- [ ] **Step 1: 根项目类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 2: 前端构建**

Run: `cd web && npm run build`
Expected: 成功

- [ ] **Step 3: 跑相关测试**

Run: `npx jest web/src/utils/accountSwitchPlan.test.ts plugins/rok/actions --runInBand`
Expected: PASS

- [ ] **Step 4: 确认旧概念已清除**

Run: `grep -rn "targetType\|profileTargetTypes\|switchLinkedRole\|resolveSwitchKind\|LinkedDirection" plugins core server electron web/src`
Expected: 无输出。若有残留，逐个清理。

- [ ] **Step 5: 提交（如有清理）**

```bash
git add -A
git commit -m "chore(switch): remove residual legacy switch-type references"
```

---

## Task 15: 真机验证清单（dev 4 槽，需人工操作模拟器）

**Files:** 无改动

**前置：** `npm run server` + `cd web && npm run dev`；模拟器已启动游戏；在游戏内给参与测试的角色加星标，记下每个角色的星标序号；在 Config 页为每个 profile 填好账号编号（+ 同账号多角色的星标序号）。

- [ ] **Step 1: 回归——两账号互切 `[A, B]`**

期望：日志出现 `🔀 步骤: 切账号→<B编号>`，无切角色步骤；切号后 Home 加载 B 的功能开关。

- [ ] **Step 2: 单账号双角色 `[B①, B②]`**

期望：日志出现 `🔀 步骤: 切角色→星标#N`，无切账号步骤；两次轮换分别点到不同星标位。

- [ ] **Step 3: 混合轮换 `[A, B①, B②]`（核心用例）**

期望第二轮 `A → B①` 时：日志出现 `切账号→<B编号>` **且** `切角色→星标#①`，最终落在 B①（而非 B 最近使用的 B②）。这是本次改动要解决的核心场景。

- [ ] **Step 4: 跨屏滚动（`starredIndex > 6`）**

给某个 profile 填 `starredIndex = 7` 或更大，切号时确认日志出现 `向下翻 1 页`，且最终登录的是正确角色。若落错角色，说明翻页位移需标定：调整 `plugins/rok/actions/switchRole.ts` 的 `PAGE_UP_TO_Y`（一次滑动应恰好推进 3 行 = 504px），改完重跑本步。

- [ ] **Step 5: 空操作分支**

手动把 B 账号留在 ①，然后跑 `[A, B①, B②]` 首轮。期望 `A → B①` 时日志出现 `ℹ️ 目标角色已是当前角色，跳过登录` 与 `切换账号: success (角色已在目标位置)`，且界面被逐层关回城内、后续 action 正常执行（不卡在角色管理界面）。

- [ ] **Step 6: 老配置兼容**

用一个仍带 `targetType: 'linked'` 的历史配置文件（`~/.slg-automation/configs/{accountId}.json`）加载 Home 页。期望：不报错。分两种边界各验一次：
  - **成对**旧 linked（主号 + 连体号同编号）→ 因缺 `starredIndex` 在槽位下拉里显示"（需填星标序号）"且不可选；到 Config 页填入后可选、且能正常按位置切角色
  - **孤立**旧 linked（账号编号在列表里唯一）→ 判为 account 型、按只切账号处理、不提示（这是设计接受的降级，见 spec 第八节）

- [ ] **Step 8: 星标序号被清空后不得静默降级（核心防护）**

把某个 role 型 profile（与另一 profile 同账号编号）的星标序号在 Config 页清空，然后让它在混合轮换里作为**不同账号**的目标被切到。

期望：日志出现 `⏭️ 跳过 <profile>：未填星标序号`，轮换推进到下一个目标，**不发生只切账号的行为**。

反例（修复前的错误行为）：只切账号 → 落在该账号最近使用的角色上 → 上报成功 → 前端 profile 切过去了但设备在错误角色。

- [ ] **Step 9: 重试幂等（账号已在目标账号时重跑账号步骤）**

构造"账号步骤成功 + 角色步骤失败"让循环进入第 2 次尝试（例如临时把某个 role profile 的星标序号填成一个不存在的大序号）。

期望：第 2 次尝试重跑 `switchAccount` 时，设备已在目标账号，**不应误判 `not_found`、不应触发 `am force-stop` 重启游戏**。若观察到重启，说明 `switchAccount` 的下拉列表在"目标即当前账号"时行为异常，需要单独处理（spec 5.1 要求容忍这种情况，但本次未改 `switchAccount.ts`）。

- [ ] **Step 10: 账号进城超时后接角色切换**

难以主动构造，留意日志即可：若出现 `⚠️ 账号已切换但未检测到进城` 紧跟 `⏳ 额外等待 5s`，观察随后的角色切换是否成功。若角色切换总是失败，说明 5s 不够，调大 `plugins/rok/index.ts` 的 `ACCOUNT_TIMEOUT_SETTLE_SEC`。

- [ ] **Step 11: 确认登录轮询窗口是否够（慢机）**

留意是否出现"真实切换被误判成已在目标角色"——表现为日志报 `切换账号: success (角色已在目标位置)` 但设备实际正在登录/落到了错误角色。若出现，调大 `plugins/rok/actions/switchRole.ts` 的 `SURELOGIN_POLL_TIMES`（当前 6 次 × 0.5s = 3s 窗口）。

- [ ] **Step 7: 环向轮换（4 槽）**

配 `[A, B①, B②, C]` 跑至少两圈，确认切号顺序严格按 A → B① → B② → C → A 循环，不跳格、不来回。

---

## 变更影响提示

- **`switch-account` action 参数是破坏性变更**：老参数（`currentName` / `currentType` / `targetName` / `targetType`）不再被识别。若有其它调用方（远程控制指令、脚本），需同步更新。Task 14 Step 4 的 grep 会暴露 `targetType` 残留。
- **成功判定的日志契约不变**：`plugins/rok/index.ts` 仍以 `切换账号: <result>` 格式输出，`Home.tsx` 仍靠 `includes('切换账号: success')` / `includes('切换账号: switched_load_timeout')` 判定。`already_active` 被映射为 `success (角色已在目标位置)`，前缀匹配成立。
- **账号步骤的幂等性**：重试时若设备已在目标账号上，`switchAccount` 会在下拉里重新选中同一账号并再登录一次——多等一次登录，但不会误判失败。本次不改 `switchAccount.ts`。
- **翻页位移是唯一需要真机标定的常量**：`switchRole.ts` 的 `PAGE_UP_TO_Y`。单测只验证"有向上滑动且次数正确"，不验证像素值。
