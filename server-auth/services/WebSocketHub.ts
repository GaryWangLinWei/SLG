import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { remoteDeviceService } from './RemoteDeviceService';
import { remoteLogService } from './RemoteLogService';
import { WsMessage, AuthData, LogData, CommandData, StatusData } from '../ws/messages';

interface DeviceConnection {
  ws: WebSocket;
  deviceId: string;
  activationCode: string;
  connectedAt: number;
  lastSeen: number;
}

// 设备心跳 30s 一次；超过此时长未收到任何消息视为僵尸连接（网络半开），服务端主动断开
const DEVICE_TIMEOUT_MS = 70_000;
const SWEEP_INTERVAL_MS = 15_000;

interface UserConnection {
  ws: WebSocket;
  sessionToken: string;
  deviceId: string;
  connectedAt: number;
}

class WebSocketHub {
  private wss: WebSocketServer | null = null;
  private devices: Map<string, DeviceConnection> = new Map();
  private users: Set<UserConnection> = new Set();
  private sweepTimer: NodeJS.Timeout | null = null;

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws/remote' });
    this.startSweep();
    this.wss.on('connection', (ws, req) => {
      let authed = false;
      let connInfo: { role: 'device' | 'user'; deviceId: string } | null = null;

      ws.on('message', (raw) => {
        let msg: WsMessage;
        try { msg = JSON.parse(raw.toString()); }
        catch { ws.close(1003, 'invalid json'); return; }

        // 任意已认证消息都刷新该连接的存活时间，供僵尸连接清理使用
        if (authed && connInfo?.role === 'device') {
          const conn = this.devices.get(connInfo.deviceId);
          if (conn && conn.ws === ws) conn.lastSeen = Date.now();
        }

        if (!authed) {
          if (msg.type !== 'auth') { ws.close(1008, 'auth required'); return; }
          const auth = msg.data as AuthData;
          const result = this.authenticate(ws, auth);
          if (!result.success) {
            ws.send(JSON.stringify({
              type: 'response', id: msg.id, deviceId: '',
              data: { requestId: msg.id, success: false, error: result.error },
              timestamp: Date.now(),
            }));
            ws.close(1008, result.error);
            return;
          }
          authed = true;
          connInfo = { role: auth.role, deviceId: result.deviceId! };
          ws.send(JSON.stringify({
            type: 'response', id: msg.id, deviceId: result.deviceId!,
            data: { requestId: msg.id, success: true, result: { deviceId: result.deviceId } },
            timestamp: Date.now(),
          }));
          return;
        }

        if (!connInfo) return;
        this.routeMessage(connInfo.role, connInfo.deviceId, msg);
      });

      ws.on('close', () => {
        if (!connInfo) return;
        if (connInfo.role === 'device') {
          // 只在当前登记的就是这条连接时才判定离线。
          // 重连时新连接会替换旧连接，旧连接的 close 事件异步到达，若不校验会误删新连接，
          // 导致手机端显示离线但设备实际仍在线运行。
          const current = this.devices.get(connInfo.deviceId);
          if (current && current.ws !== ws) return;
          if (current) {
            this.devices.delete(connInfo.deviceId);
            this.broadcastStatusToUsers(connInfo.deviceId, { online: false, runningTasks: [] });
          }
        } else {
          for (const u of this.users) if (u.ws === ws) { this.users.delete(u); break; }
        }
      });

      ws.on('error', (err) => console.error('[WS] connection error:', err));
    });
    console.log('[WS] WebSocketHub attached to /ws/remote');
  }

  /**
   * 周期性清理僵尸设备连接：客户端可能因网络半开而未触发 close 事件，
   * 服务端长时间收不到任何消息（含心跳）就主动断开，触发客户端重连，
   * 并正确广播离线状态。
   */
  private startSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [deviceId, conn] of this.devices) {
        if (now - conn.lastSeen > DEVICE_TIMEOUT_MS) {
          console.log(`[WS] device ${deviceId} timed out (no heartbeat ${DEVICE_TIMEOUT_MS}ms), closing`);
          try { conn.ws.close(1001, 'heartbeat timeout'); } catch { /* ignore */ }
          // close 事件会异步清理；这里不直接删，交由回调统一处理
        }
      }
    }, SWEEP_INTERVAL_MS);
  }

  private authenticate(ws: WebSocket, auth: AuthData): { success: boolean; deviceId?: string; error?: string } {
    if (auth.role === 'device') {
      if (!auth.token) return { success: false, error: '缺少 token' };
      const deviceId = auth.token;
      // 校验该指纹仍是有效绑定（未解绑、码 used、未过期）。解绑后 kick 掉旧连接；
      // 即使本地 stop 失败或旧客户端硬连，也进不来。懒加载 require 避免顶层循环依赖。
      const { getDb } = require('./AuthDatabase') as typeof import('./AuthDatabase');
      const row = getDb().prepare(`
        SELECT ac.status, ac.expires_at
        FROM device_bindings db
        JOIN activation_codes ac ON ac.id = db.activation_code_id
        WHERE db.device_fingerprint = ?
        LIMIT 1
      `).get(deviceId) as { status: string; expires_at: number } | undefined;
      if (!row || row.status !== 'used' || !row.expires_at || row.expires_at <= Date.now()) {
        return { success: false, error: '设备未授权或已解绑' };
      }
      const old = this.devices.get(deviceId);
      if (old) old.ws.close(1000, 'replaced');
      this.devices.set(deviceId, { ws, deviceId, activationCode: auth.token, connectedAt: Date.now(), lastSeen: Date.now() });
      this.broadcastStatusToUsers(deviceId, { online: true, runningTasks: [] });
      return { success: true, deviceId };
    } else {
      const result = remoteDeviceService.verifySession(auth.token);
      if (!result.valid) return { success: false, error: '会话无效或已过期' };
      const userConn: UserConnection = { ws, sessionToken: auth.token, deviceId: result.deviceId!, connectedAt: Date.now() };
      this.users.add(userConn);
      const device = this.devices.get(result.deviceId!);
      ws.send(JSON.stringify({
        type: 'status', id: randomUUID(), deviceId: result.deviceId!,
        data: { online: !!device, runningTasks: [] } as StatusData,
        timestamp: Date.now(),
      }));
      return { success: true, deviceId: result.deviceId };
    }
  }

  private routeMessage(role: 'device' | 'user', deviceId: string, msg: WsMessage): void {
    if (role === 'device') {
      if (msg.type === 'heartbeat') {
        // 心跳仅用于刷新 lastSeen（已在 message 入口统一刷新），无需转发或回复
      } else if (msg.type === 'log') {
        const log = msg.data as LogData;
        const device = this.devices.get(deviceId);
        if (device) {
          remoteLogService.insertLogs(deviceId, device.activationCode, [{
            message: log.message, level: log.level || 'info', timestamp: msg.timestamp,
          }]);
        }
        this.broadcastToUsers(deviceId, msg);
      } else if (msg.type === 'log_clear') {
        // 电脑端点击"开始"通知云端清空日志
        remoteLogService.clearDevice(deviceId);
        this.broadcastToUsers(deviceId, msg);
      } else if (msg.type === 'response' || msg.type === 'status') {
        this.broadcastToUsers(deviceId, msg);
      }
    } else {
      if (msg.type === 'command') {
        const device = this.devices.get(deviceId);
        if (!device) { this.sendToOneUser(msg.id, deviceId, { online: false }); return; }
        device.ws.send(JSON.stringify(msg));
      }
    }
  }

  private broadcastToUsers(deviceId: string, msg: WsMessage): void {
    const payload = JSON.stringify(msg);
    for (const u of this.users) {
      if (u.deviceId === deviceId && u.ws.readyState === WebSocket.OPEN) u.ws.send(payload);
    }
  }

  private broadcastStatusToUsers(deviceId: string, status: StatusData): void {
    this.broadcastToUsers(deviceId, {
      type: 'status', id: randomUUID(), deviceId, data: status, timestamp: Date.now(),
    });
  }

  private sendToOneUser(requestId: string, deviceId: string, ctx: { online: boolean }): void {
    const payload = JSON.stringify({
      type: 'response', id: randomUUID(), deviceId,
      data: { requestId, success: false, error: ctx.online ? '未知错误' : '设备离线' },
      timestamp: Date.now(),
    });
    for (const u of this.users) {
      if (u.deviceId === deviceId && u.ws.readyState === WebSocket.OPEN) u.ws.send(payload);
    }
  }

  isDeviceOnline(deviceId: string): boolean {
    return this.devices.has(deviceId);
  }

  /**
   * 解绑/管理员删除设备后调用：关闭该设备的 device 连接和所有关联手机端连接，
   * 并广播离线。WS close 事件会异步清理 map/set，这里主动删除+广播保证即时生效。
   */
  kick(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      try { device.ws.close(1000, 'device unbound'); } catch { /* ignore */ }
      this.devices.delete(deviceId);
      this.broadcastStatusToUsers(deviceId, { online: false, runningTasks: [] });
    }
    for (const u of [...this.users]) {
      if (u.deviceId === deviceId) {
        try { u.ws.close(1000, 'device unbound'); } catch { /* ignore */ }
        this.users.delete(u);
      }
    }
  }
}

export const webSocketHub = new WebSocketHub();
