import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useAccount } from '../contexts/AccountContext';
import { useLicense } from '../contexts/LicenseContext';
import { DEFAULT_HOME_FEATURES, DEFAULT_COLLECT_RESOURCES_INTERVAL_MINUTES, MIN_COLLECT_RESOURCES_INTERVAL_MINUTES, DEFAULT_AUTO_RECONNECT_INTERVAL_MINUTES, TeamPageChoice, getCollectResourcesIntervalSeconds } from '../../../plugins/rok/homeFeatures';
import { remoteApi } from '../api/remote';
import { isComboGemActive } from '../utils/comboGemMode';

// Electron 打包后 HTML 走 file://，相对路径 /api 会失败；必须显式指向本地后端
const IS_ELECTRON = typeof window !== 'undefined' && 'electronAPI' in window;
const LOCAL_API_BASE = IS_ELECTRON ? 'http://localhost:3000' : '';
/** 账号调度最大槽位：dev 放开到 4 便于本地多号测试，生产保持 2。 */
const MAX_SWITCH_SLOTS = import.meta.env.DEV ? 4 : 2;
import { createLoopCancellationPredicate, guardedCreateTask, isCurrentLoopGeneration } from '../utils/loopGeneration';
import { persistRunningSession, readRunningSession, RunningSession } from '../utils/runningIntent';
import { deriveRunningControlView, OperationState } from '../utils/runningControlView';
import { buildSwitchSteps, deriveProfileKinds, nextSwitchTargetIdx, validateSwitchProfiles, type ProfileSwitchMeta } from '../utils/accountSwitchPlan';

// Module-level loop state — survives component unmount/remount during SPA navigation
let browserRunningSession: RunningSession = { running: false, accountId: null };
let loopStopped = false;
let loopRunning = false;
// generation counter：每次 handleStop 递增，用于让旧的 loop 感知到"我这一代已经作废"
// 修复 bug：连点停止→开始，前一次 loop 卡在 `await api.tasks.run` 上，等 stop 让它 resolve 时
// 新的 loopStopped 已被下一次 handleStartAll 置回 false，旧 loop 继续跑，导致点停止无效。
let loopGen = 0;
let killInFlight = false;
let loopLogs: string[] = [];
let loopCompletedBuildings: boolean[] = [false, false, false, false, false];
let loopCompletedTechs: boolean[] = [false, false, false, false, false];
let deviceBusy = false;
let attackPreempt = false;   // 攻击检测抢占旗：其它子循环 acquireLock 时让路
let barbarianPreempt = false; // 自动打野抢占旗：打野待执行时优先于普通功能拿锁
const GATHER_LOOP_INTERVAL = 300; // 城外采集独立循环间隔（秒）
// 宝石已采集坐标跨轮次记忆：按 accountId 隔离，1 小时 TTL 自动过期
const GEM_COORD_TTL_MS = 60 * 60 * 1000;
const gemCoordMemory: Map<string, { coord: string; ts: number }[]> = new Map();

// 分享矿已分享坐标记忆：按 accountId 隔离，无 TTL，start 时清空、stop 保留、切号不影响
const sharedGemCoordMemory: Map<string, Set<string>> = new Map();
function getSharedGemCoords(accountId: string): string[] {
  return [...(sharedGemCoordMemory.get(accountId) ?? new Set<string>())];
}
const COMBO_GEM_POOL_ACCOUNT_ID = 'combo-gem';

function recordSharedGemCoordsFromLogs(accountId: string, logs: string[]): number {
  const set = sharedGemCoordMemory.get(accountId) ?? new Set<string>();
  let added = 0;
  for (const line of logs) {
    const tagged = line.match(/\[坐标\]\s*记录已分享:\s*x:\s*(\d+)\s*y:\s*(\d+)/i);
    const legacy = line.match(/\[坐标\]\s*记录已分享:\s*(\S+)/);
    const coord = tagged ? `${tagged[1]}${tagged[2]}` : legacy?.[1].replace(/[^0-9]/g, '');
    if (coord && !set.has(coord)) {
      set.add(coord);
      added++;
    }
  }
  if (added > 0) sharedGemCoordMemory.set(accountId, set);
  return added;
}
function clearAllSharedGemMemory() {
  sharedGemCoordMemory.clear();
}

function getFreshGemCoords(accountId: string): string[] {
  const now = Date.now();
  const arr = gemCoordMemory.get(accountId) ?? [];
  const fresh = arr.filter(e => now - e.ts < GEM_COORD_TTL_MS);
  if (fresh.length !== arr.length) gemCoordMemory.set(accountId, fresh);
  return fresh.map(e => e.coord);
}
function recordGemCoordsFromLogs(accountId: string, logs: string[]): number {
  const now = Date.now();
  const arr = gemCoordMemory.get(accountId) ?? [];
  const known = new Set(arr.map(e => e.coord));
  let added = 0;
  for (const line of logs) {
    const m = line.match(/\[坐标\]\s*记录已采集:\s*(\S+)/);
    if (m) {
      // 复用 action 内的规则：只保留数字字符
      const coord = m[1].replace(/[^0-9]/g, '');
      if (coord && !known.has(coord)) {
        arr.push({ coord, ts: now });
        known.add(coord);
        added++;
      }
    }
  }
  if (added > 0) gemCoordMemory.set(accountId, arr);
  return added;
}
// 旧字段 gemGatherFocusMode -> 新字段 gemGatherMode 迁移
function migrateGemMode(raw: any): 'normal' | 'focus' | 'mixed' {
  if (raw?.gemGatherMode === 'focus' || raw?.gemGatherMode === 'mixed' || raw?.gemGatherMode === 'normal') {
    return raw.gemGatherMode;
  }
  if (raw?.gemGatherFocusMode === true) return 'focus';
  return 'normal';
}
const NIGHT_START_MINUTE = 2 * 60;
const NIGHT_END_MINUTE = 5 * 60;
const NIGHT_START_JITTER_MIN = -15;
const NIGHT_START_JITTER_MAX = 20;
const NIGHT_END_JITTER_MIN = -10;
const NIGHT_END_JITTER_MAX = 30;
const monotonicNow = () => performance.now(); // 不受用户修改系统时间影响，用于持续时间计时
let moduleGemInitialCount: number | null = null;
let moduleGemCollectedCount: number = 0;
let offlineActive = false;             // 当前是否处于下线状态
let lastOfflineState = false;          // 上次的状态（用于边沿检测）
let moduleGemRestActive = false;       // 宝石采集 rest 阶段标志
let nightStartOffsetMinutes = 0;       // 夜间下线开始抖动（每次开始运行生成一次）
let nightEndOffsetMinutes = 0;         // 夜间下线结束抖动（每次开始运行生成一次）
let bottomBarChecked = false;          // 主循环是否已确认底部菜单栏（launch-game 后需重置）
let relaunchRequested = false;         // launch-game 后请求各子循环重置状态、从头开始（等价于重新点开始运行）
let cooldownResetSeq = 0;               // 切号后各子循环打断 CD 等待用；每次重置 +1，等待循环里对比初值
let pendingAccountSwitch = false;    // 切号触发 flag：per-round 每轮末尾置 true；per-time setTimeout 到点置 true
let switchTargetIdx = 0;             // 下一个要切到的 profile 索引（0 或 1）
let switchTimerId: ReturnType<typeof setTimeout> | null = null;
let fortModeFallbackTimerId: ReturnType<typeof setTimeout> | null = null;  // 寨子模式兜底：切号后 20 分钟内无成功也触发切号

// 日志聚合：loopLogs 是唯一真源；组件挂载时注册 setter，卸载时置 null。
// 这样即使 Home 被卸载（切页/后台），日志也不会因 setter 失效而丢失。
let logSetter: ((updater: (prev: string[]) => string[]) => void) | null = null;
function pushLog(msg: string) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  loopLogs = [...loopLogs, line];
  if (logSetter) {
    try { logSetter(prev => [...prev, line]); } catch {}
  }
}
// 直接追加已带时间戳的原始日志行（来自后端 task.logs），不再重复加时间戳。
function appendLogLines(lines: string[]) {
  if (lines.length === 0) return;
  loopLogs = [...loopLogs, ...lines];
  if (logSetter) {
    try { logSetter(prev => [...prev, ...lines]); } catch {}
  }
}

