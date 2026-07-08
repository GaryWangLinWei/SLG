# 自动切号 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一模拟器上自动轮换 2 个万国觉醒游戏账号，每个账号绑定一套坐标配置方案，一轮任务完成后自动切换到下一个账号继续跑。

**Architecture:** 新增独立 `switch-account` action 走"头像→用户中心→切换账号→OCR匹配编号→登录"流程；Home 主循环底部置切号 flag，顶部检测到 flag 时切号 + 切配置方案 + 清 CD refs；per-time 模式用 setTimeout 到点置 flag。

**Tech Stack:** TypeScript + PluginContext（tap/sleep/findImage/captureRegion）+ tesseract.js OCR (readDigits) + React state。

---

## 文件结构

| 文件 | 责任 |
|------|------|
| `plugins/rok/homeFeatures.ts` | HomeFeatures 接口 + 默认值新增字段 |
| `plugins/rok/index.ts` | 注册 `switch-account` action；DEFAULT_ROK_CONFIG 增加 `accountSwitch` 字段 |
| `plugins/rok/actions/switchAccount.ts` | **新建** — 切号完整流程 |
| `plugins/rok/actions/launchGame.ts` | 导出 `TAP_REGION` 常量给 switchAccount 复用 |
| `plugins/rok/templates/icon_account.png` | **用户新增** — 用户中心的"账号"图标 |
| `web/src/pages/Home.tsx` | 主循环改造：切号 flag + 切号执行 + CD 重置 + UI 卡片 |
| `web/src/pages/Config.tsx` | 配置方案编辑区新增"账号编号"输入框 |

---

### Task 1: 扩展类型定义

**Files:**
- Modify: `plugins/rok/homeFeatures.ts`

- [ ] **Step 1: 添加自动切号字段到接口和默认值**

在 `plugins/rok/homeFeatures.ts` 的 `interface HomeFeatures` 尾部（`autoShieldEnabled: boolean;` 之后）加入：

```ts
  autoSwitchAccount: boolean;
  switchMode: 'per-round' | 'per-time';
  switchIntervalMinutes: number;
  switchProfileIds: [string, string];  // 恰好 2 个 profile 名称
```

在 `DEFAULT_HOME_FEATURES` 尾部对应加入：

```ts
  autoSwitchAccount: false,
  switchMode: 'per-round',
  switchIntervalMinutes: 30,
  switchProfileIds: ['', ''],
```

- [ ] **Step 2: 编译验证**

```bash
npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add plugins/rok/homeFeatures.ts
git commit -m "feat(rok): HomeFeatures 新增自动切号字段"
```

---

### Task 2: 扩展 RokConfig 类型和默认值

**Files:**
- Modify: `plugins/rok/index.ts`

- [ ] **Step 1: 添加 accountSwitch 到 RokConfig 接口**

打开 `plugins/rok/index.ts`，找到 `export interface RokConfig {` 声明，在 `homeFeatures` 上方（`RokConfig` 内部末尾）加入：

```ts
  accountSwitch: {
    accountName: string;   // 账号编号，如 "241872258"，空 = 不参与切号
  };
```

- [ ] **Step 2: 添加默认值**

找到 `export const DEFAULT_ROK_CONFIG: RokConfig = {`，在 `homeFeatures: DEFAULT_HOME_FEATURES,` 上方加入：

```ts
  accountSwitch: {
    accountName: '',
  },
```

- [ ] **Step 3: 编译验证**

```bash
npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/index.ts
git commit -m "feat(rok): RokConfig 新增 accountSwitch 字段"
```

---

### Task 3: 导出 launchGame 的 TAP_REGION

**Files:**
- Modify: `plugins/rok/actions/launchGame.ts:10`

- [ ] **Step 1: 把 TAP_REGION 改为导出常量**

打开 `plugins/rok/actions/launchGame.ts`，把第 10 行：

```ts
const TAP_REGION = { x1: 324, y1: 256, x2: 1231, y2: 798 };
```

改为：

```ts
export const TAP_REGION = { x1: 324, y1: 256, x2: 1231, y2: 798 };
```

- [ ] **Step 2: 编译验证**

```bash
npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add plugins/rok/actions/launchGame.ts
git commit -m "refactor(rok): 导出 launchGame TAP_REGION 供切号复用"
```

