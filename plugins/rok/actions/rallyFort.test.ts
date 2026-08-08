import { parseTeamCount } from './rallyFort';

describe('parseTeamCount', () => {
  it('解析 N/M 队伍计数', () => {
    expect(parseTeamCount('3/5')).toEqual({ used: 3, total: 5 });
  });

  it('解析带空格的 N / M', () => {
    expect(parseTeamCount(' 5 / 5 ')).toEqual({ used: 5, total: 5 });
  });

  it('5/5 表示队伍已满', () => {
    const r = parseTeamCount('5/5');
    expect(r && r.used >= r.total).toBe(true);
  });

  it('3/5 表示有空闲队伍', () => {
    const r = parseTeamCount('3/5');
    expect(r && r.used < r.total).toBe(true);
  });

  it('OCR 漏掉斜杠且数字相同（如 55）回退为满队', () => {
    expect(parseTeamCount('55')).toEqual({ used: 5, total: 5 });
  });

  it('OCR 漏掉斜杠但数字不同（如 35）无法判定，返回 null', () => {
    expect(parseTeamCount('35')).toBeNull();
  });

  it('空文本返回 null', () => {
    expect(parseTeamCount('')).toBeNull();
  });

  it('杂讯中含 N/M 能提取', () => {
    expect(parseTeamCount('x 3/5 y')).toEqual({ used: 3, total: 5 });
  });
});
