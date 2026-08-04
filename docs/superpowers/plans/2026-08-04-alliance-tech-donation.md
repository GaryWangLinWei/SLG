# 联盟科技捐献 + 联盟功能卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增"联盟科技捐献"定时 action，并把自动帮助盟友、领取联盟领土收益、联盟科技捐献合并到首页新卡片"联盟功能"。

**Architecture:** 后端新增独立 action `donate-alliance-tech`（模板匹配定位推荐图标与捐献按钮 + OCR 读剩余次数 + 按次数点击），在 `plugins/rok/index.ts` 注册；前端 `homeFeatures.ts` 加开关，`Home.tsx` 新增 4 小时 CD 子循环并把三个联盟相关开关归入新卡片。纯函数 `parseDonateCount` 用 TDD 单测覆盖，action 本体不写单测（依赖真实截图链路，与现有联盟 action 一致）。

**Tech Stack:** TypeScript、Koa 插件运行时、sharp、tesseract.js（ocrService.readTeamCount）、React + Vite、Jest + ts-jest。

参考 spec：`docs/superpowers/specs/2026-08-04-alliance-tech-donation-design.md`
参考同类实现：`plugins/rok/actions/claimAllianceTerritory.ts`、`web/src/pages/Home.tsx` 的 `allianceTerritoryLoop`（约 1786 行）。

---

## File Structure

- 新增 `plugins/rok/actions/donateAllianceTech.ts` — action 实现 + 导出纯函数 `parseDonateCount`、常量 `DONATE_FALLBACK_CLICKS`
- 新增 `plugins/rok/actions/donateAllianceTech.test.ts` — `parseDonateCount` 单测
- 修改 `plugins/rok/index.ts` — import 并注册 `donate-alliance-tech`
- 修改 `plugins/rok/homeFeatures.ts` — `HomeFeatures` 与默认值加 `donateAllianceTechEnabled`
- 修改 `web/src/pages/Home.tsx` — hasAnyFeature、computeExpectedActions、新卡片 UI、新子循环 `allianceTechLoop`、加入 Promise.all
- 素材已存在：`plugins/rok/templates/lianmeng/icon_tuijian.png`、`btn_juanxian.png`（无需新增）

---

### Task 1: parseDonateCount 纯函数（TDD）

**Files:**
- Create: `plugins/rok/actions/donateAllianceTech.ts`
- Test: `plugins/rok/actions/donateAllianceTech.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `plugins/rok/actions/donateAllianceTech.test.ts`：

```ts
import { parseDonateCount, DONATE_FALLBACK_CLICKS } from './donateAllianceTech';