---

### Task 4: 实现 switchAccount action

**Files:**
- Create: `plugins/rok/actions/switchAccount.ts`

**前置：用户需先把 `icon_account.png`（用户中心里的"账号"图标）放到 `plugins/rok/templates/` 目录。**

- [ ] **Step 1: 创建 switchAccount.ts**

新建 `plugins/rok/actions/switchAccount.ts`：

```ts
import * as path from 'path';
import { PluginContext } from '../../../core/plugin';
import { getTemplatesDir } from '../../../core/resourcePath';
import { ocrService } from '../../../core/ocr/OcrService';
import { getCurrentLocation } from '../utils/location';
import { TAP_REGION } from './launchGame';

export type SwitchAccountResult = 'success' | 'not_found' | 'settings_failed' | 'load_timeout';

const AVATAR_TAP = { x: 58, y: 48 };          // (34,23)-(83,73) 中心
const SETTINGS_BTN = { x: 1358, y: 747 };     // (1329,719)-(1388,775) 中心
const SWITCH_BTN = { x: 727, y: 97 };
const DROPDOWN_BTN = { x: 994, y: 408 };
const LOGIN_BTN = { x: 802, y: 487 };

const REGION1 = { x: 676, y: 495, w: 862 - 676, h: 520 - 495, tap: { x: 769, y: 508 } };
const REGION2 = { x: 676, y: 569, w: 862 - 676, h: 594 - 569, tap: { x: 769, y: 582 } };

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 切换游戏账号：头像 → 设置 → 账号 → 切换账号 → 展开下拉 → OCR 匹配 → 登录 → 等加载
 * @param targetName 目标账号编号（如 "241872258"），OCR 结果用 includes 匹配
 */
export async function switchAccount(ctx: PluginContext, targetName: string): Promise<SwitchAccountResult> {
  ctx.log(`=== 切换账号 target=${targetName} ===`);

  // 1. 点头像 → 打开用户中心边栏
  ctx.log(`  [1/6] 点头像 (${AVATAR_TAP.x}, ${AVATAR_TAP.y})`);
  await ctx.tap(AVATAR_TAP.x, AVATAR_TAP.y);
  await ctx.sleep(0.5);

  // 2. 点设置按钮 → 打开用户中心
  ctx.log(`  [2/6] 点设置按钮 (${SETTINGS_BTN.x}, ${SETTINGS_BTN.y})`);
  await ctx.tap(SETTINGS_BTN.x, SETTINGS_BTN.y);
  await ctx.sleep(1);

  // 3. 找账号按钮
  const iconAccountPath = path.join(getTemplatesDir(), 'icon_account.png');
  const accountIcon = await ctx.findImageWithLocation(iconAccountPath, 0.75);
  ctx.log(`  [3/6] icon_account.png found=${accountIcon.found} conf=${accountIcon.confidence.toFixed(3)}`);
  if (!accountIcon.found) {
    ctx.log('  ❌ 未找到账号图标，无法进入切号流程');
    return 'settings_failed';
  }
  await ctx.tap(accountIcon.x, accountIcon.y);
  await ctx.sleep(1);

  // 4. 点"切换账号"按钮
  ctx.log(`  [4/6] 点切换账号 (${SWITCH_BTN.x}, ${SWITCH_BTN.y})`);
  await ctx.tap(SWITCH_BTN.x, SWITCH_BTN.y);
  await ctx.sleep(1);

  // 5. 展开下拉 + OCR 匹配
  ctx.log(`  [5/6] 展开下拉 (${DROPDOWN_BTN.x}, ${DROPDOWN_BTN.y})`);
  await ctx.tap(DROPDOWN_BTN.x, DROPDOWN_BTN.y);
  await ctx.sleep(0.5);

  const region1Img = await ctx.captureRegion(REGION1.x, REGION1.y, REGION1.w, REGION1.h);
  const region2Img = await ctx.captureRegion(REGION2.x, REGION2.y, REGION2.w, REGION2.h);
  const [text1, text2] = await Promise.all([
    ocrService.readDigits(region1Img),
    ocrService.readDigits(region2Img),
  ]);
  ctx.log(`  [OCR] 区域1="${text1.trim()}" 区域2="${text2.trim()}"`);

  let tap: { x: number; y: number } | null = null;
  if (text1.includes(targetName)) tap = REGION1.tap;
  else if (text2.includes(targetName)) tap = REGION2.tap;

  if (!tap) {
    ctx.log(`  ⚠️ 未匹配到目标账号 ${targetName}`);
    return 'not_found';
  }

  ctx.log(`  匹配成功，点击 (${tap.x}, ${tap.y})`);
  await ctx.tap(tap.x, tap.y);
  await ctx.sleep(0.5);

  // 6. 点登录 + 等加载（与 launchGame 一致）
  ctx.log(`  [6/6] 点登录 (${LOGIN_BTN.x}, ${LOGIN_BTN.y})`);
  await ctx.tap(LOGIN_BTN.x, LOGIN_BTN.y);

  ctx.log(`  等待 15s 进入开始界面`);
  await ctx.sleep(15);

  const tx = randInt(TAP_REGION.x1, TAP_REGION.x2);
  const ty = randInt(TAP_REGION.y1, TAP_REGION.y2);
  ctx.log(`  点击 (${tx}, ${ty}) 进入游戏`);
  await ctx.tap(tx, ty);

  ctx.log(`  等待 15s 加载...`);
  await ctx.sleep(15);

  // 轮询城内 landmark 最多 60s
  const pollStart = Date.now();
  while (Date.now() - pollStart < 60_000) {
    const loc = await getCurrentLocation(ctx);
    if (loc === 'city') {
      ctx.log(`  ✅ 已回到城内，切号成功`);
      return 'success';
    }
    await ctx.sleep(2);
  }
  ctx.log(`  ❌ 60s 内未检测到城内界面`);
  return 'load_timeout';
}
```

