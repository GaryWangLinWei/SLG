import Router from 'koa-router';
import { pluginService } from '../services/PluginService';

const router = new Router({ prefix: '/api/plugins' });

router.get('/', async (ctx) => {
  try {
    ctx.body = {
      success: true,
      plugins: pluginService.listPlugins()
    };
  } catch (error) {
    ctx.status = 500;
    ctx.body = { success: false, error: String(error) };
  }
});

router.get('/:id/config', async (ctx) => {
  try {
    const { id } = ctx.params;
    const accountId = ctx.query.accountId as string;
    if (!accountId) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'accountId 必填' };
      return;
    }
    ctx.body = {
      success: true,
      config: pluginService.getPluginConfigSchema(id),
      defaultConfig: await pluginService.getPluginDefaultConfig(accountId, id)
    };
  } catch (error) {
    ctx.status = 404;
    ctx.body = { success: false, error: String(error) };
  }
});

export default router;
