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