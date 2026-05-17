import { PluginContext } from '../../../core/plugin/PluginContext';
import { BuildingConfig } from '../types';

export async function upgradeBuildings(
  ctx: PluginContext,
  buildings: BuildingConfig[]
): Promise<void> {
  ctx.log('开始检查建筑升级...');

  const sortedBuildings = [...buildings].sort((a, b) => b.upgradePriority - a.upgradePriority);

  for (const building of sortedBuildings) {
    ctx.log(`检查 ${building.name}...`);

    await ctx.tap(building.position.x, building.position.y);
    await ctx.sleep(1.5);

    // Look for upgrade button
    const upgradeButton = ctx.getConfig<{ x: number; y: number }>('upgradeButtonPosition');
    if (upgradeButton) {
      await ctx.tap(upgradeButton.x, upgradeButton.y);
      await ctx.sleep(1);
      ctx.log(`尝试升级 ${building.name}`);
    }

    // Back to main
    const backButton = ctx.getConfig<{ x: number; y: number }>('backButtonPosition');
    if (backButton) {
      await ctx.tap(backButton.x, backButton.y);
      await ctx.sleep(0.5);
    }
  }

  ctx.log('建筑升级检查完成');
}
