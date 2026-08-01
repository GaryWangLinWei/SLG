# 领取联盟领土收益 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增"领取联盟领土收益"首页开关与 4 小时 CD 子循环，自动打开联盟领土页领取收益。

**Architecture:** 新增独立 action `claim-alliance-territory`（复用 `ensureBottomBarState` 展开底部栏、`findImageWithLocation` 识别 `icon_lingtu.png`），注册进 ROK 插件；`homeFeatures.ts` 增加开关配置；Home.tsx 新增仿 `produceMaterialLoop` 的子循环负责 4 小时 CD 调度、锁竞争与轮次统计。

**Tech Stack:** TypeScript、Koa 插件框架（PluginContext）、React/Vite 前端、Jest 测试。

## Global Constraints

- 所有坐标基于 1600x900 分辨率（与 `helpTeammates.ts` 相同的硬编码风格）
- 领土按钮模板：`icon_lingtu.png`，匹配阈值 0.7
- CD：4 小时 × (0.85 + Math.random() * 0.3)，即 3.4~4.6 小时
- 流程第 5 步（关闭领土页）与第 6 步（关闭联盟页）之间等待 0.5s
- 开关名"领取联盟领土收益"，副文案"每4小时"；`autoWorldChat` 开启时禁用（与社交与辅助卡片内其他开关一致）
- 开关默认 `false`；旧配置缺字段由 `DEFAULT_HOME_FEATURES` 合并兜底
- 不引入新依赖
- 每次提交前运行：`npx tsc --noEmit`（根项目）与相关 Jest 测试

---

### Task 1: homeFeatures 配置字段 + 测试

**Files:**
- Modify: `plugins/rok/homeFeatures.ts`
- Test: `plugins/rok/homeFeatures.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `HomeFeatures.claimAllianceTerritoryEnabled: boolean`；`DEFAULT_HOME_FEATURES.claimAllianceTerritoryEnabled = false`

- [ ] **Step 1: 写失败测试**

在 `plugins/rok/homeFeatures.test.ts` 的 `describe('collect resources interval')` 之后追加：

```ts
describe('claim alliance territory', () => {
  it('defaults claimAllianceTerritoryEnabled to false', () => {
    expect(DEFAULT_HOME_FEATURES.claimAllianceTerritoryEnabled).toBe(false);
  });
});
```

同时把文件顶部 import 改为：

```ts
import { getCollectResourcesIntervalSeconds, DEFAULT_HOME_FEATURES } from './homeFeatures';
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest plugins/rok/homeFeatures.test.ts --runInBand`
Expected: FAIL — `DEFAULT_HOME_FEATURES.claimAllianceTerritoryEnabled` 为 `undefined`，`undefined !== false`

- [ ] **Step 3: 实现配置字段**

在 `plugins/rok/homeFeatures.ts` 的 `HomeFeatures` 接口中，`produceMaterialEnabled: boolean;` 之后加一行：

```ts
  claimAllianceTerritoryEnabled: boolean;
```

在 `DEFAULT_HOME_FEATURES` 中 `produceMaterialType: 'leather',` 之后加一行：

```ts
  claimAllianceTerritoryEnabled: false,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest plugins/rok/homeFeatures.test.ts --runInBand`
Expected: PASS（3 个原有用例 + 1 个新用例）

- [ ] **Step 5: 提交**

```bash
git add plugins/rok/homeFeatures.ts plugins/rok/homeFeatures.test.ts
git commit -m "feat(home): add claimAllianceTerritoryEnabled config field"
```

---

### Task 2: 新增 claimAllianceTerritory action

**Files:**
- Create: `plugins/rok/actions/claimAllianceTerritory.ts`

**Interfaces:**
- Consumes: `PluginContext`（`tap`、`sleep`、`findImageWithLocation`）、`ensureBottomBarState(ctx, 'expanded')`（来自 `../utils/location`）、`getTemplatesDir()`（来自 `../../../core/resourcePath`）
- Produces: `export async function claimAllianceTerritory(ctx: PluginContext): Promise<void>`

- [ ] **Step 1: 创建 action 文件**

创建 `plugins/rok/actions/claimAllianceTerritory.ts`，完整内容：

```ts
import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureBottomBarState } from '../utils/location';
import * as path from 'path';

// 1600x900 分辨率下的坐标（与 helpTeammates.ts 相同的硬编码风格）
const ALLIANCE_BUTTON = { x: 1164, y: 835 }; // 打开联盟页面
const CLOSE_BUTTON = { x: 1392, y: 56 };     // 关闭联盟/领土页面
const CLAIM_BUTTON = { x: 1268, y: 173 };    // 领取领土收益
const TERRITORY_TEMPLATE = 'icon_lingtu.png';
const TEMPLATE_THRESHOLD = 0.7;

