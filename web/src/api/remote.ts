// 远程控制 API 封装
// 内网模式直接调本地后端，外网模式调 VPS

const AUTH_URL = (import.meta as any).env?.VITE_AUTH_URL || 'http://106.15.11.158:3456';

// Electron 打包环境下页面通过 file:// 加载，相对路径 /api 会失败，需要用绝对地址
const isElectron = typeof window !== 'undefined' && 'electronAPI' in window;
const LOCAL_BASE = isElectron ? 'http://localhost:3000' : '';

export const remoteApi = {
  /** 本地后端：获取本机识别码 + 密码是否已设置 */
  async getDeviceInfo(): Promise<{ success: boolean; deviceId?: string; shortId?: string; hasPassword?: boolean; error?: string }> {
    const resp = await fetch(`${LOCAL_BASE}/api/remote/device-info`);
    return resp.json();
  },

  /** 本地后端：设置/修改访问密码 */
  async setPassword(password: string): Promise<{ success: boolean; shortId?: string; error?: string }> {
    const resp = await fetch(`${LOCAL_BASE}/api/remote/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    return resp.json();
  },

  /** 本地后端：查询 RemoteClient 是否连上 VPS */
  async connectionStatus(): Promise<{ connected: boolean }> {
    try {
      const resp = await fetch(`${LOCAL_BASE}/api/remote/connection-status`);
      return resp.json();
    } catch {
      return { connected: false };
    }
  },

  /** 云端：手机端识别码 + 密码登录 → sessionToken */
  async verifyPassword(shortId: string, password: string): Promise<{ success: boolean; sessionToken?: string; deviceId?: string; deviceOnline?: boolean; error?: string }> {
    const resp = await fetch(`${AUTH_URL}/api/remote/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shortId, password }),
    });
    return resp.json();
  },

  /** 云端：拉取历史日志 */
  async fetchLogs(sessionToken: string, limit: number = 200): Promise<{ success: boolean; logs?: any[]; deviceOnline?: boolean; error?: string }> {
    const resp = await fetch(`${AUTH_URL}/api/remote/logs?limit=${limit}`, {
      headers: { 'x-session-token': sessionToken },
    });
    return resp.json();
  },

  /** 云端：查询设备在线状态 */
  async deviceStatus(sessionToken: string): Promise<{ success: boolean; online?: boolean; error?: string }> {
    const resp = await fetch(`${AUTH_URL}/api/remote/status`, {
      headers: { 'x-session-token': sessionToken },
    });
    return resp.json();
  },

  /** 云端：WebSocket URL */
  getWsUrl(): string {
    return AUTH_URL.replace(/^http/, 'ws') + '/ws/remote';
  },
};
