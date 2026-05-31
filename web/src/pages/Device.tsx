import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAccount } from '../contexts/AccountContext';

export function DevicePage() {
  const { currentAccountId } = useAccount();
  const [connected, setConnected] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const checkStatus = useCallback(async () => {
    if (!currentAccountId) return;
    try {
      const status = await api.device.status(currentAccountId);
      setConnected(status.connected);
    } catch { setConnected(false); }
  }, [currentAccountId]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleConnect = async () => {
    if (!currentAccountId) return;
    setLoading(true);
    try {
      const result = await api.device.connect(currentAccountId);
      setMessage(result.message);
      setConnected(result.connected);
    } catch { setMessage('连接失败'); }
    setLoading(false);
  };

  const handleDisconnect = async () => {
    if (!currentAccountId) return;
    setLoading(true);
    await api.device.disconnect(currentAccountId);
    setConnected(false);
    setScreenshot(null);
    setLoading(false);
  };

  const handleScreenshot = async () => {
    if (!currentAccountId) return;
    setLoading(true);
    try {
      const result = await api.device.screenshot(currentAccountId);
      if (result.success && result.data) {
        setScreenshot(result.data);
        setMessage('截图已刷新');
      } else if (result.error) {
        setMessage(result.error);
      }
    } catch { setMessage('截图失败'); }
    setLoading(false);
  };

  const handleScreenshotClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!currentAccountId) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    api.device.tap(currentAccountId, x, y);
    setMessage(`点击: (${x}, ${y})`);
  };

  if (!currentAccountId) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-lg mb-4">请先创建配置</p>
        <Link to="/config" className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-500 inline-block">
          新建配置
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">设备管理</h1>

      {message && (
        <div className="mb-4 p-3 bg-blue-900 text-blue-200 rounded">{message}</div>
      )}

      <div className="flex gap-4 mb-6">
        {!connected ? (
          <button onClick={handleConnect} disabled={loading}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50">
            连接设备
          </button>
        ) : (
          <>
            <button onClick={handleDisconnect} disabled={loading}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50">
              断开连接
            </button>
            <button onClick={handleScreenshot} disabled={loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50">
              刷新截图
            </button>
          </>
        )}
      </div>

      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></span>
          <span>{connected ? '已连接' : '未连接'}</span>
        </div>

        {screenshot && (
          <div className="mt-4">
            <p className="text-sm text-gray-400 mb-2">点击截图可发送点击指令</p>
            <img src={screenshot} alt="Device screenshot"
              className="w-[700px] border border-gray-600 rounded cursor-crosshair"
              onClick={handleScreenshotClick} />
          </div>
        )}
      </div>
    </div>
  );
}