- [ ] **Step 2: 编译验证**

```bash
npx tsc --noEmit
```

Expected: 无错误。若 `TAP_REGION` 报未定义，检查 Task 3 是否已把它 export。

- [ ] **Step 3: 提交**

```bash
git add plugins/rok/actions/switchAccount.ts
git commit -m "feat(rok): 新建 switchAccount action"
```

---

### Task 5: 注册 switch-account action

**Files:**
- Modify: `plugins/rok/index.ts`

- [ ] **Step 1: import switchAccount**

在 `plugins/rok/index.ts` 顶部 import 块（`import { autoShield } from './actions/autoShield';` 附近）添加：

```ts
import { switchAccount } from './actions/switchAccount';
```

- [ ] **Step 2: 注册 action**

找到 `auto-shield` action 定义（大约在 `actions:` 数组末尾），在 `auto-shield` 后面（`],` 前）添加：

```ts
    {
      id: 'switch-account',
      name: '切换账号',
      description: '通过用户中心切换到指定编号的游戏账号',
      run: async (ctx, params) => {
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

- [ ] **Step 3: 编译验证**

```bash
npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add plugins/rok/index.ts
git commit -m "feat(rok): 注册 switch-account action"
```

---

### Task 6: Config 页支持编辑账号编号

**Files:**
- Modify: `web/src/pages/Config.tsx`

- [ ] **Step 1: 新增 accountSwitchName state 和加载/保存逻辑**

在 `Config.tsx` 里 `buildingPositions` state 声明旁边（大约 line 28-30 附近）添加：

```ts
const [accountSwitchName, setAccountSwitchName] = useState<string>('');
```

在 `loadConfig` 函数里（第 52-63 行的 `useCallback`），把 `res.config.buildingPositions` 处理之后添加：

```ts
setAccountSwitchName(res.config.accountSwitch?.accountName ?? '');
```

在 `switchConfig` 函数里（第 77-95 行），同样在 buildingPositions 处理之后添加：

```ts
setAccountSwitchName(res.config.accountSwitch?.accountName ?? '');
```

找到 line 156 附近的 `api.config.saveRokConfig` 调用：

```ts
await api.config.saveRokConfig(currentAccountId, { buildingPositions: bp }, configName);
```

改为：

```ts
await api.config.saveRokConfig(currentAccountId, { buildingPositions: bp, accountSwitch: { accountName: accountSwitchName } }, configName);
```

- [ ] **Step 2: 添加输入框 UI**

在 Config 页配置方案切换 UI 附近（`configNames.map` 的下拉列表之后，或页面顶部合适位置），添加：

```tsx
<div className="mt-3 flex items-center gap-2">
  <label className="text-sm text-slate-600 whitespace-nowrap">账号编号:</label>
  <input
    type="text"
    value={accountSwitchName}
    onChange={(e) => setAccountSwitchName(e.target.value)}
    placeholder="241872258"
    className="flex-1 px-2 py-1 text-sm border border-slate-300 rounded"
  />
