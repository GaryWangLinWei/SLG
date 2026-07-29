# EXE Session Running Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the user’s start/stop intent for the lifetime of the Electron process, restore it after renderer remounts, and serialize rapid start/stop clicks so only one control operation runs at a time.

**Architecture:** Add an in-memory running-intent store owned by the Electron main process and expose two narrow IPC methods through preload. Home restores that intent once per mount, uses a small exclusive-operation guard around both local and remote start/stop handlers, and treats only a successful explicit stop as permission to clear the intent. Browser development retains a module-memory fallback without changing production semantics.

**Tech Stack:** Electron IPC, React 18 hooks, TypeScript, Jest + ts-jest, existing Koa task API

---

## File Structure

- Create `electron/runningIntentStore.ts` — focused process-lifetime boolean store with boolean input validation.
- Create `electron/runningIntentStore.test.ts` — unit tests for default, update, persistence within one store, and invalid input.
- Modify `electron/main.ts` — instantiate the store once and register `get-running-intent` / `set-running-intent` handlers.
- Modify `electron/preload.ts` — expose only `getRunningIntent()` and `setRunningIntent(boolean)`.
- Modify `web/src/types/electron.d.ts` — keep renderer API types aligned with preload.
- Create `web/src/utils/exclusiveOperation.ts` — framework-independent synchronous guard used to reject repeated async operations.
- Create `web/src/utils/exclusiveOperation.test.ts` — prove rapid calls serialize and failures release the guard.
- Modify `web/src/pages/Home.tsx` — restore intent, render loading/starting/stopping states, guard handlers, and update intent only at accepted start / successful explicit stop boundaries.
- Modify `jest.config.js` — include the two new focused test locations without enabling unrelated frontend component discovery.

## Behavioral Decisions Locked by the Spec

- The intent belongs to the whole EXE session, not an account.
- Account changes never read, clear, or overwrite the intent.
- Window minimize, tray hide, Home remount, and renderer reload preserve the intent.
- A fresh Electron main process starts with `false`.
- Natural action completion, scheduler waiting, and incidental frontend cleanup do not clear the intent.
- Start sets intent only after validation succeeds and the scheduler is accepted.
- Stop clears intent only after `stopByAccount` succeeds.
- Start/stop are serialized across both local clicks and remote SSE commands.

### Task 1: Add a Tested Main-Process Intent Store

**Files:**
- Create: `electron/runningIntentStore.ts`
- Create: `electron/runningIntentStore.test.ts`
- Modify: `jest.config.js:1-9`

- [ ] **Step 1: Extend Jest discovery only to the new focused tests**

Replace the Jest roots/test match with explicit existing and new locations:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/core', '<rootDir>/plugins', '<rootDir>/electron', '<rootDir>/web/src/utils'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};
```

- [ ] **Step 2: Write the failing store tests**

Create `electron/runningIntentStore.test.ts`:

```ts
import { createRunningIntentStore } from './runningIntentStore';

describe('running intent store', () => {
  it('starts false for a new process session', () => {
    expect(createRunningIntentStore().get()).toBe(false);
  });

  it('keeps the last boolean value for the store lifetime', () => {
    const store = createRunningIntentStore();
    expect(store.set(true)).toBe(true);
    expect(store.get()).toBe(true);
    expect(store.set(false)).toBe(false);
    expect(store.get()).toBe(false);
  });

  it('rejects non-boolean IPC input without changing the value', () => {
    const store = createRunningIntentStore();
    store.set(true);
    expect(() => store.set('false' as unknown as boolean)).toThrow('running intent must be a boolean');
    expect(store.get()).toBe(true);
  });
});
```

- [ ] **Step 3: Run the store test and verify the expected failure**

Run:

```bash
npx jest electron/runningIntentStore.test.ts --runInBand
```

Expected: FAIL because `./runningIntentStore` does not exist.

- [ ] **Step 4: Implement the minimal store**

Create `electron/runningIntentStore.ts`:

```ts
export interface RunningIntentStore {
  get(): boolean;
  set(value: boolean): boolean;
}

export function createRunningIntentStore(): RunningIntentStore {
  let value = false;

  return {
    get: () => value,
    set: (next: boolean) => {
      if (typeof next !== 'boolean') {
        throw new TypeError('running intent must be a boolean');
      }
      value = next;
      return value;
    },
  };
}
```

- [ ] **Step 5: Run the store test and verify it passes**

Run:

```bash
npx jest electron/runningIntentStore.test.ts --runInBand
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit the store**

