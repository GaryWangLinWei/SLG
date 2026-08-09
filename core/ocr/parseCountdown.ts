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
 *   - "剩余时间：1天01:30:14" 中的"1天"可能被误识成"2:"等，导致前缀数字
 *     与时间粘连（如 "2:101:30:14"）。此时取末尾完整的 H:MM:SS，
 *     其前面残留的单个数字按天数处理。
 *   - 尾部杂讯过滤
 *
 * 返回 null 表示无法解析（空闲、非倒计时文本等）。
 */
export function parseCountdown(text: string): number | null {
  // Normalize common OCR errors
  let t = text
    .replace(/夭/g, '天')
    .replace(/：/g, ':')
    .replace(/O/g, '0')
    .replace(/o/g, '0');

  // 先把点号转成冒号，但不要动小数点之类（倒计时里没有小数）；
  // 仅把独立的 "." 视作冒号
  t = t.replace(/\./g, ':');

  let days = 0;
  const dayMatch = t.match(/(\d+)\s*天/);
  if (dayMatch) {
    days = parseInt(dayMatch[1], 10);
  }

  // 提取最后一个 H:MM:SS（带秒）或 M:SS。
  // 用最后一个匹配，避免前面粘连的杂讯数字污染。
  const hmsMatches = [...t.matchAll(/(\d{1,3}):(\d{1,2}):(\d{1,2})/g)];
  if (hmsMatches.length > 0) {
    const m = hmsMatches[hmsMatches.length - 1];
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = parseInt(m[3], 10);
    // 小时字段 >23 通常是"1天01"被粘连成"101"等 OCR 杂讯，取末两位作为小时
    if (h > 23) h = h % 100;
    // 合法性：时 <24、分秒 < 60
    if (h > 23 || mm >= 60 || ss >= 60) return null;
    return days * 86400 + h * 3600 + mm * 60 + ss;
  }

  // 没有 H:MM:SS，尝试 M:SS（分:秒）
  const msMatches = [...t.matchAll(/(\d{1,3}):(\d{1,2})/g)];
  if (msMatches.length > 0) {
    const m = msMatches[msMatches.length - 1];
    const mm = parseInt(m[1], 10);
    const ss = parseInt(m[2], 10);
    if (ss >= 60) return null;
    return days * 86400 + mm * 60 + ss;
  }

  // 只有天数也返回（如"1天"）
  if (days > 0) {
    return days * 86400;
  }

  // 纯数字（如 "15" 秒）
  const onlyNum = t.match(/^\s*(\d{1,3})\s*$/);
  if (onlyNum) {
    return parseInt(onlyNum[1], 10);
  }

  // 没有冒号时间格式 → 视为空闲
  return null;
}
