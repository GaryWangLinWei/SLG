import { parseCountdown } from './parseCountdown';

describe('parseCountdown', () => {
  it('parses days + HH:MM:SS (e.g. 1天01:49:12)', () => {
    expect(parseCountdown('1天01:49:12')).toBe(86400 + 1 * 3600 + 49 * 60 + 12);
    expect(parseCountdown('1天10:09:20')).toBe(122960);
    expect(parseCountdown('2天00:00:00')).toBe(172800);
  });

  it('parses HH:MM:SS without days (e.g. 00:59:26)', () => {
    expect(parseCountdown('00:59:26')).toBe(59 * 60 + 26);
    expect(parseCountdown('01:00:00')).toBe(3600);
    expect(parseCountdown('00:05:30')).toBe(330);
  });

  it('rejects MM:SS — game never uses this format', () => {
    // 游戏倒计时恒为 HH:MM:SS 或 N天HH:MM:SS，不存在 M:SS。
    expect(parseCountdown('45:30')).toBeNull();
    expect(parseCountdown('05:00')).toBeNull();
    expect(parseCountdown('00:00')).toBeNull();
  });

  it('rejects bare numbers (idle/Chinese misread as digits)', () => {
    // "空闲中"被 OCR 误识成 "40"，不能当成 40 秒
    expect(parseCountdown('40')).toBeNull();
    expect(parseCountdown('15')).toBeNull();
  });

  it('rejects single-digit seconds ("已完成" misread as "h 54:4")', () => {
    // "已完成"被 OCR 误识成 "h 54:4"，不能当成 54 分 4 秒。
    expect(parseCountdown('h 54:4')).toBeNull();
    expect(parseCountdown('54:4')).toBeNull();
  });

  it('handles OCR errors: 夭 → 天', () => {
    expect(parseCountdown('1夭10:09:20')).toBe(122960);
  });

  it('handles OCR errors: dots instead of colons', () => {
    expect(parseCountdown('02.30.00')).toBe(9000);
  });

  it('handles OCR errors: fullwidth colons', () => {
    expect(parseCountdown('00：59：26')).toBe(59 * 60 + 26);
  });

  it('handles OCR errors: trailing noise', () => {
    expect(parseCountdown(' 02:30:00 ')).toBe(9000);
  });

  it('handles garbled day prefix "2:101:30:14" (1天01:30:14 misread)', () => {
    // "1天01:30:14" 中"天"被识别成冒号，与小时粘连成"101"；
    // 百位还原成天，末两位是小时 → 1天01:30:14 = 91814
    expect(parseCountdown('2:101:30:14')).toBe(91814);
  });

  it('recovers day from hour-digits when "天" is lost', () => {
    // "1天01:14:45" → ":101:14:45"（天字消失，1与01粘连）
    expect(parseCountdown(':101:14:45')).toBe(90885);
  });

  it('extracts last H:MM:SS when prefix digits are garbled', () => {
    expect(parseCountdown('5h01:25:44')).toBe(5144);
    expect(parseCountdown('5h02:33:31')).toBe(9211);
  });

  it('returns null for non-numeric text', () => {
    expect(parseCountdown('空闲')).toBeNull();
    expect(parseCountdown('已完成')).toBeNull();
    expect(parseCountdown('')).toBeNull();
    expect(parseCountdown('abc')).toBeNull();
  });

  it('returns 0 for zero', () => {
    expect(parseCountdown('00:00:00')).toBe(0);
    expect(parseCountdown('0天00:00:00')).toBe(0);
  });
});