```bash
git add jest.config.js electron/runningIntentStore.ts electron/runningIntentStore.test.ts
git commit -m "feat(electron): add session running intent store"
```

### Task 2: Expose the Session Intent Through Narrow Electron IPC

**Files:**
- Modify: `electron/main.ts:1-20,268-300`
- Modify: `electron/preload.ts:3-31`
- Modify: `web/src/types/electron.d.ts:1-18`

- [ ] **Step 1: Instantiate one store for the Electron process lifetime**

In `electron/main.ts`, import and create the store at module scope alongside the other process-level state:

```ts
import { createRunningIntentStore } from './runningIntentStore';

const runningIntentStore = createRunningIntentStore();
```

Do not create the store inside `createWindow()`: rebuilding BrowserWindow must not reset it.

- [ ] **Step 2: Register read/write IPC handlers**

Add beside the existing `get-app-version` and `get-adb-path` handlers:

```ts
ipcMain.handle('get-running-intent', () => runningIntentStore.get());

ipcMain.handle('set-running-intent', (_event, value: unknown) => {
  return runningIntentStore.set(value as boolean);
});
```

The store performs runtime validation so malformed renderer input cannot silently coerce truthy values.

- [ ] **Step 3: Expose the two preload methods**

Add to `contextBridge.exposeInMainWorld('electronAPI', ...)` in `electron/preload.ts`:

```ts
getRunningIntent: () => ipcRenderer.invoke('get-running-intent'),
setRunningIntent: (value: boolean) => ipcRenderer.invoke('set-running-intent', value),
```

Add matching declarations in the same file’s global interface:

```ts
getRunningIntent: () => Promise<boolean>;
setRunningIntent: (value: boolean) => Promise<boolean>;
```

- [ ] **Step 4: Keep the web declaration synchronized**

Add to `ElectronAPI` in `web/src/types/electron.d.ts`:

```ts
getRunningIntent: () => Promise<boolean>;
setRunningIntent: (value: boolean) => Promise<boolean>;
```

- [ ] **Step 5: Run the root TypeScript build**

Run:

```bash
npm run build
```

Expected: PASS with no TypeScript errors in Electron, server, core, or plugins.

- [ ] **Step 6: Commit the IPC bridge**

```bash
git add electron/main.ts electron/preload.ts web/src/types/electron.d.ts
git commit -m "feat(electron): expose running intent IPC"
```

### Task 3: Add a Tested Exclusive Async Operation Guard

**Files:**
- Create: `web/src/utils/exclusiveOperation.ts`
- Create: `web/src/utils/exclusiveOperation.test.ts`

- [ ] **Step 1: Write failing rapid-operation tests**

Create `web/src/utils/exclusiveOperation.test.ts`:

```ts
import { createExclusiveOperation } from './exclusiveOperation';

describe('exclusive operation', () => {
  it('rejects repeated calls while the first operation is pending', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const operation = jest.fn(async () => pending);
    const exclusive = createExclusiveOperation(operation);

    const first = exclusive.run();
    const second = exclusive.run();

    expect(operation).toHaveBeenCalledTimes(1);
    expect(await second).toBe(false);
    release();
    expect(await first).toBe(true);
  });

  it('releases the lock after a failure so the user can retry', async () => {
    const operation = jest.fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(undefined);
    const exclusive = createExclusiveOperation(operation);

    await expect(exclusive.run()).rejects.toThrow('failed');
    await expect(exclusive.run()).resolves.toBe(true);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the guard test and verify the expected failure**

Run:

```bash
npx jest web/src/utils/exclusiveOperation.test.ts --runInBand
```

Expected: FAIL because `./exclusiveOperation` does not exist.

- [ ] **Step 3: Implement the minimal guard**

Create `web/src/utils/exclusiveOperation.ts`:

```ts
export interface ExclusiveOperation {
  isLocked(): boolean;
  run(): Promise<boolean>;
}

export function createExclusiveOperation(operation: () => Promise<void>): ExclusiveOperation {
  let locked = false;

  return {
    isLocked: () => locked,
    run: async () => {
      if (locked) return false;
      locked = true;
      try {
        await operation();
        return true;
      } finally {
        locked = false;
      }
    },
  };
}
```

- [ ] **Step 4: Run the guard test and verify it passes**

Run:

```bash
npx jest web/src/utils/exclusiveOperation.test.ts --runInBand
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit the guard**

```bash
git add web/src/utils/exclusiveOperation.ts web/src/utils/exclusiveOperation.test.ts
git commit -m "feat(web): add exclusive operation guard"
```

### Task 4: Restore Session Intent on Home Mount

