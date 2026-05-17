import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAccount } from '../contexts/AccountContext';

interface BuildingPos {
  name: string;
  x: number;
  y: number;
}

const BUILDING_TYPES = [
  '市政厅', '仓库', '城堡', '学院', '酒馆', '联盟中心',
  '斥候营地', '医院', '农场', '木材厂', '采石场', '金矿',
  '兵营', '马厩', '靶场', '攻城武器厂', '商栈', '政务院',
];

export function ConfigPage() {
  const { currentAccountId } = useAccount();
  const [connected, setConnected] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'tap' | 'annotate'>('annotate');

  const [buildingPositions, setBuildingPositions] = useState<BuildingPos[]>([]);
  const [resources, setResources] = useState<{ building: string; collectOffset: { x: number; y: number } }[]>([]);
  const [pendingCoord, setPendingCoord] = useState<{ x: number; y: number; domX: number; domY: number } | null>(null);
  const [selectedBuildingType, setSelectedBuildingType] = useState('');
  const [selectedSection, setSelectedSection] = useState<'buildings' | 'resources'>('buildings');

  const checkStatus = useCallback(async () => {
    if (!currentAccountId) return;
    try {
      const status = await api.device.status(currentAccountId);
      setConnected(status.connected);
    } catch { setConnected(false); }
  }, [currentAccountId]);

  const loadConfig = useCallback(async () => {
    if (!currentAccountId) return;
    try {
      const res = await api.config.getRokConfig(currentAccountId);
      if (res.success && res.config) {
        if (res.config.buildingPositions) {
          const entries = Object.entries(res.config.buildingPositions as Record<string, { x: number; y: number }>);
          setBuildingPositions(entries.map(([name, pos]) => ({ name, x: pos.x, y: pos.y })));
        }
        if (res.config.resources) setResources(res.config.resources);
      }
    } catch { /* ignore */ }
  }, [currentAccountId]);

  useEffect(() => { checkStatus(); loadConfig(); }, [checkStatus, loadConfig]);

  const handleConnect = async () => {
    if (!currentAccountId) return;
    setLoading(true);
    try {
      const result = await api.device.connect(currentAccountId);
      setConnected(result.connected);
      setMessage(result.message || '已连接');
    } catch { setMessage('连接失败'); }
    setLoading(false);
  };

  const handleScreenshot = async () => {
    if (!currentAccountId) return;
    setLoading(true);
    try {
      const result = await api.device.screenshot(currentAccountId);
      if (result.success && result.data) setScreenshot(result.data);
    } catch { setMessage('截图失败'); }
    setLoading(false);
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!currentAccountId) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    if (mode === 'tap') {
      api.device.tap(currentAccountId, x, y);
      setMessage(`点击: (${x}, ${y})`);
    } else {
      const domX = e.clientX - rect.left;
      const domY = e.clientY - rect.top;
      setPendingCoord({ x, y, domX, domY });
      setSelectedBuildingType('');
    }
  };

  const addBuilding = (buildingType: string) => {
    if (!pendingCoord || !buildingType) return;

    const existing = buildingPositions.find(b => b.name === buildingType);

    if (existing) {
      if (!window.confirm(`「${buildingType}」已添加，是否用新坐标覆盖？`)) {
        setPendingCoord(null);
        setSelectedBuildingType('');
        return;
      }
      setBuildingPositions(prev =>
        prev.map(b => b.name === buildingType
          ? { ...b, x: pendingCoord.x, y: pendingCoord.y }
          : b
        )
      );
    } else {
      setBuildingPositions(prev => [...prev, { name: buildingType, x: pendingCoord.x, y: pendingCoord.y }]);
    }
    setPendingCoord(null);
    setSelectedBuildingType('');
  };

  const removeBuilding = (index: number) => {
    setBuildingPositions(prev => prev.filter((_, i) => i !== index));
  };

  const assignBuildingToResource = (index: number, buildingName: string) => {
    setResources(prev => {
      const next = [...prev];
      if (index >= next.length) {
        next.push({ building: buildingName, collectOffset: { x: 0, y: 50 } });
      } else {
        next[index] = { ...next[index], building: buildingName };
      }
      return next;
    });
  };

  const removeResource = (index: number) => {
    setResources(prev => prev.filter((_, i) => i !== index));
  };

  const buildConfig = () => {
    const bp: Record<string, { x: number; y: number }> = {};
    buildingPositions.forEach(b => { bp[b.name] = { x: b.x, y: b.y }; });
    return { buildingPositions: bp, resources };
  };

  const handleSave = async () => {
    if (!currentAccountId) return;
    setLoading(true);
    try {
      const result = await api.config.saveRokConfig(currentAccountId, buildConfig());
      setMessage(result.success ? '配置已保存' : '保存失败');
    } catch { setMessage('保存失败'); }
    setLoading(false);
  };


  if (!currentAccountId) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-lg mb-4">请先选择或创建一个账号</p>
        <a href="/accounts" className="px-6 py-3 bg-blue-600 rounded-lg hover:bg-blue-500 inline-block">
          前往账号管理
        </a>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">坐标配置</h1>
      <p className="text-sm text-gray-400 mb-6">截图后点击画面标注建筑坐标，保存到本地配置文件</p>

      {message && <div className="mb-4 p-3 bg-blue-900 text-blue-200 rounded text-sm">{message}</div>}

      <div className="flex gap-4 mb-6 flex-wrap items-center">
        {!connected ? (
          <button onClick={handleConnect} disabled={loading}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded disabled:opacity-50">连接设备</button>
        ) : (
          <button onClick={handleScreenshot} disabled={loading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50">刷新截图</button>
        )}
        <div className="flex items-center gap-2 bg-gray-700 rounded-lg p-1">
          <button onClick={() => setMode('annotate')}
            className={`px-4 py-1 rounded ${mode === 'annotate' ? 'bg-blue-600' : ''}`}>标注模式</button>
          <button onClick={() => setMode('tap')}
            className={`px-4 py-1 rounded ${mode === 'tap' ? 'bg-blue-600' : ''}`}>点击模式</button>
        </div>
        <div className="flex-1" />
        <button onClick={handleSave} disabled={loading}
          className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded disabled:opacity-50">保存配置</button>
      </div>

      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></span>
              <span className="text-sm">{connected ? '已连接' : '未连接'}</span>
            </div>
            {screenshot ? (
              <div className="relative">
                <p className="text-xs text-gray-500 mb-2">
                  {mode === 'annotate' ? '点击截图标注坐标' : '点击截图发送点击指令'}
                  {pendingCoord && ' — 已标记坐标，选择建筑类型后确认'}
                </p>
                <img src={screenshot} alt="截图" className="w-full border border-gray-600 rounded cursor-crosshair" onClick={handleImageClick} />
                {pendingCoord && (
                  <div
                    className="absolute z-10 bg-gray-800 border border-gray-600 rounded-lg p-2 shadow-lg"
                    style={{ left: pendingCoord.domX + 8, top: pendingCoord.domY - 8 }}
                  >
                    <select
                      value={selectedBuildingType}
                      onChange={e => {
                        const type = e.target.value;
                        if (type) {
                          setSelectedBuildingType(type);
                          addBuilding(type);
                        }
                      }}
                      className="px-3 py-2 bg-gray-900 rounded text-sm border border-gray-600"
                      autoFocus
                    >
                      <option value="">选择建筑类型...</option>
                      {BUILDING_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                    </select>
                    <button
                      onClick={() => setPendingCoord(null)}
                      className="ml-1 px-2 py-2 text-xs text-gray-400 hover:text-white"
                    >×</button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-20">点击"刷新截图"查看设备画面</p>
            )}
          </div>
        </div>

        <div className="w-96 flex-shrink-0">
          <div className="flex gap-1 mb-4 bg-gray-800 rounded-lg p-1">
            {(['buildings', 'resources'] as const).map(s => (
              <button key={s} onClick={() => setSelectedSection(s)}
                className={`flex-1 px-3 py-2 rounded text-sm ${selectedSection === s ? 'bg-gray-700' : ''}`}>
                {{ buildings: '建筑', resources: '收集' }[s]}
              </button>
            ))}
          </div>

          {selectedSection === 'buildings' && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-bold mb-3">建筑位置</h3>
              {buildingPositions.length === 0 ? (
                <p className="text-gray-500 text-sm">在截图上点击标注建筑坐标</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {buildingPositions.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 bg-gray-700 rounded p-2">
                      <span className="text-sm flex-1">{b.name}</span>
                      <span className="text-xs text-gray-400">({b.x}, {b.y})</span>
                      <button onClick={() => removeBuilding(i)} className="text-red-400 hover:text-red-300 text-xs px-2">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedSection === 'resources' && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-bold mb-3">资源收集配置</h3>
              <p className="text-xs text-gray-400 mb-3">指定哪些建筑需要收集资源</p>
              {[0, 1, 2, 3, 4].map(i => {
                const r = resources[i];
                return (
                  <div key={i} className="flex items-center gap-2 mb-2 bg-gray-700 rounded p-2">
                    <span className="text-xs text-gray-400 w-4">#{i + 1}</span>
                    <select value={r?.building || ''} onChange={e => assignBuildingToResource(i, e.target.value)}
                      className="px-2 py-1 bg-gray-800 rounded text-sm border border-gray-600 flex-1">
                      <option value="">-</option>
                      {buildingPositions.map(b => (<option key={b.name} value={b.name}>{b.name}</option>))}
                    </select>
                    {r && <button onClick={() => removeResource(i)} className="text-red-400 hover:text-red-300 text-xs px-2">×</button>}
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