describe('parseDonateCount', () => {
  it('parses the number before slash', () => {
    expect(parseDonateCount('17/20')).toBe(17);
  });

  it('parses zero', () => {
    expect(parseDonateCount('0/20')).toBe(0);
  });

  it('parses max 20', () => {
    expect(parseDonateCount('20/20')).toBe(20);
  });

  it('clamps above 20 down to 20', () => {
    expect(parseDonateCount('25/20')).toBe(20);
    expect(parseDonateCount('99/20')).toBe(20);
  });

  it('returns -1 (fallback sentinel) on unparseable input', () => {
    expect(parseDonateCount(' /20')).toBe(-1);
    expect(parseDonateCount('')).toBe(-1);
    expect(parseDonateCount('abc')).toBe(-1);
    expect(parseDonateCount('/20')).toBe(-1);
  });

  it('parses a bare number with no slash', () => {
    expect(parseDonateCount('7')).toBe(7);
  });

  it('fallback constant is 10', () => {
    expect(DONATE_FALLBACK_CLICKS).toBe(10);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行（仓库根目录）：

```bash
npx jest plugins/rok/actions/donateAllianceTech.test.ts --runInBand
```

Expected: FAIL，报错 `Cannot find module './donateAllianceTech'` 或 `parseDonateCount is not a function`。

- [ ] **Step 3: 写最小实现**

创建 `plugins/rok/actions/donateAllianceTech.ts`，先只放纯函数（action 主体在 Task 2 加）：

```ts
export const DONATE_FALLBACK_CLICKS = 10;

/**
 * 从 OCR 文本（如 "17/20"）解析可捐献次数。
 * @returns 0–20 的整数；无法解析返回 -1，表示调用方应使用 DONATE_FALLBACK_CLICKS。
 */
export function parseDonateCount(text: string): number {
  const trimmed = (text || '').trim();
  let numStr: string | undefined;
  const slash = trimmed.indexOf('/');
  if (slash >= 0) {
    numStr = trimmed.slice(0, slash);
  } else {
    const m = trimmed.match(/\d+/);
    numStr = m ? m[0] : undefined;
  }
  if (!numStr) return -1;
  const n = parseInt(numStr.replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return -1;
  return Math.max(0, Math.min(20, n));
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx jest plugins/rok/actions/donateAllianceTech.test.ts --runInBand
```

Expected: PASS，7 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add plugins/rok/actions/donateAllianceTech.ts plugins/rok/actions/donateAllianceTech.test.ts
git commit -m "feat(alliance): add parseDonateCount with tests"
```

---

### Task 2: 实现 donateAllianceTech action 主体

**Files:**
- Modify: `plugins/rok/actions/donateAllianceTech.ts`

参考 `plugins/rok/actions/claimAllianceTerritory.ts` 的整体风格（命名常量、ensureBottomBarState、findImageWithLocation、每步 sleep、日志）。

- [ ] **Step 1: 在文件顶部补充 import 与常量**

把 `donateAllianceTech.ts` 顶部改成（保留 Task 1 的纯函数）：

```ts
import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ensureBottomBarState } from '../utils/location';
import { ocrService } from '../../../core/ocr/OcrService';
import * as path from 'path';
import * as fs from 'fs/promises';

export const DONATE_FALLBACK_CLICKS = 10;

const ALLIANCE_BUTTON = { x: 1165, y: 838 };
const TECH_BUTTON = { x: 879, y: 689 };
const TUIJIAN_OFFSET = { dx: 50, dy: 50 };
const CLOSE_DONATE = { x: 1363, y: 103 };
const CLOSE_TECH = { x: 1394, y: 91 };
const CLOSE_ALLIANCE = { x: 1394, y: 55 };
const JUANXIAN_REGION = { x: 1107, y: 663, width: 233, height: 58 };
const COUNT_REGION = { x: 1240, y: 636, width: 62, height: 30 };
const THRESHOLD = 0.7;

const TUIJIAN_TEMPLATE = path.join(getTemplatesDir(), 'lianmeng', 'icon_tuijian.png');
const JUANXIAN_TEMPLATE = path.join(getTemplatesDir(), 'lianmeng', 'btn_juanxian.png');
```

- [ ] **Step 2: 追加 action 函数**

在 `parseDonateCount` 函数之后追加：

```ts
export async function donateAllianceTech(ctx: PluginContext): Promise<void> {
  ctx.log('=== 联盟科技捐献 ===');

  // 1. 展开底部栏
  await ensureBottomBarState(ctx, 'expanded');

  // 2. 打开联盟界面
  await ctx.tap(ALLIANCE_BUTTON.x, ALLIANCE_BUTTON.y);
  await ctx.sleep(1.5);

  // 3. 打开科技界面
  await ctx.tap(TECH_BUTTON.x, TECH_BUTTON.y);
  await ctx.sleep(1.5);

  // 4. 识别推荐科技
  const tuijian = await ctx.findImageWithLocation(TUIJIAN_TEMPLATE, THRESHOLD);
  if (!tuijian.found) {
    ctx.log('未找到推荐科技图标，关闭科技与联盟界面，结束');
    await ctx.tap(CLOSE_TECH.x, CLOSE_TECH.y);
    await ctx.sleep(0.3);
    await ctx.tap(CLOSE_ALLIANCE.x, CLOSE_ALLIANCE.y);
    ctx.log('=== 联盟科技捐献结束（无推荐科技） ===');
    return;
  }

  // 5. 进入推荐科技捐献界面
  await ctx.tap(tuijian.x + TUIJIAN_OFFSET.dx, tuijian.y + TUIJIAN_OFFSET.dy);
  await ctx.sleep(1.5);

  // 6. 区域内识别捐献按钮
  const btn = await ctx.findImageWithLocation(
    JUANXIAN_TEMPLATE, THRESHOLD, undefined, undefined, undefined, JUANXIAN_REGION,
  );
  if (!btn.found) {
    ctx.log('❌ 找不到捐献按钮，关闭所有弹窗后结束');
    await closeAll(ctx);
    ctx.log('=== 联盟科技捐献结束（找不到捐献按钮） ===');
    return;
  }
  ctx.log(`找到捐献按钮 (${btn.x}, ${btn.y})，confidence=${btn.confidence.toFixed(3)}`);

  // 7. OCR 读取剩余次数
  let clicks = DONATE_FALLBACK_CLICKS;
  const regionPath = await ctx.captureRegion(COUNT_REGION.x, COUNT_REGION.y, COUNT_REGION.width, COUNT_REGION.height);
  try {
    const text = await ocrService.readTeamCount(regionPath);
    const n = parseDonateCount(text);
    if (n < 0) {
      ctx.log(`⚠️ 次数 OCR 解析失败，原文="${text.trim()}"，兜底点击 ${DONATE_FALLBACK_CLICKS} 次`);
    } else {
      clicks = n;
      ctx.log(`OCR 剩余捐献次数: ${clicks}/20（原文="${text.trim()}"）`);
    }
  } catch (e: any) {
    ctx.log(`⚠️ 次数 OCR 异常: ${e?.message || e}，兜底点击 ${DONATE_FALLBACK_CLICKS} 次`);
  } finally {
    await fs.unlink(regionPath).catch(() => {});
  }

  // 8. 按次数点击捐献按钮
  if (clicks > 0) {
    for (let i = 0; i < clicks; i++) {
      await ctx.tap(btn.x, btn.y);
      await ctx.sleep(0.5);
    }
    ctx.log(`✅ 已捐献 ${clicks} 次`);
  } else {
    ctx.log('可捐献次数为 0，跳过点击');
  }

  await closeAll(ctx);
  ctx.log('=== 联盟科技捐献完成 ===');
}

/** 关闭捐献弹窗 → 科技界面 → 联盟界面 */
async function closeAll(ctx: PluginContext): Promise<void> {
  await ctx.tap(CLOSE_DONATE.x, CLOSE_DONATE.y);
  await ctx.sleep(0.3);
  await ctx.tap(CLOSE_TECH.x, CLOSE_TECH.y);
  await ctx.sleep(0.3);
  await ctx.tap(CLOSE_ALLIANCE.x, CLOSE_ALLIANCE.y);
}
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit
```

Expected: 无输出（通过）。如果报 `ocrService` 或其它导出名不对，对照 `core/ocr/OcrService.ts` 修正。

- [ ] **Step 4: 重新运行单测确认未破坏**

```bash
npx jest plugins/rok/actions/donateAllianceTech.test.ts --runInBand
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add plugins/rok/actions/donateAllianceTech.ts
git commit -m "feat(alliance): add donateAllianceTech action"
```

---

### Task 3: 注册 action

**Files:**
- Modify: `plugins/rok/index.ts`

- [ ] **Step 1: 添加 import**

在 `plugins/rok/index.ts` 顶部找到（约第 8-9 行）：

```ts
import { helpTeammates } from './actions/helpTeammates';
import { claimAllianceTerritory } from './actions/claimAllianceTerritory';
```

在其后追加：

```ts
import { donateAllianceTech } from './actions/donateAllianceTech';
```

- [ ] **Step 2: 注册 action**

找到 `claim-alliance-territory` 的注册项（约 604-611 行）：

```ts
      id: 'claim-alliance-territory',
      name: '领取联盟领土收益',
      description: '打开联盟领土页领取收益，每4小时执行',
      run: async (ctx) => {
        if (await ensureNoPopupBlocking(ctx, 'claim-alliance-territory')) return;
        await claimAllianceTerritory(ctx);
      }
```

在该对象的结束 `}` 之后（数组下一项之前）插入：

```ts
      id: 'donate-alliance-tech',
      name: '联盟科技捐献',
      description: '打开联盟科技，按推荐科技捐献剩余次数，每4小时执行',
      run: async (ctx) => {
        if (await ensureNoPopupBlocking(ctx, 'donate-alliance-tech')) return;
        await donateAllianceTech(ctx);
      }
```

注意保持该数组里对象之间的逗号分隔。

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit
```

Expected: 无输出。

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/index.ts
git commit -m "feat(alliance): register donate-alliance-tech action"
```

---

### Task 4: 新增配置字段

**Files:**
- Modify: `plugins/rok/homeFeatures.ts`

- [ ] **Step 1: 接口加字段**

在 `plugins/rok/homeFeatures.ts` 的 `HomeFeatures` 接口中，找到：

```ts
  claimAllianceTerritoryEnabled: boolean;
```

在其后追加：

```ts
  donateAllianceTechEnabled: boolean;
```

- [ ] **Step 2: 默认值加字段**

在 `DEFAULT_HOME_FEATURES` 中找到：

```ts
  claimAllianceTerritoryEnabled: false,
```

在其后追加：

```ts
  donateAllianceTechEnabled: false,
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit
```

Expected: 无输出。

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/homeFeatures.ts
git commit -m "feat(alliance): add donateAllianceTechEnabled feature flag"
```

---

### Task 5: 前端 hasAnyFeature 与 computeExpectedActions

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: hasAnyFeature 加入新开关**

在 `Home.tsx` 中找到（约 817 行）：

```ts
      (features.claimAllianceTerritoryEnabled) ||
```

在其后追加一行：

```ts
      (features.donateAllianceTechEnabled) ||
```

- [ ] **Step 2: computeExpectedActions 加入新动作**

在 `Home.tsx` 中找到（约 967 行）：

```ts
      if (f.claimAllianceTerritoryEnabled) exp.add('alliance-territory');
```

在其后追加：

```ts
      if (f.donateAllianceTechEnabled) exp.add('alliance-tech');
```

- [ ] **Step 3: 提交（先不做类型检查，Task 8 统一验）**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(alliance): wire donate flag into feature checks"
```

---

### Task 6: 新增 allianceTechLoop 子循环

**Files:**
- Modify: `web/src/pages/Home.tsx`

参考现有 `allianceTerritoryLoop`（约 1785-1820 行）。

- [ ] **Step 1: 插入新循环**

找到 `allianceTerritoryLoop` 的结束 `})();`（在 `await Promise.all([...])` 之前），紧接其后插入：

```ts
      // 联盟科技捐献独立循环 —— 每 4 小时执行一次
      const allianceTechLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (!featuresRef.current.donateAllianceTechEnabled || featuresRef.current.autoWorldChat) {
            await sleep(30); continue;
          }
          if (!await acquireLock()) continue;
          if (offlineActive) { releaseLock(); await sleep(30); continue; }
          await ensureGameRunning();
          try {
            const createResult = await createTask(currentAccountId, 'com.rok.automation', 'donate-alliance-tech');
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
                pushLog(`🔬 联盟科技捐献 完成`);
                markRoundDone('alliance-tech');
              }
            }
          } catch {} finally { releaseLock(); }

          const intervalSec = 4 * 3600 * (0.85 + Math.random() * 0.3); // 3.4~4.6 小时
          const startWait = monotonicNow();
          const waitSeq = cooldownResetSeq;
          while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < intervalSec * 1000) {
            await sleep(1);
          }
        }
      })();
