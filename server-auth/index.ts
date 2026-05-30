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

// Routes
app.use(authRouter.routes()).use(authRouter.allowedMethods());
app.use(adminRouter.routes()).use(adminRouter.allowedMethods());

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
