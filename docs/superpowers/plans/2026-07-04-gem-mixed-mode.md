# 宝石采集混合模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把宝石采集的"专注模式开关"改成"普通/专注/混合"三选一，其中混合模式在一个 active 阶段内以随机比例交替使用两种子模式。

**Architecture:** 数据模型层把 `gemGatherFocusMode: boolean` 换成 `gemGatherMode: 'normal' | 'focus' | 'mixed'`；前端加载时自动从旧字段迁移；宝石独立循环在进入 active 阶段掷 `focusRatio ∈ [0.3, 0.7]`，每轮采集独立按此比例决定用 `gem-gather` 还是 `gem-gather-focus`；独占运行判断和其它功能禁用条件用一个新的派生布尔 `focusExclusive`（= `gemGatherEnabled && gemGatherMode === 'focus'`）统一表达。

**Tech Stack:** TypeScript + React（前端 Home.tsx）；后端 action 不动。

---

## File Structure

- `plugins/rok/homeFeatures.ts` —— 字段类型、默认值
- `web/src/pages/Home.tsx` —— 迁移逻辑、UI 三选一、循环调度、独占判断

`plugins/rok/actions/gatherGem.ts` 和 `gatherGemFocus.ts` 保持不变。

---

## Task 1: 更新 HomeFeatures 类型与默认值

**Files:**
- Modify: `plugins/rok/homeFeatures.ts:38-39, 86-87`

- [ ] **Step 1: 修改接口字段**

打开 `plugins/rok/homeFeatures.ts`，把接口里的：

```ts
  gemGatherEnabled: boolean;
  gemGatherFocusMode: boolean;
```

改成：

```ts
  gemGatherEnabled: boolean;
  gemGatherMode: 'normal' | 'focus' | 'mixed';
```

- [ ] **Step 2: 修改默认值**

在 `DEFAULT_HOME_FEATURES` 中把：

```ts
  gemGatherEnabled: false,
  gemGatherFocusMode: false,
```

改成：

```ts
  gemGatherEnabled: false,
  gemGatherMode: 'normal',
```

- [ ] **Step 3: 检查后端 tsc**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 只报 `web/src/pages/Home.tsx` 里对 `gemGatherFocusMode` 的引用错误（后续任务修）。`plugins/`、`core/`、`server/` 本身应无新增错误。

- [ ] **Step 4: Commit**

```bash
git add plugins/rok/homeFeatures.ts
git commit -m "refactor(features): gemGatherFocusMode -> gemGatherMode ('normal'|'focus'|'mixed')"
```

---

## Task 2: 前端配置迁移（localStorage + 云配置）

**Files:**
- Modify: `web/src/pages/Home.tsx:21`（`GEM_FOCUS_MODE_DISABLED` 常量所在处）
- Modify: `web/src/pages/Home.tsx:314`（`loadFeatures` 中的兼容处理）
- Modify: `web/src/pages/Home.tsx:434, 473`（云配置加载）

- [ ] **Step 1: 新增迁移辅助函数**

在 `web/src/pages/Home.tsx` 顶部（`GEM_FOCUS_MODE_DISABLED` 常量之后）新增：

```ts
// 旧字段 gemGatherFocusMode -> 新字段 gemGatherMode 迁移
function migrateGemMode(raw: any): 'normal' | 'focus' | 'mixed' {
  if (raw?.gemGatherMode === 'focus' || raw?.gemGatherMode === 'mixed' || raw?.gemGatherMode === 'normal') {
    return raw.gemGatherMode;
  }
  if (raw?.gemGatherFocusMode === true) return 'focus';
  return 'normal';
}
```

- [ ] **Step 2: 替换 loadFeatures 中的旧字段处理**

原第 314 行附近：

```ts
        if (GEM_FOCUS_MODE_DISABLED) merged.gemGatherFocusMode = false;
```

改为：

```ts
        merged.gemGatherMode = migrateGemMode(merged);
        delete merged.gemGatherFocusMode;
```

- [ ] **Step 3: 替换云配置加载点 (~434, 473)**

两处 `gemGatherFocusMode: GEM_FOCUS_MODE_DISABLED ? false : res.config.homeFeatures.gemGatherFocusMode,` 分别替换为：

```ts
            gemGatherMode: migrateGemMode(res.config.homeFeatures),
```

- [ ] **Step 4: 手动验证迁移**

清空浏览器 localStorage 或直接编辑：

