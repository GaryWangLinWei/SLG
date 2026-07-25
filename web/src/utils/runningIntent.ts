export async function readRunningIntent(
  getRunningIntent: (() => Promise<boolean>) | undefined,
  browserFallback: boolean,
): Promise<boolean> {
  return getRunningIntent ? getRunningIntent() : browserFallback;
}
