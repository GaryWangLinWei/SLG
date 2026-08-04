import { parseDonateCount, DONATE_FALLBACK_CLICKS } from './donateAllianceTech';

describe('parseDonateCount', () => {
  it('parses the number before slash', () => {
    expect(parseDonateCount('17/20')).toBe(17);
  });
  it('parses zero', () => { expect(parseDonateCount('0/20')).toBe(0); });
  it('parses max 20', () => { expect(parseDonateCount('20/20')).toBe(20); });
  it('clamps above 20 down to 20', () => {
    expect(parseDonateCount('25/20')).toBe(20);
    expect(parseDonateCount('99/20')).toBe(20);
  });
  it('returns -1 (fallback sentinel) on unparseable input', () => {
    expect(parseDonateCount(' /20')).toBe(-1);
    expect(parseDonateCount('')).toBe(-1);
    expect(parseDonateCount('abc')).toBe(-1);
    expect(parseDonateCount('/20')).toBe(-1);
  });
  it('parses a bare number with no slash', () => { expect(parseDonateCount('7')).toBe(7); });
  it('parses number with surrounding whitespace', () => {
    expect(parseDonateCount(' 17 / 20 ')).toBe(17);
  });
  it('fallback constant is 10', () => { expect(DONATE_FALLBACK_CLICKS).toBe(10); });
});
