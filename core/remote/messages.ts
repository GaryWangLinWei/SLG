// 与 server-auth/ws/messages.ts 完全同步
// 不要跨项目 import：server-auth 是独立 npm 项目

export type WsMessageType = 'log' | 'command' | 'response' | 'status' | 'heartbeat' | 'auth';

export interface WsMessage<T = any> {
  type: WsMessageType;
  id: string;        // 消息 UUID，用于 request-response 匹配
  deviceId: string;  // 目标/来源设备 ID（电脑端的激活码 hash）
  data: T;
  timestamp: number;
}

// 日志消息
export interface LogData {
  message: string;
  level: 'info' | 'warn' | 'error';
}

// 指令消息（手机 → 云端 → 电脑）
export interface CommandData {
  action: 'start_task' | 'stop_task' | 'stop_all' | 'get_status' | 'get_logs';
  payload?: Record<string, any>;
}

// 响应消息（电脑 → 云端 → 手机）
export interface ResponseData {
  requestId: string;  // 对应原始 command 的 id
  success: boolean;
  result?: any;
  error?: string;
}

// 状态消息
export interface StatusData {
  online: boolean;
  runningTasks: string[];
  features?: Record<string, any>;
}

// 设备认证（WS 建立连接后第一条消息）
export interface AuthData {
  role: 'device' | 'user';
  token: string;       // device: 激活码 + fingerprint; user: 验证码换的 sessionToken
  deviceId?: string;   // user 角色需指定要监听哪个设备
}
