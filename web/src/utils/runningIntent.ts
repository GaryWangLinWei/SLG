export async function persistRunningIntent(
  isElectron: boolean,
  setRunningIntent: ((value: boolean) => Promise<boolean>) | undefined,
  value: boolean,
): Promise<boolean> {
  if (!isElectron) return value;
  if (!setRunningIntent) throw new Error('Electron 运行状态 API 不可用');
  const persisted = await setRunningIntent(value);
  if (typeof persisted !== 'boolean' || persisted !== value) {
    throw new Error('Electron 运行状态写入验证失败');
  }
  return persisted;
}

export async function readRunningIntent(
  isElectron: boolean,
  getRunningIntent: (() => Promise<boolean>) | undefined,
  browserFallback: boolean,
): Promise<boolean> {
  if (!isElectron) return browserFallback;
  if (!getRunningIntent) throw new Error('Electron 运行状态 API 不可用');
  return getRunningIntent();
}
