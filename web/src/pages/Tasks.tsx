import { useState, useEffect } from 'react';
import { api, Task } from '../api/client';
import { useAccount } from '../contexts/AccountContext';

export function TasksPage() {
  const { accounts } = useAccount();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTasks = async () => {
    try {
      const result = await api.tasks.list();
      if (result.success) setTasks(result.tasks);
    } catch { /* retry on next interval */ }
    setLoading(false);
  };

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  const getAccountName = (accountId: string) => {
    const a = accounts.find(ac => ac.id === accountId);
    return a ? a.name : accountId.slice(-8);
  };

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'running': return 'bg-emerald-500 animate-pulse';
      case 'error': return 'bg-red-500';
      case 'stopped': return 'bg-amber-500';
      default: return 'bg-slate-400';
    }
  };

  const getStatusText = (status: Task['status']) => {
    switch (status) {
      case 'completed': return '已完成';
      case 'running': return '运行中';
      case 'error': return '错误';
      case 'stopped': return '已停止';
      default: return '等待中';
    }
  };

  const handleStopTask = async (taskId: string) => {
    try {
      await api.tasks.stop(taskId);
      loadTasks();
    } catch { /* ignore */ }
  };

  if (loading) {
    return <div className="text-xl">加载中...</div>;
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <h1 className="text-2xl font-bold mb-4 flex-shrink-0">任务中心</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        <div className="lg:col-span-1 flex flex-col min-h-0">
          <h2 className="text-lg font-semibold mb-3 flex-shrink-0">任务列表</h2>
          <div className="space-y-2 overflow-y-auto flex-1 pr-1">
            {tasks.length === 0 ? (
              <p className="text-slate-400">暂无任务</p>
            ) : (
              tasks.map(task => (
                <div key={task.id} onClick={() => setSelectedTask(task)}
                  className={`p-3 rounded-lg cursor-pointer transition-colors border ${selectedTask?.id === task.id ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-100 hover:bg-slate-50 shadow-sm'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${getStatusColor(task.status)}`}></span>
                    <span className="font-medium truncate">{task.actionId}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {task.startTime ? new Date(task.startTime).toLocaleString('zh-CN') : '-'}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2 min-h-0">
          {selectedTask ? (
            <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-100 h-full flex flex-col">
              <div className="flex justify-between items-center mb-4 flex-shrink-0">
                <div>
                  <h2 className="text-xl font-bold">{selectedTask.actionId}</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    账号: {getAccountName(selectedTask.accountId)}
                    <span className="mx-2">|</span>
                    插件: {selectedTask.pluginId}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded text-sm text-white ${getStatusColor(selectedTask.status)}`}>
                    {getStatusText(selectedTask.status)}
                  </span>
                  {selectedTask.status === 'running' && (
                    <button onClick={() => handleStopTask(selectedTask.id)}
                      className="px-4 py-1 bg-red-500 hover:bg-red-600 rounded text-sm font-medium text-white">
                      停止任务
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4 text-sm flex-shrink-0">
                <div>
                  <p className="text-slate-500">任务ID</p>
                  <p className="font-mono text-xs">{selectedTask.id}</p>
                </div>
                <div>
                  <p className="text-slate-500">账号ID</p>
                  <p className="font-mono text-xs">{selectedTask.accountId}</p>
                </div>
              </div>

              <div className="flex-1 min-h-0 flex flex-col">
                <h3 className="font-semibold mb-2 flex-shrink-0">执行日志</h3>
                <div className="bg-slate-50 rounded-lg p-4 overflow-y-auto font-mono text-sm border border-slate-100 flex-1">
                  {selectedTask.logs.length === 0 ? (
                    <p className="text-slate-400">暂无日志</p>
                  ) : (
                    selectedTask.logs.map((log, i) => (
                      <p key={i} className="py-1">{log}</p>
                    ))
                  )}
                </div>
              </div>

              {selectedTask.error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-300 rounded-lg text-red-700 flex-shrink-0">
                  <p className="font-semibold">错误信息</p>
                  <p className="font-mono text-sm mt-1">{selectedTask.error}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm p-6 text-center text-slate-400 border border-slate-100 h-full flex items-center justify-center">
              选择一个任务查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
