import { PluginContext } from '../../../core/plugin/PluginContext';
import { ResourceConfig } from '../types';

export async function collectResources(
  ctx: PluginContext,
  resources: ResourceConfig[]
): Promise<void> {
  ctx.log('开始收集资源...');

  for (const resource of resources) {
    ctx.log(`收集 ${resource.name}...`);

    if (resource.templateImage) {
      const found = await ctx.waitForImage(resource.templateImage, 5);
      if (!found) {
        ctx.log(`未找到 ${resource.name}，跳过`);
        continue;
      }
      await ctx.tapImage(resource.templateImage);
    } else {
      await ctx.tap(resource.collectButton.x, resource.collectButton.y);
    }

    await ctx.sleep(1);

    // Tap back to main screen if needed
    await ctx.sleep(0.5);
  }

  ctx.log('资源收集完成');
}
