import Router from 'koa-router';
import { remoteCodeService } from '../services/RemoteCodeService';
import { remoteLogService } from '../services/RemoteLogService';
import { webSocketHub } from '../services/WebSocketHub';

const router = new Router({ prefix: '/api/remote' });

const failureCounter = new Map<string, { count: number; lockedUntil: number }>();

function checkFailureLock(ip: string): { locked: boolean; remaining?: number } {
  const entry = failureCounter.get(ip);
  if (!entry) return { locked: false };
  if (entry.lockedUntil > Date.now()) {
    return { locked: true, remaining: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }
  if (entry.lockedUntil <= Date.now() && entry.count >= 3) failureCounter.delete(ip);
  return { locked: false };
}

function recordFailure(ip: string): void {
  const entry = failureCounter.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= 3) entry.lockedUntil = Date.now() + 60 * 1000;
  failureCounter.set(ip, entry);
}

router.post('/generate-code', async (ctx) => {
  const { deviceId, activationCode } = ctx.request.body as any;
  if (!deviceId || !activationCode) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少 deviceId 或 activationCode' };
    return;
  }
  const result = remoteCodeService.generateCode(deviceId, activationCode);
  ctx.body = { success: true, code: result.code, expiresAt: result.expiresAt };
});

router.post('/verify-code', async (ctx) => {
  const ip = ctx.request.ip || 'unknown';
  const lock = checkFailureLock(ip);
  if (lock.locked) {
    ctx.status = 429;
    ctx.body = { success: false, error: `错误次数过多，请 ${lock.remaining} 秒后重试` };
    return;
  }
  const { code } = ctx.request.body as any;
  if (!code) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少 code' };
    return;
  }
  const result = remoteCodeService.verifyCode(code);
  if (!result.success) {
    recordFailure(ip);
    ctx.status = 401;
    ctx.body = result;
    return;
  }
  failureCounter.delete(ip);
  ctx.body = {
    success: true,
    sessionToken: result.sessionToken,
    deviceId: result.deviceId,
    expiresAt: result.expiresAt,
    deviceOnline: webSocketHub.isDeviceOnline(result.deviceId!),
  };
});

router.get('/logs', async (ctx) => {
  const sessionToken = ctx.headers['x-session-token'] as string;
  const limit = parseInt(ctx.query.limit as string) || 200;
  if (!sessionToken) {
    ctx.status = 401;
    ctx.body = { success: false, error: '缺少 sessionToken' };
    return;
  }
  const result = remoteCodeService.verifySession(sessionToken);
  if (!result.valid) {
    ctx.status = 401;
    ctx.body = { success: false, error: '会话无效或已过期' };
    return;
  }
  const logs = remoteLogService.getLogs(result.deviceId!, limit);
  ctx.body = { success: true, logs, deviceOnline: webSocketHub.isDeviceOnline(result.deviceId!) };
});

router.get('/status', async (ctx) => {
  const sessionToken = ctx.headers['x-session-token'] as string;
  if (!sessionToken) {
    ctx.status = 401;
    ctx.body = { success: false, error: '缺少 sessionToken' };
    return;
  }
  const result = remoteCodeService.verifySession(sessionToken);
  if (!result.valid) {
    ctx.status = 401;
    ctx.body = { success: false, error: '会话无效或已过期' };
    return;
  }
  ctx.body = { success: true, deviceId: result.deviceId, online: webSocketHub.isDeviceOnline(result.deviceId!) };
});

export default router;
