export interface RunningSession {
  running: boolean;
  accountId: string | null;
}

function validateRunningSession(value: unknown): RunningSession {
  if (!value || typeof value !== 'object') throw new Error('Electron 运行会话格式无效');
  const { running, accountId } = value as Partial<RunningSession>;
  if (typeof running !== 'boolean') throw new Error('Electron 运行会话格式无效');
  if (running && (typeof accountId !== 'string' || accountId.trim() === '')) {
    throw new Error('运行账号缺失，无法安全停止任务');
  }
  if (!running && accountId !== null) throw new Error('Electron 运行会话格式无效');
  return { running, accountId: running ? accountId!.trim() : null };
}

export async function persistRunningSession(
  isElectron: boolean,
  setRunningSession: ((value: RunningSession) => Promise<RunningSession>) | undefined,
  value: RunningSession,
): Promise<RunningSession> {
  const requested = validateRunningSession(value);
  if (!isElectron) return requested;
  if (!setRunningSession) throw new Error('Electron 运行会话 API 不可用');
  const persisted = validateRunningSession(await setRunningSession(requested));
  if (persisted.running !== requested.running || persisted.accountId !== requested.accountId) {
    throw new Error('Electron 运行会话写入验证失败');
  }
  return persisted;
}

export async function readRunningSession(
  isElectron: boolean,
  getRunningSession: (() => Promise<RunningSession>) | undefined,
  browserFallback: RunningSession,
): Promise<RunningSession> {
  if (!isElectron) return validateRunningSession(browserFallback);
  if (!getRunningSession) throw new Error('Electron 运行会话 API 不可用');
  return validateRunningSession(await getRunningSession());
}
