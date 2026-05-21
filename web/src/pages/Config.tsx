import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useAccount } from '../contexts/AccountContext';

interface BuildingPos {
  name: string;
  x: number;
  y: number;
}

const BUILDING_TYPES = [
  '市政厅', '仓库', '城堡', '城墙', '学院', '酒馆', '联盟中心',
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
  const [pendingCoord, setPendingCoord] = useState<{ x: number; y: number; domX: number; domY: number } | null>(null);
  const [selectedBuildingType, setSelectedBuildingType] = useState('');
  const [configName, setConfigName] = useState('默认配置');
  const [configNames, setConfigNames] = useState<string[]>([]);
  const [activeConfigName, setActiveConfigName] = useState('');

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
      }
    } catch { /* ignore */ }
  }, [currentAccountId]);

  const loadProfiles = useCallback(async () => {
    if (!currentAccountId) return;
    try {
      const res = await api.config.getProfiles(currentAccountId);
      if (res.success) {
        setConfigNames(res.profiles);
        setActiveConfigName(res.active);
        setConfigName(res.active);
      }
    } catch { /* ignore */ }
  }, [currentAccountId]);

  const switchConfig = async (name: string) => {
    if (!currentAccountId || name === configName) return;
    try {
      await api.config.switchProfile(currentAccountId, name);
      setConfigName(name);
      setActiveConfigName(name);
      const res = await api.config.getRokConfig(currentAccountId, name);
      if (res.success && res.config) {
        if (res.config.buildingPositions) {
          const entries = Object.entries(res.config.buildingPositions as Record<string, { x: number; y: number }>);
          setBuildingPositions(entries.map(([bName, pos]) => ({ name: bName, x: pos.x, y: pos.y })));
        } else {
          setBuildingPositions([]);
        }
      }
    } catch (e: any) {
      setMessage(e.message || '切换失败');
    }
  };

  useEffect(() => { checkStatus(); loadConfig(); loadProfiles(); }, [checkStatus, loadConfig, loadProfiles]);

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

  const autoSave = async (positions: BuildingPos[]) => {
    if (!currentAccountId) return;
    const bp: Record<string, { x: number; y: number }> = {};
    positions.forEach(b => { bp[b.name] = { x: b.x, y: b.y }; });
    try {
      await api.config.saveRokConfig(currentAccountId, { buildingPositions: bp }, configName);
      setMessage('已保存');
    } catch { setMessage('保存失败'); }
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
      const newPositions = buildingPositions.map(b => b.name === buildingType
        ? { ...b, x: pendingCoord.x, y: pendingCoord.y }
        : b
      );
      setBuildingPositions(newPositions);
      autoSave(newPositions);
    } else {
      const newPositions = [...buildingPositions, { name: buildingType, x: pendingCoord.x, y: pendingCoord.y }];
      setBuildingPositions(newPositions);
      autoSave(newPositions);
    }
    setPendingCoord(null);
    setSelectedBuildingType('');
  };

  const removeBuilding = (index: number) => {
    const newPositions = buildingPositions.filter((_, i) => i !== index);
    setBuildingPositions(newPositions);
    autoSave(newPositions);
  };

  const clearAllBuildings = async () => {
    if (buildingPositions.length === 0) return;
    if (window.confirm(`确定清空所有 ${buildingPositions.length} 个建筑位置？此操作不可撤销。`)) {
      setBuildingPositions([]);
      autoSave([]);
    }
  };

  const handleCreateProfile = async () => {
    const name = window.prompt('请输入新配置名称：');
    if (!name || !name.trim()) return;
    if (!currentAccountId) return;
    try {
      await api.config.createProfile(currentAccountId, name.trim());
      setMessage(`配置「${name.trim()}」已创建`);
      await api.config.switchProfile(currentAccountId, name.trim());
      setConfigName(name.trim());
      setActiveConfigName(name.trim());
      setBuildingPositions([]);
      await loadProfiles();
    } catch (e: any) {
      setMessage(e.message || '创建失败');
    }
  };

  const handleRenameProfile = async () => {
    const newName = window.prompt(`重命名「${configName}」为：`);
    if (!newName || !newName.trim()) return;
    if (!currentAccountId) return;
    try {
      await api.config.renameProfile(currentAccountId, configName, newName.trim());
      setMessage(`已重命名为「${newName.trim()}」`);
      setConfigName(newName.trim());
      await loadProfiles();
    } catch (e: any) {
      setMessage(e.message || '重命名失败');
    }
  };

  const handleDeleteProfile = async () => {
    if (!window.confirm(`确定删除配置「${configName}」？此操作不可恢复。`)) return;
    if (!currentAccountId) return;
    try {
      await api.config.deleteProfile(currentAccountId, configName);
      setMessage(`配置「${configName}」已删除`);
      await loadProfiles();
      await loadConfig();
    } catch (e: any) {
      setMessage(e.message || '删除失败');
    }
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

      {/* 配置管理栏 */}
      <div className="flex items-center gap-3 mb-4 bg-gray-800 rounded-lg p-3">
        <span className="text-sm text-gray-400">配置：</span>
        <select
          value={configName}
          onChange={e => switchConfig(e.target.value)}
          className="px-3 py-1.5 bg-gray-700 rounded text-sm border border-gray-600 min-w-[140px]"
        >
          {configNames.map(name => (
            <option key={name} value={name}>{name}{name === activeConfigName ? ' (当前)' : ''}</option>
          ))}
        </select>
        <button
          onClick={handleCreateProfile}
          disabled={configNames.length >= 5}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >新建</button>
        <button
          onClick={handleRenameProfile}
          className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-sm"
        >重命名</button>
        <button
          onClick={handleDeleteProfile}
          disabled={configNames.length <= 1}
          className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >删除</button>
        <span className="text-xs text-gray-500 ml-auto">{configNames.length}/5</span>
      </div>

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
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="font-bold mb-3">建筑位置</h3>
            {buildingPositions.length === 0 ? (
              <p className="text-gray-500 text-sm">在截图上点击标注建筑坐标</p>
            ) : (
              <>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {buildingPositions.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 bg-gray-700 rounded p-2">
                      <span className="text-sm flex-1">{b.name}</span>
                      <span className="text-xs text-gray-400">({b.x}, {b.y})</span>
                      <button onClick={() => removeBuilding(i)} className="text-red-400 hover:text-red-300 text-xs px-2">×</button>
                    </div>
                  ))}
                </div>
                {buildingPositions.length > 0 && (
                  <div className="mt-3 text-right">
                    <button
                      onClick={clearAllBuildings}
                      className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-xs"
                    >清空全部</button>
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
