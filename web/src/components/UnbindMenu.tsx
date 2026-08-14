import { useState, useEffect, useRef } from 'react';
import { useLicense } from '../contexts/LicenseContext';

type View = 'menu' | 'confirm' | 'success';

const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function UnbindMenu({ expiresAt, trustedNow }: { expiresAt: number; trustedNow?: number }) {
  const { status, unbind, refreshStatus } = useLicense();
  const tier = status?.tier || 'basic';
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('menu');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [unboundCode, setUnboundCode] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点外部关闭 popover（成功态不允许点外部关闭，避免错过卡密）
  useEffect(() => {
    if (!open || view === 'success') return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, view]);

  const closeAll = () => {
    setOpen(false);
    setView('menu');
    setErr(null);
    setUnboundCode(undefined);
    setCopied(false);
  };

  const now = trustedNow ?? Date.now();
  const lastUnboundAt = status?.lastUnboundAt;
  const cooldownRemaining = lastUnboundAt ? Math.max(0, COOLDOWN_MS - (now - lastUnboundAt)) : 0;
  const cooldownDays = Math.ceil(cooldownRemaining / 86400000);

  const doUnbind = async () => {
    setBusy(true);
    setErr(null);
    try {
      const result = await unbind();
      // 成功后先停在成功态展示卡密，用户确认后再 refreshStatus 跳回激活页
      setUnboundCode(result.activationCode);
      setView('success');
    } catch (e: any) {
      const data = e?.data || {};
      if (data.code === 'COOLDOWN_ACTIVE' && typeof data.retryAfterMs === 'number') {
        setErr(`还需 ${Math.ceil(data.retryAfterMs / 86400000)} 天才能再次换机`);
      } else if (data.code === 'NETWORK_ERROR') {
        setErr('无法连接服务器，请检查网络');
      } else {
        setErr(data.error || data.message || e?.message || '解绑失败，请稍后重试');
      }
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!unboundCode) return;
    try {
      await navigator.clipboard.writeText(unboundCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard 不可用，用户可手动选择 */ }
  };

  // 用户确认已记下卡密：刷新状态跳回激活页
  const confirmAndLeave = async () => {
    closeAll();
    await refreshStatus();
  };

  const badgeClass = tier === 'pro'
    ? 'bg-amber-100 text-amber-600'
    : 'bg-emerald-100 text-emerald-500';
  const dotClass = tier === 'pro' ? 'bg-amber-500' : 'bg-emerald-500';
  const label = tier === 'pro' ? 'Pro 版' : '基础版';

  return (
    <div className="relative" ref={ref} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`${badgeClass} px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity`}
        title="授权信息 / 换机"
      >
        <span className={`w-1.5 h-1.5 ${dotClass} rounded-full animate-pulse`} /> {label}
      </button>

      {open && view === 'menu' && (
        <div className="absolute right-0 top-full mt-2 w-60 bg-white rounded-xl shadow-xl border border-slate-200 p-4 z-50">
          <p className="font-semibold text-slate-800">{label}</p>
          <p className="text-xs text-slate-500 mt-1">到期时间：{formatDate(expiresAt)}</p>
          {lastUnboundAt ? (
            <p className="text-xs text-slate-500 mt-1">
              上次换机：{formatDate(lastUnboundAt)}
              {cooldownRemaining > 0 && <span className="text-amber-600">（还剩 {cooldownDays} 天可再次换机）</span>}
            </p>
          ) : (
            <p className="text-xs text-slate-400 mt-1">每 30 天可解绑换机一次</p>
          )}
          <button
            onClick={() => { setErr(null); setView('confirm'); }}
            className="mt-3 w-full py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            解绑并换机
          </button>
        </div>
      )}

      {view === 'confirm' && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]" onClick={() => !busy && setView('menu')}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-800 mb-3">确认解绑并换机</h2>
            <ul className="text-sm text-slate-600 space-y-1.5 list-disc pl-5 mb-4">
              <li>解绑后本设备立即失去授权，需在新设备重新输入激活码。</li>
              <li>30 天内只能解绑一次。</li>
            </ul>
            {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
            <div className="flex gap-3">
              <button
                disabled={busy}
                onClick={() => setView('menu')}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm text-slate-600 disabled:opacity-50"
              >
                取消
              </button>
              <button
                disabled={busy}
                onClick={doUnbind}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium disabled:opacity-50"
              >
                {busy ? '解绑中...' : '确认解绑'}
              </button>
            </div>
          </div>
        </div>
      )}

      {view === 'success' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h2 className="text-lg font-bold text-slate-800 mb-2">解绑成功</h2>
            <p className="text-sm text-slate-600 mb-4">
              本设备已失去授权。请在<strong>新设备</strong>安装并输入以下激活码重新激活：
            </p>
            {unboundCode ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-2">
                <p className="text-xs text-slate-400 mb-1">当前激活码</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-base font-mono font-semibold text-slate-800 break-all select-all">
                    {unboundCode}
                  </code>
                  <button
                    onClick={copyCode}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
                  >
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-2">
                未能获取激活码，请联系客服并提供订单信息以找回。
              </p>
            )}
            <p className="text-xs text-slate-400 mb-4">
              剩余天数会完整保留；30 天内不可再次解绑。
            </p>
            <button
              onClick={confirmAndLeave}
              className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-medium"
            >
              我已记下
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
