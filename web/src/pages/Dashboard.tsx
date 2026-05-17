import { useState, useEffect } from 'react';
import { api, Account } from '../api/client';
import { Link } from 'react-router-dom';

interface TaskSummary {
  running: number;
  completed: number;
  error: number;
  lastTask?: { id: string; actionId: string; endedAt?: string; status: string };
}

const ACTIONS = [
  { id: 'collect-resources', name: '收集资源' },
  { id: 'upgrade-buildings', name: '升级建筑' },
  { id: 'research-tech', name: '科技研究' },
  { id: 'gather-resources', name: '城外采集' },
];

export function DashboardPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState<Record<string, TaskSummary>>({});
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedAction, setSelectedAction] = useState('collect-resources');
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResults, setBatchResults] = useState<{ accountId: string; success: boolean; error?: string }[]>([]);

  const fetchData = async () => {
    try {
      const [accountsRes, tasksRes] = await Promise.all([
        api.accounts.list(),
        api.tasks.list()
      ]);
      setAccounts(accountsRes.accounts);

      const summaryMap: Record<string, TaskSummary> = {};
      for (const t of tasksRes.tasks) {
        if (!summaryMap[t.accountId]) {
          summaryMap[t.accountId] = { running: 0, completed: 0, error: 0 };
        }
        const s = summaryMap[t.accountId];
        if (t.status === 'running') s.running++;
        if (t.status === 'completed') s.completed++;
        if (t.status === 'error') s.error++;
        if (!s.lastTask || !s.lastTask.endedAt || (t.endTime && t.endTime > (s.lastTask.endedAt || ''))) {
          s.lastTask = { id: t.id, actionId: t.actionId, endedAt: t.endTime, status: t.status };
        }
      }
      setSummary(summaryMap);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return;
    const timer = setInterval(fetchData, 30000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-blue-500';
      case 'completed': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      case 'stopped': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  const formatActionId = (id: string) => {
    const map: Record<string, string> = {
      'collect-resources': '收集资源',
      'upgrade-buildings': '升级建筑',
      'research-tech': '科技研究',
      'gather-resources': '城外采集',
      'loop-collect': '循环收集',
      'loop-upgrade': '循环升级'
    };
    return map[id] || id;
  };

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts(prev =>
      prev.includes(accountId)
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    );
  };

  const selectAllAccounts = () => {
    setSelectedAccounts(accounts.map(a => a.id));
  };

  const clearSelectedAccounts = () => {
    setSelectedAccounts([]);
  };

  const handleBatchRun = async () => {
    setBatchRunning(true);
    setBatchResults([]);

    for (const accountId of selectedAccounts) {
      try {
        const res = await api.tasks.create(accountId, 'com.rok.automation', selectedAction);
        if (res.success) {
          await api.tasks.run(res.task.id);
          setBatchResults(prev => [...prev, { accountId, success: true }]);
        } else {
          setBatchResults(prev => [...prev, { accountId, success: false, error: '创建任务失败' }]);
        }
      } catch (e: any) {
        setBatchResults(prev => [...prev, { accountId, success: false, error: e.message }]);
      }
    }

    setBatchRunning(false);
    setTimeout(fetchData, 2000);
  };

  const totalRunning = Object.values(summary).reduce((s, v) => s + v.running, 0);
  const totalCompleted = Object.values(summary).reduce((s, v) => s + v.completed, 0);
  const totalError = Object.values(summary).reduce((s, v) => s + v.error, 0);
  const selectedAccountNames = accounts.filter(a => selectedAccounts.includes(a.id)).map(a => a.name);

  if (loading && accounts.length === 0) {
    return <div className="text-center py-20">加载中...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">资源监控</h1>
        <div className="flex items-center gap-4">
          <button onClick={() => setShowBatchModal(true)}
            className="px-4 py-2 bg-purple-600 rounded hover:bg-purple-500 font-medium">
            批量执行
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input type="checkbox" checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)} />
            自动刷新 (30秒)
          </label>
          <button onClick={fetchData} className="px-3 py-1 bg-gray-700 rounded text-sm hover:bg-gray-600">
            立即刷新
          </button>
        </div>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-800 p-4 rounded-xl">
          <div className="text-3xl font-bold text-gray-300">{accounts.length}</div>
          <div className="text-sm text-gray-500">总账号数</div>
        </div>
        <div className="bg-gray-800 p-4 rounded-xl">
          <div className="text-3xl font-bold text-blue-400">{totalRunning}</div>
          <div className="text-sm text-gray-500">运行中</div>
        </div>
        <div className="bg-gray-800 p-4 rounded-xl">
          <div className="text-3xl font-bold text-green-400">{totalCompleted}</div>
          <div className="text-sm text-gray-500">已完成</div>
        </div>
        <div className="bg-gray-800 p-4 rounded-xl">
          <div className="text-3xl font-bold text-red-400">{totalError}</div>
          <div className="text-sm text-gray-500">失败任务</div>
        </div>
      </div>

      {/* Account Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.map(account => {
          const s = summary[account.id] || { running: 0, completed: 0, error: 0 };
          return (
            <div key={account.id} className="bg-gray-800 rounded-xl p-5 hover:bg-gray-750">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-bold text-lg">{account.name}</h3>
                  <p className="text-xs text-gray-500 font-mono">{account.deviceId}</p>
                </div>
                <div className={`px-2 py-1 rounded text-xs font-medium ${s.running > 0 ? 'bg-blue-900 text-blue-300' : 'bg-gray-700 text-gray-400'}`}>
                  {s.running > 0 ? `${s.running} 个运行中` : '空闲'}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-gray-900 p-2 rounded text-center">
                  <div className="text-lg font-bold text-blue-400">{s.running}</div>
                  <div className="text-xs text-gray-500">运行中</div>
                </div>
                <div className="bg-gray-900 p-2 rounded text-center">
                  <div className="text-lg font-bold text-green-400">{s.completed}</div>
                  <div className="text-xs text-gray-500">已完成</div>
                </div>
                <div className="bg-gray-900 p-2 rounded text-center">
                  <div className="text-lg font-bold text-red-400">{s.error}</div>
                  <div className="text-xs text-gray-500">失败</div>
                </div>
              </div>

              {s.lastTask && (
                <div className="border-t border-gray-700 pt-3 mb-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className={`w-2 h-2 rounded-full ${getStatusColor(s.lastTask.status)}`}></span>
                    <span>{formatActionId(s.lastTask.actionId)}</span>
                  </div>
                  {s.lastTask.endedAt && (
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(s.lastTask.endedAt).toLocaleString('zh-CN')}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Link to="/" state={{ selectedAccountId: account.id }}
                  className="flex-1 text-center px-3 py-2 bg-blue-600 rounded text-sm hover:bg-blue-500">
                  开始任务
                </Link>
                <Link to={`/tasks?account=${account.id}`}
                  className="flex-1 text-center px-3 py-2 bg-gray-700 rounded text-sm hover:bg-gray-600">
                  查看日志
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {accounts.length === 0 && (
        <div className="text-center py-16 bg-gray-800 rounded-xl">
          <p className="text-gray-400 mb-4">还没有账号</p>
          <Link to="/accounts" className="px-5 py-2 bg-blue-600 rounded hover:bg-blue-500 inline-block">
            去创建第一个账号
          </Link>
        </div>
      )}

      {/* Batch Run Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">批量执行任务</h2>

            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">选择任务类型</label>
              <select value={selectedAction} onChange={e => setSelectedAction(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 rounded-lg border border-gray-600">
                {ACTIONS.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm text-gray-400">选择账号</label>
                <div className="flex gap-3 text-sm">
                  <button onClick={selectAllAccounts} className="text-blue-400 hover:text-blue-300">
                    全选
                  </button>
                  <button onClick={clearSelectedAccounts} className="text-gray-400 hover:text-gray-300">
                    清空
                  </button>
                </div>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {accounts.map(account => {
                  const s = summary[account.id];
                  const isRunning = (s?.running ?? 0) > 0;
                  return (
                    <label key={account.id} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${
                      isRunning ? 'bg-blue-900/30' : 'bg-gray-700'
                    } hover:bg-gray-600`}>
                      <input type="checkbox" checked={selectedAccounts.includes(account.id)}
                        onChange={() => toggleAccount(account.id)} disabled={isRunning}
                        className="w-4 h-4" />
                      <div className="flex-1">
                        <div className="font-medium">{account.name}</div>
                        <div className="text-xs text-gray-500 font-mono">{account.deviceId}</div>
                      </div>
                      {isRunning && <span className="text-xs text-blue-400">运行中</span>}
                    </label>
                  );
                })}
              </div>
              {selectedAccounts.length > 0 && (
                <p className="text-sm text-gray-400 mt-2">
                  已选择 {selectedAccounts.length} 个账号: {selectedAccountNames.join(', ')}
                </p>
              )}
            </div>

            {batchResults.length > 0 && (
              <div className="mb-4 p-3 bg-gray-900 rounded-lg">
                <p className="text-sm text-gray-400 mb-2">执行结果:</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {batchResults.map((r, i) => {
                    const name = accounts.find(a => a.id === r.accountId)?.name || r.accountId;
                    return (
                      <div key={i} className={`text-sm ${r.success ? 'text-green-400' : 'text-red-400'}`}>
                        {name}: {r.success ? '✓ 已启动' : `✗ ${r.error || '失败'}`}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button onClick={handleBatchRun} disabled={batchRunning || selectedAccounts.length === 0}
                className="flex-1 py-2 bg-purple-600 rounded-lg hover:bg-purple-500 disabled:opacity-50 font-medium">
                {batchRunning ? '执行中...' : `开始执行 (${selectedAccounts.length} 个账号)`}
              </button>
              <button onClick={() => { setShowBatchModal(false); setBatchResults([]); }}
                className="px-6 py-2 bg-gray-600 rounded-lg hover:bg-gray-500">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
