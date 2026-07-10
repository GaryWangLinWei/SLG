# 账号调度独立成层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把首页的"自动切号"从功能卡片中抽出，独立成一层可折叠的琥珀色横幅（沿用 v2 mockup 的横向 Profile 队列样式），放在功能设置卡片区上方。

**Architecture:** 纯前端 UI 重构，无后端和 config schema 改动。所有 features 字段（`autoSwitchAccount / switchMode / switchProfileIds / switchIntervalMinutes`）保持不变；新增本地状态 `accountScheduleExpanded` 持久化到 `localStorage`。删除原功能卡片中的自动切号块，新增独立横幅 JSX。

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + Vite（现有栈，无新依赖）。

---

## File Structure

- 修改：`web/src/pages/Home.tsx`
  - 新增 `accountScheduleExpanded` state + localStorage 同步
  - 新增独立横幅 JSX（约 2033 行之前，功能卡片外层容器上方）
  - 删除原功能卡片 grid 内的"自动切号"卡（约 2777–2853 行）

不新增文件、不改后端。

---

### Task 1: 新增 `accountScheduleExpanded` state + localStorage 同步

**Files:**
- Modify: `web/src/pages/Home.tsx`（`Home` 组件内 state 声明区，找 `activeConfigName` state 附近作为锚点）

- [ ] **Step 1: 在 `useState` 声明区添加折叠状态**

在 `web/src/pages/Home.tsx` 找到 `const [activeConfigName, setActiveConfigName] = useState('');` 这一行（约 197 行），在其**下方一行**插入：

```tsx
  const [accountScheduleExpanded, setAccountScheduleExpandedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('accountScheduleExpanded') === 'true';
    } catch {
      return false;
    }
  });
  const setAccountScheduleExpanded = (v: boolean) => {
    setAccountScheduleExpandedState(v);
    try { localStorage.setItem('accountScheduleExpanded', v ? 'true' : 'false'); } catch {}
  };
```

- [ ] **Step 2: 编译验证**

Run: `cd D:/SLG && npx tsc --noEmit`
Expected: 无输出（无编译错误）

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(web): 新增 accountScheduleExpanded state 持久化到 localStorage"
```

---

### Task 2: 删除功能卡片 grid 内的"自动切号"块

**Files:**
- Modify: `web/src/pages/Home.tsx:2777-2853`

- [ ] **Step 1: 定位并删除**

打开 `web/src/pages/Home.tsx`，定位注释 `{/* 自动切号 */}`（约 2777 行）。删除**从该注释起、到对应闭合 `</div>` 结束的整个 div 块**（约 2777–2853 行，即以 `<div className="flex flex-col gap-0 p-4 rounded-lg transition-colors border border-slate-200 hover:border-slate-300">` 开头、到匹配 `</div>` 结束）。

删除后，`{/* 生产装备材料 */}` 后的 `</div>` 后应直接跟 `</div>` 关闭功能卡片的 grid。

删除内容特征（供核对）：
- 起始行：`{/* 自动切号 */}`
- 结束行：`)}\n            </div>` — 内部 `{features.autoSwitchAccount && (...)}` 块的关闭 + 卡片外层 div 关闭

- [ ] **Step 2: 编译验证**

Run: `cd D:/SLG && npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "refactor(web): 从功能卡片 grid 移除自动切号块（准备迁移到独立层）"
```

---

### Task 3: 新增独立"账号调度"横幅（收起态）

**Files:**
- Modify: `web/src/pages/Home.tsx`（在 `{/* Feature settings card */}` 上方插入新块，约 2033 行前）

- [ ] **Step 1: 在功能设置卡片上方插入横幅收起态骨架**

在 `web/src/pages/Home.tsx` 找到 `{/* Feature settings card */}` 那一行（约 2033 行），在其**上方**插入以下 JSX：

```tsx
        {/* 账号调度独立层 */}
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-xl mb-4 overflow-hidden">
          {!accountScheduleExpanded ? (
            <button
              type="button"
              onClick={() => setAccountScheduleExpanded(true)}
              className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-amber-100/40 transition-colors"
            >
              <span className="w-7 h-7 bg-amber-400 rounded-lg flex items-center justify-center text-white text-sm shadow">🔀</span>
              <span className="font-semibold text-sm text-slate-800">账号调度：{features.autoSwitchAccount ? '开启' : '关闭'}</span>
              <span className="ml-auto text-amber-600">▸</span>
            </button>
          ) : (
            <div className="p-4">
              {/* 展开态占位（下一 Task 填充） */}
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setAccountScheduleExpanded(false)}
                  className="text-amber-600 hover:text-amber-700 px-2"
                  title="收起"
                >▾</button>
              </div>
            </div>
          )}
        </div>

