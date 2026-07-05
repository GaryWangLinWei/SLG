import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { remoteApi } from '../api/remote';

const SESSION_KEY = 'remote-session-token';

/** 格式化 9 位识别码：ABC123DEF → ABC-123-DEF */
function formatShortId(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 9);
  return clean.replace(/(.{3})(.{3})?(.{3})?/, (_m, a, b, c) => [a, b, c].filter(Boolean).join('-'));
}

/** 去掉分隔符拿到纯识别码 */
function stripShortId(formatted: string): string {
  return formatted.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export default function RemoteAccessPage() {
  const [shortId, setShortId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // 检查已有 session，直接跳转
  useEffect(() => {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) navigate('/mobile?remote=1');
  }, [navigate]);

  async function handleSubmit() {
    const cleanId = stripShortId(shortId);
    if (cleanId.length !== 9) {
      setError('请输入 9 位识别码');
      return;
    }
    if (!/^\d{6}$/.test(password)) {
      setError('请输入 6 位数字密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await remoteApi.verifyPassword(cleanId, password);
      if (result.success && result.sessionToken) {
        localStorage.setItem(SESSION_KEY, result.sessionToken);
        navigate('/mobile?remote=1');
      } else {
        setError(result.error || '登录失败');
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
          输入电脑端的识别码和你设置的访问密码
        </p>

        <label className="block text-xs text-slate-400 mb-2">识别码（9 位）</label>
        <input
          type="text"
          autoCapitalize="characters"
          autoComplete="off"
          value={shortId}
          onChange={e => setShortId(formatShortId(e.target.value))}
          placeholder="XXX-XXX-XXX"
          className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-center text-xl tracking-widest font-mono uppercase"
        />

        <label className="block text-xs text-slate-400 mt-4 mb-2">访问密码（6 位数字）</label>
        <input
          type="tel"
          inputMode="numeric"
          maxLength={6}
          value={password}
          onChange={e => setPassword(e.target.value.replace(/\D/g, ''))}
          placeholder="●●●●●●"
          className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-center text-xl tracking-widest"
        />

        {error && <p className="text-red-400 text-sm mt-3 text-center">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading || stripShortId(shortId).length !== 9 || password.length !== 6}
          className="w-full mt-6 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-500 rounded-xl font-medium transition-colors"
        >
          {loading ? '登录中...' : '登录'}
        </button>

        <p className="text-xs text-slate-500 text-center mt-8">
          错误次数过多会临时锁定（5 次锁 5 分钟）<br />
          登录后可保持 30 天，期间使用会自动续期
        </p>
      </div>
    </div>
  );
}
