import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAccount } from '../contexts/AccountContext';

// Module-level loop state — survives component unmount/remount during SPA navigation
let loopStopped = false;
let loopRunning = false;
let loopLogs: string[] = [];

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

function getLoopState(): { accountId: string; logs: string[] } | null {
  try {
    const data = sessionStorage.getItem(LOOP_STATE_KEY);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

function TechSelect({ value, onChange, excludeValues, economicTechs, militaryTechs }: {
  value: string;
  onChange: (v: string) => void;
  excludeValues: string[];
  economicTechs: string[];
  militaryTechs: string[];
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
        className="px-2 py-1 bg-gray-800 rounded text-sm border border-gray-600 w-24 text-left truncate flex items-center justify-between"
      >
        <span className="truncate">{value || <span className="text-gray-500">-</span>}</span>
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
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [taskRunning, setTaskRunning] = useState(false);
  const runningTaskIdsRef = useRef<string[]>([]);
  const [runningTaskIds, setRunningTaskIds] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>(loopLogs);
  useEffect(() => { loopLogs = logs; }, [logs]);
  const DEFAULT_FEATURES = {
    collectResources: true,
    upgradeBuildings: true,
    selectedBuildings: ['', '', '', '', ''] as string[],
    autoResearch: false,
    selectedTechs: ['', '', '', '', ''] as string[],
    gatherResources: false,
    gatherTasks: [
      { type: '农田', level: 5 },
      { type: '伐木场', level: 4 },
      { type: '石矿', level: 3 },
      { type: '金矿', level: 2 },
      { type: '', level: 1 },
    ],
    loopInterval: 300,
  };

  const loadFeatures = () => {
    try {
      const saved = localStorage.getItem('home-features');
      if (saved) return { ...DEFAULT_FEATURES, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_FEATURES;
  };

  const [features, setFeatures] = useState(loadFeatures);

  useEffect(() => {
    localStorage.setItem('home-features', JSON.stringify(features));
  }, [features]);

  const RESOURCE_TYPES = ['农田', '伐木场', '石矿', '金矿'];
  const RESOURCE_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8];

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

  // 恢复运行状态：挂载时检查是否有正在执行的任务或持久化的循环状态
  useEffect(() => {
    if (!currentAccountId) return;
    // 先查 sessionStorage（覆盖任务间等待期）
    const savedLoop = getLoopState();
    if (savedLoop && savedLoop.accountId === currentAccountId) {
      loopRunning = true;
      loopStopped = false;
      setTaskRunning(true);
      if (savedLoop.logs?.length) {
        loopLogs = savedLoop.logs;
        setLogs(savedLoop.logs);
      }
      // 同时查询正在运行的任务ID用于停止
      api.tasks.list().then(res => {
        if (res.success) {
          const running = res.tasks.filter(t => t.accountId === currentAccountId && t.status === 'running');
          if (running.length > 0) {
            runningTaskIdsRef.current = running.map(t => t.id);
            setRunningTaskIds(running.map(t => t.id));
          }
        }
      }).catch(() => {});
      return;
    }
    // 兼容旧版：无 sessionStorage 时回退到检查运行中的任务
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

  const handleConnectDevice = async () => {
    if (!currentAccountId) return;
    setDeviceLoading(true);
    try {
      const result = await api.device.connect(currentAccountId);
      setDeviceConnected(result.connected);
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

    if (selectedActions.length === 0) {
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 请至少勾选一个功能`]);
      return;
    }

    if (loopRunning) return;
    loopRunning = true;
    loopStopped = false;
    saveLoopState(currentAccountId);
    setTaskRunning(true);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🚀 开始循环执行: ${selectedActions.join(' + ')} (间隔${features.loopInterval}秒)`]);

    const sleep = async (s: number) => new Promise(r => setTimeout(r, s * 1000));

    // Fire and forget, stop button will cancel via task IDs
    (async () => {
      let round = 0;
      while (!loopStopped) {
        round++;
        setLogs(prev => { const next = [...prev, `[${new Date().toLocaleTimeString()}] 🔄 第${round}轮开始`]; saveLoopState(currentAccountId); return next; });

        const ids: string[] = [];

        const runTask = async (actionId: string, config?: Record<string, any>): Promise<string[]> => {
          if (loopStopped) return [];
          try {
            const createResult = await api.tasks.create(currentAccountId, 'com.rok.automation', actionId, config);
            if (createResult.success) {
              ids.push(createResult.task.id);
              runningTaskIdsRef.current = [...ids];
              setRunningTaskIds([...ids]);
              const runResult = await api.tasks.run(createResult.task.id);
              setLogs(prev => { const next = [...prev, `[${new Date().toLocaleTimeString()}] ✅ ${createResult.task.actionId} 完成`]; saveLoopState(currentAccountId); return next; });
              return runResult.task?.logs ?? [];
            }
          } catch (e) {
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ 执行失败: ${e}`]);
          }
          return [];
        };

        if (features.collectResources) await runTask('collect-resources');

        if (features.upgradeBuildings && !loopStopped) {
          const targetBuildings = features.selectedBuildings.filter(b => b);
          if (targetBuildings.length > 0) {
            const logs = await runTask('upgrade-buildings', { targetBuildings });
            // 从日志中解析成功升级的建筑，从队列移除
            const succeeded = targetBuildings.filter(b =>
              logs.some(l => l.includes(`✅ ${b} 升级成功`))
            );
            if (succeeded.length > 0) {
              setFeatures(prev => ({
                ...prev,
                selectedBuildings: prev.selectedBuildings.map(b => succeeded.includes(b) ? '' : b)
              }));
            }
          }
        }

        if (features.autoResearch && !loopStopped) {
          if (!buildingOptions.includes('学院')) {
            setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⚠️ 未标记学院位置，跳过研究科技`]);
          } else {
            const techs = features.selectedTechs.filter(t => t);
            if (techs.length > 0) {
              const logs = await runTask('research-tech-queue', { targetTechs: techs, researchBuilding: '学院' });
              // 从日志中解析成功研究的科技，从队列移除
              const succeeded = techs.filter(t =>
                logs.some(l => l.includes(`✅ ${t} 研究成功`))
              );
              if (succeeded.length > 0) {
                setFeatures(prev => ({
                  ...prev,
                  selectedTechs: prev.selectedTechs.map(t => succeeded.includes(t) ? '' : t)
                }));
              }
            }
          }
        }

        if (features.gatherResources && !loopStopped) {
          const gatherTasks = features.gatherTasks
            .map((t, i) => ({ ...t, team: i + 1 }))
            .filter(t => t.type);
          if (gatherTasks.length > 0) await runTask('gather-resources', { gatherTasks });
        }

        if (loopStopped) break;
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ⏳ 等待 ${features.loopInterval} 秒...`]);
        // 可中断的等待
        const startWait = Date.now();
        while (!loopStopped && (Date.now() - startWait) < features.loopInterval * 1000) {
          await sleep(1);
        }
      }
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
    for (const id of runningTaskIdsRef.current) {
      try { await api.tasks.stop(id); } catch { /* ok */ }
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
          <h1 className="text-2xl font-bold text-blue-400">万国觉醒自动化助手</h1>
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
            <label className="flex items-center gap-3 p-4 bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-600">
              <input type="checkbox" checked={features.collectResources}
                onChange={(e) => setFeatures({ ...features, collectResources: e.target.checked })}
                className="w-5 h-5 text-blue-600" />
              <div>
                <span className="font-medium">自动收集资源</span>
                <p className="text-xs text-gray-400">自动收集所有农场、矿场产出</p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-4 bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-600">
              <input type="checkbox" checked={features.upgradeBuildings}
                onChange={(e) => setFeatures({ ...features, upgradeBuildings: e.target.checked })}
                className="w-5 h-5 text-blue-600" />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">自动升级建筑</span>
                  {features.selectedBuildings.map((val, i) => (
                    <select key={i} value={val} onChange={(e) => {
                      const next = [...features.selectedBuildings]; next[i] = e.target.value;
                      setFeatures({ ...features, selectedBuildings: next });
                    }}
                    className="px-2 py-1 bg-gray-800 rounded text-sm border border-gray-600 w-20">
                      <option value="">-</option>
                      {buildingOptions.filter(name => !features.selectedBuildings.includes(name) || name === features.selectedBuildings[i])
                        .map(name => (<option key={name} value={name}>{name}</option>))}
                    </select>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">确保资源足够升级建筑</p>
              </div>
            </label>

            <div className="flex items-center gap-3 p-4 bg-gray-700 rounded-lg hover:bg-gray-600">
              <input type="checkbox" checked={features.autoResearch}
                onChange={(e) => setFeatures({ ...features, autoResearch: e.target.checked })}
                className="w-5 h-5 text-blue-600 cursor-pointer" />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">自动研究科技</span>
                  {features.selectedTechs.map((val, i) => (
                    <TechSelect key={i} value={val}
                      onChange={(v) => {
                        const next = [...features.selectedTechs]; next[i] = v;
                        setFeatures({ ...features, selectedTechs: next });
                      }}
                      excludeValues={features.selectedTechs}
                      economicTechs={economicTechs}
                      militaryTechs={militaryTechs}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">请确保已标记学院坐标及资源充足</p>
              </div>
            </div>

            <label className="flex items-center gap-3 p-4 bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-600">
              <input type="checkbox" checked={features.gatherResources}
                onChange={(e) => setFeatures({ ...features, gatherResources: e.target.checked })}
                className="w-5 h-5 text-blue-600" />
              <div className="flex-1">
                <span className="font-medium">城外资源采集</span>
                <div className="flex gap-1 mt-2">
                  {features.gatherTasks.map((task, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <select value={task.type} onChange={(e) => {
                        const next = [...features.gatherTasks]; next[i] = { ...next[i], type: e.target.value };
                        setFeatures({ ...features, gatherTasks: next });
                      }}
                      className="px-1 py-1 bg-gray-800 rounded text-xs border border-gray-600 w-16">
                        <option value="">-</option>
                        {RESOURCE_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                      </select>
                      <select value={task.level} onChange={(e) => {
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
