import { useState } from 'react';

interface ControlPanelProps {
  deviceOnline: boolean;
  runningTasks: string[];
  onSendCommand: (action: string, payload?: any) => Promise<any>;
}

const TASKS = [
  { key: 'gem_gather', label: '💎 宝石采集', actionId: 'com.rok.automation:gem-gather' },
  { key: 'rally_join', label: '🏰 加入集结', actionId: 'com.rok.automation:join-rally' },
  { key: 'cave_explore', label: '🗻 山洞探索', actionId: 'com.rok.automation:cave-explore' },
  { key: 'research_tech', label: '🔬 科技研究', actionId: 'com.rok.automation:research-tech' },
];

export default function ControlPanel({ deviceOnline, runningTasks, onSendCommand }: ControlPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  function isRunning(actionId: string): boolean {
    return runningTasks.includes(actionId);
  }

  async function handleStart(task: typeof TASKS[number]) {
    setBusy(task.key);
    try {
      const result = await onSendCommand('start_task', { task: task.key });
      if (result.success) setToast(`已启动：${task.label}`);
      else setToast(`启动失败：${result.error || '未知错误'}`);
    } catch (e: any) {
      setToast(`错误：${e.message || e}`);
    } finally {
      setBusy(null);
      setTimeout(() => setToast(''), 3000);
    }
  }

  async function handleStopAll() {
    if (!confirm('确定停止所有运行中的任务？')) return;
    setBusy('stop_all');
    try {
      const result = await onSendCommand('stop_all');
      if (result.success) setToast('已停止所有任务');
      else setToast(`停止失败：${result.error || '未知错误'}`);
    } catch (e: any) {
      setToast(`错误：${e.message || e}`);
    } finally {
      setBusy(null);
      setTimeout(() => setToast(''), 3000);
    }
  }

  return (
    <div className="p-4 space-y-4">
      {!deviceOnline && (
        <div className="bg-amber-900/30 border border-amber-600 rounded-xl p-3 text-amber-200 text-sm">
          ⚠️ 电脑端离线，无法发送指令。请确认电脑已开机且 SLG 助手在运行。
        </div>
      )}

      <div className="space-y-3">
        {TASKS.map(t => {
          const running = isRunning(t.actionId);
          return (
            <div key={t.key} className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{t.label}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {running ? '🟢 运行中' : '⚪ 空闲'}
                </div>
              </div>
              <button
                onClick={() => handleStart(t)}
                disabled={!deviceOnline || busy === t.key || running}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-sm font-medium transition-colors"
              >
                {busy === t.key ? '处理中...' : running ? '运行中' : '启动'}
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleStopAll}
        disabled={!deviceOnline || busy !== null || runningTasks.length === 0}
        className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl font-medium transition-colors"
      >
        {busy === 'stop_all' ? '停止中...' : '🛑 停止所有任务'}
      </button>

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 bg-slate-700 text-white rounded-lg px-4 py-3 text-sm text-center shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
