import { useState, useEffect } from 'react';
import { api, Plugin } from '../api/client';
import { useNavigate } from 'react-router-dom';

export function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadPlugins();
  }, []);

  const loadPlugins = async () => {
    try {
      const result = await api.plugins.list();
      if (result.success) {
        setPlugins(result.plugins);
      }
    } catch (e) {
      console.error('Failed to load plugins');
    }
    setLoading(false);
  };

  const handleRunAction = async (pluginId: string, actionId: string) => {
    const key = `${pluginId}-${actionId}`;
    setRunningAction(key);
    try {
      const result = await api.tasks.create(pluginId, actionId);
      if (result.success) {
        await api.tasks.run(result.task.id);
        navigate('/tasks');
      }
    } catch (e) {
      console.error('Failed to run action');
    }
    setRunningAction(null);
  };

  if (loading) {
    return <div className="text-xl">加载中...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">插件管理</h1>

      <div className="space-y-6">
        {plugins.map(plugin => (
          <div key={plugin.id} className="bg-gray-800 rounded-lg p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold">{plugin.name}</h2>
                <p className="text-sm text-gray-400">v{plugin.version}</p>
                {plugin.author && <p className="text-xs text-gray-500">作者: {plugin.author}</p>}
                <p className="mt-2 text-gray-300">{plugin.description}</p>
              </div>
            </div>

            <h3 className="text-lg font-semibold mb-3">可用操作</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {plugin.actions.map(action => (
                <div key={action.id} className="bg-gray-700 p-4 rounded flex justify-between items-center">
                  <div>
                    <p className="font-medium">{action.name}</p>
                    <p className="text-sm text-gray-400">{action.description}</p>
                  </div>
                  <button
                    onClick={() => handleRunAction(plugin.id, action.id)}
                    disabled={runningAction === `${plugin.id}-${action.id}`}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm disabled:opacity-50"
                  >
                    {runningAction === `${plugin.id}-${action.id}` ? '运行中...' : '运行'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
