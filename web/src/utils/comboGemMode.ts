export interface ComboGemFeatures {
  autoSwitchAccount: boolean;
  switchMode: string;
}

export function isComboGemActive(features: ComboGemFeatures, locked: boolean): boolean {
  return features.autoSwitchAccount && features.switchMode === 'combo-gem' && !locked;
}
