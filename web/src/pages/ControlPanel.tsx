import { useState } from 'react';

interface ControlPanelProps {
  deviceOnline: boolean;
  loopRunning: boolean;
  onSendCommand: (action: string, payload?: any) => Promise<any>;
}

export default function ControlPanel({ deviceOnline, loopRunning, onSendCommand }: ControlPanelProps) {
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const [toast, setToast] = useState('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handleStart() {
    setBusy('start');
    try {
      const result = await onSendCommand('start_loop');
      if (result.success) showToast('已发送启动指令');
      else showToast(`启动失败：${result.error || '未知错误'}`);
    } catch (e: any) {
      showToast(`错误：${e.message || e}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleStop() {
    setBusy('stop');
    try {
      const result = await onSendCommand('stop_loop');
      if (result.success) showToast('已发送停止指令');
      else showToast(`停止失败：${result.error || '未知错误'}`);
    } catch (e: any) {
      showToast(`错误：${e.message || e}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 space-y-4">
      {!deviceOnline && (
        <div className="bg-amber-900/30 border border-amber-600 rounded-xl p-3 text-amber-200 text-sm">
          ⚠️ 电脑端离线，无法发送指令。请确认电脑已开机且 SLG 助手在运行。
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div className="text-sm text-slate-400">当前状态</div>
        <div className="text-2xl font-bold mt-1">
          {loopRunning ? '🟢 运行中' : '⚪ 已停止'}
        </div>
      </div>

      <button
        onClick={handleStart}
        disabled={!deviceOnline || busy !== null || loopRunning}
        className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl text-lg font-medium transition-colors"
      >
        {busy === 'start' ? '发送中...' : loopRunning ? '已在运行' : '▶️ 开始运行'}
      </button>

      <button
        onClick={handleStop}
        disabled={!deviceOnline || busy !== null || !loopRunning}
        className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl text-lg font-medium transition-colors"
      >
        {busy === 'stop' ? '发送中...' : '⏹️ 停止运行'}
      </button>

      {toast && (
        <div className="fixed bottom-24 left-4 right-4 bg-slate-700 text-white rounded-lg px-4 py-3 text-sm text-center shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
