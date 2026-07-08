import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAccount } from '../contexts/AccountContext';
import { useLicense } from '../contexts/LicenseContext';
import { DEFAULT_HOME_FEATURES, DEFAULT_COLLECT_RESOURCES_INTERVAL_MINUTES, MIN_COLLECT_RESOURCES_INTERVAL_MINUTES, DEFAULT_AUTO_RECONNECT_INTERVAL_MINUTES, TeamPageChoice, getCollectResourcesIntervalSeconds } from '../../../plugins/rok/homeFeatures';
import { remoteApi } from '../api/remote';

// Electron 打包后 HTML 走 file://，相对路径 /api 会失败；必须显式指向本地后端
const IS_ELECTRON = typeof window !== 'undefined' && 'electronAPI' in window;
const LOCAL_API_BASE = IS_ELECTRON ? 'http://localhost:3000' : '';

// Module-level loop state — survives component unmount/remount during SPA navigation
let loopStopped = false;
let loopRunning = false;
let loopLogs: string[] = [];
let loopCompletedBuildings: boolean[] = [false, false, false, false, false];
let loopCompletedTechs: boolean[] = [false, false, false, false, false];
let deviceBusy = false;
let attackPreempt = false;   // 攻击检测抢占旗：其它子循环 acquireLock 时让路
const GATHER_LOOP_INTERVAL = 300; // 城外采集独立循环间隔（秒）
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
let pendingAccountSwitch = false;    // 切号触发 flag：per-round 每轮末尾置 true；per-time setTimeout 到点置 true
let switchTargetIdx = 0;             // 下一个要切到的 profile 索引（0 或 1）
let switchTimerId: ReturnType<typeof setTimeout> | null = null;

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
  const { status: licenseStatus, refreshStatus, setExpiredMessage } = useLicense();
  const isPro = licenseStatus?.tier === 'pro';
  const PRO_FEATURES = ['gemGather', 'autoSwitch', 'joinRally'];
  const isFeatureLocked = (featureId: string) => !isPro && PRO_FEATURES.includes(featureId);
  const [activeConfigName, setActiveConfigName] = useState('');
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [loopRunningState, setLoopRunningState] = useState(false);
  const [taskRunning, setTaskRunning] = useState(false);
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

  const loadFeatures = () => {
    try {
      const saved = localStorage.getItem('home-features');
      if (saved) {
        const parsed = JSON.parse(saved);
        // 迁移旧版 trainTasks 数组格式 → Record 格式
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
        if (typeof merged.rallyFortDowngrade !== 'boolean') merged.rallyFortDowngrade = DEFAULT_FEATURES.rallyFortDowngrade;
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
  const [showGemSearchWeights, setShowGemSearchWeights] = useState(true);
  const featuresRef = useRef(features);
  featuresRef.current = features;

  const featuresToPersist = (f: typeof DEFAULT_FEATURES): typeof DEFAULT_HOME_FEATURES => {
    const { completedBuildings, completedTechs, ...rest } = f;
    return rest;
  };

  const [configNames, setConfigNames] = useState<string[]>([]);
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
  const RESOURCE_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8];
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

  // 恢复运行状态：挂载时检查 module-level 变量和 API 确认是否有正在执行的任务
  useEffect(() => {
    if (!currentAccountId) return;

    // 如果 module-level loopRunning 已为 true，立即恢复 UI 状态
    if (loopRunning) {
      setTaskRunning(true);
      setLogs(loopLogs);
    }

    // 通过 API 同步 runningTaskIds（用于停止按钮能取消正确的任务）
    api.tasks.list().then(res => {
      if (res.success) {
        const running = res.tasks.filter(t => t.accountId === currentAccountId && t.status === 'running');
        if (running.length > 0) {
          loopRunning = true;
          setLoopRunningState(true);
          loopStopped = false;
          runningTaskIdsRef.current = running.map(t => t.id);
          setTaskRunning(true);
          setRunningTaskIds(running.map(t => t.id));
        }
      }
    }).catch(() => {});
  }, [currentAccountId]);

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

  // On mount + account change: load features from config, migrate from localStorage if needed
  useEffect(() => {
    if (!currentAccountId) return;
    (async () => {
      try {
        const res = await api.config.getRokConfig(currentAccountId);
        if (res.success && res.config?.homeFeatures) {
          setFeatures((prev: typeof DEFAULT_FEATURES) => padGatherTasks({
            ...DEFAULT_HOME_FEATURES,
            ...res.config.homeFeatures,
            gemGatherMode: migrateGemMode(res.config.homeFeatures),
            completedBuildings: prev.completedBuildings,
            completedTechs: prev.completedTechs,
          }));
        } else {
          // One-shot migration: save current localStorage features to config
          setFeatures((prev: typeof DEFAULT_FEATURES) => {
            api.config.saveRokConfig(currentAccountId, { homeFeatures: featuresToPersist(prev) }, activeConfigName || '默认配置').catch(() => {});
            return prev;
          });
        }
      } catch {}
      try {
        const pRes = await api.config.getProfiles(currentAccountId);
        if (pRes.success) {
          setConfigNames(pRes.profiles);
          if (!activeConfigName) setActiveConfigName(pRes.active);
        }
      } catch {}
    })();
  }, [currentAccountId]);

  const handleConfigSwitch = async (newName: string) => {
    if (!currentAccountId || newName === activeConfigName) return;
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
        setFeatures(padGatherTasks({
          ...DEFAULT_HOME_FEATURES,
          ...res.config.homeFeatures,
          gemGatherMode: migrateGemMode(res.config.homeFeatures),
          completedBuildings: [false, false, false, false, false],
          completedTechs: [false, false, false, false, false],
        }));
      } else {
        setFeatures({ ...DEFAULT_FEATURES });
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
        setTaskRunning(false);
        setRunningTaskIds([]);
      }
    } catch (e) {
      console.error('连接失败', e);
    }
    setDeviceLoading(false);
  };

  const handleStartAll = async (source: 'local' | 'remote' = 'local') => {
    if (!currentAccountId) {
      pushLog(`❌ 未选择账号`);
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
      (features.gemGatherEnabled && (features.gemGatherEnabled && features.gemGatherMode === 'focus')) ||
      (features.gemGatherEnabled && features.gemGatherTeams.some((t: number) => t)) ||
      features.autoCaveExplore ||
      features.helpTeammates ||
      features.collectResources ||
      features.joinRallyEnabled ||
      features.produceMaterialEnabled ||
      features.attackDetectEnabled;
    if (!hasAnyFeature) {
      alert('请先开启至少一个功能再运行');
      return;
    }

    if (loopRunning) return;

    loopRunning = true;
    setLoopRunningState(true);
    loopStopped = false;
    saveLoopState(currentAccountId);
    setTaskRunning(true);

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

    const isExploreMode = features.autoExplore;
    const isWorldChatMode = features.autoWorldChat;
    const interval = isExploreMode ? 60 : isWorldChatMode ? features.worldChatInterval : GATHER_LOOP_INTERVAL;
    clearLoopState();
    nightStartOffsetMinutes = randomBiasedOffset(NIGHT_START_JITTER_MIN, NIGHT_START_JITTER_MAX);
    nightEndOffsetMinutes = randomBiasedOffset(NIGHT_END_JITTER_MIN, NIGHT_END_JITTER_MAX);
    const modeLabel = isExploreMode ? '迷雾探索' : isWorldChatMode ? '自动喊话' : '自动循环';
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const resetAllCooldowns = () => {
      // 切号后新号所有子任务都要从头跑，等价于重启循环：
      bottomBarChecked = false;
      relaunchRequested = true;    // 让宝石 active/rest 循环 break 出去重新开始
      moduleGemInitialCount = null;
      moduleGemCollectedCount = 0;
      moduleGemRestActive = false;
    };

    const sleep = async (s: number) => new Promise(r => setTimeout(r, s * 1000));

    const acquireLock = async (): Promise<boolean> => {
      while ((deviceBusy || attackPreempt) && !loopStopped) { await sleep(0.3); }
      if (loopStopped) return false;
      deviceBusy = true;
      return true;
    };
    const releaseLock = () => { deviceBusy = false; };

    // 攻击检测专用锁：不受 attackPreempt 阻塞（自己就是抢占方）
    const acquireLockForAttack = async (): Promise<boolean> => {
      while (deviceBusy && !loopStopped) { await sleep(0.3); }
      if (loopStopped) return false;
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
        const cr = await api.tasks.create(currentAccountId, 'com.rok.automation', 'check-game-running');
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
        while (!loopStopped && (monotonicNow() - startWait) < waitMs) {
          await sleep(1);
        }
        if (loopStopped) return;

        const msg2 = `🎮 尝试拉起游戏`;
        console.log(`[ensureGameRunning] ${msg2}`);
        pushLog(`${msg2}`);
        const lr = await api.tasks.create(currentAccountId, 'com.rok.automation', 'launch-game');
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

      // 重置队列速览过滤状态（每次开始运行时重新检查）
      (async () => {
        const r = await api.tasks.create(currentAccountId, 'com.rok.automation', 'read-queue-overview', { reset: true });
        if (r.success) {
          await api.tasks.run(r.task.id);
        }
      })().catch(() => {});

      // 城外采集独立循环 — 按固定间隔执行，不受 OCR 调度影响
      const gatherLoop = (async () => {
        let first = true;
        while (!loopStopped) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (features.gatherResources && !features.autoExplore && !features.autoWorldChat) {
            const gatherTasks = features.gatherTasks
              .map((t: { type: string; level: number }, i: number) => ({ ...t, team: i + 1 }))
              .filter((t: { type: string; level: number; team: number }) => t.type);
            if (gatherTasks.length > 0) {
              if (!await acquireLock()) break;
              if (offlineActive) { releaseLock(); await sleep(30); continue; }
              await ensureGameRunning();
              try {
                const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', 'gather-resources', { gatherTasks, teamPage: features.resourceGatherTeamPage });
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
                  }
                }
              } catch {} finally { releaseLock(); }
            }
          }
          const jitteredInterval = GATHER_LOOP_INTERVAL * (0.85 + Math.random() * 0.3);
          const startWait = monotonicNow();
          while (!loopStopped && (monotonicNow() - startWait) < jitteredInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      // 帮助盟友独立循环 — 每 60s
      const helpLoop = (async () => {
        let first = true;
        while (!loopStopped) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (features.helpTeammates && !features.autoExplore && !features.autoWorldChat) {
            if (!await acquireLock()) break;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            try {
              const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', 'help-teammates');
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
                }
              }
            } catch {} finally { releaseLock(); }
          }
          const helpInterval = 60 * (0.85 + Math.random() * 0.3); // 51-69s
          const startWait = monotonicNow();
          while (!loopStopped && (monotonicNow() - startWait) < helpInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      // 收集资源独立循环 — 按用户设置间隔执行，并叠加随机抖动
      const collectLoop = (async () => {
        let first = true;
        while (!loopStopped) {
          if (first) { first = false; continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (features.collectResources && !features.autoExplore && !features.autoWorldChat) {
            if (!await acquireLock()) break;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            try {
              const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', 'collect-resources');
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
                }
              }
            } catch {} finally { releaseLock(); }
          }
          const collectInterval = getCollectResourcesIntervalSeconds(features.collectResourcesIntervalMinutes);
          const startWait = monotonicNow();
          while (!loopStopped && (monotonicNow() - startWait) < collectInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      // 攻打城寨独立循环 — 每 10min
      const rallyLoop = (async () => {
        let first = true;
        while (!loopStopped) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (features.autoRallyFort && features.rallyFortLevel > 0 && !features.autoExplore && !features.autoWorldChat) {
            if (loopStopped) break;
            if (!await acquireLock()) break;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            let cd = 600; // 默认 CD，实际根据结果确定
            try {
              const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', 'rally-fort', { level: features.rallyFortLevel, team: features.rallyFortTeam, downgrade: features.rallyFortDowngrade, teamPage: features.rallyFortTeamPage });
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
                  pushLog(`${isSuccess ? '✅' : isStamina ? '🔋' : '⚠️'} 城寨 Lv.${features.rallyFortLevel} 队伍${features.rallyFortTeam} ${isSuccess ? '集结成功' : isStamina ? '行动力不足' : '未找到城寨'}，CD ${cdLabel}`);
                }
              }
            } catch {} finally { releaseLock(); }
            if (loopStopped) break;
            const cdJitter = cd * (0.85 + Math.random() * 0.3);
            pushLog(`🏰 城寨完成，${cdJitter.toFixed(0)} 秒后下一轮`);
            const startWait = monotonicNow();
            while (!loopStopped && (monotonicNow() - startWait) < cdJitter * 1000) {
              await sleep(1);
            }
          } else {
            // 未开启城寨功能，长时间休眠避免空转
            await sleep(60);
          }
        }
      })();

      // 加入集结独立循环 — 每 5min
      (async () => {
        let first = true;
        let firstRun = true;
        while (!loopStopped) {
          if (first) { first = false; await sleep(15); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (features.joinRallyEnabled && !features.autoExplore && !features.autoWorldChat) {
            if (loopStopped) break;
            if (!await acquireLock()) break;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            let cd = 300; // 默认 CD 5 分钟
            try {
              const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', 'join-rally', {
                team: features.joinRallyTeam,
                teamPage: features.joinRallyTeamPage,
                targetFort: features.joinRallyTargetFort,
                targetLohar: features.joinRallyTargetLohar,
                maxDistance: features.joinRallyMaxDistance,
                firstRun,
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
                // 根据结果确定 CD：成功 10 分钟，无空闲队伍 2 分钟，其他失败 3 分钟
                const isSuccess = logs.some((l: string) => l.includes('→ success'));
                const isNoIdle = logs.some((l: string) => l.includes('→ no_idle_teams'));
                const isDistanceExceed = logs.some((l: string) => l.includes('→ distance_exceed'));
                if (isSuccess) {
                  cd = 600; // 10 分钟
                } else if (isNoIdle) {
                  cd = 120; // 2 分钟
                } else if (isDistanceExceed) {
                  cd = 180; // 3 分钟
                } else {
                  cd = 180; // 3 分钟
                }
                if (hasExpiredLog) {
                  pushLog(`⛔ 许可证已到期，停止运行`);
                  loopStopped = true;
                  setExpiredMessage('激活码已到期，请重新激活');
                  refreshStatus();
                } else {
                  const cdLabel = isSuccess ? '10分钟' : isNoIdle ? '2分钟' : '3分钟';
                  const targetLabel = (features.joinRallyTargetFort && features.joinRallyTargetLohar) ? '城寨/洛哈' : features.joinRallyTargetFort ? '城寨' : '洛哈';
                  pushLog(`${isSuccess ? '✅' : isNoIdle ? '⏸️' : isDistanceExceed ? '📍' : '⚠️'} 加入${targetLabel}集结 队伍${features.joinRallyTeam} ${isSuccess ? '成功' : isNoIdle ? '无空闲队伍' : isDistanceExceed ? '超出距离' : '无可用集结'}，CD ${cdLabel}`);
                }
                firstRun = false; // 首次执行完后标记为非首次
              }
            } catch {} finally { releaseLock(); }
            if (loopStopped) break;
            const cdJitter = cd * (0.85 + Math.random() * 0.3);
            pushLog(`🤝 加入集结完成，${cdJitter.toFixed(0)} 秒后下一轮`);
            const startWait = monotonicNow();
            while (!loopStopped && (monotonicNow() - startWait) < cdJitter * 1000) {
              await sleep(1);
            }
          } else {
            await sleep(60);
          }
        }
      })();

      // 山洞探索独立循环
      const caveLoop = (async () => {
        let first = true;
        // 循环开始前重置山洞探索状态
        try {
          await api.tasks.create(currentAccountId, 'com.rok.automation', 'reset-cave-explore')
            .then(r => { if (r.success) return api.tasks.run(r.task.id); });
        } catch {}
        while (!loopStopped) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (features.autoCaveExplore && !features.autoExplore && !features.autoWorldChat) {
            if (!buildingOptions.includes('斥候营地')) {
              pushLog(`⚠️ 未标记斥候营地位置，跳过山洞探索`);
            } else {
              if (!await acquireLock()) break;
              if (offlineActive) { releaseLock(); await sleep(30); continue; }
              await ensureGameRunning();
              try {
                const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', 'cave-explore');
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
                  }
                }
              } catch {} finally { releaseLock(); }
            }
          }
          const caveInterval = 120 * (0.85 + Math.random() * 0.3);
          const startWait = monotonicNow();
          while (!loopStopped && (monotonicNow() - startWait) < caveInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      // 攻击检测独立循环 — 5s 一次，不抢锁；命中后抬旗抢占其它循环，再执行开盾
      const attackLoop = (async () => {
        let first = true;
        while (!loopStopped) {
          if (first) { first = false; await sleep(5); continue; }
          if (offlineActive) { await sleep(30); continue; }
          const f = featuresRef.current;
          if (!f.attackDetectEnabled) { await sleep(5); continue; }

          // [1] 纯检测：不抢锁，直接跑 check-attack
          let attacked = false;
          try {
            const cr = await api.tasks.create(currentAccountId, 'com.rok.automation', 'check-attack');
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
              const cr2 = await api.tasks.create(currentAccountId, 'com.rok.automation', 'auto-shield');
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
                    await sleep(2 * 60 * 60);
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
        while (!loopStopped) {
          if (first) { first = false; await sleep(10); continue; }
          if (offlineActive) { await sleep(30); continue; }
          if (!features.produceMaterialEnabled || features.autoExplore || features.autoWorldChat) {
            await sleep(30);
            continue;
          }
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
          // 已尝试执行本轮，等 2~4 小时随机再触发下一次
          const intervalSec = (2 + Math.random() * 2) * 3600;
          const startWait = monotonicNow();
          while (!loopStopped && (monotonicNow() - startWait) < intervalSec * 1000) {
            await sleep(1);
          }
        }
      })();

      // 下线监控独立循环 — 每 30s 检查一次，边沿触发 kill / launch
      const offlineLoop = (async () => {
        while (!loopStopped) {
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
            offlineActive = true;
            lastOfflineState = true;
            if (await acquireLock()) {
              try {
                const r = await api.tasks.create(currentAccountId, 'com.rok.automation', 'kill-game');
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
                const r = await api.tasks.create(currentAccountId, 'com.rok.automation', 'launch-game');
                if (r.success) {
                  runningTaskIdsRef.current = [...runningTaskIdsRef.current, r.task.id];
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                  await api.tasks.run(r.task.id);
                  runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== r.task.id);
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                }
              } catch {} finally { releaseLock(); }
            }
            offlineActive = false;
            lastOfflineState = false;
            // 游戏重启后界面已变化，强制主循环重新检查底部菜单栏
            bottomBarChecked = false;
            // 上线等价于重新点开始运行：通知各子循环重置状态、从头开始
            relaunchRequested = true;
          }

          // 等 30s 再检查（中途循环停止可立即退出）
          const startWait = monotonicNow();
          while (!loopStopped && (monotonicNow() - startWait) < 30000) {
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
            const res = await api.tasks.create(currentAccountId, 'com.rok.automation', 'read-gem-count');
            if (!res.success) { console.error('[readCount] create failed', res); return null; }
            const run = await api.tasks.run(res.task.id);
            const logs = run.task?.logs ?? [];
            const line = logs.find((l: string) => /\[GEM-COUNT\]\s+\d+/.test(l));
            if (!line) return null;
            const m = line.match(/\[GEM-COUNT\]\s+(\d+)/);
            return m ? parseInt(m[1], 10) : null;
          } catch (e) { console.error('[readCount] error:', e); return null; }
        };

        while (!loopStopped) {
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
          if (!f.gemGatherEnabled || f.gemGatherTeams.length === 0 || f.autoExplore || f.autoWorldChat) {
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

          while (!loopStopped && !relaunchRequested && monotonicNow() < activeEnd) {
            if (offlineActive) { await sleep(30); continue; }
            if (!await acquireLock()) break;
            if (offlineActive) { releaseLock(); await sleep(30); continue; }
            await ensureGameRunning();
            const isFocus = Math.random() < focusRatio;
            const actionId = isFocus ? 'gem-gather-focus' : 'gem-gather';
            const intervalSec = isFocus ? 60 : 300;
            // 更新下一轮概率（仅混合模式）：驻扎 -0.2(1-p)、普通 +0.4p，clamp [0, 1]
            if (mode === 'mixed') {
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

              pushLog(`💎 [DEBUG] maxDistance=${f.gemGatherMaxDistance}`);
              const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', actionId, { teams: f.gemGatherTeams, teamPage: f.gemGatherTeamPage, searchWeights: f.gemSearchWeights, maxDistance: f.gemGatherMaxDistance });
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
                  pushLog(`💎 宝石采集(${isFocus ? '驻扎' : '普通'})完成`);
                }
              }
            } catch {} finally { releaseLock(); }

            if (loopStopped) break;
            if (monotonicNow() >= activeEnd) break;
            const wait = intervalSec * (0.85 + Math.random() * 0.3);
            const startWait = monotonicNow();
            while (!loopStopped && (monotonicNow() - startWait) < wait * 1000 && monotonicNow() < activeEnd) {
              await sleep(1);
            }
          }
          if (loopStopped) break;
          // 上线重置请求：跳过 rest，回到外层 while 顶部重置状态、重新开始采集
          if (relaunchRequested) continue;

          // ── rest 阶段（普通+专注共用，触发下线）──
          const restDurationMs = restHours * 3600 * 1000;
          const restEnd = monotonicNow() + restDurationMs;
          const restEndWall = Date.now() + restDurationMs;
          moduleGemRestActive = true;
          pushLog(`💤 宝石采集休息 ${restHours}h，${new Date(restEndWall).toLocaleTimeString()} 恢复`);
          while (!loopStopped && !relaunchRequested && monotonicNow() < restEnd) {
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
      const hasMainWork = features.autoExplore || features.autoWorldChat || features.upgradeBuildings || features.autoResearch || features.trainTroops;
      if (!hasMainWork) {
        pushLog(`ℹ️ 未启用建筑/科技/训练，主循环跳过`);
      }
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
                const cfgRes = await api.config.getRokConfig(currentAccountId, nextProfile);
                const targetName = (cfgRes.config as any)?.accountSwitch?.accountName || '';
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
        saveLoopState(currentAccountId);


        const handleLicenseExpired = () => {
          pushLog(`⛔ 许可证已到期，停止运行`);
          loopStopped = true;
          setExpiredMessage('激活码已到期，请重新激活');
          refreshStatus();
        };

        const runTask = async (actionId: string, config?: Record<string, any>): Promise<string[]> => {
          if (loopStopped) return [];
          try {
            const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', actionId, config);
            if (createResult.success) {
              runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
              setRunningTaskIds([...runningTaskIdsRef.current]);
              const runResult = await api.tasks.run(createResult.task.id);
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

        // 探索模式：与其他任务互斥，只执行探索
        if (features.autoExplore) {
          if (!buildingOptions.includes('斥候营地')) {
            pushLog(`⚠️ 未标记斥候营地位置，跳过迷雾探索`);
          } else {
            if (await acquireLock()) {
              try { if (!offlineActive) await runTask('explore', { maxScouts: features.exploreCount }); }
              finally { releaseLock(); }
            }
          }
          if (loopStopped) break;
          // 探索模式下固定 1 分钟后检查
          const exploreNextWake = 30 + Math.random() * 15;
          pushLog(`🔍 探索模式，下次检查 ${exploreNextWake.toFixed(0)} 秒后`);
          const exploreDragSafety = 5;
          const exploreDragWindow = exploreNextWake - exploreDragSafety;
          if (exploreDragWindow > 20 && Math.random() < 0.05) {
            const dragDelay = 5 + Math.random() * (exploreDragWindow * 0.7);
            const exploreStartWait = monotonicNow();
            while (!loopStopped && (monotonicNow() - exploreStartWait) < dragDelay * 1000) {
              await sleep(1);
            }
            if (!loopStopped) {
              if (await acquireLock()) {
                try { if (!offlineActive) await runTask('idle-drag'); } catch {} finally { releaseLock(); }
              }
            }
            while (!loopStopped && (monotonicNow() - exploreStartWait) < exploreNextWake * 1000) {
              await sleep(1);
            }
          } else {
            await sleep(exploreNextWake);
          }
          if (loopStopped) break;
          continue;
        }

        // 喊话模式：与其他任务互斥，只执行世界喊话
        if (features.autoWorldChat) {
          const messages = (features.worldChatMessages || []).filter((m: string) => m.trim());
          if (messages.length === 0) {
            pushLog(`⚠️ 未填写喊话内容，跳过`);
            loopStopped = true;
            break;
          }

          while (!loopStopped && features.autoWorldChat) {
            // 一轮：依次发送所有消息，每条间隔 15s
            for (let i = 0; i < messages.length && !loopStopped; i++) {
              // 第一条不等，后续等 15s
              if (i > 0) {
                pushLog(`📢 下一条消息 15 秒后`);
                await sleep(15);
              }

              if (loopStopped) break;

              if (await acquireLock()) {
                try { if (!offlineActive) await runTask('send-world-chat', { message: messages[i], isFirst: i === 0 && true }); }
                finally { releaseLock(); }
              }
            }

            if (loopStopped) break;

            // 一轮结束，等 CD
            const cd = features.worldChatInterval || 300;
            const cdJitter = cd * (0.85 + Math.random() * 0.3);
            pushLog(`📢 一轮喊话完成，${cdJitter.toFixed(0)} 秒后开始下一轮`);

            const cdStartWait = monotonicNow();
            const dragSafety = 5;
            const dragWindow = cdJitter - dragSafety;
            if (dragWindow > 20 && Math.random() < 0.05) {
              const dragDelay = 5 + Math.random() * (dragWindow * 0.7);
              while (!loopStopped && (monotonicNow() - cdStartWait) < dragDelay * 1000) {
                await sleep(1);
              }
              if (!loopStopped) {
                if (await acquireLock()) {
                  try { if (!offlineActive) await runTask('idle-drag'); } catch {} finally { releaseLock(); }
                }
              }
              while (!loopStopped && (monotonicNow() - cdStartWait) < cdJitter * 1000) {
                await sleep(1);
              }
            } else {
              await sleep(cdJitter);
            }
          }
          if (loopStopped) break;
          continue;
        }

        let latestTimers: ReturnType<typeof parseOcrResult>;
        let dispatchedAny = false;

        // 获取设备锁，执行 OCR + 派发
        if (loopStopped) break;
        if (!await acquireLock()) {
          if (loopStopped) break;
          continue;
        }
        if (offlineActive) { releaseLock(); await sleep(30); continue; }
        try {
        // Step 1: OCR 队列倒计时
        const ocrLogs = await runTask('read-queue-overview');
        const timers = parseOcrResult(ocrLogs);

        if (loopStopped) break;

        // Step 2: 执行到期/就绪的 action
        const hasUpgrade = features.upgradeBuildings &&
          features.selectedBuildings.some((b: string, i: number) => b && !loopCompletedBuildings[i]);
        const hasResearch = features.autoResearch &&
          features.selectedTechs.some((t: string, i: number) => t && !loopCompletedTechs[i]);
        const hasTrain = features.trainTroops &&
          (Object.values(features.trainTasks as Record<string, number>) as number[]).some((v: number) => v > 0);

        if (hasUpgrade && (timers.build1 === null || timers.build1! <= 0 || timers.build2 === null || timers.build2! <= 0)) {
          const targetBuildings = features.selectedBuildings
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
            features.selectedBuildings.forEach((b: string, i: number) => {
              if (b && !loopCompletedBuildings[i] && (successCounts[b] || 0) > 0) {
                successCounts[b]--;
                loopCompletedBuildings[i] = true;
                changed = true;
              }
            });
            if (changed) setFeatures((prev: typeof features) => ({ ...prev, completedBuildings: [...loopCompletedBuildings] }));
          }
        }

        if (loopStopped) break;

        if (hasResearch && (timers.research === null || timers.research! <= 0)) {
          if (!buildingOptions.includes('学院')) {
            pushLog(`⚠️ 未标记学院位置，跳过研究科技`);
          } else if (timers.build1Building === '学院' || timers.build2Building === '学院') {
            pushLog(`🏗️ 学院正在升级中，跳过研究科技`);
          } else {
            const techs = features.selectedTechs.filter((t: string, i: number) => t && !loopCompletedTechs[i]);
            if (techs.length > 0) {
              const logs = await runTask('research-tech-queue', { targetTechs: techs, researchBuilding: '学院' });
              dispatchedAny = true;
              let changed = false;
              const techSuccessCounts: Record<string, number> = {};
              for (const l of logs) {
                const m = l.match(/✅ (.+?) 研究成功/);
                if (m) techSuccessCounts[m[1]] = (techSuccessCounts[m[1]] || 0) + 1;
              }
              features.selectedTechs.forEach((t: string, i: number) => {
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

        if (loopStopped) break;

        if (hasTrain) {
          const trainTimerMap: Record<string, number | null> = {
            '兵营': timers.train_bingying,
            '马厩': timers.train_majiu,
            '靶场': timers.train_bachang,
            '攻城武器厂': timers.train_gongcheng,
          };
          const tasks = features.trainTasks as Record<string, number>;
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
            .map(b => ({ building: b, tier: tasks[b] }));
          if (trainQueue.length > 0) { await runTask('train-troops', { trainQueue }); dispatchedAny = true; }
        }

        if (loopStopped) break;

        // Step 3: 有派发任务时才重新 OCR，获取最新倒计时
        if (dispatchedAny) {
          const reOcrLogs = await runTask('read-queue-overview');
          latestTimers = parseOcrResult(reOcrLogs);
        } else {
          latestTimers = timers;
        }

        } finally { releaseLock(); }

        if (loopStopped) break;

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

        // ==== 一轮结束，per-round 模式触发切号 ====
        if (featuresRef.current.autoSwitchAccount && featuresRef.current.switchMode === 'per-round') {
          pendingAccountSwitch = true;
        }

        // 等待期间随机拖拽
        const dragSafetyMargin = 5;
        const dragWindow = nextWake - dragSafetyMargin;
        if (dragWindow > 120 && Math.random() < 0.4) {
          const dragDelay = 5 + Math.random() * (dragWindow * 0.7);
          const startWait = monotonicNow();
          while (!loopStopped && (monotonicNow() - startWait) < dragDelay * 1000) {
            await sleep(1);
          }
          if (!loopStopped) {
            if (await acquireLock()) {
              try { if (!offlineActive) await runTask('idle-drag'); } catch {} finally { releaseLock(); }
            }
          }
          while (!loopStopped && (monotonicNow() - startWait) < nextWake * 1000) {
            await sleep(1);
          }
        } else {
          const startWait = monotonicNow();
          while (!loopStopped && (monotonicNow() - startWait) < nextWake * 1000) {
            await sleep(1);
          }
        }
      }
      await Promise.all([helpLoop, collectLoop, gatherLoop, rallyLoop, caveLoop, produceMaterialLoop, offlineLoop, attackLoop]);
      loopRunning = false;
      setLoopRunningState(false);
      clearLoopState();
      runningTaskIdsRef.current = [];
      setTaskRunning(false);
      setRunningTaskIds([]);
      pushLog(`⏹️ 循环已停止`);
    })();
  };

  const handleStop = async (source: 'local' | 'remote' = 'local') => {
    loopStopped = true;
    loopRunning = false;
    setLoopRunningState(false);
    clearLoopState();
    if (switchTimerId) { clearTimeout(switchTimerId); switchTimerId = null; }
    if (runningTaskIdsRef.current.length > 0) {
      await Promise.all(runningTaskIdsRef.current.map(id => api.tasks.stop(id).catch(() => {})));
    }
    runningTaskIdsRef.current = [];
    setTaskRunning(false);
    setRunningTaskIds([]);
    moduleGemInitialCount = null;
    moduleGemCollectedCount = 0;
    setGemInitialCount(null);
    setGemCollectedCount(0);
    pushLog(`⏹️ 已停止所有任务`);

    // 远程触发：停止后杀掉游戏进程
    if (source === 'remote' && currentAccountId) {
      try {
        pushLog(`📱 远程停止：关闭游戏进程`);
        const r = await api.tasks.create(currentAccountId, 'com.rok.automation', 'kill-game');
        if (r.success) {
          await api.tasks.run(r.task.id);
        }
      } catch (e: any) {
        pushLog(`⚠️ killGame 失败: ${e.message || e}`);
      }
    }
  };

  // 订阅远程控制 SSE：手机发 start_loop/stop_loop 时触发对应处理
  useEffect(() => {
    const es = new EventSource(`${LOCAL_API_BASE}/api/remote-control/stream`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.action === 'start_loop') {
          handleStartAll('remote');
        } else if (data.action === 'stop_loop') {
          handleStop('remote');
        }
      } catch { /* connected/heartbeat 帧，忽略 */ }
    };
    es.onerror = () => {
      // EventSource 会自动重连，不需要处理
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              <h3 className="font-semibold text-slate-800">{taskRunning ? '运行中' : '准备就绪'}</h3>
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
            {!deviceConnected ? (
              <button
                onClick={handleConnectDevice}
                disabled={deviceLoading}
                className="px-8 py-3 bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-bold rounded-full hover:from-emerald-600 hover:to-emerald-500 transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/30"
              >
                {deviceLoading ? '连接中...' : '连接设备'}
              </button>
            ) : !taskRunning ? (
              <button
                onClick={() => handleStartAll('local')}
                className="px-8 py-3 bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-bold rounded-full hover:from-emerald-600 hover:to-emerald-500 transition-all shadow-lg shadow-emerald-500/30 flex items-center gap-2"
              >
                <span>▶</span> 开始运行
              </button>
            ) : (
              <button
                onClick={() => handleStop('local')}
                className="px-8 py-3 bg-red-500 text-white font-bold rounded-full hover:bg-red-600 transition-all shadow-lg shadow-red-500/30"
              >
                停止运行
              </button>
            )}
          </div>
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
                className="ml-auto px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:border-emerald-400"
              >
                {configNames.map(n => <option key={n} value={n}>📐 {n}</option>)}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">

            {/* 智能采集宝石 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${(features.autoExplore || features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' : isFeatureLocked('gemGather') ? 'bg-amber-50/60 border-amber-300 border-dashed' : features.gemGatherEnabled ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
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
                  <input type="checkbox" checked={features.gemGatherEnabled} disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, gemGatherEnabled: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.gemGatherEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.gemGatherEnabled ? 'translate-x-[18px]' : ''}`} />
                </label>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-slate-400 whitespace-nowrap">派遣</span>
                {[1,2,3,4,5,6,7].map(teamNum => (
                  <label key={teamNum} className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox"
                      checked={features.gemGatherTeams.includes(teamNum)}
                      disabled={features.autoExplore || features.autoWorldChat || !features.gemGatherEnabled || isFeatureLocked('gemGather')}
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
                <span className="text-xs text-slate-400 whitespace-nowrap">队伍</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-slate-400 whitespace-nowrap">模式</span>
                <span className="text-xs text-slate-500 whitespace-nowrap">普通</span>
                {(() => {
                  const ratio = features.gemGatherMixRatio ?? 0.5;
                  const disabled = !features.gemGatherEnabled || isFeatureLocked('gemGather') || features.autoExplore || features.autoWorldChat;
                  return (
                    <div className={`slider-capsule flex-1 max-w-[160px] ${disabled ? 'is-disabled opacity-60' : ''}`}>
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
                <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full w-12 text-center tabular-nums">{Math.round((features.gemGatherMixRatio ?? 0.5) * 100)}%</span>
                <span className="text-xs text-slate-400 whitespace-nowrap ml-auto">队伍页</span>
                {renderTeamPageSelect(features.gemGatherTeamPage, (v) => setFeatures({ ...features, gemGatherTeamPage: v }), features.autoExplore || features.autoWorldChat || !features.gemGatherEnabled || isFeatureLocked('gemGather'))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-slate-400 whitespace-nowrap">采集</span>
                <input type="number" value={features.gemGatherActiveHours ?? 3}
                  onChange={(e) => setFeatures({ ...features, gemGatherActiveHours: Number(e.target.value) })}
                  disabled={!features.gemGatherEnabled || isFeatureLocked('gemGather')}
                  min={1} max={24}
                  className="w-12 px-1 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-700 text-center focus:outline-none focus:border-cyan-500 disabled:opacity-50" />
                <span className="text-xs text-slate-400">小时，休息</span>
                <input type="number" value={features.gemGatherRestHours ?? 1}
                  onChange={(e) => setFeatures({ ...features, gemGatherRestHours: Number(e.target.value) })}
                  disabled={!features.gemGatherEnabled || isFeatureLocked('gemGather')}
                  min={1} max={24}
                  className="w-12 px-1 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-700 text-center focus:outline-none focus:border-cyan-500 disabled:opacity-50" />
                <span className="text-xs text-slate-400">小时</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-slate-400 whitespace-nowrap">最大采集距离</span>
                <input type="number" value={features.gemGatherMaxDistance ?? 100}
                  onChange={(e) => setFeatures({ ...features, gemGatherMaxDistance: Number(e.target.value) })}
                  disabled={!features.gemGatherEnabled || isFeatureLocked('gemGather')}
                  min={1} max={9999}
                  className="w-16 px-1 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-700 text-center focus:outline-none focus:border-cyan-500 disabled:opacity-50" />
                <span className="text-xs text-slate-400">公里</span>
              </div>
              <div className="mt-2">
                <button type="button"
                  onClick={() => setShowGemSearchWeights(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors">
                  <span>搜索路径权重</span>
                  <span className={`transition-transform ${showGemSearchWeights ? 'rotate-180' : ''}`}>▼</span>
                </button>
                {showGemSearchWeights && (() => {
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
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border ${(features.autoExplore || features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :features.gatherResources ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center text-base">🌾</span>城外资源采集</span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.gatherResources} disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, gatherResources: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.gatherResources ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.gatherResources ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <div className="grid grid-cols-5 gap-1 mt-2">
                {features.gatherTasks.slice(0, 5).map((task: { type: string; level: number }, i: number) => (
                  <div key={i} className="flex flex-col gap-1">
                    <select value={task.type} disabled={features.autoExplore || features.autoWorldChat} onChange={(e) => {
                      const next = [...features.gatherTasks]; next[i] = { ...next[i], type: e.target.value };
                      setFeatures({ ...features, gatherTasks: next });
                    }}
                    className="px-1 py-1 bg-white border border-slate-200 rounded text-xs w-full">
                      <option value="">-</option>
                      {RESOURCE_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                    </select>
                    <select value={task.level} disabled={features.autoExplore || features.autoWorldChat} onChange={(e) => {
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
                              <select value={task.type} disabled={features.autoExplore || features.autoWorldChat} onChange={(e) => {
                                const next = [...features.gatherTasks]; next[i] = { ...next[i], type: e.target.value };
                                setFeatures({ ...features, gatherTasks: next });
                              }}
                              className="px-1 py-1 bg-white border border-slate-200 rounded text-xs w-full">
                                <option value="">-</option>
                                {RESOURCE_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                              </select>
                              <select value={task.level} disabled={features.autoExplore || features.autoWorldChat} onChange={(e) => {
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
                {renderTeamPageSelect(features.resourceGatherTeamPage, (v) => setFeatures({ ...features, resourceGatherTeamPage: v }), features.autoExplore || features.autoWorldChat)}
              </div>
            </div>

            {/* 自动攻打城寨 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${(features.autoExplore || features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' : features.autoRallyFort ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-base">🏰</span>自动攻打城寨</span>
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${(features.autoExplore || features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={features.autoRallyFort}
                    disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, autoRallyFort: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.autoRallyFort ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoRallyFort ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 whitespace-nowrap">目标等级</span>
                  <select value={features.rallyFortLevel}
                    disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, rallyFortLevel: Number(e.target.value) })}
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs w-20">
                    <option value={0}>—</option>
                    {[1,2,3,4,5,6,7,8,9,10].map(l => (<option key={l} value={l}>Lv.{l}</option>))}
                  </select>
                  <span className="text-xs text-slate-400 whitespace-nowrap ml-2">派遣第</span>
                  <select value={features.rallyFortTeam}
                    disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, rallyFortTeam: Number(e.target.value) })}
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs w-16">
                    {[1,2,3,4,5].map(t => (<option key={t} value={t}>{t}</option>))}
                  </select>
                  <span className="text-xs text-slate-400 whitespace-nowrap">队伍</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-16" title="当搜索不到对应等级的城寨后，降级搜索。">降级搜索</span>
                  <label className={`relative inline-flex items-center ${(features.autoExplore || features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                    title="当搜索不到对应等级的城寨后，降级搜索。">
                    <input type="checkbox" checked={features.rallyFortDowngrade}
                      disabled={features.autoExplore || features.autoWorldChat}
                      onChange={(e) => setFeatures({ ...features, rallyFortDowngrade: e.target.checked })}
                      className="sr-only peer" />
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${features.rallyFortDowngrade ? 'bg-amber-500 border-amber-500' : 'bg-white border-slate-300'}`}>
                      {features.rallyFortDowngrade && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 whitespace-nowrap">队伍页</span>
                  {renderTeamPageSelect(features.rallyFortTeamPage, (v) => setFeatures({ ...features, rallyFortTeamPage: v }), features.autoExplore || features.autoWorldChat)}
                </div>
              </div>

            </div>

            {/* 加入集结 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${
              (features.autoExplore || features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :
              features.joinRallyEnabled ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'
            }`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                  <span className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center text-base">🤝</span>
                  加入集结
                </span>
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${
                  (features.autoExplore || features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
                }`}>
                  <input type="checkbox" checked={features.joinRallyEnabled}
                    disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, joinRallyEnabled: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.joinRallyEnabled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.joinRallyEnabled ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <div className={`mt-3 space-y-2 ${features.joinRallyEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-12">派遣第</span>
                  <select
                    value={features.joinRallyTeam}
                    onChange={(e) => setFeatures({ ...features, joinRallyTeam: Number(e.target.value) })}
                    className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700 focus:outline-none focus:border-emerald-500"
                    style={{ width: '50px' }}>
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <span className="text-xs text-slate-500 w-8">队伍</span>
                  <span className="text-xs text-slate-500 w-12 ml-2">队伍页</span>
                  {renderTeamPageSelect(
                    features.joinRallyTeamPage,
                    (v) => setFeatures({ ...features, joinRallyTeamPage: v }),
                    !features.joinRallyEnabled
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-12">集结目标</span>
                  <div className="flex items-center gap-4">
                    <label
                      className={`flex items-center gap-1.5 ${!features.joinRallyEnabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                      onClick={() => features.joinRallyEnabled && setFeatures({ ...features, joinRallyTargetFort: !features.joinRallyTargetFort })}
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${features.joinRallyTargetFort ? 'bg-orange-500 border-orange-600' : 'bg-white border-slate-300'}`}>
                        {features.joinRallyTargetFort && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                      </span>
                      <span className="text-xs text-slate-600">城寨</span>
                    </label>
                    <label
                      className={`flex items-center gap-1.5 ${!features.joinRallyEnabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                      onClick={() => features.joinRallyEnabled && setFeatures({ ...features, joinRallyTargetLohar: !features.joinRallyTargetLohar })}
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${features.joinRallyTargetLohar ? 'bg-orange-500 border-orange-600' : 'bg-white border-slate-300'}`}>
                        {features.joinRallyTargetLohar && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                      </span>
                      <span className="text-xs text-slate-600">洛哈</span>
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
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border ${(features.autoExplore || features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :features.upgradeBuildings ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center text-base">🏗️</span>自动升级建筑</span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.upgradeBuildings} disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, upgradeBuildings: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.upgradeBuildings ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.upgradeBuildings ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-2">
                {features.selectedBuildings.map((val: string, i: number) => (
                  <select key={i} value={val} disabled={features.autoExplore || features.autoWorldChat} onChange={(e) => {
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
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border ${(features.autoExplore || features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :features.autoResearch ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center text-base">🔬</span>自动研究科技</span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.autoResearch} disabled={features.autoExplore || features.autoWorldChat}
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

            {/* 自动训练兵种 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border ${(features.autoExplore || features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :features.trainTroops ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-base">⚔️</span>自动训练兵种</span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.trainTroops} disabled={features.autoExplore || features.autoWorldChat}
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
              <div className="grid grid-cols-2 gap-2 mt-2">
                {(['兵营', '马厩', '靶场', '攻城武器厂'] as const).map(building => (
                  <div key={building} className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 w-16">{({ 兵营: '⚔️', 马厩: '🐴', 靶场: '🎯', 攻城武器厂: '⚙️' } as Record<string, string>)[building]} {building}</span>
                    <select value={(features.trainTasks as Record<string, number>)[building] ?? 0} disabled={features.autoExplore || features.autoWorldChat} onChange={(e) => {
                      const next = { ...features.trainTasks as Record<string, number>, [building]: Number(e.target.value) };
                      setFeatures({ ...features, trainTasks: next });
                    }}
                    className="px-1 py-1 bg-white border border-slate-200 rounded text-xs w-16">
                      <option value={0}>-</option>
                      {TRAIN_TIERS.map(t => (<option key={t} value={t}>T{t}</option>))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* 自动喊话 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${features.autoWorldChat ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center text-base">📢</span>自动喊话</span>
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${(features.autoExplore) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={features.autoWorldChat}
                    disabled={features.autoExplore}
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

            {/* 社交与辅助 */}
            <div className="flex flex-col gap-0 p-4 rounded-lg transition-colors border border-slate-200 hover:border-slate-300">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-base">📋</span>
                <span className="font-semibold text-sm text-slate-800">社交与辅助</span>
              </div>
              {/* 自动帮助盟友 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-purple-100 rounded flex items-center justify-center text-xs">🤝</span>
                  自动帮助盟友
                </span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.helpTeammates} disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, helpTeammates: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.helpTeammates ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.helpTeammates ? 'translate-x-[18px]' : ''}`} />
                </label>
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
                    disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({
                      ...features,
                      collectResourcesIntervalMinutes: Math.max(MIN_COLLECT_RESOURCES_INTERVAL_MINUTES, Number(e.target.value) || MIN_COLLECT_RESOURCES_INTERVAL_MINUTES),
                    })}
                    className="w-16 px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                  />
                  <span className="text-xs text-slate-400">分钟</span>
                  <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                    <input type="checkbox" checked={features.collectResources} disabled={features.autoExplore || features.autoWorldChat}
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
                    disabled={features.autoExplore || features.autoWorldChat}
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
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="w-6 h-6 bg-cyan-100 rounded flex items-center justify-center text-xs">🗺️</span>
                    迷雾探索
                    {features.autoExplore && <span className="text-xs px-1.5 py-0.5 bg-purple-500 text-white rounded-full font-medium">独立模式</span>}
                  </span>
                  <div className="flex items-center gap-2 ml-8">
                    <span className="text-xs text-slate-400">派出</span>
                    <select value={features.exploreCount} onChange={(e) => {
                      setFeatures({ ...features, exploreCount: Number(e.target.value) });
                    }}
                    className="px-1 py-0.5 bg-white border border-slate-200 rounded text-xs w-12">
                      {[1, 2, 3].map(n => (<option key={n} value={n}>{n}</option>))}
                    </select>
                    <span className="text-xs text-slate-400">个斥候</span>
                    <span className="text-xs text-slate-400">· 需标记斥候营地坐标</span>
                  </div>
                </div>
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
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.autoExplore ? 'bg-purple-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoExplore ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              {features.autoExplore && (
                <p className="text-xs text-slate-400 mt-1 ml-8">⚠ 迷雾探索模式已开启，其他功能已暂停</p>
              )}
              {/* 山洞探索 */}
              <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-6 h-6 bg-amber-100 rounded flex items-center justify-center text-xs">🏔️</span>
                  山洞探索
                  <span className="text-xs text-slate-400">· 每2分钟</span>
                </span>
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${(features.autoExplore || features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={features.autoCaveExplore}
                    disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, autoCaveExplore: e.target.checked })}
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
                    disabled={features.autoExplore || features.autoWorldChat || !features.produceMaterialEnabled}
                    onChange={(e) => setFeatures({ ...features, produceMaterialType: e.target.value as 'leather' | 'iron' | 'ebony' | 'bone' })}
                    className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-xs disabled:opacity-50"
                  >
                    <option value="leather">皮革</option>
                    <option value="iron">铁矿石</option>
                    <option value="ebony">乌木</option>
                    <option value="bone">兽骨</option>
                  </select>
                </span>
                <label className={`relative w-10 h-[22px] flex-shrink-0 ${(features.autoExplore || features.autoWorldChat) ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={features.produceMaterialEnabled}
                    disabled={features.autoExplore || features.autoWorldChat}
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

            {/* 自动切号 */}
            <div className="flex flex-col gap-0 p-4 rounded-lg transition-colors border border-slate-200 hover:border-slate-300">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800">
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base bg-amber-100">🔀</span>
                  自动切号
                </span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.autoSwitchAccount}
                    onChange={(e) => setFeatures({ ...features, autoSwitchAccount: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.autoSwitchAccount ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoSwitchAccount ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              {features.autoSwitchAccount && (
                <>
                  <div className="mb-2 flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-slate-600">切号时机:</label>
                    <select
                      value={features.switchMode}
                      onChange={(e) => setFeatures({ ...features, switchMode: e.target.value as 'per-round' | 'per-time' })}
                      className="px-1.5 py-0.5 text-xs bg-white border border-slate-200 rounded"
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
                          className="w-16 px-1.5 py-0.5 text-xs bg-white border border-slate-200 rounded"
                        />
                        <span className="text-xs text-slate-500">分钟</span>
                      </>
                    )}
                  </div>
                  {[0, 1].map(i => (
                    <div key={i} className="mb-1.5 flex items-center gap-2">
                      <label className="text-xs text-slate-600 w-12">账号 {i + 1}:</label>
                      <select
                        value={features.switchProfileIds[i] || ''}
                        onChange={(e) => {
                          const ids: [string, string] = [features.switchProfileIds[0] || '', features.switchProfileIds[1] || ''];
                          ids[i] = e.target.value;
                          setFeatures({ ...features, switchProfileIds: ids });
                        }}
                        className="flex-1 px-1.5 py-0.5 text-xs bg-white border border-slate-200 rounded"
                      >
                        <option value="">-- 选择配置方案 --</option>
                        {configNames.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <p className="mt-1 text-xs text-slate-400">💡 每个配置方案需在 Config 页填写账号编号</p>
                </>
              )}
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
