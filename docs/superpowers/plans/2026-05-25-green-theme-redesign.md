# Green Theme UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blue-based UI theme with emerald green design system across all pages, add custom toggle switches, and restyle status bar to green gradient banner. All existing functionality preserved.

**Architecture:** Pure frontend CSS/component refactor — no logic or API changes. Each page gets color token migration (blue→green, gray→slate). Home.tsx gets the most structural changes (status bar layout + toggle component). Other pages are simple token swaps.

**Tech Stack:** React + Tailwind CSS

---

### Task 1: App.tsx — NavBar green theme

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Update NavBar colors**

Remove the old `linkClass` function and restyle the entire navbar to match the reference:
- Brand logo: add gradient green icon block before "ROK助手"
- Active tab: `bg-emerald-100 text-emerald-500` (was `bg-blue-100 text-blue-700`)
- Inactive tab: `text-slate-500` hover `bg-slate-100 text-slate-800`
- License badge: `bg-emerald-100 text-emerald-500` with green dot
- Remaining time: `text-slate-500`
- Renew button: `text-emerald-600 hover:text-emerald-500`
- Minimize/close buttons: `border border-slate-200 bg-white text-slate-500 hover:bg-slate-100`
- Navbar container: `bg-white border-b border-slate-200 shadow-sm`
- `bg-blue-50` → `bg-slate-100` in AppContent, ErrorBoundary, LicenseGate

- [ ] **Step 2: Verify TypeScript**

```bash
cd D:/SLG/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: green theme NavBar with gradient logo and slate tones"
```

---

### Task 2: Home.tsx — Status bar, toggle switches, feature cards

**Files:**
- Modify: `web/src/pages/Home.tsx`

This is the largest file. Changes grouped by section:

- [ ] **Step 1: Replace "一键全能模式" card with green gradient status banner**

Current centered white card (lines ~783-831) → horizontal green banner:
```tsx
<div className="bg-gradient-to-r from-emerald-50 to-emerald-100 border border-emerald-300 rounded-xl p-4 flex items-center justify-between mb-6">
  <div className="flex items-center gap-3">
    <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white text-xl shadow-lg shadow-emerald-500/30">🎮</div>
    <div>
      <h3 className="font-semibold text-slate-800">{taskRunning ? '运行中' : '准备就绪'}</h3>
      <p className="text-sm text-slate-500">{deviceConnected ? `设备已连接 · 循环间隔 ${features.loopInterval}秒` : '未连接设备'}</p>
    </div>
  </div>
  <div className="flex items-center gap-3">
    {deviceConnected && !taskRunning && (
      <div className="flex items-center gap-2">
        <span className="text-slate-500 text-sm">循环间隔:</span>
        <input type="number" min={60} step={30} value={features.loopInterval}
          onChange={(e) => setFeatures({ ...features, loopInterval: Math.max(60, Number(e.target.value)) })}
          className="w-16 px-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm text-center focus:outline-none focus:border-emerald-400" />
        <span className="text-slate-500 text-sm">秒</span>
      </div>
    )}
    {!deviceConnected ? (
      <button onClick={handleConnectDevice} disabled={deviceLoading}
        className="px-8 py-3 bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-bold rounded-full hover:from-emerald-600 hover:to-emerald-500 transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/30">
        {deviceLoading ? '连接中...' : '连接设备'}
      </button>
    ) : !taskRunning ? (
      <button onClick={handleStartAll}
        className="px-8 py-3 bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-bold rounded-full hover:from-emerald-600 hover:to-emerald-500 transition-all shadow-lg shadow-emerald-500/30 flex items-center gap-2">
        <span>▶</span> 开始运行
      </button>
    ) : (
      <button onClick={handleStop}
        className="px-8 py-3 bg-red-500 text-white font-bold rounded-full hover:bg-red-600 transition-all shadow-lg shadow-red-500/30">
        停止运行
      </button>
    )}
  </div>
</div>
```

- [ ] **Step 2: Replace feature card toggle switches**

Replace all `<input type="checkbox">` with custom pill toggle. Define a reusable toggle pattern inline:

```tsx
<label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
  <input type="checkbox" checked={features.upgradeBuildings} disabled={features.autoExplore}
    onChange={(e) => setFeatures({ ...features, upgradeBuildings: e.target.checked })}
    className="sr-only" />
  <span className={`absolute inset-0 rounded-full transition-colors ${features.upgradeBuildings ? 'bg-emerald-500' : 'bg-slate-200'}`} />
  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow ${features.upgradeBuildings ? 'translate-x-[18px]' : ''}`} />
</label>
```

Apply to all feature toggles: upgradeBuildings, researchTech, gatherResources, trainTroops, helpTeammates, collectResources, autoExplore.

- [ ] **Step 3: Restyle feature card grid**

- Card border: `border border-slate-200` → active adds `border-emerald-500 bg-green-50/50`
- Feature icon backgrounds per the spec:
  - 升级建筑: `bg-emerald-100`
  - 研究科技: `bg-blue-100`
  - 资源采集: `bg-amber-100`
  - 训练兵种: `bg-red-100`
  - 帮助盟友: `bg-purple-100`
  - 收集资源: `bg-emerald-100`
  - 自动探索: `bg-cyan-100`
- "Coming soon" disabled items: replace dashed-border overlay with blur lock overlay:
```tsx
<div className="absolute inset-0 bg-slate-100/60 backdrop-blur-[1px] rounded-lg flex items-center justify-center z-10">
  <span className="bg-white border border-slate-200 px-3 py-1.5 rounded-full text-xs text-slate-500 font-semibold shadow-sm">🔒 即将上线</span>