export async function claimAllianceTerritory(ctx: PluginContext): Promise<void> {
  ctx.log('=== 领取联盟领土收益 ===');

  // 1. 展开底部栏（检测失败不阻断流程）
  await ensureBottomBarState(ctx, 'expanded');

  // 2. 打开联盟页面
  await ctx.tap(ALLIANCE_BUTTON.x, ALLIANCE_BUTTON.y);
  await ctx.sleep(1);

  // 3. 全屏识别领土按钮
  const templatePath = path.join(getTemplatesDir(), TERRITORY_TEMPLATE);
  try {
    const result = await ctx.findImageWithLocation(templatePath, TEMPLATE_THRESHOLD);
    if (!result.found) {
      ctx.log('未找到领土按钮，关闭联盟页面并结束');
      await ctx.tap(CLOSE_BUTTON.x, CLOSE_BUTTON.y);
      ctx.log('=== 领取联盟领土收益结束（未找到领土按钮） ===');
      return;
    }
    ctx.log(`找到领土按钮 (${result.x}, ${result.y})，点击`);
    await ctx.tap(result.x, result.y);
  } catch (e: any) {
    ctx.log(`领土按钮识别失败: ${e?.message || e}，按未找到处理`);
    await ctx.tap(CLOSE_BUTTON.x, CLOSE_BUTTON.y);
    ctx.log('=== 领取联盟领土收益结束（识别失败） ===');
    return;
  }
  await ctx.sleep(1);

  // 4. 点击领取按钮
  await ctx.tap(CLAIM_BUTTON.x, CLAIM_BUTTON.y);
  await ctx.sleep(0.5);

  // 5. 关闭领土页面
  await ctx.tap(CLOSE_BUTTON.x, CLOSE_BUTTON.y);
  await ctx.sleep(0.5);

  // 6. 关闭联盟页面
  await ctx.tap(CLOSE_BUTTON.x, CLOSE_BUTTON.y);

  ctx.log('=== 领取联盟领土收益完成 ===');
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS（无新增错误）

- [ ] **Step 3: 提交**

```bash
git add plugins/rok/actions/claimAllianceTerritory.ts
git commit -m "feat(rok): add claim alliance territory action"
```

---

### Task 3: 注册 action 并纳入模板文件

**Files:**
- Modify: `plugins/rok/index.ts`
- Include: `plugins/rok/templates/icon_lingtu.png`（工作区已有，尚未跟踪）

**Interfaces:**
- Consumes: Task 2 的 `claimAllianceTerritory(ctx)`
- Produces: action id `claim-alliance-territory` 可通过 `POST /api/tasks` 创建并运行

- [ ] **Step 1: 添加 import**

在 `plugins/rok/index.ts` 中 `import { helpTeammates } from './actions/helpTeammates';` 之后加：

```ts
import { claimAllianceTerritory } from './actions/claimAllianceTerritory';
```

- [ ] **Step 2: 注册 action**

在 `plugins/rok/index.ts` 的 `help-teammates` action 块（`},` 之后）与 `explore` action 块之间插入：

```ts
    {
      id: 'claim-alliance-territory',
      name: '领取联盟领土收益',
      description: '打开联盟领土页领取收益，每4小时执行',
      run: async (ctx) => {
        if (await ensureNoPopupBlocking(ctx, 'claim-alliance-territory')) return;
        await claimAllianceTerritory(ctx);
      }
    },
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/index.ts plugins/rok/templates/icon_lingtu.png
git commit -m "feat(rok): register claim-alliance-territory action and track territory template"
```

---

### Task 4: 前端开关 UI 与功能门控

**Files:**
- Modify: `web/src/pages/Home.tsx`

**Interfaces:**
- Consumes: Task 1 的 `features.claimAllianceTerritoryEnabled`
- Produces: 首页"社交与辅助"卡片出现开关；开启后 `hasAnyFeature` 校验通过；`computeExpectedActions` 输出 `alliance-territory`

- [ ] **Step 1: 添加开关 UI**

在 `web/src/pages/Home.tsx` 的"社交与辅助"卡片中，`自动帮助盟友` 的 `</div>` 之后（`自动开盾` 注释之前）插入：

```jsx
              {/* 领取联盟领土收益 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-indigo-100 rounded flex items-center justify-center text-xs">🏴</span>
                  领取联盟领土收益
                  <span className="text-xs text-slate-400">· 每4小时</span>
                </span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.claimAllianceTerritoryEnabled} disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, claimAllianceTerritoryEnabled: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.claimAllianceTerritoryEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.claimAllianceTerritoryEnabled ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
```

- [ ] **Step 2: 加入 hasAnyFeature 起始校验**

在 `web/src/pages/Home.tsx` 的 `features.produceMaterialEnabled ||` 与 `features.attackDetectEnabled;` 之间插入：

```ts
      features.claimAllianceTerritoryEnabled ||
```

- [ ] **Step 3: 加入 computeExpectedActions**

在 `web/src/pages/Home.tsx` 的 `if (f.produceMaterialEnabled) exp.add('produce-material');` 之后插入：

```ts
      if (f.claimAllianceTerritoryEnabled) exp.add('alliance-territory');
```

- [ ] **Step 4: 前端类型检查**

Run: `cd web; npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): add claim alliance territory toggle and round gating"
```

---

### Task 5: 前端 allianceTerritoryLoop 子循环

**Files:**
- Modify: `web/src/pages/Home.tsx`

**Interfaces:**
- Consumes: `createTask`、`api.tasks.run`、`acquireLock`/`releaseLock`、`ensureGameRunning`、`monotonicNow`、`cooldownResetSeq`、`markRoundDone('alliance-territory')`、`runningTaskIdsRef`、`pushLog`（均为 Home.tsx 已存在的局部机制，仿 `produceMaterialLoop`）
- Produces: 开启开关后每 3.4~4.6 小时执行一次 `claim-alliance-territory` 任务

- [ ] **Step 1: 添加子循环**

在 `web/src/pages/Home.tsx` 中 `produceMaterialLoop` 定义结束的 `})();` 与 `// 下线监控独立循环` 注释之间插入：

```ts
      // 领取联盟领土收益独立循环 — 每 4 小时执行一次
      const allianceTerritoryLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (!featuresRef.current.claimAllianceTerritoryEnabled || featuresRef.current.autoWorldChat) {
            await sleep(30);
            continue;
          }
          if (!await acquireLock()) continue;
          if (offlineActive) { releaseLock(); await sleep(30); continue; }
          await ensureGameRunning();
          try {
            const createResult = await createTask(currentAccountId, 'com.rok.automation', 'claim-alliance-territory');
            if (createResult.success) {
              runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
              setRunningTaskIds([...runningTaskIdsRef.current]);
              const runResult = await api.tasks.run(createResult.task.id);
              runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
              setRunningTaskIds([...runningTaskIdsRef.current]);
              const logs = runResult.task?.logs ?? [];
              const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
              if (hasExpiredLog) {
                pushLog(`⛔ 许可证已到期，停止运行`);
                loopStopped = true;
                setExpiredMessage('激活码已到期，请重新激活');
                refreshStatus();
              } else {
                pushLog(`🏴 领取联盟领土收益 完成`);
                markRoundDone('alliance-territory');
              }
            }
          } catch {} finally { releaseLock(); }
          // 已尝试执行本轮，等 4 小时（±15% 抖动）再触发下一次
          const intervalSec = 4 * 3600 * (0.85 + Math.random() * 0.3);
          const startWait = monotonicNow();
          const waitSeq = cooldownResetSeq;
          while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < intervalSec * 1000) {
            await sleep(1);
          }
        }
      })();
```

- [ ] **Step 2: 加入 Promise.all**

将 `web/src/pages/Home.tsx` 中：

```ts
      await Promise.all([helpLoop, collectLoop, gatherLoop, rallyLoop, exploreLoop, caveLoop, produceMaterialLoop, offlineLoop, attackLoop, accountSwitchLoop, shareGemLoop]);
```

改为：

```ts
      await Promise.all([helpLoop, collectLoop, gatherLoop, rallyLoop, exploreLoop, caveLoop, produceMaterialLoop, allianceTerritoryLoop, offlineLoop, attackLoop, accountSwitchLoop, shareGemLoop]);
```

- [ ] **Step 3: 前端类型检查**

Run: `cd web; npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): add 4h alliance territory claim loop"
```

---

### Task 6: 最终验证与收尾

**Files:**
- 无新改动；只运行验证命令

- [ ] **Step 1: 根项目类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: 相关测试**

Run: `npx jest plugins/rok/homeFeatures.test.ts --runInBand`
Expected: PASS

- [ ] **Step 3: 前端完整构建**

Run: `cd web; npm run build`
Expected: `tsc` 通过且 Vite 构建成功，`web/dist` 更新

- [ ] **Step 4: 确认 git 状态与提交日志**

Run: `git status --short`、`git log --oneline -8`
Expected: 工作区无未提交改动（除 `web/dist` 等忽略项）；提交日志包含本功能 6 个提交

---

## Self-Review（写完后由主代理执行）

1. **Spec coverage**：规格中所有需求（7 步流程、4h CD、社交与辅助卡片开关、错误处理、模板提交）均有对应任务。
2. **Placeholder scan**：所有步骤含具体代码与命令，无 TBD/TODO。
3. **Type consistency**：`claimAllianceTerritoryEnabled`、`claimAllianceTerritory`、`claim-alliance-territory`、`alliance-territory`、`allianceTerritoryLoop` 五个标识符在各任务间一致。
