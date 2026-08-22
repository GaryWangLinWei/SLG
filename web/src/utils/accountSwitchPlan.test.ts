import { buildSwitchSteps, deriveProfileKinds, nextSwitchTargetIdx, validateSwitchProfiles } from './accountSwitchPlan';

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

  test('role 型星标序号为 NaN → invalid-starred-index', () => {
    expect(validateSwitchProfiles([
      { name: 'B1', accountName: '1002', starredIndex: NaN },
      { name: 'B2', accountName: '1002', starredIndex: 2 },
    ])).toEqual([{ profileName: 'B1', reason: 'invalid-starred-index' }]);
  });

  test('同账号三个方案星标序号全相同 → 三个都报 duplicate', () => {
    expect(validateSwitchProfiles([
      { name: 'B1', accountName: '1002', starredIndex: 2 },
      { name: 'B2', accountName: '1002', starredIndex: 2 },
      { name: 'B3', accountName: '1002', starredIndex: 2 },
    ])).toEqual([
      { profileName: 'B1', reason: 'duplicate-starred-index' },
      { profileName: 'B2', reason: 'duplicate-starred-index' },
      { profileName: 'B3', reason: 'duplicate-starred-index' },
    ]);
  });

  test('空数组 → deriveProfileKinds 返回 {}，validateSwitchProfiles 返回 []', () => {
    expect(deriveProfileKinds([])).toEqual({});
    expect(validateSwitchProfiles([])).toEqual([]);
  });
});

describe('buildSwitchSteps', () => {
  const A = { name: 'A', accountName: '1001' };
  const B1 = { name: 'B1', accountName: '1002', starredIndex: 1 };
  const B2 = { name: 'B2', accountName: '1002', starredIndex: 2 };
  const all = [A, B1, B2];

  test('A → B1（跨账号 role 型）：先切账号再切角色', () => {
    expect(buildSwitchSteps(A, B1, all)).toEqual({
      accountSwitch: { accountName: '1002' },
      roleSwitch: { starredIndex: 1 },
    });
  });

  test('B1 → B2（同账号 role 型）：只切角色', () => {
    expect(buildSwitchSteps(B1, B2, all)).toEqual({
      roleSwitch: { starredIndex: 2 },
    });
  });

  test('B2 → A（目标 account 型）：只切账号', () => {
    expect(buildSwitchSteps(B2, A, all)).toEqual({
      accountSwitch: { accountName: '1001' },
    });
  });

  test('目标 role 型且账号相同也总是带 roleSwitch（切账号无法选落点，必须补切）', () => {
    const steps = buildSwitchSteps(B2, B1, all);
    expect(steps.accountSwitch).toBeUndefined();
    expect(steps.roleSwitch).toEqual({ starredIndex: 1 });
  });

  test('当前 profile 未知（首轮无 active）：role 型给出完整两步', () => {
    expect(buildSwitchSteps(undefined, B1, all)).toEqual({
      accountSwitch: { accountName: '1002' },
      roleSwitch: { starredIndex: 1 },
    });
  });

  test('跨账号 role 型目标、缺失星标序号 → 整组空步骤（不做半吊子切账号）', () => {
    const bad = { name: 'B3', accountName: '1002', starredIndex: undefined };
    const metas = [A, B1, B2, bad];
    expect(buildSwitchSteps(A, bad, metas)).toEqual({});
  });

  test('跨账号 role 型目标、星标序号为 0 → 整组空步骤', () => {
    const bad = { name: 'B3', accountName: '1002', starredIndex: 0 };
    const metas = [A, B1, B2, bad];
    expect(buildSwitchSteps(A, bad, metas)).toEqual({});
  });

  test('跨账号 role 型目标、星标序号为 NaN → 整组空步骤（回归防护）', () => {
    const bad = { name: 'B3', accountName: '1002', starredIndex: NaN };
    const metas = [A, B1, B2, bad];
    expect(buildSwitchSteps(A, bad, metas)).toEqual({});
  });

  test('两个 account 型同账号编号不会发生（分组即 role），跨账号 account 型只切账号', () => {
    const C = { name: 'C', accountName: '1003' };
    expect(buildSwitchSteps(A, C, [A, C])).toEqual({
      accountSwitch: { accountName: '1003' },
    });
  });
});

describe('nextSwitchTargetIdx', () => {
  test('环向推进到下一格', () => {
    expect(nextSwitchTargetIdx(['A', 'B', 'C'], 'A')).toBe(1);
    expect(nextSwitchTargetIdx(['A', 'B', 'C'], 'B')).toBe(2);
  });

  test('最后一格回绕到 0', () => {
    expect(nextSwitchTargetIdx(['A', 'B', 'C'], 'C')).toBe(0);
  });

  test('当前 active 不在列表里 → 0', () => {
    expect(nextSwitchTargetIdx(['A', 'B'], 'Z')).toBe(0);
  });

  test('空列表 → 0', () => {
    expect(nextSwitchTargetIdx([], 'A')).toBe(0);
  });

  test('四槽轮换完整走一圈', () => {
    const ids = ['A', 'B1', 'B2', 'C'];
    expect(nextSwitchTargetIdx(ids, 'A')).toBe(1);
    expect(nextSwitchTargetIdx(ids, 'B1')).toBe(2);
    expect(nextSwitchTargetIdx(ids, 'B2')).toBe(3);
    expect(nextSwitchTargetIdx(ids, 'C')).toBe(0);
  });
});