</div>
```

如果不确定放哪，放在 `<button>` 保存按钮上方即可。

- [ ] **Step 3: 编译 + 目视验证**

```bash
cd web && npm run build && cd ..
```

Expected: 无错误。启动 dev server 打开 Config 页确认输入框出现，输入值 → 切配置方案 → 输入值切换正确。

- [ ] **Step 4: 提交**

```bash
git add web/src/pages/Config.tsx
git commit -m "feat(web): Config 页新增账号编号输入框"
```

---

### Task 7: Home 主循环 —— 切号 flag 和 CD 重置基建

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 添加模块级切号 flag 和定时器**

在 `Home.tsx` 顶部模块级变量区（`let relaunchRequested = false;` 附近，约 line 44-46）添加：

```ts
let pendingAccountSwitch = false;    // 切号触发 flag：per-round 每轮末尾置 true；per-time setTimeout 到点置 true
let switchTargetIdx = 0;             // 下一个要切到的 profile 索引（0 或 1）
let switchTimerId: ReturnType<typeof setTimeout> | null = null;
```

- [ ] **Step 2: 添加 resetAllCooldowns 辅助函数**

在 `startLoop` 函数内（约 line 620-660 附近，`const sleep = async` 附近）添加：

```ts
const resetAllCooldowns = () => {
  // 切号后新号所有子任务都要从头跑，等价于重启循环：
  bottomBarChecked = false;
  relaunchRequested = true;    // 让宝石 active/rest 循环 break 出去重新开始
  moduleGemInitialCount = null;
  moduleGemCollectedCount = 0;
  moduleGemRestActive = false;
};
```

- [ ] **Step 3: 编译验证**

```bash
cd web && npm run build && cd ..
```

Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(web): Home 新增切号 flag 和 CD 重置基建"
```

---

### Task 8: Home 主循环 —— 切号执行逻辑

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 在主循环顶部添加切号检查**

在 `Home.tsx` 找到 `while (!loopStopped && hasMainWork) {` 主循环（约 line 1355），在 `round++;` **之前**插入切号执行块：

```ts
      while (!loopStopped && hasMainWork) {
        // ==== 自动切号 ====
        if (featuresRef.current.autoSwitchAccount && pendingAccountSwitch) {
          pendingAccountSwitch = false;
          const ids = featuresRef.current.switchProfileIds;
          const validIds = (ids || []).filter((s: string) => !!s);
          if (validIds.length >= 2) {
            const nextProfile = validIds[switchTargetIdx];
            pushLog(`🔀 切号 → ${nextProfile}`);
            if (await acquireLock()) {
              try {
                // 读目标 profile 的账号编号
                const cfgRes = await api.config.getRokConfig(currentAccountId, nextProfile);
                const targetName = cfgRes.config?.accountSwitch?.accountName || '';
                if (!targetName) {
                  pushLog(`⚠️ profile "${nextProfile}" 未填账号编号，跳过`);
                } else {
                  let ok = false;
                  for (let attempt = 1; attempt <= 2 && !loopStopped; attempt++) {
                    const cr = await api.tasks.create(currentAccountId, 'com.rok.automation', 'switch-account', { targetName });
                    if (!cr.success) break;
                    const rr = await api.tasks.run(cr.task.id);
                    const logs = rr.task?.logs ?? [];
                    if (logs.some((l: string) => l.includes('切换账号: success'))) { ok = true; break; }
                    pushLog(`⚠️ 切号第 ${attempt} 次失败`);
                  }
                  if (ok) {
                    await api.config.switchProfile(currentAccountId, nextProfile);
                    // 刷新配置到后端 + 前端 features
                    await loadFeatures();
                    resetAllCooldowns();
                    switchTargetIdx = (switchTargetIdx + 1) % validIds.length;
                    pushLog(`✅ 切号完成，已激活 ${nextProfile}`);
                  } else {
                    pushLog(`❌ 切号 ${nextProfile} 失败，跳过`);
                    switchTargetIdx = (switchTargetIdx + 1) % validIds.length;
                  }
                }
              } finally { releaseLock(); }
            }
          }
        }

        round++;
        pushLog(`🔄 第${round}轮`);
```