- 老数据 `{gemGatherFocusMode: true}` → 加载后 features.gemGatherMode === 'focus'
- 老数据 `{gemGatherFocusMode: false}` → features.gemGatherMode === 'normal'
- 新数据 `{gemGatherMode: 'mixed'}` → features.gemGatherMode === 'mixed'

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(gem): migrate gemGatherFocusMode to gemGatherMode on load"
```

---

## Task 3: 引入 focusExclusive 派生布尔并替换所有守卫

**Files:**
- Modify: `web/src/pages/Home.tsx` 所有 `features.gemGatherEnabled && features.gemGatherFocusMode` 表达式

- [ ] **Step 1: 定位所有引用**

Run: `grep -n "gemGatherFocusMode" web/src/pages/Home.tsx`
Expected: 出现在 582, 583, 689, 733, 772, 811, 876, 956, 1102, 1180, 1690, 1740-1747, 1789, 1793, 1803, 1811, 1843, 1851, 1868, 1873, 1876, 1878, 1889, 1897, 1906, 1909, 1923, 1931, 1940, 1943, 2007, 2011, 2020, 2050, 2054, 2098, 2102, 2122, 2140, 2142, 2199, 2218, 2227, 2245, 2276, 2278, 2301, 2303 等（Task 2 已把 loadFeatures 内的清掉）。

- [ ] **Step 2: 全文替换（除 Task 4/5 会重写的 UI 单选块外）**

对整个文件做替换 `features.gemGatherEnabled && features.gemGatherFocusMode` → `(features.gemGatherEnabled && features.gemGatherMode === 'focus')`

（用 IDE 全局替换，替换后保留括号以防运算优先级问题。）

第 1102 行：

```ts
          const isFocus = f.gemGatherFocusMode;
```

暂时改为（Task 5 会重写整个宝石循环）：

```ts
          const isFocus = f.gemGatherMode === 'focus';
```

- [ ] **Step 3: tsc 检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 若还有 `gemGatherFocusMode` 报错，检查是否漏改；若无错误，进入下一步。

- [ ] **Step 4: 前端跑通**

Run: `cd web && npm run build`
Expected: 构建成功。

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "refactor(gem): replace gemGatherFocusMode references with gemGatherMode === 'focus'"
```

---

## Task 4: UI 从复选框改为三选一单选

**Files:**
- Modify: `web/src/pages/Home.tsx:1739-1753`（当前"驻扎模式"复选框所在处）

- [ ] **Step 1: 替换 UI 块**

打开 1739 行开始的 `<div className="flex items-center gap-2 mt-2">` 块，把包含 `🏕️ 驻扎模式` 复选框的整块 label（1740-1750 行）替换为三选一单选组：

```tsx
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-slate-400 whitespace-nowrap">模式</span>
                {(['normal', 'focus', 'mixed'] as const).map(mode => {
                  const label = mode === 'normal' ? '普通' : mode === 'focus' ? '专注' : '混合';
                  const disabled = !features.gemGatherEnabled || isFeatureLocked('gemGather') || features.autoExplore || features.autoWorldChat;
                  const active = features.gemGatherMode === mode;
                  return (
                    <label key={mode} className={`flex items-center gap-1 ${disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                      <input type="radio" name="gemGatherMode"
                        checked={active}
                        disabled={disabled}
                        onChange={() => setFeatures({ ...features, gemGatherMode: mode })}
                        className="sr-only" />
                      <span className={`px-2 py-0.5 rounded text-xs border ${active ? 'bg-orange-500 border-orange-600 text-white' : 'bg-white border-slate-300 text-slate-600'}`}>{label}</span>
                    </label>
                  );
                })}
                <span className="text-xs text-slate-400 whitespace-nowrap ml-auto">队伍页</span>
                {renderTeamPageSelect(features.gemGatherTeamPage, (v) => setFeatures({ ...features, gemGatherTeamPage: v }), features.autoExplore || features.autoWorldChat || !features.gemGatherEnabled || isFeatureLocked('gemGather'))}
              </div>
```

- [ ] **Step 2: 卡片外框高亮颜色跟随专注模式**

第 1690 行卡片外框中的 `(features.gemGatherEnabled && features.gemGatherFocusMode) ? 'border-purple-500 bg-purple-50'` 已在 Task 3 替换为 `(features.gemGatherEnabled && features.gemGatherMode === 'focus') ? 'border-purple-500 bg-purple-50'`。混合模式不走这个高亮，保持普通绿色即可。无需再改。

- [ ] **Step 3: 手动验证**

Run: `cd web && npm run dev`（后端已在跑的话）
在浏览器：
- 点"普通"→ 按钮橙色，其它两个白底
- 点"专注"→ 卡片变紫框
- 点"混合"→ 卡片保持绿框，按钮橙色

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(gem): UI radio group for gemGatherMode (normal/focus/mixed)"
```

---

## Task 5: 独立循环中实现混合调度

**Files:**
- Modify: `web/src/pages/Home.tsx:1100-1112`（active 阶段起点 + 每轮模式决定）

