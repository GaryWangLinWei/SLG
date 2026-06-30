// 远程控制 API 封装
// 内网模式直接调本地后端，外网模式调 VPS

const AUTH_URL = (import.meta as any).env?.VITE_AUTH_URL || 'http://106.15.11.158:3456';

export const remoteApi = {
  /** 本地后端：让本地客户端生成验证码 */
  async generateCode(): Promise<{ success: boolean; code?: string; expiresAt?: number; error?: string }> {
    const resp = await fetch('/api/remote/generate-code', { method: 'POST' });
    return resp.json();
  },

  /** 本地后端：查询 RemoteClient 是否连上 VPS */
  async connectionStatus(): Promise<{ connected: boolean }> {
    try {
      const resp = await fetch('/api/remote/connection-status');
      return resp.json();
    } catch {
      return { connected: false };
    }
  },

  /** 云端：手机端验证验证码，换取 sessionToken */
  async verifyCode(code: string): Promise<{ success: boolean; sessionToken?: string; deviceId?: string; deviceOnline?: boolean; error?: string }> {
    const resp = await fetch(`${AUTH_URL}/api/remote/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
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
