import Router from 'koa-router';
import { licenseService } from '../../core/license';
import { remoteClient } from '../../core/remote/RemoteClient';

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
  // 取消激活同样要停掉远程连接，否则 RemoteClient 会无限重连
  try { remoteClient.stop(); } catch { /* ignore */ }
  await licenseService.deactivate();
  ctx.body = { success: true };
});

router.post('/unbind', async (ctx) => {
  const result = await licenseService.unbind();

  // 成功/幂等成功/401（本地 token 已失效）：停远程、清本地，回激活页
  if (result.success || result.status === 401) {
    try { remoteClient.stop(); } catch { /* ignore */ }
    await licenseService.deactivate();
    ctx.body = { success: true, alreadyUnbound: result.alreadyUnbound, activationCode: result.activationCode };
    return;
  }

  // 其余情况把云端的 status 和 body 原样透传给前端，前端按 code 分支
  ctx.status = result.status || 502;
  ctx.body = {
    success: false,
    code: result.code,
    error: result.error,
    ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}),
  };
});

router.post('/heartbeat', async (ctx) => {
  const result = await licenseService.heartbeat();
  ctx.body = { success: result.success, status: await licenseService.getStatus() };
});

export default router;
