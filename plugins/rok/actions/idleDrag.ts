import { PluginContext } from '../../../core/plugin';

export async function idleDrag(ctx: PluginContext): Promise<void> {
  const dragCount = 1 + Math.floor(Math.random() * 3); // 1-3 drags
  for (let i = 0; i < dragCount; i++) {
    const x1 = 354 + Math.random() * 901;   // 354~1255
    const y1 = 209 + Math.random() * 479;   // 209~688
    const x2 = 354 + Math.random() * 901;
    const y2 = 209 + Math.random() * 479;
    const duration = 300 + Math.random() * 900; // 300~1200ms
    await ctx.swipe(x1, y1, x2, y2, duration);
    await ctx.sleep(2 + Math.random() * 4); // 2-6s between drags
  }
}
