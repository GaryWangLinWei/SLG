import Router from 'koa-router';
import { CONFIG } from '../config';
import { generateCodes, getAllCodes, revokeCode, getStats, previewCode, exportCodes, getCodesCount } from '../services/ActivationCodeService';
import { getActiveDevices, deleteDevice } from '../services/HeartbeatService';

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
  const limit = parseInt(ctx.query.limit as string) || 10;
  const offset = parseInt(ctx.query.offset as string) || 0;
  const status = ctx.query.status as string | undefined;

  ctx.body = {
    success: true,
    codes: getAllCodes(limit, offset, status),
    total: getCodesCount(status)
  };
});

router.post('/codes/generate', async (ctx) => {
  const { count, durationDays, tier } = ctx.request.body as { count?: number; durationDays?: number; tier?: 'basic' | 'pro' };

  if (!count || count < 1 || count > 1000) {
    ctx.status = 400;
    ctx.body = { success: false, error: '数量必须在 1-1000 之间' };
    return;
  }

  const codes = generateCodes(count, durationDays || 30, tier || 'basic');
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

// 修改激活码的 tier 或 expires_at
// body: { tier?: 'basic'|'pro', setDays?: number, setExpiresAt?: number }
//   setDays: 从现在起 N 天后到期（覆盖式，不累加）
//   setExpiresAt: 直接设到具体毫秒时间戳（优先级高于 setDays）
router.patch('/codes/:id', async (ctx) => {
  const id = parseInt(ctx.params.id);
  if (isNaN(id)) {
    ctx.status = 400;
    ctx.body = { success: false, error: '无效的ID' };
    return;
  }

  const { tier, setDays, setExpiresAt } = ctx.request.body as {
    tier?: 'basic' | 'pro';
    setDays?: number;
    setExpiresAt?: number;
  };

  if (tier && tier !== 'basic' && tier !== 'pro') {
    ctx.status = 400;
    ctx.body = { success: false, error: 'tier 只能是 basic 或 pro' };
    return;
  }

  const { getDb } = await import('../services/AuthDatabase');
  const db = getDb();

  const code = db.prepare('SELECT id, tier, expires_at FROM activation_codes WHERE id = ?').get(id) as
    | { id: number; tier?: string; expires_at?: number }
    | undefined;
  if (!code) {
    ctx.status = 404;
    ctx.body = { success: false, error: '激活码不存在' };
    return;
  }

  const updates: string[] = [];
  const values: any[] = [];
  if (tier) {
    updates.push('tier = ?');
    values.push(tier);
  }
  if (typeof setExpiresAt === 'number' && setExpiresAt > 0) {
    updates.push('expires_at = ?');
    values.push(setExpiresAt);
  } else if (typeof setDays === 'number' && setDays > 0) {
    const newExpiresAt = Date.now() + setDays * 86400000;
    updates.push('expires_at = ?');
    values.push(newExpiresAt);
  }

  if (updates.length === 0) {
    ctx.status = 400;
    ctx.body = { success: false, error: '无修改字段' };
    return;
  }

  values.push(id);
  db.prepare(`UPDATE activation_codes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT id, code, tier, expires_at FROM activation_codes WHERE id = ?').get(id);
  ctx.body = { success: true, code: updated };
});

router.get('/devices', async (ctx) => {
  const limit = parseInt(ctx.query.limit as string) || 10;
  const offset = parseInt(ctx.query.offset as string) || 0;
  const search = ctx.query.search as string | undefined;
  const { devices, total } = getActiveDevices(limit, offset, search);
  ctx.body = {
    success: true,
    devices,
    total
  };
});

router.delete('/devices/:fingerprint', async (ctx) => {
  const count = deleteDevice(ctx.params.fingerprint);
  ctx.body = {
    success: count > 0,
    message: count > 0 ? `已删除 ${count} 条绑定记录` : '设备不存在'
  };
});

export default router;
