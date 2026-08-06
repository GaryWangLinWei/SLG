import { useState, useEffect } from 'react';
import { api, DeviceInfo } from '../api/client';
import { useAccount } from '../contexts/AccountContext';

export function DeviceSettingsCard() {
  const { accounts, refreshAccounts } = useAccount();
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    if (accounts.length > 0 && !deviceId) {
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
      // refreshAccounts 在无当前账号时会自动选中第一个账号
      await refreshAccounts();
      setOk('已保存');
    } catch (e: any) {
      setError(e.data?.error || e.message || String(e));
    }
    setSaving(false);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-slate-500 whitespace-nowrap">模拟器地址</span>
        <input
          value={deviceId}
          onChange={e => setDeviceId(e.target.value)}
          className="flex-1 min-w-[180px] px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 outline-none font-mono text-sm"
          placeholder="127.0.0.1:7555"
        />
        <button
          onClick={handleScan}
          disabled={scanning}
          className="px-3 py-1.5 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-sm"
        >
          {scanning ? '扫描中...' : '扫描'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      {devices.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {devices.map(d => (
            <button
              key={d.deviceId}
              onClick={() => setDeviceId(d.deviceId)}
              className={`px-3 py-1 rounded text-xs font-mono ${
                deviceId === d.deviceId
                  ? 'bg-emerald-50 border border-emerald-400 text-emerald-700'
                  : 'bg-slate-50 hover:bg-slate-100 border border-gray-200 text-slate-600'
              }`}
            >
              {d.deviceId}
            </button>
          ))}
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
      {ok && <div className="mt-2 text-xs text-emerald-600">{ok}</div>}
    </div>
  );
}
