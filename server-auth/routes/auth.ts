import Router from 'koa-router';
import { useCode } from '../services/ActivationCodeService';
import { verifyAndHeartbeat, generateToken } from '../services/HeartbeatService';

const router = new Router({ prefix: '/api/auth' });

router.post('/activate', async (ctx) => {
  const { code, fingerprint } = ctx.request.body as { code?: string; fingerprint?: string };

  if (!code || !fingerprint) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少参数' };
    return;
  }

  const result = useCode(code, fingerprint);
  if (!result.success) {
    ctx.status = 400;
    ctx.body = result;
    return;
  }

  // Get code ID from database
  const db = (await import('../services/AuthDatabase')).getDb();
  const codeRow = db.prepare('SELECT id FROM activation_codes WHERE code = ?').get(code) as any;

  // Generate JWT
  const token = generateToken(codeRow.id);

  ctx.body = {
    success: true,
    token,
    expiresAt: result.expiresAt
  };
});

// 预览激活码（不消耗，续费前确认用）
router.post('/preview', async (ctx) => {
  const { code } = ctx.request.body as { code?: string };
  const { previewCode } = await import('../services/ActivationCodeService');
  const result = previewCode(code || '');
  ctx.body = result;
});

router.post('/heartbeat', async (ctx) => {
  const authHeader = ctx.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ctx.status = 401;
    ctx.body = { success: false, error: '未授权' };
    return;
  }

  const token = authHeader.substring(7);
  const { fingerprint } = ctx.request.body as { fingerprint?: string };

  if (!fingerprint) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少设备指纹' };
    return;
  }

  const ip = ctx.ip || ctx.request.ip || 'unknown';
  const result = verifyAndHeartbeat(token, fingerprint, ip);

  if (!result.success) {
    ctx.status = 401;
  }

  ctx.body = result;
});

export default router;
