import Router from 'koa-router';
import { CONFIG } from '../config';
import { generateCodes, getAllCodes, revokeCode, getStats, previewCode, exportCodes } from '../services/ActivationCodeService';
import { getActiveDevices } from '../services/HeartbeatService';

const router = new Router({ prefix: '/api/admin' });

// Admin auth middleware
router.use(async (ctx, next) => {
  const adminKey = ctx.headers['x-admin-key'];
  if (adminKey !== CONFIG.ADMIN_KEY) {
    ctx.status = 403;
    ctx.body = { success: false, error: '未授权' };
    return;
  }
  await next();
});

router.get('/stats', async (ctx) => {
  ctx.body = {
    success: true,
    stats: getStats()
  };
});

router.get('/codes', async (ctx) => {
  const limit = parseInt(ctx.query.limit as string) || 100;
  const offset = parseInt(ctx.query.offset as string) || 0;
  const status = ctx.query.status as string | undefined;

  ctx.body = {
    success: true,
    codes: getAllCodes(limit, offset, status)
  };
});

router.post('/codes/generate', async (ctx) => {
  const { count, durationDays } = ctx.request.body as { count?: number; durationDays?: number };

  if (!count || count < 1 || count > 1000) {
    ctx.status = 400;
    ctx.body = { success: false, error: '数量必须在 1-1000 之间' };
    return;
  }

  const codes = generateCodes(count, durationDays || 30);
  ctx.body = {
    success: true,
    count: codes.length,
    codes
  };
});

// 导出激活码为 TXT，每行一个激活码
router.post('/codes/export', async (ctx) => {
  const { ids } = ctx.request.body as { ids?: number[] };

  const txt = exportCodes(ids);

  ctx.set('Content-Type', 'text/plain; charset=utf-8');
  ctx.set('Content-Disposition', 'attachment; filename="activation-codes.txt"');
  ctx.body = txt;
});

// 预览激活码信息（不消耗，用于续费前确认）
router.post('/codes/preview', async (ctx) => {
  const { code } = ctx.request.body as { code?: string };
  const result = previewCode(code || '');
  ctx.body = result;
});

router.post('/codes/:id/revoke', async (ctx) => {
  const id = parseInt(ctx.params.id);
  if (isNaN(id)) {
    ctx.status = 400;
    ctx.body = { success: false, error: '无效的ID' };
    return;
  }

  const result = revokeCode(id);
  ctx.body = {
    success: result,
    message: result ? '已吊销' : '吊销失败'
  };
});

router.get('/devices', async (ctx) => {
  const limit = parseInt(ctx.query.limit as string) || 50;
  ctx.body = {
    success: true,
    devices: getActiveDevices(limit)
  };
});

export default router;
