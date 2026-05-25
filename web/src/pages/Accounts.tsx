import { useState, useEffect } from 'react';
import { api, DeviceInfo } from '../api/client';
import { useAccount } from '../contexts/AccountContext';

export function AccountsPage() {
  const { accounts, refreshAccounts } = useAccount();
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    refreshAccounts();
  }, []);

  useEffect(() => {
    if (accounts.length > 0) {
      setDeviceId(accounts[0].deviceId);
    }
  }, [accounts]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await api.device.scan();
      setDevices(res.devices);
      if (res.devices.length > 0 && !deviceId) {
        setDeviceId(res.devices[0].deviceId);
      }
    } catch { /* ok */ }
    setScanning(false);
  };

  const handleSave = async () => {
    if (!deviceId.trim()) { setError('设备地址不能为空'); return; }
    setSaving(true);
    setError('');
    setOk('');
    try {
      if (accounts.length === 0) {
        await api.accounts.create({ name: '默认', deviceId: deviceId.trim() });
      } else {
        await api.accounts.update(accounts[0].id, { deviceId: deviceId.trim() });
      }
      await refreshAccounts();
      setOk('已保存');
    } catch (e: any) {
      setError(e.data?.error || e.message || String(e));
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-blue-50 text-gray-900">
      <div className="max-w-lg mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">设备设置</h1>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg text-sm text-red-700">{error}</div>}
        {ok && <div className="mb-4 p-3 bg-green-50 border border-green-300 rounded-lg text-sm text-green-700">{ok}</div>}

        <div className="space-y-4 bg-white rounded-xl shadow-sm p-6">
          <div>
            <label className="block text-sm text-gray-500 mb-1">ADB 设备地址</label>
            <div className="flex gap-2">
              <input
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-50 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-mono"
                placeholder="127.0.0.1:7555"
              />
              <button
                onClick={handleScan}
                disabled={scanning}
                className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 text-gray-700"
              >
                {scanning ? '扫描中...' : '扫描'}
              </button>
            </div>
          </div>

          {devices.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-gray-400">扫描到的设备:</p>
              {devices.map(d => (
                <button
                  key={d.deviceId}
                  onClick={() => setDeviceId(d.deviceId)}
                  className={`block w-full text-left px-3 py-2 rounded text-sm ${
                    deviceId === d.deviceId
                      ? 'bg-blue-50 border border-blue-400 text-blue-700'
                      : 'bg-gray-50 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  {d.deviceId}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2 bg-blue-600 rounded-lg hover:bg-blue-700 font-bold disabled:opacity-50 text-white"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