```

- [ ] **Step 2: 编译验证**

Run: `cd D:/SLG && npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 3: 手动验证（可选，若前端在运行）**

打开首页，应看到功能设置卡片上方有一条琥珀色横幅。默认收起，显示 `🔀 账号调度：关闭 ▸`。点击后展开，只显示 `▾` 收起按钮。刷新页面后展开状态保留。

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(web): 新增账号调度独立横幅收起态 + 折叠切换"
```

---

### Task 4: 展开态头部（标题 + 模式下拉 + 开关 + 收起按钮）

**Files:**
- Modify: `web/src/pages/Home.tsx`（Task 3 中插入的展开态占位区）

- [ ] **Step 1: 替换展开态占位为完整头部**

在 `web/src/pages/Home.tsx` 找到 Task 3 插入的 `{/* 展开态占位（下一 Task 填充） */}` 那一行，把整个 `<div className="p-4"> ... </div>`（展开态分支）替换为：

```tsx
            <div className="p-4">
              {/* 头部：标题 + 模式 + 开关 + 收起 */}
              <div className="flex items-center gap-3 mb-3">
                <span className="w-8 h-8 bg-amber-400 rounded-lg flex items-center justify-center text-white text-base shadow">🔀</span>
                <div>
                  <h3 className="font-bold text-sm text-slate-800">账号调度</h3>
                  <p className="text-xs text-amber-700">控制何时切换到哪个配置方案 · 共 2 个账号</p>
                </div>
                <div className="flex-1"></div>
                <select
                  value={features.switchMode}
                  onChange={(e) => setFeatures({ ...features, switchMode: e.target.value as 'per-round' | 'per-time' | 'fort-mode' })}
                  className="text-xs bg-white border border-amber-300 rounded px-2 py-1 text-amber-700 font-medium"
                >
                  <option value="per-time">按时间轮换</option>
                  <option value="per-round">按轮次轮换</option>
                  <option value="fort-mode">寨子模式</option>
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">调度</span>
                  <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                    <input type="checkbox" checked={features.autoSwitchAccount}
                      onChange={(e) => setFeatures({ ...features, autoSwitchAccount: e.target.checked })}
                      className="sr-only" />
                    <span className={`absolute inset-0 rounded-full transition-colors ${features.autoSwitchAccount ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                    <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoSwitchAccount ? 'translate-x-[18px]' : ''}`} />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => setAccountScheduleExpanded(false)}
                  className="text-amber-600 hover:text-amber-700 px-1"
                  title="收起"
                >▾</button>
              </div>
              {/* Profile 队列占位（下一 Task 填充） */}
            </div>
