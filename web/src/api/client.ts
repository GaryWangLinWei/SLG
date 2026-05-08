const API_BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
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
  pluginId: string;
  actionId: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime?: string;
  endTime?: string;
  logs: string[];
  error?: string;
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  device: {
    status: () => request<{ connected: boolean; deviceInfo?: string }>('/device/status'),
    connect: () => request<{ connected: boolean; message: string }>('/device/connect', { method: 'POST' }),
    disconnect: () => request<{ success: boolean }>('/device/disconnect', { method: 'POST' }),
    screenshot: () => request<{ success: boolean; data?: string; error?: string }>('/device/screenshot'),
    tap: (x: number, y: number) => request('/device/tap', { method: 'POST', body: JSON.stringify({ x, y }) }),
    swipe: (x1: number, y1: number, x2: number, y2: number, duration?: number) =>
      request('/device/swipe', { method: 'POST', body: JSON.stringify({ x1, y1, x2, y2, duration }) })
  },
  plugins: {
    list: () => request<{ success: boolean; plugins: Plugin[] }>('/plugins')
  },
  tasks: {
    list: () => request<{ success: boolean; tasks: Task[] }>('/tasks'),
    get: (id: string) => request<{ success: boolean; task: Task }>(`/tasks/${id}`),
    create: (pluginId: string, actionId: string, config: Record<string, any> = {}) =>
      request<{ success: boolean; task: Task }>('/tasks', {
        method: 'POST',
        body: JSON.stringify({ pluginId, actionId, config })
      }),
    run: (id: string) =>
      request<{ success: boolean; task: Task }>(`/tasks/${id}/run`, { method: 'POST' })
  }
};
