import { resolveSwitchKind } from './switchAccountKind';

describe('resolveSwitchKind 切法决策', () => {
  test('主号(常规) → 同编号连体号 → main-to-linked', () => {
    expect(resolveSwitchKind({
      currentName: '241872258', currentType: 'account',
      targetName: '241872258', targetType: 'linked',
    })).toEqual({ kind: 'linked', direction: 'main-to-linked' });
  });

  test('连体号 → 同编号主号(常规) → linked-to-main', () => {
    expect(resolveSwitchKind({
      currentName: '241872258', currentType: 'linked',
      targetName: '241872258', targetType: 'account',
    })).toEqual({ kind: 'linked', direction: 'linked-to-main' });
  });

  test('常规 → 常规 同编号 → OCR', () => {
    expect(resolveSwitchKind({
      currentName: '241872258', currentType: 'account',
      targetName: '241872258', targetType: 'account',
    })).toEqual({ kind: 'ocr' });
  });

  test('编号不同 → OCR（即使一方是连体号）', () => {
    expect(resolveSwitchKind({
      currentName: '111', currentType: 'linked',
      targetName: '222', targetType: 'account',
    })).toEqual({ kind: 'ocr' });
  });

  test('编号带空格也能匹配', () => {
    expect(resolveSwitchKind({
      currentName: ' 241872258 ', currentType: 'account',
      targetName: '241872258', targetType: 'linked',
    })).toEqual({ kind: 'linked', direction: 'main-to-linked' });
  });

  test('空编号 → OCR（避免误判连体）', () => {
    expect(resolveSwitchKind({
      currentName: '', currentType: 'account',
      targetName: '', targetType: 'linked',
    })).toEqual({ kind: 'ocr' });
  });
});