**Files:**
- Modify: `web/src/pages/Home.tsx:1-20,274-276,493-517`

- [ ] **Step 1: Define renderer fallback and UI state types**

Near the existing module-level loop state, add:

```ts
type OperationState = 'idle' | 'starting' | 'stopping';
let browserRunningIntent = false;
```

Inside Home, replace the button’s independent `taskRunning` initialization with explicit intent loading state:

```ts
const [runningIntent, setRunningIntent] = useState(false);
const [intentLoaded, setIntentLoaded] = useState(false);
const [intentLoadError, setIntentLoadError] = useState<string | null>(null);
const [operationState, setOperationState] = useState<OperationState>('idle');
```

Keep `loopRunningState` because it is separately reported to remote control. During this task, leave `taskRunning` references in place until Task 6 performs the display migration, so changes remain compilable task-by-task.

- [ ] **Step 2: Add one intent read helper independent of account changes**

Inside Home, add:

```ts
const loadRunningIntent = async () => {
  setIntentLoaded(false);
  setIntentLoadError(null);
  try {
    const value = IS_ELECTRON
      ? await window.electronAPI!.getRunningIntent()
      : browserRunningIntent;
    setRunningIntent(value);
    setIntentLoaded(true);
  } catch (error: any) {
    setIntentLoadError(error?.message || '无法读取运行状态');
  }
};
```

- [ ] **Step 3: Replace account-based task recovery with mount-only intent recovery**

Delete the existing effect at `Home.tsx:493-517` that calls `api.tasks.list()` and infers Home state from `running` tasks. Replace it with:

```ts
useEffect(() => {
  loadRunningIntent();
  // EXE session intent is global and must not reload on account changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

Do not add `currentAccountId`, focus, visibility, or `location.pathname` dependencies. A surviving Home instance keeps its local state; a newly mounted renderer reads the Electron process state.

- [ ] **Step 4: Add an explicit retry path for read failures**

In the status/action area, before the normal action button branch, render:

```tsx
{intentLoadError ? (
  <button
    onClick={loadRunningIntent}
    className="px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-full"
  >
    状态读取失败，点击重试
  </button>
) : !intentLoaded ? (
  <button disabled className="px-8 py-3 bg-slate-400 text-white font-bold rounded-full opacity-70">
    状态读取中...
  </button>
) : (
  // existing connected start/stop branch; migrated fully in Task 6
)}
```

Preserve the existing “连接设备” branch ahead of this block if no device is connected.

- [ ] **Step 5: Run the frontend build**

Run:

```bash
cd web && npm run build
```

Expected: PASS. If JSX branch restructuring produces a syntax error, correct only the parentheses/fragment structure; do not change behavior beyond the states above.

- [ ] **Step 6: Commit mount restoration**

```bash
git add web/src/pages/Home.tsx
git commit -m "feat(home): restore Electron session running intent"
```

### Task 5: Add Intent Read/Write Helpers and Operation Locking

**Files:**
- Modify: `web/src/pages/Home.tsx:1-20,260-300,683-789,2208-2243`

- [ ] **Step 1: Add synchronous handler lock state**

Import the guard factory:

```ts
import { createExclusiveOperation } from '../utils/exclusiveOperation';
```

Because the existing handlers capture many changing values, use a React ref as the integration lock rather than retaining a guard closure with stale dependencies:

```ts
const operationLockRef = useRef(false);
```

The pure guard remains the unit-tested specification of the lock semantics; the ref applies the same immediate-check/finally-release pattern safely inside Home.

- [ ] **Step 2: Add one intent writer**

Inside Home, add:

```ts
const persistRunningIntent = async (value: boolean) => {
  const saved = IS_ELECTRON
    ? await window.electronAPI!.setRunningIntent(value)
    : (browserRunningIntent = value);
  setRunningIntent(saved);
  return saved;
};
```

- [ ] **Step 3: Split start into guarded wrapper and implementation**

Rename the existing function body from `handleStartAll` to `startAllImpl`:

```ts
const startAllImpl = async (source: 'local' | 'remote' = 'local') => {
  // existing start body
};
```

Add the wrapper immediately after it:

```ts
const handleStartAll = async (source: 'local' | 'remote' = 'local') => {
  if (operationLockRef.current) return;
  operationLockRef.current = true;
  setOperationState('starting');
  try {
    await startAllImpl(source);
  } finally {
    setOperationState('idle');
    operationLockRef.current = false;
  }
};
```

Remote SSE continues calling `handleStartAll('remote')`, so local and remote commands share the same lock.

- [ ] **Step 4: Persist true only at the accepted-start boundary**

At the existing accepted-start boundary, after all validation and immediately after:

```ts
loopRunning = true;
setLoopRunningState(true);
loopStopped = false;
```

add:

```ts
try {
  await persistRunningIntent(true);
} catch (error: any) {
  loopStopped = true;
  loopRunning = false;
  setLoopRunningState(false);
  pushLog(`❌ 无法保存运行状态: ${error?.message || error}`);
  return;
}
```

This location is after account/device/feature checks, so rejected starts do not create a false intent. It is before the long-running async loop is launched, so IPC failure can abort cleanly without leaving an untracked scheduler.

- [ ] **Step 5: Split stop into guarded wrapper and implementation**

Rename the existing stop body to:

```ts
const stopImpl = async (source: 'local' | 'remote' = 'local') => {
  // existing stop body
};
```

Add:

```ts
const handleStop = async (source: 'local' | 'remote' = 'local') => {
  if (operationLockRef.current) return;
  operationLockRef.current = true;
  setOperationState('stopping');
  try {
    await stopImpl(source);
  } finally {
    setOperationState('idle');
    operationLockRef.current = false;
  }
};
```

- [ ] **Step 6: Make stop failure explicit and clear intent only after success**

Replace the swallowed stop error block with:

```ts
if (!currentAccountId) {
  pushLog('❌ 未选择账号，无法停止后端任务');
  return;
}