```

- [ ] **Step 2: 加入 Promise.all**

找到末尾（约 2336 行）：

```ts
      await Promise.all([helpLoop, collectLoop, gatherLoop, rallyLoop, exploreLoop, caveLoop, produceMaterialLoop, allianceTerritoryLoop, offlineLoop, attackLoop, accountSwitchLoop, shareGemLoop]);
```

在 `allianceTerritoryLoop` 之后加入 `allianceTechLoop`：

```ts
      await Promise.all([helpLoop, collectLoop, gatherLoop, rallyLoop, exploreLoop, caveLoop, produceMaterialLoop, allianceTerritoryLoop, allianceTechLoop, offlineLoop, attackLoop, accountSwitchLoop, shareGemLoop]);
```

- [ ] **Step 3: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(alliance): add allianceTechLoop 4h scheduler"
```

---

### Task 7: 新建"联盟功能"卡片并迁出两个开关

**Files:**
- Modify: `web/src/pages/Home.tsx`

当前"自动帮助盟友"和"领取联盟领土收益"在"社交与辅助"卡片内（约 3601-3628 行）。要把这两项从该卡片删除，新建一个"联盟功能"卡片放在它之前或之后。

- [ ] **Step 1: 从"社交与辅助"卡片删除两个开关块**

在"社交与辅助"卡片（`<div ... 社交与辅助`）内，删除以下两个整块（"自动帮助盟友"块和"领取联盟领土收益"块），保留"自动开盾"及其后内容：

