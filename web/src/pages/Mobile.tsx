import { useState, useEffect, useRef } from 'react';

interface LogEntry {
  id: number;
  time: string;
  message: string;
  timestamp: number;
}

export default function MobilePage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [onlySuccess, setOnlySuccess] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // 加载历史日志
  useEffect(() => {
    fetch('/api/logs/history?limit=200')
      .then((r) => r.json())
      .then((data) => {
        setLogs(data.logs || []);
      })
      .catch(() => {});
  }, []);

  // SSE 连接
  useEffect(() => {
    const es = new EventSource('/api/logs/stream');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          setConnected(true);
          return;
        }
        if (data.id && data.message) {
          setLogs((prev) => [...prev, data].slice(-500));
        }
      } catch {}
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
    };
  }, []);

  // 自动滚动
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // 过滤日志
  const filteredLogs = onlySuccess
    ? logs.filter((l) => l.message.includes('✅') || l.message.includes('完成'))
    : logs;

  // 统计
  const gemCount = logs.filter((l) => l.message.includes('💎') || l.message.includes('宝石')).length;
  const rallyCount = logs.filter((l) => l.message.includes('🏰') || l.message.includes('集结')).length;

  // 复制链接
  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white pb-20">
      {/* 顶部状态栏 */}
      <div className="sticky top-0 z-10 bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">📱</span>
            <h1 className="text-lg font-bold">SLG 助手</h1>
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
              }`}
            />
          </div>
          <button
            onClick={copyLink}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors"
          >
            复制链接
          </button>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-xl p-3">
            <div className="text-2xl font-bold">{gemCount}</div>
            <div className="text-xs text-purple-200">💎 宝石采集</div>
          </div>
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-3">
            <div className="text-2xl font-bold">{rallyCount}</div>
            <div className="text-xs text-orange-200">🏰 城寨集结</div>
          </div>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="sticky top-[104px] z-10 bg-slate-800/90 backdrop-blur-sm px-4 py-2 flex items-center justify-between border-b border-slate-700">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlySuccess}
            onChange={(e) => setOnlySuccess(e.target.checked)}
            className="w-4 h-4 accent-emerald-500"
          />
          <span className="text-slate-300">仅看成功</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="w-4 h-4 accent-emerald-500"
          />
          <span className="text-slate-300">自动滚动</span>
        </label>
      </div>

      {/* 日志列表 */}
      <div ref={scrollRef} className="h-[calc(100vh-180px)] overflow-y-auto">
        <div className="px-3 py-2 space-y-0.5 font-mono text-xs">
          {filteredLogs.map((log) => (
            <div
              key={log.id}
              className={`py-1.5 px-2 rounded ${
                log.message.includes('✅')
                  ? 'bg-green-900/30 text-green-300'
                  : log.message.includes('⚠️')
                  ? 'bg-yellow-900/30 text-yellow-300'
                  : log.message.includes('⛔')
                  ? 'bg-red-900/30 text-red-300'
                  : log.message.includes('💎')
                  ? 'bg-purple-900/30 text-purple-300'
                  : log.message.includes('🏰')
                  ? 'bg-orange-900/30 text-orange-300'
                  : 'text-slate-400'
              }`}
            >
              <span className="text-slate-500 mr-2">[{log.time}]</span>
              {log.message.replace(/\[\d{2}:\d{2}:\d{2}\]\s*/, '')}
            </div>
          ))}
          {filteredLogs.length === 0 && (
            <div className="text-center py-10 text-slate-500">暂无日志</div>
          )}
        </div>
      </div>

      {/* 底部状态栏 */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 px-4 py-2 text-center">
        <span className="text-xs text-slate-400">
          共 {logs.length} 条日志 · {connected ? '🟢 实时连接中' : '🔴 连接断开'}
        </span>
      </div>
    </div>
  );
}