**注意：** `loadFeatures` 是 Home 已存在的函数（从 localStorage 读 features），若名字不同请用 grep 找 —— 目的是重新载入切号后可能变化的配置。若无此函数，可跳过这行 —— features 本身是全局设置，不随 profile 变。

- [ ] **Step 2: 在主循环尾部添加 per-round 触发**

找到主循环末尾 sleep 之前（大约 line 1600+ 的 `while (!loopStopped && (monotonicNow() - startWait) ...` 位置之前），在 `saveLoopState` 或本轮工作完全结束前加：

```ts
        // ==== 一轮结束，per-round 模式触发切号 ====
        if (featuresRef.current.autoSwitchAccount && featuresRef.current.switchMode === 'per-round') {
          pendingAccountSwitch = true;
        }
```

具体位置：在主 `while` 循环体内每次迭代的最末尾（continue 之前 / 循环底部 sleep 之前）。用 grep 找 `saveLoopState(currentAccountId)` 在主 while 循环体后半段的调用作为锚点，插在该锚点之后即可。

- [ ] **Step 3: 在 startLoop 启动时初始化定时器**

在 `startLoop` 函数内，`loopRunning = true;` 后面（约 line 624-628）加入：

```ts
    pendingAccountSwitch = false;
    switchTargetIdx = 0;
    if (switchTimerId) { clearTimeout(switchTimerId); switchTimerId = null; }

    const scheduleSwitchTimer = () => {
      if (switchTimerId) clearTimeout(switchTimerId);
      const feat = featuresRef.current;
      if (!feat.autoSwitchAccount || feat.switchMode !== 'per-time') return;
      const ms = Math.max(1, feat.switchIntervalMinutes) * 60 * 1000;
      switchTimerId = setTimeout(() => {
        pendingAccountSwitch = true;
        scheduleSwitchTimer();
      }, ms);
    };
    scheduleSwitchTimer();
```

- [ ] **Step 4: 在 stopLoop 里清定时器**

找到设置 `loopStopped = true` 的停止逻辑（大约 line 521），在旁边加：

```ts
    if (switchTimerId) { clearTimeout(switchTimerId); switchTimerId = null; }
```

- [ ] **Step 5: 编译**

```bash
cd web && npm run build && cd ..
```

Expected: 无错误（`loadFeatures` 若报未定义，删掉那一行，或用现有函数替代）

