# 生产装备材料 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首页"社交与辅助"卡片新增"生产装备材料"开关和材料选择，触发时进入铁匠铺 → 生产材料界面 → 点击选中材料 2 或 3 次 → 关闭；主循环每 2~4 小时随机执行一次。

**Architecture:** 新增 `produceEquipMaterial` action（复用 `resetCityView` + `swipeBuildingToCenter` + `findImageWithLocation`），通过 `plugins/rok/index.ts` 注册；`HomeFeatures` 加两字段（开关 + 材料枚举）；`Home.tsx` 加 UI 和独立 loop，间隔在 loop 内硬编码 `randRange(2h, 4h)`。

**Tech Stack:** TypeScript, React, PluginContext（tap/sleep/captureRegion/findImageWithLocation）。

规格文档：`docs/superpowers/specs/2026-07-06-produce-equip-material-design.md`

---

## File Structure

- **Create**：`plugins/rok/actions/produceEquipMaterial.ts` — action 实现
- **Modify**：`plugins/rok/homeFeatures.ts` — 加 `produceMaterialEnabled` + `produceMaterialType`
- **Modify**：`plugins/rok/index.ts` — import + 注册 action
- **Modify**：`web/src/pages/Home.tsx` — 社交与辅助卡片加 UI + 新增 produceMaterial loop
- **User-provided**：`plugins/rok/templates/btn_produce_material.png` — 生产材料按钮模板（用户自备）

---

### Task 1: HomeFeatures 加字段

**Files:**
- Modify: `plugins/rok/homeFeatures.ts`

- [ ] **Step 1: 在 `HomeFeatures` 接口末尾加两字段**

编辑 `plugins/rok/homeFeatures.ts`，在 `joinRallyMaxDistance: number;` 后加：

```ts
  produceMaterialEnabled: boolean;
  produceMaterialType: 'leather' | 'iron' | 'ebony' | 'bone';
```

- [ ] **Step 2: 在 `DEFAULT_HOME_FEATURES` 末尾加默认值**

在 `joinRallyMaxDistance: 50,` 后加：

```ts
  produceMaterialEnabled: false,
  produceMaterialType: 'leather',
```

- [ ] **Step 3: 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误（此时字段已定义但未被使用，OK）

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/homeFeatures.ts
git commit -m "feat(home): HomeFeatures 新增 produceMaterial 字段"
```

---

### Task 2: 新建 produceEquipMaterial action

**Files:**
- Create: `plugins/rok/actions/produceEquipMaterial.ts`

- [ ] **Step 1: 写 action 文件**

新建 `plugins/rok/actions/produceEquipMaterial.ts`，完整内容：

```ts
import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView, swipeBuildingToCenter } from '../utils/location';
import { getTemplatesDir } from '../../../core/resourcePath';
import * as path from 'path';

const TEMPLATE_DIR = getTemplatesDir();
const PRODUCE_BTN_TEMPLATE = path.join(TEMPLATE_DIR, 'btn_produce_material.png');

export type MaterialType = 'leather' | 'iron' | 'ebony' | 'bone';

const MATERIAL_REGIONS: Record<MaterialType, { x1: number; y1: number; x2: number; y2: number; label: string }> = {
  leather: { x1: 918,  y1: 256, x2: 989,  y2: 323, label: '皮革' },
  iron:    { x1: 1035, y1: 257, x2: 1103, y2: 326, label: '铁矿石' },
  ebony:   { x1: 1152, y1: 260, x2: 1222, y2: 325, label: '乌木' },
  bone:    { x1: 1269, y1: 260, x2: 1336, y2: 325, label: '兽骨' },
};

const CLOSE_BUTTON = { x: 1363, y: 103 };
const BUILDING_KEY = '铁匠铺';

export type ProduceMaterialResult = 'success' | 'no_produce_button' | 'no_building';

/**
 * 铁匠铺生产装备材料：
 * 1. 重置城内视角
 * 2. 拖动铁匠铺到中心并点击
 * 3. 识别"生产材料"入口按钮，未识别到 → 返回 no_produce_button
 * 4. 点击进入材料界面
 * 5. 点击对应材料区域中心 2 或 3 次（本次 action 随机决定）
 * 6. 点击关闭按钮
 */
