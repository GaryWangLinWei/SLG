import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { remoteApi } from '../api/remote';

const SESSION_KEY = 'remote-session-token';

export default function RemoteAccessPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // 检查已有 session，直接跳转到 Mobile 页
  useEffect(() => {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) navigate('/mobile?remote=1');
  }, [navigate]);

  // 从 URL 自动填充验证码
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('code');
    if (c && /^\d{6}$/.test(c)) {
      setCode(c);
      handleSubmit(c);
    }
  }, []);

  async function handleSubmit(submitCode?: string) {
    const target = submitCode || code;
    if (!/^\d{6}$/.test(target)) {
      setError('请输入 6 位数字验证码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await remoteApi.verifyCode(target);
      if (result.success && result.sessionToken) {
        localStorage.setItem(SESSION_KEY, result.sessionToken);
        navigate('/mobile?remote=1');
      } else {
        setError(result.error || '验证失败');
      }
    } catch (e: any) {
      setError('网络错误: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-2">📱 远程访问</h1>
        <p className="text-sm text-slate-400 text-center mb-8">
          请输入电脑端显示的 6 位验证码
        </p>

        <input
          type="tel"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          className="w-full px-4 py-4 bg-slate-800 border border-slate-700 rounded-xl text-center text-2xl tracking-widest"
        />

        {error && <p className="text-red-400 text-sm mt-3 text-center">{error}</p>}

        <button
          onClick={() => handleSubmit()}
          disabled={loading || code.length !== 6}
          className="w-full mt-6 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl font-medium transition-colors"
        >
          {loading ? '验证中...' : '验证'}
        </button>

        <p className="text-xs text-slate-500 text-center mt-8">
          验证码有效期 10 分钟，仅可使用一次
        </p>
      </div>
    </div>
  );
}
