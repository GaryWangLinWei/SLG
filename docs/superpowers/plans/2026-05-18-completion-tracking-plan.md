# Completion Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track completed buildings/techs in the UI with green styling and clear button, remove mutual-exclusion filtering on dropdowns.

**Architecture:** All changes in `web/src/pages/Home.tsx`. Add `completedBuildings`/`completedTechs` boolean arrays to features state, skip completed items in the loop, style dropdowns green for completed slots, add clear buttons with compact logic.

**Tech Stack:** React + TypeScript, no new dependencies

---

### Task 1: Update DEFAULT_FEATURES, loadFeatures migration, and add clear-completed helper

**Files:**
- Modify: `web/src/pages/Home.tsx:108-143`

- [ ] **Step 1: Add completed arrays to DEFAULT_FEATURES**

Replace the DEFAULT_FEATURES object (lines 108-128) with:

```tsx
  const DEFAULT_FEATURES = {
    collectResources: true,
    upgradeBuildings: true,
    selectedBuildings: ['', '', '', '', ''] as string[],
    completedBuildings: [false, false, false, false, false] as boolean[],
    autoResearch: false,
    selectedTechs: ['', '', '', '', ''] as string[],
    completedTechs: [false, false, false, false, false] as boolean[],
    gatherResources: false,
    gatherTasks: [
      { type: '农田', level: 5 },
      { type: '伐木场', level: 4 },
      { type: '石矿', level: 3 },
      { type: '金矿', level: 2 },
      { type: '', level: 1 },
    ],
    trainTroops: false,
    trainTasks: { '兵营': 0, '马厩': 0, '靶场': 0, '攻城武器厂': 0 } as Record<string, number>,
    autoExplore: false,
    exploreCount: 3,
    helpTeammates: false,
    loopInterval: 300,
  };
```

- [ ] **Step 2: Add migration logic in loadFeatures for old saved state**

Replace the `loadFeatures` function (lines 130-143) with:

```tsx
  const loadFeatures = () => {
    try {
      const saved = localStorage.getItem('home-features');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.trainTasks)) {
          parsed.trainTasks = DEFAULT_FEATURES.trainTasks;
        }
        // Migrate old state without completed arrays
        const merged = { ...DEFAULT_FEATURES, ...parsed };
        if (!Array.isArray(merged.completedBuildings) || merged.completedBuildings.length !== 5) {
          merged.completedBuildings = [false, false, false, false, false];
        }
        if (!Array.isArray(merged.completedTechs) || merged.completedTechs.length !== 5) {
          merged.completedTechs = [false, false, false, false, false];
        }
        return merged;
      }
    } catch {}
    return DEFAULT_FEATURES;
  };
```

- [ ] **Step 3: Add clearCompleted helper function**

Add this function after `clearLoopState` (after line 26):

```tsx
function clearCompleted(
  selected: string[],
  completed: boolean[]
): { selected: string[]; completed: boolean[] } {
  // Keep only uncompleted non-empty items
  const remaining = selected.filter((_, i) => !completed[i] && selected[i] !== '');
  // Pad to 5 slots
  const newSelected = [...remaining, ...Array(5 - remaining.length).fill('')] as string[];
  const newCompleted = newSelected.map(() => false) as boolean[];
  return { selected: newSelected, completed: newCompleted };
}
```

- [ ] **Step 4: Compile check**

Run: `npx tsc --noEmit`
Expected: No output (clean compile)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: add completedBuildings/completedTechs state and clear helper"
```

---

### Task 2: Reset completed arrays on start, filter+mark in loop

**Files:**
- Modify: `web/src/pages/Home.tsx:255-257` (handleStartAll start)
- Modify: `web/src/pages/Home.tsx:333-347` (upgrade buildings loop)
- Modify: `web/src/pages/Home.tsx:349-367` (research techs loop)

- [ ] **Step 1: Reset completed arrays at start of handleStartAll**

After `setLogs(prev => ...)` at line 257, insert:

```tsx
    // Reset completion state for a fresh run
    setFeatures(prev => ({
      ...prev,
      completedBuildings: [false, false, false, false, false],
      completedTechs: [false, false, false, false, false],
    }));
