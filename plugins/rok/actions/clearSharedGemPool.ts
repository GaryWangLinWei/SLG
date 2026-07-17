import { PluginContext } from '../../../core/plugin';
import { sharedGemPool } from '../state/sharedGemPool';

export async function clearSharedGemPool(ctx: PluginContext): Promise<void> {
  sharedGemPool.clearAll();
  ctx.log(`[shared-gem-pool] 已清空全部账号的分享矿池`);
}
