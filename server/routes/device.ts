import Router from 'koa-router';
import { promisify } from 'util';
import { exec } from 'child_process';
import { getAdbPath } from '../../core/device/AdbDevice';
import { deviceService } from '../services/DeviceService';

const ADB_PATH = getAdbPath();

const execAsync = promisify(exec);
const router = new Router({ prefix: '/api/device' });

// 扫描所有可用 ADB 设备
router.get('/scan', async (ctx) => {
  try {
    // MuMu 多开步进: 7555, 7565, 7575... (每多开一个实例 +10)
    const ports: number[] = [];
    for (let p = 7555; p <= 7655; p += 10) ports.push(p);

    const batch = 10;
    for (let i = 0; i < ports.length; i += batch) {
      await Promise.all(ports.slice(i, i + batch).map(port =>
        execAsync(`"${ADB_PATH}" connect 127.0.0.1:${port}`, { timeout: 3000 }).catch(() => {})
      ));
    }

    const { stdout } = await execAsync(`"${ADB_PATH}" devices`);
    const devices = stdout
      .split('\n')
      .slice(1)
      .map(line => line.trim())
      .filter(line => line && line.includes('\t'))
      .map(line => {
        const [deviceId, status] = line.split('\t').map(s => s.trim());
        return { deviceId, status };
      })
      .filter(d => d.status === 'device');
    ctx.body = { success: true, devices };
  } catch (e: any) {
    console.error('设备扫描失败:', e?.message || e);
    ctx.status = 500;
    ctx.body = { success: false, error: String(e), devices: [] };
  }
});

// 以下端点需 accountId（query 参数）
router.get('/status', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) { ctx.status = 400; ctx.body = { error: 'accountId required' }; return; }
  ctx.body = deviceService.getStatus(accountId);
});

router.post('/connect', async (ctx) => {
  const accountId = (ctx.request.body as any)?.accountId || ctx.query.accountId as string;
  if (!accountId) { ctx.status = 400; ctx.body = { error: 'accountId required' }; return; }
  ctx.body = await deviceService.connect(accountId);
});

router.post('/disconnect', async (ctx) => {
  const accountId = (ctx.request.body as any)?.accountId || ctx.query.accountId as string;
  if (!accountId) { ctx.status = 400; ctx.body = { error: 'accountId required' }; return; }
  ctx.body = await deviceService.disconnect(accountId);
});

router.get('/screenshot', async (ctx) => {
  const accountId = ctx.query.accountId as string;
  if (!accountId) { ctx.status = 400; ctx.body = { error: 'accountId required' }; return; }
  ctx.body = await deviceService.screenshot(accountId);
});

router.post('/tap', async (ctx) => {
  const body = ctx.request.body as { accountId?: string; x: number; y: number };
  const accountId = body.accountId || ctx.query.accountId as string;
  if (!accountId) { ctx.status = 400; ctx.body = { error: 'accountId required' }; return; }
  if (body.x === undefined || body.y === undefined) {
    ctx.status = 400; ctx.body = { error: 'x and y required' }; return;
  }
  ctx.body = await deviceService.tap(accountId, body.x, body.y);
});

router.post('/swipe', async (ctx) => {
  const body = ctx.request.body as any;
  const accountId = body.accountId || ctx.query.accountId as string;
  if (!accountId) { ctx.status = 400; ctx.body = { error: 'accountId required' }; return; }
  const { x1, y1, x2, y2, duration = 500 } = body;
  if ([x1, y1, x2, y2].some(v => v === undefined)) {
    ctx.status = 400; ctx.body = { error: 'x1, y1, x2, y2 required' }; return;
  }
  ctx.body = await deviceService.swipe(accountId, x1, y1, x2, y2, duration);
});

export default router;