删除从 `{/* 自动帮助盟友 */}` 到其闭合 `</div>` 的整块，以及从 `{/* 领取联盟领土收益 */}` 到其闭合 `</div>` 的整块。这两块结构相同，形如：

```tsx
              {/* 自动帮助盟友 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                ...
              </div>
```

- [ ] **Step 2: 在"社交与辅助"卡片之前插入新卡片**

在"社交与辅助"卡片的外层 `<div className="flex flex-col gap-0 p-4 ... 社交与辅助">` 之前，插入：

```tsx
            {/* 联盟功能 */}
            <div className="flex flex-col gap-0 p-4 rounded-lg transition-colors border border-slate-200 hover:border-slate-300">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-base">🏛️</span>
                <span className="font-semibold text-sm text-slate-800">联盟功能</span>
              </div>
              {/* 自动帮助盟友 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-purple-100 rounded flex items-center justify-center text-xs">🤝</span>
                  自动帮助盟友
                </span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.helpTeammates} disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, helpTeammates: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.helpTeammates ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.helpTeammates ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              {/* 领取联盟领土收益 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-indigo-100 rounded flex items-center justify-center text-xs">🚩</span>
                  领取联盟领土收益
                </span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.claimAllianceTerritoryEnabled} disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, claimAllianceTerritoryEnabled: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.claimAllianceTerritoryEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.claimAllianceTerritoryEnabled ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              {/* 联盟科技捐献 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-sky-100 rounded flex items-center justify-center text-xs">🔬</span>
                  联盟科技捐献
                </span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.donateAllianceTechEnabled} disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, donateAllianceTechEnabled: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.donateAllianceTechEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.donateAllianceTechEnabled ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
            </div>
```