try {
  const result = await api.tasks.stopByAccount(currentAccountId);
  if (!result.success) throw new Error('后端拒绝停止任务');
  if (result.stopped.length > 0) {
    pushLog(`⏹️ 后端停止 ${result.stopped.length} 个任务`);
  }
} catch (error: any) {
  pushLog(`❌ 停止失败: ${error?.message || error}`);
  return;
}

try {
  await persistRunningIntent(false);
} catch (error: any) {
  pushLog(`❌ 任务已停止，但会话状态更新失败: ${error?.message || error}`);
  setIntentLoaded(false);
  setIntentLoadError('会话状态更新失败，请重试读取');
  return;
}
```

Move the existing success log `⏹️ 已停止所有任务` after the successful intent write. Keep local cancellation flags/timer cleanup before the backend call so in-renderer loops stop promptly, but do not set the displayed intent to false until both backend stop and IPC write succeed.

- [ ] **Step 7: Run focused tests and frontend build**

Run:

```bash
npx jest electron/runningIntentStore.test.ts web/src/utils/exclusiveOperation.test.ts --runInBand
cd web && npm run build
```

Expected: both test suites PASS and the Vite production build PASS.

- [ ] **Step 8: Commit handler serialization**

```bash
git add web/src/pages/Home.tsx
git commit -m "fix(home): serialize start and stop operations"
```

### Task 6: Make the Button Display Only the Session Intent

**Files:**
- Modify: `web/src/pages/Home.tsx:274-276,658-675,2197-2204,2303-2355`

- [ ] **Step 1: Remove task-driven button resets**

Replace the button/status uses of `taskRunning` with `runningIntent`. Remove `setTaskRunning(false)` from:

- successful device reconnection cleanup;
- the natural end of the async scheduler;
- any task completion or incidental cleanup path.

Remove `setTaskRunning(true)` from start after intent persistence; `persistRunningIntent(true)` now owns that UI transition. Once no references remain, delete the `taskRunning` state declaration.

Do **not** remove `loopRunningState` updates: that state still reports actual loop activity to `RemoteContextService` and has a different purpose.

- [ ] **Step 2: Render the status banner from intent plus operation state**

Use:

```tsx
<h3 className="font-semibold text-slate-800">
  {!intentLoaded
    ? '状态读取中'
    : operationState === 'starting'
      ? '启动中'
      : operationState === 'stopping'
        ? '停止中'
        : runningIntent
          ? '运行中'
          : '准备就绪'}
