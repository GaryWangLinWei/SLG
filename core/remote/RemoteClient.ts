import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { WsMessage, AuthData, LogData, StatusData, CommandData, ResponseData } from './messages';

const DEFAULT_RECONNECT_DELAY_MS = 3000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
const DEFAULT_PONG_TIMEOUT_MS = 90000;
const LOG_BATCH_INTERVAL_MS = 1000;
const LOG_BATCH_SIZE = 10;

export type CommandCallback = (cmd: CommandData) => Promise<{ success: boolean; result?: any; error?: string }>;

export interface RemoteClientOptions {
  serverUrl: string;
  deviceId: string;
  activationCode: string;
  /** 心跳/探活间隔，默认 30s */
  heartbeatIntervalMs?: number;
  /** 超过该时长没收到对端任何数据（含 pong）就判定连接已死，默认 90s */
  pongTimeoutMs?: number;
  /** 断线重连延迟，默认 3s */
  reconnectDelayMs?: number;
}

export class RemoteClient {
  private ws: WebSocket | null = null;
  private opts: RemoteClientOptions | null = null;
  private logBuffer: Array<{ message: string; level: string; timestamp: number }> = [];
  private logFlushTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private commandHandler: CommandCallback | null = null;
  private statusProvider: (() => StatusData) | null = null;
  private connected = false;
  private stopped = false;
  /** 最近一次收到对端数据（业务消息或 pong）的时间，用于识别半开的僵尸连接 */
  private lastInboundAt = 0;

  start(opts: RemoteClientOptions): void {
    this.opts = opts;
    this.stopped = false;
    this.connect();
    this.startLogFlushLoop();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.logFlushTimer) clearInterval(this.logFlushTimer);
    if (this.ws) { this.ws.terminate(); this.ws = null; }
  }

  onCommand(handler: CommandCallback): void { this.commandHandler = handler; }
  onStatusRequest(provider: () => StatusData): void { this.statusProvider = provider; }

  pushLog(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this.logBuffer.push({ message, level, timestamp: Date.now() });
    if (this.logBuffer.length >= LOG_BATCH_SIZE) this.flushLogs();
  }

  /** 通知云端清空该设备日志（重启计数），云端会广播给所有 user */
  pushLogClear(): void {
    if (!this.connected || !this.ws || !this.opts) return;
    // 先把 buffer 里未发送的日志丢弃（避免清后又冒出老日志）
    this.logBuffer = [];
    this.send({
      type: 'log_clear', id: randomUUID(), deviceId: this.opts.deviceId,
      data: {}, timestamp: Date.now(),
    });
  }

  pushStatus(status: StatusData): void {
    if (!this.connected || !this.ws || !this.opts) return;
    this.send({ type: 'status', id: randomUUID(), deviceId: this.opts.deviceId, data: status, timestamp: Date.now() });
  }

  isConnected(): boolean { return this.connected; }

  private connect(): void {
    if (!this.opts || this.stopped) return;
    try {
      this.ws = new WebSocket(this.opts.serverUrl);
      this.ws.on('open', () => this.onOpen());
      this.ws.on('message', (raw) => this.onMessage(raw.toString()));
      this.ws.on('pong', () => { this.lastInboundAt = Date.now(); });
      this.ws.on('close', () => this.onClose());
      this.ws.on('error', (err) => console.error('[RemoteClient] WS error:', err.message));
    } catch (e) {
      console.error('[RemoteClient] connect failed:', e);
      this.scheduleReconnect();
    }
  }

  private onOpen(): void {
    if (!this.opts || !this.ws) return;
    const authMsg: WsMessage<AuthData> = {
      type: 'auth', id: randomUUID(), deviceId: this.opts.deviceId,
      data: { role: 'device', token: this.opts.activationCode },
      timestamp: Date.now(),
    };
    this.ws.send(JSON.stringify(authMsg));
  }

  private onMessage(raw: string): void {
    this.lastInboundAt = Date.now();
    let msg: WsMessage;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'response' && msg.data?.success && !this.connected) {
      this.connected = true;
      console.log('[RemoteClient] authenticated, deviceId:', msg.data.result?.deviceId);
      this.startHeartbeat();
      this.flushLogs();
      return;
    }
    if (msg.type === 'command') this.handleCommand(msg);
  }

  private async handleCommand(msg: WsMessage): Promise<void> {
    const cmd = msg.data as CommandData;
    let response: ResponseData;
    if (cmd.action === 'get_status' && this.statusProvider) {
      response = { requestId: msg.id, success: true, result: this.statusProvider() };
    } else if (this.commandHandler) {
      try {
        const result = await this.commandHandler(cmd);
        response = { requestId: msg.id, ...result };
      } catch (e: any) {
        response = { requestId: msg.id, success: false, error: e.message || String(e) };
      }
    } else {
      response = { requestId: msg.id, success: false, error: '未注册指令处理器' };
    }
    this.send({ type: 'response', id: randomUUID(), deviceId: this.opts!.deviceId, data: response, timestamp: Date.now() });
  }

  private onClose(): void {
    this.connected = false;
    this.ws = null;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (!this.stopped) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[RemoteClient] reconnecting...');
      this.connect();
    }, this.opts?.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.lastInboundAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected || !this.ws) return;
      // 云端不会主动给设备发消息，只能靠协议层 ping/pong 判断链路是否还活着。
      // 半开连接下 readyState 仍是 OPEN、send 不报错，若不主动探活会永远停留在
      // “本地显示已连接、云端已判离线”的状态，只能重启进程恢复。
      const timeout = this.opts?.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
      if (Date.now() - this.lastInboundAt > timeout) {
        console.warn(`[RemoteClient] no pong for ${timeout}ms, terminating to force reconnect`);
        // 必须 terminate：僵尸连接上的 close 握手等不到对端回应，会一直挂住
        this.ws.terminate();
        return;
      }
      this.send({ type: 'heartbeat', id: randomUUID(), deviceId: this.opts!.deviceId, data: {}, timestamp: Date.now() });
      try { this.ws.ping(); } catch { /* ignore */ }
    }, this.opts?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  }

  private startLogFlushLoop(): void {
    if (this.logFlushTimer) return;
    this.logFlushTimer = setInterval(() => this.flushLogs(), LOG_BATCH_INTERVAL_MS);
  }

  private flushLogs(): void {
    if (!this.connected || !this.ws || !this.opts) return;
    if (this.logBuffer.length === 0) return;
    const batch = this.logBuffer.splice(0, this.logBuffer.length);
    for (const log of batch) {
      this.send({ type: 'log', id: randomUUID(), deviceId: this.opts.deviceId,
        data: { message: log.message, level: log.level } as LogData, timestamp: log.timestamp });
    }
  }

  private send(msg: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

export const remoteClient = new RemoteClient();
