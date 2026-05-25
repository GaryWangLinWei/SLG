import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import serve from 'koa-static';
import path from 'path';
import { CONFIG } from './config';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import { getDb } from './services/AuthDatabase';

const app = new Koa();
const router = new Router();

// Middleware
app.use(cors({ origin: CONFIG.CORS_ORIGIN }));
app.use(bodyParser());

// Static files for admin panel
const adminPath = path.join(__dirname, 'admin');
app.use(serve(adminPath));

// 托管更新包（electron-updater generic provider）
app.use(serve(path.join(__dirname, 'updates')));

// Routes
app.use(authRouter.routes()).use(authRouter.allowedMethods());
app.use(adminRouter.routes()).use(adminRouter.allowedMethods());

// Health check
router.get('/health', async (ctx) => {
  ctx.body = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'SLG Auth Server'
  };
});

app.use(router.routes()).use(router.allowedMethods());

// Initialize database
getDb();

app.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`========================================`);
  console.log(`   SLG 授权服务`);
  console.log(`========================================`);
  console.log(`服务运行在: http://${CONFIG.HOST}:${CONFIG.PORT}`);
  console.log(`API文档: http://${CONFIG.HOST}:${CONFIG.PORT}/api/auth`);
  console.log(`管理面板: http://${CONFIG.HOST}:${CONFIG.PORT}/`);
  console.log(`启动时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`========================================`);
});

export default app;
