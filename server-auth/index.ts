import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import serve from 'koa-static';
import mount from 'koa-mount';
import path from 'path';
import { CONFIG } from './config';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import { getDb } from './services/AuthDatabase';
import fs from 'fs';
import { createServer } from 'http';
import remoteRouter from './routes/remote';
import { webSocketHub } from './services/WebSocketHub';
import { installProcessGuard, isTransientNetworkError } from './services/processGuard';

// 尽早安装：瞬时网络错误（EPIPE/ECONNRESET 等）不再打死进程
installProcessGuard();

const APP_VERSION: string = (() => {
  try {
    const pkgPath = fs.existsSync(path.join(__dirname, 'package.json'))
      ? path.join(__dirname, 'package.json')
      : path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
})();

const app = new Koa();
const router = new Router();

// Koa 默认会把请求期异常打到 stderr；客户端提前断开属于噪音，降级为 warn
app.on('error', (err) => {
  if (isTransientNetworkError(err)) {
    console.warn('[koa] 客户端断开:', err.code);
    return;
  }
  console.error('[koa] 请求处理异常:', err);
});

// Middleware
app.use(cors({ origin: CONFIG.CORS_ORIGIN }));
app.use(bodyParser());

// 静态文件根目录：Docker 中编译后 __dirname 为 dist/，通过环境变量指定项目根
const staticRoot = process.env.STATIC_ROOT || __dirname;

// Static files for admin panel
app.use(serve(path.join(staticRoot, 'admin')));

// 托管更新包（electron-updater generic provider），挂载在 /updates 路径下
app.use(mount('/updates', serve(path.join(staticRoot, 'updates'))));

// 托管帮助/教学页面
app.use(mount('/help', serve(path.join(staticRoot, 'help'))));

// 托管手机端前端（远程控制 SPA）
app.use(mount('/mobile', serve(path.join(staticRoot, 'mobile'))));

// Routes
app.use(authRouter.routes()).use(authRouter.allowedMethods());
app.use(adminRouter.routes()).use(adminRouter.allowedMethods());
app.use(remoteRouter.routes()).use(remoteRouter.allowedMethods());

// Health check
router.get('/health', async (ctx) => {
  ctx.body = {
    status: 'ok',
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    service: 'SLG Auth Server'
  };
});

app.use(router.routes()).use(router.allowedMethods());

// Initialize database
getDb();
const httpServer = createServer(app.callback());
webSocketHub.attach(httpServer);

// 客户端半路断开时底层 socket 会抛 ECONNRESET/EPIPE；没有监听器就会冒泡成未捕获异常
httpServer.on('error', (err) => {
  if (isTransientNetworkError(err)) {
    console.warn('[httpServer] 忽略瞬时网络错误:', (err as any).code);
    return;
  }
  console.error('[httpServer] 致命错误，进程退出:', err);
  process.exit(1);
});
httpServer.on('clientError', (err, socket) => {
  // 畸形请求/提前断开：回一个 400 并关掉，不要影响其他连接
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  else socket.destroy();
});

httpServer.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`========================================`);
  console.log(`   SLG 授权服务`);
  console.log(`========================================`);
  console.log(`服务运行在: http://${CONFIG.HOST}:${CONFIG.PORT}`);
  console.log(`WebSocket: ws://${CONFIG.HOST}:${CONFIG.PORT}/ws/remote`);
  console.log(`API文档: http://${CONFIG.HOST}:${CONFIG.PORT}/api/auth`);
  console.log(`管理面板: http://${CONFIG.HOST}:${CONFIG.PORT}/`);
  console.log(`启动时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`========================================`);
});

export default app;
