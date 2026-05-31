import Router from 'koa-router';
import { useCode, processInviteCode } from '../services/ActivationCodeService';
import { verifyAndHeartbeat, generateToken } from '../services/HeartbeatService';

const router = new Router({ prefix: '/api/auth' });

router.post('/activate', async (ctx) => {
  const { code, fingerprint, inviteCode } = ctx.request.body as { code?: string; fingerprint?: string; inviteCode?: string };

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

  // 处理邀请码（主激活成功后）
  let inviteError: string | undefined;
  let inviteBonus: boolean | undefined;
  let inviterBonusDays: number | undefined;
  let inviteeBonusDays: number | undefined;

  if (inviteCode) {
    const inviteResult = processInviteCode(inviteCode, fingerprint);
    if (inviteResult.success) {
      inviteBonus = true;
      inviterBonusDays = inviteResult.inviterBonusDays;
      inviteeBonusDays = inviteResult.inviteeBonusDays;
    } else {
      inviteError = inviteResult.error;
    }
  }

  ctx.body = {
    success: true,
    token,
    expiresAt: result.expiresAt,
    ...(inviteBonus ? { inviteBonus, inviterBonusDays, inviteeBonusDays } : {}),
    ...(inviteError ? { inviteError } : {})
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

router.get('/my-invite-code', async (ctx) => {
  const fingerprint = ctx.query.fingerprint as string;
  if (!fingerprint) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少设备指纹' };
    return;
  }
  const db = (await import('../services/AuthDatabase')).getDb();
  let row = db.prepare(
    "SELECT code FROM activation_codes WHERE type = 'invite' AND created_by = ?"
  ).get(fingerprint) as { code: string } | undefined;

  // 老用户补救：设备已激活但尚无邀请码，自动生成
  if (!row) {
    const binding = db.prepare(
      'SELECT * FROM device_bindings WHERE device_fingerprint = ? LIMIT 1'
    ).get(fingerprint) as any;
    if (binding) {
      const { generateInviteCode } = await import('../services/ActivationCodeService');
      const code = generateInviteCode();
      db.prepare(
        "INSERT INTO activation_codes (code, duration_days, status, type, created_at, created_by) VALUES (?, 3, 'unused', 'invite', ?, ?)"
      ).run(code, Date.now(), fingerprint);
      row = { code };
    }
  }

  ctx.body = { success: true, code: row?.code || null };
});

export default router;