```

- [ ] **Step 2: 编译验证**

Run: `cd D:/SLG && npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(web): 账号调度横幅展开态头部（标题+模式+开关+收起）"
```

---

### Task 5: Profile 横向队列（2 个 chip + 箭头 + 禁用的添加按钮）

**Files:**
- Modify: `web/src/pages/Home.tsx`（Task 4 中的 `{/* Profile 队列占位（下一 Task 填充） */}` 位置）

- [ ] **Step 1: 替换 Profile 队列占位**

在 `web/src/pages/Home.tsx` 找到 Task 4 插入的 `{/* Profile 队列占位（下一 Task 填充） */}` 注释，替换为：

```tsx
              {/* Profile 横向队列 */}
              <div className="bg-white/70 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  {/* 账号 1: 当前 active，只读 */}
                  <div className="w-44 px-3 py-2.5 bg-emerald-50 border-2 border-emerald-500 rounded-lg shadow -translate-y-0.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> 当前
                      </span>
                      <span className="text-[10px] text-slate-300">#1</span>
                    </div>
                    <p className="text-sm font-bold text-slate-800 truncate" title={activeConfigName || '(当前)'}>
                      {activeConfigName || '(当前)'}
                    </p>
                    {features.switchMode === 'per-time' && (
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="number"
                          min={1}
                          value={(Array.isArray(features.switchIntervalMinutes) ? features.switchIntervalMinutes[0] : features.switchIntervalMinutes) || 30}
                          onChange={(e) => {
                            const cur = Array.isArray(features.switchIntervalMinutes)
                              ? features.switchIntervalMinutes
                              : [features.switchIntervalMinutes as any, features.switchIntervalMinutes as any];
                            const next: [number, number] = [cur[0] || 30, cur[1] || 30];
                            next[0] = Math.max(1, parseInt(e.target.value) || 30);
                            setFeatures({ ...features, switchIntervalMinutes: next });
                          }}
                          className="w-12 px-1 py-0.5 text-xs bg-white border border-slate-200 rounded text-center"
                        />
                        <span className="text-xs text-slate-400">分钟</span>
                      </div>
                    )}
                  </div>

                  {/* 箭头 */}
                  <span className="text-amber-500 text-sm flex-shrink-0 select-none">→</span>

                  {/* 账号 2: 下拉可选 */}
                  <div className="w-44 px-3 py-2.5 bg-white border-2 border-slate-200 rounded-lg hover:border-amber-300">
                    <div className="flex items-center justify-between mb-1">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full"></span> 待切换
                      </span>
                      <span className="text-[10px] text-slate-300">#2</span>
                    </div>
                    <select
                      value={features.switchProfileIds[1] || ''}
                      onChange={(e) => {
                        const ids: [string, string] = [features.switchProfileIds[0] || '', features.switchProfileIds[1] || ''];
                        ids[1] = e.target.value;
                        setFeatures({ ...features, switchProfileIds: ids });
                      }}
                      className="text-sm font-bold text-slate-800 bg-transparent w-full focus:outline-none"
                    >
                      <option value="">-- 选择 --</option>
                      {configNames.filter(p => p !== activeConfigName).map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    {features.switchMode === 'per-time' && (
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="number"
                          min={1}
                          value={(Array.isArray(features.switchIntervalMinutes) ? features.switchIntervalMinutes[1] : features.switchIntervalMinutes) || 30}
                          onChange={(e) => {
                            const cur = Array.isArray(features.switchIntervalMinutes)
                              ? features.switchIntervalMinutes
                              : [features.switchIntervalMinutes as any, features.switchIntervalMinutes as any];
                            const next: [number, number] = [cur[0] || 30, cur[1] || 30];
                            next[1] = Math.max(1, parseInt(e.target.value) || 30);
                            setFeatures({ ...features, switchIntervalMinutes: next });
                          }}
                          className="w-12 px-1 py-0.5 text-xs bg-white border border-slate-200 rounded text-center"
                        />
                        <span className="text-xs text-slate-400">分钟</span>
                      </div>
                    )}
                  </div>

                  {/* 循环指示 */}
                  <span className="text-amber-500 text-sm flex-shrink-0 select-none">↩</span>
                  <span className="text-xs text-amber-500/70">循环</span>

                  <div className="flex-1"></div>

                  {/* 添加账号（禁用） */}
                  <button
                    type="button"
                    disabled
                    title="暂不支持超过 2 个账号"
                    className="flex items-center gap-1 text-xs text-amber-500 px-3 py-1.5 border border-dashed border-amber-300 rounded-lg opacity-50 cursor-not-allowed"
                  >
                    <span className="text-base">+</span> 添加账号
                  </button>
                </div>
              </div>

              <p className="mt-2 text-xs text-amber-600/70">💡 切号后自动加载对应方案的全部功能设置 · 共 2 个账号参与轮换</p>
```

- [ ] **Step 2: 编译验证**

Run: `cd D:/SLG && npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(web): 账号调度横幅 Profile 队列 + 时长输入 + 禁用的添加账号"
```

---

### Task 6: 最终手动验证 + 清理

**Files:**
- 无代码改动，仅验证

- [ ] **Step 1: 编译验证**

Run: `cd D:/SLG && npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 2: 前端运行手动测试**

Run（若未运行）：`cd D:/SLG/web && npm run dev`

访问首页，逐项验证：

1. **默认收起**：横幅位于功能设置卡片上方，一行显示 `🔀 账号调度：关闭 ▸`
2. **点击展开**：展开完整头部（图标 + 标题 + 副标题 + 模式下拉 + 调度开关 + `▾` 按钮）+ Profile 队列 + 底部提示
3. **刷新页面**：展开状态保留（localStorage 生效）
4. **点击 `▾`**：折叠回收起态
5. **打开调度开关**：收起态标题变为 `账号调度：开启 ▸`
6. **切换模式**：`按时间轮换` 时 chip 底部显示"分钟"输入；`按轮次` / `寨子模式` 时时长输入隐藏
7. **账号 1 chip**：显示当前 active profile，不可编辑（无 select）
8. **账号 2 chip**：下拉选项排除当前 active profile
9. **账号 2 选中一个 profile 后**：值持久化到 features
10. **`+ 添加账号` 按钮**：灰色、鼠标悬停显示禁用光标 + `暂不支持超过 2 个账号` 提示
11. **功能卡片区**：不再包含"自动切号"卡（原位置应无缝闭合）

- [ ] **Step 3: 汇报结果**

如所有项通过，直接进入 Step 4。若有异常，回到相关 Task 修复。

- [ ] **Step 4: Commit（若前面 Task 已 commit，此处无新改动可跳过）**

```bash
git status
# 若无 unstaged 改动则跳过 commit
```

---

## Self-Review

**Spec 覆盖：**
- ✅ 横幅位于功能卡片上方 → Task 3
- ✅ 琥珀色渐变外框 → Task 3
- ✅ 收起态单行文本 `🔀 账号调度：开启/关闭 ▸` → Task 3
- ✅ 收起态点击整行展开 → Task 3
- ✅ 展开态头部 4 元素 → Task 4
- ✅ Profile 横向队列 + 箭头 + 循环 → Task 5
- ✅ 账号 1 只读高亮 + 账号 2 下拉 → Task 5
- ✅ 按时间模式条件渲染时长输入 → Task 5
- ✅ 账号 2 下拉过滤当前 active → Task 5
- ✅ `+ 添加账号` 禁用 → Task 5
- ✅ 底部提示 → Task 5
- ✅ localStorage 持久化 → Task 1
- ✅ 删除原功能卡片中的自动切号 → Task 2
- ✅ 数据字段无迁移 → 全流程复用 `features.*` 现有字段

**Placeholder 检查：** 无 TBD / TODO / "Similar to Task N" / "handle edge cases" 等。每一步含完整代码。

**类型一致性：** `switchMode` 三值、`switchProfileIds: [string, string]`、`switchIntervalMinutes: [number, number]` 与 `HomeFeatures` 定义一致；`setFeatures` 签名一致。

**账号 1 同步逻辑：** spec 中已明确"保持不变"，`startLoop` 起点和切号成功后的 `switchProfileIds[0] = activeConfigName` 同步已在此前 commit 中实现，本 plan 不重复实施。
