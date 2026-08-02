export type AccountType = 'account' | 'linked';
export type LinkedDirection = 'main-to-linked' | 'linked-to-main';

export interface SwitchKindInput {
  currentName: string;
  currentType: AccountType;
  targetName: string;
  targetType: AccountType;
}

export type SwitchKind =
  | { kind: 'ocr' }
  | { kind: 'linked'; direction: LinkedDirection };

/**
 * 决定切号物理方式：
 * - 当前与目标编号相同（非空）、且至少一方是连体号 → 连体流程；
 *   direction 由当前类型决定（当前是常规主号→主号切连体；当前是连体→连体切主号）。
 * - 其余情况走 OCR 切账号。
 */
export function resolveSwitchKind(input: SwitchKindInput): SwitchKind {
  const cur = (input.currentName || '').trim();
  const tgt = (input.targetName || '').trim();
  const sameAccount = !!cur && cur === tgt;
  const isLinkedSwitch = sameAccount && (input.currentType === 'linked' || input.targetType === 'linked');
  if (!isLinkedSwitch) return { kind: 'ocr' };

  const direction: LinkedDirection = input.currentType === 'account' && input.targetType === 'linked'
    ? 'main-to-linked'
    : 'linked-to-main';
  return { kind: 'linked', direction };
}
