import { Context, Next } from 'koa';
import { licenseService } from '../../core/license';

const PUBLIC_PATHS = [
  '/api/health',
  '/api/',
  '/api/license',
  '/api/remote/connection-status'
];

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some(publicPath =>
    path === publicPath || path.startsWith(publicPath + '/')
  );
}

export async function licenseGuard(ctx: Context, next: Next): Promise<void> {
  console.log('[LicenseGuard] 检查路径:', ctx.path);

  if (isPublicPath(ctx.path)) {
    console.log('[LicenseGuard] 公开路径，放行');
    await next();
    return;
  }

  const status = await licenseService.getStatus();

  if (!status.activated) {
    ctx.status = 403;
    ctx.body = { success: false, error: 'LICENSE_NOT_ACTIVATED', message: '请先激活软件' };
    return;
  }

  if (status.isExpired) {
    ctx.status = 403;
    ctx.body = { success: false, error: 'LICENSE_EXPIRED', message: '许可证已过期' };
    return;
  }

  if (status.isOffline) {
    ctx.status = 403;
    ctx.body = { success: false, error: 'LICENSE_OFFLINE_GRACE_EXPIRED', message: '离线宽限期已过，请连接网络' };
    return;
  }

  await next();
}