</div>
```
- Bottom "开发中" section: `bg-slate-100 rounded-lg` with muted styling

- [ ] **Step 4: Restyle buttons and inputs**

- All primary buttons: `rounded-full`, green gradient, green shadow
- Stop button: `rounded-full`, red bg
- Interval input: `bg-white border-slate-200 rounded-lg focus:border-emerald-400`
- Config select: `bg-white border-slate-200 rounded-lg`
- Building/training selects: `border-slate-200 rounded-md focus:border-emerald-400`

- [ ] **Step 5: Restyle log panel**

- Log container: `bg-slate-900` (was dark), monospace, rounded-xl
- Log lines: success `text-emerald-400`, info `text-blue-400`, error `text-red-400`
- Empty state: muted icons/text on dark bg

- [ ] **Step 6: Restyle remaining page sections**

- No-device placeholder: `text-slate-400` on `bg-slate-100`
- Page background: `bg-slate-100` (was `bg-blue-50`)
- All `text-gray-*` → `text-slate-*`

- [ ] **Step 7: Verify TypeScript**

```bash
cd D:/SLG/web && npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: green theme Home - status banner, toggle switches, feature cards"
```

---

### Task 3: Config.tsx — Color token migration

**Files:**
- Modify: `web/src/pages/Config.tsx`

- [ ] **Step 1: Replace all color classes**

- Page bg: `bg-slate-100`
- Cards: `bg-white rounded-xl shadow-sm border border-slate-100`
- Primary buttons: `bg-emerald-500 text-white hover:bg-emerald-600` (or pill for main actions)
- Mode toggle: `bg-emerald-600 text-white` for selected
- Inputs/selects: `bg-white border-slate-200 rounded-lg focus:border-emerald-400`
- Hover states: `hover:bg-slate-50` / `hover:text-emerald-600`
- Delete buttons: `text-red-500 hover:text-red-600 hover:bg-red-50`
- Dropdown items: `hover:bg-slate-50`
- Text: `text-slate-800` / `text-slate-500` / `text-slate-400`
- Building tags: `bg-slate-100 text-slate-600`

- [ ] **Step 2: Verify TypeScript**

```bash
cd D:/SLG/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Config.tsx
git commit -m "feat: green theme Config page"
```

---

### Task 4: Accounts.tsx — Color token migration

**Files:**
- Modify: `web/src/pages/Accounts.tsx`

- [ ] **Step 1: Replace all color classes**

Same token mapping as Config — blue→green, gray→slate, inputs focus emerald.

- [ ] **Step 2: Verify TypeScript & Commit**

```bash
cd D:/SLG/web && npx tsc --noEmit
git add web/src/pages/Accounts.tsx
git commit -m "feat: green theme Accounts page"
```

---

### Task 5: Activation.tsx — Color token migration

**Files:**
- Modify: `web/src/pages/Activation.tsx`

- [ ] **Step 1: Replace all color classes**

- Keep blue gradient for the main activation card (it's the auth page, different visual role)
- Button: `bg-gradient-to-r from-emerald-500 to-emerald-400`
- Error/success: `bg-red-50 border-red-300 text-red-700` / `bg-emerald-50 border-emerald-300 text-emerald-700`
- Background: `from-emerald-50 via-white to-slate-100`
- Text: slate scale

- [ ] **Step 2: Verify TypeScript & Commit**

```bash
cd D:/SLG/web && npx tsc --noEmit
git add web/src/pages/Activation.tsx
git commit -m "feat: green theme Activation page"
```

---

### Task 6: Tasks.tsx — Color token migration

**Files:**
- Modify: `web/src/pages/Tasks.tsx`

- [ ] **Step 1: Replace all color classes**

- Active task: `bg-emerald-50 border-emerald-300`
- Task items: `bg-white border border-slate-100`
- Log area: `bg-slate-50` → `bg-slate-900` for terminal feel
- Status colors: running = emerald, finished = slate

- [ ] **Step 2: Verify TypeScript & Commit**

```bash
cd D:/SLG/web && npx tsc --noEmit
git add web/src/pages/Tasks.tsx
git commit -m "feat: green theme Tasks page"
```

---

### Task 7: Plugins.tsx — Color token migration

**Files:**
- Modify: `web/src/pages/Plugins.tsx`

- [ ] **Step 1: Replace all color classes**

- Plugin cards: `bg-white rounded-xl shadow-sm border border-slate-100`
- Action items: `bg-slate-50 rounded-lg border border-slate-100`
- Hover: `hover:bg-emerald-50 hover:border-emerald-200`

- [ ] **Step 2: Verify TypeScript & Commit**

```bash
cd D:/SLG/web && npx tsc --noEmit
git add web/src/pages/Plugins.tsx
git commit -m "feat: green theme Plugins page"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full TypeScript check**

```bash
cd D:/SLG && npx tsc --noEmit && cd web && npx tsc --noEmit
```

- [ ] **Step 2: Start dev server and visually verify**

```bash
# Terminal 1
cd D:/SLG && npm run server
# Terminal 2
cd D:/SLG/web && npm run dev
```

Open in browser, check all pages for visual consistency.

- [ ] **Step 3: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore: final green theme tweaks"
```
