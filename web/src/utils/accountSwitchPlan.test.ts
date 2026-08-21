import { deriveProfileKinds } from './accountSwitchPlan';

describe('deriveProfileKinds', () => {
  test('账号编号只出现一次 → account 型', () => {
    const kinds = deriveProfileKinds([
      { name: 'P1', accountName: '1001' },
      { name: 'P2', accountName: '1002' },
    ]);
    expect(kinds).toEqual({ P1: 'account', P2: 'account' });
  });

  test('同一账号编号出现两次 → 都是 role 型', () => {
    const kinds = deriveProfileKinds([
      { name: 'A', accountName: '1001' },
      { name: 'B1', accountName: '1002', starredIndex: 1 },
      { name: 'B2', accountName: '1002', starredIndex: 2 },
    ]);
    expect(kinds).toEqual({ A: 'account', B1: 'role', B2: 'role' });
  });

  test('账号编号首尾空格不影响分组', () => {
    const kinds = deriveProfileKinds([
      { name: 'B1', accountName: ' 1002 ', starredIndex: 1 },
      { name: 'B2', accountName: '1002', starredIndex: 2 },
    ]);
    expect(kinds).toEqual({ B1: 'role', B2: 'role' });
  });

  test('账号编号为空的 profile 不参与分组，判为 account 型', () => {
    const kinds = deriveProfileKinds([
      { name: 'X', accountName: '' },
      { name: 'Y', accountName: '   ' },
    ]);
    expect(kinds).toEqual({ X: 'account', Y: 'account' });
  });
});