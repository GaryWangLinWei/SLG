import Router from 'koa-router';
import { accountService } from '../services/AccountService';
import { deviceService } from '../services/DeviceService';
import { pluginService } from '../services/PluginService';

const router = new Router({ prefix: '/api/accounts' });

router.get('/', async (ctx) => {
  const accounts = await accountService.listAccounts();
  ctx.body = { success: true, accounts };
});

router.get('/:id', async (ctx) => {
  const account = await accountService.getAccount(ctx.params.id);
  if (!account) {
    ctx.status = 404;
    ctx.body = { success: false, error: '账号不存在' };
    return;
  }
  ctx.body = { success: true, account };
});

router.post('/', async (ctx) => {
  const body = ctx.request.body as { name?: string; deviceId?: string };

  // 一台电脑只能有1个账号
  const existing = await accountService.listAccounts();
  if (existing.length >= 1) {
    ctx.status = 400;
    ctx.body = { success: false, error: '每台电脑只能创建1个账号' };
    return;
  }

  try {
    const account = await accountService.createAccount({
      name: body.name || '',
      deviceId: body.deviceId || ''
    });
    ctx.body = { success: true, account };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { success: false, error: String(e) };
  }
});

router.put('/:id', async (ctx) => {
  const body = ctx.request.body as { name?: string; deviceId?: string };
  try {
    const account = await accountService.updateAccount(ctx.params.id, body);
    if (body.deviceId !== undefined) {
      deviceService.removeAccount(ctx.params.id);
      pluginService.removeAccount(ctx.params.id);
    }
    ctx.body = { success: true, account };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { success: false, error: String(e) };
  }
});

router.delete('/:id', async (ctx) => {
  try {
    await accountService.deleteAccount(ctx.params.id);
    deviceService.removeAccount(ctx.params.id);
    pluginService.removeAccount(ctx.params.id);
    ctx.body = { success: true };
  } catch (e) {
    ctx.status = 400;
    ctx.body = { success: false, error: String(e) };
  }
});

export default router;
