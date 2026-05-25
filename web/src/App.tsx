import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { HomePage } from './pages/Home';

import { PluginsPage } from './pages/Plugins';
import { TasksPage } from './pages/Tasks';
import { ConfigPage } from './pages/Config';
import { AccountsPage } from './pages/Accounts';
import ActivationPage from './pages/Activation';
import { AccountProvider } from './contexts/AccountContext';
import { LicenseProvider, useLicense } from './contexts/LicenseContext';

function RemainingTime({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const ms = Math.max(0, expiresAt - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);

  if (ms <= 0) return <span className="text-sm text-red-400">已到期</span>;

  const parts = [];
  if (d > 0) parts.push(`${d}天`);
  if (h > 0 || d > 0) parts.push(`${h}小时`);
  parts.push(`${m}分钟`);

  return <span className="text-sm text-slate-500">剩余: {parts.join('')}</span>;
}

function RenewButton() {
  const { activate, preview } = useLicense();
  const [mode, setMode] = useState<'idle' | 'input' | 'loading' | 'msg'>('idle');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);

  const handleRenew = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setMode('loading');
    const previewResult = await preview(trimmed);
    if (!previewResult.success) {
      setMsg('激活码无效：' + previewResult.error);
      setMsgOk(false);
      setMode('msg');
      return;
    }
    const result = await activate(trimmed);
    if (result.success) {
      setMsg('续费成功！有效期已延长');
      setMsgOk(true);
    } else {
      setMsg('激活失败：' + result.error);
      setMsgOk(false);
    }
    setMode('msg');
  };

  if (mode === 'input' || mode === 'loading') {
    return (
      <form onSubmit={e => { e.preventDefault(); handleRenew(); }}
        className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <input
          autoFocus
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="输入激活码"
          disabled={mode === 'loading'}
          className="px-2 py-0.5 text-sm bg-white border border-slate-300 rounded text-slate-800 w-32 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        />
        <button type="submit" disabled={mode === 'loading'}
          className="text-sm text-emerald-600 hover:text-emerald-500 px-1 py-0.5 rounded hover:bg-slate-100 disabled:opacity-50">
          {mode === 'loading' ? '...' : '确认'}
        </button>
        <button type="button" onClick={() => { setMode('idle'); setCode(''); }}
          className="text-sm text-slate-500 hover:text-red-500 px-1 py-0.5 rounded hover:bg-slate-100">
          取消
        </button>
      </form>
    );
  }

  if (mode === 'msg') {
    return (
      <span className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <span className={`text-sm ${msgOk ? 'text-green-400' : 'text-red-400'}`}>{msg}</span>
        <button onClick={() => { setMode('idle'); setCode(''); }}
          className="text-sm text-slate-500 hover:text-emerald-600 px-1 py-0.5 rounded hover:bg-slate-100">
          关闭
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setMode('input')}
      className="text-sm text-emerald-600 hover:text-emerald-500 px-2 py-1 rounded hover:bg-slate-100"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      续费
    </button>
  );
}

function NavBar() {
  const { status } = useLicense();
  const isElectron = typeof window !== 'undefined' && 'electronAPI' in window;
  const location = useLocation();

  const linkClass = (path: string) =>
    `px-3 py-1.5 rounded text-sm transition-colors ${
      location.pathname === path
        ? 'bg-emerald-100 text-emerald-500 font-medium'
        : 'text-slate-500 hover:text-emerald-600 hover:bg-slate-100'
    }`;

  return (
    <nav className="bg-white px-6 py-0 h-14 border-b border-slate-200 shadow-sm shrink-0 flex items-center" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="flex gap-4 items-center w-full">
        <Link to="/" className="flex items-center gap-2.5 font-bold text-base text-slate-800" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <span className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-400 rounded-[10px] flex items-center justify-center text-lg">⚔️</span>
          ROK助手
        </Link>
        <Link to="/" className={linkClass('/')} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>首页</Link>
        <Link to="/config" className={linkClass('/config')} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>坐标配置</Link>

        <Link to="/accounts" className={linkClass('/accounts')} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>模拟器配置</Link>

        <div className="flex-1" />

        {/* License status */}
        {status?.activated && status.expiresAt && (
          <>
            <span className="bg-emerald-100 text-emerald-500 px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> 已激活
            </span>
            <RemainingTime expiresAt={status.expiresAt} />
            <RenewButton />
          </>
        )}

        {/* Electron controls */}
        {isElectron && (
          <>
            <button
              onClick={() => window.electronAPI!.minimizeWindow()}
              className="text-sm text-slate-500 hover:text-slate-700 w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center leading-none transition-colors"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title="最小化"
            >
              &#x2212;
            </button>
            <button
              onClick={() => window.electronAPI!.closeApp()}
              className="text-sm text-slate-500 hover:text-red-500 w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-red-50 flex items-center justify-center leading-none transition-colors"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title="退出"
            >
              &#x00d7;
            </button>
          </>
        )}
      </div>
    </nav>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-100 text-slate-800 flex items-center justify-center">
          <div className="bg-red-900 p-8 rounded-lg max-w-lg">
            <h1 className="text-xl font-bold mb-4">React 渲染错误</h1>
            <pre className="text-sm whitespace-pre-wrap">{this.state.error?.message}</pre>
            <pre className="text-xs mt-2 text-gray-400 whitespace-pre-wrap">{this.state.error?.stack}</pre>
          </div>
        </div>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

function LicenseGate({ children }: { children: React.ReactNode }) {
  const { status, loading } = useLicense();

  if (loading) {
    return (
      <div className="min-h-screen bg-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500">加载中...</p>
        </div>
      </div>
    );
  }

  if (!status?.activated || status.isExpired || status.isOffline) {
    return <ActivationPage />;
  }

  return <>{children}</>;
}

function AppContent() {
  return (
    <LicenseGate>
      <AccountProvider>
        <div className="h-screen bg-slate-100 text-slate-800 flex flex-col">
          <NavBar />
          <div className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<HomePage />} />

              <Route path="/config" element={<ConfigPage />} />
              <Route path="/plugins" element={<PluginsPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
            </Routes>
          </div>
        </div>
      </AccountProvider>
    </LicenseGate>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <LicenseProvider>
          <AppContent />
        </LicenseProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