export async function produceEquipMaterial(
  ctx: PluginContext,
  config: RokConfig,
  material: MaterialType,
): Promise<ProduceMaterialResult> {
  const buildPos = config.buildingPositions[BUILDING_KEY];
  if (!buildPos) {
    ctx.log(`❌ 未找到建筑坐标: ${BUILDING_KEY}`);
    return 'no_building';
  }

  const region = MATERIAL_REGIONS[material];
  ctx.log(`=== 开始生产装备材料 (${region.label}) ===`);

  // 1. 重置城内视角
  await resetCityView(ctx, config);

  // 2. 拖动铁匠铺到中心并点击
  await swipeBuildingToCenter(ctx, buildPos, BUILDING_KEY);
  await ctx.sleep(1);

  // 3. 识别"生产材料"入口按钮
  ctx.log('[3/6] 识别生产材料按钮');
  const btn = await ctx.findImageWithLocation(PRODUCE_BTN_TEMPLATE, 0.7, [0.7, 0.8, 0.9, 1.0, 1.1]);
  if (!btn.found) {
    ctx.log(`  ❌ 未找到生产材料按钮（可能铁匠铺等级不足或未解锁），结束 (confidence: ${btn.confidence.toFixed(3)})`);
    return 'no_produce_button';
  }
  ctx.log(`  ✅ 找到生产材料按钮 (${btn.x}, ${btn.y})，置信度: ${btn.confidence.toFixed(3)}`);

  // 4. 点击进入材料界面
  ctx.log(`[4/6] 点击生产材料按钮`);
  await ctx.tap(btn.x, btn.y);
  await ctx.sleep(1.5);

  // 5. 点击材料 2 或 3 次
  const times = 2 + Math.floor(Math.random() * 2); // 2 or 3
  const cx = Math.round((region.x1 + region.x2) / 2);
  const cy = Math.round((region.y1 + region.y2) / 2);
  ctx.log(`[5/6] 点击 ${region.label} (${cx}, ${cy}) ${times} 次`);
  for (let i = 0; i < times; i++) {
    await ctx.tap(cx, cy);
    // 每次间隔 0.4~0.8 秒
    await ctx.sleep(0.4 + Math.random() * 0.4);
  }

  // 6. 关闭
  ctx.log(`[6/6] 关闭材料界面 (${CLOSE_BUTTON.x}, ${CLOSE_BUTTON.y})`);
  await ctx.tap(CLOSE_BUTTON.x, CLOSE_BUTTON.y);
  await ctx.sleep(1);

  ctx.log(`=== 生产装备材料完成 (${region.label} × ${times}) ===`);
  return 'success';
}
```

- [ ] **Step 2: 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误（模板文件不存在不会阻塞编译，运行时才失败）

- [ ] **Step 3: 提交**

```bash
git add plugins/rok/actions/produceEquipMaterial.ts
git commit -m "feat(rok): 新增生产装备材料 action"
```

---

### Task 3: 注册 action 到插件

**Files:**
- Modify: `plugins/rok/index.ts`

- [ ] **Step 1: 加 import**

在 `plugins/rok/index.ts` 顶部 import 区（跟其他 action import 放一起，例如 `import { caveExplore, resetCaveExploreState } from './actions/caveExplore';` 附近）加：

```ts
import { produceEquipMaterial, MaterialType } from './actions/produceEquipMaterial';
```

- [ ] **Step 2: 注册 action**

在 actions 列表中（例如 `cave-explore` action 之后），插入：

```ts
    {
      id: 'produce-equip-material',
      name: '生产装备材料',
      description: '在铁匠铺生产指定装备材料',
      run: async (ctx, params: { material?: MaterialType } = {}) => {
        const config = ctx.getConfig('rokConfig', DEFAULT_ROK_CONFIG);
        const material = params.material || 'leather';
        const result = await produceEquipMaterial(ctx, config, material);
        ctx.log(`生产装备材料: ${result}`);
      }
    },
```

- [ ] **Step 3: 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/index.ts
git commit -m "feat(rok): 注册 produce-equip-material action"
```

---

### Task 4: 前端 UI — 社交与辅助卡片加开关和材料下拉

**Files:**
- Modify: `web/src/pages/Home.tsx`

**位置参考：** `web/src/pages/Home.tsx:2379`（`{/* 山洞探索 */}` 那一块）后面、卡片闭合 `</div>` (2395 行附近) 之前插入。

- [ ] **Step 1: 在山洞探索区块后插入生产装备材料区块**

在 `{/* 山洞探索 */}` 那一整块 div（结尾 `</div>` 大约在 2394 行）之后插入：

```tsx
              {/* 生产装备材料 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-orange-100 rounded flex items-center justify-center text-xs">⚒️</span>
                  生产装备材料
                  <select
                    value={features.produceMaterialType}
                    disabled={features.autoExplore || features.autoWorldChat || !features.produceMaterialEnabled}
                    onChange={(e) => setFeatures({ ...features, produceMaterialType: e.target.value as 'leather' | 'iron' | 'ebony' | 'bone' })}
                    className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-xs disabled:opacity-50"
                  >
                    <option value="leather">皮革</option>
                    <option value="iron">铁矿石</option>
                    <option value="ebony">乌木</option>
                    <option value="bone">兽骨</option>
                  </select>
                  <span className="text-xs text-slate-400">· 每2~4小时</span>
                </span>
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${(features.autoExplore || features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={features.produceMaterialEnabled}
                    disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, produceMaterialEnabled: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.produceMaterialEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.produceMaterialEnabled ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
```