- [ ] **Step 3: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(alliance): add 联盟功能 card grouping alliance features"
```

---

### Task 8: 全量类型检查与相关测试

**Files:** 无修改，仅验证。

- [ ] **Step 1: 根项目类型检查**

```bash
npx tsc --noEmit
```

Expected: 无输出。

- [ ] **Step 2: 前端类型检查**

```bash
cd web && VITE_APP_EDITION=main npx tsc --noEmit
```

Expected: 无输出。完成后回到仓库根目录：`cd ..`

- [ ] **Step 3: 运行新增与相关单测**

```bash
npx jest plugins/rok/actions/donateAllianceTech.test.ts --runInBand
```

Expected: PASS。

- [ ] **Step 4: 手动验证清单（交付前在模拟器跑一次）**

确认以下真实流程（非自动化）：

1. 首页出现"联盟功能"卡片，含三个开关；原"社交与辅助"卡片不再含前两项，自动开盾仍在。
2. 开启"联盟科技捐献"，开始运行，观察日志：
   - 展开底部栏 → 打开联盟 → 打开科技
   - 识别到推荐图标 → 进入捐献弹窗
   - 识别到捐献按钮并打印坐标/置信度
   - OCR 读到 `N/20`，按 N 次点击（或在 OCR 失败时兜底 10 次并打 ⚠️）
   - 依次关闭三层弹窗
3. 无推荐科技时：日志"未找到推荐科技图标"，只关两层，游戏不残留在联盟界面。
4. 找不到捐献按钮时：日志"找不到捐献按钮"，三层全部关闭。
5. 切号 per-round 模式下，捐献完成能推进本轮进度（`markRoundDone('alliance-tech')`）。

- [ ] **Step 5: 如有类型错误修复后提交**

若 Step 1/2 发现错误，修复后：

```bash
git add -A
git commit -m "fix(alliance): resolve type errors"
```

若全部通过则无需提交。

---

## Self-Review

**Spec coverage:**
- action 8 步流程 → Task 2
- 区域 (1107,663)-(1340,721) → JUANXIAN_REGION 常量
- OCR 区 (1240,636)-(1302,666) → COUNT_REGION 常量
- OCR 失败兜底 10 次、N=0 不点击、clamp 0-20 → parseDonateCount + Task 2
- 模板路径 lianmeng/ 子目录 → Task 2 常量
- 注册 action → Task 3
- 配置字段 → Task 4
- 4 小时抖动循环 + hasAnyFeature + computeExpectedActions → Task 5、6
- 三功能并入新"联盟功能"卡片（迁出非复制） → Task 7
- parseDonateCount 单测 → Task 1
- 类型检查/手动验证 → Task 8

**Placeholder scan:** 无 TBD/TODO；所有代码块完整；测试命令与预期明确。

**Type consistency:** `donateAllianceTechEnabled`、`donate-alliance-tech`、`alliance-tech`、`parseDonateCount`、`DONATE_FALLBACK_CLICKS`、`donateAllianceTech` 在各任务间命名一致。
