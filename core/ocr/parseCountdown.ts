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
  // Normalize common OCR errors
  let t = text
    .replace(/夭/g, '天')
    .replace(/\./g, ':')
    .replace(/：/g, ':')
    .replace(/O/g, '0')
    .replace(/o/g, '0');

  let days = 0;
  const dayMatch = t.match(/(\d+)\s*天/);
  if (dayMatch) {
    days = parseInt(dayMatch[1], 10);
  }

  // Extract H:MM:SS or M:SS time pattern (万国觉醒只用冒号格式)
  const timeMatch = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!timeMatch) {
    // 只有天数也返回（如"1天"）
    if (days > 0) {
      return days * 86400;
    }
    // 没有冒号时间格式 → 视为空闲
    return null;
  }

  const h = parseInt(timeMatch[1], 10);
  const m = parseInt(timeMatch[2], 10);
  const s = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;

  let seconds = days * 86400;
  if (timeMatch[3] !== undefined) {
    seconds += h * 3600 + m * 60 + s;
  } else {
    seconds += h * 60 + m;
  }

  return seconds;
}
