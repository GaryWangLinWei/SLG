import Router from 'koa-router';
import { remoteDeviceService } from '../services/RemoteDeviceService';
import { remoteLogService } from '../services/RemoteLogService';
import { webSocketHub } from '../services/WebSocketHub';

const router = new Router({ prefix: '/api/remote' });

// 失败锁：key = ip + shortId，错 5 次锁 5 分钟
const failureCounter = new Map<string, { count: number; lockedUntil: number }>();
const MAX_FAILURES = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;

function lockKey(ip: string, shortId: string): string {
  return `${ip}|${shortId.toUpperCase()}`;
}

function checkFailureLock(key: string): { locked: boolean; remaining?: number } {
  const entry = failureCounter.get(key);
  if (!entry) return { locked: false };
  if (entry.lockedUntil > Date.now()) {
    return { locked: true, remaining: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }
  if (entry.lockedUntil <= Date.now() && entry.count >= MAX_FAILURES) failureCounter.delete(key);
  return { locked: false };
}

function recordFailure(key: string): void {
  const entry = failureCounter.get(key) || { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= MAX_FAILURES) entry.lockedUntil = Date.now() + LOCK_DURATION_MS;
  failureCounter.set(key, entry);
}

/** 电脑端：设置/修改访问密码 */
router.post('/set-password', async (ctx) => {
  const { deviceId, activationCode, password } = ctx.request.body as any;
  if (!deviceId || !activationCode || !password) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少 deviceId / activationCode / password' };
    return;
  }
  const result = remoteDeviceService.setPassword(deviceId, activationCode, password);
  if (!result.success) {
    ctx.status = 400;
    ctx.body = result;
    return;
  }
  ctx.body = result;
});

/** 电脑端：查询密码是否已设置 */
router.post('/has-password', async (ctx) => {
  const { deviceId } = ctx.request.body as any;
  if (!deviceId) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少 deviceId' };
    return;
  }
  ctx.body = { success: true, hasPassword: remoteDeviceService.hasPassword(deviceId) };
});

/** 手机端：识别码 + 密码 → sessionToken */
router.post('/verify-password', async (ctx) => {
  const ip = ctx.request.ip || 'unknown';
  const { shortId, password } = ctx.request.body as any;
  if (!shortId || !password) {
    ctx.status = 400;
    ctx.body = { success: false, error: '缺少 shortId 或 password' };
    return;
  }
  const key = lockKey(ip, shortId);
  const lock = checkFailureLock(key);
  if (lock.locked) {
    ctx.status = 429;
    ctx.body = { success: false, error: `错误次数过多，请 ${lock.remaining} 秒后重试` };
    return;
  }
  const result = remoteDeviceService.verifyPassword(shortId, password);
  if (!result.success) {
    recordFailure(key);
    ctx.status = 401;
    ctx.body = result;
    return;
  }
  failureCounter.delete(key);
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
  const result = remoteDeviceService.verifySession(sessionToken);
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
  const result = remoteDeviceService.verifySession(sessionToken);
  if (!result.valid) {
    ctx.status = 401;
    ctx.body = { success: false, error: '会话无效或已过期' };
    return;
  }
  ctx.body = { success: true, deviceId: result.deviceId, online: webSocketHub.isDeviceOnline(result.deviceId!) };
});

export default router;
