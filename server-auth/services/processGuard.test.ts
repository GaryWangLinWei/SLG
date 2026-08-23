import { EventEmitter } from 'node:events';
import { isTransientNetworkError, installProcessGuard } from './processGuard';

function makeError(code?: string, message = 'boom'): Error {
  const e = new Error(message) as Error & { code?: string };
  if (code) e.code = code;
  return e;
}

describe('isTransientNetworkError', () => {
  it.each(['EPIPE', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED'])(
    '%s 属于瞬时网络错误',
    (code) => {
      expect(isTransientNetworkError(makeError(code))).toBe(true);
    },
  );

  it('EADDRINUSE 不算瞬时错误（端口被占必须退出让 PM2 重来）', () => {
    expect(isTransientNetworkError(makeError('EADDRINUSE'))).toBe(false);
  });

  it('普通业务异常不算瞬时错误', () => {
    expect(isTransientNetworkError(makeError(undefined, 'TypeError somewhere'))).toBe(false);
    expect(isTransientNetworkError('not an error')).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
  });
});

describe('installProcessGuard', () => {
  function setup() {
    const proc = new EventEmitter() as EventEmitter & { exit: jest.Mock };
    proc.exit = jest.fn();
    const logged: Array<{ level: string; message: string }> = [];
    const log = (level: string, message: string) => { logged.push({ level, message }); };
    installProcessGuard({ process: proc as any, log, exitDelayMs: 0 });
    return { proc, logged };
  }

  it('瞬时网络错误只记日志，不退出进程', () => {
    const { proc, logged } = setup();

    proc.emit('uncaughtException', makeError('ECONNRESET'));

    expect(proc.exit).not.toHaveBeenCalled();
    expect(logged).toHaveLength(1);
    expect(logged[0].level).toBe('warn');
    expect(logged[0].message).toContain('ECONNRESET');
  });

  it('非瞬时异常记录后退出码 1，交给 PM2 重启', () => {
    const { proc, logged } = setup();

    proc.emit('uncaughtException', makeError('EADDRINUSE'));

    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(logged[0].level).toBe('error');
  });

  it('未处理的 Promise rejection 同样按瞬时与否分流', () => {
    const { proc, logged } = setup();

    proc.emit('unhandledRejection', makeError('EPIPE'));
    expect(proc.exit).not.toHaveBeenCalled();

    proc.emit('unhandledRejection', makeError(undefined, 'business bug'));
    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(logged.map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('多个瞬时错误连续到达也不会退出', () => {
    const { proc } = setup();
    for (let i = 0; i < 50; i++) proc.emit('uncaughtException', makeError('EPIPE'));
    expect(proc.exit).not.toHaveBeenCalled();
  });
});
