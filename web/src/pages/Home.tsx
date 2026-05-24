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
        className={`px-2 py-1 bg-gray-800 rounded text-sm border w-24 text-left truncate flex items-center justify-between ${completed ? 'text-green-400 border-green-500' : 'border-gray-600'}`}
      >
        <span className="truncate">{completed && value ? `✅ ${value}` : (value || <span className="text-gray-500">-</span>)}</span>
        {value && (
          <span className="ml-1 text-gray-500 hover:text-gray-300 flex-shrink-0" onClick={(e) => { e.stopPropagation(); onChange(''); }}>×</span>
        )}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-48 bg-gray-800 border border-gray-600 rounded shadow-lg max-h-80 overflow-y-auto">
          <button
            onClick={() => setActiveTab(activeTab === 'economic' ? null : 'economic')}
            className="w-full text-left px-3 py-1.5 text-xs font-bold text-gray-300 hover:bg-gray-700 border-b border-gray-700 sticky top-0 bg-gray-800"
          >
            {activeTab === 'economic' ? '▼' : '▶'} 经济科技
          </button>
          {activeTab === 'economic' && economicTechs.filter(t => !isExcluded(t)).map(name => (
            <button
              key={name}
              onClick={() => { onChange(name); setOpen(false); setActiveTab(null); }}
              className={`w-full text-left px-5 py-1 text-sm hover:bg-gray-700 ${name === value ? 'text-blue-400' : ''}`}
            >{name}</button>
          ))}
          <button
            onClick={() => setActiveTab(activeTab === 'military' ? null : 'military')}
            className="w-full text-left px-3 py-1.5 text-xs font-bold text-gray-300 hover:bg-gray-700 border-b border-gray-700 sticky top-0 bg-gray-800"
          >
            {activeTab === 'military' ? '▼' : '▶'} 军事科技
          </button>
          {activeTab === 'military' && militaryTechs.filter(t => !isExcluded(t)).map(name => (
            <button
              key={name}
              onClick={() => { onChange(name); setOpen(false); setActiveTab(null); }}
              className={`w-full text-left px-5 py-1 text-sm hover:bg-gray-700 ${name === value ? 'text-blue-400' : ''}`}
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
  const [runningTaskIds, setRunningTaskIds] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>(loopLogs);
  useEffect(() => { loopLogs = logs; }, [logs]);
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
  const [techOptions, setTechOptions] = useState<string[]>(['耕犁', '锯木厂', '铸币', '机械']);
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
    setFeatures(prev => ({
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
          const startWait = Date.now();
          while (!loopStopped && (Date.now() - startWait) < features.loopInterval * 1000) {
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
          await sleep(60);
        }
      })();

      // 收集资源独立循环 — 每 4h
      const collectLoop = (async () => {
        let first = true;
        while (!loopStopped) {
          if (first) { first = false; await sleep(10); continue; }
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
          await sleep(4 * 3600);
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
        const allTimers = [latestTimers.build1, latestTimers.build2, latestTimers.train_bingying, latestTimers.train_majiu, latestTimers.train_bachang, latestTimers.train_gongcheng, latestTimers.research].filter((t): t is number => t !== null && t > 0);
        const minTimer = allTimers.length > 0 ? Math.min(...allTimers) : null;

        let nextWake: number;
        if (minTimer !== null) {
          nextWake = Math.min(minTimer * 0.6, 1800); // 系数 0.6，上限 30 分钟
        } else {
          nextWake = 1800; // 无活跃队列，30 分钟后再查
        }
        nextWake += Math.random() * 30; // 随机抖动 0 ~ 30s
        nextWake = Math.max(60, nextWake); // 最少等 60 秒

        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏳ 下次检查 ${nextWake.toFixed(0)} 秒后 (build1=${latestTimers.build1}s build2=${latestTimers.build2}s train=${latestTimers.train_bingying}/${latestTimers.train_majiu}/${latestTimers.train_bachang}/${latestTimers.train_gongcheng}s research=${latestTimers.research}s)`]);

        // 等待期间随机拖拽
        const dragSafetyMargin = 5;
        const dragWindow = nextWake - dragSafetyMargin;
        if (dragWindow > 300 && Math.random() < 0.3) {
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
        <p className="text-xl text-gray-400 mb-4">请先创建账号</p>
        <p className="text-sm text-gray-500 mb-6">需要绑定一个模拟器实例才能开始使用</p>
        <a href="/accounts" className="px-6 py-3 bg-blue-600 rounded-lg hover:bg-blue-500 inline-block">
          前往账号管理
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="bg-gray-800 p-4 border-b border-gray-700">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-blue-400">ROK助手</h1>
            {currentAccountId && configNames.length > 0 && (
              <select
                value={activeConfigName}
                onChange={e => handleConfigSwitch(e.target.value)}
                className="px-2 py-0.5 bg-gray-700 rounded text-xs border border-gray-600 text-gray-300"
              >
                {configNames.map(n => <option key={n} value={n}>📐 {n}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${deviceConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
              <span className="text-sm">{deviceConnected ? '设备已连接' : '未连接设备'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${taskRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></span>
              <span className="text-sm">{taskRunning ? '运行中' : '已停止'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-8 mb-8 text-center shadow-2xl">
          <h2 className="text-3xl font-bold mb-2">一键全能模式</h2>
          <p className="text-blue-100 mb-4">自动收集资源 + 升级建筑 + 定时循环</p>
          <div className="flex items-center justify-center gap-2 mb-6">
            <span className="text-blue-100 text-sm">循环间隔:</span>
            <input type="number" min={60} step={30} value={features.loopInterval}
              onChange={(e) => setFeatures({ ...features, loopInterval: Math.max(60, Number(e.target.value)) })}
              className="w-20 px-2 py-1 bg-white/20 rounded text-white text-sm text-center" />
            <span className="text-blue-100 text-sm">秒</span>
          </div>

          {!deviceConnected ? (
            <button
              onClick={handleConnectDevice}
              disabled={deviceLoading}
              className="px-12 py-4 bg-white text-blue-600 font-bold text-xl rounded-xl hover:bg-gray-100 transition-all disabled:opacity-50 shadow-lg"
            >
              {deviceLoading ? '连接中...' : '第一步：连接设备'}
            </button>
          ) : (
            <div className="space-y-4">
              {!taskRunning ? (
                <button
                  onClick={handleStartAll}
                  className="px-16 py-5 bg-green-500 text-white font-bold text-2xl rounded-xl hover:bg-green-400 transition-all shadow-lg hover:scale-105"
                >
                  开始运行
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  className="px-16 py-5 bg-red-500 text-white font-bold text-2xl rounded-xl hover:bg-red-400 transition-all shadow-lg"
                >
                  停止运行
                </button>
              )}
            </div>
          )}
        </div>

        <div className="bg-gray-800 rounded-xl p-6 mb-6">
          <h3 className="text-xl font-bold mb-4">功能设置</h3>
          <div className="grid grid-cols-2 gap-4">
            <label className={`flex items-center gap-3 p-4 rounded-lg cursor-pointer hover:bg-gray-600 ${features.autoExplore ? 'bg-gray-800 opacity-50 pointer-events-none' : 'bg-gray-700'}`}>
              <input type="checkbox" checked={features.helpTeammates} disabled={features.autoExplore}
                onChange={(e) => setFeatures({ ...features, helpTeammates: e.target.checked })}
                className="w-5 h-5 text-blue-600" />
              <div>
                <span className="font-medium">自动帮助盟友</span>
                <p className="text-xs text-gray-400">检测帮助图标并自动点击帮助</p>
              </div>
            </label>

            <label className={`flex items-center gap-3 p-4 rounded-lg cursor-pointer hover:bg-gray-600 ${features.autoExplore ? 'bg-gray-800 opacity-50 pointer-events-none' : 'bg-gray-700'}`}>
              <input type="checkbox" checked={features.collectResources} disabled={features.autoExplore}
                onChange={(e) => setFeatures({ ...features, collectResources: e.target.checked })}
                className="w-5 h-5 text-blue-600" />
              <div>
                <span className="font-medium">自动收集资源</span>
                <p className="text-xs text-gray-400">自动收集所有农场、矿场产出</p>
              </div>
            </label>

            <label className={`flex items-center gap-3 p-4 rounded-lg cursor-pointer hover:bg-gray-600 ${features.autoExplore ? 'bg-gray-800 opacity-50 pointer-events-none' : 'bg-gray-700'}`}>
              <input type="checkbox" checked={features.upgradeBuildings} disabled={features.autoExplore}
                onChange={(e) => setFeatures({ ...features, upgradeBuildings: e.target.checked })}
                className="w-5 h-5 text-blue-600" />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">自动升级建筑</span>
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
                  {features.completedBuildings.some(Boolean) && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        const { selected, completed } = clearCompleted(features.selectedBuildings, features.completedBuildings);
                        loopCompletedBuildings = completed;
                        setFeatures(prev => ({ ...prev, selectedBuildings: selected, completedBuildings: completed }));
                      }}
                      className="px-2 py-1 text-xs bg-red-800 hover:bg-red-700 text-red-200 rounded whitespace-nowrap"
                    >
                      清除已完成
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">确保资源足够升级建筑</p>
              </div>
            </label>

            <div className={`flex items-center gap-3 p-4 rounded-lg hover:bg-gray-600 ${features.autoExplore ? 'bg-gray-800 opacity-50 pointer-events-none' : 'bg-gray-700'}`}>
              <input type="checkbox" checked={features.autoResearch} disabled={features.autoExplore}
                onChange={(e) => {
                  if (e.target.checked && !buildingOptions.includes('学院')) {
                    alert('请在坐标配置页标记学院位置');
                    return;
                  }
                  setFeatures({ ...features, autoResearch: e.target.checked });
                }}
                className="w-5 h-5 text-blue-600 cursor-pointer" />
              <div className="flex-1">
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
                        loopCompletedTechs = completed;
                        setFeatures(prev => ({ ...prev, selectedTechs: selected, completedTechs: completed }));
                      }}
                      className="px-2 py-1 text-xs bg-red-800 hover:bg-red-700 text-red-200 rounded whitespace-nowrap"
                    >
                      清除已完成
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">请确保已标记学院坐标及资源充足</p>
              </div>
            </div>

            <label className={`flex items-center gap-3 p-4 rounded-lg cursor-pointer hover:bg-gray-600 ${features.autoExplore ? 'bg-gray-800 opacity-50 pointer-events-none' : 'bg-gray-700'}`}>
              <input type="checkbox" checked={features.gatherResources} disabled={features.autoExplore}
                onChange={(e) => setFeatures({ ...features, gatherResources: e.target.checked })}
                className="w-5 h-5 text-blue-600" />
              <div className="flex-1">
                <span className="font-medium">城外资源采集</span>
                <div className="flex gap-1 mt-2">
                  {features.gatherTasks.map((task, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <select value={task.type} disabled={features.autoExplore} onChange={(e) => {
                        const next = [...features.gatherTasks]; next[i] = { ...next[i], type: e.target.value };
                        setFeatures({ ...features, gatherTasks: next });
                      }}
                      className="px-1 py-1 bg-gray-800 rounded text-xs border border-gray-600 w-16">
                        <option value="">-</option>
                        {RESOURCE_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                      </select>
                      <select value={task.level} disabled={features.autoExplore} onChange={(e) => {
                        const next = [...features.gatherTasks]; next[i] = { ...next[i], level: Number(e.target.value) };
                        setFeatures({ ...features, gatherTasks: next });
                      }}
                      className="px-1 py-1 bg-gray-800 rounded text-xs border border-gray-600 w-16">
                        {RESOURCE_LEVELS.map(l => (<option key={l} value={l}>Lv.{l}</option>))}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">5个队伍按顺序派出采集</p>
              </div>
            </label>

            <label className={`flex items-start gap-3 p-4 rounded-lg cursor-pointer hover:bg-gray-600 ${features.autoExplore ? 'bg-gray-800 opacity-50 pointer-events-none' : 'bg-gray-700'}`}>
              <input type="checkbox" checked={features.trainTroops} disabled={features.autoExplore}
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
                className="w-5 h-5 text-blue-600 mt-1" />
              <div className="flex-1">
                <span className="font-medium">自动训练兵种</span>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {(['兵营', '马厩', '靶场', '攻城武器厂'] as const).map(building => (
                    <div key={building} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-16">{building}</span>
                      <select value={(features.trainTasks as Record<string, number>)[building] ?? 0} disabled={features.autoExplore} onChange={(e) => {
                        const next = { ...features.trainTasks as Record<string, number>, [building]: Number(e.target.value) };
                        setFeatures({ ...features, trainTasks: next });
                      }}
                      className="px-1 py-1 bg-gray-800 rounded text-xs border border-gray-600 w-16">
                        <option value={0}>-</option>
                        {TRAIN_TIERS.map(t => (<option key={t} value={t}>T{t}</option>))}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">需标记对应建筑坐标</p>
              </div>
            </label>

            <label className={`flex items-center gap-3 p-4 rounded-lg cursor-pointer hover:bg-gray-700 ${features.autoExplore ? 'bg-purple-700 ring-2 ring-purple-400' : 'bg-gray-700'}`}>
              <input type="checkbox" checked={features.autoExplore}
                onChange={(e) => {
                  if (e.target.checked && !buildingOptions.includes('斥候营地')) {
                    alert('请在坐标配置页标记斥候营地位置');
                    return;
                  }
                  setFeatures({ ...features, autoExplore: e.target.checked });
                }}
                className="w-5 h-5 text-purple-500" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">自动探索</span>
                  {features.autoExplore && <span className="text-xs px-1.5 py-0.5 bg-purple-500 text-white rounded">独立模式</span>}
                  <span className="text-xs text-gray-400">派出</span>
                  <select value={features.exploreCount} onChange={(e) => {
                    setFeatures({ ...features, exploreCount: Number(e.target.value) });
                  }}
                  className="px-1 py-1 bg-gray-800 rounded text-xs border border-gray-600 w-12">
                    {[1, 2, 3].map(n => (<option key={n} value={n}>{n}</option>))}
                  </select>
                  <span className="text-xs text-gray-400">个斥候</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">需标记斥候营地坐标</p>
                {features.autoExplore && (
                  <p className="text-xs text-yellow-400 mt-1">⚠ 探索模式已开启，其他功能已暂停</p>
                )}
              </div>
            </label>
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold">运行日志</h3>
            <Link to="/tasks" className="text-xs text-gray-600 hover:text-gray-400">调试</Link>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 h-48 overflow-y-auto font-mono text-sm">
            {logs.length === 0 ? (
              <p className="text-gray-500">等待开始运行...</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="py-1 border-b border-gray-800">{log}</div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