const LOOP_STATE_KEY = 'loop-state';
const TEAM_PAGE_OPTIONS: Array<{ value: TeamPageChoice; label: string }> = [
  { value: 'gather', label: '蓝' },
  { value: 'attack', label: '红' },
  { value: 'other', label: '黄' },
];
const isTeamPageChoice = (value: unknown): value is TeamPageChoice => value === 'gather' || value === 'attack' || value === 'other';
const randomBiasedOffset = (min: number, max: number) => {
  const negativeSize = Math.abs(Math.min(0, min));
  const positiveSize = Math.max(0, max);
  const chooseNegative = Math.random() < negativeSize / (negativeSize + positiveSize);
  const limit = chooseNegative ? negativeSize : positiveSize;
  const magnitude = Math.round(limit * Math.random() * Math.random());
  return chooseNegative ? -magnitude : magnitude;
};
const formatMinuteOfDay = (minute: number) => {
  const normalized = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

function saveLoopState(accountId: string) {
  try {
    sessionStorage.setItem(LOOP_STATE_KEY, JSON.stringify({
      accountId,
      logs: loopLogs.slice(-200)
    }));
  } catch {}
}

function clearLoopState() {
  loopLogs = [];
  moduleGemInitialCount = null;
  moduleGemCollectedCount = 0;
  offlineActive = false;
  lastOfflineState = false;
  moduleGemRestActive = false;
  nightStartOffsetMinutes = 0;
  nightEndOffsetMinutes = 0;
  bottomBarChecked = false;
  relaunchRequested = false;
  try { sessionStorage.removeItem(LOOP_STATE_KEY); } catch {}
}

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
        className={`px-2 py-1 bg-gray-50 rounded text-sm border w-24 text-left truncate flex items-center justify-between ${completed ? 'text-green-600 border-green-500' : 'border-gray-300'}`}
      >
        <span className="truncate">{completed && value ? `✅ ${value}` : (value || <span className="text-gray-400">-</span>)}</span>
        {value && (
          <span className="ml-1 text-gray-400 hover:text-gray-700 flex-shrink-0" onClick={(e) => { e.stopPropagation(); onChange(''); }}>×</span>
        )}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-48 bg-white border border-gray-300 rounded shadow-lg max-h-80 overflow-y-auto">
          <button
            onClick={() => setActiveTab(activeTab === 'economic' ? null : 'economic')}
            className="w-full text-left px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-blue-50 border-b border-gray-200 sticky top-0 bg-white"
          >
            {activeTab === 'economic' ? '▼' : '▶'} 经济科技
          </button>
          {activeTab === 'economic' && economicTechs.filter(t => !isExcluded(t)).map(name => (
            <button
              key={name}
              onClick={() => { onChange(name); setOpen(false); setActiveTab(null); }}
              className={`w-full text-left px-5 py-1 text-sm hover:bg-blue-50 ${name === value ? 'text-blue-600' : ''}`}
            >{name}</button>
          ))}
          <button
            onClick={() => setActiveTab(activeTab === 'military' ? null : 'military')}
            className="w-full text-left px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-blue-50 border-b border-gray-200 sticky top-0 bg-white"
          >
            {activeTab === 'military' ? '▼' : '▶'} 军事科技
          </button>
          {activeTab === 'military' && militaryTechs.filter(t => !isExcluded(t)).map(name => (
            <button
              key={name}
              onClick={() => { onChange(name); setOpen(false); setActiveTab(null); }}
              className={`w-full text-left px-5 py-1 text-sm hover:bg-blue-50 ${name === value ? 'text-blue-600' : ''}`}
            >{name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HomePage() {
  const { currentAccountId } = useAccount();
  const location = useLocation();
  const { status: licenseStatus, refreshStatus, setExpiredMessage } = useLicense();
  const isPro = licenseStatus?.tier === 'pro';
  const PRO_FEATURES = ['gemGather', 'autoSwitchAccount', 'joinRally', 'shareGem', 'attackBarbarian'];
  const isFeatureLocked = (featureId: string) => !isPro && PRO_FEATURES.includes(featureId);
  const [activeConfigName, setActiveConfigName] = useState('');
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
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [loopRunningState, setLoopRunningState] = useState(false);
  const [runningIntent, setRunningIntent] = useState(false);
  const [runningOwnerAccountId, setRunningOwnerAccountId] = useState<string | null>(null);
  const [intentLoaded, setIntentLoaded] = useState(false);
  const [intentLoadError, setIntentLoadError] = useState<string | null>(null);
  const [operationState, setOperationState] = useState<OperationState>('idle');
  const operationLockRef = useRef(false);
  const startHandlerRef = useRef<(source?: 'local' | 'remote') => Promise<void>>(async () => {});
  const stopHandlerRef = useRef<() => Promise<void>>(async () => {});
  const runningTaskIdsRef = useRef<string[]>([]);
  const lastPostedLogIndexRef = useRef(0);
  const pendingLogBatchRef = useRef<string[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  const scheduleLogFlush = () => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      const batch = pendingLogBatchRef.current;
      pendingLogBatchRef.current = [];
      batch.forEach(msg => {
        fetch(`${LOCAL_API_BASE}/api/logs/append`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg }),
        }).catch(() => { /* best effort */ });
      });
    }, 100);
  };
  const [_runningTaskIds, setRunningTaskIds] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>(loopLogs);
  const [gemRestCountdown, setGemRestCountdown] = useState<string>('');
  const [gemInitialCount, setGemInitialCount] = useState<number | null>(moduleGemInitialCount);
  const [gemCollectedCount, setGemCollectedCount] = useState<number>(moduleGemCollectedCount);
  const [remoteCodeModal, setRemoteCodeModal] = useState(false);
  const [remoteInfo, setRemoteInfo] = useState<{ shortId: string; hasPassword: boolean } | null>(null);
  const [remoteInfoLoading, setRemoteInfoLoading] = useState(false);
  const [remoteInfoError, setRemoteInfoError] = useState('');
  const [passwordModal, setPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  async function loadRemoteInfo() {
    setRemoteInfoLoading(true);
    setRemoteInfoError('');
    try {
      const result = await remoteApi.getDeviceInfo();
      if (result.success && result.shortId) {
        setRemoteInfo({ shortId: result.shortId, hasPassword: !!result.hasPassword });
      } else {
        setRemoteInfoError(result.error || '获取识别码失败');
      }
    } catch (e: any) {
      setRemoteInfoError('网络错误: ' + (e.message || e));
    } finally {
      setRemoteInfoLoading(false);
    }
  }

  async function handleOpenRemoteControl() {
    setRemoteCodeModal(true);
    setRemoteInfo(null);
    await loadRemoteInfo();
  }

  async function handleSavePassword() {
    if (!/^\d{6}$/.test(passwordInput)) {
      setPasswordError('请输入 6 位数字');
      return;
    }
    setPasswordSaving(true);
    setPasswordError('');
    try {
      const result = await remoteApi.setPassword(passwordInput);
      if (result.success) {
        setPasswordModal(false);
        setPasswordInput('');
        await loadRemoteInfo();
      } else {
        setPasswordError(result.error || '保存失败');
      }
    } catch (e: any) {
      setPasswordError('网络错误: ' + (e.message || e));
    } finally {
      setPasswordSaving(false);
    }
  }
  useEffect(() => {
    // 挂载时把 loopLogs 灌到 UI；卸载时不再写回（pushLog 是 loopLogs 的唯一写入者）
    logSetter = setLogs;
    setLogs(loopLogs);
    return () => { logSetter = null; };
  }, []);
  const logContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);
  const DEFAULT_FEATURES = {
    ...DEFAULT_HOME_FEATURES,
    completedBuildings: [false, false, false, false, false] as boolean[],
    completedTechs: [false, false, false, false, false] as boolean[],
  };

  // 老数据 gatherTasks 只有 5 项，从任何来源（localStorage / 云端 config）载入后都要补齐到 7 项
  const padGatherTasks = (f: any) => {
    if (Array.isArray(f?.gatherTasks)) {
      while (f.gatherTasks.length < 7) {
        f.gatherTasks.push({ type: '', level: 1 });
      }
    }
    return f;
  };

  // 切 profile 时保留的全局字段（不属于任何单个账号）
  const GLOBAL_FIELDS = ['autoSwitchAccount', 'switchMode', 'switchIntervalMinutes', 'switchProfileIds'] as const;
  const preserveGlobalFields = (prev: any, next: any) => {
    const out = { ...next };
    for (const k of GLOBAL_FIELDS) {
      if (prev[k] !== undefined) out[k] = prev[k];
    }
    return out;
  };

  // 老配置可能把 switchIntervalMinutes 存成单个 number，统一读成长度 = MAX_SWITCH_SLOTS 的数组
  const normalizeIntervals = (raw: unknown): number[] => {
    const fallback = typeof raw === 'number' ? raw : 30;
    const arr = Array.isArray(raw) ? raw.slice() : [];
    while (arr.length < MAX_SWITCH_SLOTS) arr.push(fallback);
    return arr.slice(0, MAX_SWITCH_SLOTS).map((v: any) => Math.max(1, parseInt(String(v), 10) || 30));
  };

  const loadFeatures = () => {    try {
      const saved = localStorage.getItem('home-features');
      if (saved) {
        const parsed = JSON.parse(saved);
        // 迁移旧版 trainTasks 数组格式 → Record 格式
        if (Array.isArray(parsed.trainTasks)) {
          parsed.trainTasks = DEFAULT_FEATURES.trainTasks;
        }
        // 老配置缺 trainPromote 时补默认
        if (!parsed.trainPromote || typeof parsed.trainPromote !== 'object') {
          parsed.trainPromote = DEFAULT_FEATURES.trainPromote;
        }
        if (typeof parsed.attackBarbarianLoopCount !== 'number') {
          parsed.attackBarbarianLoopCount = DEFAULT_FEATURES.attackBarbarianLoopCount;
        }
        // Migrate old state without completed arrays
        const merged = { ...DEFAULT_FEATURES, ...parsed };
        if (!Array.isArray(merged.completedBuildings) || merged.completedBuildings.length !== 5) {
          merged.completedBuildings = [false, false, false, false, false];
        }
        if (!Array.isArray(merged.completedTechs) || merged.completedTechs.length !== 5) {
          merged.completedTechs = [false, false, false, false, false];
        }
        // Migrate old rallyFortTasks array to rallyFortLevel/rallyFortTeam
        if (Array.isArray(merged.rallyFortTasks)) {
          const firstActive = merged.rallyFortTasks.find((t: any) => t.level > 0);
          merged.rallyFortLevel = firstActive ? firstActive.level : 0;
          merged.rallyFortTeam = firstActive ? firstActive.team : 1;
          delete merged.rallyFortTasks;
        }
        if (typeof merged.rallyFortLevel !== 'number') merged.rallyFortLevel = DEFAULT_FEATURES.rallyFortLevel;
        if (typeof merged.rallyFortTeam !== 'number') merged.rallyFortTeam = DEFAULT_FEATURES.rallyFortTeam;
        if (!isTeamPageChoice(merged.rallyFortTeamPage)) merged.rallyFortTeamPage = DEFAULT_FEATURES.rallyFortTeamPage;
        if (!isTeamPageChoice(merged.resourceGatherTeamPage)) merged.resourceGatherTeamPage = DEFAULT_FEATURES.resourceGatherTeamPage;
        if (!isTeamPageChoice(merged.gemGatherTeamPage)) merged.gemGatherTeamPage = DEFAULT_FEATURES.gemGatherTeamPage;
        if (typeof merged.attackBarbarianLevel !== 'number') merged.attackBarbarianLevel = DEFAULT_FEATURES.attackBarbarianLevel;
        if (typeof merged.attackBarbarianCount !== 'number') merged.attackBarbarianCount = DEFAULT_FEATURES.attackBarbarianCount;
        if (typeof merged.attackBarbarianTeam !== 'number') merged.attackBarbarianTeam = DEFAULT_FEATURES.attackBarbarianTeam;
        if (!isTeamPageChoice(merged.attackBarbarianTeamPage)) merged.attackBarbarianTeamPage = DEFAULT_FEATURES.attackBarbarianTeamPage;
        if (typeof merged.attackBarbarianUsePotion !== 'boolean') merged.attackBarbarianUsePotion = DEFAULT_FEATURES.attackBarbarianUsePotion;
        if (typeof merged.attackBarbarianIntervalMinutes !== 'number') merged.attackBarbarianIntervalMinutes = DEFAULT_FEATURES.attackBarbarianIntervalMinutes;
        if (!['fixed', 'plusMinus1', 'plusMinus2'].includes(merged.attackBarbarianLevelMode)) merged.attackBarbarianLevelMode = DEFAULT_FEATURES.attackBarbarianLevelMode;
        if (typeof merged.attackBarbarianFortressEnabled !== 'boolean') merged.attackBarbarianFortressEnabled = DEFAULT_FEATURES.attackBarbarianFortressEnabled;
        if (typeof merged.autoAttackBarbarian !== 'boolean') merged.autoAttackBarbarian = DEFAULT_FEATURES.autoAttackBarbarian;
        if (typeof merged.rallyFortDowngrade !== 'boolean') merged.rallyFortDowngrade = DEFAULT_FEATURES.rallyFortDowngrade;
        if (typeof merged.rallyFortUsePotion !== 'boolean') merged.rallyFortUsePotion = DEFAULT_FEATURES.rallyFortUsePotion;
        if (typeof merged.rallyFortMarauder !== 'boolean') merged.rallyFortMarauder = DEFAULT_FEATURES.rallyFortMarauder;
        if (typeof merged.rallyFortFallbackTeam !== 'boolean') merged.rallyFortFallbackTeam = DEFAULT_FEATURES.rallyFortFallbackTeam;
        if (typeof merged.rallyFortFallbackTeamNum !== 'number') merged.rallyFortFallbackTeamNum = DEFAULT_FEATURES.rallyFortFallbackTeamNum;
        if (!['any','infantry','cavalry','archer'].includes(merged.rallyFortFallbackTroopType)) merged.rallyFortFallbackTroopType = DEFAULT_FEATURES.rallyFortFallbackTroopType;
        if (!Number.isFinite(Number(merged.collectResourcesIntervalMinutes))) merged.collectResourcesIntervalMinutes = DEFAULT_COLLECT_RESOURCES_INTERVAL_MINUTES;
        merged.collectResourcesIntervalMinutes = Math.max(MIN_COLLECT_RESOURCES_INTERVAL_MINUTES, Number(merged.collectResourcesIntervalMinutes));
        if (!Number.isFinite(Number(merged.autoReconnectIntervalMinutes))) merged.autoReconnectIntervalMinutes = DEFAULT_AUTO_RECONNECT_INTERVAL_MINUTES;
        merged.autoReconnectIntervalMinutes = Math.max(0, Number(merged.autoReconnectIntervalMinutes));
        merged.gemGatherMode = migrateGemMode(merged);
        delete merged.gemGatherFocusMode;
        padGatherTasks(merged);
        return merged;
      }
    } catch {}
    return DEFAULT_FEATURES;
  };

  const [features, setFeatures] = useState(loadFeatures);
  const [showExtraGatherSlots, setShowExtraGatherSlots] = useState(false);
  const [showGemAdvanced, setShowGemAdvanced] = useState(false);
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const activeConfigNameRef = useRef(activeConfigName);
  activeConfigNameRef.current = activeConfigName;

  const featuresToPersist = (f: typeof DEFAULT_FEATURES): typeof DEFAULT_HOME_FEATURES => {
    const { completedBuildings, completedTechs, ...rest } = f;
    return rest;
  };

  const [configNames, setConfigNames] = useState<string[]>([]);
  // 每个 profile 的账号编号，用于账号调度下拉禁用"未填编号"的选项
  const [profileAccountNames, setProfileAccountNames] = useState<Record<string, string>>({});
  const [profileStarredIndexes, setProfileStarredIndexes] = useState<Record<string, number | undefined>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.setItem('home-features', JSON.stringify(features));
    if (!currentAccountId || !activeConfigName) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.config.saveRokConfig(currentAccountId, { homeFeatures: featuresToPersist(features) }, activeConfigName).catch(() => {});
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [features, currentAccountId, activeConfigName]);

  const RESOURCE_TYPES = ['农田', '伐木场', '石矿', '金矿'];
  const RESOURCE_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const TRAIN_TIERS = [1, 2, 3, 4, 5];
  const renderTeamPageSelect = (value: TeamPageChoice, onChange: (value: TeamPageChoice) => void, disabled: boolean = false) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as TeamPageChoice)}
      className="px-2 py-1 bg-white border border-slate-200 rounded text-xs w-16"
    >
      {TEAM_PAGE_OPTIONS.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
    </select>
  );

  const [buildingOptions, setBuildingOptions] = useState<string[]>([]);
  const [_techOptions, setTechOptions] = useState<string[]>(['耕犁', '锯木厂', '铸币', '机械']);
  const [economicTechs, setEconomicTechs] = useState<string[]>([]);
  const [militaryTechs, setMilitaryTechs] = useState<string[]>([]);

  const checkDeviceStatus = async () => {
    if (!currentAccountId) return;
    try {
      const result = await api.device.status(currentAccountId);
      setDeviceConnected(!!result.connected);
    } catch { setDeviceConnected(false); }
  };

  const intentRequestIdRef = useRef(0);
  const intentMountedRef = useRef(false);
  const loadRunningIntent = async () => {
    const requestId = ++intentRequestIdRef.current;
    setIntentLoaded(false);
    setIntentLoadError(null);
    try {
      const session = await readRunningSession(
        'electronAPI' in window,
        window.electronAPI?.getRunningSession,
        browserRunningSession,
      );
      if (!intentMountedRef.current || requestId !== intentRequestIdRef.current) return;
      setRunningIntent(session.running);
      setRunningOwnerAccountId(session.accountId);
      setIntentLoaded(true);
    } catch (error) {
      if (!intentMountedRef.current || requestId !== intentRequestIdRef.current) return;
      setIntentLoadError(error instanceof Error && error.message
        ? error.message
        : '无法读取运行状态');
    }
  };

  const persistSession = async (session: RunningSession): Promise<RunningSession> => {
    const persisted = await persistRunningSession(
      'electronAPI' in window,
      window.electronAPI?.setRunningSession,
      session,
    );
    if (!('electronAPI' in window)) browserRunningSession = persisted;
    setRunningIntent(persisted.running);
    setRunningOwnerAccountId(persisted.accountId);
    return persisted;
  };

  // Running intent belongs to the Electron/browser session, so restore it once per mount.
  useEffect(() => {
    intentMountedRef.current = true;
    void loadRunningIntent();
    return () => {
      intentMountedRef.current = false;
      intentRequestIdRef.current++;
    };
  }, []);

  useEffect(() => {
    checkDeviceStatus();
    const interval = setInterval(checkDeviceStatus, 5000);
    return () => clearInterval(interval);
  }, [currentAccountId]);

  useEffect(() => {
    if (!currentAccountId) return;
    api.plugins.getConfig('com.rok.automation', currentAccountId).then(res => {
      if (res.defaultConfig?.buildingPositions) {
        setBuildingOptions(Object.keys(res.defaultConfig.buildingPositions));
      }
      if (res.defaultConfig?.techResearch?.availableTechs) {
        setTechOptions(res.defaultConfig.techResearch.availableTechs);
      }
      if (res.defaultConfig?.techResearch?.economicTechs) {
        setEconomicTechs(res.defaultConfig.techResearch.economicTechs);
      }
      if (res.defaultConfig?.techResearch?.militaryTechs) {
        setMilitaryTechs(res.defaultConfig.techResearch.militaryTechs);
      }
    }).catch(() => {});
  }, [currentAccountId]);

  // profile 的账号编号 / 星标序号缓存刷新。原先在初始化 effect 与 focus effect 里
  // 各写了一遍几乎相同的 Promise.all，这里合并为单一入口。
  const refreshProfileSwitchMeta = useCallback(async (): Promise<{ profiles: string[]; active: string } | null> => {
    if (!currentAccountId) return null;
    try {
      const pRes = await api.config.getProfiles(currentAccountId);
      if (!pRes.success) return null;
      setConfigNames(pRes.profiles);
      const nameMap: Record<string, string> = {};
      const idxMap: Record<string, number | undefined> = {};
      await Promise.all(pRes.profiles.map(async (p: string) => {
        try {
          const cfg = await api.config.getRokConfig(currentAccountId, p);
          nameMap[p] = ((cfg.config as any)?.accountSwitch?.accountName || '').trim();
          const idx = (cfg.config as any)?.accountSwitch?.starredIndex;
          idxMap[p] = typeof idx === 'number' ? idx : undefined;
        } catch { nameMap[p] = ''; idxMap[p] = undefined; }
      }));
      setProfileAccountNames(nameMap);
      setProfileStarredIndexes(idxMap);
      return { profiles: pRes.profiles, active: pRes.active };
    } catch { return null; }
  }, [currentAccountId]);

  // 把某组 profile 名映射成校验用的元信息
  const toSwitchMeta = useCallback((names: string[]): ProfileSwitchMeta[] =>
    names.filter(Boolean).map(n => ({
      name: n,
      accountName: profileAccountNames[n] || '',
      starredIndex: profileStarredIndexes[n],
    })), [profileAccountNames, profileStarredIndexes]);

  // On mount + account change: load features from config, migrate from localStorage if needed
  useEffect(() => {
    if (!currentAccountId) return;
    (async () => {
      try {
        const res = await api.config.getRokConfig(currentAccountId);
        if (res.success && res.config?.homeFeatures) {
          setFeatures((prev: typeof DEFAULT_FEATURES) => preserveGlobalFields(prev, padGatherTasks({
            ...DEFAULT_HOME_FEATURES,
            ...res.config.homeFeatures,
            gemGatherMode: migrateGemMode(res.config.homeFeatures),
            completedBuildings: prev.completedBuildings,
            completedTechs: prev.completedTechs,
          })));
        } else {
          // One-shot migration: save current localStorage features to config
          setFeatures((prev: typeof DEFAULT_FEATURES) => {
            api.config.saveRokConfig(currentAccountId, { homeFeatures: featuresToPersist(prev) }, activeConfigName || '默认配置').catch(() => {});
            return prev;
          });
        }
      } catch {}
      try {
        const res = await refreshProfileSwitchMeta();
        if (res && !activeConfigNameRef.current) setActiveConfigName(res.active);
      } catch {}
    })();
  }, [currentAccountId, refreshProfileSwitchMeta]);

  // 窗口重新获得焦点、或从其它页面切回 Home 时，重拉 profile 的账号编号/星标序号缓存，
  // 使账号调度下拉里的禁用状态与提示跟着更新。
  useEffect(() => {
    if (!currentAccountId) return;
    refreshProfileSwitchMeta();
    const onFocus = () => { refreshProfileSwitchMeta(); };
    const onVis = () => { if (document.visibilityState === 'visible') refreshProfileSwitchMeta(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [currentAccountId, location.pathname, refreshProfileSwitchMeta]);

  // 载入指定 profile 的功能开关并合并进当前 features。
  // 返回合并后的对象，调用方决定是否还要写 featuresRef（切号循环需要，手动切换不需要）。
  const buildFeaturesForProfile = (hf: any) => preserveGlobalFields(featuresRef.current, padGatherTasks({
    ...DEFAULT_HOME_FEATURES,
    ...hf,
    gemGatherMode: migrateGemMode(hf),
    completedBuildings: [false, false, false, false, false],
    completedTechs: [false, false, false, false, false],
  }));

  const handleConfigSwitch = async (newName: string) => {
    if (!currentAccountId || newName === activeConfigName) return;
    // 运行中禁止手动切换配置：自动切号循环排队等锁期间若 profile 被手动换掉，
    // 会导致本次自动切号被判定为过期决策而放弃。停止后再切换。
    if (runningIntent) {
      pushLog('⚠️ 运行中无法手动切换配置，请先停止');
      return;
    }
    // Cancel any pending debounce save
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    // Save current features to old config immediately
    try {
      await api.config.saveRokConfig(currentAccountId, { homeFeatures: featuresToPersist(features) }, activeConfigName);
    } catch {}
    // Switch profile
    try {
      await api.config.switchProfile(currentAccountId, newName);
      setActiveConfigName(newName);
      const res = await api.config.getRokConfig(currentAccountId);
      if (res.success && res.config?.homeFeatures) {
        const merged = buildFeaturesForProfile(res.config.homeFeatures) as any;
        // 若开启自动切号且新 active 不在 switchProfileIds → 找空槽填，无空槽覆盖槽 0
        if (merged.autoSwitchAccount) {
          const cur: string[] = (merged.switchProfileIds || []).slice(0, MAX_SWITCH_SLOTS);
          while (cur.length < MAX_SWITCH_SLOTS) cur.push('');
          if (!cur.includes(newName)) {
            const emptyIdx = cur.findIndex((s: string) => !s);
            const slotIdx = emptyIdx >= 0 ? emptyIdx : 0;
            cur[slotIdx] = newName;
            merged.switchProfileIds = cur;
          }
        }
        setFeatures(merged);
      } else {
        setFeatures((prev: typeof DEFAULT_FEATURES) => preserveGlobalFields(prev, { ...DEFAULT_FEATURES }));
      }
      loopCompletedBuildings = [false, false, false, false, false];
      loopCompletedTechs = [false, false, false, false, false];
    } catch (e: any) {
      pushLog(`⚠️ 配置切换失败: ${e.message}`);
    }
  };

  const handleConnectDevice = async () => {
    if (!currentAccountId) return;
    setDeviceLoading(true);
    try {
      const result = await api.device.connect(currentAccountId);
      setDeviceConnected(result.connected);
      if (result.connected) {
        // 新连接 → 重置运行状态
        loopStopped = true;
        loopRunning = false;
        setLoopRunningState(false);
        clearLoopState();
        for (const id of runningTaskIdsRef.current) {
          try { await api.tasks.stop(id); } catch {}
        }
        runningTaskIdsRef.current = [];
        setRunningTaskIds([]);
      }
    } catch (e) {
      console.error('连接失败', e);
    }
    setDeviceLoading(false);
  };

  const startAllImpl = async (source: 'local' | 'remote' = 'local') => {
    // ============================================================================
    // ⚠️ 循环读配置约定（本 bug 家族第三例，务必遵守）：
    // startAllImpl 内所有子循环（main、喊话、gather/help/collect/rally/attackBarbarian/…）
    // 每轮求值配置必须读 featuresRef.current —— 它是每帧同步的 ref。
    // 直接读外层 `features`（React state）拿到的是"循环启动那一刻"的闭包快照：
    // 切号后 setFeatures(merged) 只更新了 state 与 ref，闭包里 stale 的 features 永不变化。
    // 后果：第1个账号勾的功能被后面所有账号无脑沿用（前车之鉴：全员升级建筑/金矿），
    //       或 while(!isStopped() && features.autoWorldChat) 这类守卫永远为真而卡死。
    // ============================================================================
    if (!currentAccountId) {
      pushLog(`❌ 未选择账号`);
      return;
    }
    if (!deviceConnected) {
      await handleConnectDevice();
      return;
    }
    if (deviceLoading) return;  // 连接过程中重复触发防抖
    if (loopRunning) return;    // 循环已在启动/运行中，防止重入（远程 SSE 二次触发时挡住）
    // 清空本次运行前的所有日志：本地 UI + 后端环形缓冲 + 云端历史 + 手机端 UI（通过 SSE / WS 广播）
    loopLogs = [];
    setLogs([]);
    lastPostedLogIndexRef.current = 0;
    pendingLogBatchRef.current = [];
    const sourceLabel = source === 'remote' ? '📱 手机端' : '💻 电脑端';
    pushLog(`${sourceLabel} 触发开始运行`);
    console.log('[LogClear] calling /api/logs/clear');
    fetch(`${LOCAL_API_BASE}/api/logs/clear`, { method: 'POST' })
      .then(r => r.json())
      .then(d => console.log('[LogClear] result:', d))
      .catch(e => console.log('[LogClear] error:', e));
    if (!deviceConnected) {
      setDeviceLoading(true);
      try {
        const result = await api.device.connect(currentAccountId);
        setDeviceConnected(result.connected);
        if (!result.connected) {
          pushLog(`❌ 设备连接失败: ${result.message}`);
          setDeviceLoading(false);
          return;
        }
        pushLog(`✅ 设备已连接`);
      } catch (e: any) {
        pushLog(`❌ 设备连接异常: ${e.message || e}`);
        setDeviceLoading(false);
        return;
      }
      setDeviceLoading(false);
    }

    // 远程触发：确保游戏已启动（launchGame 内部已做进程检测，已跑则跳过）
    if (source === 'remote') {
      try {
        pushLog(`📱 远程启动：确认游戏进程`);
        // 通知手机端进入"启动游戏中"状态，按钮显示等待
        fetch(`${LOCAL_API_BASE}/api/remote-control/starting-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ starting: true }),
        }).catch(() => {});
        const r = await api.tasks.create(currentAccountId, 'com.rok.automation', 'launch-game');
        if (r.success) {
          await api.tasks.run(r.task.id);
        }
      } catch (e: any) {
        pushLog(`⚠️ launchGame 失败: ${e.message || e}`);
      } finally {
        fetch(`${LOCAL_API_BASE}/api/remote-control/starting-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ starting: false }),
        }).catch(() => {});
      }
    }

    const hasAnyFeature =
      (features.upgradeBuildings && features.selectedBuildings.some((b: string) => b)) ||
      (features.autoResearch && features.selectedTechs.some((t: string) => t)) ||
      (features.gatherResources && features.gatherTasks.some((t: any) => t.type)) ||
      (features.trainTroops && Object.values(features.trainTasks as Record<string, number>).some((v: number) => v > 0)) ||
      features.autoExplore ||
      (features.autoWorldChat && features.worldChatMessages.some((m: string) => m.trim())) ||
      (features.autoRallyFort && features.rallyFortLevel > 0) ||
      (features.autoAttackBarbarian && features.attackBarbarianLevel > 0 && !isFeatureLocked('attackBarbarian')) ||
      (features.gemGatherEnabled && (features.gemGatherEnabled && features.gemGatherMode === 'focus')) ||
      (features.gemGatherEnabled && features.gemGatherTeams.some((t: number) => t)) ||
      features.autoCaveExplore ||
      features.helpTeammates ||
      features.collectResources ||
      (features.joinRallyEnabled && !isFeatureLocked('joinRally')) ||
      (features.gemGatherEnabled && features.shareGemEnabled && !isFeatureLocked('shareGem')) ||
      features.produceMaterialEnabled ||
      features.claimAllianceTerritoryEnabled ||
      features.donateAllianceTechEnabled ||
      features.attackDetectEnabled;
    if (!hasAnyFeature) {
      alert('请先开启至少一个功能再运行');
      return;
    }

    if (loopRunning) return;
    if (killInFlight) {
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 游戏关闭任务尚未完成，请稍后重试`]);
      return;
    }

    const myGen = ++loopGen;
    loopRunning = true;
    setLoopRunningState(true);
    loopStopped = false;
    clearLoopState();
    try {
      await persistSession({ running: true, accountId: currentAccountId });
    } catch (error) {
      loopStopped = true;
      loopRunning = false;
      setLoopRunningState(false);
      clearLoopState();
      const message = error instanceof Error && error.message ? error.message : String(error);
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 保存运行状态失败: ${message}`]);
      return;
    }
    // 清空所有账号的分享矿坐标池（每次开始运行归零）
    try {
      const cr = await guardedCreateTask(
        () => api.tasks.create(currentAccountId, 'com.rok.automation', 'clear-shared-gem-pool'),
        taskId => api.tasks.stop(taskId),
        () => loopStopped || myGen !== loopGen,
      );
      if (cr.success) await api.tasks.run(cr.task.id);
    } catch {}
    clearAllSharedGemMemory();
    saveLoopState(currentAccountId);

    pendingAccountSwitch = false;
    if (featuresRef.current.autoSwitchAccount && !isFeatureLocked('autoSwitchAccount')) {
      const cur: string[] = (featuresRef.current.switchProfileIds || []).slice(0, MAX_SWITCH_SLOTS);
      while (cur.length < MAX_SWITCH_SLOTS) cur.push('');
      const active = activeConfigNameRef.current;
      if (active && !cur.includes(active)) {
        // 找第一个空槽填；满了就覆盖槽 0（最老的）
        const emptyIdx = cur.findIndex((s: string) => !s);
        const slotIdx = emptyIdx >= 0 ? emptyIdx : 0;
        cur[slotIdx] = active;
        const nextIds = cur.slice(0, MAX_SWITCH_SLOTS);
        const merged = { ...featuresRef.current, switchProfileIds: nextIds } as any;
        featuresRef.current = merged;
        setFeatures(merged);
        pushLog(`🔀 当前账号 ${active} 不在切号列表，自动填入槽位 ${slotIdx + 1} → [${nextIds.join(', ')}]`);
      }
    }
    const initialIds = (featuresRef.current.switchProfileIds || []).filter((s: string) => !!s);
    switchTargetIdx = nextSwitchTargetIdx(initialIds, activeConfigNameRef.current);
    pushLog(`🔀 自动切号目标索引 = ${switchTargetIdx}（当前 active=${activeConfigNameRef.current}, ids=[${initialIds.join(',')}]）`);
    if (switchTimerId) { clearTimeout(switchTimerId); switchTimerId = null; }
    const scheduleSwitchTimer = () => {
      if (switchTimerId) clearTimeout(switchTimerId);
      const feat = featuresRef.current;
      if (!feat.autoSwitchAccount || isFeatureLocked('autoSwitchAccount') || feat.switchMode !== 'per-time') return;
      const ids = feat.switchProfileIds || [];
      const curIdx = ids.indexOf(activeConfigNameRef.current);
      const intervals = normalizeIntervals(feat.switchIntervalMinutes);
      const minutes = intervals[curIdx >= 0 ? curIdx : 0];
      pushLog(`⏲️ 切号定时器: ${minutes} 分钟后切号（当前 ${activeConfigNameRef.current}）`);
      switchTimerId = setTimeout(() => {
        pendingAccountSwitch = true;
        scheduleSwitchTimer();
      }, minutes * 60 * 1000);
    };
    scheduleSwitchTimer();

    const isExploreMode = features.autoExplore;
    const isWorldChatMode = features.autoWorldChat;
    const interval = isExploreMode ? 60 : isWorldChatMode ? features.worldChatInterval : GATHER_LOOP_INTERVAL;    nightStartOffsetMinutes = randomBiasedOffset(NIGHT_START_JITTER_MIN, NIGHT_START_JITTER_MAX);
    nightEndOffsetMinutes = randomBiasedOffset(NIGHT_END_JITTER_MIN, NIGHT_END_JITTER_MAX);
    const modeLabel = isWorldChatMode ? '自动喊话' : '自动循环';
    const initialLogs = [`[${new Date().toLocaleTimeString()}] 🚀 开始${modeLabel} (间隔${interval}秒)`];
    if (features.nightMode) {
      initialLogs.push(`[${new Date().toLocaleTimeString()}] 🌙 夜间下线窗口：${formatMinuteOfDay(NIGHT_START_MINUTE + nightStartOffsetMinutes)} - ${formatMinuteOfDay(NIGHT_END_MINUTE + nightEndOffsetMinutes)}`);
    }
    loopLogs = initialLogs;
    setLogs(initialLogs);

    // Reset completion state for a fresh run (module-level for loop, state for UI)
    loopCompletedBuildings = [false, false, false, false, false];
    loopCompletedTechs = [false, false, false, false, false];
    setFeatures((prev: typeof DEFAULT_FEATURES) => ({
      ...prev,
      completedBuildings: [false, false, false, false, false],
      completedTechs: [false, false, false, false, false],
    }));

    const isStopped = createLoopCancellationPredicate(myGen, () => loopGen, () => loopStopped);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const resetAllCooldowns = () => {
      // 切号后新号所有子任务都要从头跑，等价于重启循环：
      bottomBarChecked = false;
      relaunchRequested = true;    // 让宝石 active/rest 循环 break 出去重新开始
      cooldownResetSeq += 1;       // 让 rally/attackBarbarian/joinRally/cave/produceMaterial 的 CD 等待打断
      moduleGemInitialCount = null;
      moduleGemCollectedCount = 0;
      moduleGemRestActive = false;
    };

    const sleep = async (s: number) => new Promise(r => setTimeout(r, s * 1000));
    const createTask: typeof api.tasks.create = (...args) => guardedCreateTask(
      () => api.tasks.create(...args),
      taskId => api.tasks.stop(taskId),
      isStopped,
    );

    const acquireLock = async (): Promise<boolean> => {
      // 记录排队前的 profile；排队期间发生切号（profile 变了）时拒绝拿锁 ——
      // 老账号的活单在切号完成那一刻就作废，工人 continue 回顶部重读牌子后自然按新账号跑。
      const startProfile = activeConfigNameRef.current;
      while ((deviceBusy || attackPreempt || barbarianPreempt || pendingAccountSwitch) && !isStopped()) { await sleep(0.3); }
      if (isStopped()) return false;
      if (activeConfigNameRef.current !== startProfile) return false;
      deviceBusy = true;
      return true;
    };
    const releaseLock = () => { deviceBusy = false; };

    // per-round 切号：本轮已完成一次的 source 集合；集齐所有勾选的 source 才触发切号
    const roundActionsDone = new Set<string>();
    // 记录循环启动时的日期，供"0点之后捐献"门控判定跨过 0 点
    const loopStartDate = new Date().toDateString();
    // 判断联盟科技捐献当天是否被"0点之后捐献"门控挡住。
    // computeExpectedActions 与 allianceTechLoop 共用此函数，避免两处判定漂移。
    const isAllianceTechBlockedToday = (): boolean =>
      !!featuresRef.current.donateAfterMidnight && new Date().toDateString() === loopStartDate;
    // 打野循环用尽 attackBarbarianLoopCount 后置位，供 expected 判定本轮不应再等打野。
    // 与 allianceTech 同理：避免"配置开着但运行时已被门控挡住"导致 per-round 永久卡死。
    let barbarianExhausted = false;
    // combo-gem: 触发条件（分享矿跑完 或 采集分享矿后 pool<5）命中即当场切号，
    // 不再累计 triggered 旗，也不再等其他 action 凑齐一轮
    const computeExpectedActions = (): Set<string> => {
      const f = featuresRef.current;
      const exp = new Set<string>();
      if (f.autoWorldChat) return exp; // 喊话模式独占，不参与 per-round
      if (f.autoExplore) exp.add('explore');
      if (f.helpTeammates) exp.add('help');
      if (f.collectResources) exp.add('collect');
      if (f.gatherResources && f.gatherTasks.some((t: any) => t.type)) exp.add('gather');
      if (f.autoRallyFort && f.rallyFortLevel > 0) exp.add('rally-fort');
      if (f.autoAttackBarbarian && f.attackBarbarianLevel > 0 && !isFeatureLocked('attackBarbarian') && !barbarianExhausted) exp.add('attack-barbarian');
      if (f.joinRallyEnabled && !isFeatureLocked('joinRally')) exp.add('join-rally');
      if (f.autoCaveExplore) exp.add('cave');
      if (f.gemGatherEnabled && f.shareGemEnabled && !isFeatureLocked('shareGem')) exp.add('share-gem');
      if (f.produceMaterialEnabled) exp.add('produce-material');
      if (f.claimAllianceTerritoryEnabled) exp.add('alliance-territory');
      if (f.donateAllianceTechEnabled && !isAllianceTechBlockedToday()) exp.add('alliance-tech');
      // gemGather 与 shareGem 互斥：勾了分享，gemLoop 会 skip，不计入 expected
      if (f.gemGatherEnabled && !isFeatureLocked('gemGather') && f.gemGatherTeams.length > 0 && !(f.shareGemEnabled && !isFeatureLocked('shareGem'))) exp.add('gem');
      if (f.upgradeBuildings || f.autoResearch || f.trainTroops) exp.add('main');
      return exp;
    };

    // 子循环执行完一个 action 后调用；根据 switchMode 触发切号 flag
    // source: 参与 per-round / fort-mode / combo-gem 的动作标识；isSuccess: fort-mode 用；extra: combo-gem 传入 { poolSize }
    const markRoundDone = (source: string = 'other', isSuccess: boolean = false, extra?: { poolSize?: number }) => {
      const feat = featuresRef.current;
      if (!feat.autoSwitchAccount || isFeatureLocked('autoSwitchAccount')) return;
      if (feat.switchMode === 'per-round') {
        roundActionsDone.add(source);
        const expected = computeExpectedActions();
        const missing = [...expected].filter(s => !roundActionsDone.has(s));
        if (expected.size > 0 && missing.length === 0) {
          pushLog(`🔁 本轮已完成 [${[...expected].join(',')}]，触发切号`);
          roundActionsDone.clear();
          pendingAccountSwitch = true;
        } else if (expected.size > 0) {
          pushLog(`⏳ 轮次进度 ${expected.size - missing.length}/${expected.size}，等待 [${missing.join(',')}]`);
        }
      } else if (feat.switchMode === 'fort-mode') {
        // 寨子模式语义：rally-fort 成功、join-rally 成功或失败，即立刻切号，不等其他慢周期任务凑齐一轮
        // （produce-material 间隔 2~4h，若混在同一 expected 集合里等它，会永远卡住）
        if (source === 'rally-fort' && isSuccess) {
          pushLog(`🔁 寨子模式：rally-fort 成功，立即触发切号`);
          pendingAccountSwitch = true;
          scheduleFortModeFallback();
          roundActionsDone.clear();
          return;
        }
        if (source === 'join-rally') {
          pushLog(`🔁 寨子模式：join-rally ${isSuccess ? '成功' : '失败'}，立即触发切号`);
          pendingAccountSwitch = true;
          scheduleFortModeFallback();
          roundActionsDone.clear();
          return;
        }
        // 失败/其他 action 走"跑完一轮再判决"的老逻辑，用于打日志与状态复位
        roundActionsDone.add(source);
        const expected = computeExpectedActions();
        const missing = [...expected].filter(s => !roundActionsDone.has(s));
        if (expected.size > 0 && missing.length === 0) {
          pushLog(`⏳ 寨子模式：本轮完成但无 rally-fort/join-rally 成功，继续下一轮`);
          roundActionsDone.clear();
        }
      } else if (feat.switchMode === 'combo-gem') {
        // 组合采集语义：触发条件命中即立刻切号，不等其他慢周期任务凑齐一轮
        // - 小号勾了分享宝石矿：跑完一次分享 → 立即切给大号采
        // - 大号勾了采集分享矿：pool<5 说明分享池快耗尽 → 立即切回小号补
        const triggered =
          source === 'share-gem' ||
          (source === 'gem' && typeof extra?.poolSize === 'number' && extra.poolSize < 5);
        if (triggered) {
          pushLog(`🔁 组合采集：${source === 'share-gem' ? '分享矿跑完' : `池=${extra?.poolSize} < 5`}，立即触发切号`);
          pendingAccountSwitch = true;
          roundActionsDone.clear();
          return;
        }
        // 其他 action 走"跑完一轮再判决"的老逻辑，仅用于打日志和状态复位
        roundActionsDone.add(source);
        const expected = computeExpectedActions();
        const missing = [...expected].filter(s => !roundActionsDone.has(s));
        if (expected.size > 0 && missing.length === 0) {
          pushLog(`⏳ 组合采集：本轮完成但未触发（分享矿未跑 或 池≥5），继续下一轮`);
          roundActionsDone.clear();
        }
      }
    };

    const scheduleFortModeFallback = () => {
      if (fortModeFallbackTimerId) clearTimeout(fortModeFallbackTimerId);
      const feat = featuresRef.current;
      if (!feat.autoSwitchAccount || isFeatureLocked('autoSwitchAccount') || feat.switchMode !== 'fort-mode') return;
      fortModeFallbackTimerId = setTimeout(() => {
        pushLog(`⏰ 寨子模式兜底：20 分钟无成功，强制切号`);
        pendingAccountSwitch = true;
        scheduleFortModeFallback();  // 重排下一次
      }, 20 * 60 * 1000);
    };

    if (fortModeFallbackTimerId) { clearTimeout(fortModeFallbackTimerId); fortModeFallbackTimerId = null; }
    scheduleFortModeFallback();

    // 攻击检测专用锁：不受 attackPreempt 阻塞（自己就是抢占方）
    const acquireLockForAttack = async (): Promise<boolean> => {
      while (deviceBusy && !isStopped()) { await sleep(0.3); }
      if (isStopped()) return false;
      deviceBusy = true;
      return true;
    };

    // 自动打野专用锁：不受 barbarianPreempt 阻塞（自己就是抢占方）。
    // 但仍给攻击检测（attackPreempt）让路——被打时开盾优先于一切。
    const acquireLockForBarbarian = async (): Promise<boolean> => {
      while ((deviceBusy || attackPreempt) && !isStopped()) { await sleep(0.3); }
      if (isStopped()) return false;
      deviceBusy = true;
      return true;
    };

    // 检测游戏进程；掉线则按设定分钟数等待后拉起。0 分钟视为关闭。调用者必须已持锁。
    const ensureGameRunning = async (): Promise<void> => {
      const f = featuresRef.current;
      const waitMin = Math.max(0, Number(f.autoReconnectIntervalMinutes) || 0);
      console.log(`[ensureGameRunning] waitMin=${waitMin}`);
      if (waitMin === 0) return; // 0 分钟 = 关闭断线重连
      try {
        const cr = await createTask(currentAccountId, 'com.rok.automation', 'check-game-running');
        if (!cr.success) { console.log(`[ensureGameRunning] check-game-running create 失败`); return; }
        const rr = await api.tasks.run(cr.task.id);
        const logs = rr.task?.logs ?? [];
        const runningLine = logs.find((l: string) => l.includes('[CHECK-GAME] running='));
        const isRunning = runningLine?.includes('running=true');
        console.log(`[ensureGameRunning] runningLine=${runningLine} isRunning=${isRunning}`);
        if (isRunning) return;

        // 掉线 → 等待用户设定的分钟数再拉起
        const waitMs = waitMin * 60 * 1000;
        const msg1 = `🔌 检测到游戏掉线，等待 ${waitMin} 分钟后打开游戏`;
        console.log(`[ensureGameRunning] ${msg1}`);
        pushLog(`${msg1}`);
        const startWait = monotonicNow();
        while (!isStopped() && (monotonicNow() - startWait) < waitMs) {
          await sleep(1);
        }
        if (isStopped()) return;

        const msg2 = `🎮 尝试拉起游戏`;
        console.log(`[ensureGameRunning] ${msg2}`);
        pushLog(`${msg2}`);
        const lr = await createTask(currentAccountId, 'com.rok.automation', 'launch-game');
        if (lr.success) await api.tasks.run(lr.task.id);
        // 启动后界面变化，强制主循环重新检查底部菜单栏
        bottomBarChecked = false;
      } catch (e) {
        console.error('[ensureGameRunning] failed:', e);
      }
    };

    // Fire and forget, stop button will cancel via task IDs
    (async () => {
      let round = 0;

      // 城外采集独立循环 — 按固定间隔执行，不受 OCR 调度影响
      const gatherLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (featuresRef.current.gatherResources && !featuresRef.current.autoWorldChat) {
            const gatherTasks = featuresRef.current.gatherTasks
              .map((t: { type: string; level: number }, i: number) => ({ ...t, team: i + 1 }))
              .filter((t: { type: string; level: number; team: number }) => t.type);
            if (gatherTasks.length > 0) {
              if (!await acquireLock()) continue;
              if (offlineActive) { releaseLock(); await sleep(30); continue; }
              await ensureGameRunning();
              try {
                const createResult = await createTask(currentAccountId, 'com.rok.automation', 'gather-resources', { gatherTasks, teamPage: featuresRef.current.resourceGatherTeamPage });
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
                    pushLog(`✅ 城外采集 完成`);
                    markRoundDone('gather');
                  }
                }
              } catch {} finally { releaseLock(); }
            }
          }
          const jitteredInterval = GATHER_LOOP_INTERVAL * (0.85 + Math.random() * 0.3);
          const startWait = monotonicNow();
          const waitSeq = cooldownResetSeq;
          while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < jitteredInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      // 帮助盟友独立循环 — 每 60s
      const helpLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (featuresRef.current.helpTeammates && !featuresRef.current.autoWorldChat) {
            if (!await acquireLock()) continue;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            try {
              const createResult = await createTask(currentAccountId, 'com.rok.automation', 'help-teammates');
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
                  pushLog(`✅ 帮助盟友 完成`);
                  markRoundDone('help');
                }
              }
            } catch {} finally { releaseLock(); }
          }
          const helpInterval = 60 * (0.85 + Math.random() * 0.3); // 51-69s
          const startWait = monotonicNow();
          const waitSeq = cooldownResetSeq;
          while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < helpInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      // 收集资源独立循环 — 按用户设置间隔执行，并叠加随机抖动
      const collectLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (featuresRef.current.collectResources && !featuresRef.current.autoWorldChat) {
            if (!await acquireLock()) continue;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            try {
              const createResult = await createTask(currentAccountId, 'com.rok.automation', 'collect-resources');
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
                  pushLog(`✅ 收集资源 完成`);
                  markRoundDone('collect');
                }
              }
            } catch {} finally { releaseLock(); }
          }
          const collectInterval = getCollectResourcesIntervalSeconds(featuresRef.current.collectResourcesIntervalMinutes);
          const startWait = monotonicNow();
          const waitSeq = cooldownResetSeq;
          while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < collectInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      // 自动切号独立循环 — 消费 pendingAccountSwitch flag
      const accountSwitchLoop = (async () => {
        while (!isStopped()) {
          await sleep(5);
          if (isStopped()) break;
          if (!featuresRef.current.autoSwitchAccount || isFeatureLocked('autoSwitchAccount')) continue;
          if (!pendingAccountSwitch) continue;
          const ids = featuresRef.current.switchProfileIds;
          const validIds = (ids || []).filter((s: string) => !!s);
          if (validIds.length < 2) { pendingAccountSwitch = false; continue; }

          pendingAccountSwitch = false;
          const nextProfile = validIds[switchTargetIdx];
          pushLog(`🔀 切号 → ${nextProfile} (targetIdx=${switchTargetIdx}, validIds=[${validIds.join(',')}])`);
          if (!await acquireLock()) {
            // 等锁期间用户停止 或 profile 已变（决策过期）。前者 break 退出循环；
            // 后者 continue 回顶部等下一个 pendingAccountSwitch，不能 break——
            // accountSwitchLoop 只在启动时拉起一次，break 后再无消费者，切号会永久失效。
            if (isStopped()) break;
            pushLog(`⏭️ 切号 acquireLock 时配置已切换，放弃本次过期切号，等待下一次`);
            continue;
          }
          try {
            const currentProfile = activeConfigNameRef.current;
            // 切号决策必须基于后端真相：UI 缓存（profileAccountNames/profileStarredIndexes）
            // 是切号循环启动时的快照，运行中用户改配置读不到，会导致类型推导用过期分组。
            // 单个 profile 读失败降级成空 accountName，会被下方"未填账号编号"分支跳过，不让整批挂掉。
            const metas: ProfileSwitchMeta[] = await Promise.all(
              validIds.map(async (n: string) => {
                try {
                  const c = await api.config.getRokConfig(currentAccountId, n);
                  const idx = (c.config as any)?.accountSwitch?.starredIndex;
                  return {
                    name: n,
                    accountName: ((c.config as any)?.accountSwitch?.accountName || '').trim(),
                    starredIndex: typeof idx === 'number' ? idx : undefined,
                  };
                } catch {
                  return { name: n, accountName: '', starredIndex: undefined };
                }
              }),
            );
            const targetMeta = metas.find(m => m.name === nextProfile)!;
            const currentMeta = metas.find(m => m.name === currentProfile);
            const steps = buildSwitchSteps(currentMeta, targetMeta, metas);
            // 对 fresh 读到的 metas 做一次槽位校验，找出目标自身的问题并给出可诊断日志。
            // validateSwitchProfiles 同时覆盖 no-account，故原来是单独的 !targetName 判断也被统一到这里。
            const targetIssue = validateSwitchProfiles(metas).find(x => x.profileName === nextProfile);
            if (targetIssue) {
              const why = targetIssue.reason === 'missing-starred-index' ? '未填星标序号'
                : targetIssue.reason === 'invalid-starred-index' ? '星标序号非法'
                : targetIssue.reason === 'duplicate-starred-index' ? '星标序号与同账号其它方案重复'
                : '未填账号编号';
              pushLog(`⏭️ 跳过 ${nextProfile}：${why}（同账号多角色需在配置页填写星标序号）`);
              switchTargetIdx = (switchTargetIdx + 1) % validIds.length;
            } else if (!steps.accountSwitch && !steps.roleSwitch) {
              pushLog(`⚠️ profile "${nextProfile}" 与当前身份无差异，跳过`);
              switchTargetIdx = (switchTargetIdx + 1) % validIds.length;
            } else {
              let ok = false;
              for (let attempt = 1; attempt <= 2 && !isStopped(); attempt++) {
                pushLog(`  🔀 步骤: ${steps.accountSwitch ? `切账号→${steps.accountSwitch.accountName} ` : ''}${steps.roleSwitch ? `切角色→星标#${steps.roleSwitch.starredIndex}` : ''}`);
                const cr = await createTask(currentAccountId, 'com.rok.automation', 'switch-account', {
                  accountSwitch: steps.accountSwitch,
                  roleSwitch: steps.roleSwitch,
                });
                if (!cr.success) break;
                runningTaskIdsRef.current = [...runningTaskIdsRef.current, cr.task.id];
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const rr = await api.tasks.run(cr.task.id);
                runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== cr.task.id);
                setRunningTaskIds([...runningTaskIdsRef.current]);
                if (isStopped()) break;
                const logs = rr.task?.logs ?? [];
                const accountSwitched = logs.some((l: string) =>
                  l.includes('切换账号: success') ||
                  l.includes('切换账号: switched_load_timeout')
                );
                if (accountSwitched) {
                  ok = true;
                  if (logs.some((l: string) => l.includes('切换账号: switched_load_timeout'))) {
                    pushLog(`⚠️ 新账号进城超时，但登录已提交，继续切换配置`);
                  }
                  break;
                }
                pushLog(`⚠️ 切号第 ${attempt} 次失败`);
              }
              if (isStopped()) { pushLog(`⏹️ 切号被中止`); break; }
              if (ok) {
                await api.config.switchProfile(currentAccountId, nextProfile);
                // 载入新 profile 的功能开关（保留全局字段）
                try {
                  const nextCfg = await api.config.getRokConfig(currentAccountId, nextProfile);
                  const hf = nextCfg.success ? (nextCfg.config?.homeFeatures ?? {}) : {};
                  const hasHF = nextCfg.success && !!nextCfg.config?.homeFeatures;
                  pushLog(`  🔍 载入 ${nextProfile} homeFeatures: hasHF=${hasHF}, autoRallyFort=${(hf as any).autoRallyFort}, autoAttackBarbarian=${(hf as any).autoAttackBarbarian}, joinRallyEnabled=${(hf as any).joinRallyEnabled}`);
                  setActiveConfigName(nextProfile);
                  activeConfigNameRef.current = nextProfile;
                  const merged = buildFeaturesForProfile(hf);
                  // switchProfileIds 顺序保持不变；UI 通过对比 activeConfigName 判定激活态
                  featuresRef.current = merged as any;
                  setFeatures(merged as any);
                  pushLog(`  🔍 已应用: autoRallyFort=${(merged as any).autoRallyFort}, autoAttackBarbarian=${(merged as any).autoAttackBarbarian}, joinRallyEnabled=${(merged as any).joinRallyEnabled}`);
                } catch (e: any) {
                  pushLog(`  ⚠️ 载入 ${nextProfile} features 失败: ${e?.message || e}`);
                }
                resetAllCooldowns();
                roundActionsDone.clear();  // 新账号从零开始累计
                scheduleSwitchTimer();  // 按新账号的时长重排定时器
                scheduleFortModeFallback();  // 重置寨子模式兜底计时
                // 环向推进：下次目标 = 新 active 在 validIds 中的下一格
                switchTargetIdx = nextSwitchTargetIdx(validIds, nextProfile);
                pushLog(`✅ 切号完成，已激活 ${nextProfile}`);
              } else {
                pushLog(`❌ 切号 ${nextProfile} 失败，跳过`);
                // 失败不改状态，下次仍尝试同一 target
              }
            }
          } catch (e: any) {
            pushLog(`❌ 切号异常: ${e?.message || e}`);
          } finally { releaseLock(); }
        }
      })();

      // 攻打城寨独立循环 — 每 10min
      const rallyLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (featuresRef.current.autoRallyFort && featuresRef.current.rallyFortLevel > 0 && !featuresRef.current.autoWorldChat) {
            if (isStopped()) break;
            if (!await acquireLock()) continue;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            let cd = 600; // 默认 CD，实际根据结果确定
            try {
              const createResult = await createTask(currentAccountId, 'com.rok.automation', 'rally-fort', { level: featuresRef.current.rallyFortLevel, team: featuresRef.current.rallyFortTeam, downgrade: featuresRef.current.rallyFortDowngrade, teamPage: featuresRef.current.rallyFortTeamPage, usePotion: featuresRef.current.rallyFortUsePotion, fallbackTeam: featuresRef.current.rallyFortFallbackTeam, fallbackTeamNum: featuresRef.current.rallyFortFallbackTeamNum, fallbackTroopType: featuresRef.current.rallyFortFallbackTroopType, troopType: featuresRef.current.rallyFortTroopType, marauder: featuresRef.current.rallyFortMarauder });
              if (createResult.success) {
                runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const runResult = await api.tasks.run(createResult.task.id);
                runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
                setRunningTaskIds([...runningTaskIdsRef.current]);

                if (runResult.task?.status === 'stopped') {
                  loopStopped = true;
                  pushLog(`⏹️ ${createResult.task.actionId} 已被停止`);
                  return;
                }

                const logs = runResult.task?.logs ?? [];
                const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
                // 根据集结结果确定 CD：成功 10 分钟，行动力不足 75 分钟，其他失败 2 分钟
                const isSuccess = logs.some((l: string) => l.includes('→ success'));
                const isStamina = logs.some((l: string) => l.includes('→ stamina_insufficient'));
                if (isStamina) {
                  cd = 4500; // 75 分钟
                } else if (isSuccess) {
                  cd = 600;
                } else {
                  cd = 120;
                }
                if (hasExpiredLog) {
                  pushLog(`⛔ 许可证已到期，停止运行`);
                  loopStopped = true;
                  setExpiredMessage('激活码已到期，请重新激活');
                  refreshStatus();
                } else {
                  const cdLabel = isStamina ? '75分钟' : isSuccess ? '10分钟' : '2分钟';
                  pushLog(`${isSuccess ? '✅' : isStamina ? '🔋' : '⚠️'} 城寨 Lv.${featuresRef.current.rallyFortLevel} 队伍${featuresRef.current.rallyFortTeam} ${isSuccess ? '集结成功' : isStamina ? '行动力不足' : '未找到城寨'}，CD ${cdLabel}`);
                  markRoundDone('rally-fort', isSuccess);
                }
              }
            } catch {} finally { releaseLock(); }
            if (isStopped()) break;
            const cdJitter = cd * (0.85 + Math.random() * 0.3);
            pushLog(`🏰 城寨完成，${cdJitter.toFixed(0)} 秒后下一轮`);
            const startWait = monotonicNow();
            const waitSeq = cooldownResetSeq;
            while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < cdJitter * 1000) {
              await sleep(1);
            }
          } else {
            // 未开启城寨功能，短周期唤醒便于切号/开关变化后快速响应
            const waitSeq = cooldownResetSeq;
            const startIdle = monotonicNow();
            while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startIdle) < 60000) {
              await sleep(1);
            }
          }
        }
      })();

      // 自动打野独立循环 — 固定间隔（attackBarbarianIntervalMinutes）重复执行
      const attackBarbarianLoop = (async () => {
        let first = true;
        let ranCount = 0;
        let countSeq = cooldownResetSeq;
        while (!isStopped()) {
          if (first) { first = false; await sleep(3); }
          // 切号后重置循环次数计数，并解除打野耗尽标记（让新账号重新开始打野）
          if (cooldownResetSeq !== countSeq) { countSeq = cooldownResetSeq; ranCount = 0; barbarianExhausted = false; }
          if (offlineActive) { await sleep(30); continue; }
          const enabled = featuresRef.current.autoAttackBarbarian && featuresRef.current.attackBarbarianLevel > 0 && !featuresRef.current.autoWorldChat && !isFeatureLocked('attackBarbarian') && !barbarianExhausted;
          if (enabled && !isStopped()) {
            // 抬抢占旗：让其它普通循环在 acquireLock 处让路，打野优先拿锁
            barbarianPreempt = true;
            let ran = false;
            try {
              if (!await acquireLockForBarbarian()) {
                // 没拿到锁，短等后重试（不进入长 CD）
                const waitSeq = cooldownResetSeq;
                while (!isStopped() && cooldownResetSeq === waitSeq) { await sleep(1); }
                continue;
              }
            } finally {
              // 拿到锁后保持抬旗直到本次跑完（防止执行期间被插队）；没拿到则落旗
              if (!deviceBusy) barbarianPreempt = false;
            }
            if (offlineActive) { releaseLock(); barbarianPreempt = false; await sleep(30); continue; }
            await ensureGameRunning();
            try {
              const createResult = await createTask(currentAccountId, 'com.rok.automation', 'attack-barbarian', { level: featuresRef.current.attackBarbarianLevel, count: featuresRef.current.attackBarbarianCount, team: featuresRef.current.attackBarbarianTeam, teamPage: featuresRef.current.attackBarbarianTeamPage, usePotion: featuresRef.current.attackBarbarianUsePotion, levelMode: featuresRef.current.attackBarbarianLevelMode, fortressEnabled: featuresRef.current.attackBarbarianFortressEnabled });
              if (createResult.success) {
                ran = true;
                runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const runResult = await api.tasks.run(createResult.task.id);
                runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
                setRunningTaskIds([...runningTaskIdsRef.current]);

                if (runResult.task?.status === 'stopped') {
                  loopStopped = true;
                  pushLog(`⏹️ ${createResult.task.actionId} 已被停止`);
                  return;
                }

                const logs = runResult.task?.logs ?? [];
                const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
                const isSuccess = logs.some((l: string) => l.includes(': success'));
                const isStamina = logs.some((l: string) => l.includes(': stamina_insufficient'));
                if (hasExpiredLog) {
                  pushLog(`⛔ 许可证已到期，停止运行`);
                  loopStopped = true;
                  setExpiredMessage('激活码已到期，请重新激活');
                  refreshStatus();
                } else {
                  pushLog(`${isSuccess ? '✅' : isStamina ? '🔋' : '⚠️'} 打野 Lv.${featuresRef.current.attackBarbarianLevel} ×${featuresRef.current.attackBarbarianCount} 队伍${featuresRef.current.attackBarbarianTeam} ${isSuccess ? '完成' : isStamina ? '行动力不足' : '未完成'}`);
                  markRoundDone('attack-barbarian', isSuccess);
                }
              }
            } catch {} finally { releaseLock(); barbarianPreempt = false; }

            // 跑完按配置间隔等待（带 ±15% 抖动）；切号或停止时立即唤醒
            if (ran) {
              ranCount++;
              const loopLimit = Math.max(0, Math.floor(Number(featuresRef.current.attackBarbarianLoopCount) || 0));
              if (loopLimit > 0 && ranCount >= loopLimit) {
                // 置位耗尽标记并回落 idle（不再 return 杀死整个循环）：
                // 让 expected 把打野从本轮期待集合剔除，避免 per-round 永久卡死，
                // 同时保留循环存活，切号到其他账号时由 countSeq 重置计数、可再次打野。
                barbarianExhausted = true;
                pushLog(`⚔️ 打野已完成 ${ranCount}/${loopLimit} 轮，本轮不再执行（切号到其他账号会重新开始计数）`);
                continue;
              }
              const intervalMinutes = Math.max(1, Number(featuresRef.current.attackBarbarianIntervalMinutes) || 10);
              const cd = intervalMinutes * 60 * (0.85 + Math.random() * 0.3);
              pushLog(`⚔️ 打野完成 ${loopLimit > 0 ? ranCount + '/' + loopLimit : ''}，${cd.toFixed(0)} 秒后下一轮`);
              const startWait = monotonicNow();
              const waitSeq = cooldownResetSeq;
              while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < cd * 1000) {
                await sleep(1);
              }
              continue;
            }
          }
          // 未开启：短周期唤醒，便于切号/开关变化后快速响应
          const waitSeq = cooldownResetSeq;
          const startIdle = monotonicNow();
          while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startIdle) < 60000) {
            await sleep(1);
          }
        }
      })();

      // 加入集结独立循环 — 每 5min
      (async () => {
        let first = true;
        let firstRun = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(15); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (featuresRef.current.joinRallyEnabled && !isFeatureLocked('joinRally') && !featuresRef.current.autoWorldChat) {
            if (isStopped()) break;
            if (!await acquireLock()) continue;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            let cd = 300; // 默认 CD 5 分钟
            try {
              const createResult = await createTask(currentAccountId, 'com.rok.automation', 'join-rally', {
                team: featuresRef.current.joinRallyTeam,
                teamPage: featuresRef.current.joinRallyTeamPage,
                targetFort: featuresRef.current.joinRallyTargetFort,
                targetLohar: featuresRef.current.joinRallyTargetLohar,
                maxDistance: featuresRef.current.joinRallyMaxDistance,
                firstRun,
                usePotion: featuresRef.current.joinRallyUsePotion,
                useDefaultTeam: featuresRef.current.joinRallyUseDefaultTeam,
              });
              if (createResult.success) {
                runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const runResult = await api.tasks.run(createResult.task.id);
                runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
                setRunningTaskIds([...runningTaskIdsRef.current]);

                if (runResult.task?.status === 'stopped') {
                  loopStopped = true;
                  pushLog(`⏹️ ${createResult.task.actionId} 已被停止`);
                  return;
                }

                const logs = runResult.task?.logs ?? [];
                const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
                // 根据结果确定 CD：
                //   未勾系统编队：成功 8 分钟，失败 2 分钟
                //   勾选系统编队：成功不 CD（立即下一轮），失败 1 分钟
                const useDefaultTeam = featuresRef.current.joinRallyUseDefaultTeam;
                const isSuccess = logs.some((l: string) => l.includes('→ success'));
                const isNoIdle = logs.some((l: string) => l.includes('→ no_idle_teams'));
                const isDistanceExceed = logs.some((l: string) => l.includes('→ distance_exceed'));
                if (isSuccess) {
                  cd = useDefaultTeam ? 0 : 480; // 系统编队不 CD；否则 8 分钟
                } else {
                  cd = useDefaultTeam ? 60 : 120; // 系统编队 1 分钟；否则 2 分钟
                }
                if (hasExpiredLog) {
                  pushLog(`⛔ 许可证已到期，停止运行`);
                  loopStopped = true;
                  setExpiredMessage('激活码已到期，请重新激活');
                  refreshStatus();
                } else {
                  const cdLabel = isSuccess ? (useDefaultTeam ? '无' : '8分钟') : (useDefaultTeam ? '1分钟' : '2分钟');
                  const targetLabel = (featuresRef.current.joinRallyTargetFort && featuresRef.current.joinRallyTargetLohar) ? '城寨/洛哈' : featuresRef.current.joinRallyTargetFort ? '城寨' : '洛哈';
                  pushLog(`${isSuccess ? '✅' : isNoIdle ? '⏸️' : isDistanceExceed ? '📍' : '⚠️'} 加入${targetLabel}集结 队伍${featuresRef.current.joinRallyTeam} ${isSuccess ? '成功' : isNoIdle ? '无空闲队伍' : isDistanceExceed ? '超出距离' : '无可用集结'}，CD ${cdLabel}`);
                  markRoundDone('join-rally', isSuccess);
                }
                firstRun = false; // 首次执行完后标记为非首次
              }
            } catch {} finally { releaseLock(); }
            if (isStopped()) break;
            if (cd <= 0) {
              // 系统编队成功后不 CD，立即下一轮
              continue;
            }
            const cdJitter = cd * (0.85 + Math.random() * 0.3);
            pushLog(`🤝 加入集结完成，${cdJitter.toFixed(0)} 秒后下一轮`);
            const startWait = monotonicNow();
            const waitSeq = cooldownResetSeq;
            while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < cdJitter * 1000) {
              await sleep(1);
            }
          } else {
            // 短周期唤醒，便于切号/开关变化后快速响应
            const waitSeq = cooldownResetSeq;
            const startIdle = monotonicNow();
            while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startIdle) < 60000) {
              await sleep(1);
            }
          }
        }
      })();

      // 迷雾探索独立循环
      const exploreLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(8); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (featuresRef.current.autoExplore && !featuresRef.current.autoWorldChat) {
            if (!buildingOptions.includes('斥候营地')) {
              pushLog(`⚠️ 未标记斥候营地位置，跳过迷雾探索`);
              markRoundDone('explore');
            } else {
              if (!await acquireLock()) continue;
              if (offlineActive) { releaseLock(); await sleep(30); continue; }
              await ensureGameRunning();
              try {
                const createResult = await createTask(currentAccountId, 'com.rok.automation', 'explore', {});
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
                    pushLog(`🗺️ 迷雾探索 完成`);
                    markRoundDone('explore');
                  }
                }
              } catch {} finally { releaseLock(); }
            }
          }
          const exploreInterval = 45 + Math.random() * 15;
          const startWait = monotonicNow();
          const waitSeq = cooldownResetSeq;
          while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < exploreInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      // 山洞探索独立循环
      const caveLoop = (async () => {
        let first = true;
        // 循环开始前重置山洞探索状态
        try {
          await createTask(currentAccountId, 'com.rok.automation', 'reset-cave-explore')
            .then(r => { if (r.success) return api.tasks.run(r.task.id); });
        } catch {}
        while (!isStopped()) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (featuresRef.current.autoCaveExplore && !featuresRef.current.autoWorldChat) {
            if (!buildingOptions.includes('斥候营地')) {
              pushLog(`⚠️ 未标记斥候营地位置，跳过山洞探索`);
              markRoundDone('cave');
            } else {
              if (!await acquireLock()) continue;
              if (offlineActive) { releaseLock(); await sleep(30); continue; }
              await ensureGameRunning();
              try {
                const createResult = await createTask(currentAccountId, 'com.rok.automation', 'cave-explore');
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
                    pushLog(`🏔️ 山洞探索 完成`);
                    markRoundDone('cave');
                  }
                }
              } catch {} finally { releaseLock(); }
            }
          }
          const caveInterval = 120 * (0.85 + Math.random() * 0.3);
          const startWait = monotonicNow();
          const waitSeq = cooldownResetSeq;
          while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < caveInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      const shareGemLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }

          if (featuresRef.current.gemGatherEnabled && featuresRef.current.shareGemEnabled && !isFeatureLocked('shareGem') && !featuresRef.current.autoWorldChat) {
            if (!await acquireLock()) continue;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            try {
              const shareFeatures = featuresRef.current;
              const comboGemActive = isComboGemActive(shareFeatures, isFeatureLocked('autoSwitchAccount'));
              const memShared = getSharedGemCoords(currentAccountId);
              if (memShared.length > 0) pushLog(`💎 携带已分享坐标 ${memShared.length} 个`);
              const stopCond = shareFeatures.shareGemStopCondition === 'spiral'
                ? 'count5'
                : (shareFeatures.shareGemStopCondition ?? 'count5');
              const targetCount = stopCond === 'count10' ? 10
                : stopCond === 'count15' ? 15
                : stopCond === 'count100' ? 100
                : 5;
              const createResult = await createTask(currentAccountId, 'com.rok.automation', 'share-gem', {
                accountId: currentAccountId,
                poolAccountId: comboGemActive ? COMBO_GEM_POOL_ACCOUNT_ID : currentAccountId,
                startX: shareFeatures.gemGatherHomeX ?? 0,
                startY: shareFeatures.gemGatherHomeY ?? 0,
                recordedCoords: memShared,
                searchWeights: { spiral: 100, reverseSpiral: 0, randomWalk: 0, snake: 0 },
                targetCount,
              });
              if (createResult.success) {
                runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const runResult = await api.tasks.run(createResult.task.id);
                runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const logs = runResult.task?.logs ?? [];
                const addedShared = recordSharedGemCoordsFromLogs(currentAccountId, logs);
                if (addedShared > 0) pushLog(`💎 分享记忆新增 ${addedShared} 个（共 ${getSharedGemCoords(currentAccountId).length}）`);
                const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
                if (hasExpiredLog) {
                  pushLog(`⛔ 许可证已到期，停止运行`);
                  loopStopped = true;
                  setExpiredMessage('激活码已到期，请重新激活');
                  refreshStatus();
                } else {
                  pushLog(`💎 分享宝石矿 完成`);
                  markRoundDone('share-gem');
                }
              }
            } catch {} finally { releaseLock(); }
          }

          const startWait = monotonicNow();
          const waitSeq = cooldownResetSeq;
          const shareGemCd = 60_000 + Math.floor(Math.random() * 60_000); // 60~120s
          while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < shareGemCd) {
            await sleep(1);
          }
        }
      })();

      // 攻击检测独立循环 — 5s 一次，不抢锁；命中后抬旗抢占其它循环，再执行开盾
      const attackLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(5); continue; }
          if (offlineActive) { await sleep(30); continue; }
          const f = featuresRef.current;
          if (!f.attackDetectEnabled) { await sleep(5); continue; }

          // [1] 纯检测：不抢锁，直接跑 check-attack
          let attacked = false;
          try {
            const cr = await createTask(currentAccountId, 'com.rok.automation', 'check-attack');
            if (cr.success) {
              const rr = await api.tasks.run(cr.task.id);
              const logs = rr.task?.logs ?? [];
              attacked = logs.some((l: string) => l.includes('[CHECK-ATTACK] attacked=true'));
            }
          } catch {}

          if (!attacked) { await sleep(5); continue; }

          pushLog(`⚠️ 检测到被攻击`);

          // [2] 未启用自动开盾：只记日志，间隔加长避免刷屏
          if (!f.autoShieldEnabled) {
            await sleep(30);
            continue;
          }

          // [3] 抬旗抢占，等其它循环 releaseLock，然后拿锁执行开盾
          attackPreempt = true;
          try {
            if (!await acquireLockForAttack()) break;
            try {
              await ensureGameRunning();
              const cr2 = await createTask(currentAccountId, 'com.rok.automation', 'auto-shield');
              if (cr2.success) {
                runningTaskIdsRef.current = [...runningTaskIdsRef.current, cr2.task.id];
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const rr2 = await api.tasks.run(cr2.task.id);
                runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== cr2.task.id);
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const logs2 = rr2.task?.logs ?? [];
                const hasExpiredLog = logs2.some((l: string) => l.includes('许可证已过期'));
                if (hasExpiredLog) {
                  pushLog(`⛔ 许可证已到期，停止运行`);
                  loopStopped = true;
                  setExpiredMessage('激活码已到期，请重新激活');
                  refreshStatus();
                } else {
                  const shieldSuccess = logs2.some((l: string) => l.includes('自动开盾: success'));
                  if (shieldSuccess) {
                    pushLog(`🛡️ 自动开盾 完成，2 小时后再检测`);
                    releaseLock();
                    attackPreempt = false;
                    // 2h 静默期可被切号打断：新账号可能也被打，应立即重新检测
                    const shieldStartWait = monotonicNow();
                    const shieldWaitSeq = cooldownResetSeq;
                    while (!isStopped() && cooldownResetSeq === shieldWaitSeq && (monotonicNow() - shieldStartWait) < 2 * 60 * 60 * 1000) {
                      await sleep(1);
                    }
                    continue;
                  } else {
                    pushLog(`🛡️ 自动开盾 完成`);
                  }
                }
              }
            } catch (e: any) {
              pushLog(`⚠️ 自动开盾失败: ${e.message || e}`);
            } finally {
              releaseLock();
            }
          } finally {
            attackPreempt = false;
          }

          // 开盾后拉长间隔避免连触发
          await sleep(30);
        }
      })();

      // 生产装备材料独立循环（每 2~4 小时随机）
      const produceMaterialLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (!featuresRef.current.produceMaterialEnabled || featuresRef.current.autoWorldChat) {
            await sleep(30);
            continue;
          }
          if (!buildingOptions.includes('铁匠铺')) {
            pushLog(`⚠️ 未标记铁匠铺位置，跳过生产装备材料`);
            markRoundDone('produce-material');
          } else {
            if (!await acquireLock()) continue;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            try {
              const createResult = await createTask(currentAccountId, 'com.rok.automation', 'produce-equip-material', { material: featuresRef.current.produceMaterialType });
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
                  markRoundDone('produce-material');
                }
              }
            } catch {} finally { releaseLock(); }
          }
          // 已尝试执行本轮，等 2~4 小时随机再触发下一次
          const intervalSec = (2 + Math.random() * 2) * 3600;
          const startWait = monotonicNow();
          const waitSeq = cooldownResetSeq;
          while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < intervalSec * 1000) {
            await sleep(1);
          }
        }
      })();

      // 领取联盟领土收益独立循环 —— 每 4 小时执行一次
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
                pushLog(`🚩 领取联盟领土收益 完成`);
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

      // 联盟科技捐献独立循环 —— 每 4 小时执行一次
      const allianceTechLoop = (async () => {
        let first = true;
        while (!isStopped()) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (!featuresRef.current.donateAllianceTechEnabled || featuresRef.current.autoWorldChat) {
            await sleep(30); continue;
          }
          if (isAllianceTechBlockedToday()) {
            // 启动当天还没跨过 0 点，跳过；进入下一个 4 小时等待后再判定
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

      // ── 诊断：per-round 模式下检测"等待中的 action 集合"长时间无变化 ──
      // 用于暴露"配置开着但运行时被门控挡住"导致 per-round 永久停滞这类问题
      // （本仓库已犯 donateAfterMidnight、打野 finite loopCount 两例）。只打日志提醒，
      // 不强切号——强切会掩盖真实原因、且可能造成用户意料外的行为。
      const stallDiagLoop = (async () => {
        let lastMissingKey = '';          // 上一次"缺失集合"的稳定 key（排序后拼接）
        let lastChangeAt = monotonicNow(); // 该集合最后一次发生变化的时间
        let warnedFor = '';               // 已告警过的集合，避免重复刷屏
        while (!isStopped()) {
          await sleep(60 * 1000);
          if (isStopped()) break;
          const feat = featuresRef.current;
          if (!feat.autoSwitchAccount || isFeatureLocked('autoSwitchAccount') || feat.switchMode !== 'per-round') continue;
          const expected = computeExpectedActions();
          const missing = [...expected].filter(s => !roundActionsDone.has(s));
          // 本轮已集齐（即将切号）或本轮无期待动作（喊话模式等）→ 重置诊断状态
          if (expected.size === 0 || missing.length === 0) {
            lastMissingKey = '';
            lastChangeAt = monotonicNow();
            warnedFor = '';
            continue;
          }
          const key = missing.slice().sort().join(',');
          if (key !== lastMissingKey) {
            lastMissingKey = key;
            lastChangeAt = monotonicNow();
            warnedFor = '';
            continue;
          }
          const stuckSec = Math.floor((monotonicNow() - lastChangeAt) / 1000);
          // 同一批缺失集合持续超过 15 分钟无任何完成动作，点名告警一次，之后静默
          if (stuckSec >= 15 * 60 && warnedFor !== key) {
            warnedFor = key;
            pushLog(`⚠️ 诊断：per-round 已连续等待 [${missing.join(',')}] 约 ${Math.floor(stuckSec / 60)} 分钟无变化。这通常是某功能"配置开着但运行时被门控挡住"（如勾了"0点之后捐献"当天永不出手），请检查对应 action 的门控条件`);
          }
        }
      })();

      // 下线监控独立循环 — 每 30s 检查一次，边沿触发 kill / launch
      const offlineLoop = (async () => {
        while (!isStopped()) {
          const f = featuresRef.current;
          const now = new Date();
          const minuteOfDay = now.getHours() * 60 + now.getMinutes();
          const nightStartMinute = NIGHT_START_MINUTE + nightStartOffsetMinutes;
          const nightEndMinute = NIGHT_END_MINUTE + nightEndOffsetMinutes;
          const inNightWindow = f.nightMode && minuteOfDay >= nightStartMinute && minuteOfDay < nightEndMinute;
          const inGemRest = moduleGemRestActive;
          const shouldOffline = inNightWindow || inGemRest;

          if (shouldOffline && !lastOfflineState) {
            pushLog(`🌙 进入下线状态（${inNightWindow ? '夜间' : '宝石休息'}）`);
            if (await acquireLock()) {
              offlineActive = true;
              lastOfflineState = true;
              try {
                const r = await createTask(currentAccountId, 'com.rok.automation', 'kill-game');
                if (r.success) {
                  runningTaskIdsRef.current = [...runningTaskIdsRef.current, r.task.id];
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                  await api.tasks.run(r.task.id);
                  runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== r.task.id);
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                }
              } catch {} finally { releaseLock(); }
            }
          } else if (!shouldOffline && lastOfflineState) {
            pushLog(`☀️ 恢复上线状态`);
            if (await acquireLock()) {
              try {
                const r = await createTask(currentAccountId, 'com.rok.automation', 'launch-game');
                if (r.success) {
                  runningTaskIdsRef.current = [...runningTaskIdsRef.current, r.task.id];
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                  await api.tasks.run(r.task.id);
                  runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== r.task.id);
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                }
              } catch {} finally { releaseLock(); }
              offlineActive = false;
              lastOfflineState = false;
              // 游戏重启后界面已变化，强制主循环重新检查底部菜单栏
              bottomBarChecked = false;
              // 上线等价于重新点开始运行：通知各子循环重置状态、从头开始
              relaunchRequested = true;
            }
          }

          // 等 30s 再检查（中途循环停止可立即退出）
          const startWait = monotonicNow();
          while (!isStopped() && (monotonicNow() - startWait) < 30000) {
            await sleep(1);
          }
        }
      })();

      // 宝石采集独立循环（普通+专注共用 active/rest 轮替）
      (async () => {
        let first = true;
        let localInitialCount: number | null = null;

        const readCount = async (): Promise<number | null> => {
          try {
            const res = await createTask(currentAccountId, 'com.rok.automation', 'read-gem-count');
            if (!res.success) { console.error('[readCount] create failed', res); return null; }
            const run = await api.tasks.run(res.task.id);
            const logs = run.task?.logs ?? [];
            const line = logs.find((l: string) => /\[GEM-COUNT\]\s+\d+/.test(l));
            if (!line) return null;
            const m = line.match(/\[GEM-COUNT\]\s+(\d+)/);
            return m ? parseInt(m[1], 10) : null;
          } catch (e) { console.error('[readCount] error:', e); return null; }
        };

        while (!isStopped()) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }

          // ── 上线重置（launch-game 后等价于重新开始运行）──
          // 只中断当前 active/rest 阶段从头开始，保留已采集计数与初始基准
          if (relaunchRequested) {
            relaunchRequested = false;
            moduleGemRestActive = false;
            setGemRestCountdown('');
            pushLog(`🔄 游戏重新上线，宝石采集从头开始`);
            continue;
          }

          const f = featuresRef.current;
          if (!f.gemGatherEnabled || isFeatureLocked('gemGather') || f.gemGatherTeams.length === 0 || f.autoWorldChat) {
            await sleep(30); continue;
          }
          // 勾了「分享宝石矿(小号用)」时，本卡片只走 shareGemLoop，不执行采集
          if (f.shareGemEnabled && !isFeatureLocked('shareGem')) {
            await sleep(30); continue;
          }

          // ── 读取初始宝石数（首次进入或被 reset 后）──
          if (localInitialCount === null) {
            const count = await readCount();
            if (count !== null) {
              localInitialCount = count;
              moduleGemInitialCount = count;
              moduleGemCollectedCount = 0;
              setGemInitialCount(count);
              setGemCollectedCount(0);
            }
          }

          const activeHours = Number(f.gemGatherActiveHours) || 3;
          const restHours = Number(f.gemGatherRestHours) || 1;
          const mode = f.gemGatherMode;
          const p = Math.min(1, Math.max(0, Number(f.gemGatherMixRatio) || 0));
          // 混合模式：首轮驻扎概率 min(1, 2p)；驻扎后 -0.2(1-p)、普通后 +0.4p；clamp [0, 1]
          let focusRatio = mode === 'focus' ? 1 : mode === 'normal' ? 0 : Math.min(1, 2 * p);

          // ── active 阶段 ──
          const activeEnd = monotonicNow() + activeHours * 3600 * 1000;
          setGemRestCountdown('');
          const startLabel = mode === 'mixed'
            ? `混合采集开始，首轮驻扎`
            : `${mode === 'focus' ? '驻扎' : '普通'}采集开始`;
          pushLog(`💎 ${startLabel}，持续 ${activeHours}h`);

          while (!isStopped() && !relaunchRequested && monotonicNow() < activeEnd) {
            if (offlineActive) { await sleep(30); continue; }
            // 每轮重新读 features，防止切号后仍按旧账号配置执行
            const fNow = featuresRef.current;
            if (!fNow.gemGatherEnabled || isFeatureLocked('gemGather') || fNow.gemGatherTeams.length === 0 || fNow.autoWorldChat) {
              break; // 回外层，由 1762 guard 决定 sleep 或退出
            }
            if (fNow.shareGemEnabled && !isFeatureLocked('shareGem')) {
              break; // 切到分享账号，让 shareGemLoop 接管
            }
            if (!await acquireLock()) continue;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            const useShared = fNow.gemGatherSharedOnly && !isFeatureLocked('gemGather');
            const isFocus = !useShared && Math.random() < focusRatio;
            const actionId = useShared ? 'gather-shared-gem' : (isFocus ? 'gem-gather-focus' : 'gem-gather');
            const intervalSec = useShared ? 60 : (isFocus ? 60 : 300);
            // 更新下一轮概率（仅混合模式，非分享模式时）：驻扎 -0.2(1-p)、普通 +0.4p，clamp [0, 1]
            if (!useShared && mode === 'mixed') {
              focusRatio = Math.min(1, Math.max(0, focusRatio + (isFocus ? -0.2 * (1 - p) : 0.4 * p)));
              pushLog(`💎 下一轮驻扎概率 ${Math.round(focusRatio * 100)}%`);
            }
            try {
              // 采集前先读一次宝石数，更新已采集计数
              const current = await readCount();
              if (current !== null && localInitialCount !== null) {
                moduleGemCollectedCount = Math.max(0, current - localInitialCount);
                setGemCollectedCount(moduleGemCollectedCount);
                pushLog(`💎 已采集: ${moduleGemCollectedCount} 颗`);
              }

              pushLog(`💎 [DEBUG] maxDistance=${fNow.gemGatherMaxDistance}`);
              const memCoords = getFreshGemCoords(currentAccountId);
              if (memCoords.length > 0) pushLog(`💎 携带跨轮记忆坐标 ${memCoords.length} 个`);
              const comboGemActive = isComboGemActive(fNow, isFeatureLocked('autoSwitchAccount'));
              const gemParams = useShared
                ? { teams: fNow.gemGatherTeams, teamPage: fNow.gemGatherTeamPage, homeX: fNow.gemGatherHomeX, homeY: fNow.gemGatherHomeY, accountId: currentAccountId,
                    poolAccountId: comboGemActive ? COMBO_GEM_POOL_ACCOUNT_ID : currentAccountId }
                : { teams: fNow.gemGatherTeams, teamPage: fNow.gemGatherTeamPage, searchWeights: fNow.gemSearchWeights, maxDistance: fNow.gemGatherMaxDistance, extraSwipePauseSec: fNow.gemGatherExtraSwipePauseSec ?? 0, collectedCoords: memCoords };
              const createResult = await createTask(currentAccountId, 'com.rok.automation', actionId, gemParams);
              if (createResult.success) {
                runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const runResult = await api.tasks.run(createResult.task.id);
                runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
                setRunningTaskIds([...runningTaskIdsRef.current]);
                const logs = runResult.task?.logs ?? [];
                if (!useShared) {
                  const added = recordGemCoordsFromLogs(currentAccountId, logs);
                  if (added > 0) pushLog(`💎 记忆新增 ${added} 个坐标（共 ${getFreshGemCoords(currentAccountId).length}）`);
                }
                const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
                if (hasExpiredLog) {
                  pushLog(`⛔ 许可证已到期，停止运行`);
                  loopStopped = true;
                  setExpiredMessage('激活码已到期，请重新激活');
                  refreshStatus();
                } else {
                  if (useShared) {
                    const isEmpty = logs.some((l: string) => l.includes('采集分享矿:') && l.includes('→ empty'));
                    pushLog(isEmpty ? `💎 分享矿池空，本轮跳过` : `💎 采集分享矿完成`);
                    // 从日志解析 pool 数量，供 combo-gem 切号判断
                    let poolSize: number | undefined;
                    for (const l of logs as string[]) {
                      const m = l.match(/采集分享矿:.*pool=(\d+)/);
                      if (m) { poolSize = parseInt(m[1], 10); break; }
                    }
                    markRoundDone('gem', false, { poolSize });
                  } else {
                    pushLog(`💎 宝石采集(${isFocus ? '驻扎' : '普通'})完成`);
                    markRoundDone('gem');
                  }
                }
              }
            } catch {} finally { releaseLock(); }

            if (isStopped()) break;
            if (monotonicNow() >= activeEnd) break;
            const wait = intervalSec * (0.85 + Math.random() * 0.3);
            const startWait = monotonicNow();
            while (!isStopped() && (monotonicNow() - startWait) < wait * 1000 && monotonicNow() < activeEnd) {
              await sleep(1);
            }
          }
          if (isStopped()) break;
          // 上线重置请求：跳过 rest，回到外层 while 顶部重置状态、重新开始采集
          if (relaunchRequested) continue;

          // ── rest 阶段（普通+专注共用，触发下线）──
          const restDurationMs = restHours * 3600 * 1000;
          const restEnd = monotonicNow() + restDurationMs;
          const restEndWall = Date.now() + restDurationMs;
          moduleGemRestActive = true;
          pushLog(`💤 宝石采集休息 ${restHours}h，${new Date(restEndWall).toLocaleTimeString()} 恢复`);
          while (!isStopped() && !relaunchRequested && monotonicNow() < restEnd) {
            const remaining = Math.max(0, restEnd - monotonicNow());
            const h = Math.floor(remaining / 3600000);
            const m = Math.floor((remaining % 3600000) / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            setGemRestCountdown(`${h}h ${m}m ${s}s`);
            await sleep(1);
          }
          setGemRestCountdown('');
          moduleGemRestActive = false;
        }
      })();

      // 山洞探索 — 独立模式，与其他 action 互斥
      // 主循环"有活"判定：必须每轮通过 featuresRef.current 读取，切号后按新账号配置重评估。
      // 注意：无活时必须"空转跳过"而不是退出 while —— 退出会让主循环彻底死掉，
      // 之后轮换回有活的账号时 markRoundDone('main') 再也不会触发，per-round 永久卡在等待 [main]。
      const hasMainWork = (): boolean =>
        featuresRef.current.autoWorldChat || featuresRef.current.upgradeBuildings || featuresRef.current.autoResearch || featuresRef.current.trainTroops;
      if (!hasMainWork()) {
        pushLog(`ℹ️ 未启用建筑/科技/训练，主循环待命（切号到有活账号后自动开工）`);
      }
      while (!isStopped()) {
        if (!hasMainWork()) { await sleep(30); continue; }
        round++;
        pushLog(`🔄 第${round}轮`);
        saveLoopState(currentAccountId);


        const handleLicenseExpired = () => {
          pushLog(`⛔ 许可证已到期，停止运行`);
          loopStopped = true;
          setExpiredMessage('激活码已到期，请重新激活');
          refreshStatus();
        };

        const runTask = async (actionId: string, config?: Record<string, any>): Promise<string[]> => {
          if (isStopped()) return [];
          try {
            const createResult = await createTask(currentAccountId, 'com.rok.automation', actionId, config);
            if (createResult.success) {
              runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
              setRunningTaskIds([...runningTaskIdsRef.current]);

              // 执行期间每 2s 轮询该任务日志，按已显示行数做游标增量追加，
              // 让首页底部面板实时滚动（POST /run 会阻塞到任务结束才返回全部日志）。
              const taskId = createResult.task.id;
              let displayedLogCount = 0;
              const pollLogs = async () => {
                try {
                  const res = await api.tasks.get(taskId);
                  const allLogs = res.task?.logs ?? [];
                  if (allLogs.length > displayedLogCount) {
                    appendLogLines(allLogs.slice(displayedLogCount));
                    displayedLogCount = allLogs.length;
                  }
                } catch { /* 单次轮询失败忽略，下轮继续 */ }
              };
              const logPollTimer = setInterval(pollLogs, 2000);

              let runResult;
              try {
                runResult = await api.tasks.run(taskId);
              } finally {
                clearInterval(logPollTimer);
              }
              // 任务结束：最后再拉一次补齐轮询间隔内漏掉的日志。
              await pollLogs();

              runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
              setRunningTaskIds([...runningTaskIdsRef.current]);

              // 任务在排队等锁期间被停止
              if (runResult.task?.status === 'stopped') {
                loopStopped = true;
                pushLog(`⏹️ ${createResult.task.actionId} 已被停止`);
                return runResult.task?.logs ?? [];
              }

              const logs = runResult.task?.logs ?? [];

              const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
              const hasExpiredError = runResult.task?.error && /license.*expir|许可证.*过/i.test(runResult.task.error);
              if (hasExpiredLog || hasExpiredError) {
                handleLicenseExpired();
                return logs;
              }

              pushLog(`✅ ${createResult.task.actionId} 完成`);
              saveLoopState(currentAccountId);
              return logs;
            }
          } catch (e: any) {
            const isLicenseExpired =
              e?.data?.error === 'LICENSE_EXPIRED' ||
              e?.status === 403 ||
              (e?.message && /license.*expir|许可证.*过/i.test(e.message));
            if (isLicenseExpired) {
              handleLicenseExpired();
              return [];
            }
            pushLog(`❌ 执行失败: ${e}`);
          }
          return [];
        };

        const parseOcrResult = (logs: string[]): { build1: number | null; build2: number | null; train_bingying: number | null; train_majiu: number | null; train_bachang: number | null; train_gongcheng: number | null; research: number | null; build1Building: string | null; build2Building: string | null } => {
          const line = logs.find((l: string) => l.includes('[OCR-RESULT]'));
          const empty = { build1: null, build2: null, train_bingying: null, train_majiu: null, train_bachang: null, train_gongcheng: null, research: null, build1Building: null, build2Building: null };
          if (!line) return empty;
          const match = line.match(/build1=(-?\d+|null)\s+build2=(-?\d+|null)\s+train_bingying=(-?\d+|null)\s+train_majiu=(-?\d+|null)\s+train_bachang=(-?\d+|null)\s+train_gongcheng=(-?\d+|null)\s+research=(-?\d+|null)\s+build1Building=(\S+)\s+build2Building=(\S+)/);
          if (!match) return empty;
          const parse = (s: string) => s === 'null' ? null : parseInt(s, 10);
          const parseName = (s: string) => s === 'null' ? null : s;
          return { build1: parse(match[1]), build2: parse(match[2]), train_bingying: parse(match[3]), train_majiu: parse(match[4]), train_bachang: parse(match[5]), train_gongcheng: parse(match[6]), research: parse(match[7]), build1Building: parseName(match[8]), build2Building: parseName(match[9]) };
        };

        if (offlineActive) { await sleep(30); continue; }

        if (!bottomBarChecked) {
          if (await acquireLock()) {
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            try { await runTask('ensure-bottom-bar'); bottomBarChecked = true; }
            finally { releaseLock(); }
          }
        }

        // 喊话模式：与其他任务互斥，只执行世界喊话
        if (featuresRef.current.autoWorldChat) {
          const messages = (featuresRef.current.worldChatMessages || []).filter((m: string) => m.trim());
          if (messages.length === 0) {
            pushLog(`⚠️ 未填写喊话内容，跳过`);
            loopStopped = true;
            break;
          }

          while (!isStopped() && featuresRef.current.autoWorldChat) {
            // 一轮：依次发送所有消息，每条间隔 15s
            for (let i = 0; i < messages.length && !isStopped(); i++) {
              // 第一条不等，后续等 15s
              if (i > 0) {
                pushLog(`📢 下一条消息 15 秒后`);
                await sleep(15);
              }

              if (isStopped()) break;

              if (await acquireLock()) {
                try { if (!offlineActive) await runTask('send-world-chat', { message: messages[i], isFirst: i === 0 && true }); }
                finally { releaseLock(); }
              }
            }

            if (isStopped()) break;

            // 一轮结束，等 CD
            const cd = featuresRef.current.worldChatInterval || 300;
            const cdJitter = cd * (0.85 + Math.random() * 0.3);
            pushLog(`📢 一轮喊话完成，${cdJitter.toFixed(0)} 秒后开始下一轮`);

            await sleep(cdJitter);
          }
          if (isStopped()) break;
          continue;
        }

        let latestTimers: ReturnType<typeof parseOcrResult>;
        let dispatchedAny = false;

        // 获取设备锁，执行 OCR + 派发
        if (isStopped()) break;
        if (!await acquireLock()) {
          if (isStopped()) break;
          continue;
        }
        if (offlineActive) { releaseLock(); await sleep(30); continue; }
        try {
        // Step 1: OCR 队列倒计时
        const ocrLogs = await runTask('read-queue-overview');
        const timers = parseOcrResult(ocrLogs);

        if (isStopped()) break;

        // Step 2: 执行到期/就绪的 action
        const hasUpgrade = featuresRef.current.upgradeBuildings &&
          featuresRef.current.selectedBuildings.some((b: string, i: number) => b && !loopCompletedBuildings[i]);
        const hasResearch = featuresRef.current.autoResearch &&
          featuresRef.current.selectedTechs.some((t: string, i: number) => t && !loopCompletedTechs[i]);
        const hasTrain = featuresRef.current.trainTroops &&
          (Object.values(featuresRef.current.trainTasks as Record<string, number>) as number[]).some((v: number) => v > 0);

        if (hasUpgrade && (timers.build1 === null || timers.build1! <= 0 || timers.build2 === null || timers.build2! <= 0)) {
          const targetBuildings = featuresRef.current.selectedBuildings
            .filter((b: string, i: number) => b && !loopCompletedBuildings[i]);
          if (targetBuildings.length > 0) {
            const logs = await runTask('upgrade-buildings', { targetBuildings });
            dispatchedAny = true;
            let changed = false;
            const successCounts: Record<string, number> = {};
            for (const l of logs) {
              const m = l.match(/✅ (.+?) 升级成功/);
              if (m) successCounts[m[1]] = (successCounts[m[1]] || 0) + 1;
            }
            featuresRef.current.selectedBuildings.forEach((b: string, i: number) => {
              if (b && !loopCompletedBuildings[i] && (successCounts[b] || 0) > 0) {
                successCounts[b]--;
                loopCompletedBuildings[i] = true;
                changed = true;
              }
            });
            if (changed) setFeatures((prev: typeof features) => ({ ...prev, completedBuildings: [...loopCompletedBuildings] }));
          }
        }

        if (isStopped()) break;

        if (hasResearch && (timers.research === null || timers.research! <= 0)) {
          if (!buildingOptions.includes('学院')) {
            pushLog(`⚠️ 未标记学院位置，跳过研究科技`);
          } else if (timers.build1Building === '学院' || timers.build2Building === '学院') {
            pushLog(`🏗️ 学院正在升级中，跳过研究科技`);
          } else {
            const techs = featuresRef.current.selectedTechs.filter((t: string, i: number) => t && !loopCompletedTechs[i]);
            if (techs.length > 0) {
              const logs = await runTask('research-tech-queue', { targetTechs: techs, researchBuilding: '学院' });
              dispatchedAny = true;
              let changed = false;
              const techSuccessCounts: Record<string, number> = {};
              for (const l of logs) {
                const m = l.match(/✅ (.+?) 研究成功/);
                if (m) techSuccessCounts[m[1]] = (techSuccessCounts[m[1]] || 0) + 1;
              }
              featuresRef.current.selectedTechs.forEach((t: string, i: number) => {
                if (t && !loopCompletedTechs[i] && (techSuccessCounts[t] || 0) > 0) {
                  techSuccessCounts[t]--;
                  loopCompletedTechs[i] = true;
                  changed = true;
                }
              });
              if (changed) setFeatures((prev: typeof features) => ({ ...prev, completedTechs: [...loopCompletedTechs] }));
            }
          }
        }

        if (isStopped()) break;

        if (hasTrain) {
          const trainTimerMap: Record<string, number | null> = {
            '兵营': timers.train_bingying,
            '马厩': timers.train_majiu,
            '靶场': timers.train_bachang,
            '攻城武器厂': timers.train_gongcheng,
          };
          const tasks = featuresRef.current.trainTasks as Record<string, number>;
          const promoteFlags = featuresRef.current.trainPromote as Record<string, boolean>;
          const upgradingBuildings = new Set([timers.build1Building, timers.build2Building].filter(Boolean));
          const trainQueue = ['兵营', '马厩', '靶场', '攻城武器厂']
            .filter(b => {
              if ((tasks[b] ?? 0) <= 0) return false;
              if (trainTimerMap[b] !== null && trainTimerMap[b]! > 0) return false;
              if (upgradingBuildings.has(b)) {
                pushLog(`🏗️ ${b}正在升级中，跳过训练`);
                return false;
              }
              return true;
            })
            .map(b => ({ building: b, tier: tasks[b], promote: !!promoteFlags[b] }));
          if (trainQueue.length > 0) { await runTask('train-troops', { trainQueue }); dispatchedAny = true; }
        }

        if (isStopped()) break;

        // Step 3: 有派发任务时才重新 OCR，获取最新倒计时
        if (dispatchedAny) {
          const reOcrLogs = await runTask('read-queue-overview');
          latestTimers = parseOcrResult(reOcrLogs);
        } else {
          latestTimers = timers;
        }

        } finally { releaseLock(); }

        if (isStopped()) break;

        // Step 4: 计算下次唤醒时间（基于最新 OCR 结果）
        // 建筑/科技队列提前唤醒 (*0.6)，训练队列用原始值
        const buildResearchTimers = [latestTimers.build1, latestTimers.build2, latestTimers.research].filter((t): t is number => t !== null && t > 0);
        const trainTimers = [latestTimers.train_bingying, latestTimers.train_majiu, latestTimers.train_bachang, latestTimers.train_gongcheng].filter((t): t is number => t !== null && t > 0);
        const adjustedTimers = [...buildResearchTimers.map(t => t * 0.6), ...trainTimers];
        const minTimer = adjustedTimers.length > 0 ? Math.min(...adjustedTimers) : null;

        let nextWake: number;
        if (minTimer !== null) {
          if (minTimer < 120) {
            nextWake = Math.max(minTimer, 15); // < 2min 直接用倒计时，不加系数不抖动
          } else {
            nextWake = Math.min(minTimer, 1800); // 上限 30 分钟（已含系数）
            nextWake += Math.random() * 30; // 随机抖动 0 ~ 30s
          }
        } else {
          nextWake = 1800; // 无活跃队列，30 分钟后再查
          nextWake += Math.random() * 30;
        }
        nextWake = Math.max(60, nextWake); // 最少等 60 秒

        pushLog(`⏳ 下次检查 ${nextWake.toFixed(0)} 秒后 (build1=${latestTimers.build1}s build2=${latestTimers.build2}s train=${latestTimers.train_bingying}/${latestTimers.train_majiu}/${latestTimers.train_bachang}/${latestTimers.train_gongcheng}s research=${latestTimers.research}s)`);

        // ==== 一轮结束，per-round 模式记账 ====
        if (featuresRef.current.autoSwitchAccount && !isFeatureLocked('autoSwitchAccount') && featuresRef.current.switchMode === 'per-round') {
          markRoundDone('main');
        }

        // 等待期间
        const startWait = monotonicNow();
        const waitSeq = cooldownResetSeq;
        while (!isStopped() && cooldownResetSeq === waitSeq && (monotonicNow() - startWait) < nextWake * 1000) {
          await sleep(1);
        }
      }
      await Promise.all([helpLoop, collectLoop, gatherLoop, rallyLoop, attackBarbarianLoop, exploreLoop, caveLoop, produceMaterialLoop, allianceTerritoryLoop, allianceTechLoop, offlineLoop, attackLoop, accountSwitchLoop, shareGemLoop, stallDiagLoop]);
      if (isCurrentLoopGeneration(myGen, loopGen)) {
        loopRunning = false;
        setLoopRunningState(false);
        clearLoopState();
        runningTaskIdsRef.current = [];
        setRunningTaskIds([]);
        pushLog(`⏹️ 循环已停止`);
      }
    })();
  };
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

  const stopImpl = async () => {
    loopStopped = true;
    const stopGeneration = ++loopGen;
    loopRunning = false;
    setLoopRunningState(false);

    const ownerAccountId = runningOwnerAccountId;
    if (!ownerAccountId) {
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 停止失败: 运行账号缺失，请重试或重启应用恢复会话`]);
      return;
    }

    try {
      const result = await api.tasks.stopByAccount(ownerAccountId);
      if (!result.success) throw new Error('后端未能停止账号任务');
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : String(error);
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 停止失败: ${message}`]);
      return;
    }

    try {
      await persistSession({ running: false, accountId: null });
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : String(error);
      setIntentLoaded(false);
      setIntentLoadError(message || '无法保存运行状态');
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 保存停止状态失败: ${message}`]);
      return;
    }

    const shouldKillOfflineGame = offlineActive;
    clearLoopState();
    runningTaskIdsRef.current = [];
    setRunningTaskIds([]);
    moduleGemInitialCount = null;
    moduleGemCollectedCount = 0;
    setGemInitialCount(null);
    setGemCollectedCount(0);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏹️ 已停止所有任务`]);

    // Preserve offline semantics without keeping the stop operation lock while the task runs.
    if (shouldKillOfflineGame) {
      killInFlight = true;
      void (async () => {
        try {
          if (!isCurrentLoopGeneration(stopGeneration, loopGen) || loopRunning) return;
          const result = await api.tasks.create(ownerAccountId, 'com.rok.automation', 'kill-game');
          if (!result.success) return;
          if (!isCurrentLoopGeneration(stopGeneration, loopGen) || loopRunning) {
            await api.tasks.stop(result.task.id).catch(() => {});
            return;
          }
          await api.tasks.run(result.task.id);
        } catch (error) {
          const message = error instanceof Error && error.message ? error.message : String(error);
          setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 关闭游戏失败: ${message}`]);
        } finally {
          killInFlight = false;
        }
      })();
    }
  };

  const handleStop = async () => {
    if (operationLockRef.current) return;
    operationLockRef.current = true;
    setOperationState('stopping');
    try {
      await stopImpl();
    } finally {
      setOperationState('idle');
      operationLockRef.current = false;
    }
  };

  startHandlerRef.current = handleStartAll;
  stopHandlerRef.current = handleStop;

  // Local clicks and remote commands share the latest wrappers and synchronous lock.
  // 手机端下发 start_loop/stop_loop 时通过 ref 调用最新的 handler，避免 stale closure；
  // start 带 'remote' 让 handleStartAll 走远程分支（launch-game + starting-state 通知手机）。
  useEffect(() => {
    const eventSource = new EventSource(`${LOCAL_API_BASE}/api/remote-control/stream`);
    eventSource.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.action === 'start_loop') {
          void startHandlerRef.current('remote');
        } else if (data.action === 'stop_loop') {
          void stopHandlerRef.current();
        }
      } catch { /* Ignore connected and heartbeat frames. */ }
    };
    return () => eventSource.close();
  }, []);

  const runningControlView = deriveRunningControlView({
    deviceConnected,
    intentLoaded,
    intentError: intentLoadError !== null,
    operationState,
    runningIntent,
  });

  const renderRunningControl = () => {
    switch (runningControlView.action) {
      case 'connect':
        return <button onClick={handleConnectDevice} disabled={deviceLoading} className="px-8 py-3 bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-bold rounded-full hover:from-emerald-600 hover:to-emerald-500 transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/30">{deviceLoading ? '连接中...' : '连接设备'}</button>;
      case 'retry':
        return <button onClick={loadRunningIntent} className="px-8 py-3 bg-amber-500 text-white font-bold rounded-full hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/30">状态读取失败，点击重试</button>;
      case 'loading':
        return <button disabled className="px-8 py-3 bg-slate-400 text-white font-bold rounded-full cursor-not-allowed opacity-70">状态读取中...</button>;
      case 'starting':
        return <button disabled className="px-8 py-3 bg-slate-400 text-white font-bold rounded-full cursor-not-allowed opacity-70">启动中...</button>;
      case 'stopping':
        return <button disabled className="px-8 py-3 bg-red-500 text-white font-bold rounded-full transition-all shadow-lg shadow-red-500/30 disabled:opacity-70 disabled:cursor-not-allowed">停止中...</button>;
      case 'start':
        return <button onClick={() => void handleStartAll()} className="px-8 py-3 bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-bold rounded-full hover:from-emerald-600 hover:to-emerald-500 transition-all shadow-lg shadow-emerald-500/30 flex items-center gap-2"><span>▶</span> 开始运行</button>;
      case 'stop':
        return <button onClick={handleStop} className="px-8 py-3 bg-red-500 text-white font-bold rounded-full hover:bg-red-600 transition-all shadow-lg shadow-red-500/30">停止运行</button>;
      default: {
        const exhaustiveAction: never = runningControlView.action;
        return exhaustiveAction;
      }
    }
  };

  // 同步日志到 /api/logs/append，供 Mobile 页 SSE + 手机远程可见
  useEffect(() => {
    if (logs.length < lastPostedLogIndexRef.current) {
      // logs 被截断（clearLoopState 之类）→ 重置游标
      lastPostedLogIndexRef.current = logs.length;
      return;
    }
    if (logs.length === lastPostedLogIndexRef.current) return;
    const newEntries = logs.slice(lastPostedLogIndexRef.current);
    lastPostedLogIndexRef.current = logs.length;
    pendingLogBatchRef.current.push(...newEntries);
    scheduleLogFlush();
  }, [logs]);

  // 循环状态变化时上报到后端（→ RemoteContextService → push 到手机）
  useEffect(() => {
    fetch(`${LOCAL_API_BASE}/api/remote-control/loop-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ running: loopRunningState }),
    }).catch(() => { /* best effort */ });
  }, [loopRunningState]);

  if (!currentAccountId) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center py-20">
        <p className="text-xl text-slate-500 mb-4">请先创建配置</p>
        <p className="text-sm text-slate-400 mb-6">需要配置建筑坐标后才能开始运行</p>
        <Link to="/config" className="px-6 py-3 bg-emerald-500 text-white rounded-full hover:bg-emerald-600 inline-block shadow-lg shadow-emerald-500/30">
          新建配置
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <div className="max-w-4xl mx-auto p-6">
        {/* Status banner */}
        <div className="bg-gradient-to-r from-emerald-50 to-emerald-100 border border-emerald-300 rounded-xl p-4 flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white text-xl shadow-lg shadow-emerald-500/30">🎮</div>
            <div>
              <h3 className="font-semibold text-slate-800">{runningControlView.bannerText}</h3>
              <p className="text-sm text-slate-500">{deviceConnected ? '设备已连接' : '未连接设备'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleOpenRemoteControl}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-sm"
            >
              📱 远程控制
            </button>
            {deviceConnected && (
              <label
                className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer"
                title="开启后每天 02:00 自动强制关闭游戏，05:00 自动启动游戏，模拟玩家睡觉时段下线，降低被检测风险"
              >
                <input type="checkbox" checked={features.nightMode}
                  onChange={e => setFeatures({ ...features, nightMode: e.target.checked })}
                  className="w-4 h-4 accent-emerald-500" />
                <span>🌙 夜间下线 02-05点</span>
              </label>
            )}
            {renderRunningControl()}
          </div>
        </div>

        {/* 账号调度独立层 */}
        <div className={`rounded-xl mb-4 relative ${isFeatureLocked('autoSwitchAccount') ? 'bg-amber-50/60 border-2 border-amber-300 border-dashed' : features.autoSwitchAccount ? 'bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300' : 'bg-white border border-slate-200'}`}>
          {isFeatureLocked('autoSwitchAccount') && (
            <div className="absolute -top-1.5 right-3 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-amber-200 flex items-center gap-1 z-10"
              title="升级到 Pro 解锁">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.37 2.448a1 1 0 00-.364 1.118l1.287 3.957c.3.921-.755 1.688-1.54 1.118l-3.37-2.448a1 1 0 00-1.176 0l-3.37 2.448c-.784.57-1.838-.197-1.539-1.118l1.287-3.957a1 1 0 00-.364-1.118L2.063 9.384c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.95-.69l1.286-3.957z" /></svg>
              PRO
            </div>
          )}
          {!accountScheduleExpanded ? (
            <button
              type="button"
              onClick={() => setAccountScheduleExpanded(true)}
              className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-amber-100/40 transition-colors rounded-xl"
            >
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm shadow ${isFeatureLocked('autoSwitchAccount') ? 'bg-amber-300' : 'bg-amber-400'}`}>🔀</span>
              <span className="flex items-center gap-1.5 font-semibold text-sm text-slate-800">
                <span>账号调度：{features.autoSwitchAccount && !isFeatureLocked('autoSwitchAccount') ? '开启' : '关闭'}</span>
                <span
                  role="img"
                  aria-label="账号调度说明"
                  title="在两个账号配置方案之间自动切换。按时间轮换：到达设定时长后切号；按轮次轮换：完成设定轮数后切号；寨子模式：根据城寨任务结果切号；组合采集：小号分享宝石矿、大号采集分享矿。连体号：在同一游戏账号的主号与连体角色间切换（配置页把类型设为&quot;连体号&quot;并填主号编号）；触发时机仍由上方模式决定。"
                  className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold leading-none text-slate-500 transition-colors hover:bg-cyan-100 hover:text-cyan-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open('https://slgbot.com#qa-account-schedule-modes', '_blank', 'noopener,noreferrer');
                  }}
                >
                  ?
                </span>
              </span>
              <span className="ml-auto text-amber-600 text-2xl leading-none">▸</span>
            </button>
          ) : (
            <div className="p-4">
              {/* 头部 */}
              <div className="flex items-center gap-3 mb-3">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-base shadow ${isFeatureLocked('autoSwitchAccount') ? 'bg-amber-300' : 'bg-amber-400'}`}>🔀</span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-sm text-slate-800">账号调度</h3>
                    <span
                      role="img"
                      aria-label="账号调度说明"
                      title="在两个账号配置方案之间自动切换。按时间轮换：到达设定时长后切号；按轮次轮换：完成设定轮数后切号；寨子模式：根据城寨任务结果切号；组合采集：小号分享宝石矿、大号采集分享矿。连体号：在同一游戏账号的主号与连体角色间切换（配置页把类型设为&quot;连体号&quot;并填主号编号）；触发时机仍由上方模式决定。"
                      onClick={() => window.open('https://slgbot.com#qa-account-schedule-modes', '_blank', 'noopener,noreferrer')}
                      className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold leading-none text-slate-500 transition-colors hover:bg-cyan-100 hover:text-cyan-700"
                    >
                      ?
                    </span>
                  </div>
                  <p className="text-xs text-amber-700">请先在坐标配置页中添加账号，填入账号编号</p>
                </div>
                <div className="flex-1"></div>
                <select
                  value={features.switchMode}
                  onChange={(e) => setFeatures({ ...features, switchMode: e.target.value as 'per-round' | 'per-time' | 'fort-mode' | 'combo-gem' })}
                  disabled={isFeatureLocked('autoSwitchAccount')}
                  className="text-xs bg-white border border-amber-300 rounded px-2 py-1 text-amber-700 font-medium focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="per-time">按时间轮换</option>
                  <option value="per-round">按轮次轮换</option>
                  <option value="fort-mode">寨子模式</option>
                  <option value="combo-gem">组合采集</option>
                </select>
                <div className="flex items-center gap-2">
                  {isFeatureLocked('autoSwitchAccount') ? (
                    <span className="relative w-10 h-[22px] flex-shrink-0 cursor-not-allowed" title="升级到 Pro 解锁">
                      <span className="absolute inset-0 rounded-full bg-slate-200" />
                      <span className="absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full shadow-sm" />
                    </span>
                  ) : (
                  <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                    <input type="checkbox" checked={features.autoSwitchAccount}
                      onChange={(e) => setFeatures({ ...features, autoSwitchAccount: e.target.checked })}
                      className="sr-only" />
                    <span className={`absolute inset-0 rounded-full transition-colors ${features.autoSwitchAccount ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                    <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoSwitchAccount ? 'translate-x-[18px]' : ''}`} />
                  </label>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setAccountScheduleExpanded(false)}
                  className="text-amber-600 hover:text-amber-700 px-1 text-2xl leading-none"
                  title="收起"
                >▾</button>
              </div>

              {/* Profile 横向队列 */}
              <div className="bg-white/70 rounded-lg p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {(() => {
                    const ids: string[] = (features.switchProfileIds || []).slice(0, MAX_SWITCH_SLOTS);
                    while (ids.length < MAX_SWITCH_SLOTS) ids.push('');
                    // 不随槽位变化的部分只算一次：baseMeta 供各槽位的假设列表复用
                    const baseMeta = toSwitchMeta(ids);
                    const slotKinds = deriveProfileKinds(baseMeta);
                    return ids.map((profileName: string, i: number) => {
                      const isActive = !!profileName && profileName === activeConfigName && features.autoSwitchAccount;
                      const others = ids.filter((_: string, j: number) => j !== i);
                      const isPer = features.switchMode === 'per-time';
                      return (
                        <Fragment key={i}>
                          <div className={`w-44 px-3 py-2.5 rounded-lg ${isActive ? 'bg-emerald-50 border-2 border-emerald-500 shadow -translate-y-0.5' : 'bg-white border-2 border-slate-200 hover:border-amber-300'}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`}></span> {isActive ? '当前' : '待切换'}
                              </span>
                              <span className="flex items-center gap-1">
                                {profileName && slotKinds[profileName] === 'role' && typeof profileStarredIndexes[profileName] === 'number' && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700">
                                    角色#{profileStarredIndexes[profileName]}
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-300">#{i + 1}</span>
                              </span>
                            </div>
                            <select
                              value={profileName}
                              onChange={(e) => {
                                const v = e.target.value;
                                const next = ids.slice();
                                next[i] = v;
                                setFeatures({ ...features, switchProfileIds: next });
                                if (v && v !== activeConfigName) handleConfigSwitch(v);
                              }}
                              className="text-sm font-bold text-slate-800 bg-transparent w-full h-[26px] focus:outline-none"
                            >
                              <option value="">-- 不选择 --</option>
                              {configNames.filter(p => !others.includes(p)).map(p => {
                                // 把 p 放进当前槽位后的假设列表，用统一校验判断这个选择是否可行
                                const hypothetical = ids.slice();
                                hypothetical[i] = p;
                                const issues = validateSwitchProfiles(toSwitchMeta(hypothetical));
                                const own = issues.find(x => x.profileName === p);
                                const accName = (profileAccountNames[p] || '').trim();
                                const starIdx = profileStarredIndexes[p];
                                let suffix = '';
                                if (own?.reason === 'no-account') suffix = '（未填编号）';
                                else if (own?.reason === 'missing-starred-index') suffix = '（需填星标序号）';
                                else if (own?.reason === 'invalid-starred-index') suffix = '（星标序号非法）';
                                else if (own?.reason === 'duplicate-starred-index') suffix = '（星标序号重复）';
                                else if (typeof starIdx === 'number') suffix = `（账号 ${accName} · 星标#${starIdx}）`;
                                else if (accName) suffix = `（账号 ${accName}）`;
                                return (
                                  <option key={p} value={p} disabled={!!own}>
                                    {p}{suffix}
                                  </option>
                                );
                              })}
                            </select>
                            {isPer && (
                              <div className="flex items-center gap-1 mt-1">
                                <input
                                  type="number"
                                  min={1}
                                  value={normalizeIntervals(features.switchIntervalMinutes)[i]}
                                  onChange={(e) => {
                                    const cur = normalizeIntervals(features.switchIntervalMinutes);
                                    cur[i] = Math.max(1, parseInt(e.target.value, 10) || 30);
                                    setFeatures({ ...features, switchIntervalMinutes: cur });
                                  }}
                                  className="w-12 px-1 py-0.5 text-xs bg-white border border-slate-200 rounded text-center"
                                />
                                <span className="text-xs text-slate-400">分钟</span>
                              </div>
                            )}
                          </div>
                          {i < MAX_SWITCH_SLOTS - 1 && <span className="text-amber-500 text-sm flex-shrink-0 select-none">→</span>}
                        </Fragment>
                      );
                    });
                  })()}

                  <span className="text-amber-500 text-sm flex-shrink-0 select-none">↩</span>
                  <span className="text-xs text-amber-500/70">循环</span>

                  <div className="flex-1"></div>
                </div>
              </div>

              <p className="mt-2 text-xs text-amber-600/70">💡 切号后自动加载对应方案的全部功能设置 · 共 {MAX_SWITCH_SLOTS} 个身份参与轮换{MAX_SWITCH_SLOTS > 2 && <span className="text-amber-500">（开发模式）</span>}</p>
              {(() => {
                const issues = validateSwitchProfiles(toSwitchMeta((features.switchProfileIds || []).slice(0, MAX_SWITCH_SLOTS)));
                if (issues.length === 0) return null;
                const texts = issues.map(x => {
                  if (x.reason === 'no-account') return `${x.profileName}: 未填账号编号`;
                  if (x.reason === 'missing-starred-index') return `${x.profileName}: 同账号多角色需在配置页填星标序号`;
                  if (x.reason === 'invalid-starred-index') return `${x.profileName}: 星标序号必须是 ≥1 的整数`;
                  return `${x.profileName}: 星标序号与同账号其它方案重复`;
                });
                return <p className="mt-1 text-xs text-rose-600">⚠️ {texts.join('；')}</p>;
              })()}
            </div>
          )}
        </div>

        {/* Feature settings card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mb-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center text-sm">⚙️</span>
            <h3 className="text-lg font-bold text-slate-800">功能设置</h3>
            {currentAccountId && configNames.length > 0 && (
              <select
                value={activeConfigName}
                onChange={e => handleConfigSwitch(e.target.value)}
                disabled={runningIntent}
                title={runningIntent ? '运行中无法切换配置，请先停止' : undefined}
                className="ml-auto px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:border-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {configNames.map(n => <option key={n} value={n}>📐 {n}</option>)}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">

            {/* 智能采集宝石 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${(features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' : isFeatureLocked('gemGather') ? 'bg-amber-50/60 border-amber-300 border-dashed' : features.gemGatherEnabled ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              {isFeatureLocked('gemGather') && (
                <div className="absolute -top-1.5 right-3 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-amber-200 flex items-center gap-1"
                  title="升级到 Pro 解锁">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.37 2.448a1 1 0 00-.364 1.118l1.287 3.957c.3.921-.755 1.688-1.54 1.118l-3.37-2.448a1 1 0 00-1.176 0l-3.37 2.448c-.784.57-1.838-.197-1.539-1.118l1.287-3.957a1 1 0 00-.364-1.118L2.063 9.384c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.95-.69l1.286-3.957z" /></svg>
                  PRO
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${isFeatureLocked('gemGather') ? 'bg-amber-100' : 'bg-cyan-100'}`}>💎</span>
                  自动采集宝石
                </span>
                {isFeatureLocked('gemGather') ? (
                  <span className="relative w-10 h-[22px] flex-shrink-0 cursor-not-allowed" title="升级到 Pro 解锁">
                    <span className="absolute inset-0 rounded-full bg-slate-200" />
                    <span className="absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full shadow-sm" />
                  </span>
                ) : (
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.gemGatherEnabled} disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, gemGatherEnabled: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.gemGatherEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.gemGatherEnabled ? 'translate-x-[18px]' : ''}`} />
                </label>
                )}
              </div>
              {/* ── 基础配置 ── */}
              <div className="mt-3 mb-1 text-[11px] font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                基础配置
              </div>

              {/* 派遣队伍 */}
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-slate-500 whitespace-nowrap">派遣队伍</span>
                <div className="flex items-center gap-1">
                  {[1,2,3,4,5,6,7].map(teamNum => (
                    <label key={teamNum} className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox"
                        checked={features.gemGatherTeams.includes(teamNum)}
                        disabled={features.autoWorldChat || !features.gemGatherEnabled || isFeatureLocked('gemGather')}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...features.gemGatherTeams, teamNum].sort((a, b) => a - b)
                            : features.gemGatherTeams.filter((t: number) => t !== teamNum);
                          setFeatures({ ...features, gemGatherTeams: next.length === 0 ? [teamNum] : next });
                        }}
                        className="sr-only" />
                      <span className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-semibold border ${features.gemGatherTeams.includes(teamNum) ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : 'bg-slate-100 border-slate-200 text-slate-400'} ${!features.gemGatherEnabled ? 'opacity-50' : ''}`}>
                        {teamNum}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 队伍页 */}
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-slate-500 whitespace-nowrap">队伍页</span>
                {renderTeamPageSelect(features.gemGatherTeamPage, (v) => setFeatures({ ...features, gemGatherTeamPage: v }), features.autoWorldChat || !features.gemGatherEnabled || isFeatureLocked('gemGather'))}
              </div>

              {/* 模式 */}
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-slate-500 whitespace-nowrap">模式</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 whitespace-nowrap">普通</span>
                  {(() => {
                    const ratio = features.gemGatherMixRatio ?? 0.5;
                    const disabled = !features.gemGatherEnabled || isFeatureLocked('gemGather') || features.autoWorldChat;
                    return (
                      <div className={`slider-capsule w-[128px] ${disabled ? 'is-disabled opacity-60' : ''}`}>
                        <div className="track" />
                        <div className="fill" style={{ width: `${ratio * 100}%` }} />
                        <input type="range" min={0} max={1} step={0.1}
                          value={ratio}
                          disabled={disabled}
                          onChange={(e) => {
                            const r = Math.min(1, Math.max(0, Number(e.target.value)));
                            const mode = r === 0 ? 'normal' : r === 1 ? 'focus' : 'mixed';
                            setFeatures({ ...features, gemGatherMixRatio: r, gemGatherMode: mode });
                          }} />
                      </div>
                    );
                  })()}
                  <span className="text-xs text-slate-500 whitespace-nowrap">驻扎</span>
                </div>
              </div>

              {/* 运行节奏 */}
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-slate-500 whitespace-nowrap">运行节奏</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-400">采集</span>
                  <input type="number" value={features.gemGatherActiveHours ?? 3}
                    onChange={(e) => setFeatures({ ...features, gemGatherActiveHours: Number(e.target.value) })}
                    disabled={!features.gemGatherEnabled || isFeatureLocked('gemGather')}
                    min={1} max={24}
                    className="w-12 px-1 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-700 text-center focus:outline-none focus:border-cyan-500 disabled:opacity-50" />
                  <span className="text-xs text-slate-400">h，休息</span>
                  <input type="number" value={features.gemGatherRestHours ?? 1}
                    onChange={(e) => setFeatures({ ...features, gemGatherRestHours: Number(e.target.value) })}
                    disabled={!features.gemGatherEnabled || isFeatureLocked('gemGather')}
                    min={1} max={24}
                    className="w-12 px-1 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-700 text-center focus:outline-none focus:border-cyan-500 disabled:opacity-50" />
                  <span className="text-xs text-slate-400">h</span>
                </div>
              </div>

              {/* ── 高级策略（可折叠） ── */}
              <button type="button"
                onClick={() => setShowGemAdvanced(v => !v)}
                className="mt-4 mb-1 w-full flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-400 uppercase hover:text-slate-500 transition-colors">
                <span className="flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-cyan-400" />
                  高级策略
                </span>
                <span className={`transition-transform ${showGemAdvanced ? 'rotate-180' : ''}`}>▼</span>
              </button>

              {showGemAdvanced && (
                <>
                  {/* 最大采集距离 */}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-slate-500 whitespace-nowrap">最大采集距离</span>
                    <div className="flex items-center gap-1">
                      <input type="number" value={features.gemGatherMaxDistance ?? 100}
                        onChange={(e) => setFeatures({ ...features, gemGatherMaxDistance: Number(e.target.value) })}
                        disabled={!features.gemGatherEnabled || isFeatureLocked('gemGather')}
                        min={1} max={9999}
                        className="w-16 px-1 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-700 text-center focus:outline-none focus:border-cyan-500 disabled:opacity-50" />
                      <span className="text-xs text-slate-400 w-8">公里</span>
                    </div>
                  </div>

                  {/* 滑动后额外等待时间 */}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-slate-500 whitespace-nowrap flex items-center gap-2">
                      滑动后额外等待
                      <span className="text-xs text-slate-400 font-normal">如识别正常无需调节</span>
                    </span>
                    <div className="flex items-center gap-1">
                      <input type="number" value={features.gemGatherExtraSwipePauseSec ?? 0}
                        onChange={(e) => setFeatures({ ...features, gemGatherExtraSwipePauseSec: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })}
                        disabled={!features.gemGatherEnabled || isFeatureLocked('gemGather')}
                        min={0} max={5} step={0.5}
                        className="w-16 px-1 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-700 text-center focus:outline-none focus:border-cyan-500 disabled:opacity-50" />
                      <span className="text-xs text-slate-400 w-8">秒</span>
                    </div>
                  </div>

                  {/* 搜索路径权重 */}
                  <div className="mt-2">
                    <div className="text-xs text-slate-500">搜索路径权重</div>
                    {(() => {
                      const w = features.gemSearchWeights ?? { spiral: 40, reverseSpiral: 40, randomWalk: 10, snake: 10 };
                      const total = w.spiral + w.reverseSpiral + w.randomWalk + w.snake;
                      const rows: Array<Array<readonly [keyof typeof w, string]>> = [
                        [['spiral', '螺旋'], ['reverseSpiral', '反螺旋']],
                        [['randomWalk', '随机'], ['snake', '蛇形']],
                      ];
                      const renderCell = (key: keyof typeof w, label: string) => (
                        <label key={String(key)} className="flex items-center gap-1">
                          <span className="text-xs text-slate-500 w-12">{label}</span>
                          <input type="number" min={0} max={100} value={w[key]}
                            disabled={!features.gemGatherEnabled || isFeatureLocked('gemGather')}
                            onChange={(e) => setFeatures({ ...features, gemSearchWeights: { ...w, [key]: Math.max(0, Number(e.target.value) || 0) } })}
                            className="w-12 px-1 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-700 text-center focus:outline-none focus:border-cyan-500 disabled:opacity-50" />
                        </label>
                      );
                      return (
                        <div className="mt-1.5 flex flex-col gap-1 w-fit">
                          <div className="flex items-center gap-4">
                            {rows[0].map(([k, l]) => renderCell(k, l))}
                          </div>
                          <div className="flex items-center gap-4">
                            {rows[1].map(([k, l]) => renderCell(k, l))}
                            <span className={`text-xs tabular-nums ml-2 ${total === 0 ? 'text-red-500' : 'text-slate-400'}`}>合计 {total}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* 组合采集 */}
                  <div className="mt-3">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                      <span>组合采集</span>
                      <span
                        role="img"
                        aria-label="组合采集说明"
                        title="大号勾选“采集分享矿”，从聊天中读取并采集小号分享的宝石矿；小号勾选“分享宝石矿”，只搜索并把宝石矿坐标分享给大号。两项互斥。"
                        onClick={() => window.open('https://slgbot.com#qa-account-schedule-modes', '_blank', 'noopener,noreferrer')}
                        className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold leading-none text-slate-500 transition-colors hover:bg-cyan-100 hover:text-cyan-700"
                      >
                        ?
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mt-2">
                    <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                      features.gemGatherSharedOnly
                        ? 'bg-rose-50 text-rose-700'
                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                    } ${(!features.gemGatherEnabled || isFeatureLocked('gemGather')) ? 'opacity-40 cursor-not-allowed' : ''}`}>
                      <input type="checkbox"
                        checked={features.gemGatherSharedOnly}
                        onChange={(e) => setFeatures({ ...features, gemGatherSharedOnly: e.target.checked, ...(e.target.checked ? { shareGemEnabled: false } : {}) })}
                        disabled={!features.gemGatherEnabled || isFeatureLocked('gemGather')}
                        className="sr-only peer" />
                      <span className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center text-[11px] ${
                        features.gemGatherSharedOnly ? 'bg-rose-500 border-rose-500 text-white' : 'bg-white border-slate-300 text-transparent'
                      }`}>✓</span>
                      采集分享矿(大号用)
                    </label>
                    <span className="text-xs text-slate-400">不搜矿，只采集小号分享的矿</span>
                  </div>

                  {/* 分享宝石矿（与采集分享矿互斥：勾一个自动取消另一个） */}
                  <div className="flex items-center gap-3 mt-2">
                    <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                      features.shareGemEnabled
                        ? 'bg-rose-50 text-rose-700'
                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                    } ${(!features.gemGatherEnabled || isFeatureLocked('gemGather') || isFeatureLocked('shareGem')) ? 'opacity-40 cursor-not-allowed' : ''}`}>
                      <input type="checkbox"
                        checked={features.shareGemEnabled}
                        onChange={(e) => setFeatures({ ...features, shareGemEnabled: e.target.checked, ...(e.target.checked ? { gemGatherSharedOnly: false } : {}) })}
                        disabled={!features.gemGatherEnabled || isFeatureLocked('gemGather') || isFeatureLocked('shareGem')}
                        className="sr-only peer" />
                      <span className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center text-[11px] ${
                        features.shareGemEnabled ? 'bg-rose-500 border-rose-500 text-white' : 'bg-white border-slate-300 text-transparent'
                      }`}>✓</span>
                      分享宝石矿(小号用)
                    </label>
                    <span className="text-xs text-slate-400">不采集，只分享宝石矿给大号</span>
                  </div>

                  {/* 搜索停止条件 */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-slate-500 whitespace-nowrap">搜索停止条件</span>
                    <select
                      value={features.shareGemStopCondition === 'spiral' ? 'count5' : (features.shareGemStopCondition ?? 'count5')}
                      disabled={!features.gemGatherEnabled || !features.shareGemEnabled || isFeatureLocked('gemGather') || isFeatureLocked('shareGem')}
                      onChange={(e) => setFeatures({ ...features, shareGemStopCondition: e.target.value as 'count5' | 'count10' | 'count15' | 'count100' })}
                      className="px-2 py-1 border border-slate-300 rounded text-xs bg-white disabled:opacity-50"
                    >
                      <option value="count5">分享 5 个矿</option>
                      <option value="count10">分享 10 个矿</option>
                      <option value="count15">分享 15 个矿</option>
                    </select>
                    <span className="text-xs text-slate-400">仅用于分享宝石矿</span>
                  </div>

                  {/* 大号城堡坐标（用于采集分享矿计算最近矿 / 分享宝石矿螺旋起点） */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-slate-500 whitespace-nowrap">大号城堡坐标</span>
                    <span className="text-xs text-slate-400">X</span>
                    <input type="number"
                      className="w-14 px-1 py-1 border border-slate-300 rounded text-xs"
                      value={features.gemGatherHomeX ?? 0}
                      disabled={!features.gemGatherEnabled || (!features.gemGatherSharedOnly && !features.shareGemEnabled) || isFeatureLocked('gemGather')}
                      onChange={(e) => setFeatures({ ...features, gemGatherHomeX: Number(e.target.value) || 0 })} />
                    <span className="text-xs text-slate-400">Y</span>
                    <input type="number"
                      className="w-14 px-1 py-1 border border-slate-300 rounded text-xs"
                      value={features.gemGatherHomeY ?? 0}
                      disabled={!features.gemGatherEnabled || (!features.gemGatherSharedOnly && !features.shareGemEnabled) || isFeatureLocked('gemGather')}
                      onChange={(e) => setFeatures({ ...features, gemGatherHomeY: Number(e.target.value) || 0 })} />
                  </div>
                </>
              )}
              {gemRestCountdown && (
                <p className="text-xs text-amber-600 mt-1">💤 休息中 剩余 {gemRestCountdown}</p>
              )}
              {features.gemGatherEnabled && gemInitialCount !== null && (
                <div className="flex items-center gap-4 mt-1.5 text-xs text-slate-500">
                  <span>初始数量：<span className="text-slate-700 font-medium">{gemInitialCount}</span></span>
                  <span>已采集数量：<span className="text-cyan-600 font-medium">{gemCollectedCount}</span><span className="text-slate-400">（每5分钟更新）</span></span>
                </div>
              )}
              {isFeatureLocked('gemGather') ? (
                <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  升级到 Pro 解锁宝石采集
                </p>
              ) : (
                <p className="text-xs text-slate-400 mt-1.5">推荐默认配置，不要挂全天！日采2000，细水长流。</p>
              )}
            </div>

            {/* 城外资源采集 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border ${(features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :features.gatherResources ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center text-base">🌾</span>城外资源采集</span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.gatherResources} disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, gatherResources: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.gatherResources ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.gatherResources ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <div className="grid grid-cols-5 gap-1 mt-2">
                {features.gatherTasks.slice(0, 5).map((task: { type: string; level: number }, i: number) => (
                  <div key={i} className="flex flex-col gap-1">
                    <select value={task.type} disabled={features.autoWorldChat} onChange={(e) => {
                      const next = [...features.gatherTasks]; next[i] = { ...next[i], type: e.target.value };
                      setFeatures({ ...features, gatherTasks: next });
                    }}
                    className="px-1 py-1 bg-white border border-slate-200 rounded text-xs w-full">
                      <option value="">-</option>
                      {RESOURCE_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                    </select>
                    <select value={task.level} disabled={features.autoWorldChat} onChange={(e) => {
                      const next = [...features.gatherTasks]; next[i] = { ...next[i], level: Number(e.target.value) };
                      setFeatures({ ...features, gatherTasks: next });
                    }}
                    className="px-1 py-1 bg-white border border-slate-200 rounded text-xs w-full">
                      {RESOURCE_LEVELS.map(l => (<option key={l} value={l}>Lv.{l}</option>))}
                    </select>
                  </div>
                ))}
              </div>
              {/* 队伍6-7 折叠区 */}
              {(() => {
                const extraConfigured = features.gatherTasks.slice(5, 7).filter((t: { type: string }) => t.type).length;
                return (
                  <>
                    <button type="button"
                      onClick={() => setShowExtraGatherSlots(v => !v)}
                      className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors">
                      <span>队伍 6-7</span>
                      {extraConfigured > 0 && (
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
                          {extraConfigured}
                        </span>
                      )}
                      <span className={`transition-transform ${showExtraGatherSlots ? 'rotate-180' : ''}`}>▼</span>
                    </button>
                    {showExtraGatherSlots && (
                      <div className="grid grid-cols-5 gap-1 mt-1.5">
                        {features.gatherTasks.slice(5, 7).map((task: { type: string; level: number }, idx: number) => {
                          const i = idx + 5;
                          return (
                            <div key={i} className="flex flex-col gap-1">
                              <select value={task.type} disabled={features.autoWorldChat} onChange={(e) => {
                                const next = [...features.gatherTasks]; next[i] = { ...next[i], type: e.target.value };
                                setFeatures({ ...features, gatherTasks: next });
                              }}
                              className="px-1 py-1 bg-white border border-slate-200 rounded text-xs w-full">
                                <option value="">-</option>
                                {RESOURCE_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                              </select>
                              <select value={task.level} disabled={features.autoWorldChat} onChange={(e) => {
                                const next = [...features.gatherTasks]; next[i] = { ...next[i], level: Number(e.target.value) };
                                setFeatures({ ...features, gatherTasks: next });
                              }}
                              className="px-1 py-1 bg-white border border-slate-200 rounded text-xs w-full">
                                {RESOURCE_LEVELS.map(l => (<option key={l} value={l}>Lv.{l}</option>))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs text-slate-400 whitespace-nowrap">队伍页</span>
                {renderTeamPageSelect(features.resourceGatherTeamPage, (v) => setFeatures({ ...features, resourceGatherTeamPage: v }), features.autoWorldChat)}
              </div>
            </div>

            {/* 自动攻打城寨 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${(features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' : features.autoRallyFort ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-base">🏰</span>自动攻打城寨</span>
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${(features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={features.autoRallyFort}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, autoRallyFort: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.autoRallyFort ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoRallyFort ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <div className="flex flex-col mt-2 -mx-4">
                {/* 目标等级 + 派遣 */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100">
                  <span className="text-xs text-slate-500 whitespace-nowrap w-16">目标等级</span>
                  <input type="number" min={1} max={15} value={features.rallyFortLevel || ''}
                    disabled={features.autoWorldChat}
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : Math.max(1, Math.min(15, Number(e.target.value)));
                      setFeatures({ ...features, rallyFortLevel: v });
                    }}
                    placeholder="等级"
                    className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs w-20" />
                  <span className="text-xs text-slate-500 whitespace-nowrap ml-3">派遣第</span>
                  <select value={features.rallyFortTeam}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, rallyFortTeam: Number(e.target.value) })}
                    className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs w-14">
                    {[1,2,3,4,5].map(t => (<option key={t} value={t}>{t}</option>))}
                  </select>
                  <span className="text-xs text-slate-700 whitespace-nowrap">队伍</span>
                </div>

                {/* 策略勾选：勾选框在前 */}
                <div className="flex items-center gap-5 px-4 py-2.5 border-t border-slate-100">
                  <label className={`flex items-center gap-1.5 ${(features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                    title="当搜索不到对应等级的城寨后，降级搜索。">
                    <input type="checkbox" checked={features.rallyFortDowngrade}
                      disabled={features.autoWorldChat}
                      onChange={(e) => setFeatures({ ...features, rallyFortDowngrade: e.target.checked })}
                      className="sr-only peer" />
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${features.rallyFortDowngrade ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                      {features.rallyFortDowngrade && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="text-xs text-slate-700 whitespace-nowrap">降级搜索</span>
                  </label>
                  <label className={`flex items-center gap-1.5 ${(features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                    title="体力不足时自动使用体力药水补充；未勾选则跳过本轮等 75 分钟">
                    <input type="checkbox" checked={features.rallyFortUsePotion}
                      disabled={features.autoWorldChat}
                      onChange={(e) => setFeatures({ ...features, rallyFortUsePotion: e.target.checked })}
                      className="sr-only peer" />
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${features.rallyFortUsePotion ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                      {features.rallyFortUsePotion && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="text-xs text-slate-700 whitespace-nowrap">体力不足使用药水</span>
                  </label>
                  <label title="勾选后，集结目标变成劫掠者城寨"
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                    features.rallyFortMarauder
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                  } ${features.autoWorldChat ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}>
                    <input type="checkbox" checked={features.rallyFortMarauder}
                      disabled={features.autoWorldChat}
                      onChange={(e) => setFeatures({ ...features, rallyFortMarauder: e.target.checked })}
                      className="sr-only peer" />
                    <span className={`w-[16px] h-[16px] rounded-[4px] border-2 flex items-center justify-center text-[11px] leading-none ${
                      features.rallyFortMarauder ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-300 text-transparent'
                    }`}>✓</span>
                    劫掠者城寨
                  </label>
                </div>

                {/* 队伍页 + 部队推荐 */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100">
                  <span className="text-xs text-slate-500 whitespace-nowrap w-16">队伍页</span>
                  {renderTeamPageSelect(features.rallyFortTeamPage, (v) => setFeatures({ ...features, rallyFortTeamPage: v }), features.autoWorldChat)}
                  <span className="text-xs text-slate-500 whitespace-nowrap ml-3">部队推荐</span>
                  <select value={features.rallyFortTroopType}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, rallyFortTroopType: e.target.value as any })}
                    className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs w-20">
                    <option value="any">不限制</option>
                    <option value="infantry">步兵</option>
                    <option value="cavalry">骑兵</option>
                    <option value="archer">弓兵</option>
                  </select>
                </div>

                {/* 备用队伍 sub-card */}
                <div className="px-4 pt-2 pb-1">
                  <div className={`rounded-lg border border-[#f0f0f3] bg-[#fafafc] p-2.5 ${features.autoWorldChat ? 'opacity-50' : ''}`}>
                    <label className={`flex items-center gap-1.5 ${features.autoWorldChat ? 'pointer-events-none' : 'cursor-pointer'}`}
                      title="设置备用队伍，主队返回时也能发起集结。">
                      <input type="checkbox" checked={features.rallyFortFallbackTeam}
                        disabled={features.autoWorldChat}
                        onChange={(e) => setFeatures({ ...features, rallyFortFallbackTeam: e.target.checked })}
                        className="sr-only peer" />
                      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${features.rallyFortFallbackTeam ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                        {features.rallyFortFallbackTeam && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className="text-xs font-medium text-slate-700 whitespace-nowrap">启用备用队伍</span>
                    </label>
                    <div className={`flex items-center gap-2 mt-2 pl-5 ${features.rallyFortFallbackTeam ? '' : 'opacity-50 pointer-events-none'}`}>
                      <span className="text-xs text-slate-500 whitespace-nowrap">第</span>
                      <select value={features.rallyFortFallbackTeamNum}
                        disabled={features.autoWorldChat || !features.rallyFortFallbackTeam}
                        onChange={(e) => setFeatures({ ...features, rallyFortFallbackTeamNum: Number(e.target.value) })}
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-xs w-14">
                        {[1,2,3,4,5].filter(t => t !== features.rallyFortTeam).map(t => (<option key={t} value={t}>{t}</option>))}
                      </select>
                      <span className="text-xs text-slate-700 whitespace-nowrap">队伍</span>
                      <span className="text-xs text-slate-500 whitespace-nowrap ml-2">部队推荐</span>
                      <select value={features.rallyFortFallbackTroopType}
                        disabled={features.autoWorldChat || !features.rallyFortFallbackTeam}
                        onChange={(e) => setFeatures({ ...features, rallyFortFallbackTroopType: e.target.value as any })}
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-xs w-20">
                        <option value="any">不限制</option>
                        <option value="infantry">步兵</option>
                        <option value="cavalry">骑兵</option>
                        <option value="archer">弓兵</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* 加入集结 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${
              (features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :
              isFeatureLocked('joinRally') ? 'bg-amber-50/60 border-amber-300 border-dashed' :
              features.joinRallyEnabled ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'
            }`}>
              {isFeatureLocked('joinRally') && (
                <div className="absolute -top-1.5 right-3 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-amber-200 flex items-center gap-1"
                  title="升级到 Pro 解锁">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.37 2.448a1 1 0 00-.364 1.118l1.287 3.957c.3.921-.755 1.688-1.54 1.118l-3.37-2.448a1 1 0 00-1.176 0l-3.37 2.448c-.784.57-1.838-.197-1.539-1.118l1.287-3.957a1 1 0 00-.364-1.118L2.063 9.384c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.95-.69l1.286-3.957z" /></svg>
                  PRO
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${isFeatureLocked('joinRally') ? 'bg-amber-100' : 'bg-orange-100'}`}>🤝</span>
                  加入集结
                </span>
                {isFeatureLocked('joinRally') ? (
                  <span className="relative w-10 h-[22px] flex-shrink-0 cursor-not-allowed" title="升级到 Pro 解锁">
                    <span className="absolute inset-0 rounded-full bg-slate-200" />
                    <span className="absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full shadow-sm" />
                  </span>
                ) : (
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${
                  (features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
                }`}>
                  <input type="checkbox" checked={features.joinRallyEnabled}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, joinRallyEnabled: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.joinRallyEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.joinRallyEnabled ? 'translate-x-[18px]' : ''}`} />
                </label>
                )}
              </div>
              <div className={`mt-3 space-y-2 ${features.joinRallyEnabled && !isFeatureLocked('joinRally') ? '' : 'opacity-50 pointer-events-none'}`}>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={features.joinRallyUseDefaultTeam}
                    onChange={(e) => setFeatures({ ...features, joinRallyUseDefaultTeam: e.target.checked })}
                    className="sr-only peer" />
                  <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${features.joinRallyUseDefaultTeam ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                    {features.joinRallyUseDefaultTeam && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <span className="text-xs text-slate-600">使用系统编队</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-12">派遣第</span>
                  <select
                    value={features.joinRallyTeam}
                    onChange={(e) => setFeatures({ ...features, joinRallyTeam: Number(e.target.value) })}
                    disabled={features.joinRallyUseDefaultTeam}
                    className={`px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700 focus:outline-none focus:border-emerald-500 ${features.joinRallyUseDefaultTeam ? 'opacity-50 cursor-not-allowed' : ''}`}
                    style={{ width: '50px' }}>
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <span className="text-xs text-slate-500 w-8">队伍</span>
                  <span className="text-xs text-slate-500 w-12 ml-2">队伍页</span>
                  {renderTeamPageSelect(
                    features.joinRallyTeamPage,
                    (v) => setFeatures({ ...features, joinRallyTeamPage: v }),
                    !features.joinRallyEnabled || features.joinRallyUseDefaultTeam
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-12">集结目标</span>
                  <div className="flex items-center gap-4">
                    <label
                      className={`flex items-center gap-1.5 ${!features.joinRallyEnabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                      onClick={() => features.joinRallyEnabled && setFeatures({ ...features, joinRallyTargetFort: !features.joinRallyTargetFort })}
                    >
                      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${features.joinRallyTargetFort ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                        {features.joinRallyTargetFort && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      <span className="text-xs text-slate-600">城寨</span>
                    </label>
                    <label
                      className={`flex items-center gap-1.5 ${!features.joinRallyEnabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                      onClick={() => features.joinRallyEnabled && setFeatures({ ...features, joinRallyTargetLohar: !features.joinRallyTargetLohar })}
                    >
                      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${features.joinRallyTargetLohar ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                        {features.joinRallyTargetLohar && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      <span className="text-xs text-slate-600">洛哈</span>
                    </label>
                    <label className={`flex items-center gap-1.5 ml-2 ${(features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                      title="体力不足时自动使用体力药水补充；未勾选则跳过本轮">
                      <input type="checkbox" checked={features.joinRallyUsePotion}
                        disabled={features.autoWorldChat}
                        onChange={(e) => setFeatures({ ...features, joinRallyUsePotion: e.target.checked })}
                        className="sr-only peer" />
                      <span className="text-xs text-slate-600 whitespace-nowrap">体力不足使用药水</span>
                      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${features.joinRallyUsePotion ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                        {features.joinRallyUsePotion && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-12">最大距离</span>
                  <input
                    type="number"
                    value={features.joinRallyMaxDistance}
                    onChange={(e) => setFeatures({ ...features, joinRallyMaxDistance: Math.max(1, Number(e.target.value)) })}
                    min={1}
                    max={200}
                    className="w-16 px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700 focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-xs text-slate-400 ml-1">公里</span>
                </div>
              </div>
            </div>

            {/* 自动升级建筑 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border ${(features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :features.upgradeBuildings ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center text-base">🏗️</span>自动升级建筑</span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.upgradeBuildings} disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, upgradeBuildings: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.upgradeBuildings ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.upgradeBuildings ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-2">
                {features.selectedBuildings.map((val: string, i: number) => (
                  <select key={i} value={val} disabled={features.autoWorldChat} onChange={(e) => {
                    const next = [...features.selectedBuildings]; next[i] = e.target.value;
                    const nextCompleted = [...features.completedBuildings]; nextCompleted[i] = false;
                    setFeatures({ ...features, selectedBuildings: next, completedBuildings: nextCompleted });
                  }}
                  className={`px-2 py-1 bg-white rounded text-sm border w-20 ${features.completedBuildings[i] ? 'text-emerald-600 border-emerald-500' : 'border-slate-200'}`}>
                    <option value="">-</option>
                    {buildingOptions.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                ))}
                {features.completedBuildings.some(Boolean) && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      const { selected, completed } = clearCompleted(features.selectedBuildings, features.completedBuildings);
                      loopCompletedBuildings = completed;
                      setFeatures((prev: typeof DEFAULT_FEATURES) => ({ ...prev, selectedBuildings: selected, completedBuildings: completed }));
                    }}
                    className="px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg whitespace-nowrap"
                  >
                    清除已完成
                  </button>
                )}
              </div>
            </div>

            {/* 自动研究科技 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border ${(features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :features.autoResearch ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center text-base">🔬</span>自动研究科技</span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.autoResearch} disabled={features.autoWorldChat}
                    onChange={(e) => {
                      if (e.target.checked && !buildingOptions.includes('学院')) {
                        alert('请在坐标配置页标记学院位置');
                        return;
                      }
                      setFeatures({ ...features, autoResearch: e.target.checked });
                    }}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.autoResearch ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoResearch ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-2">
                {features.selectedTechs.map((val: string, i: number) => (
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
                      loopCompletedTechs = completed;
                      setFeatures((prev: typeof DEFAULT_FEATURES) => ({ ...prev, selectedTechs: selected, completedTechs: completed }));
                    }}
                    className="px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg whitespace-nowrap"
                  >
                    清除已完成
                  </button>
                )}
              </div>
            </div>

            {/* 自动打野 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${(features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' : isFeatureLocked('attackBarbarian') ? 'bg-amber-50/60 border-amber-300 border-dashed' : features.autoAttackBarbarian ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              {isFeatureLocked('attackBarbarian') && (
                <div className="absolute -top-1.5 right-3 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-amber-200 flex items-center gap-1"
                  title="升级到 Pro 解锁">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.37 2.448a1 1 0 00-.364 1.118l1.287 3.957c.3.921-.755 1.688-1.54 1.118l-3.37-2.448a1 1 0 00-1.176 0l-3.37 2.448c-.784.57-1.838-.197-1.539-1.118l1.287-3.957a1 1 0 00-.364-1.118L2.063 9.384c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.95-.69l1.286-3.957z" /></svg>
                  PRO
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${isFeatureLocked('attackBarbarian') ? 'bg-amber-100' : 'bg-orange-100'}`}>⚔️</span>自动打野</span>
                {isFeatureLocked('attackBarbarian') ? (
                  <span className="relative w-10 h-[22px] flex-shrink-0 cursor-not-allowed" title="升级到 Pro 解锁">
                    <span className="absolute inset-0 rounded-full bg-slate-200" />
                    <span className="absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full shadow-sm" />
                  </span>
                ) : (
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${(features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={features.autoAttackBarbarian}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, autoAttackBarbarian: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.autoAttackBarbarian ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoAttackBarbarian ? 'translate-x-[18px]' : ''}`} />
                </label>
                )}
              </div>
              <div className={`flex flex-col mt-2 -mx-4 ${features.autoAttackBarbarian && !isFeatureLocked('attackBarbarian') ? '' : 'opacity-50 pointer-events-none'}`}>
                {/* 野蛮人等级 + 次数 */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100">
                  <span className="text-xs text-slate-500 whitespace-nowrap w-16">野蛮人等级</span>
                  <input type="number" min={1} max={55}
                    value={features.attackBarbarianLevel}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, attackBarbarianLevel: Math.min(55, Math.max(1, Number(e.target.value) || 1)) })}
                    className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs w-20" />
                  <span className="text-xs text-slate-500 whitespace-nowrap ml-3">次数</span>
                  <input type="number" min={1}
                    value={features.attackBarbarianCount}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, attackBarbarianCount: Math.max(1, Number(e.target.value) || 1) })}
                    className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs w-20" />
                </div>

                {/* 派遣队伍 + 队伍页 */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100">
                  <span className="text-xs text-slate-500 whitespace-nowrap w-16">派遣第</span>
                  <select value={features.attackBarbarianTeam}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, attackBarbarianTeam: Number(e.target.value) })}
                    className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs w-14">
                    {[1,2,3,4,5].map(t => (<option key={t} value={t}>{t}</option>))}
                  </select>
                  <span className="text-xs text-slate-700 whitespace-nowrap">队伍</span>
                  <span className="text-xs text-slate-500 whitespace-nowrap ml-3">队伍页</span>
                  {renderTeamPageSelect(features.attackBarbarianTeamPage, (v) => setFeatures({ ...features, attackBarbarianTeamPage: v }), features.autoWorldChat)}
                </div>

                {/* 打野等级范围 */}
                <div className="flex flex-col gap-1 px-4 py-2.5 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 whitespace-nowrap w-16">等级范围</span>
                    <select value={features.attackBarbarianLevelMode}
                      disabled={features.autoWorldChat}
                      onChange={(e) => setFeatures({ ...features, attackBarbarianLevelMode: e.target.value as 'fixed' | 'plusMinus1' | 'plusMinus2' })}
                      className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs">
                      <option value="fixed">固定</option>
                      <option value="plusMinus1">±1</option>
                      <option value="plusMinus2">±2</option>
                    </select>
                  </div>
                  <span className="text-[11px] text-slate-400 pl-6">建议选择加减等级打野，防止一直打同一等级的野怪，跑太远</span>
                </div>

                {/* 循环间隔 */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100">
                  <span className="text-xs text-slate-500 whitespace-nowrap w-16">循环间隔</span>
                  <input type="number" min={1} value={features.attackBarbarianIntervalMinutes}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, attackBarbarianIntervalMinutes: Math.max(1, Number(e.target.value) || 1) })}
                    className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs w-16" />
                  <span className="text-xs text-slate-700 whitespace-nowrap">分钟</span>
                  <span className="text-[11px] text-slate-400">跑完一批后等待多久再打</span>
                </div>

                {/* 循环次数 */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100">
                  <span className="text-xs text-slate-500 whitespace-nowrap w-16">循环次数</span>
                  <input type="number" min={0} value={features.attackBarbarianLoopCount}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, attackBarbarianLoopCount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs w-16" />
                  <span className="text-[11px] text-slate-400">最多打多少批，0 表示无限循环</span>
                </div>

                {/* 使用体力药水 */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100">
                  <label className={`relative inline-flex items-center ${features.autoWorldChat ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                    <input type="checkbox" checked={features.attackBarbarianUsePotion}
                      disabled={features.autoWorldChat}
                      onChange={(e) => setFeatures({ ...features, attackBarbarianUsePotion: e.target.checked })}
                      className="sr-only peer" />
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${features.attackBarbarianUsePotion ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                      {features.attackBarbarianUsePotion && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </label>
                  <span className="text-xs text-slate-500 whitespace-nowrap">行动力不足时使用体力药水</span>
                </div>

                {/* 已开启野蛮人城寨 */}
                <div className="flex flex-col gap-1 px-4 py-2.5 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <label className={`relative inline-flex items-center ${features.autoWorldChat ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                      <input type="checkbox" checked={features.attackBarbarianFortressEnabled}
                        disabled={features.autoWorldChat}
                        onChange={(e) => setFeatures({ ...features, attackBarbarianFortressEnabled: e.target.checked })}
                        className="sr-only peer" />
                      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${features.attackBarbarianFortressEnabled ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                        {features.attackBarbarianFortressEnabled && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                    </label>
                    <span className="text-xs text-slate-500 whitespace-nowrap">已开启野蛮人城寨</span>
                  </div>
                  <span className="text-[11px] text-slate-400 pl-6">新区未开启野蛮人城寨之前，界面不一样，需要取消勾选</span>
                </div>
              </div>
            </div>

            {/* 自动训练兵种 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border ${(features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :features.trainTroops ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-base">⚔️</span>自动训练兵种</span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.trainTroops} disabled={features.autoWorldChat}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const missing = ['兵营', '马厩', '靶场', '攻城武器厂'].filter(b => !buildingOptions.includes(b));
                        if (missing.length > 0) {
                          alert(`请在坐标配置页标记${missing.join('、')}位置`);
                          return;
                        }
                      }
                      setFeatures({ ...features, trainTroops: e.target.checked });
                    }}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.trainTroops ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.trainTroops ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <div className="flex flex-col gap-2 mt-2">
                {(['兵营', '马厩', '靶场', '攻城武器厂'] as const).map(building => {
                  const tier = (features.trainTasks as Record<string, number>)[building] ?? 0;
                  const promote = (features.trainPromote as Record<string, boolean>)[building] ?? false;
                  const promoteDisabled = features.autoWorldChat || tier <= 1;
                  return (
                  <div key={building} className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-20 whitespace-nowrap">{({ 兵营: '⚔️', 马厩: '🐴', 靶场: '🎯', 攻城武器厂: '⚙️' } as Record<string, string>)[building]} {building}</span>
                    <select value={tier} disabled={features.autoWorldChat} onChange={(e) => {
                      const next = { ...features.trainTasks as Record<string, number>, [building]: Number(e.target.value) };
                      setFeatures({ ...features, trainTasks: next });
                    }}
                    className="px-1 py-1 bg-white border border-slate-200 rounded text-xs w-16">
                      <option value={0}>-</option>
                      {TRAIN_TIERS.map(t => (<option key={t} value={t}>T{t}</option>))}
                    </select>
                    <label className={`relative inline-flex items-center gap-1 ml-4 ${promoteDisabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                      <input type="checkbox" checked={promote}
                        disabled={promoteDisabled}
                        onChange={(e) => {
                          const next = { ...features.trainPromote as Record<string, boolean>, [building]: e.target.checked };
                          setFeatures({ ...features, trainPromote: next });
                        }}
                        className="sr-only peer" />
                      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${promote ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                        {promote && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className="text-xs text-slate-500 whitespace-nowrap">晋升</span>
                    </label>
                  </div>
                  );
                })}
              </div>
              <span className="text-[11px] text-slate-400 mt-2">勾选晋升，优先晋升低级兵种</span>
            </div>

            {/* 自动喊话 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${features.autoWorldChat ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center text-base">📢</span>自动喊话</span>
                <label className={`relative w-10 h-[22px] flex-shrink-0 cursor-pointer`}>
                  <input type="checkbox" checked={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, autoWorldChat: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.autoWorldChat ? 'bg-purple-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoWorldChat ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <div className="flex flex-col gap-2 mt-2">
                {features.autoWorldChat && <span className="text-xs px-1.5 py-0.5 bg-purple-500 text-white rounded-full font-medium w-fit">独立模式</span>}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-slate-400">消息内容（轮换发送，空消息自动跳过）</span>
                  {[0, 1, 2].map(i => (
                    <input
                      key={i}
                      type="text"
                      value={features.worldChatMessages?.[i] ?? ''}
                      onChange={(e) => {
                        const msgs = [...(features.worldChatMessages || ['', '', ''])];
                        msgs[i] = e.target.value;
                        setFeatures({ ...features, worldChatMessages: msgs });
                      }}
                      placeholder={`消息 ${i + 1}`}
                      disabled={features.autoWorldChat}
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 whitespace-nowrap">间隔（秒）</span>
                  <input
                    type="number"
                    value={features.worldChatInterval}
                    onChange={(e) => setFeatures({ ...features, worldChatInterval: Number(e.target.value) })}
                    disabled={features.autoWorldChat}
                    min={15}
                    className="w-20 px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                  />
                </div>
              </div>
              {features.autoWorldChat && (
                <p className="text-xs text-slate-400 mt-1">⚠ 喊话模式已开启，其他功能已暂停</p>
              )}
            </div>

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
              <div className="py-2 border-b border-slate-100 last:border-b-0">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="w-6 h-6 bg-sky-100 rounded flex items-center justify-center text-xs">🔬</span>
                    联盟科技捐献
                    <span className="text-xs text-slate-400">仅捐献推荐科技</span>
                  </span>
                  <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                    <input type="checkbox" checked={features.donateAllianceTechEnabled} disabled={features.autoWorldChat}
                      onChange={(e) => setFeatures({ ...features, donateAllianceTechEnabled: e.target.checked })}
                      className="sr-only" />
                    <span className={`absolute inset-0 rounded-full transition-colors ${features.donateAllianceTechEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                    <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.donateAllianceTechEnabled ? 'translate-x-[18px]' : ''}`} />
                  </label>
                </div>
                {/* 次级选项：0点之后捐献 */}
                <div className={`flex items-center gap-2 mt-2 pl-8 ${(features.donateAllianceTechEnabled && !features.autoWorldChat) ? '' : 'opacity-50 pointer-events-none'}`}>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={features.donateAfterMidnight}
                      disabled={!features.donateAllianceTechEnabled || features.autoWorldChat}
                      onChange={(e) => setFeatures({ ...features, donateAfterMidnight: e.target.checked })}
                      className="sr-only peer" />
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${features.donateAfterMidnight ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                      {features.donateAfterMidnight && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </label>
                  <span className="text-xs text-slate-500 whitespace-nowrap">0点之后捐献</span>
                </div>
              </div>
            </div>

            {/* 社交与辅助 */}
            <div className="flex flex-col gap-0 p-4 rounded-lg transition-colors border border-slate-200 hover:border-slate-300">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-base">📋</span>
                <span className="font-semibold text-sm text-slate-800">社交与辅助</span>
              </div>
              {/* 自动开盾（受攻击时触发） */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0"
                title="受到攻击自动开盾，如果正在执行任务，会等任务结束后开盾">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-red-100 rounded flex items-center justify-center text-xs">🛡️</span>
                  自动开盾
                </span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.attackDetectEnabled}
                    onChange={(e) => setFeatures({
                      ...features,
                      attackDetectEnabled: e.target.checked,
                      autoShieldEnabled: e.target.checked,
                    })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.attackDetectEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.attackDetectEnabled ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              {/* 自动收集资源 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-emerald-100 rounded flex items-center justify-center text-xs">📦</span>
                  自动收集资源
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={MIN_COLLECT_RESOURCES_INTERVAL_MINUTES}
                    step={1}
                    value={features.collectResourcesIntervalMinutes}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({
                      ...features,
                      collectResourcesIntervalMinutes: Math.max(MIN_COLLECT_RESOURCES_INTERVAL_MINUTES, Number(e.target.value) || MIN_COLLECT_RESOURCES_INTERVAL_MINUTES),
                    })}
                    className="w-16 px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                  />
                  <span className="text-xs text-slate-400">分钟</span>
                  <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                    <input type="checkbox" checked={features.collectResources} disabled={features.autoWorldChat}
                      onChange={(e) => setFeatures({ ...features, collectResources: e.target.checked })}
                      className="sr-only" />
                    <span className={`absolute inset-0 rounded-full transition-colors ${features.collectResources ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                    <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.collectResources ? 'translate-x-[18px]' : ''}`} />
                  </label>
                </div>
              </div>
              {/* 断线重连 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-sky-100 rounded flex items-center justify-center text-xs">🔌</span>
                  断线
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={features.autoReconnectIntervalMinutes}
                    disabled={features.autoWorldChat}
                    onChange={(e) => setFeatures({
                      ...features,
                      autoReconnectIntervalMinutes: Math.max(0, Number(e.target.value) || 0),
                    })}
                    className="w-16 px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                  />
                  分钟后重连
                  <span className="text-xs text-slate-400">（0表示不重连）</span>
                </span>
              </div>
              {/* 迷雾探索 */}
              <div className="flex items-center justify-between py-2">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-cyan-100 rounded flex items-center justify-center text-xs">🗺️</span>
                  迷雾探索
                </span>
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${(features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={features.autoExplore}
                    disabled={features.autoWorldChat}
                    onChange={(e) => {
                      if (e.target.checked && !buildingOptions.includes('斥候营地')) {
                        alert('请在坐标配置页标记斥候营地位置');
                        return;
                      }
                      setFeatures({ ...features, autoExplore: e.target.checked });
                    }}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.autoExplore ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoExplore ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              {/* 山洞探索 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-amber-100 rounded flex items-center justify-center text-xs">🏔️</span>
                  山洞探索
                </span>
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${(features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={features.autoCaveExplore}
                    disabled={features.autoWorldChat}
                    onChange={(e) => {
                      if (e.target.checked && !buildingOptions.includes('斥候营地')) {
                        alert('请在坐标配置页标记斥候营地位置');
                        return;
                      }
                      setFeatures({ ...features, autoCaveExplore: e.target.checked });
                    }}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.autoCaveExplore ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoCaveExplore ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              {/* 生产装备材料 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-orange-100 rounded flex items-center justify-center text-xs">⚒️</span>
                  生产装备材料
                  <select
                    value={features.produceMaterialType}
                    disabled={features.autoWorldChat || !features.produceMaterialEnabled}
                    onChange={(e) => setFeatures({ ...features, produceMaterialType: e.target.value as 'leather' | 'iron' | 'ebony' | 'bone' })}
                    className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-xs disabled:opacity-50"
                  >
                    <option value="leather">皮革</option>
                    <option value="iron">铁矿石</option>
                    <option value="ebony">乌木</option>
                    <option value="bone">兽骨</option>
                  </select>
                </span>
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${(features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={features.produceMaterialEnabled}
                    disabled={features.autoWorldChat}
                    onChange={(e) => {
                      if (e.target.checked && !buildingOptions.includes('铁匠铺')) {
                        alert('请在坐标配置页标记铁匠铺位置');
                        return;
                      }
                      setFeatures({ ...features, produceMaterialEnabled: e.target.checked });
                    }}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.produceMaterialEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.produceMaterialEnabled ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center text-sm">📋</span>
              <h3 className="text-lg font-bold text-slate-800">运行日志</h3>
            </div>
            <Link to="/tasks" className="text-xs text-slate-400 hover:text-emerald-600">调试</Link>
          </div>
          <div ref={logContainerRef} className="bg-slate-900 rounded-xl p-4 h-80 overflow-y-auto font-mono text-sm">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <span className="text-2xl opacity-30">📝</span>
                <p className="text-slate-500 text-sm">等待开始运行...</p>
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="py-0.5 text-slate-400">{log}</div>
              ))
            )}
          </div>
        </div>
      </div>
      {remoteCodeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setRemoteCodeModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">📱 手机远程访问</h3>
            {remoteInfoLoading ? (
              <p className="text-center py-8 text-slate-500">加载中...</p>
            ) : remoteInfoError ? (
              <p className="text-red-500 text-sm py-4">{remoteInfoError}</p>
            ) : remoteInfo ? (
              <>
                <p className="text-sm text-slate-600 mb-2">本机识别码</p>
                <div className="text-3xl font-mono text-center py-4 bg-emerald-50 rounded-lg tracking-widest text-emerald-700 mb-4 select-all">
                  {remoteInfo.shortId.replace(/(.{3})(.{3})(.{3})/, '$1-$2-$3')}
                </div>
                <p className="text-sm text-slate-600 mb-2">访问密码</p>
                <div className="flex items-center justify-between bg-slate-100 rounded-lg px-4 py-3 mb-4">
                  <span className="font-mono text-slate-700">
                    {remoteInfo.hasPassword ? '●●●●●●（已设置）' : '尚未设置'}
                  </span>
                  <button
                    onClick={() => { setPasswordInput(''); setPasswordError(''); setPasswordModal(true); }}
                    className="text-emerald-600 text-sm hover:underline"
                  >
                    {remoteInfo.hasPassword ? '修改' : '设置'}
                  </button>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  在手机浏览器打开 <span className="font-mono text-slate-700">http://106.15.11.158:3456/mobile/</span>，
                  输入识别码和访问密码即可登录。登录后 30 天内使用自动续期。
                </p>
              </>
            ) : null}
            <button
              onClick={() => setRemoteCodeModal(false)}
              className="w-full mt-6 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm"
            >
              关闭
            </button>
          </div>
        </div>
      )}
      {passwordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          onClick={() => setPasswordModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">
              {remoteInfo?.hasPassword ? '修改访问密码' : '设置访问密码'}
            </h3>
            <p className="text-sm text-slate-600 mb-3">请输入 6 位数字密码</p>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={6}
              value={passwordInput}
              onChange={e => setPasswordInput(e.target.value.replace(/\D/g, ''))}
              placeholder="●●●●●●"
              autoFocus
              className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-lg text-center text-2xl tracking-widest"
            />
            {passwordError && <p className="text-red-500 text-sm mt-2">{passwordError}</p>}
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setPasswordModal(false)}
                disabled={passwordSaving}
                className="flex-1 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm"
              >
                取消
              </button>
              <button
                onClick={handleSavePassword}
                disabled={passwordSaving || passwordInput.length !== 6}
                className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white rounded-lg text-sm"
              >
                {passwordSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