- [ ] **Step 2: 更新 `hasWork` / hasMainWork 判定（可选）**

在文件里 grep `features.autoCaveExplore ||`（大约 Home.tsx:610），若存在类似"任何功能开启就视为有工作"的判定条件，加上 `features.produceMaterialEnabled ||`。若无对应处，跳过此步。

Run: `grep -n "features.autoCaveExplore" web/src/pages/Home.tsx`
根据结果决定是否修改。

- [ ] **Step 3: 编译检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): 社交与辅助卡片新增生产装备材料开关和材料选择"
```

---

### Task 5: 前端主循环 — produceMaterial loop

**Files:**
- Modify: `web/src/pages/Home.tsx`

**参考模式：** `web/src/pages/Home.tsx:973-1018` 的 `caveLoop`。

- [ ] **Step 1: 在 caveLoop 之后插入 produceMaterialLoop**

在 `caveLoop` 那个 IIFE（结尾 `})();` 大约在 1018 行）之后插入：

```tsx
      // 生产装备材料独立循环（每 2~4 小时随机）
      const produceMaterialLoop = (async () => {
        let first = true;
        while (!loopStopped) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (features.produceMaterialEnabled && !features.autoExplore && !features.autoWorldChat) {
            if (!buildingOptions.includes('铁匠铺')) {
              pushLog(`⚠️ 未标记铁匠铺位置，跳过生产装备材料`);
            } else {
              if (!await acquireLock()) break;
              if (offlineActive) { releaseLock(); await sleep(30); continue; }
              await ensureGameRunning();
              try {
                const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', 'produce-equip-material', { material: features.produceMaterialType });
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
                    pushLog(`⚒️ 生产装备材料 完成`);
                  }
                }
              } catch {} finally { releaseLock(); }
            }
          }
          // 2~4 小时随机
          const intervalSec = (2 + Math.random() * 2) * 3600;
          const startWait = monotonicNow();
          while (!loopStopped && (monotonicNow() - startWait) < intervalSec * 1000) {
            await sleep(1);
          }
        }
      })();
```

- [ ] **Step 2: 把 produceMaterialLoop 加入 Promise.all（若存在）**

查找 caveLoop 后如何等待所有 loop 完成。Run:

```bash
grep -n "caveLoop\|Promise.all" web/src/pages/Home.tsx | head -10
```

若发现有 `await Promise.all([...caveLoop...])` 类结构，把 `produceMaterialLoop` 也加进数组。若循环使用 fire-and-forget 模式（IIFE 独立执行），无需修改。

- [ ] **Step 3: 检查 api.tasks.create 支持第 4 参数**

Run:
```bash
grep -n "tasks: {" web/src/api/client.ts
```
查看 `api.tasks.create` 是否支持传参 params（应有第 4 个参数）。查看现有 `rally-fort` 等 action 的调用示例：

```bash
grep -n "api.tasks.create.*rally-fort\|api.tasks.create.*com.rok" web/src/pages/Home.tsx | head -5
```

按现有调用签名调整第 4 参数格式（可能是 `{ params: {...} }` 或直接 `{...}`）。

- [ ] **Step 4: 编译检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): 新增生产装备材料主循环（2~4小时随机）"
```

---

### Task 6: 用户准备模板图 + 最终验证

**Files:**
- User-provided: `plugins/rok/templates/btn_produce_material.png`

- [ ] **Step 1: 提示用户放置模板图**

告知用户：请在 `plugins/rok/templates/` 下放置 `btn_produce_material.png`（铁匠铺点击后弹出的"生产材料"按钮截图）。

- [ ] **Step 2: 后端编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 前端编译**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 手动测试（用户运行）**

启动服务后：
1. 在坐标配置页标记铁匠铺位置
2. Home 页社交与辅助卡片开启"生产装备材料"，选一种材料
3. 观察日志：视角回城内 → 铁匠铺居中 → 识别按钮 → 进入材料界面 → 点击 2 或 3 次 → 关闭
4. 未开启开关：主循环不触发
5. 铁匠铺等级不够（识别不到生产材料按钮）：log 提示后正常结束，不报错

- [ ] **Step 5: 若模板已就绪，提交模板**

```bash
git add plugins/rok/templates/btn_produce_material.png
git commit -m "feat(rok): 添加生产材料按钮模板图"
```

---

## Self-Review

- ✅ Spec 全部覆盖：action / HomeFeatures / UI / 循环 / 模板 / 注册
- ✅ 无占位符
- ✅ 类型一致（`MaterialType`、`produceMaterialType` 全流程 4 值枚举）
- ✅ 材料坐标写死为常量 map，跟 spec 一致
- ✅ 循环间隔 `(2 + Math.random() * 2) * 3600` 秒 = 2~4h 随机，符合 spec

---

Plan complete and saved to `docs/superpowers/plans/2026-07-06-produce-equip-material.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
