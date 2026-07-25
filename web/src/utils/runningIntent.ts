export async function readRunningIntent(
  isElectron: boolean,
  getRunningIntent: (() => Promise<boolean>) | undefined,
  browserFallback: boolean,
): Promise<boolean> {
  if (!isElectron) return browserFallback;
  if (!getRunningIntent) throw new Error('Electron 运行状态 API 不可用');
  return getRunningIntent();
}
