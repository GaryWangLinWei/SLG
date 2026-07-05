import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRemoteSocket, LogEntry } from '../hooks/useRemoteSocket';
import ControlPanel from './ControlPanel';

const SESSION_KEY = 'remote-session-token';
// Electron 打包后走 file://，相对 /api 路径失败；内网模式必须显式指向本地后端
const IS_ELECTRON = typeof window !== 'undefined' && 'electronAPI' in window;
const LOCAL_API_BASE = IS_ELECTRON ? 'http://localhost:3000' : '';
type Tab = 'logs' | 'control' | 'status';

interface LocalLogEntry {
  id: number;
  time: string;
  message: string;
  timestamp: number;
}

export default function MobilePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isRemoteMode = params.get('remote') === '1';
  const sessionToken = isRemoteMode ? localStorage.getItem(SESSION_KEY) : null;

  // 远程模式状态
  const remote = useRemoteSocket(sessionToken);

  // 内网模式状态（保持原有逻辑）
  const [localLogs, setLocalLogs] = useState<LocalLogEntry[]>([]);
  const [localConnected, setLocalConnected] = useState(false);

  // UI 状态
  const [tab, setTab] = useState<Tab>('logs');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 远程模式跳转保护
  useEffect(() => {
    if (isRemoteMode && !sessionToken) navigate('/remote-access');
  }, [isRemoteMode, sessionToken, navigate]);

  // 内网模式：SSE 日志
  useEffect(() => {
    if (isRemoteMode) return;
    fetch(`${LOCAL_API_BASE}/api/logs/history?limit=200`).then(r => r.json()).then(d => setLocalLogs(d.logs || [])).catch(() => {});
    const es = new EventSource(`${LOCAL_API_BASE}/api/logs/stream`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') { setLocalConnected(true); return; }
        if (data.type === 'clear') { setLocalLogs([]); return; }
        if (data.id && data.message) {
          setLocalLogs(prev => [...prev, data].slice(-500));
        }
      } catch {}
    };
    es.onerror = () => setLocalConnected(false);
    return () => es.close();
  }, [isRemoteMode]);

  // 当前激活的日志和状态（过滤掉底层调试日志：[TAP] / [TAP-RECT] / [TAP-IMAGE]）
  const rawLogs: Array<LogEntry | LocalLogEntry> = isRemoteMode ? remote.state.logs : localLogs;
  const logs = rawLogs.filter(l => !/\[TAP(-RECT|-IMAGE)?\]/.test(l.message));
  const connected = isRemoteMode ? remote.state.connected : localConnected;
  const deviceOnline = isRemoteMode ? remote.state.deviceOnline : localConnected;

  // 自动滚动
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleLogout() {
    if (isRemoteMode) {
      localStorage.removeItem(SESSION_KEY);
      navigate('/remote-access');
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white pb-20">
      {/* 顶部状态栏 */}
      <div className="sticky top-0 z-10 bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">📱</span>
            <h1 className="text-lg font-bold">SLG 助手</h1>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {isRemoteMode && (
              <span className="text-xs text-emerald-400 ml-2">
                {deviceOnline ? '🟢 电脑在线' : '🔴 电脑离线'}
              </span>
            )}
          </div>
          {isRemoteMode && (
            <button onClick={handleLogout} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs">
              退出
            </button>
          )}
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="sticky top-[56px] z-10 bg-slate-800/95 border-b border-slate-700 flex">
        {(['logs', 'control', 'status'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-400'
            }`}
          >
            {t === 'logs' ? '日志' : t === 'control' ? '控制' : '状态'}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {tab === 'logs' && (
        <>
          <div className="sticky top-[104px] z-10 bg-slate-800/90 backdrop-blur px-4 py-2 flex items-center justify-end border-b border-slate-700">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)}
                className="w-4 h-4 accent-emerald-500" />
              <span className="text-slate-300">自动滚动</span>
            </label>
          </div>

          <div ref={scrollRef} className="h-[calc(100vh-160px)] overflow-y-auto">
            <div className="px-3 py-2 space-y-0.5 font-mono text-xs">
              {logs.map(log => (
                <div key={log.id}
                  className={`py-1.5 px-2 rounded ${
                    log.message.includes('✅') ? 'bg-green-900/30 text-green-300' :
                    log.message.includes('⚠️') ? 'bg-yellow-900/30 text-yellow-300' :
                    log.message.includes('⛔') ? 'bg-red-900/30 text-red-300' :
                    log.message.includes('💎') ? 'bg-purple-900/30 text-purple-300' :
                    log.message.includes('🏰') ? 'bg-orange-900/30 text-orange-300' :
                    'text-slate-400'
                  }`}>
                  <span className="text-slate-500 mr-2">[{log.time}]</span>
                  {log.message.replace(/\[\d{2}:\d{2}:\d{2}\]\s*/, '')}
                </div>
              ))}
              {logs.length === 0 && (
                <div className="text-center py-10 text-slate-500">暂无日志</div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'control' && isRemoteMode && (
        <ControlPanel
          deviceOnline={remote.state.deviceOnline}
          loopRunning={remote.state.runningTasks.includes('home-loop:running')}
          starting={remote.state.starting}
          onSendCommand={remote.sendCommand}
        />
      )}

      {tab === 'control' && !isRemoteMode && (
        <div className="p-6 text-center text-slate-400 text-sm">
          内网模式不支持远程控制，请在电脑上直接操作
        </div>
      )}

      {tab === 'status' && (
        <div className="p-4 space-y-3">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-sm text-slate-400">设备状态</div>
            <div className="text-lg font-medium mt-1">
              {deviceOnline ? '🟢 在线' : '🔴 离线'}
            </div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-sm text-slate-400">运行中任务</div>
            {isRemoteMode && remote.state.runningTasks.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {remote.state.runningTasks.map(t => (
                  <li key={t} className="text-sm">🟢 {t}</li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-slate-500 mt-2">无</div>
            )}
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-sm text-slate-400">连接信息</div>
            <div className="text-xs text-slate-500 mt-2 space-y-1">
              <div>模式：{isRemoteMode ? '外网（云端）' : '内网（局域网）'}</div>
              <div>WebSocket：{connected ? '已连接' : '已断开'}</div>
              <div>日志总数：{logs.length}</div>
            </div>
          </div>
        </div>
      )}

      {/* 底部状态栏 */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 px-4 py-2 text-center">
        <span className="text-xs text-slate-400">
          共 {logs.length} 条日志 · {connected ? '🟢 已连接' : '🔴 断开'}
        </span>
      </div>
    </div>
  );
}