```

- [ ] **Step 2: Filter completed buildings and mark success by slot index**

Replace the building upgrade block (lines 333-347) with:

```tsx
          if (features.upgradeBuildings && !loopStopped) {
            const targetBuildings = features.selectedBuildings
              .filter((b, i) => b && !features.completedBuildings[i]);
            if (targetBuildings.length > 0) {
              const logs = await runTask('upgrade-buildings', { targetBuildings });
              // Mark completed slots by matching the building name against success logs
              const newCompleted = [...features.completedBuildings];
              let changed = false;
              features.selectedBuildings.forEach((b, i) => {
                if (b && !newCompleted[i] && logs.some(l => l.includes(`✅ ${b} 升级成功`))) {
                  newCompleted[i] = true;
                  changed = true;
                }
              });
              if (changed) {
                setFeatures(prev => ({ ...prev, completedBuildings: newCompleted }));
              }
            }
          }
```

- [ ] **Step 3: Filter completed techs and mark success by slot index**

Replace the tech research block (lines 349-367) with:

```tsx
          if (features.autoResearch && !loopStopped) {
            if (!buildingOptions.includes('学院')) {
              setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 未标记学院位置，跳过研究科技`]);
            } else {
              const techs = features.selectedTechs
                .filter((t, i) => t && !features.completedTechs[i]);
              if (techs.length > 0) {
                const logs = await runTask('research-tech-queue', { targetTechs: techs, researchBuilding: '学院' });
                const newCompleted = [...features.completedTechs];
                let changed = false;
                features.selectedTechs.forEach((t, i) => {
                  if (t && !newCompleted[i] && logs.some(l => l.includes(`✅ ${t} 研究成功`))) {
                    newCompleted[i] = true;
                    changed = true;
                  }
                });
                if (changed) {
                  setFeatures(prev => ({ ...prev, completedTechs: newCompleted }));
                }
              }
            }
          }
```

- [ ] **Step 4: Compile check**

Run: `npx tsc --noEmit`
Expected: No output

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: reset completed on start, filter and mark completed in loop"
```

---

### Task 3: Update building select dropdowns — remove exclusion, add green completed style, clear on change

**Files:**
- Modify: `web/src/pages/Home.tsx:509-530` (building select area)

- [ ] **Step 1: Replace building select block**

Replace lines 516-525 (the `features.selectedBuildings.map(...)` block) with:

```tsx
                  {features.selectedBuildings.map((val, i) => (
                    <select key={i} value={val} disabled={features.autoExplore} onChange={(e) => {
                      const next = [...features.selectedBuildings]; next[i] = e.target.value;
                      const nextCompleted = [...features.completedBuildings]; nextCompleted[i] = false;
                      setFeatures({ ...features, selectedBuildings: next, completedBuildings: nextCompleted });
                    }}
                    className={`px-2 py-1 bg-gray-800 rounded text-sm border w-20 ${features.completedBuildings[i] ? 'text-green-400 border-green-500' : 'border-gray-600'}`}>
                      <option value="">-</option>
                      {buildingOptions.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  ))}
```

Also add the "清除已完成" button after the last select. Replace the `</div>` on line 527 (the closing div of the flex container) and the `<p className="text-xs...">` on line 528 with:

```tsx
                  {features.completedBuildings.some(Boolean) && (
                    <button
                      onClick={() => {
                        const { selected, completed } = clearCompleted(features.selectedBuildings, features.completedBuildings);
                        setFeatures(prev => ({ ...prev, selectedBuildings: selected, completedBuildings: completed }));
                      }}
                      className="px-2 py-1 text-xs bg-red-800 hover:bg-red-700 text-red-200 rounded whitespace-nowrap"
                    >
                      清除已完成
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">确保资源足够升级建筑</p>
```

Note: The existing closing `</div>` on line 527 should be preserved. The button goes between the last `</select>` and that `</div>`.

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: remove exclusion on building selects, add completed styling and clear button"
```

---

### Task 4: Update TechSelect component and usage — add completed prop, remove exclusion, clear on change

**Files:**
- Modify: `web/src/pages/Home.tsx:28-95` (TechSelect component)
- Modify: `web/src/pages/Home.tsx:539-548` (TechSelect usage in autoResearch block)

- [ ] **Step 1: Add `completed` prop to TechSelect component**

Replace the TechSelect function signature and its button className (lines 28-58):

```tsx
function TechSelect({ value, onChange, excludeValues, economicTechs, militaryTechs, completed }: {
  value: string;
  onChange: (v: string) => void;
  excludeValues: string[];
  economicTechs: string[];
  militaryTechs: string[];
  completed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'economic' | 'military' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveTab(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isExcluded = (name: string) => excludeValues.includes(name) && name !== value;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); setActiveTab(null); }}
        className={`px-2 py-1 bg-gray-800 rounded text-sm border w-24 text-left truncate flex items-center justify-between ${completed ? 'text-green-400 border-green-500' : 'border-gray-600'}`}
      >
        <span className="truncate">{completed ? `✅ ${value}` : (value || <span className="text-gray-500">-</span>)}</span>
        {value && (
          <span className="ml-1 text-gray-500 hover:text-gray-300 flex-shrink-0" onClick={(e) => { e.stopPropagation(); onChange(''); }}>×</span>
        )}
      </button>
```

- [ ] **Step 2: Update TechSelect usage in the autoResearch block**

Replace the TechSelect usage (lines 539-548):

```tsx
                  {features.selectedTechs.map((val, i) => (
                    <TechSelect key={i} value={val}
                      onChange={(v) => {
                        const next = [...features.selectedTechs]; next[i] = v;
                        const nextCompleted = [...features.completedTechs]; nextCompleted[i] = false;
                        setFeatures({ ...features, selectedTechs: next, completedTechs: nextCompleted });
                      }}
                      excludeValues={[]}
                      economicTechs={economicTechs}
                      militaryTechs={militaryTechs}
                      completed={features.completedTechs[i]}
                    />
                  ))}
```

Also add the "清除已完成" button after the TechSelect list. After the closing `</div>` of `{features.autoResearch && ...}` block, but before the next feature label, insert the button inside the same flex container. Actually, looking at the current structure, the tech selects and button should be inside the same `<div className="flex items-center gap-2 flex-wrap">` that holds the selects. Replace the inner flex div that wraps the tech selects (lines 537-550 area):

The current structure after line 539:
```tsx
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">自动研究科技</span>
                  {features.selectedTechs.map((val, i) => (...))}
                </div>
```

Replace with:
```tsx
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">自动研究科技</span>
                  {features.selectedTechs.map((val, i) => (
                    <TechSelect key={i} value={val}
                      onChange={(v) => {
                        const next = [...features.selectedTechs]; next[i] = v;
                        const nextCompleted = [...features.completedTechs]; nextCompleted[i] = false;
                        setFeatures({ ...features, selectedTechs: next, completedTechs: nextCompleted });
                      }}
                      excludeValues={[]}
                      economicTechs={economicTechs}
                      militaryTechs={militaryTechs}
                      completed={features.completedTechs[i]}
                    />
                  ))}
                  {features.completedTechs.some(Boolean) && (
                    <button
                      onClick={() => {
                        const { selected, completed } = clearCompleted(features.selectedTechs, features.completedTechs);
                        setFeatures(prev => ({ ...prev, selectedTechs: selected, completedTechs: completed }));
                      }}
                      className="px-2 py-1 text-xs bg-red-800 hover:bg-red-700 text-red-200 rounded whitespace-nowrap"
                    >
                      清除已完成
                    </button>
                  )}
                </div>
```

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit`
Expected: No output

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat: add completed styling to TechSelect, remove exclusion, add clear button for techs"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full TypeScript check**

```bash
npx tsc --noEmit
```
Expected: No output

- [ ] **Step 2: Start frontend dev server and verify no runtime errors**

```bash
cd web && npm run dev
```

Open browser, check:
- Home page loads without errors
- Building dropdowns allow selecting the same building in multiple slots
- Tech dropdowns allow selecting the same tech in multiple slots
- Start a run, verify completed arrays reset
- (Manual visual check of completed styling requires actual execution)

- [ ] **Step 3: Commit if needed**

```bash
git add web/src/pages/Home.tsx
git commit -m "chore: final verification of completion tracking"
```
