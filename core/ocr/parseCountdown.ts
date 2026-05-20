/**
 * 解析倒计时文本为剩余秒数。
 * 支持格式:
 *   "1天10:09:20" → 122960
 *   "2:30:00"      → 9000
 *   "45:30"        → 2730
 *   "15"           → 15
 *
 * OCR 容错:
 *   - "1夭" → "1天"
 *   - 冒号可能被识别为 "." 或 "："
 *   - 尾部杂讯过滤
 *
 * 返回 null 表示无法解析（空闲、非倒计时文本等）。
 */
export function parseCountdown(text: string): number | null {
  // Normalize: fix common OCR errors
  let t = text
    .replace(/夭/g, '天')
    .replace(/\./g, ':')
    .replace(/：/g, ':')
    .replace(/[^0-9天:：. ]/g, '')
    .trim();

  if (!t) return null;

  let days = 0;

  // Extract days if present
  const dayMatch = t.match(/(\d+)\s*天/);
  if (dayMatch) {
    days = parseInt(dayMatch[1], 10);
    t = t.replace(dayMatch[0], '').trim();
  }

  // Parse remaining H:MM:SS or M:SS or SS
  const parts = t.split(':').map(s => parseInt(s, 10)).filter(n => !isNaN(n));

  if (parts.length === 0) return null;

  let seconds = days * 86400;

  if (parts.length === 3) {
    seconds += parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds += parts[0] * 60 + parts[1];
  } else {
    seconds += parts[0];
  }

  return seconds;
}
