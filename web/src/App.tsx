import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Link } from 'react-router-dom';
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

  return <span className="text-sm text-gray-400">剩余: {parts.join('')}</span>;
}

function NavBar() {
  const { status, activate, preview } = useLicense();
  const isElectron = typeof window !== 'undefined' && 'electronAPI' in window;

  return (
    <nav className="bg-gray-800 p-4 border-b border-gray-700" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="container mx-auto flex gap-6 items-center">
        <Link to="/" className="text-xl font-bold text-blue-400" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>ROK助手</Link>
        <Link to="/" className="hover:text-blue-400">首页</Link>
        <Link to="/config" className="hover:text-blue-400">坐标配置</Link>

        <Link to="/accounts" className="hover:text-blue-400">模拟器配置</Link>

        <div className="flex-1" />

        {/* Electron controls */}
        {isElectron && (
          <>
            <button
              onClick={() => window.electronAPI!.minimizeToTray()}
              className="text-sm text-gray-400 hover:text-blue-400 px-2 py-1 rounded hover:bg-gray-700"
              title="最小化到系统托盘 (关闭窗口不退出)"
            >
              最小化到托盘
            </button>
            <button
              onClick={() => window.electronAPI!.closeApp()}
              className="text-sm text-red-500 hover:text-red-400 px-2 py-1 rounded hover:bg-gray-700"
              title="完全退出应用"
            >
              退出
            </button>
          </>
        )}

        {/* License status */}
        {status?.activated && status.expiresAt && (
          <>
            <RemainingTime expiresAt={status.expiresAt} />
            <button
              onClick={async () => {
                const newCode = prompt('请输入新的激活码：');
                if (!newCode?.trim()) return;

                const previewResult = await preview(newCode.trim());
                if (!previewResult.success) {
                  alert('激活码无效：' + previewResult.error);
                  return;
                }

                const result = await activate(newCode.trim());
                if (result.success) {
                  alert('续费成功！有效期已延长');
                } else {
                  alert('激活失败：' + result.error);
                }
              }}
              className="text-sm text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-gray-700"
            >
              续费
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
        <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">加载中...</p>
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
        <div className="min-h-screen bg-gray-900 text-white">
          <NavBar />
          <Routes>
            <Route path="/" element={<HomePage />} />

            <Route path="/config" element={<ConfigPage />} />
            <Route path="/plugins" element={<PluginsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
          </Routes>
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
