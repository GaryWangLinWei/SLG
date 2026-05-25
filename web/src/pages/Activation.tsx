import React, { useState, useEffect } from 'react';
import { useLicense } from '../contexts/LicenseContext';

export default function ActivationPage() {
  const { activate, loading, activateError, clearActivateError, expiredMessage, setExpiredMessage } = useLicense();
  const [code, setCode] = useState('');
  const [success, setSuccess] = useState(false);
  const [showExpired, setShowExpired] = useState(!!expiredMessage);

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

    const result = await activate(code.trim());
    if (result.success) {
      setSuccess(true);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">SLG 自动化工具</h1>
            <p className="text-gray-500">请输入激活码以继续使用</p>
          </div>

          {showExpired && (
            <div className="mb-4 p-4 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm text-center">
              <p className="font-bold text-base mb-1">激活码已到期</p>
              <p className="text-red-600">请重新输入激活码以继续使用</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
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
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
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

            <button
              type="submit"
              disabled={loading || success}
              className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-300 text-white font-medium rounded-xl transition-all shadow-lg hover:shadow-xl disabled:cursor-not-allowed"
            >
              {loading ? '激活中...' : '激活'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-gray-400 text-xs text-center">
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