</h3>
```

- [ ] **Step 3: Render transition buttons and disable repeated clicks**

After the existing disconnected-device branch and intent loading/error branches, use:

```tsx
{operationState === 'starting' ? (
  <button disabled className="px-8 py-3 bg-emerald-400 text-white font-bold rounded-full opacity-70">
    启动中...
  </button>
) : operationState === 'stopping' ? (
  <button disabled className="px-8 py-3 bg-red-400 text-white font-bold rounded-full opacity-70">
    停止中...
  </button>
) : !runningIntent ? (
  <button
    onClick={() => handleStartAll('local')}
    className="px-8 py-3 bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-bold rounded-full hover:from-emerald-600 hover:to-emerald-500 transition-all shadow-lg shadow-emerald-500/30 flex items-center gap-2"
  >
    <span>▶</span> 开始运行
  </button>
) : (
  <button
    onClick={() => handleStop('local')}
    className="px-8 py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-full transition-all flex items-center gap-2"
  >
    <span>⏹</span> 停止运行
  </button>
)}
```

Keep the project’s current exact stop-button classes if they differ; only the condition and disabled transition branches are behavioral changes.

- [ ] **Step 4: Confirm account switching has no intent effect**

Search `Home.tsx` for all calls to `loadRunningIntent`, `persistRunningIntent`, and `setRunningIntent`. Verify:

- `loadRunningIntent` appears only in mount initialization and explicit retry;
- `persistRunningIntent(true)` appears only at accepted start;
- `persistRunningIntent(false)` appears only after successful explicit stop;
- no account/profile switch callback changes intent.

Run:

```bash
rg -n "loadRunningIntent|persistRunningIntent|setRunningIntent" web/src/pages/Home.tsx
```

Expected: only the locations above; no `currentAccountId`-dependent intent effect.

- [ ] **Step 5: Run frontend and root builds**

Run:

```bash
cd web && npm run build
cd .. && npm run build
```

Expected: both commands PASS with no TypeScript errors.

- [ ] **Step 6: Commit the display migration**

```bash
git add web/src/pages/Home.tsx
git commit -m "fix(home): keep stop state for Electron session"
```

### Task 7: Verify Failure Paths and Packaged-App Behavior

**Files:**
- Test: `electron/runningIntentStore.test.ts`
- Test: `web/src/utils/exclusiveOperation.test.ts`
- Verify: `electron/main.ts`
- Verify: `electron/preload.ts`
- Verify: `web/src/pages/Home.tsx`

- [ ] **Step 1: Run all directly relevant automated tests**

Run:

```bash
npx jest electron/runningIntentStore.test.ts web/src/utils/exclusiveOperation.test.ts --runInBand
```

Expected: 2 suites PASS, 5 tests PASS.

- [ ] **Step 2: Run both TypeScript production builds**

Run:

```bash
npm run build
cd web && npm run build
```

Expected: both PASS. Do not run the root `npm run lint`; project instructions identify it as invalid.

- [ ] **Step 3: Build the Windows package**

Run:

```bash
npm run electron:build:win
```

Expected: PASS and a new Windows installer/artifact under `release/`. Do not publish it.

- [ ] **Step 4: Manually verify the two reported restore paths**

In the packaged EXE:

1. Start one configured account and wait until the button says “停止运行”.
2. Click the title-bar “—”, restore the window, and confirm it still says “停止运行”.
3. Close to tray with “×”, restore from the tray, and confirm it still says “停止运行”.
4. Use renderer reload in development/testing and confirm the mount first shows “状态读取中”, then “停止运行”.
5. Switch account/profile and confirm the button remains “停止运行” without starting or stopping anything automatically.
6. Click stop and confirm the backend has no `pending`/`running` tasks for that account and the button changes to “开始运行”.
7. Fully exit the EXE, reopen it, and confirm the button starts at “开始运行”.

- [ ] **Step 5: Manually verify rapid clicks and failures**

1. Rapidly click Start 3–5 times; confirm one start log, one scheduler generation, and no duplicate backend task burst.
2. Rapidly click Stop 3–5 times; confirm one `stop-by-account` request and one stop log.
3. Temporarily make the local backend unavailable before Stop; confirm the button returns to “停止运行” with a failure log and allows retry.
4. Restore the backend and retry Stop; confirm the intent clears only after success.

- [ ] **Step 6: Review the final diff for scope**

Run:

```bash
git status --short
git diff --check
git diff HEAD~3 -- electron/main.ts electron/preload.ts electron/runningIntentStore.ts web/src/types/electron.d.ts web/src/utils/exclusiveOperation.ts web/src/pages/Home.tsx jest.config.js
```

Expected: no whitespace errors; no task polling, account-switch synchronization, disk persistence, or scheduler migration.

- [ ] **Step 7: Commit any verification-only corrections**

If verification required code corrections:

```bash
git add electron/main.ts electron/preload.ts electron/runningIntentStore.ts electron/runningIntentStore.test.ts web/src/types/electron.d.ts web/src/utils/exclusiveOperation.ts web/src/utils/exclusiveOperation.test.ts web/src/pages/Home.tsx jest.config.js
git commit -m "fix: harden session running intent flow"
```

If no corrections were needed, do not create an empty commit.