- [ ] **Step 6: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(web): Home 主循环支持自动切号"
```

---

### Task 9: Home 页新增「自动切号」UI 卡片

**Files:**
- Modify: `web/src/pages/Home.tsx`

- [ ] **Step 1: 找到功能卡片区域**

用 grep 找 `attackDetectEnabled` 或 `autoShieldEnabled` 的 UI 卡片位置作为参考（例如 `grep -n 'attackDetectEnabled' web/src/pages/Home.tsx`）—— 在该卡片的兄弟位置插入自动切号卡片。

- [ ] **Step 2: 添加卡片 JSX**

在合适的功能卡片区块中插入以下 JSX（`configProfiles` 是 profile 名称列表，如果 Home 里没有此 state，需要额外用 `useEffect` + `api.config.getProfiles` 拉一次）：

```tsx
{/* 自动切号 */}
<div className="p-4 border border-slate-200 rounded-lg bg-white">
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2">
      <span className="text-lg">🔀</span>
      <span className="font-medium text-slate-800">自动切号</span>
    </div>
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={features.autoSwitchAccount}
        onChange={(e) => setFeatures({ ...features, autoSwitchAccount: e.target.checked })}
        className="sr-only peer"
      />
      <div className="w-11 h-6 bg-slate-200 peer-checked:bg-emerald-500 rounded-full peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
    </label>
  </div>

  {features.autoSwitchAccount && (
    <>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-slate-600">切号时机:</label>
        <select
          value={features.switchMode}
          onChange={(e) => setFeatures({ ...features, switchMode: e.target.value as 'per-round' | 'per-time' })}
          className="px-2 py-1 text-sm border border-slate-300 rounded"
        >
          <option value="per-round">按轮次</option>
          <option value="per-time">按时间</option>
        </select>
        {features.switchMode === 'per-time' && (
          <>
            <input
              type="number"
              min={1}
              value={features.switchIntervalMinutes}
              onChange={(e) => setFeatures({ ...features, switchIntervalMinutes: Math.max(1, parseInt(e.target.value) || 30) })}
              className="w-20 px-2 py-1 text-sm border border-slate-300 rounded"
            />
            <span className="text-sm text-slate-600">分钟</span>
          </>
        )}
      </div>

      {[0, 1].map(i => (
        <div key={i} className="mb-2 flex items-center gap-2">
          <label className="text-sm text-slate-600 w-14">账号 {i + 1}:</label>
          <select
            value={features.switchProfileIds[i] || ''}
            onChange={(e) => {
              const ids: [string, string] = [features.switchProfileIds[0] || '', features.switchProfileIds[1] || ''];
              ids[i] = e.target.value;
              setFeatures({ ...features, switchProfileIds: ids });
            }}
            className="flex-1 px-2 py-1 text-sm border border-slate-300 rounded"
          >
            <option value="">-- 选择配置方案 --</option>
            {configProfiles.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      ))}

      <p className="mt-2 text-xs text-slate-500">💡 每个配置方案需在 Config 页填写账号编号</p>
    </>
  )}
</div>
```

如果 Home 里没有 `configProfiles` state，先在文件顶部 state 声明区加：

```ts
const [configProfiles, setConfigProfiles] = useState<string[]>([]);
```

并在挂载 useEffect 里（找已有的 `api.config.getProfiles` 或类似调用，如果没有则新增）：

```ts
useEffect(() => {
  if (!currentAccountId) return;
  api.config.getProfiles(currentAccountId).then(r => {
    if (r.success) setConfigProfiles(r.profiles);
  }).catch(() => {});
}, [currentAccountId]);
```

- [ ] **Step 3: 编译验证**

```bash
cd web && npm run build && cd ..
```

Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(web): Home 新增自动切号 UI 卡片"
```

---

### Task 10: 最终验证

**Files:** N/A

- [ ] **Step 1: 全项目 TypeScript 编译**

```bash
npx tsc --noEmit
cd web && npm run build && cd ..
```

Expected: 无错误

- [ ] **Step 2: 手动验证 UI**

```bash
# 后端
npm run server
# 另开一个终端
cd web && npm run dev
```

打开 http://localhost:5173：
- Config 页：切不同配置方案，账号编号输入框正确加载/保存
- Home 页：打开"自动切号"开关 → 出现模式选择和账号 1/账号 2 下拉

- [ ] **Step 3: 准备 `icon_account.png` 模板图**

用户需在游戏内进入用户中心，截图 → 用工具（比如 mspaint）裁出「账号」按钮图标 → 保存为 `plugins/rok/templates/icon_account.png`。

- [ ] **Step 4: 实机联调**

- 配置两个 profile，各填一个账号编号
- 首页启用「自动切号」+「按轮次」+ 选两个 profile
- 启动循环 → 一轮结束 → 观察日志：`🔀 切号 → xxx` → `✅ 切号完成`
- 继续跑一轮再切回来

- [ ] **Step 5: 打包 exe（可选）**

```bash
npm run electron:build:win
```

Expected: `release/ROK助手 Setup x.x.x.exe` 生成

- [ ] **Step 6: 收尾提交**

若手动测试过程中发现小改动（坐标偏差等），一并提交。

```bash
git add -A
git commit -m "chore: 自动切号验证完成"
```

---

## 自检结果

**Spec 覆盖：** 每一项 spec 需求都有对应任务 —
- 数据结构 → Task 1、2
- switchAccount action → Task 3、4、5
- Home 主循环改造 → Task 7、8
- Home UI 卡片 → Task 9
- Config 页账号编号输入框 → Task 6
- 模板图 icon_account.png → Task 4 前置 + Task 10 Step 3

**Placeholder 扫描：** 无。所有代码片段完整。

**类型一致性：** `SwitchAccountResult` / `switchProfileIds: [string, string]` / 日志匹配串 `切换账号: success` 全流程一致。
