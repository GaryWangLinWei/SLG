import { useState, useEffect } from 'react';
import { api, Task } from '../api/client';

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTasks = async () => {
    try {
      const result = await api.tasks.list();
      if (result.success) {
        setTasks(result.tasks);
      }
    } catch (e) {
      console.error('Failed to load tasks');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'running': return 'bg-blue-500 animate-pulse';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = (status: Task['status']) => {
    switch (status) {
      case 'completed': return '已完成';
      case 'running': return '运行中';
      case 'error': return '错误';
      default: return '等待中';
    }
  };

  if (loading) {
    return <div className="text-xl">加载中...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">任务中心</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <h2 className="text-lg font-semibold mb-4">任务列表</h2>
          <div className="space-y-2">
            {tasks.length === 0 ? (
              <p className="text-gray-400">暂无任务</p>
            ) : (
              tasks.map(task => (
                <div
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className={`p-3 rounded cursor-pointer transition-colors ${selectedTask?.id === task.id ? 'bg-blue-900' : 'bg-gray-800 hover:bg-gray-700'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${getStatusColor(task.status)}`}></span>
                    <span className="font-medium truncate">{task.actionId}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {task.startTime ? new Date(task.startTime).toLocaleString('zh-CN') : '-'}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          {selectedTask ? (
            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">{selectedTask.actionId}</h2>
                <span className={`px-3 py-1 rounded text-sm ${getStatusColor(selectedTask.status)}`}>
                  {getStatusText(selectedTask.status)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                <div>
                  <p className="text-gray-400">任务ID</p>
                  <p className="font-mono">{selectedTask.id}</p>
                </div>
                <div>
                  <p className="text-gray-400">插件</p>
                  <p>{selectedTask.pluginId}</p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">执行日志</h3>
                <div className="bg-gray-900 rounded p-4 max-h-96 overflow-y-auto font-mono text-sm">
                  {selectedTask.logs.length === 0 ? (
                    <p className="text-gray-500">暂无日志</p>
                  ) : (
                    selectedTask.logs.map((log, i) => (
                      <p key={i} className="py-1">{log}</p>
                    ))
                  )}
                </div>
              </div>

              {selectedTask.error && (
                <div className="mt-4 p-3 bg-red-900 text-red-200 rounded">
                  <p className="font-semibold">错误信息</p>
                  <p className="font-mono text-sm mt-1">{selectedTask.error}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-800 rounded-lg p-6 text-center text-gray-400">
              选择一个任务查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
