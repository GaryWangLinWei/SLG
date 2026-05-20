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
