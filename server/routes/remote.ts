import Router from 'koa-router';
import { licenseService } from '../../core/license';
import { remoteClient } from '../../core/remote/RemoteClient';

const router = new Router({ prefix: '/api/remote' });

const AUTH_URL = process.env.AUTH_SERVER_URL || 'http://106.15.11.158:3456';

/** 获取本机识别码（设备指纹前 9 位大写，格式化成 XXX-XXX-XXX）+ 是否已设置密码 */
router.get('/device-info', async (ctx) => {
  const status = await licenseService.getStatus();
  if (!status.activated || !status.deviceFingerprint) {
    ctx.status = 403;
    ctx.body = { success: false, error: '未激活' };
    return;
  }
  const shortId = status.deviceFingerprint.slice(0, 9).toUpperCase();
  let hasPassword = false;
  try {
    const resp = await fetch(`${AUTH_URL}/api/remote/has-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: status.deviceFingerprint }),
    });
    const data: any = await resp.json();
    hasPassword = !!data?.hasPassword;
  } catch { /* 云端不通就当没设 */ }
  ctx.body = {
    success: true,
    deviceId: status.deviceFingerprint,
    shortId,
    hasPassword,
  };
});

/** 设置/修改访问密码（转发到 VPS） */
router.post('/set-password', async (ctx) => {
  const status = await licenseService.getStatus();
  if (!status.activated || !status.deviceFingerprint) {
    ctx.status = 403;
    ctx.body = { success: false, error: '未激活' };
    return;
  }
  const { password } = (ctx.request.body as any) || {};
  if (!/^\d{6}$/.test(password || '')) {
    ctx.status = 400;
    ctx.body = { success: false, error: '密码必须是 6 位数字' };
    return;
  }
  try {
    const resp = await fetch(`${AUTH_URL}/api/remote/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: status.deviceFingerprint,
        activationCode: status.deviceFingerprint,
        password,
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

/** dev 模式专用：由 Electron 进程通知 server 进程启动 RemoteClient */
router.post('/start-client', async (ctx) => {
  const { wsUrl, deviceId } = (ctx.request.body as any) || {};
  if (!wsUrl || !deviceId) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少 wsUrl 或 deviceId' };
    return;
  }
  if (remoteClient.isConnected()) {
    ctx.body = { success: true, alreadyConnected: true };
    return;
  }
  remoteClient.start({ serverUrl: wsUrl, deviceId, activationCode: deviceId });
  ctx.body = { success: true };
});

export default router;
