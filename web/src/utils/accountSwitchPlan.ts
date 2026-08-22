/**
 * 账号调度的纯逻辑：类型推导、槽位校验、切换步骤计算、环向索引推进。
 *
 * 设计要点：profile 不存储"类型"字段，类型完全由切号列表里的账号编号分组推导——
 * 某账号编号只出现 1 次 → account 型（只切账号，落点即正确角色）；
 * 出现 ≥2 次 → role 型（这些方案是同一账号下的不同角色，必须靠星标序号区分）。
 */

export type ProfileKind = 'account' | 'role';

export interface ProfileSwitchMeta {
  /** profile（配置方案）名 */
  name: string;
  /** 游戏账号编号 */
  accountName: string;
  /** 星标序号（1 开始），仅 role 型需要 */
  starredIndex?: number;
}

/** 星标序号是否合法（≥1 的整数）。校验与步骤计算共用，避免两处判定漂移（如 NaN 同时被 typeof 放行）。 */
function isValidStarredIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

/** 按账号编号分组推导每个 profile 的类型。 */
export function deriveProfileKinds(profiles: ProfileSwitchMeta[]): Record<string, ProfileKind> {
  const countByAccount = new Map<string, number>();
  for (const p of profiles) {
    const acc = (p.accountName || '').trim();
    if (!acc) continue;
    countByAccount.set(acc, (countByAccount.get(acc) ?? 0) + 1);
  }
  const out: Record<string, ProfileKind> = {};
  for (const p of profiles) {
    const acc = (p.accountName || '').trim();
    out[p.name] = acc && (countByAccount.get(acc) ?? 0) >= 2 ? 'role' : 'account';
  }
  return out;
}
export type SlotIssueReason =
  | 'no-account'
  | 'missing-starred-index'
  | 'invalid-starred-index'
  | 'duplicate-starred-index';

export interface SlotIssue {
  profileName: string;
  reason: SlotIssueReason;
}

/**
 * 校验切号列表：account 型只要求填了账号编号；
 * role 型（同账号多方案）额外要求星标序号为正整数且组内互不相同。
 */
export function validateSwitchProfiles(profiles: ProfileSwitchMeta[]): SlotIssue[] {
  const kinds = deriveProfileKinds(profiles);
  const issues: SlotIssue[] = [];

  // 先算出每个账号组里重复的星标序号
  const dupIndexesByAccount = new Map<string, Set<number>>();
  const seenByAccount = new Map<string, Set<number>>();
  for (const p of profiles) {
    const acc = (p.accountName || '').trim();
    if (!acc || kinds[p.name] !== 'role' || !isValidStarredIndex(p.starredIndex)) continue;
    const seen = seenByAccount.get(acc) ?? new Set<number>();
    if (seen.has(p.starredIndex)) {
      const dup = dupIndexesByAccount.get(acc) ?? new Set<number>();
      dup.add(p.starredIndex);
      dupIndexesByAccount.set(acc, dup);
    }
    seen.add(p.starredIndex);
    seenByAccount.set(acc, seen);
  }

  for (const p of profiles) {
    const acc = (p.accountName || '').trim();
    if (!acc) {
      issues.push({ profileName: p.name, reason: 'no-account' });
      continue;
    }
    if (kinds[p.name] !== 'role') continue;
    if (p.starredIndex === undefined || p.starredIndex === null) {
      issues.push({ profileName: p.name, reason: 'missing-starred-index' });
      continue;
    }
    if (!isValidStarredIndex(p.starredIndex)) {
      issues.push({ profileName: p.name, reason: 'invalid-starred-index' });
      continue;
    }
    if (dupIndexesByAccount.get(acc)?.has(p.starredIndex)) {
      issues.push({ profileName: p.name, reason: 'duplicate-starred-index' });
    }
  }
  return issues;
}

export interface SwitchSteps {
  /** 目标账号与当前不同时存在 */
  accountSwitch?: { accountName: string };
  /** 目标是 role 型时总是存在 */
  roleSwitch?: { starredIndex: number };
}

/**
 * 算出从 current 切到 target 需要的显式步骤。
 *
 * 规则（与 spec 2.3 一致）：
 * - 目标 account 型 → 只切账号（切过去落点即正确角色）。
 * - 目标 role 型 → 账号不同则先切账号；然后**总是**位置切角色。
 *   "总是"是必需的：切账号只会落在该账号最近使用的角色上，
 *   而轮换每轮结束时该账号的最近使用角色都不是下一轮的目标。
 */
export function buildSwitchSteps(
  current: ProfileSwitchMeta | undefined,
  target: ProfileSwitchMeta,
  profiles: ProfileSwitchMeta[],
): SwitchSteps {
  const kinds = deriveProfileKinds(profiles);
  const targetAcc = (target.accountName || '').trim();
  const currentAcc = (current?.accountName || '').trim();
  const steps: SwitchSteps = {};

  if (!currentAcc || currentAcc !== targetAcc) {
    steps.accountSwitch = { accountName: targetAcc };
  }
  if (kinds[target.name] === 'role') {
    // role 型目标缺/错星标序号时拒绝产出任何步骤：
    // 只切账号会落在该账号最近使用的角色上，静默违反"总是切角色"不变量。
    if (!isValidStarredIndex(target.starredIndex)) return {};
    steps.roleSwitch = { starredIndex: target.starredIndex };
  }
  return steps;
}

/**
 * 环向推进切号目标索引：返回 active 在 validIds 中的下一格。
 * 替代旧的 `findIndex(x => x !== nextProfile)`——那个写法只在恰好 2 个
 * 有效 profile 时正确，3+ 槽位时会跳到任意非当前项，轮换顺序不确定。
 */
export function nextSwitchTargetIdx(validIds: string[], activeName: string): number {
  if (validIds.length === 0) return 0;
  const idx = validIds.indexOf(activeName);
  if (idx < 0) return 0;
  return (idx + 1) % validIds.length;
}
