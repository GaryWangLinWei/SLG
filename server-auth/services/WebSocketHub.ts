import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { remoteCodeService } from './RemoteCodeService';
import { remoteLogService } from './RemoteLogService';
import { WsMessage, AuthData, LogData, CommandData, StatusData } from '../ws/messages';

interface DeviceConnection {
  ws: WebSocket;
  deviceId: string;
  activationCode: string;
  connectedAt: number;
}

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

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws/remote' });
    this.wss.on('connection', (ws, req) => {
      let authed = false;
      let connInfo: { role: 'device' | 'user'; deviceId: string } | null = null;

      ws.on('message', (raw) => {
        let msg: WsMessage;
        try { msg = JSON.parse(raw.toString()); }
        catch { ws.close(1003, 'invalid json'); return; }

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
          this.devices.delete(connInfo.deviceId);
          this.broadcastStatusToUsers(connInfo.deviceId, { online: false, runningTasks: [] });
        } else {
          for (const u of this.users) if (u.ws === ws) { this.users.delete(u); break; }
        }
      });

      ws.on('error', (err) => console.error('[WS] connection error:', err));
    });
    console.log('[WS] WebSocketHub attached to /ws/remote');
  }

  private authenticate(ws: WebSocket, auth: AuthData): { success: boolean; deviceId?: string; error?: string } {
    if (auth.role === 'device') {
      if (!auth.token) return { success: false, error: '缺少 token' };
      const deviceId = auth.token;
      const old = this.devices.get(deviceId);
      if (old) old.ws.close(1000, 'replaced');
      this.devices.set(deviceId, { ws, deviceId, activationCode: auth.token, connectedAt: Date.now() });
      this.broadcastStatusToUsers(deviceId, { online: true, runningTasks: [] });
      return { success: true, deviceId };
    } else {
      const result = remoteCodeService.verifySession(auth.token);
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
      if (msg.type === 'log') {
        const log = msg.data as LogData;
        const device = this.devices.get(deviceId);
        if (device) {
          remoteLogService.insertLogs(deviceId, device.activationCode, [{
            message: log.message, level: log.level || 'info', timestamp: msg.timestamp,
          }]);
        }
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
}

export const webSocketHub = new WebSocketHub();
