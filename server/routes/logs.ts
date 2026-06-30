import Router from 'koa-router';

const router = new Router({ prefix: '/api/logs' });

// 环形缓冲区：最多存 500 条日志
const MAX_LOGS = 500;
interface LogEntry {
  id: number;
  time: string;
  message: string;
  timestamp: number;
}

let logs: LogEntry[] = [];
let logIdCounter = 0;

// SSE 连接客户端
interface Client {
  id: number;
  ctx: any;
}
const clients: Map<number, Client> = new Map();
let clientIdCounter = 0;

// 广播给所有 SSE 客户端
function broadcast(entry: LogEntry) {
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  clients.forEach((client, id) => {
    try {
      client.ctx.res.write(data);
    } catch (e) {
      clients.delete(id);
    }
  });
}

// 1. 追加日志（从前端调用）
router.post('/append', async (ctx: any) => {
  const { message, time } = ctx.request.body as any;
  if (!message) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'message required' };
    return;
  }

  const entry: LogEntry = {
    id: ++logIdCounter,
    time: time || new Date().toLocaleTimeString(),
    message,
    timestamp: Date.now(),
  };

  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs = logs.slice(-MAX_LOGS);
  }

  broadcast(entry);

  ctx.body = { success: true };
});

// 2. 获取历史日志（分页）
router.get('/history', async (ctx: any) => {
  const since = Number(ctx.query.since) || 0;
  const limit = Math.min(100, Number(ctx.query.limit) || 100);
  const filtered = logs.filter((l) => l.id > since).slice(-limit);
  ctx.body = {
    logs: filtered,
    hasMore: logs.length > 0 && filtered[0]?.id > logs[0].id,
  };
});

// 3. SSE 实时流
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

  // 心跳：每 30 秒发一条，防止连接断开
  const heartbeat = setInterval(() => {
    try {
      ctx.res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      clients.delete(clientId);
    }
  }, 30000);

  // 客户端断开
  ctx.req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(clientId);
  });

  // 先发一条 ack
  ctx.res.write(`data: ${JSON.stringify({ type: 'connected', clients: clients.size })}\n\n`);

  ctx.respond = false; // 不让 Koa 自动结束响应
});

// 4. 清空日志（调试用）
router.delete('/clear', async (ctx: any) => {
  logs = [];
  ctx.body = { success: true };
});

export default router;
