# 组合采集有效条件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只有账号调度开启、选择组合采集且功能未锁定时，分享和采集任务才使用组合池及跳过行为。

**Architecture:** 抽取一个纯函数统一表达“组合采集实际生效”，分享循环和采集循环分别用各自最新的 feature 快照调用该函数。通过独立 TypeScript 检查脚本覆盖条件真值表；前端没有测试框架，因此最终以脚本断言和完整前端构建验证。

**Tech Stack:** React、TypeScript、Vite、Node.js assert

---

## File Map

- Create: `web/src/utils/comboGemMode.ts` — 组合采集有效条件纯函数。
- Create: `web/scripts/check-combo-gem-mode.mjs` — 无测试框架情况下的条件真值表检查。
- Modify: `web/src/pages/Home.tsx:1508-1517,1835-1839` — 分享和采集任务参数统一使用有效条件。

## Global Constraints

- 有效条件必须同时满足：`autoSwitchAccount=true`、`switchMode='combo-gem'`、账号调度功能未锁定。
- 条件为假时同时恢复当前账号池、游戏内分享和聊天补池。
- 分享循环使用 `featuresRef.current` 的当前快照；采集循环使用该轮已经读取的 `fNow`。
- 不重置下拉值，不修改 UI，不修改后端 action。
- 当前工作区有大量未提交修改；不提交、不还原、不格式化无关代码。

---

### Task 1: 用纯函数和真值表定义有效条件

**Files:**
- Create: `web/src/utils/comboGemMode.ts`
- Create: `web/scripts/check-combo-gem-mode.mjs`

- [ ] **Step 1: 写失败的真值表检查脚本**

创建 `web/scripts/check-combo-gem-mode.mjs`：

```js
import assert from 'node:assert/strict';
import { isComboGemActive } from '../dist-check/comboGemMode.js';

const cases = [
  [{ autoSwitchAccount: true, switchMode: 'combo-gem' }, false, true],
  [{ autoSwitchAccount: false, switchMode: 'combo-gem' }, false, false],
  [{ autoSwitchAccount: true, switchMode: 'per-round' }, false, false],
  [{ autoSwitchAccount: true, switchMode: 'combo-gem' }, true, false],
];

for (const [features, locked, expected] of cases) {
  assert.equal(isComboGemActive(features, locked), expected);
}

console.log('combo gem mode checks passed');
```

- [ ] **Step 2: 运行检查并确认失败**

Run from `web/`:

```bash
npx tsc src/utils/comboGemMode.ts --target ES2020 --module ES2020 --moduleResolution node --outDir dist-check && node scripts/check-combo-gem-mode.mjs
```

Expected: FAIL，因为 `src/utils/comboGemMode.ts` 尚不存在。

- [ ] **Step 3: 实现最小纯函数**

创建 `web/src/utils/comboGemMode.ts`：

```ts
export interface ComboGemFeatures {
  autoSwitchAccount: boolean;
  switchMode: string;
}

export function isComboGemActive(
  features: ComboGemFeatures,
  autoSwitchAccountLocked: boolean
): boolean {
  return features.autoSwitchAccount &&
    features.switchMode === 'combo-gem' &&
    !autoSwitchAccountLocked;
}
```

- [ ] **Step 4: 运行真值表检查确认通过**

Run from `web/`:

```bash
npx tsc src/utils/comboGemMode.ts --target ES2020 --module ES2020 --moduleResolution node --outDir dist-check && node scripts/check-combo-gem-mode.mjs
```

Expected: 输出 `combo gem mode checks passed`，exit 0。

- [ ] **Step 5: 删除临时编译输出**

Run from `web/`:

```powershell
Remove-Item -Recurse -Force "dist-check" -Confirm:$false
```

Expected: `web/dist-check` 不再存在；保留源文件和检查脚本。

---

### Task 2: 分享和采集任务使用统一有效条件

**Files:**
- Modify: `web/src/pages/Home.tsx:1-40,1500-1517,1832-1839`
- Test: `web/scripts/check-combo-gem-mode.mjs`

- [ ] **Step 1: 导入纯函数**

在 `Home.tsx` 现有本地工具导入区域加入：

```ts
import { isComboGemActive } from '../utils/comboGemMode';
```

- [ ] **Step 2: 修改分享宝石任务参数**

在创建 `share-gem` 任务前读取单一快照并计算：

```ts
const shareFeatures = featuresRef.current;
const comboGemActive = isComboGemActive(
  shareFeatures,
  isFeatureLocked('autoSwitchAccount')
);
```

然后将参数改为：

```ts
poolAccountId: comboGemActive ? COMBO_GEM_POOL_ACCOUNT_ID : currentAccountId,
```

和：

```ts
skipShareClick: comboGemActive,
```

同一参数块中的起点、停止条件等字段使用 `shareFeatures`，避免条件和参数来自不同时间点的状态快照。

- [ ] **Step 3: 修改采集分享矿任务参数**

在 `gemParams` 前基于当前轮 `fNow` 计算：

```ts
const comboGemActive = isComboGemActive(
  fNow,
  isFeatureLocked('autoSwitchAccount')
);
```

将分享矿参数改为：

```ts
poolAccountId: comboGemActive ? COMBO_GEM_POOL_ACCOUNT_ID : currentAccountId,
skipChatCollect: comboGemActive,
```

其余参数保持不变。

- [ ] **Step 4: 检查旧条件已移除**

Run from repository root:

```bash
rg -n "switchMode === 'combo-gem'" web/src/pages/Home.tsx
```

Expected: 本次两个参数组装点不再直接使用该表达式；组合模式条件只通过 `isComboGemActive` 表达。

---

### Task 3: 完整验证与差异检查

**Files:**
- Create: `web/src/utils/comboGemMode.ts`
- Create: `web/scripts/check-combo-gem-mode.mjs`
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 重新运行真值表检查**

Run from `web/`:

```bash
npx tsc src/utils/comboGemMode.ts --target ES2020 --module ES2020 --moduleResolution node --outDir dist-check && node scripts/check-combo-gem-mode.mjs
```

Expected: `combo gem mode checks passed`。

- [ ] **Step 2: 清理临时输出**

Run from `web/`:

```powershell
Remove-Item -Recurse -Force "dist-check" -Confirm:$false
```

Expected: 临时目录已删除。

- [ ] **Step 3: 运行完整前端构建**

Run from `web/`:

```bash
npm run build
```

Expected: TypeScript 和 Vite 构建成功，exit 0。

- [ ] **Step 4: 检查差异**

Run from repository root:

```bash
git diff --check -- web/src/pages/Home.tsx web/src/utils/comboGemMode.ts web/scripts/check-combo-gem-mode.mjs
git diff -- web/src/pages/Home.tsx web/src/utils/comboGemMode.ts web/scripts/check-combo-gem-mode.mjs
git status --short
```

Expected:

- `diff --check` 无输出；
- 仅新增纯函数/检查脚本，并在两个任务参数点使用统一条件；
- 其他已有工作区修改保持原状。

- [ ] **Step 5: 不自动提交**

不要运行 `git add` 或 `git commit`。报告真值表检查、前端构建和差异检查的实际结果。
