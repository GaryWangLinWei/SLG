import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';
import { resetCityView, swipeBuildingToCenter } from '../utils/location';

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

    // 每项资源收集前重置视角，确保建筑位置与配置坐标吻合
    await resetCityView(ctx, config);

    // 拖动建筑到屏幕中心
    await swipeBuildingToCenter(ctx, pos, resource.building);
  }

  ctx.log('=== Resource collection completed! ===');
  ctx.log(`Processed ${config.resources.length} buildings`);
}