- [ ] **Step 1: 修改 active 阶段起点**

定位到当前代码（约 1100-1112 行）：

```ts
          const activeHours = Number(f.gemGatherActiveHours) || 2;
          const restHours = Number(f.gemGatherRestHours) || 1;
          const isFocus = f.gemGatherMode === 'focus';
          const actionId = isFocus ? 'gem-gather-focus' : 'gem-gather';
          const intervalSec = isFocus ? 60 : 300;

          // ── active 阶段 ──
          const activeEnd = monotonicNow() + activeHours * 3600 * 1000;
          setGemRestCountdown('');
          setLogs(prev => [...prev,
            `[${new Date().toLocaleTimeString()}] 💎 ${isFocus ? '专注' : '普通'}采集开始，持续 ${activeHours}h`]);
```

改为（把 `isFocus`/`actionId`/`intervalSec` 从 active 起点搬到循环体每轮起点内，起点只掷 focusRatio 与打印日志）：

```ts
          const activeHours = Number(f.gemGatherActiveHours) || 2;
          const restHours = Number(f.gemGatherRestHours) || 1;
          const mode = f.gemGatherMode;
          // 混合模式：进入本 active 阶段随机确定专注占比 30%~70%
          const focusRatio = mode === 'mixed' ? (0.3 + Math.random() * 0.4) : (mode === 'focus' ? 1 : 0);

          // ── active 阶段 ──
          const activeEnd = monotonicNow() + activeHours * 3600 * 1000;
          setGemRestCountdown('');
          const startLabel = mode === 'mixed'
            ? `混合采集开始，本期专注占比 ${Math.round(focusRatio * 100)}%`
            : `${mode === 'focus' ? '专注' : '普通'}采集开始`;
          setLogs(prev => [...prev,
            `[${new Date().toLocaleTimeString()}] 💎 ${startLabel}，持续 ${activeHours}h`]);
```

- [ ] **Step 2: 修改每轮采集内部**

紧接的 `while (!loopStopped && !relaunchRequested && monotonicNow() < activeEnd)` 循环体内部（当前约 1112-1153 行）在 `await ensureGameRunning();` 之后、`try {` 之前，插入本轮决策：

```ts
            const isFocus = Math.random() < focusRatio;
            const actionId = isFocus ? 'gem-gather-focus' : 'gem-gather';
            const intervalSec = isFocus ? 60 : 300;
```

- [ ] **Step 3: 修正轮末日志文案**

原第 1141 行：

```ts
                  setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 💎 宝石采集${isFocus ? '(专注)' : ''}完成`]);
```

改为（混合模式时始终标注本轮实际模式）：

```ts
                  setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 💎 宝石采集(${isFocus ? '专注' : '普通'})完成`]);
```

- [ ] **Step 4: 移除 Task 3 里的临时 isFocus 定义**

上面 Step 1 已经把顶层 `const isFocus = f.gemGatherMode === 'focus';` 替换成 `mode` + `focusRatio`。确认这一行已删掉。

- [ ] **Step 5: tsc + build**

Run: `npx tsc --noEmit -p tsconfig.json && cd web && npm run build`
Expected: 无错误、构建成功。

- [ ] **Step 6: 手动验证**

后端 + 前端启动，设备连接后：
- 选"普通" → 日志显示"💎 普通采集开始，持续 2h"，每轮显示"宝石采集(普通)完成"
- 选"专注" → 日志显示"💎 专注采集开始，持续 2h"，每轮显示"宝石采集(专注)完成"，且其它功能被禁用
- 选"混合" → 日志显示"💎 混合采集开始，本期专注占比 XX%，持续 2h"；多轮日志混杂"(专注)/(普通)"两种；其它功能未被禁用

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(gem): mixed mode — per-active focusRatio ∈ [0.3,0.7], per-round random pick"
```

---

## Self-Review

- **Spec 覆盖：**
  - 三选一 UI → Task 4 ✓
  - 每次 active 掷 focusRatio ∈ [0.3, 0.7] → Task 5 Step 1 ✓
  - 每轮独立随机 → Task 5 Step 2 ✓
  - 按本轮模式取 intervalSec → Task 5 Step 2 ✓
  - 老数据迁移 → Task 2 ✓
  - 独占运行仅在 `mode === 'focus'` → Task 3 全局替换 ✓
  - 日志文案 → Task 5 Step 1、Step 3 ✓
  - 后端 action 不改 → 无对应 task ✓
- **Placeholder 扫描：** 无 TBD / 无省略。
- **类型一致性：** `'normal' | 'focus' | 'mixed'` 在 homeFeatures / migrateGemMode / UI / 循环处一致。

---

Plan complete and saved to `docs/superpowers/plans/2026-07-04-gem-mixed-mode.md`.
