import Router from 'koa-router';
import { licenseService } from '../../core/license';

const router = new Router({ prefix: '/api/license' });

router.get('/status', async (ctx) => {
  const status = await licenseService.getStatus();
  ctx.body = { success: true, status };
});

router.post('/activate', async (ctx) => {
  const body = ctx.request.body as { code?: string; inviteCode?: string };
  if (!body.code) {
    ctx.status = 400;
    ctx.body = { success: false, error: '激活码不能为空' };
    return;
  }

  const result = await licenseService.activate(body.code, body.inviteCode);
  if (result.success) {
    ctx.body = result;
  } else {
    ctx.status = 400;
    ctx.body = result;
  }
});

router.post('/preview', async (ctx) => {
  const body = ctx.request.body as { code?: string };
  if (!body.code) {
    ctx.status = 400;
    ctx.body = { success: false, error: '激活码不能为空' };
    return;
  }
  const result = await licenseService.preview(body.code);
  ctx.body = result;
});

router.post('/deactivate', async (ctx) => {
  await licenseService.deactivate();
  ctx.body = { success: true };
});

router.post('/heartbeat', async (ctx) => {
  const result = await licenseService.heartbeat();
  ctx.body = { success: result.success, status: await licenseService.getStatus() };
});

export default router;
