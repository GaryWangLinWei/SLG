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
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-lg mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">设备设置</h1>

        {error && <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-sm">{error}</div>}
        {ok && <div className="mb-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-sm">{ok}</div>}

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">ADB 设备地址</label>
            <div className="flex gap-2">
              <input
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-blue-500 outline-none font-mono"
                placeholder="127.0.0.1:7555"
              />
              <button
                onClick={handleScan}
                disabled={scanning}
                className="px-4 py-2 bg-gray-600 rounded-lg hover:bg-gray-500 disabled:opacity-50"
              >
                {scanning ? '扫描中...' : '扫描'}
              </button>
            </div>
          </div>

          {devices.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-gray-500">扫描到的设备:</p>
              {devices.map(d => (
                <button
                  key={d.deviceId}
                  onClick={() => setDeviceId(d.deviceId)}
                  className={`block w-full text-left px-3 py-2 rounded text-sm ${
                    deviceId === d.deviceId
                      ? 'bg-blue-900/50 border border-blue-600'
                      : 'bg-gray-700 hover:bg-gray-600'
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
            className="w-full py-2 bg-blue-600 rounded-lg hover:bg-blue-500 font-bold disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
