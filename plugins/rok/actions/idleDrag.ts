import { PluginContext } from '../../../core/plugin';

export async function idleDrag(ctx: PluginContext): Promise<void> {
  const dragCount = 1 + Math.floor(Math.random() * 3); // 1-3 drags
  for (let i = 0; i < dragCount; i++) {
    const x1 = 200 + Math.random() * 680;   // 200~880
    const y1 = 200 + Math.random() * 800;   // 200~1000
    const x2 = x1 + (Math.random() - 0.5) * 800;
    const y2 = y1 + (Math.random() - 0.5) * 800;
    const duration = 300 + Math.random() * 900; // 300~1200ms
    await ctx.swipe(x1, y1, x2, y2, duration);
    await ctx.sleep(2 + Math.random() * 4); // 2-6s between drags
  }
}
