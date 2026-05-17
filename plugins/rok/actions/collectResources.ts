import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';

export async function collectResources(
  ctx: PluginContext,
  config: RokConfig
): Promise<void> {
  ctx.log('=== Start collecting RoK resources...');
  ctx.log(`Found ${config.resources.length} resource buildings`);

  for (let i = 0; i < config.resources.length; i++) {
    const resource = config.resources[i];
    const pos = config.buildingPositions[resource.building];
    if (!pos) {
      ctx.log(`❌ 未找到建筑位置: ${resource.building}`);
      continue;
    }
    ctx.log(`Processing [${i + 1}/${config.resources.length}]: ${resource.building}`);

    // Tap resource building (直接点击建筑位置即可触发收集)
    ctx.log(`Tap position: (${pos.x}, ${pos.y})`);
    await ctx.tap(pos.x, pos.y);
    await ctx.sleep(1);
  }

  ctx.log('=== Resource collection completed! ===');
  ctx.log(`Processed ${config.resources.length} buildings`);
}
