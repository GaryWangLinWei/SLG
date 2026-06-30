import Router from 'koa-router';
import { licenseService } from '../../core/license';

const router = new Router({ prefix: '/api/remote' });

const AUTH_URL = process.env.AUTH_SERVER_URL || 'http://106.15.11.158:3456';

/** 生成验证码（转发到 VPS） */
router.post('/generate-code', async (ctx) => {
  const status = await licenseService.getStatus();
  if (!status.activated || !status.deviceFingerprint) {
    ctx.status = 403;
    ctx.body = { success: false, error: '未激活' };
    return;
  }
  try {
    const resp = await fetch(`${AUTH_URL}/api/remote/generate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: status.deviceFingerprint,
        activationCode: status.deviceFingerprint,
      }),
    });
    const data = await resp.json();
    ctx.body = data;
  } catch (e: any) {
    ctx.status = 500;
    ctx.body = { success: false, error: '连接云端失败: ' + (e.message || e) };
  }
});

/** 查询远程客户端连接状态 */
router.get('/connection-status', async (ctx) => {
  const { remoteClient } = require('../../core/remote/RemoteClient');
  ctx.body = { connected: remoteClient.isConnected() };
});

export default router;
