import { useEffect, useRef, useState, useCallback } from 'react';
import { remoteApi } from '../api/remote';

interface WsMessage {
  type: string;
  id: string;
  deviceId: string;
  data: any;
  timestamp: number;
}

export interface LogEntry {
  id: number;
  time: string;
  message: string;
  timestamp: number;
  level?: string;
}

export interface RemoteState {
  connected: boolean;
  deviceOnline: boolean;
  logs: LogEntry[];
  runningTasks: string[];
}

const MAX_LOGS = 500;
let logIdSeq = 1;

function timestampToTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN');
}

/** 远程控制 WebSocket Hook，自动重连 */
export function useRemoteSocket(sessionToken: string | null) {
  const [state, setState] = useState<RemoteState>({
    connected: false, deviceOnline: false, logs: [], runningTasks: [],
  });
  const wsRef = useRef<WebSocket | null>(null);
  const pendingResponses = useRef<Map<string, (resp: any) => void>>(new Map());
  const reconnectTimer = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (!sessionToken) return;
    const ws = new WebSocket(remoteApi.getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'auth', id: crypto.randomUUID(), deviceId: '',
        data: { role: 'user', token: sessionToken }, timestamp: Date.now(),
      }));
    };

    ws.onmessage = (e) => {
      let msg: WsMessage;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'response' && msg.data?.success && !state.connected) {
        setState(s => ({ ...s, connected: true }));
        return;
      }

      if (msg.type === 'response' && msg.data?.requestId) {
        const cb = pendingResponses.current.get(msg.data.requestId);
        if (cb) { cb(msg.data); pendingResponses.current.delete(msg.data.requestId); }
        return;
      }

      if (msg.type === 'status') {
        setState(s => ({
          ...s,
          deviceOnline: !!msg.data.online,
          runningTasks: msg.data.runningTasks || [],
        }));
        return;
      }

      if (msg.type === 'log') {
        const entry: LogEntry = {
          id: logIdSeq++,
          time: timestampToTime(msg.timestamp),
          message: msg.data.message,
          level: msg.data.level,
          timestamp: msg.timestamp,
        };
        setState(s => ({ ...s, logs: [...s.logs, entry].slice(-MAX_LOGS) }));
        return;
      }
    };

    ws.onclose = () => {
      setState(s => ({ ...s, connected: false }));
      if (sessionToken) {
        reconnectTimer.current = window.setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => { /* close 会随后触发 */ };
  }, [sessionToken]);

  // 发送指令，返回 Promise
  const sendCommand = useCallback((action: string, payload?: any, timeoutMs: number = 10000): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('未连接到云端'));
        return;
      }
      const reqId = crypto.randomUUID();
      pendingResponses.current.set(reqId, resolve);
      setTimeout(() => {
        if (pendingResponses.current.has(reqId)) {
          pendingResponses.current.delete(reqId);
          reject(new Error('指令超时'));
        }
      }, timeoutMs);
      wsRef.current.send(JSON.stringify({
        type: 'command', id: reqId, deviceId: '',
        data: { action, payload }, timestamp: Date.now(),
      }));
    });
  }, []);

  // 预加载历史日志
  const loadHistory = useCallback(async () => {
    if (!sessionToken) return;
    const resp = await remoteApi.fetchLogs(sessionToken, 200);
    if (resp.success && resp.logs) {
      const entries: LogEntry[] = resp.logs.map((l: any) => ({
        id: logIdSeq++,
        time: timestampToTime(l.timestamp),
        message: l.message,
        level: l.level,
        timestamp: l.timestamp,
      }));
      setState(s => ({ ...s, logs: entries }));
    }
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) return;
    loadHistory();
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [sessionToken, connect, loadHistory]);

  return { state, sendCommand };
}
