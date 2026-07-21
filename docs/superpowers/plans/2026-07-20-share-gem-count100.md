# 分享宝石矿 100 个停止条件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在分享宝石矿停止条件下拉框中新增“分享 100 个矿（测试）”，本次 action 成功分享满 100 个后停止。

**Architecture:** 扩展现有 `shareGemStopCondition` 联合类型，并在 Home 页将 `count100` 映射为现有 action 参数 `targetCount: 100`。不改动 `shareGem.ts`，继续复用本次运行的 `shared >= targetCount` 早退逻辑。

**Tech Stack:** TypeScript、React、Jest、Vite

---

## 文件结构

- Modify: `plugins/rok/homeFeatures.ts` — 扩展停止条件配置类型。
- Modify: `web/src/pages/Home.tsx` — 增加 100 个映射、类型断言和下拉选项。
- Create: `plugins/rok/actions/shareGemCount100.test.ts` — 对跨层配置文本做最小回归验证。

### Task 1: 添加失败的回归测试

**Files:**
- Create: `plugins/rok/actions/shareGemCount100.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import * as fs from 'fs';
import * as path from 'path';

describe('分享宝石矿 count100 停止条件', () => {
  const homeFeatures = fs.readFileSync(path.resolve(__dirname, '../homeFeatures.ts'), 'utf8');
  const home = fs.readFileSync(path.resolve(__dirname, '../../../web/src/pages/Home.tsx'), 'utf8');

  test('配置类型、目标映射和下拉选项均支持 count100', () => {
    expect(homeFeatures).toContain("'count100'");
    expect(home).toContain("stopCond === 'count100' ? 100");
    expect(home).toContain('<option value="count100">分享 100 个矿（测试）</option>');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
npx jest plugins/rok/actions/shareGemCount100.test.ts --runInBand
```

Expected: FAIL，因为 `count100` 尚未出现在类型、映射和下拉选项中。

### Task 2: 实现 count100 配置和 UI

**Files:**
- Modify: `plugins/rok/homeFeatures.ts:41`
- Modify: `web/src/pages/Home.tsx:1501-1502`
- Modify: `web/src/pages/Home.tsx:2724-2732`

- [ ] **Step 1: 扩展配置类型**

将：
```ts
shareGemStopCondition: 'spiral' | 'count5' | 'count10' | 'count15';
```

改为：
```ts
shareGemStopCondition: 'spiral' | 'count5' | 'count10' | 'count15' | 'count100';
```

- [ ] **Step 2: 增加目标数映射**

将目标数计算改为：
```ts
const targetCount = stopCond === 'count5' ? 5
  : stopCond === 'count10' ? 10
  : stopCond === 'count15' ? 15
  : stopCond === 'count100' ? 100
  : undefined;
```

- [ ] **Step 3: 扩展下拉类型并增加选项**

将 `onChange` 类型改为：
```ts
'spiral' | 'count5' | 'count10' | 'count15' | 'count100'
```

在 15 个选项后增加：
```tsx
<option value="count100">分享 100 个矿（测试）</option>
```

- [ ] **Step 4: 运行定向测试确认通过**

Run:
```bash
npx jest plugins/rok/actions/shareGemCount100.test.ts --runInBand
```

Expected: PASS，1 test passed。

### Task 3: 完整验证

**Files:**
- Verify: `plugins/rok/homeFeatures.ts`
- Verify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 运行后端 TypeScript 检查**

Run:
```bash
npx tsc --noEmit
```

Expected: exit 0，无 TypeScript 错误。

- [ ] **Step 2: 构建前端**

Run:
```bash
npm --prefix web run build
```

Expected: `tsc && vite build` 成功，生成 `web/dist`。

- [ ] **Step 3: 运行分享矿相关回归测试**

Run:
```bash
npx jest plugins/rok/actions/shareGemCount100.test.ts plugins/rok/actions/gatherSharedGem.test.ts plugins/rok/actions/collectSharedGemCoords.test.ts plugins/rok/state/sharedGemPool.test.ts --runInBand
```

Expected: 所有测试通过，无失败测试。

- [ ] **Step 4: 不提交代码**

本仓库当前存在用户未提交改动；除非用户明确要求，不执行 `git commit`。
