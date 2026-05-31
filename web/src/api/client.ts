const isElectron = typeof window !== 'undefined' && 'electronAPI' in window;
const API_BASE = isElectron ? 'http://localhost:3000/api' : '/api';

class ApiError extends Error {
  status: number;
  data?: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage = data?.error || data?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new ApiError(errorMessage, response.status, data);
  }

  return data as T;
}

export interface PluginAction {
  id: string;
  name: string;
  description: string;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  actions: PluginAction[];
  config?: Record<string, any>;
}

export interface Task {
  id: string;
  accountId: string;
  pluginId: string;
  actionId: string;
  config: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'error' | 'stopped';
  startTime?: string;
  endTime?: string;
  logs: string[];
  error?: string;
  stopRequested?: boolean;
}

export interface Account {
  id: string;
  name: string;
  deviceId: string;
  createdAt: number;
}

export interface DeviceInfo {
  deviceId: string;
  status: string;
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  accounts: {
    list: () =>
      request<{ success: boolean; accounts: Account[] }>('/accounts'),
    get: (id: string) =>
      request<{ success: boolean; account: Account }>(`/accounts/${id}`),
    create: (data: { name: string; deviceId: string }) =>
      request<{ success: boolean; account: Account }>('/accounts', {
        method: 'POST',
        body: JSON.stringify(data)
      }),
    update: (id: string, data: { name?: string; deviceId?: string }) =>
      request<{ success: boolean; account: Account }>(`/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/accounts/${id}`, { method: 'DELETE' })
  },

  device: {
    scan: () =>
      request<{ success: boolean; devices: DeviceInfo[] }>('/device/scan'),
    status: (accountId: string) =>
      request<{ connected: boolean; deviceInfo?: string }>(`/device/status?accountId=${accountId}`),
    connect: (accountId: string) =>
      request<{ connected: boolean; message: string }>('/device/connect', {
        method: 'POST',
        body: JSON.stringify({ accountId })
      }),
    disconnect: (accountId: string) =>
      request<{ success: boolean }>('/device/disconnect', {
        method: 'POST',
        body: JSON.stringify({ accountId })
      }),
    screenshot: (accountId: string) =>
      request<{ success: boolean; data?: string; error?: string }>(`/device/screenshot?accountId=${accountId}`),
    tap: (accountId: string, x: number, y: number) =>
      request('/device/tap', {
        method: 'POST',
        body: JSON.stringify({ accountId, x, y })
      }),
    swipe: (accountId: string, x1: number, y1: number, x2: number, y2: number, duration?: number) =>
      request('/device/swipe', {
        method: 'POST',
        body: JSON.stringify({ accountId, x1, y1, x2, y2, duration })
      })
  },

  plugins: {
    list: () =>
      request<{ success: boolean; plugins: Plugin[] }>('/plugins'),
    getConfig: (id: string, accountId: string) =>
      request<{ success: boolean; config: Record<string, any>; defaultConfig: any }>(`/plugins/${id}/config?accountId=${accountId}`)
  },

  tasks: {
    list: () =>
      request<{ success: boolean; tasks: Task[] }>('/tasks'),
    get: (id: string) =>
      request<{ success: boolean; task: Task }>(`/tasks/${id}`),
    create: (accountId: string, pluginId: string, actionId: string, config: Record<string, any> = {}) =>
      request<{ success: boolean; task: Task }>('/tasks', {
        method: 'POST',
        body: JSON.stringify({ accountId, pluginId, actionId, config })
      }),
    run: (id: string) =>
      request<{ success: boolean; task: Task }>(`/tasks/${id}/run`, { method: 'POST' }),
    stop: (id: string) =>
      request<{ success: boolean; message: string }>(`/tasks/${id}/stop`, { method: 'POST' })
  },

  config: {
    getRokConfig: (accountId: string, name?: string) => {
      const params = new URLSearchParams({ accountId });
      if (name) params.set('name', name);
      return request<{ success: boolean; config: Record<string, any> }>(`/config/rok?${params}`);
    },
    saveRokConfig: (accountId: string, config: Record<string, any>, name: string) =>
      request<{ success: boolean }>(`/config/rok?accountId=${accountId}&name=${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify(config)
      }),
    getProfiles: (accountId: string) =>
      request<{ success: boolean; profiles: string[]; active: string }>(`/config/rok/profiles?accountId=${accountId}`),
    switchProfile: (accountId: string, name: string) =>
      request<{ success: boolean }>(`/config/rok/switch?accountId=${accountId}`, {
        method: 'POST',
        body: JSON.stringify({ name })
      }),
    createProfile: (accountId: string, name: string) =>
      request<{ success: boolean }>(`/config/rok/create?accountId=${accountId}`, {
        method: 'POST',
        body: JSON.stringify({ name })
      }),
    deleteProfile: (accountId: string, name: string) =>
      request<{ success: boolean }>(`/config/rok?accountId=${accountId}&name=${encodeURIComponent(name)}`, {
        method: 'DELETE'
      }),
    renameProfile: (accountId: string, oldName: string, newName: string) =>
      request<{ success: boolean }>(`/config/rok/rename?accountId=${accountId}`, {
        method: 'POST',
        body: JSON.stringify({ oldName, newName })
      })
  },

  license: {
    getStatus: () =>
      request<{ success: boolean; status: any }>('/license/status'),
    activate: (code: string, inviteCode?: string) =>
      request<{ success: boolean; error?: string; expiresAt?: number; inviteBonus?: boolean; inviteError?: string; inviterBonusDays?: number; inviteeBonusDays?: number }>('/license/activate', {
        method: 'POST',
        body: JSON.stringify({ code, inviteCode })
      }),
    preview: (code: string) =>
      request<{ success: boolean; durationDays?: number; error?: string }>('/license/preview', {
        method: 'POST',
        body: JSON.stringify({ code })
      }),
    deactivate: () =>
      request<{ success: boolean }>('/license/deactivate', { method: 'POST' })
  }
};
