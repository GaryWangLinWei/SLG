import { accountIdMatches } from './switchAccount';

describe('accountIdMatches', () => {
  it('完全一致时匹配', () => {
    expect(accountIdMatches('5935882', '5935882')).toBe(true);
  });

  it('OCR 把 9 识别成 0 时仍匹配（用户真实案例 5935882 → 5035882）', () => {
    expect(accountIdMatches('5035882', '5935882')).toBe(true);
  });

  it('OCR 把 0 识别成 9 时仍匹配', () => {
    expect(accountIdMatches('12934', '12034')).toBe(true);
  });

  it('非 0/9 的数字不同（1↔8）直接不匹配', () => {
    expect(accountIdMatches('5935812', '5935882')).toBe(false);
  });

  it('两处 0↔9 不同（10011 vs 19911）不匹配', () => {
    expect(accountIdMatches('10011', '19911')).toBe(false);
  });

  it('只有一处非 0/9 差异也不匹配', () => {
    expect(accountIdMatches('5045882', '5935882')).toBe(false);
  });

  it('OCR 文本带其他字符/换行，能从中找到编号', () => {
    expect(accountIdMatches('账号\n5035882\n已登录', '5935882')).toBe(true);
  });

  it('OCR 把编号多读成更长串时，等长子窗口能匹配', () => {
    // 前面多识别了个 1，但目标 5935882 的窗口里只有一位 9→0
    expect(accountIdMatches('15035882', '5935882')).toBe(true);
  });

  it('完全不相干的数字不匹配', () => {
    expect(accountIdMatches('1234567', '5935882')).toBe(false);
  });
});
