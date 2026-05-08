import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import serve from 'koa-static';
import { CONFIG } from './config';

const app = new Koa();
const router = new Router();

// Middleware
app.use(cors({ origin: CONFIG.CORS_ORIGIN }));
app.use(bodyParser());
app.use(serve(CONFIG.STATIC_DIR));

// Basic health check
router.get('/api/health', async (ctx) => {
  ctx.body = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'SLG Automation Framework API'
  };
});

// Root API info
router.get('/api', async (ctx) => {
  ctx.body = {
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      device: '/api/device',
      plugins: '/api/plugins',
      tasks: '/api/tasks'
    }
  };
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`========================================`);
  console.log(`   SLG 自动化框架 Web服务`);
  console.log(`========================================`);
  console.log(`服务运行在: http://${CONFIG.HOST}:${CONFIG.PORT}`);
  console.log(`API地址: http://${CONFIG.HOST}:${CONFIG.PORT}/api`);
  console.log(`健康检查: http://${CONFIG.HOST}:${CONFIG.PORT}/api/health`);
  console.log(`启动时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`========================================`);
});

export default app;
