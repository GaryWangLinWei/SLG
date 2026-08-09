import { parseCountdown } from './parseCountdown';

describe('parseCountdown', () => {
  it('parses days + HH:MM:SS', () => {
    expect(parseCountdown('1天10:09:20')).toBe(122960);
    expect(parseCountdown('2天00:00:00')).toBe(172800);
  });

  it('parses HH:MM:SS', () => {
    expect(parseCountdown('2:30:00')).toBe(9000);
    expect(parseCountdown('1:00:00')).toBe(3600);
    expect(parseCountdown('0:05:30')).toBe(330);
  });

  it('parses MM:SS', () => {
    expect(parseCountdown('45:30')).toBe(2730);
    expect(parseCountdown('05:00')).toBe(300);
  });

  it('parses bare seconds', () => {
    expect(parseCountdown('15')).toBe(15);
    expect(parseCountdown('59')).toBe(59);
  });

  it('handles OCR errors: 夭 → 天', () => {
    expect(parseCountdown('1夭10:09:20')).toBe(122960);
  });

  it('handles OCR errors: dots instead of colons', () => {
    expect(parseCountdown('2.30.00')).toBe(9000);
  });

  it('handles OCR errors: fullwidth colons', () => {
    expect(parseCountdown('45：30')).toBe(2730);
  });

  it('handles OCR errors: trailing noise', () => {
    expect(parseCountdown(' 2:30:00 ')).toBe(9000);
  });

  it('handles garbled day prefix "2:101:30:14" (1天01:30:14 misread)', () => {
    // 末尾完整的 01:30:14，前面粘连的杂讯忽略
    expect(parseCountdown('2:101:30:14')).toBe(5414);
  });

  it('extracts last H:MM:SS when prefix digits are garbled', () => {
    expect(parseCountdown('5h01:25:44')).toBe(5144);
    expect(parseCountdown('5h02:33:31')).toBe(9211);
  });

  it('returns null for non-numeric text', () => {
    expect(parseCountdown('空闲')).toBeNull();
    expect(parseCountdown('')).toBeNull();
    expect(parseCountdown('abc')).toBeNull();
  });

  it('returns 0 for zero', () => {
    expect(parseCountdown('0:00:00')).toBe(0);
    expect(parseCountdown('00:00')).toBe(0);
  });
});
