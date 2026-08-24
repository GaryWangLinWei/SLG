/**
 * 进程级兜底：把瞬时网络错误和真正的致命错误分开处理。
 *
 * 背景：客户端网络突然中断（手机切网、电脑休眠）时，向已断开的 socket 写入会抛
 * EPIPE / ECONNRESET。这类错误没人接就会杀掉整个进程，踢掉所有在线设备的 WS 连接，
 * PM2 重启时旧端口未释放还会再报 EADDRINUSE 触发重启风暴（线上已累计 122 次重启）。
 *
 * 策略：瞬时网络错误只记日志、进程继续跑；其他异常记录后以退出码 1 退出，交给 PM2 重启。
 */

/** 可安全忽略的瞬时网络错误码：都表示“对端没了”，与服务端自身状态无关 */
export const TRANSIENT_NETWORK_CODES: readonly string[] = [
  'EPIPE',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNABORTED',
];

export function isTransientNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && TRANSIENT_NETWORK_CODES.includes(code);
}

type LogFn = (level: 'warn' | 'error', message: string) => void;

export interface ProcessGuardDeps {
  process?: NodeJS.EventEmitter & { exit(code?: number): void };
  log?: LogFn;
  /** 退出前留给日志刷盘的时间；0 表示同步退出（测试用） */
  exitDelayMs?: number;
}

const defaultLog: LogFn = (level, message) => {
  if (level === 'warn') console.warn(message);
  else console.error(message);
};

function describe(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code;
    return `${err.name}${code ? `(${code})` : ''}: ${err.message}\n${err.stack ?? ''}`;
  }
  return String(err);
}

export function installProcessGuard(deps: ProcessGuardDeps = {}): void {
  const proc = deps.process ?? process;
  const log = deps.log ?? defaultLog;
  const exitDelayMs = deps.exitDelayMs ?? 100;

  const handle = (source: string) => (err: unknown) => {
    if (isTransientNetworkError(err)) {
      log('warn', `[${source}] 忽略瞬时网络错误 ${describe(err)}`);
      return;
    }
    log('error', `[${source}] 致命错误，进程退出 ${describe(err)}`);
    if (exitDelayMs > 0) setTimeout(() => proc.exit(1), exitDelayMs).unref?.();
    else proc.exit(1);
  };

  proc.on('uncaughtException', handle('uncaughtException'));
  proc.on('unhandledRejection', handle('unhandledRejection'));
}
