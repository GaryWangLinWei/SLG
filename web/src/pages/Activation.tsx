import React, { useState, useEffect } from 'react';
import { useLicense } from '../contexts/LicenseContext';

export default function ActivationPage() {
  const { activate, loading, activateError, clearActivateError, expiredMessage, setExpiredMessage } = useLicense();
  const [code, setCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteResult, setInviteResult] = useState<{ success: boolean; inviterBonusDays?: number; inviteeBonusDays?: number; error?: string } | null>(null);
  const [success, setSuccess] = useState(false);
  const [showExpired, setShowExpired] = useState(!!expiredMessage);
  const isElectron = typeof window !== 'undefined' && 'electronAPI' in window;

  useEffect(() => {
    if (expiredMessage) {
      setShowExpired(true);
      setExpiredMessage(null);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!code.trim()) {
      return;
    }

    clearActivateError();
    setSuccess(false);

    const result = await activate(code.trim(), inviteCode.trim() || undefined);
    if (result.success) {
      setSuccess(true);
      if (result.inviteBonus) {
        setInviteResult({ success: true, inviterBonusDays: result.inviterBonusDays, inviteeBonusDays: result.inviteeBonusDays });
      }
      if (result.inviteError) {
        setInviteResult({ success: false, error: result.inviteError });
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-100 relative">
          {isElectron && (
            <button
              onClick={() => window.electronAPI!.closeApp()}
              className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="退出"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">ROK助手</h1>
            <p className="text-slate-500">请输入激活码以继续使用</p>
          </div>

          {showExpired && (
            <div className="mb-4 p-4 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm text-center">
              <p className="font-bold text-base mb-1">激活码已到期</p>
              <p className="text-red-600">请重新输入激活码以继续使用</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                激活码
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  clearActivateError();
                }}
                placeholder="请输入您的激活码"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                disabled={loading}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                邀请码（选填）
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="如有邀请码，请输入"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                disabled={loading}
              />
            </div>

            {activateError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm">
                {activateError}
              </div>
            )}

            {success && (
              <div className="mb-4 p-3 bg-green-50 border border-green-300 rounded-xl text-green-700 text-sm">
                激活成功！正在加载...
              </div>
            )}

            {inviteResult?.success && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-700 text-sm">
                邀请奖励已发放！你和邀请人各获得 {inviteResult.inviteeBonusDays} 天
              </div>
            )}
            {inviteResult && !inviteResult.success && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-700 text-sm">
                {inviteResult.error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || success}
              className="w-full py-3 px-4 bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-600 hover:to-emerald-500 disabled:from-slate-300 disabled:to-slate-300 text-white font-medium rounded-xl transition-all shadow-lg hover:shadow-xl disabled:cursor-not-allowed"
            >
              {loading ? '激活中...' : '激活'}
            </button>

            <p className="mt-4 text-center text-xs text-slate-400">
              还没有激活码？
              <a href="https://pay.ldxp.cn/item/h86d8u" target="_blank" rel="noopener noreferrer"
                className="text-emerald-600 hover:text-emerald-500 ml-1">
                在线购买
              </a>
            </p>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-100">
            <p className="text-slate-400 text-xs text-center">
              激活后将绑定到当前设备，不可转移
              <br />
              支持离线使用 24 小时
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
