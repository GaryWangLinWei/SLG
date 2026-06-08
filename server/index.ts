import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import serve from 'koa-static';
import * as path from 'path';
import * as fs from 'fs';
import { CONFIG } from './config';
import deviceRouter from './routes/device';
import pluginsRouter from './routes/plugins';
import tasksRouter from './routes/tasks';
import configRouter from './routes/config';
import accountsRouter from './routes/accounts';
import licenseRouter from './routes/license';
import { licenseGuard } from './middleware/licenseGuard';
import { migrateLegacyConfig } from './services/ConfigService';
import { pluginService } from './services/PluginService';
import { licenseService } from '../core/license';

const APP_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
})();

const app = new Koa();
const router = new Router();

// Middleware
app.use(cors({ origin: CONFIG.CORS_ORIGIN }));
app.use(bodyParser());
app.use(serve(CONFIG.STATIC_DIR));

// License guard - protect all API routes except public ones
app.use(licenseGuard);

// Basic health check
router.get('/api/health', async (ctx) => {
  ctx.body = {
    status: 'ok',
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    service: 'SLG Automation Framework API'
  };
});

// Root API info
router.get('/api', async (ctx) => {
  ctx.body = {
    version: APP_VERSION,
    endpoints: {
      health: '/api/health',
      device: '/api/device',
      plugins: '/api/plugins',
      tasks: '/api/tasks'
    }
  };
});

app.use(licenseRouter.routes()).use(licenseRouter.allowedMethods());
app.use(deviceRouter.routes()).use(deviceRouter.allowedMethods());
app.use(pluginsRouter.routes()).use(pluginsRouter.allowedMethods());
app.use(tasksRouter.routes()).use(tasksRouter.allowedMethods());
app.use(configRouter.routes()).use(configRouter.allowedMethods());
app.use(accountsRouter.routes()).use(accountsRouter.allowedMethods());
app.use(router.routes()).use(router.allowedMethods());

// 启动前迁移老配置 + 初始化许可证服务
migrateLegacyConfig().catch(e => console.error('迁移失败:', e));
licenseService.init().catch(e => console.error('许可证初始化失败:', e));
pluginService.initYoloDetector().catch(e => console.warn('YOLO 初始化失败:', e.message));

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
