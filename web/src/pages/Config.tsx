import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
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
  '兵营', '马厩', '靶场', '攻城武器厂', '商栈', '政务院', '铁匠铺',
];

export function ConfigPage() {
  const { currentAccountId } = useAccount();
  const [connected, setConnected] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'tap' | 'annotate'>('annotate');
  const [showMarkers, setShowMarkers] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const [buildingPositions, setBuildingPositions] = useState<BuildingPos[]>([]);
  const [pendingCoord, setPendingCoord] = useState<{ x: number; y: number; domX: number; domY: number } | null>(null);
  const [selectedBuildingType, setSelectedBuildingType] = useState('');
  const [configName, setConfigName] = useState('默认配置');
  const [configNames, setConfigNames] = useState<string[]>([]);
  const [activeConfigName, setActiveConfigName] = useState('');
  const [createMode, setCreateMode] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [renameMode, setRenameMode] = useState(false);
  const [renameTarget, setRenameTarget] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [overwriteTarget, setOverwriteTarget] = useState<string | null>(null);

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

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

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

  const addBuilding = (buildingType: string, forceOverwrite?: boolean) => {
    if (!pendingCoord || !buildingType) return;

    const existing = buildingPositions.find(b => b.name === buildingType);

    if (existing && !forceOverwrite) {
      setOverwriteTarget(buildingType);
      return;
    }

    if (existing) {
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
    setOverwriteTarget(null);
  };

  const removeBuilding = (index: number) => {
    const newPositions = buildingPositions.filter((_, i) => i !== index);
    setBuildingPositions(newPositions);
    autoSave(newPositions);
  };

  const clearAllBuildings = async () => {
    if (buildingPositions.length === 0) return;
    setBuildingPositions([]);
    autoSave([]);
    setClearConfirm(false);
  };

  const handleCreateProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    if (!currentAccountId) return;
    try {
      await api.config.createProfile(currentAccountId, name);
      setMessage(`配置「${name}」已创建`);
      await api.config.switchProfile(currentAccountId, name);
      setConfigName(name);
      setActiveConfigName(name);
      setBuildingPositions([]);
      await loadProfiles();
      setCreateMode(false);
      setNewProfileName('');
    } catch (e: any) {
      setMessage(e.message || '创建失败');
    }
  };

  const handleRenameProfile = async () => {
    const newName = renameTarget.trim();
    if (!newName) return;
    if (!currentAccountId) return;
    try {
      await api.config.renameProfile(currentAccountId, configName, newName);
      setMessage(`已重命名为「${newName}」`);
      setConfigName(newName);
      await loadProfiles();
      setRenameMode(false);
      setRenameTarget('');
    } catch (e: any) {
      setMessage(e.message || '重命名失败');
    }
  };

  const handleDeleteProfile = async (name: string) => {
    if (!currentAccountId) return;
    try {
      await api.config.deleteProfile(currentAccountId, name);
      setMessage(`配置「${name}」已删除`);
      setDeleteTarget(null);
      await loadProfiles();
      await loadConfig();
    } catch (e: any) {
      setMessage(e.message || '删除失败');
    }
  };


  if (!currentAccountId) {
    return (
      <div className="text-center py-20 text-slate-500">
        <p className="text-lg mb-4">请先选择或创建一个账号</p>
        <Link to="/accounts" className="px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 inline-block">
          前往账号管理
        </Link>
      </div>
    );
  }

  return (
    <div className="px-[80px] pt-4 pb-10">
      <h1 className="text-2xl font-bold mb-2">坐标配置</h1>
      <p className="text-sm text-slate-500 mb-6">截图后点击画面标注建筑坐标，保存到本地配置文件</p>

      {/* 配置管理栏 */}
      <div className="flex items-center gap-2 mb-4 bg-white rounded-lg shadow-sm p-3 flex-wrap">
        <span className="text-sm text-slate-500">配置：</span>

        {/* Custom dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="px-3 py-1.5 bg-white rounded text-sm border border-slate-200 min-w-[160px] flex items-center justify-between hover:border-slate-200"
          >
            <span>{configName}</span>
            <span className="text-slate-400 ml-2">▼</span>
          </button>
          {dropdownOpen && (
            <div className="absolute z-20 mt-1 bg-white border border-slate-200 rounded shadow-lg min-w-[200px] overflow-hidden">
              {configNames.map(name => (
                <div key={name} className="flex items-center hover:bg-slate-50 group">
                  <button
                    onClick={() => { switchConfig(name); setDropdownOpen(false); }}
                    className="flex-1 text-left px-3 py-2 text-sm hover:text-slate-800"
                  >
                    {name}{name === activeConfigName ? ' (当前)' : ''}
                  </button>
                  {configNames.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(name); setDropdownOpen(false); }}
                      className="px-2 py-1 text-red-600 hover:text-red-500 hover:bg-red-100 rounded text-sm opacity-70 group-hover:opacity-100"
                      title={`删除「${name}」`}
                    >✕</button>
                  )}
                </div>
              ))}
              {configNames.length < 5 && (
                <button
                  onClick={() => { setCreateMode(true); setNewProfileName(''); setDropdownOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-emerald-600 hover:bg-slate-50 border-t border-slate-200"
                >
                  + 新建配置
                </button>
              )}
            </div>
          )}
        </div>

        {/* Rename button */}
        {renameMode ? (
          <form onSubmit={e => { e.preventDefault(); handleRenameProfile(); }}
            className="flex items-center gap-1">
            <input
              autoFocus
              value={renameTarget}
              onChange={e => setRenameTarget(e.target.value)}
              placeholder="新名称"
              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-sm text-slate-800 w-28 focus:outline-none focus:border-emerald-400"
            />
            <button type="submit" className="text-sm text-emerald-600 hover:text-emerald-500 px-1">确认</button>
            <button type="button" onClick={() => { setRenameMode(false); setRenameTarget(''); }}
              className="text-sm text-slate-500 hover:text-red-600 px-1">取消</button>
          </form>
        ) : (
          <button
            onClick={() => { setRenameMode(true); setRenameTarget(configName); }}
            className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded"
            title="重命名"
          >✎</button>
        )}

        {/* Delete confirmation */}
        {deleteTarget && (
          <span className="flex items-center gap-1 text-sm">
            <span className="text-red-600">确定删除「{deleteTarget}」？</span>
            <button onClick={() => handleDeleteProfile(deleteTarget)}
              className="text-red-600 hover:text-red-500 px-1 font-bold">确认</button>
            <button onClick={() => setDeleteTarget(null)}
              className="text-slate-500 hover:text-slate-800 px-1">取消</button>
          </span>
        )}

        <span className="text-xs text-slate-400 ml-auto">{configNames.length}/5</span>
      </div>

      {/* Create inline input */}
      {createMode && (
        <div className="flex items-center gap-2 mb-4 bg-white rounded-lg shadow-sm p-3">
          <span className="text-sm text-slate-500">新建配置：</span>
          <form onSubmit={e => { e.preventDefault(); handleCreateProfile(); }}
            className="flex items-center gap-2">
            <input
              autoFocus
              value={newProfileName}
              onChange={e => setNewProfileName(e.target.value)}
              placeholder="输入配置名称"
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-sm text-slate-800 w-48 focus:outline-none focus:border-emerald-400"
            />
            <button type="submit" disabled={!newProfileName.trim()}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-sm disabled:opacity-30">确认创建</button>
            <button type="button" onClick={() => { setCreateMode(false); setNewProfileName(''); }}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded text-sm">取消</button>
          </form>
        </div>
      )}

      {message && <div className="mb-4 p-3 bg-emerald-100 text-emerald-700 rounded text-sm">{message}</div>}

      <div className="flex gap-4 mb-6 flex-wrap items-center">
        {!connected ? (
          <button onClick={handleConnect} disabled={loading}
            className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 rounded disabled:opacity-50 text-white">连接设备</button>
        ) : (
          <button onClick={handleScreenshot} disabled={loading}
            className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 rounded disabled:opacity-50 text-white">刷新截图</button>
        )}
        <button
          onClick={() => setShowMarkers(!showMarkers)}
          className={`px-4 py-2 rounded text-sm ${showMarkers ? 'bg-amber-500 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
        >
          {showMarkers ? '隐藏坐标' : '显示坐标'}
        </button>
        <div className="flex-1" />
      </div>

      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-3 h-3 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
              <span className="text-sm">{connected ? '已连接' : '未连接'}</span>
            </div>
            {screenshot ? (
              <div className="relative">
                <p className="text-xs text-slate-400 mb-2">
                  {mode === 'annotate' ? '点击截图标注坐标' : '点击截图发送点击指令'}
                  {pendingCoord && ' — 已标记坐标，选择建筑类型后确认'}
                  {typeof window !== 'undefined' && !('electronAPI' in window) && (
                    <>
                      <span className="ml-3 text-slate-300">|</span>
                      <button onClick={() => setMode(mode === 'annotate' ? 'tap' : 'annotate')} className="ml-3 text-slate-400 hover:text-slate-600 underline underline-offset-2">
                        {mode === 'annotate' ? '切换到点击模式' : '切换到标注模式'}
                      </button>
                    </>
                  )}
                </p>
                <img ref={imgRef} src={screenshot} alt="截图" className="w-full border border-slate-200 rounded cursor-crosshair" onClick={handleImageClick} />
                {showMarkers && imgRef.current && imgRef.current.naturalWidth > 0 && buildingPositions.map((b, i) => {
                  const imgRect = imgRef.current!.getBoundingClientRect();
                  const containerRect = imgRef.current!.parentElement!.getBoundingClientRect();
                  const scaleX = imgRect.width / imgRef.current!.naturalWidth;
                  const scaleY = imgRect.height / imgRef.current!.naturalHeight;
                  const left = b.x * scaleX + (imgRect.left - containerRect.left);
                  const top = b.y * scaleY + (imgRect.top - containerRect.top);
                  return (
                    <div key={i} className="absolute pointer-events-none" style={{ left, top, transform: 'translate(-50%, -50%)' }}>
                      <div className="w-4 h-4 bg-red-500 rounded-full border-[3px] border-white shadow-lg shadow-red-500/50" />
                      <span className="absolute left-4 -top-3 text-base bg-black/75 text-white px-2 py-0.5 rounded font-bold whitespace-nowrap">{b.name}</span>
                    </div>
                  );
                })}
                {pendingCoord && !overwriteTarget && (
                  <div
                    className="absolute z-10 bg-white border border-slate-200 rounded-lg p-2 shadow-lg"
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
                      className="px-3 py-2 bg-emerald-50 rounded text-sm border border-slate-200"
                      autoFocus
                    >
                      <option value="">选择建筑类型...</option>
                      {BUILDING_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                    </select>
                    <button
                      onClick={() => setPendingCoord(null)}
                      className="ml-1 px-2 py-2 text-xs text-slate-500 hover:text-slate-800"
                    >×</button>
                  </div>
                )}
                {pendingCoord && overwriteTarget && (
                  <div
                    className="absolute z-10 bg-white border border-slate-200 rounded-lg p-2 shadow-lg"
                    style={{ left: pendingCoord.domX + 8, top: pendingCoord.domY - 8 }}
                  >
                    <span className="text-sm text-amber-700">「{overwriteTarget}」已存在，覆盖？</span>
                    <div className="flex gap-1 mt-1">
                      <button onClick={() => addBuilding(overwriteTarget, true)}
                        className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-xs">覆盖</button>
                      <button onClick={() => { setPendingCoord(null); setSelectedBuildingType(''); setOverwriteTarget(null); }}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs">取消</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-400 text-center py-20">点击"刷新截图"查看设备画面</p>
            )}
          </div>
        </div>

        <div className="w-96 flex-shrink-0">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h3 className="font-bold mb-3">建筑位置</h3>
            {buildingPositions.length === 0 ? (
              <p className="text-slate-400 text-sm">在截图上点击标注建筑坐标</p>
            ) : (
              <>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {buildingPositions.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 bg-slate-50 rounded p-2">
                      <span className="text-sm flex-1">{b.name}</span>
                      <span className="text-xs text-slate-500">({b.x}, {b.y})</span>
                      <button onClick={() => removeBuilding(i)} className="text-red-600 hover:text-red-500 text-xs px-2">×</button>
                    </div>
                  ))}
                </div>
                {buildingPositions.length > 0 && (
                  <div className="mt-3 text-right">
                    {clearConfirm ? (
                      <span className="flex items-center gap-2 justify-end text-sm">
                        <span className="text-red-600">清空全部？不可撤销</span>
                        <button onClick={clearAllBuildings}
                          className="text-red-600 hover:text-red-500 font-bold">确认</button>
                        <button onClick={() => setClearConfirm(false)}
                          className="text-slate-500 hover:text-slate-800">取消</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setClearConfirm(true)}
                        className="px-3 py-1.5 bg-red-100 hover:bg-red-100 rounded text-xs"
                      >清空全部</button>
                    )}
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
