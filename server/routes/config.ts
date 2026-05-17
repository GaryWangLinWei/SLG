import Router from 'koa-router';
import { configService } from '../services/ConfigService';
import { RokConfig } from '../../plugins/rok';

const router = new Router({ prefix: '/api/config' });

// GET /api/config/rok?accountId=xxx — 返回指定账号的 ROK 配置
router.get('/rok', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }
  const config = await configService.loadConfig(accountId);
  ctx.body = { success: true, config };
});

// PUT /api/config/rok?accountId=xxx — 保存指定账号的 ROK 配置
router.put('/rok', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) {
    ctx.status = 400;
    ctx.body = { success: false, error: 'accountId 必填' };
    return;
  }
  const config = ctx.request.body;
  if (!config || typeof config !== 'object') {
    ctx.status = 400;
    ctx.body = { success: false, error: '请求体必须是 JSON 对象' };
    return;
  }
  await configService.saveConfig(accountId, config as Partial<RokConfig>);
  ctx.body = { success: true };
});

export default router;
