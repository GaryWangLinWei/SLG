import { WebSocketServer, WebSocket as WsSocket } from 'ws';
import { AddressInfo } from 'net';
import { RemoteClient } from './RemoteClient';

/**
 * 半开连接（僵尸连接）回归测试：
 * 云端 sweep 已把设备判离线，但电脑端 socket 没收到 close，
 * 旧实现里 connected 永远为 true，手机端显示离线且无法下发指令，只能重启进程。
 */

interface Harness {
  url: string;
  server: WebSocketServer;
  connections: number;
  close(): Promise<void>;
}

/**
 * 启动一个会正常完成 auth 的假云端。
 * silentPong=true 时屏蔽掉 ws 自带的自动 pong，模拟对端已经失联但 TCP 仍未收到 FIN。
 */
async function startFakeCloud(opts: { silentPong: boolean }): Promise<Harness> {
  const server = new WebSocketServer({ port: 0, path: '/ws/remote' });
  const harness: Harness = {
    url: '',
    server,
    connections: 0,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of server.clients) c.terminate();
        server.close(() => resolve());
      }),
  };

  server.on('connection', (ws: WsSocket) => {
    harness.connections += 1;
    if (opts.silentPong) {
      // ws 收到 ping 会自动回 pong，这里改成静默，socket 保持 OPEN 但对端“听不到”
      (ws as any).pong = () => { /* 静默 */ };
    }
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth') {
        ws.send(JSON.stringify({
          type: 'response', id: msg.id, deviceId: 'dev-1',
          data: { requestId: msg.id, success: true, result: { deviceId: 'dev-1' } },
          timestamp: 1,
        }));
      }
    });
  });

  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  harness.url = `ws://127.0.0.1:${port}/ws/remote`;
  return harness;
}

function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > timeoutMs) {
        clearInterval(timer); reject(new Error('waitFor 超时'));
      }
    }, 10);
  });
}

describe('RemoteClient 探活', () => {
  let cloud: Harness | null = null;
  let client: RemoteClient | null = null;

  afterEach(async () => {
    client?.stop();
    client = null;
    await cloud?.close();
    cloud = null;
  });

  it('对端不回 pong 时判定断线并自动重连', async () => {
    cloud = await startFakeCloud({ silentPong: true });
    client = new RemoteClient();
    client.start({
      serverUrl: cloud.url, deviceId: 'dev-1', activationCode: 'dev-1',
      heartbeatIntervalMs: 50, pongTimeoutMs: 200, reconnectDelayMs: 50,
    });

    await waitFor(() => client!.isConnected());
    await waitFor(() => !client!.isConnected());
    await waitFor(() => cloud!.connections >= 2);
  });

  it('对端正常回 pong 时保持连接', async () => {
    cloud = await startFakeCloud({ silentPong: false });
    client = new RemoteClient();
    client.start({
      serverUrl: cloud.url, deviceId: 'dev-1', activationCode: 'dev-1',
      heartbeatIntervalMs: 50, pongTimeoutMs: 200, reconnectDelayMs: 50,
    });

    await waitFor(() => client!.isConnected());
    await new Promise((r) => setTimeout(r, 600));
    expect(client!.isConnected()).toBe(true);
    expect(cloud.connections).toBe(1);
  });
});
