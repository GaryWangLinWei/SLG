export const DONATE_FALLBACK_CLICKS = 10;

export function parseDonateCount(text: string): number {
  const trimmed = (text || '').trim();
  let numStr: string | undefined;
  const slash = trimmed.indexOf('/');
  if (slash >= 0) {
    numStr = trimmed.slice(0, slash);
  } else {
    const m = trimmed.match(/\d+/);
    numStr = m ? m[0] : undefined;
  }
  if (!numStr) return -1;
  const n = parseInt(numStr.replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return -1;
  return Math.max(0, Math.min(20, n));
}
