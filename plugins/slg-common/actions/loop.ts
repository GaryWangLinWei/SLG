import { PluginContext } from '../../../core/plugin';

export interface LoopConfig {
  action: (ctx: PluginContext) => Promise<void>;
  intervalSeconds: number;
  maxIterations?: number;
  stopOnError?: boolean;
}

export async function runLoop(
  ctx: PluginContext,
  config: LoopConfig
): Promise<void> {
  let iteration = 0;
  const maxIterations = config.maxIterations ?? Infinity;

  ctx.log(`开始循环执行，间隔: ${config.intervalSeconds}秒, 最大次数: ${maxIterations === Infinity ? '无限' : maxIterations}`);

  while (iteration < maxIterations) {
    iteration++;
    ctx.log(`--- 第 ${iteration} 次执行 ---`);

    try {
      await config.action(ctx);
    } catch (error) {
      ctx.log(`执行出错: ${error}`);
      if (config.stopOnError) {
        ctx.log('因错误停止循环');
        throw error;
      }
    }

    if (iteration < maxIterations) {
      ctx.log(`等待 ${config.intervalSeconds} 秒后继续...`);
      await ctx.sleep(config.intervalSeconds);
    }
  }

  ctx.log('循环执行完成');
}
