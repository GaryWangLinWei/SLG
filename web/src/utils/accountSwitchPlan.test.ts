import { deriveProfileKinds, validateSwitchProfiles } from './accountSwitchPlan';

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

describe('validateSwitchProfiles', () => {
  test('全部合法时返回空数组', () => {
    expect(validateSwitchProfiles([
      { name: 'A', accountName: '1001' },
      { name: 'B1', accountName: '1002', starredIndex: 1 },
      { name: 'B2', accountName: '1002', starredIndex: 2 },
    ])).toEqual([]);
  });

  test('未填账号编号 → no-account', () => {
    expect(validateSwitchProfiles([
      { name: 'A', accountName: '' },
      { name: 'B', accountName: '1002' },
    ])).toEqual([{ profileName: 'A', reason: 'no-account' }]);
  });

  test('role 型缺星标序号 → missing-starred-index', () => {
    expect(validateSwitchProfiles([
      { name: 'B1', accountName: '1002', starredIndex: 1 },
      { name: 'B2', accountName: '1002' },
    ])).toEqual([{ profileName: 'B2', reason: 'missing-starred-index' }]);
  });

  test('role 型星标序号重复 → 两者都报 duplicate-starred-index', () => {
    expect(validateSwitchProfiles([
      { name: 'B1', accountName: '1002', starredIndex: 3 },
      { name: 'B2', accountName: '1002', starredIndex: 3 },
    ])).toEqual([
      { profileName: 'B1', reason: 'duplicate-starred-index' },
      { profileName: 'B2', reason: 'duplicate-starred-index' },
    ]);
  });

  test('星标序号非正整数 → invalid-starred-index', () => {
    expect(validateSwitchProfiles([
      { name: 'B1', accountName: '1002', starredIndex: 0 },
      { name: 'B2', accountName: '1002', starredIndex: 2 },
    ])).toEqual([{ profileName: 'B1', reason: 'invalid-starred-index' }]);
  });

  test('account 型填了星标序号也不报错（忽略）', () => {
    expect(validateSwitchProfiles([
      { name: 'A', accountName: '1001', starredIndex: 9 },
      { name: 'B', accountName: '1002' },
    ])).toEqual([]);
  });
});