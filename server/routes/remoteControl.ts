import Router from 'koa-router';

const router = new Router({ prefix: '/api/remote-control' });

interface SseClient {
  id: number;
  ctx: any;
}

const clients: Map<number, SseClient> = new Map();
let clientIdCounter = 0;

/** 广播控制事件给所有 SSE 客户端（Electron 前端 Home 页） */
function broadcast(payload: { action: 'start_loop' | 'stop_loop' }) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((client, id) => {
    try {
      client.ctx.res.write(data);
    } catch {
      clients.delete(id);
    }
  });
}

/** 外部（RemoteContextService）调用：触发前端循环开始/停止 */
export function emit(action: 'start_loop' | 'stop_loop'): void {
  broadcast({ action });
}

/** 外部调用：Electron 前端是否至少有一个 SSE 客户端连接 */
export function hasClients(): boolean {
  return clients.size > 0;
}

// SSE 长连接（Electron 前端订阅）
router.get('/stream', async (ctx: any) => {
  ctx.req.setTimeout(0);
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const clientId = ++clientIdCounter;
  clients.set(clientId, { id: clientId, ctx });

  const heartbeat = setInterval(() => {
    try {
      ctx.res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      clients.delete(clientId);
    }
  }, 30000);

  ctx.req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(clientId);
  });

  ctx.res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  ctx.respond = false;
});

// 前端上报当前 loopRunning 状态
router.post('/loop-state', async (ctx: any) => {
  const { running } = ctx.request.body as any;
  if (typeof running !== 'boolean') {
    ctx.status = 400;
    ctx.body = { success: false, error: 'running must be boolean' };
    return;
  }
  // 延迟 require 避免循环依赖（RemoteContextService 导入本文件的 emit/hasClients）
  const { remoteContextService } = require('../services/RemoteContextService');
  remoteContextService.setLoopRunning(running);
  ctx.body = { success: true };
});

// 前端上报"正在启动游戏"状态
router.post('/starting-state', async (ctx: any) => {
  const { starting } = ctx.request.body as any;
  if (typeof starting !== 'boolean') {
    ctx.status = 400;
    ctx.body = { success: false, error: 'starting must be boolean' };
    return;
  }
  const { remoteContextService } = require('../services/RemoteContextService');
  remoteContextService.setStarting(starting);
  ctx.body = { success: true };
});

export default router;
