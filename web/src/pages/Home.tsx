import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAccount } from '../contexts/AccountContext';
import { useLicense } from '../contexts/LicenseContext';
import { DEFAULT_HOME_FEATURES } from '../../../plugins/rok/homeFeatures';

// Module-level loop state — survives component unmount/remount during SPA navigation
let loopStopped = false;
let loopRunning = false;
let loopLogs: string[] = [];
let loopCompletedBuildings: boolean[] = [false, false, false, false, false];
let loopCompletedTechs: boolean[] = [false, false, false, false, false];
let deviceBusy = false;

const LOOP_STATE_KEY = 'loop-state';

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
  const { refreshStatus, setExpiredMessage } = useLicense();
  const [activeConfigName, setActiveConfigName] = useState('');
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [taskRunning, setTaskRunning] = useState(false);
  const runningTaskIdsRef = useRef<string[]>([]);
  const [_runningTaskIds, setRunningTaskIds] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>(loopLogs);
  useEffect(() => { loopLogs = logs; }, [logs]);
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
        return merged;
      }
    } catch {}
    return DEFAULT_FEATURES;
  };

  const [features, setFeatures] = useState(loadFeatures);

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
          setFeatures((prev: typeof DEFAULT_FEATURES) => ({
            ...DEFAULT_HOME_FEATURES,
            ...res.config.homeFeatures,
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
        setFeatures({
          ...DEFAULT_HOME_FEATURES,
          ...res.config.homeFeatures,
          completedBuildings: [false, false, false, false, false],
          completedTechs: [false, false, false, false, false],
        });
      } else {
        setFeatures({ ...DEFAULT_FEATURES });
      }
      loopCompletedBuildings = [false, false, false, false, false];
      loopCompletedTechs = [false, false, false, false, false];
    } catch (e: any) {
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 配置切换失败: ${e.message}`]);
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

  const handleStartAll = async () => {
    if (!currentAccountId) return;
    if (!deviceConnected) {
      await handleConnectDevice();
      return;
    }

    const selectedActions: string[] = [];
    if (features.collectResources) selectedActions.push('收集资源');
    if (features.upgradeBuildings) selectedActions.push('升级建筑');
    if (features.autoResearch) selectedActions.push('研究科技');
    if (features.gatherResources) selectedActions.push('城外采集');
    if (features.trainTroops) selectedActions.push('训练兵种');
    if (features.helpTeammates) selectedActions.push('帮助盟友');
    if (features.autoExplore) selectedActions.push('自动探索');

    if (selectedActions.length === 0) {
      alert('请勾选要执行的功能');
      return;
    }

    if (loopRunning) return;
    loopRunning = true;
    loopStopped = false;
    saveLoopState(currentAccountId);
    setTaskRunning(true);
    const isExploreMode = features.autoExplore;
    const interval = isExploreMode ? 60 : features.loopInterval;
    clearLoopState();
    setLogs([`[${new Date().toLocaleTimeString()}] 🚀 开始${isExploreMode ? '自动探索' : '循环执行: ' + selectedActions.join(' + ')} (间隔${interval}秒)`]);

    // Reset completion state for a fresh run (module-level for loop, state for UI)
    loopCompletedBuildings = [false, false, false, false, false];
    loopCompletedTechs = [false, false, false, false, false];
    setFeatures((prev: typeof DEFAULT_FEATURES) => ({
      ...prev,
      completedBuildings: [false, false, false, false, false],
      completedTechs: [false, false, false, false, false],
    }));

    const sleep = async (s: number) => new Promise(r => setTimeout(r, s * 1000));

    const acquireLock = async (): Promise<boolean> => {
      while (deviceBusy && !loopStopped) { await sleep(0.3); }
      if (loopStopped) return false;
      deviceBusy = true;
      return true;
    };
    const releaseLock = () => { deviceBusy = false; };

    // Fire and forget, stop button will cancel via task IDs
    (async () => {
      let round = 0;
      let bottomBarChecked = false;

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
          if (features.gatherResources && !features.autoExplore) {
            const gatherTasks = features.gatherTasks
              .map((t: { type: string; level: number }, i: number) => ({ ...t, team: i + 1 }))
              .filter((t: { type: string; level: number; team: number }) => t.type);
            if (gatherTasks.length > 0) {
              if (!await acquireLock()) break;
              try {
                const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', 'gather-resources', { gatherTasks });
                if (createResult.success) {
                  runningTaskIdsRef.current = [...runningTaskIdsRef.current, createResult.task.id];
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                  const runResult = await api.tasks.run(createResult.task.id);
                  runningTaskIdsRef.current = runningTaskIdsRef.current.filter(id => id !== createResult.task.id);
                  setRunningTaskIds([...runningTaskIdsRef.current]);
                  const logs = runResult.task?.logs ?? [];
                  const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
                  if (hasExpiredLog) {
                    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⛔ 许可证已到期，停止运行`]);
                    loopStopped = true;
                    setExpiredMessage('激活码已到期，请重新激活');
                    refreshStatus();
                  } else {
                    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ 城外采集 完成`]);
                  }
                }
              } catch {} finally { releaseLock(); }
            }
          }
          const jitteredInterval = features.loopInterval * (0.85 + Math.random() * 0.3);
          const startWait = Date.now();
          while (!loopStopped && (Date.now() - startWait) < jitteredInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      // 帮助盟友独立循环 — 每 60s
      const helpLoop = (async () => {
        let first = true;
        while (!loopStopped) {
          if (first) { first = false; await sleep(10); continue; }
          if (features.helpTeammates && !features.autoExplore) {
            if (!await acquireLock()) break;
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
                  setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⛔ 许可证已到期，停止运行`]);
                  loopStopped = true;
                  setExpiredMessage('激活码已到期，请重新激活');
                  refreshStatus();
                } else {
                  setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ 帮助盟友 完成`]);
                }
              }
            } catch {} finally { releaseLock(); }
          }
          const helpInterval = 60 * (0.85 + Math.random() * 0.3); // 51-69s
          const startWait = Date.now();
          while (!loopStopped && (Date.now() - startWait) < helpInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      // 收集资源独立循环 — 每 4h
      const collectLoop = (async () => {
        let first = true;
        while (!loopStopped) {
          if (first) { first = false; await sleep(4 * 3600); continue; }
          if (features.collectResources && !features.autoExplore) {
            if (!await acquireLock()) break;
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
                  setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⛔ 许可证已到期，停止运行`]);
                  loopStopped = true;
                  setExpiredMessage('激活码已到期，请重新激活');
                  refreshStatus();
                } else {
                  setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ 收集资源 完成`]);
                }
              }
            } catch {} finally { releaseLock(); }
          }
          const collectInterval = 4 * 3600 * (0.85 + Math.random() * 0.3); // 3.4-4.6h
          const startWait = Date.now();
          while (!loopStopped && (Date.now() - startWait) < collectInterval * 1000) {
            await sleep(1);
          }
        }
      })();

      while (!loopStopped) {
        round++;
        setLogs(prev => { const next = [...prev, `[${new Date().toLocaleTimeString()}] 🔄 第${round}轮`]; saveLoopState(currentAccountId); return next; });


        const handleLicenseExpired = () => {
          setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⛔ 许可证已到期，停止运行`]);
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
              const logs = runResult.task?.logs ?? [];

              const hasExpiredLog = logs.some((l: string) => l.includes('许可证已过期'));
              const hasExpiredError = runResult.task?.error && /license.*expir|许可证.*过/i.test(runResult.task.error);
              if (hasExpiredLog || hasExpiredError) {
                handleLicenseExpired();
                return logs;
              }

              setLogs(prev => { const next = [...prev, `[${new Date().toLocaleTimeString()}] ✅ ${createResult.task.actionId} 完成`]; saveLoopState(currentAccountId); return next; });
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
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 执行失败: ${e}`]);
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

        if (!bottomBarChecked) {
          if (await acquireLock()) {
            try { await runTask('ensure-bottom-bar'); bottomBarChecked = true; }
            finally { releaseLock(); }
          }
        }

        // 探索模式：与其他任务互斥，只执行探索
        if (features.autoExplore) {
          if (!buildingOptions.includes('斥候营地')) {
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 未标记斥候营地位置，跳过自动探索`]);
          } else {
            if (await acquireLock()) {
              try { await runTask('explore', { maxScouts: features.exploreCount }); }
              finally { releaseLock(); }
            }
          }
          if (loopStopped) break;
          // 探索模式下固定 1 分钟后检查
          const exploreNextWake = 30 + Math.random() * 15;
          setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🔍 探索模式，下次检查 ${exploreNextWake.toFixed(0)} 秒后`]);
          const exploreDragSafety = 5;
          const exploreDragWindow = exploreNextWake - exploreDragSafety;
          if (exploreDragWindow > 20 && Math.random() < 0.05) {
            const dragDelay = 5 + Math.random() * (exploreDragWindow * 0.7);
            const exploreStartWait = Date.now();
            while (!loopStopped && (Date.now() - exploreStartWait) < dragDelay * 1000) {
              await sleep(1);
            }
            if (!loopStopped) {
              if (await acquireLock()) {
                try { await runTask('idle-drag'); } catch {} finally { releaseLock(); }
              }
            }
            while (!loopStopped && (Date.now() - exploreStartWait) < exploreNextWake * 1000) {
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
          if (!features.worldChatMessage?.trim()) {
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 未填写喊话内容，跳过`]);
            loopStopped = true;
            break;
          }
          if (await acquireLock()) {
            try { await runTask('send-world-chat', { message: features.worldChatMessage, isFirst: true }); }
            finally { releaseLock(); }
          }
          if (loopStopped) break;

          while (!loopStopped && features.autoWorldChat) {
            const chatInterval = features.worldChatInterval || 300;
            const nextWake = Math.max(15, chatInterval * (0.85 + Math.random() * 0.3));
            const chatStartWait = Date.now();
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 📢 喊话模式，下次发送 ${nextWake.toFixed(0)} 秒后`]);

            const dragSafety = 5;
            const dragWindow = nextWake - dragSafety;
            if (dragWindow > 20 && Math.random() < 0.05) {
              const dragDelay = 5 + Math.random() * (dragWindow * 0.7);
              while (!loopStopped && (Date.now() - chatStartWait) < dragDelay * 1000) {
                await sleep(1);
              }
              if (!loopStopped) {
                if (await acquireLock()) {
                  try { await runTask('idle-drag'); } catch {} finally { releaseLock(); }
                }
              }
              while (!loopStopped && (Date.now() - chatStartWait) < nextWake * 1000) {
                await sleep(1);
              }
            } else {
              await sleep(nextWake);
            }
            if (loopStopped) break;

            if (await acquireLock()) {
              try { await runTask('send-world-chat', { message: features.worldChatMessage, isFirst: false }); }
              finally { releaseLock(); }
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
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 未标记学院位置，跳过研究科技`]);
          } else if (timers.build1Building === '学院' || timers.build2Building === '学院') {
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🏗️ 学院正在升级中，跳过研究科技`]);
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
                setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🏗️ ${b}正在升级中，跳过训练`]);
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

        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏳ 下次检查 ${nextWake.toFixed(0)} 秒后 (build1=${latestTimers.build1}s build2=${latestTimers.build2}s train=${latestTimers.train_bingying}/${latestTimers.train_majiu}/${latestTimers.train_bachang}/${latestTimers.train_gongcheng}s research=${latestTimers.research}s)`]);

        // 等待期间随机拖拽
        const dragSafetyMargin = 5;
        const dragWindow = nextWake - dragSafetyMargin;
        if (dragWindow > 120 && Math.random() < 0.4) {
          const dragDelay = 5 + Math.random() * (dragWindow * 0.7);
          const startWait = Date.now();
          while (!loopStopped && (Date.now() - startWait) < dragDelay * 1000) {
            await sleep(1);
          }
          if (!loopStopped) {
            if (await acquireLock()) {
              try { await runTask('idle-drag'); } catch {} finally { releaseLock(); }
            }
          }
          while (!loopStopped && (Date.now() - startWait) < nextWake * 1000) {
            await sleep(1);
          }
        } else {
          const startWait = Date.now();
          while (!loopStopped && (Date.now() - startWait) < nextWake * 1000) {
            await sleep(1);
          }
        }
      }
      await Promise.all([helpLoop, collectLoop, gatherLoop]);
      loopRunning = false;
      clearLoopState();
      runningTaskIdsRef.current = [];
      setTaskRunning(false);
      setRunningTaskIds([]);
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏹️ 循环已停止`]);
    })();
  };

  const handleStop = async () => {
    loopStopped = true;
    loopRunning = false;
    clearLoopState();
    if (runningTaskIdsRef.current.length > 0) {
      await Promise.all(runningTaskIdsRef.current.map(id => api.tasks.stop(id).catch(() => {})));
    }
    runningTaskIdsRef.current = [];
    setTaskRunning(false);
    setRunningTaskIds([]);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏹️ 已停止所有任务`]);
  };

  if (!currentAccountId) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center py-20">
        <p className="text-xl text-slate-500 mb-4">请先创建账号</p>
        <p className="text-sm text-slate-400 mb-6">需要绑定一个模拟器实例才能开始使用</p>
        <a href="/accounts" className="px-6 py-3 bg-emerald-500 text-white rounded-full hover:bg-emerald-600 inline-block shadow-lg shadow-emerald-500/30">
          前往账号管理
        </a>
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
              <button
                onClick={handleConnectDevice}
                disabled={deviceLoading}
                className="px-8 py-3 bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-bold rounded-full hover:from-emerald-600 hover:to-emerald-500 transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/30"
              >
                {deviceLoading ? '连接中...' : '连接设备'}
              </button>
            ) : !taskRunning ? (
              <button
                onClick={handleStartAll}
                className="px-8 py-3 bg-gradient-to-r from-emerald-500 to-emerald-400 text-white font-bold rounded-full hover:from-emerald-600 hover:to-emerald-500 transition-all shadow-lg shadow-emerald-500/30 flex items-center gap-2"
              >
                <span>▶</span> 开始运行
              </button>
            ) : (
              <button
                onClick={handleStop}
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
              <p className="text-xs text-slate-400 mt-1.5">请在配置页添加建筑坐标</p>
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
              <p className="text-xs text-slate-400 mt-1.5">请先在配置页添加学院坐标</p>
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
                {features.gatherTasks.map((task: { type: string; level: number }, i: number) => (
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
              <p className="text-xs text-slate-400 mt-1.5">5个队伍按顺序派出采集</p>
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
              <p className="text-xs text-slate-400 mt-1.5">需标记对应建筑坐标</p>
            </div>

            {/* 自动帮助盟友 */}
            <div className={`flex items-center justify-between p-4 rounded-lg transition-colors border ${(features.autoExplore || features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :features.helpTeammates ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center text-base">🤝</span>自动帮助盟友</span>
              <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                <input type="checkbox" checked={features.helpTeammates} disabled={features.autoExplore || features.autoWorldChat}
                  onChange={(e) => setFeatures({ ...features, helpTeammates: e.target.checked })}
                  className="sr-only" />
                <span className={`absolute inset-0 rounded-full transition-colors ${features.helpTeammates ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.helpTeammates ? 'translate-x-[18px]' : ''}`} />
              </label>
            </div>

            {/* 自动收集资源 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border ${(features.autoExplore || features.autoWorldChat) ? 'bg-slate-100 border-slate-200 opacity-70' :features.collectResources ? 'border-emerald-500 bg-green-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center text-base">📦</span>自动收集资源</span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.collectResources} disabled={features.autoExplore || features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, collectResources: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.collectResources ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.collectResources ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">请先在配置页添加资源建筑坐标</p>
            </div>

            {/* 自动探索 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${features.autoExplore ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-cyan-100 rounded-lg flex items-center justify-center text-base">🗺️</span>自动探索</span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.autoExplore}
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
              <div className="flex items-center gap-2 mt-2">
                {features.autoExplore && <span className="text-xs px-1.5 py-0.5 bg-purple-500 text-white rounded-full font-medium">独立模式</span>}
                <span className="text-xs text-slate-400">派出</span>
                <select value={features.exploreCount} onChange={(e) => {
                  setFeatures({ ...features, exploreCount: Number(e.target.value) });
                }}
                className="px-1 py-1 bg-white border border-slate-200 rounded text-xs w-12">
                  {[1, 2, 3].map(n => (<option key={n} value={n}>{n}</option>))}
                </select>
                <span className="text-xs text-slate-400">个斥候</span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">需标记斥候营地坐标</p>
              {features.autoExplore && (
                <p className="text-xs text-amber-600 mt-1">⚠ 探索模式已开启，其他功能已暂停</p>
              )}
            </div>

            {/* 自动喊话 */}
            <div className={`flex flex-col gap-0 p-4 rounded-lg transition-colors border relative ${features.autoWorldChat ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-800"><span className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center text-base">📢</span>自动喊话</span>
                <label className="relative w-10 h-[22px] cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={features.autoWorldChat}
                    onChange={(e) => setFeatures({ ...features, autoWorldChat: e.target.checked })}
                    className="sr-only" />
                  <span className={`absolute inset-0 rounded-full transition-colors ${features.autoWorldChat ? 'bg-purple-500' : 'bg-slate-200'}`} />
                  <span className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full transition-transform shadow-sm ${features.autoWorldChat ? 'translate-x-[18px]' : ''}`} />
                </label>
              </div>
              <div className="flex flex-col gap-2 mt-2">
                {features.autoWorldChat && <span className="text-xs px-1.5 py-0.5 bg-purple-500 text-white rounded-full font-medium w-fit">独立模式</span>}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 whitespace-nowrap">消息内容</span>
                  <input
                    type="text"
                    value={features.worldChatMessage}
                    onChange={(e) => setFeatures({ ...features, worldChatMessage: e.target.value })}
                    placeholder="输入喊话内容..."
                    disabled={features.autoWorldChat}
                    className="flex-1 px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-700 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                  />
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
                <p className="text-xs text-amber-600 mt-1">⚠ 喊话模式已开启，其他功能已暂停</p>
              )}
            </div>

            {/* 自动攻打城寨 — coming soon */}
            <div className="flex flex-col gap-0 p-4 rounded-lg bg-slate-100 border border-dashed border-slate-200 relative overflow-hidden">
              <div className="absolute inset-0 bg-white/20 backdrop-blur-[1px] rounded-lg flex items-center justify-center z-10">
                <span className="bg-white border border-slate-200 px-3 py-1.5 rounded-full text-xs text-slate-500 font-semibold shadow-sm flex items-center gap-1.5">🔒 即将上线</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-400"><span className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-base opacity-50">🏰</span>自动攻打城寨</span>
                <span className="relative w-10 h-[22px] flex-shrink-0"><span className="absolute inset-0 rounded-full bg-slate-200" /><span className="absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full shadow-sm" /></span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">自动加入或集结野蛮人城寨</p>
            </div>

            {/* 智慧采集宝石 — coming soon */}
            <div className="flex flex-col gap-0 p-4 rounded-lg bg-slate-100 border border-dashed border-slate-200 relative overflow-hidden">
              <div className="absolute inset-0 bg-white/20 backdrop-blur-[1px] rounded-lg flex items-center justify-center z-10">
                <span className="bg-white border border-slate-200 px-3 py-1.5 rounded-full text-xs text-slate-500 font-semibold shadow-sm flex items-center gap-1.5">🔒 即将上线</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-sm text-slate-400"><span className="w-8 h-8 bg-cyan-100 rounded-lg flex items-center justify-center text-base opacity-50">💎</span>智慧采集宝石</span>
                <span className="relative w-10 h-[22px] flex-shrink-0"><span className="absolute inset-0 rounded-full bg-slate-200" /><span className="absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full shadow-sm" /></span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">智能识别并采集高价值宝石矿</p>
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
    </div>
  );
}
